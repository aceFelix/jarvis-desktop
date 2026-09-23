// @vitest-environment jsdom
/**
 * settingsStore + i18n 测试：主题/语言状态、localStorage 持久化、
 * <html data-theme> 落地、字典查键与插值回退。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { translate } from '@renderer/i18n'

beforeEach(() => {
  window.localStorage.clear()
  useSettingsStore.getState().setTheme('dark')
  useSettingsStore.getState().setLanguage('zh')
})

describe('settingsStore 主题/语言', () => {
  it('默认深色 + 中文', () => {
    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(useSettingsStore.getState().language).toBe('zh')
  })

  it('setTheme 应用到 <html data-theme> 并持久化 localStorage', () => {
    useSettingsStore.getState().setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ theme: 'light', language: 'zh' })
  })

  it('setLanguage 持久化并立即驱动 translate', () => {
    useSettingsStore.getState().setLanguage('en')
    expect(translate('chat.send')).toBe('Send')
    const raw = window.localStorage.getItem('jarvis-desktop-settings')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ theme: 'dark', language: 'en' })
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
