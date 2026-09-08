/**
 * 右栏指标 store —— CPU / 内存 / 磁盘（metrics 事件每 2 秒推送）。
 *
 * payload 结构与 agent/ui/workbench/metrics.collect_metrics 同构：
 * `{cpu: number, memory: {percent, used_gb, total_gb}, disk: {...}}`
 *
 * @author aceFelix
 */

import { create } from 'zustand'

export interface MetricDetail {
  percent: number
  used_gb?: number
  total_gb?: number
}

export interface MetricsPayload {
  cpu?: number
  memory?: MetricDetail
  disk?: MetricDetail
}

export interface MetricsState {
  cpu: number
  memory: MetricDetail | null
  disk: MetricDetail | null
  update: (payload: MetricsPayload) => void
}

export const useMetricsStore = create<MetricsState>((set) => ({
  cpu: 0,
  memory: null,
  disk: null,
  update: (payload) =>
    set({
      cpu: payload.cpu ?? 0,
      memory: payload.memory ?? null,
      disk: payload.disk ?? null
    })
}))
