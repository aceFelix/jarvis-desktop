/**
 * 瞬态 UI 状态 store：右栏视图切换（信息面板 ⇄ 设置面板）。
 *
 * 设置面板是独立组件（SettingsPanel），进入后整体替换右栏信息面板
 * （RightSidebar），由 App 按 rightView 条件渲染；本 store 只持有视图
 * 枚举与两个切换动作，不持久化（重启回信息面板是预期行为）。
 * 与 settingsStore 的分工：那里存设置值，这里存"看哪个视图"。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

/** 右栏视图：dashboard=任务中心/用量/指标/健康 信息面板；settings=设置面板。 */
export type RightView = 'dashboard' | 'settings'

interface UiState {
  rightView: RightView
  /** 标题栏齿轮按钮进入设置面板。 */
  openSettings: () => void
  /** 设置面板返回按钮回信息面板。 */
  closeSettings: () => void
}

export const useUiStore = create<UiState>((set) => ({
  rightView: 'dashboard',
  openSettings: () => set({ rightView: 'settings' }),
  closeSettings: () => set({ rightView: 'dashboard' })
}))
