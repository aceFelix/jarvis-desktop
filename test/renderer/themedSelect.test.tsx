// @vitest-environment jsdom
/**
 * ThemedSelect（自绘主题化下拉）组件测试。
 *
 * 背景：原生 select 的展开列表由系统绘制，CSS 管不到、也不随三主题皮肤变化，故改为
 * 自绘触发器 + 主题化浮层。本文件覆盖自绘实现的关键交互——收起态渲染、展开渲染全部
 * 选项与当前项标记、点选回调（值未变则不回调）、键盘（↑↓ 移动 + Enter 选中 + Esc 关闭）、
 * 点击触发器/浮层之外关闭。
 *
 * 说明：三主题配色/圆角/箭头由 CSS 覆盖（.themed-select-* + 皮肤块），jsdom 不做视觉断言。
 * @author aceFelix
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ThemedSelect from '@renderer/components/ThemedSelect'

/** 测试用选项集（覆盖首/中/末三档，便于验证上下移动边界）。 */
const OPTIONS = [
  { value: 'a', label: '选项 A' },
  { value: 'b', label: '选项 B' },
  { value: 'c', label: '选项 C' }
]

// 框架自动清理未开启（vitest globals 关闭）：不 cleanup 会让跨用例的 testid 重复命中
afterEach(() => cleanup())

describe('ThemedSelect 自绘下拉', () => {
  it('收起态：只渲染触发器，显示当前值文案并暴露 data-value', () => {
    render(<ThemedSelect value="b" options={OPTIONS} onChange={() => {}} testid="sel" />)
    const trigger = screen.getByTestId('sel')
    expect(trigger).toHaveTextContent('选项 B')
    expect(trigger).toHaveAttribute('data-value', 'b')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('sel-menu')).toBeNull()
  })

  it('点击展开渲染全部选项并标记当前项；点选后回调新值并关闭浮层', () => {
    const onChange = vi.fn()
    render(<ThemedSelect value="a" options={OPTIONS} onChange={onChange} testid="sel" />)
    fireEvent.click(screen.getByTestId('sel'))
    expect(screen.getByTestId('sel-menu')).toBeInTheDocument()
    expect(screen.getByTestId('sel-option-c')).toBeInTheDocument()
    expect(screen.getByTestId('sel-option-a')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('sel-option-b')).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(screen.getByTestId('sel-option-c'))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByTestId('sel-menu')).toBeNull()
    expect(screen.getByTestId('sel')).toHaveAttribute('aria-expanded', 'false')
  })

  it('重复选中当前值：只关闭浮层，不触发回调', () => {
    const onChange = vi.fn()
    render(<ThemedSelect value="b" options={OPTIONS} onChange={onChange} testid="sel" />)
    fireEvent.click(screen.getByTestId('sel'))
    fireEvent.click(screen.getByTestId('sel-option-b'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId('sel-menu')).toBeNull()
  })

  it('键盘：↑↓ 移动高亮、Enter 选中、Esc 只关不选', () => {
    const onChange = vi.fn()
    render(<ThemedSelect value="a" options={OPTIONS} onChange={onChange} testid="sel" />)
    const trigger = screen.getByTestId('sel')

    // 首次 ↓ 打开（高亮定位当前值 a），再两次 ↓ 到末项 c → Enter 选中
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByTestId('sel-menu')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByTestId('sel-menu')).toBeNull()

    // 再开再 Esc：仅关闭，不产生第二次回调
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByTestId('sel-menu')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('点击触发器/浮层之外关闭浮层', () => {
    render(<ThemedSelect value="a" options={OPTIONS} onChange={() => {}} testid="sel" />)
    fireEvent.click(screen.getByTestId('sel'))
    expect(screen.getByTestId('sel-menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('sel-menu')).toBeNull()
  })

  it('滚动与 Tab：浮层内滚动保持打开，页面滚动/Tab 离开则收起', () => {
    render(<ThemedSelect value="a" options={OPTIONS} onChange={() => {}} testid="sel" />)
    const trigger = screen.getByTestId('sel')

    // 浮层自身滚动 = 查看长选项列表，不应关闭（否则滚不动）
    fireEvent.click(trigger)
    fireEvent.scroll(screen.getByTestId('sel-menu'))
    expect(screen.getByTestId('sel-menu')).toBeInTheDocument()

    // 页面/容器滚动会使浮层悬空错位 → 收起
    fireEvent.scroll(document)
    expect(screen.queryByTestId('sel-menu')).toBeNull()

    // Tab 焦点即将离开 → 收起
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByTestId('sel-menu')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'Tab' })
    expect(screen.queryByTestId('sel-menu')).toBeNull()
  })
})
