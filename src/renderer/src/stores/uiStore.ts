/**
 * 瞬态 UI 状态 store：右栏视图切换（信息面板 ⇄ 设置面板 ⇄ 管家服务面板 ⇄
 * 扩展服务面板）。
 *
 * 设置面板（SettingsPanel）与管家服务面板（ButlerPanel）、扩展服务面板
 * （ExtensionPanel）都是独立组件，进入后整体替换右栏信息面板（RightSidebar），
 * 由 App 按 rightView 条件渲染；本 store 只持有视图枚举与切换动作，不持久化
 * （重启回信息面板是预期行为）。与 settingsStore 的分工：那里存设置值，
 * 这里存"看哪个视图"。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

/**
 * 右栏视图：dashboard=任务中心/用量/指标/健康 信息面板；settings=设置面板；
 * butler=管家服务面板（首期含邮件发送表单）；extension=扩展服务面板
 * （MCP / 内置工具 / 技能 / 插件 / harness 五类集中管理）。
 */
export type RightView = 'dashboard' | 'settings' | 'butler' | 'extension'

interface UiState {
  rightView: RightView
  /** 标题栏齿轮按钮进入设置面板。 */
  openSettings: () => void
  /** 设置面板返回按钮回信息面板。 */
  closeSettings: () => void
  /** 标题栏「管家服务」按钮进入管家服务面板。 */
  openButler: () => void
  /** 管家服务面板返回按钮回信息面板。 */
  closeButler: () => void
  /** 标题栏「扩展服务」按钮进入扩展服务面板。 */
  openExtension: () => void
  /** 扩展服务面板返回按钮回信息面板。 */
  closeExtension: () => void
}

export const useUiStore = create<UiState>((set) => ({
  rightView: 'dashboard',
  openSettings: () => set({ rightView: 'settings' }),
  closeSettings: () => set({ rightView: 'dashboard' }),
  openButler: () => set({ rightView: 'butler' }),
  closeButler: () => set({ rightView: 'dashboard' }),
  openExtension: () => set({ rightView: 'extension' }),
  closeExtension: () => set({ rightView: 'dashboard' })
}))
