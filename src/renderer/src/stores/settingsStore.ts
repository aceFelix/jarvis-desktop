/**
 * 桌面壳设置：本地偏好（主题/语言）+ 后端联动设置镜像（backendSettings）。
 *
 * 本地偏好纯渲染层，不走后端指令：
 * - localStorage 持久化（键 jarvis-desktop-settings），写入失败时静默降级为
 *   会话内生效（隐私模式等场景）；
 * - 主题默认复古=荧光绿（首启/无持久化/非法值时回退），经 <html data-theme="..."> 落地，
 *   三张皮肤覆盖块（theme-retro / theme-dark-y2k / theme-light-y2k）依此生效；
 * - 字体（英文/中文各自单设）为本地偏好，经 <html style="--app-font"> CSS 变量落地，
 *   皮肤 body 以 var(--app-font, <等宽栈>) 引用；两者皆未选则不写变量→回落主题默认；
 * - 语言经 i18n.ts 的 useT() 驱动静态文案切换。
 *
 * 后端联动设置（backendSettings，第一批：主动播报 TTS/简报/截止日期/
 * TTS 音量语速）不进 localStorage：真源在 jarvis 侧 settings.toml，经
 * settings.get/set 指令读写（backendStore 接线）；单键 null = 尚未拉取/
 * 后端未连接（设置面板据此显示离线态）。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { BackendSettings, BackendSettingKey } from '../../../shared/contracts'
import { buildFontStack } from '../lib/fontUtils'

export type Theme = 'dark' | 'light' | 'retro'
export type Language = 'zh' | 'en'

const STORAGE_KEY = 'jarvis-desktop-settings'

/** 首启默认主题：复古即荧光绿（无持久化/非法值时的回退值）；设置面板按钮序亦荧光绿排第一。 */
const DEFAULT_THEME: Theme = 'retro'

/** 后端联动设置的初始镜像：全键 null（未拉取态）。 */
export const EMPTY_BACKEND_SETTINGS: BackendSettings = {
  proactive_tts_enabled: null,
  briefing_enabled: null,
  briefing_time: null,
  deadline_enabled: null,
  deadline_check_time: null,
  tts_volume: null,
  tts_speech_rate: null
}

interface SettingsState {
  theme: Theme
  language: Language
  /** 英文/拉丁 UI 字体族名（null=未选，回落主题默认）。 */
  fontLatin: string | null
  /** 中文字体族名（null=未选，回落主题默认）。 */
  fontCjk: string | null
  /** 后端联动设置镜像（真源在 jarvis settings.toml；单键 null=未拉取/未连接）。 */
  backendSettings: BackendSettings
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  /** 设置英文字体（空串归一为 null）；即时落地 --app-font + 持久化。 */
  setFontLatin: (font: string | null) => void
  /** 设置中文字体（空串归一为 null）；即时落地 --app-font + 持久化。 */
  setFontCjk: (font: string | null) => void
  /** 局部合并后端设置镜像（settings.get 回填 / settings.set 乐观更新与回滚）。 */
  applyBackendSettings: (patch: Partial<BackendSettings>) => void
  /** 单键置 null（回滚到未拉取态，离线场景用）。 */
  clearBackendSetting: (key: BackendSettingKey) => void
}

/** 可持久化快照：仅本地偏好（后端联动镜像不落盘，真源在 jarvis settings.toml）。 */
type PersistedPrefs = { theme: Theme; language: Language; fontLatin: string | null; fontCjk: string | null }

/** 从完整 state 抽出可持久化字段（避免把 backendSettings/方法写进 localStorage）。 */
function toPrefs(s: SettingsState): PersistedPrefs {
  return { theme: s.theme, language: s.language, fontLatin: s.fontLatin, fontCjk: s.fontCjk }
}

/** 读取 localStorage 里的持久化设置（异常/缺字段/非法值时回退默认；用户显式选择优先）。 */
function loadPersisted(): PersistedPrefs {
  const fallback: PersistedPrefs = { theme: DEFAULT_THEME, language: 'zh', fontLatin: null, fontCjk: null }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<{
      theme: Theme
      language: Language
      fontLatin: string
      fontCjk: string
    }>
    // 字体：仅保留非空字符串，其余（null/空/非字符串/脏空白）一律归一为未选
    const asFont = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null
    return {
      theme:
        parsed.theme === 'dark' || parsed.theme === 'light' || parsed.theme === 'retro'
          ? parsed.theme
          : DEFAULT_THEME,
      language: parsed.language === 'en' ? 'en' : 'zh',
      fontLatin: asFont(parsed.fontLatin),
      fontCjk: asFont(parsed.fontCjk)
    }
  } catch {
    return fallback
  }
}

/** 写回 localStorage（失败静默：设置仍在当前会话内生效）。 */
function persist(prefs: PersistedPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 隐私模式/配额满等写失败场景静默降级 */
  }
}

/** 主题落地：<html data-theme="...">，三张皮肤覆盖块（theme-retro / theme-dark-y2k / theme-light-y2k）依此选择器生效。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/**
 * 字体落地：把英文/中文自选字体拼成有序栈写到 <html> 的 --app-font CSS 变量。
 * 两者皆未选时清除变量，皮肤 body 的 var(--app-font, <等宽栈>) 即回落主题默认。
 *
 * @author aceFelix
 */
export function applyFont(latin: string | null, cjk: string | null): void {
  const stack = buildFontStack(latin, cjk)
  const root = document.documentElement
  if (stack) root.style.setProperty('--app-font', stack)
  else root.style.removeProperty('--app-font')
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadPersisted(),
  backendSettings: { ...EMPTY_BACKEND_SETTINGS },

  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    persist(toPrefs(get()))
  },

  setLanguage: (language) => {
    set({ language })
    persist(toPrefs(get()))
  },

  setFontLatin: (font) => {
    const fontLatin = font && font.trim() ? font.trim() : null
    set({ fontLatin })
    applyFont(fontLatin, get().fontCjk)
    persist(toPrefs(get()))
  },

  setFontCjk: (font) => {
    const fontCjk = font && font.trim() ? font.trim() : null
    set({ fontCjk })
    applyFont(get().fontLatin, fontCjk)
    persist(toPrefs(get()))
  },

  applyBackendSettings: (patch) => {
    set({ backendSettings: { ...get().backendSettings, ...patch } })
  },

  clearBackendSetting: (key) => {
    set({ backendSettings: { ...get().backendSettings, [key]: null } })
  }
}))

// 模块加载即应用一次主题与字体：刷新/重启后保持用户上次选择。
applyTheme(useSettingsStore.getState().theme)
applyFont(useSettingsStore.getState().fontLatin, useSettingsStore.getState().fontCjk)
