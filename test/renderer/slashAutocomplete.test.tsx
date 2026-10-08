// @vitest-environment jsdom
/**
 * 斜杠命令补全（slash.commands，2026-10）渲染层单测。
 *
 * 覆盖：
 * - slashTriggerOf：仅「/xxx 且无空白」触发；含空格/非斜杠开头/多行不触发；
 * - filterSlashCommands：前缀匹配忽略大小写（/c → cost/context/compact/c）；
 * - useSlashAutocomplete 弹层交互：/ 前缀出候选、↑↓ 移动高亮（并驱动
 *   滚动条跟随选中项滚入可视区）、Tab/Enter
 *   选中回填（命令名+尾随空格）、输入已等于完整命令名时 Enter 直通、
 *   Esc 收起、空目录不弹层；
 * - backendStore.refreshSlashCommands 的回执落库用例见
 *   backendStore.test.ts（同文件已搭好假 WS 客户端设施）。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef, useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import {
  filterSlashCommands,
  slashTriggerOf,
  useSlashAutocomplete
} from '@renderer/components/SlashAutocomplete'
import { useSlashStore } from '@renderer/stores/slashStore'
import type { SlashCommandItem } from '../../src/shared/contracts'

/** 固定补全目录（passthrough 按后端口径已排序 + native + skill 各一）。 */
const ITEMS: SlashCommandItem[] = [
  { name: '/c', description: '/cost 简写', source: 'passthrough' },
  { name: '/compact', description: '压缩上下文', source: 'passthrough' },
  { name: '/context', description: '查看上下文占用', source: 'passthrough' },
  { name: '/cost', description: '查看花费', source: 'passthrough' },
  { name: '/mode', description: '切换工作模式', source: 'native' },
  { name: '/demo', description: '演示技能', source: 'skill' }
]

// ---- 纯函数 ----

describe('slashTriggerOf', () => {
  it('斜杠开头且无空白才触发，返回小写前缀', () => {
    expect(slashTriggerOf('/')).toBe('/')
    expect(slashTriggerOf('/c')).toBe('/c')
    expect(slashTriggerOf('/C')).toBe('/c')
  })

  it('非斜杠开头 / 已打空格 / 多行都不触发', () => {
    expect(slashTriggerOf('hello')).toBeNull()
    expect(slashTriggerOf('a/b')).toBeNull()
    expect(slashTriggerOf('/demo 做个网站')).toBeNull()
    expect(slashTriggerOf('/c\n')).toBeNull()
    expect(slashTriggerOf('')).toBeNull()
  })
})

describe('filterSlashCommands', () => {
  it('/c 前缀命中 c 开头全部命令（保持目录序）', () => {
    const got = filterSlashCommands(ITEMS, '/c').map((c) => c.name)
    expect(got).toEqual(['/c', '/compact', '/context', '/cost'])
  })

  it('/ 命中全部；无匹配返回空', () => {
    expect(filterSlashCommands(ITEMS, '/')).toHaveLength(ITEMS.length)
    expect(filterSlashCommands(ITEMS, '/z')).toEqual([])
  })
})

// ---- 弹层交互（经真实 textarea 渲染，portal 浮层落 body） ----

/** 受控外壳：draft 由按键测试自行推进，onPick 记录选中回填。 */
function Harness({ onPick }: { onPick: (name: string) => void }): ReactNode {
  const [draft, setDraft] = useState('/c')
  const ref = useRef<HTMLTextAreaElement>(null)
  const ac = useSlashAutocomplete(draft, ref, onPick)
  return (
    <>
      <textarea
        ref={ref}
        data-testid="ta"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          ac.handleKeyDown(e)
        }}
      />
      {ac.overlay}
    </>
  )
}

describe('useSlashAutocomplete 弹层', () => {
  // 框架自动清理未开启（vitest globals 关闭）：不 cleanup 会让跨用例的
  // testid/role 重复命中（与 themedSelect.test 同法）。@author aceFelix
  afterEach(() => cleanup())

  beforeEach(() => {
    useSlashStore.getState().setCommands(ITEMS)
  })

  it('/c 弹出 4 个候选，首项默认高亮', () => {
    const { getByTestId, getAllByRole } = render(<Harness onPick={vi.fn()} />)
    expect(getByTestId('slash-ac-menu')).toBeTruthy()
    const opts = getAllByRole('option')
    expect(opts).toHaveLength(4)
    expect(opts[0].getAttribute('aria-selected')).toBe('true')
    expect(getByTestId('ta')).toBeTruthy()
  })

  it('ArrowDown 移动高亮并循环', () => {
    const { getAllByRole, getByTestId } = render(<Harness onPick={vi.fn()} />)
    const ta = getByTestId('ta')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    // 末位再下轮回首位
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
  })

  it('↑↓ 移动高亮时滚动条跟随（选中项滚入可视区）', () => {
    // jsdom 无布局引擎：手工给容器可视高与各项 offsetTop/offsetHeight
    // （每项 26px、可视区 52px 仅容两项），令末项落在折叠线外，验证
    // scrollTop 被推进/回退。@author aceFelix
    const { getAllByRole, getByTestId } = render(<Harness onPick={vi.fn()} />)
    const ta = getByTestId('ta')
    const menu = getByTestId('slash-ac-menu')
    Object.defineProperty(menu, 'clientHeight', { value: 52, configurable: true })
    getAllByRole('option').forEach((opt, i) => {
      Object.defineProperty(opt, 'offsetTop', { value: i * 26, configurable: true })
      Object.defineProperty(opt, 'offsetHeight', { value: 26, configurable: true })
    })
    // 下移到第 3 项（index 2）：bottom=78 > 可视底 52 → scrollTop 推到 78-52=26
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(menu.scrollTop).toBe(26)
    // 上移回首项：top=0 < scrollTop → 归零
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    expect(menu.scrollTop).toBe(0)
  })

  it('Tab 选中高亮项：回填「命令名 + 尾随空格」', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<Harness onPick={onPick} />)
    fireEvent.keyDown(getByTestId('ta'), { key: 'Tab' })
    expect(onPick).toHaveBeenCalledWith('/c ')
  })

  it('输入已是完整命令名（/c 即目录项）时 Enter 不拦截，交回发送链路', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<Harness onPick={onPick} />)
    fireEvent.keyDown(getByTestId('ta'), { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('前缀 /co 时 Enter 先补全选中项（二次 Enter 才发送）', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(
      // 直接以 /co 起手的受控变体：改 draft 初值等价于用户敲到 /co
      (() => {
        function Harness2(): ReactNode {
          const [draft, setDraft] = useState('/co')
          const ref = useRef<HTMLTextAreaElement>(null)
          const ac = useSlashAutocomplete(draft, ref, onPick)
          return (
            <>
              <textarea
                ref={ref}
                data-testid="ta"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => void ac.handleKeyDown(e)}
              />
              {ac.overlay}
            </>
          )
        }
        return <Harness2 />
      })()
    )
    fireEvent.keyDown(getByTestId('ta'), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('/compact ')
  })

  it('Esc 收起弹层，改动输入后恢复', () => {
    const { getByTestId, queryByTestId } = render(<Harness onPick={vi.fn()} />)
    const ta = getByTestId('ta')
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(queryByTestId('slash-ac-menu')).toBeNull()
    // 继续敲一字符 → 重新弹出
    fireEvent.change(ta, { target: { value: '/co' } })
    expect(getByTestId('slash-ac-menu')).toBeTruthy()
  })

  it('弹层内部滚动不收起，背后页面/窗口滚动才收起', () => {
    // 回归：候选多于可视行时，滚轮/↑↓ 跟随会改 menu.scrollTop 并派发
    // scroll（capture 到 window），旧实现一律收起 → 一滚弹层就消失。
    // 现只忽略 menu 内部滚动，背后滚动仍收起。@author aceFelix
    const { getByTestId, queryByTestId } = render(<Harness onPick={vi.fn()} />)
    const menu = getByTestId('slash-ac-menu')
    fireEvent.scroll(menu)
    expect(queryByTestId('slash-ac-menu')).toBeTruthy()
    // 窗口滚动（target 不在 menu 内）→ 收起
    fireEvent.scroll(window)
    expect(queryByTestId('slash-ac-menu')).toBeNull()
  })

  it('空目录（slash.commands 未回填）不弹层', () => {
    useSlashStore.getState().setCommands([])
    const { queryByTestId } = render(<Harness onPick={vi.fn()} />)
    expect(queryByTestId('slash-ac-menu')).toBeNull()
  })

  it('鼠标按下候选项即选中回填（preventDefault 保持焦点）', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<Harness onPick={onPick} />)
    // /c 的第 3 个候选 = /context
    fireEvent.mouseDown(getByTestId('slash-ac-context').closest('[role="option"]')!)
    expect(onPick).toHaveBeenCalledWith('/context ')
  })

  it('输入含空格后弹层自动收起（不再干扰打参数）', () => {
    const { getByTestId, queryByTestId } = render(<Harness onPick={vi.fn()} />)
    act(() => {
      fireEvent.change(getByTestId('ta'), { target: { value: '/demo 做个网站' } })
    })
    expect(queryByTestId('slash-ac-menu')).toBeNull()
  })
})
