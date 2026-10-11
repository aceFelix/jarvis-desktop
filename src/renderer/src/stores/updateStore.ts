/**
 * 自动更新 store —— 主进程 UpdateStatus 推送在渲染层的镜像。
 *
 * 状态机（镜像主进程 update.ts 的事件映射）：
 * idle=无更新/未检查 / available=有新版本（标题栏显示「更新」按钮）/
 * downloading=下载中（percent 进度）/ downloaded=已下载（显示「重启安装」）/
 * error=出错（回退为可重试的「更新」）。
 *
 * 仅承载状态；下载/安装动作经 preload 暴露的 IPC 直接触发（无中间状态）。
 * @author aceFelix
 */

import { create } from 'zustand'
import type { UpdateStatusEvent } from '../../../shared/contracts'

/** 更新状态（与主进程 UpdateStatusEvent.state 同口径）。 */
export type UpdateState = UpdateStatusEvent['state']

export interface UpdateStoreState {
  /** 当前状态。 */
  state: UpdateState
  /** 新版本号（available/downloading/downloaded/error 保留；idle 清空）。 */
  version: string
  /** 下载进度百分比 0-100。 */
  percent: number
  /** 错误信息（error 时非空，仅诊断用）。 */
  error: string
  /** 主进程状态推送入口（App 订阅 onUpdateStatus 后转发进来）。 */
  setStatus: (e: UpdateStatusEvent) => void
}

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  state: 'idle',
  version: '',
  percent: 0,
  error: '',
  setStatus: (e) =>
    set((prev) => ({
      state: e.state,
      // idle 表示无更新：清空版本号；其余状态沿用推送值或上次值（error 保留便于重试提示）
      version: e.version ?? (e.state === 'idle' ? '' : prev.version),
      // 仅下载中累积进度；切换到其它状态时归零
      percent: e.state === 'downloading' ? (e.percent ?? prev.percent) : 0,
      error: e.error ?? ''
    }))
}))
