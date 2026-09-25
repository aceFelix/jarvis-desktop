/**
 * 桌面壳设置：本地偏好（主题/语言）+ 后端联动设置镜像（backendSettings）。
 *
 * 本地偏好纯渲染层，不走后端指令：
 * - localStorage 持久化（键 jarvis-desktop-settings），写入失败时静默降级为
 *   会话内生效（隐私模式等场景）；
 * - 主题默认复古（首启/无持久化/非法值时回退），经 <html data-theme="..."> 落地，
 *   main.css 末尾的浅色覆盖块与 theme-retro.css 的复古覆盖块依此生效；
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

export type Theme = 'dark' | 'light' | 'retro'
export type Language = 'zh' | 'en'

const STORAGE_KEY = 'jarvis-desktop-settings'

/** 首启默认主题：复古（无持久化/非法值时的回退值）。 */
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
  /** 后端联动设置镜像（真源在 jarvis settings.toml；单键 null=未拉取/未连接）。 */
  backendSettings: BackendSettings
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  /** 局部合并后端设置镜像（settings.get 回填 / settings.set 乐观更新与回滚）。 */
  applyBackendSettings: (patch: Partial<BackendSettings>) => void
  /** 单键置 null（回滚到未拉取态，离线场景用）。 */
  clearBackendSetting: (key: BackendSettingKey) => void
}

/** 读取 localStorage 里的持久化设置（异常/缺字段/非法值时回退默认；用户显式选择优先）。 */
function loadPersisted(): { theme: Theme; language: Language } {
  const fallback = { theme: DEFAULT_THEME, language: 'zh' as Language }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<{ theme: Theme; language: Language }>
    return {
      theme:
        parsed.theme === 'dark' || parsed.theme === 'light' || parsed.theme === 'retro'
          ? parsed.theme
          : DEFAULT_THEME,
      language: parsed.language === 'en' ? 'en' : 'zh'
    }
  } catch {
    return fallback
  }
}

/** 写回 localStorage（失败静默：设置仍在当前会话内生效）。 */
function persist(theme: Theme, language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, language }))
  } catch {
    /* 隐私模式/配额满等写失败场景静默降级 */
  }
}

/** 主题落地：<html data-theme="...">，浅色覆盖块（main.css）与复古覆盖块（theme-retro.css）依此选择器生效。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadPersisted(),
  backendSettings: { ...EMPTY_BACKEND_SETTINGS },

  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    persist(theme, get().language)
  },

  setLanguage: (language) => {
    set({ language })
    persist(get().theme, language)
  },

  applyBackendSettings: (patch) => {
    set({ backendSettings: { ...get().backendSettings, ...patch } })
  },

  clearBackendSetting: (key) => {
    set({ backendSettings: { ...get().backendSettings, [key]: null } })
  }
}))

// 模块加载即应用一次主题：刷新/重启后保持用户上次选择。
applyTheme(useSettingsStore.getState().theme)
