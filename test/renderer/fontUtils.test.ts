/**
 * fontUtils 纯函数测试：UI 字体栈拼装、中文字体粗判、枚举列表规范化分组。
 *
 * 覆盖口径（2026-09 字体设置）：
 * - buildFontStack：两者皆空回 null；只设其一/皆设时的有序栈（英文在前中文在后 + 等宽尾）；
 *   字体名内引号/分号被清洗，防破坏 CSS；
 * - isLikelyCjkFont：常见中文字体命中、纯西文字体排除、带 CJK 变体的西文族不误伤；
 * - normalizeFontList：大小写不敏感去重、空白/非串过滤、cjkFirst 置顶分组、否则字母序。
 *
 * @author aceFelix
 */

import { describe, it, expect } from 'vitest'
import { buildFontStack, isLikelyCjkFont, normalizeFontList, FALLBACK_TAIL } from '@renderer/lib/fontUtils'

describe('buildFontStack 字体栈拼装', () => {
  it('英文/中文皆未选返回 null（调用方不写变量，回落主题默认）', () => {
    expect(buildFontStack(null, null)).toBe(null)
    expect(buildFontStack('', '')).toBe(null)
    expect(buildFontStack('   ', null)).toBe(null)
  })

  it('只设英文：英文在前 + 等宽尾兜底', () => {
    expect(buildFontStack('Segoe UI', null)).toBe(`"Segoe UI", ${FALLBACK_TAIL}`)
  })

  it('只设中文：中文在前 + 等宽尾兜底', () => {
    expect(buildFontStack(null, 'Microsoft YaHei')).toBe(`"Microsoft YaHei", ${FALLBACK_TAIL}`)
  })

  it('英文 + 中文：英文在前、中文次之、等宽尾最后（拉丁归英文、汉字归中文）', () => {
    expect(buildFontStack('Arial', 'SimSun')).toBe(`"Arial", "SimSun", ${FALLBACK_TAIL}`)
  })

  it('字体名内引号/分号被清洗，不破坏 CSS', () => {
    const stack = buildFontStack('Fo"o;Bar', 'B,a\\z')
    expect(stack).toContain('"FooBar"')
    expect(stack).toContain('"Baz"')
    // 清洗后不应残留裸引号/逗号破坏结构：整串恰为「英文, 中文, 等宽尾」三段引号包裹
    expect(stack).toBe(`"FooBar", "Baz", ${FALLBACK_TAIL}`)
  })
})

describe('isLikelyCjkFont 中文字体粗判', () => {
  it('常见中文字体命中', () => {
    for (const name of ['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', '宋体', '黑体', '思源黑体', '霞鹜文楷']) {
      expect(isLikelyCjkFont(name)).toBe(true)
    }
  })

  it('纯西文字体排除', () => {
    for (const name of ['Arial', 'Helvetica', 'Consolas', 'Segoe UI', 'Georgia', 'Times New Roman']) {
      expect(isLikelyCjkFont(name)).toBe(false)
    }
  })

  it('西文命名但含 CJK 变体的族不误伤（Noto Sans CJK 判为中文）', () => {
    expect(isLikelyCjkFont('Noto Sans CJK SC')).toBe(true)
    expect(isLikelyCjkFont('Source Han Sans')).toBe(true)
  })
})

describe('normalizeFontList 规范化分组', () => {
  it('大小写不敏感去重 + 过滤空白/非串', () => {
    const out = normalizeFontList(['Arial', 'arial', '  ', 'Georgia', ''] as string[], false)
    expect(out).toEqual(['Arial', 'Georgia'])
  })

  it('cjkFirst=false 按字母序', () => {
    const out = normalizeFontList(['SimSun', 'Arial', 'Georgia'], false)
    expect(out).toEqual(['Arial', 'Georgia', 'SimSun'])
  })

  it('cjkFirst=true 中文字体置顶、其余置后，组内各按字母序', () => {
    const out = normalizeFontList(['Arial', 'SimSun', 'Georgia', 'Microsoft YaHei'], true)
    // 中文组：Microsoft YaHei, SimSun；西文组：Arial, Georgia
    expect(out).toEqual(['Microsoft YaHei', 'SimSun', 'Arial', 'Georgia'])
  })
})
