/**
 * Glyph 符号系统：界面图标符号随主题切换（emoji ↔ 终端风 ASCII 括号牌）。
 *
 * 两张映射表键集合完全一致：
 * - EMOJI：深色/浅色主题沿用原界面 emoji（💬🎙️📎…）；
 * - RETRO：复古主题的三字符括号牌（[TXT] [LIV] [ATT]…），纯 ASCII 终端味。
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

/** 深色/浅色主题：与原界面逐字一致的 emoji。 */
export const EMOJI: GlyphTable = {
  modeText: '💬',
  modeTalk: '🎙️',
  modeVoice: '🎤',
  panelHistory: '📜',
  panelModel: '🤖',
  panelVoice: '🎵',
  talkActive: '🎙️',
  voiceActive: '🎤',
  interrupt: '✋',
  copy: '📋',
  sessionDelete: '🗑️',
  attach: '📎',
  capture: '📸',
  fileChip: '📄',
  settings: '⚙',
  taskReminder: '⏰',
  taskDeadline: '📋'
}

/** 复古主题：终端风三字符括号牌（纯 ASCII）。 */
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

/** 按主题取符号表（retro → ASCII 括号牌，其余 → emoji）。 */
export function glyphsFor(theme: Theme): GlyphTable {
  return theme === 'retro' ? RETRO : EMOJI
}

/** 组件内符号 hook：订阅主题变化，切主题自动重渲染。 */
export function useGlyphs(): GlyphTable {
  const theme = useSettingsStore((s) => s.theme)
  return glyphsFor(theme)
}
