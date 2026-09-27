// @vitest-environment jsdom
/**
 * ThemedTimePicker 组件测试（自绘时间选择器 = 小时/分钟两个 ThemedSelect 拼装）。
 *
 * 覆盖：HH:MM 解析与显示、改小时/改分钟各自拼回完整值回调、非法值回退显示（不吐脏值）、
 * 分钟列表 00-59 全量、testid 派生与无障碍名（行标签 + 小时/分钟）。
 * 说明：项目 vitest globals 未开启（@testing-library 自动清理不生效），需手动 cleanup，
 * 否则跨用例 testid 重复命中报 getMultipleElementsFoundError。
 *
 * @author aceFelix
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ThemedTimePicker from '../../src/renderer/src/components/ThemedTimePicker'

afterEach(() => cleanup())

describe('ThemedTimePicker', () => {
  it('显示 HH:MM：根节点带 data-value，小时/分钟触发器分列显示', () => {
    render(<ThemedTimePicker testid="tp" ariaLabel="简报时间" value="07:15" onChange={vi.fn()} />)
    expect(screen.getByTestId('tp')).toHaveAttribute('data-value', '07:15')
    expect(screen.getByTestId('tp-hour')).toHaveTextContent('07')
    expect(screen.getByTestId('tp-minute')).toHaveTextContent('15')
    // 无障碍名 = 行标签 + 时/分（默认中文）
    const hourLabel = screen.getByTestId('tp-hour').getAttribute('aria-label') ?? ''
    expect(hourLabel).toContain('简报时间')
    expect(hourLabel).toContain('小时')
  })

  it('改小时：分钟侧保持不变，回调完整 HH:MM', () => {
    const onChange = vi.fn()
    render(<ThemedTimePicker testid="tp" value="07:15" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('tp-hour'))
    fireEvent.click(screen.getByTestId('tp-hour-option-06'))
    expect(onChange).toHaveBeenCalledWith('06:15')
  })

  it('改分钟：小时侧保持不变，回调完整 HH:MM', () => {
    const onChange = vi.fn()
    render(<ThemedTimePicker testid="tp" value="07:15" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('tp-minute'))
    fireEvent.click(screen.getByTestId('tp-minute-option-45'))
    expect(onChange).toHaveBeenCalledWith('07:45')
  })

  it('分钟列表为 00-59 全量（与原生 time 面板同口径）', () => {
    render(<ThemedTimePicker testid="tp" value="07:15" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('tp-minute'))
    const menu = screen.getByTestId('tp-minute-menu')
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(60)
    expect(screen.getByTestId('tp-minute-option-00')).toBeInTheDocument()
    expect(screen.getByTestId('tp-minute-option-59')).toBeInTheDocument()
  })

  it('非法值只影响显示：回退 00:00，且不因渲染触发回调', () => {
    const onChange = vi.fn()
    render(<ThemedTimePicker testid="tp" value="bad" onChange={onChange} />)
    expect(screen.getByTestId('tp-hour')).toHaveTextContent('00')
    expect(screen.getByTestId('tp-minute')).toHaveTextContent('00')
    expect(onChange).not.toHaveBeenCalled()
  })
})
