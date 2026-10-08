/**
 * 斜杠命令补全弹层（slash.commands，2026-10）：桌面输入框对齐终端
 * _SlashCompleter 的前缀匹配手感——输入 "/" 列出全部可执行命令，
 * 输入 "/c" 过滤出 c 开头命令（cost / context / compact / c …）。
 *
 * 实现要点：
 * - 数据源 slashStore.commands（init 事件经 slash.commands RPC 刷新，
 *   只含桌面可执行命令：白名单透传 + 原生控件 + 已安装技能）；
 * - 触发形态：整条输入是 "/xxx"（斜杠开头且不含空白）才弹层，一旦打了
 *   空格（如 "/demo 做个网站"）即收起，不再干扰正常输入；
 * - 浮层 createPortal 挂 body + fixed 定位（与 ThemedSelect 同法，避开
 *   .glass-col backdrop-filter 的 containing block 与 overflow 裁剪），
 *   锚定输入框上沿向上生长；复用 .themed-select-menu/-option 皮肤类；
 * - 键盘：↑↓ 移动高亮（高亮项自动滚入可视区，滚动条跟随）、Tab/Enter 选中填入输入框（补全带尾随空格，二次
 *   Enter 才真正发送；已输入完整命令名时 Enter 直通发送）、Esc 对本次
 *   输入关闭（改动 draft 后自动恢复）；鼠标悬停高亮、按下选中。
 *
 * @author aceFelix
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { SlashCommandItem } from '../../../shared/contracts'
import { useSlashStore } from '../stores/slashStore'

/** 单项高度估值（行高 18 + 上下内边距 8）：仅用于 maxHeight 估算。 */
const ITEM_H = 26
/** 弹层最多可见条数（超出内部滚动，与字体下拉同手感）。 */
const MAX_VISIBLE = 8

/** 补全触发形态：整条输入恰为 "/xxx"（斜杠开头且无空白）→ 返回小写前缀；否则 null。 */
export function slashTriggerOf(text: string): string | null {
  return /^\/\S*$/.test(text) ? text.toLowerCase() : null
}

/** 前缀过滤（与终端 _SlashCompleter 同口径：命令名 startsWith 输入前缀）。导出纯函数便于测试。 */
export function filterSlashCommands(
  commands: readonly SlashCommandItem[],
  trigger: string
): SlashCommandItem[] {
  return commands.filter((c) => c.name.toLowerCase().startsWith(trigger))
}

/** 钩子返回值：由 ChatArea 输入框消费。 */
export interface SlashAutocompleteApi {
  /** 弹层 JSX（无可选项/已关闭时为 null）；portal 已挂 body。 */
  overlay: JSX.Element | null
  /** 先于输入框自身 Enter 发送逻辑调用；返回 true 表示按键已被补全层消化。 */
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean
}

/** 浮层视口锚点（fixed：left/width/bottom 直接定输入框上方）。 */
interface MenuRect {
  left: number
  width: number
  bottom: number
  maxHeight: number
}

/**
 * 输入框 / 命令补全钩子：监听 draft 形态，产出弹层与按键接管。
 * onPick 负责把选中命令名（带尾随空格）写回输入框。
 */
export function useSlashAutocomplete(
  draft: string,
  inputRef: RefObject<HTMLTextAreaElement>,
  onPick: (name: string) => void
): SlashAutocompleteApi {
  const commands = useSlashStore((s) => s.commands)
  const [active, setActive] = useState(0)
  // Esc 关闭记录：同一条输入不再自动重弹，改动 draft 后恢复
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [rect, setRect] = useState<MenuRect | null>(null)
  // 弹层容器 ref：↑↓ 移动高亮时把选中项滚入可视区（滚动条跟随选项）。
  const menuRef = useRef<HTMLDivElement>(null)

  const trigger = slashTriggerOf(draft)
  const matches = useMemo(
    () => (trigger === null ? [] : filterSlashCommands(commands, trigger)),
    [commands, trigger]
  )
  const open = trigger !== null && matches.length > 0 && dismissed !== draft

  // 输入变化：高亮回到首项；dismissed 只针对当时那条输入
  useEffect(() => {
    setActive(0)
    setDismissed((d) => (d !== null && d !== draft ? null : d))
  }, [draft])

  // 高亮项滚入可视区：↑↓ 越过弹层滚动边界时手动滚容器 scrollTop，
  // 使滚动条跟随选中项（不用 scrollIntoView 以免连带滚动背后页面；
  // 弹层为 fixed、选项 offsetParent 即容器，offsetTop 相对容器顶，计算精确）。
  // @author aceFelix
  useEffect(() => {
    const menu = menuRef.current
    if (!menu || !open) return
    const opt = menu.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    if (!opt) return
    const top = opt.offsetTop
    const bottom = top + opt.offsetHeight
    if (top < menu.scrollTop) {
      menu.scrollTop = top
    } else if (bottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = bottom - menu.clientHeight
    }
  }, [active, open, matches.length])

  // 打开时按输入框位置计算浮层（向上生长：bottom 锚输入框上沿）
  useLayoutEffect(() => {
    if (!open) {
      setRect(null)
      return
    }
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 6
    const need = Math.min(matches.length, MAX_VISIBLE) * ITEM_H + 8
    const spaceAbove = r.top - 16
    setRect({
      left: r.left,
      width: Math.min(r.width, 520),
      bottom: window.innerHeight - r.top + gap,
      maxHeight: Math.max(ITEM_H + 8, Math.min(need, spaceAbove))
    })
  }, [open, matches.length, inputRef])

  // 窗口缩放/背后页面滚动会让浮层错位：直接收起（改动输入重新弹出）。
  // 但要排除弹层自身的内部滚动：候选多于可视行时，↑↓ 跟随与鼠标滚轮
  // 都会改 menu.scrollTop 并派发 scroll 事件（capture 到 window），若不
  // 区分会误伤——用户一滚候选列表浮层就消失。target 落在 menu 内则忽略。
  // @author aceFelix
  useEffect(() => {
    if (!open) return
    const close = (e?: Event): void => {
      const menu = menuRef.current
      if (e && menu && e.target instanceof Node && menu.contains(e.target)) return
      setRect(null)
    }
    const onScroll = (e: Event): void => close(e)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  /** 选中：把命令名 + 尾随空格写回输入框（尾随空格同时天然收起弹层）。 */
  const pick = (i: number): void => {
    const item = matches[i]
    if (!item) return
    onPick(`${item.name} `)
  }

  /** 按键接管：仅弹层打开且已定位时消化相关键，其余交回输入框。 */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !rect || !matches.length) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % matches.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + matches.length) % matches.length)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(draft)
      return true
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      pick(active)
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // 已输入完整命令名（前缀与高亮项一致）：不拦截，让 Enter 直接发送
      if (trigger !== null && matches[active]?.name.toLowerCase() === trigger) return false
      e.preventDefault()
      pick(active)
      return true
    }
    return false
  }

  const overlay =
    open && rect
      ? createPortal(
          <div
            className="themed-select-menu slash-ac-menu"
            data-testid="slash-ac-menu"
            role="listbox"
            ref={menuRef}
            style={{ left: rect.left, width: rect.width, bottom: rect.bottom, maxHeight: rect.maxHeight }}
          >
            {matches.map((c, i) => (
              <div
                key={c.name}
                role="option"
                aria-selected={i === active}
                data-idx={i}
                data-testid={`slash-ac-${c.name.slice(1)}`}
                className={`themed-select-option slash-ac-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                // onMouseDown + preventDefault：保持 textarea 焦点，点选后继续敲参数/回车
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(i)
                }}
              >
                <span className="slash-ac-name">{c.name}</span>
                <span className="slash-ac-desc">{c.description}</span>
              </div>
            ))}
          </div>,
          document.body
        )
      : null

  return { overlay, handleKeyDown }
}
