// @vitest-environment jsdom
/**
 * glyphs 符号系统测试：主题→符号表映射、RETRO 表纯 ASCII、两表键集合一致。
 *
 * 环境说明：glyphs.ts 经 settingsStore 在模块加载即写 <html data-theme>（触 document），
 * 故用 jsdom 而非 node 环境。被测的 glyphsFor/EMOJI/RETRO 本身是纯数据。
 *
 * @author aceFelix
 */

import { describe, it, expect } from 'vitest'
import { EMOJI, RETRO, glyphsFor, type GlyphName } from '@renderer/glyphs'

describe('glyphs 符号系统', () => {
  it('glyphsFor：retro 返 RETRO 表，dark/light 返 EMOJI 表', () => {
    expect(glyphsFor('retro')).toBe(RETRO)
    expect(glyphsFor('dark')).toBe(EMOJI)
    expect(glyphsFor('light')).toBe(EMOJI)
  })

  it('RETRO 表全为纯 ASCII（无 emoji），终端风括号牌', () => {
    // eslint-disable-next-line no-control-regex
    const asciiOnly = /^[\x20-\x7E]+$/
    for (const value of Object.values(RETRO)) {
      expect(asciiOnly.test(value)).toBe(true)
    }
  })

  it('EMOJI 与 RETRO 两表键集合完全一致', () => {
    const emojiKeys = Object.keys(EMOJI).sort()
    const retroKeys = Object.keys(RETRO).sort()
    expect(retroKeys).toEqual(emojiKeys)
    // 且每个键在两表都有非空值
    for (const key of emojiKeys as GlyphName[]) {
      expect(EMOJI[key].length).toBeGreaterThan(0)
      expect(RETRO[key].length).toBeGreaterThan(0)
    }
  })
})
