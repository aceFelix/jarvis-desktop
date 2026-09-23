/**
 * 桌面壳本地设置：主题（深色/浅色）与界面语言（中文/English）。
 *
 * 纯渲染层偏好，不走后端指令：
 * - localStorage 持久化（键 jarvis-desktop-settings），写入失败时静默降级为
 *   会话内生效（隐私模式等场景）；
 * - 主题经 <html data-theme="..."> 落地，main.css 末尾的浅色覆盖块依此生效；
 * - 语言经 i18n.ts 的 useT() 驱动静态文案切换。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

export type Theme = 'dark' | 'light'
export type Language = 'zh' | 'en'

const STORAGE_KEY = 'jarvis-desktop-settings'

interface SettingsState {
  theme: Theme
  language: Language
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
}

/** 读取 localStorage 里的持久化设置（异常/缺字段/非法值时回退默认）。 */
function loadPersisted(): { theme: Theme; language: Language } {
  const fallback = { theme: 'dark' as Theme, language: 'zh' as Language }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<{ theme: Theme; language: Language }>
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
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

/** 主题落地：<html data-theme="...">，main.css 浅色覆盖块依此选择器生效。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadPersisted(),

  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    persist(theme, get().language)
  },

  setLanguage: (language) => {
    set({ language })
    persist(get().theme, language)
  }
}))

// 模块加载即应用一次主题：刷新/重启后保持用户上次选择。
applyTheme(useSettingsStore.getState().theme)
