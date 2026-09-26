// @vitest-environment jsdom
/**
 * glyphs 符号系统测试：主题→符号表映射、三表纯 ASCII 括号牌、三表键集合一致。
 *
 * 环境说明：glyphs.ts 经 settingsStore 在模块加载即写 <html data-theme>（触 document），
 * 故用 jsdom 而非 node 环境。被测的 glyphsFor/SILVER/Y2K/RETRO 本身是纯数据。
 *
 * @author aceFelix
 */

import { describe, it, expect } from 'vitest'
import { SILVER, Y2K, RETRO, glyphsFor, type GlyphName } from '@renderer/glyphs'

describe('glyphs 符号系统', () => {
  it('glyphsFor：retro 返 RETRO 表，dark 返 Y2K 表，light 返 SILVER 表', () => {
    expect(glyphsFor('retro')).toBe(RETRO)
    expect(glyphsFor('dark')).toBe(Y2K)
    expect(glyphsFor('light')).toBe(SILVER)
  })

  it('SILVER / Y2K / RETRO 三表全为纯 ASCII 括号牌（无 emoji）', () => {
    // eslint-disable-next-line no-control-regex
    const asciiOnly = /^[\x20-\x7E]+$/
    for (const value of [...Object.values(RETRO), ...Object.values(Y2K), ...Object.values(SILVER)]) {
      expect(asciiOnly.test(value)).toBe(true)
    }
  })

  it('SILVER / Y2K / RETRO 三表键集合完全一致', () => {
    const silverKeys = Object.keys(SILVER).sort()
    expect(Object.keys(Y2K).sort()).toEqual(silverKeys)
    expect(Object.keys(RETRO).sort()).toEqual(silverKeys)
    // 且每个键在三表都有非空值
    for (const key of silverKeys as GlyphName[]) {
      expect(SILVER[key].length).toBeGreaterThan(0)
      expect(Y2K[key].length).toBeGreaterThan(0)
      expect(RETRO[key].length).toBeGreaterThan(0)
    }
  })
})
