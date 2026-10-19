/**
 * 瞬态 UI 状态 store：右栏视图切换（信息面板 ⇄ 设置面板 ⇄ 管家服务面板 ⇄
 * 扩展服务面板）+ 管家服务按钮的一次性提示点。
 *
 * 设置面板（SettingsPanel）与管家服务面板（ButlerPanel）、扩展服务面板
 * （ExtensionPanel）都是独立组件，进入后整体替换右栏信息面板（App 按
 * `rightView` 条件渲染）；本 store 只持有视图枚举与切换动作，不持久化
 * （重启回信息面板是预期行为）。与 settingsStore 的分工：那里存设置值，
 * 这里存“看哪个视图”。
 *
 * `butlerHint`（阶段 9 W2 第 7 步）：后端投递「感知源首次引导」时置位，给
 * 标题栏「管家服务」按钮挂一个提示点，用户点进面板即清。**不持久化**：
 * 提示的效力在“告知”，重启后后端那份 consent 记录已写了“问过”，壳侧
 * 不需要也不应该自己存一份“还欠用户一个提醒”的状态。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

/**
 * 右栏视图：dashboard=任务中心/用量/指标/健康 信息面板；settings=设置面板；
 * butler=管家服务面板（邮箱服务 / 感知源）；extension=扩展服务面板
 * （MCP / 内置工具 / 技能 / 插件 / harness 五类集中管理）。
 */
export type RightView = 'dashboard' | 'settings' | 'butler' | 'extension'

interface UiState {
  rightView: RightView
  /** 管家服务按钮的一次性提示点（感知源首次引导到达时置 true）。 */
  butlerHint: boolean
  /** 标题栏齿轮按钮进入设置面板。 */
  openSettings: () => void
  /** 设置面板返回按钮回信息面板。 */
  closeSettings: () => void
  /** 标题栏「管家服务」按钮进入管家服务面板（同时清提示点）。 */
  openButler: () => void
  /** 管家服务面板返回按钮回信息面板。 */
  closeButler: () => void
  /** 收到感知源首次引导时点亮提示点（dispatcher 调用）。 */
  showButlerHint: () => void
  /** 清提示点（进入面板即清；用户看过就算告知到位）。 */
  clearButlerHint: () => void
  /** 标题栏「扩展服务」按钮进入扩展服务面板。 */
  openExtension: () => void
  /** 扩展服务面板返回按钮回信息面板。 */
  closeExtension: () => void
}

export const useUiStore = create<UiState>((set) => ({
  rightView: 'dashboard',
  butlerHint: false,
  openSettings: () => set({ rightView: 'settings' }),
  closeSettings: () => set({ rightView: 'dashboard' }),
  // 进面板即清提示：提示点只是“这里有你没看过的东西”，不是未读计数
  openButler: () => set({ rightView: 'butler', butlerHint: false }),
  closeButler: () => set({ rightView: 'dashboard' }),
  showButlerHint: () => set({ butlerHint: true }),
  clearButlerHint: () => set({ butlerHint: false }),
  openExtension: () => set({ rightView: 'extension' }),
  closeExtension: () => set({ rightView: 'dashboard' })
}))
