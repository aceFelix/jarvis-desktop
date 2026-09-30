// @vitest-environment jsdom
/**
 * settingsStore + i18n 测试：主题/语言状态、localStorage 持久化、
 * <html data-theme> 落地、字典查键与插值回退。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EMPTY_BACKEND_SETTINGS, useSettingsStore } from '@renderer/stores/settingsStore'
import { FALLBACK_TAIL } from '@renderer/lib/fontUtils'
import { parseBackendSettings } from '../../src/shared/contracts'
import { translate } from '@renderer/i18n'

beforeEach(() => {
  window.localStorage.clear()
  useSettingsStore.getState().setTheme('dark')
  useSettingsStore.getState().setLanguage('zh')
  useSettingsStore.getState().setFontLatin(null)
  useSettingsStore.getState().setFontCjk(null)
  useSettingsStore.setState({ backendSettings: { ...EMPTY_BACKEND_SETTINGS } })
})

describe('settingsStore 主题/语言', () => {
  it('首启默认复古 + 中文（无持久化/非法值均回退 retro）', async () => {
    // 重置模块注册表重新加载：store 初始值来自 loadPersisted 的回退路径
    vi.resetModules()
    window.localStorage.clear()
    const fresh = await import('@renderer/stores/settingsStore')
    expect(fresh.useSettingsStore.getState().theme).toBe('retro')
    expect(fresh.useSettingsStore.getState().language).toBe('zh')
    // 非法持久化值同样回退默认，不落到 dark
    window.localStorage.setItem('jarvis-desktop-settings', JSON.stringify({ theme: 'nonsense' }))
    vi.resetModules()
    const again = await import('@renderer/stores/settingsStore')
    expect(again.useSettingsStore.getState().theme).toBe('retro')
  })

  it('setTheme 应用到 <html data-theme> 并持久化 localStorage', () => {
    useSettingsStore.getState().setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ theme: 'light', language: 'zh' })
  })

  it('setTheme(retro) 写 <html data-theme=retro> 并持久化', () => {
    useSettingsStore.getState().setTheme('retro')
    expect(document.documentElement.dataset.theme).toBe('retro')
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ theme: 'retro', language: 'zh' })
  })

  it('setLanguage 持久化并立即驱动 translate', () => {
    useSettingsStore.getState().setLanguage('en')
    expect(translate('chat.send')).toBe('Send')
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ theme: 'dark', language: 'en' })
  })
})

describe('settingsStore 字体偏好', () => {
  it('setFontLatin 写 --app-font CSS 变量并持久化（英文在前 + 等宽尾）', () => {
    useSettingsStore.getState().setFontLatin('Arial')
    expect(useSettingsStore.getState().fontLatin).toBe('Arial')
    expect(document.documentElement.style.getPropertyValue('--app-font')).toBe(`"Arial", ${FALLBACK_TAIL}`)
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ fontLatin: 'Arial', fontCjk: null })
  })

  it('英文 + 中文组合：栈内英文在前、中文次之', () => {
    useSettingsStore.getState().setFontLatin('Segoe UI')
    useSettingsStore.getState().setFontCjk('Microsoft YaHei')
    expect(document.documentElement.style.getPropertyValue('--app-font')).toBe(
      `"Segoe UI", "Microsoft YaHei", ${FALLBACK_TAIL}`
    )
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ fontLatin: 'Segoe UI', fontCjk: 'Microsoft YaHei' })
  })

  it('清空字体（传空/null）：归一为 null 并移除 --app-font 变量（回落主题默认）', () => {
    useSettingsStore.getState().setFontCjk('SimSun')
    expect(document.documentElement.style.getPropertyValue('--app-font')).not.toBe('')
    useSettingsStore.getState().setFontCjk('')
    expect(useSettingsStore.getState().fontCjk).toBe(null)
    // 另一个也已 null（初始），整体应清除变量
    useSettingsStore.getState().setFontLatin(null)
    expect(document.documentElement.style.getPropertyValue('--app-font')).toBe('')
  })

  it('loadPersisted 非法字体值归一为 null（脏空白/非串）', async () => {
    window.localStorage.setItem(
      'jarvis-desktop-settings',
      JSON.stringify({ theme: 'dark', language: 'zh', fontLatin: '   ', fontCjk: 123 })
    )
    vi.resetModules()
    const fresh = await import('@renderer/stores/settingsStore')
    expect(fresh.useSettingsStore.getState().fontLatin).toBe(null)
    expect(fresh.useSettingsStore.getState().fontCjk).toBe(null)
  })
})

describe('settingsStore 后端联动镜像 backendSettings', () => {
  it('applyBackendSettings 局部合并，不进 localStorage（真源在 jarvis settings.toml）', () => {
    useSettingsStore.getState().applyBackendSettings({ proactive_tts_enabled: true, tts_volume: 80 })
    const s = useSettingsStore.getState().backendSettings
    expect(s.proactive_tts_enabled).toBe(true)
    expect(s.tts_volume).toBe(80)
    expect(s.briefing_time).toBe(null) // 未触及的键保持未拉取态
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(raw === null || !raw.includes('backendSettings')).toBe(true)
  })

  it('clearBackendSetting 单键回到未拉取态（回滚离线场景）', () => {
    useSettingsStore.getState().applyBackendSettings({ briefing_enabled: true })
    useSettingsStore.getState().clearBackendSetting('briefing_enabled')
    expect(useSettingsStore.getState().backendSettings.briefing_enabled).toBe(null)
  })

  it('parseBackendSettings 宽容解析：全键回填，类型不符/缺字段置 null', () => {
    const full = parseBackendSettings({
      proactive_tts_enabled: false,
      briefing_enabled: true,
      briefing_time: '07:15',
      deadline_enabled: true,
      deadline_check_time: '21:00',
      tts_volume: 60,
      tts_speech_rate: 1.25
    })
    expect(full).toEqual({
      proactive_tts_enabled: false,
      briefing_enabled: true,
      briefing_time: '07:15',
      deadline_enabled: true,
      deadline_check_time: '21:00',
      tts_volume: 60,
      tts_speech_rate: 1.25
    })
    // 旧版后端只回 proactive_tts_enabled / 脏数据类型不符 → 其余键 null 显离线态
    const partial = parseBackendSettings({ proactive_tts_enabled: true, tts_volume: '50' })
    expect(partial.proactive_tts_enabled).toBe(true)
    expect(partial.tts_volume).toBe(null)
    expect(partial.briefing_time).toBe(null)
    expect(parseBackendSettings(null)).toEqual({ ...EMPTY_BACKEND_SETTINGS })
  })
})

describe('i18n 字典查键', () => {
  it('模板插值：{n} 替换为入参', () => {
    expect(translate('right.daysLeft', { n: 3 })).toBe('还剩 3 天')
  })

  it('缺参时保留占位符原样（不渲染空串）', () => {
    expect(translate('right.daysLeft')).toBe('还剩 {n} 天')
  })

  it('缺键回退键名；英文缺键回退中文', () => {
    expect(translate('no.such.key')).toBe('no.such.key')
    useSettingsStore.getState().setLanguage('en')
    expect(translate('chat.send')).toBe('Send')
    expect(translate('no.such.key')).toBe('no.such.key')
  })
})
