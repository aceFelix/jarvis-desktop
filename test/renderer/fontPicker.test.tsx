// @vitest-environment jsdom
/**
 * FontPicker（字体选择器）组件测试。
 *
 * 覆盖：queryLocalFonts 懒加载枚举 + 去重、默认项置顶、cjkFirst 下中文字体打「含中文」标签、
 * onChange 值归一（选字体上抛族名 / 选默认上抛 null）、API 缺失时回落常见字体预设。
 * 浮层/过滤/预览已由 themedSelect.test.tsx 覆盖，本文件聚焦 FontPicker 自身数据装配与回调。
 *
 * @author aceFelix
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import FontPicker from '@renderer/components/FontPicker'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // 清理可能挂到 window 的 queryLocalFonts mock
  delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts
})

beforeEach(() => {
  window.localStorage.clear()
})

/** 在用户手势展开下拉，触发 FontPicker 的懒加载。 */
function openDropdown(testid: string): void {
  fireEvent.click(screen.getByTestId(testid))
}

describe('FontPicker 字体选择器', () => {
  it('queryLocalFonts 懒加载：默认项置顶 + 枚举族去重；cjkFirst 给中文字体打标签', async () => {
    const onChange = vi.fn()
    ;(window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts = vi
      .fn()
      .mockResolvedValue([
        { family: 'Arial' },
        { family: 'Arial' },
        { family: 'SimSun' },
        { family: 'Microsoft YaHei' }
      ])
    render(<FontPicker value={null} onChange={onChange} cjkFirst testid="font-cjk" ariaLabel="中文字体" />)
    openDropdown('font-cjk')

    // 枚举异步回填：等选项出现
    await waitFor(() => expect(screen.getByTestId('font-cjk-option-SimSun')).toBeInTheDocument())
    // 默认项存在（value='' → testid 尾缀空）
    expect(screen.getByTestId('font-cjk-option-')).toBeInTheDocument()
    // 中文字体带标签，西文不带
    expect(screen.getByTestId('font-cjk-option-SimSun')).toHaveTextContent('含中文')
    expect(screen.getByTestId('font-cjk-option-Microsoft YaHei')).toHaveTextContent('含中文')
    expect(screen.getByTestId('font-cjk-option-Arial')).not.toHaveTextContent('含中文')
  })

  it('点选字体上抛族名', async () => {
    const onChange = vi.fn()
    ;(window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts = vi
      .fn()
      .mockResolvedValue([{ family: 'Arial' }])
    render(<FontPicker value={null} onChange={onChange} cjkFirst={false} testid="font-latin" ariaLabel="英文字体" />)
    openDropdown('font-latin')
    await waitFor(() => expect(screen.getByTestId('font-latin-option-Arial')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('font-latin-option-Arial'))
    expect(onChange).toHaveBeenCalledWith('Arial')
  })

  it('已选字体时点默认项上抛 null', async () => {
    const onChange = vi.fn()
    ;(window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts = vi
      .fn()
      .mockResolvedValue([{ family: 'Arial' }])
    // 当前已选 Arial，默认项（''）与当前值不同 → 点选上抛归一后的 null
    render(<FontPicker value="Arial" onChange={onChange} cjkFirst={false} testid="font-latin" ariaLabel="英文字体" />)
    openDropdown('font-latin')
    await waitFor(() => expect(screen.getByTestId('font-latin-option-Arial')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('font-latin-option-'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('API 不可用：回落常见字体预设（仍可点选）', async () => {
    // 不定义 queryLocalFonts
    const onChange = vi.fn()
    render(<FontPicker value={null} onChange={onChange} cjkFirst={false} testid="font-fb" ariaLabel="英文字体" />)
    openDropdown('font-fb')
    // 预设里的 Segoe UI 应出现
    await waitFor(() => expect(screen.getByTestId('font-fb-option-Segoe UI')).toBeInTheDocument())
  })
})
