/**
 * Glyph 符号系统：界面图标符号随主题切换（三套 ASCII 括号牌：方/尖/花）。
 *
 * 三张映射表键集合完全一致（三主题同风格仅配色不同，符号均为 ASCII 括号牌）：
 * - RETRO：荧光绿主题的方括号牌（[TXT] [LIV]…），纯 ASCII 终端味；
 * - Y2K：电光蓝主题的尖括号牌（<TXT> <LIV>…），纯 ASCII 赛博味；
 * - SILVER：金属银主题的花括号牌（{TXT} {LIV}…），纯 ASCII 铬银味。
 *   三表同属括号牌体系、仅括号形变不同——三主题视觉身份呼应。
 *
 * i18n 文案已剥离 emoji 前缀只留纯文字，组件侧用 `{g.xxx} {t(key)}` 组合，
 * 符号与文案解耦——切主题自动重渲染，无需 CSS 参与。
 *
 * @author aceFelix
 */

import { useSettingsStore, type Theme } from './stores/settingsStore'

/** 界面符号名清单（与 i18n 剥前缀的键及组件字面量一一对应）。 */
export type GlyphName =
  | 'modeText'
  | 'modeTalk'
  | 'modeVoice'
  | 'panelHistory'
  | 'panelModel'
  | 'panelVoice'
  | 'talkActive'
  | 'voiceActive'
  | 'interrupt'
  | 'copy'
  | 'sessionDelete'
  | 'attach'
  | 'capture'
  | 'fileChip'
  | 'settings'
  | 'taskReminder'
  | 'taskDeadline'

export type GlyphTable = Record<GlyphName, string>

/** 金属银（浅色 Y2K 像素皮肤）主题：花括号牌（纯 ASCII），铬银味，与方/尖括号牌同体系呼应。 */
export const SILVER: GlyphTable = {
  modeText: '{TXT}',
  modeTalk: '{LIV}',
  modeVoice: '{VOX}',
  panelHistory: '{HIS}',
  panelModel: '{MOD}',
  panelVoice: '{VOC}',
  talkActive: '{LIV}',
  voiceActive: '{VOX}',
  interrupt: '{BRK}',
  copy: '{CPY}',
  sessionDelete: '{DEL}',
  attach: '{ATT}',
  capture: '{CAP}',
  fileChip: '{FIL}',
  settings: '{SET}',
  taskReminder: '{REM}',
  taskDeadline: '{DUE}'
}

/** 电光蓝（深色 Y2K 像素皮肤）主题：尖括号牌（纯 ASCII），与荧光绿方括号牌同体系呼应。 */
export const Y2K: GlyphTable = {
  modeText: '<TXT>',
  modeTalk: '<LIV>',
  modeVoice: '<VOX>',
  panelHistory: '<HIS>',
  panelModel: '<MOD>',
  panelVoice: '<VOC>',
  talkActive: '<LIV>',
  voiceActive: '<VOX>',
  interrupt: '<BRK>',
  copy: '<CPY>',
  sessionDelete: '<DEL>',
  attach: '<ATT>',
  capture: '<CAP>',
  fileChip: '<FIL>',
  settings: '<SET>',
  taskReminder: '<REM>',
  taskDeadline: '<DUE>'
}

/** 荧光绿（复古 CRT）主题：终端风三字符方括号牌（纯 ASCII）。 */
export const RETRO: GlyphTable = {
  modeText: '[TXT]',
  modeTalk: '[LIV]',
  modeVoice: '[VOX]',
  panelHistory: '[HIS]',
  panelModel: '[MOD]',
  panelVoice: '[VOC]',
  talkActive: '[LIV]',
  voiceActive: '[VOX]',
  interrupt: '[BRK]',
  copy: '[CPY]',
  sessionDelete: '[DEL]',
  attach: '[ATT]',
  capture: '[CAP]',
  fileChip: '[FIL]',
  settings: '[SET]',
  taskReminder: '[REM]',
  taskDeadline: '[DUE]'
}

/** 按主题取符号表（retro → 方括号牌，dark → 尖括号牌，light → 花括号牌）。 */
export function glyphsFor(theme: Theme): GlyphTable {
  if (theme === 'retro') return RETRO
  if (theme === 'dark') return Y2K
  return SILVER
}

/** 组件内符号 hook：订阅主题变化，切主题自动重渲染。 */
export function useGlyphs(): GlyphTable {
  const theme = useSettingsStore((s) => s.theme)
  return glyphsFor(theme)
}
