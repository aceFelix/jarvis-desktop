/**
 * 右栏数据 store —— 任务中心 / 会话用量 / 运行健康的集中状态。
 *
 * 数据源（serve 协议，backendStore 刷新动作写入）：
 * - schedule.list → reminders（待触发提醒）+ deadlines（活跃截止日期）；
 * - cost.get → 会话 token 累计 / 对话轮数 / 消息条数；
 * - state.get → mcp 连接快照；
 * - proactive_notify → latestBriefing（最近一条简报原文）；
 * - 各事件日志 → logs（滚动 30 条，运行健康日志流）。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

/** 待触发提醒（schedule.list reminders 元素，镜像 serve/server.py 字段口径）。 */
export interface ReminderItem {
  id: string
  content: string
  trigger_at: string
  repeat: string
}

/** 活跃截止日期（schedule.list deadlines 元素；days_left 负数=已逾期）。 */
export interface DeadlineItem {
  id: string
  title: string
  due_date: string
  days_left: number | null
  status: string
}

/** 会话用量统计（cost.get result，与 api.get_cost 同构）。 */
export interface CostInfo {
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  dialogs: number
  messages: number
}

/** MCP 连接快照（state.get mcp 键；null=MCP 未启用/未装配）。 */
export interface McpStatus {
  connected: string[]
  failed: string[]
  tools: number
}

/** 日志流保留上限（运行健康区块滚动展示最近 N 条）。 */
const MAX_LOG_LINES = 30

export interface RightState {
  reminders: ReminderItem[]
  deadlines: DeadlineItem[]
  /** 最近一条每日简报原文（proactive_notify kind=briefing 时更新）。 */
  latestBriefing: string
  cost: CostInfo | null
  mcp: McpStatus | null
  /** 运行日志（最新在末尾，渲染时倒序）。 */
  logs: string[]

  setSchedule: (reminders: ReminderItem[], deadlines: DeadlineItem[]) => void
  setBriefing: (text: string) => void
  setCost: (cost: CostInfo) => void
  setMcp: (mcp: McpStatus | null) => void
  /** 追加一行日志（自动带 HH:MM:SS 前缀，超出上限裁 oldest）。 */
  pushLog: (line: string) => void
}

export const useRightStore = create<RightState>((set) => ({
  reminders: [],
  deadlines: [],
  latestBriefing: '',
  cost: null,
  mcp: null,
  logs: [],

  setSchedule: (reminders, deadlines) => set({ reminders, deadlines }),
  setBriefing: (text) => set({ latestBriefing: text }),
  setCost: (cost) => set({ cost }),
  setMcp: (mcp) => set({ mcp }),

  pushLog: (line) =>
    set((s) => {
      const ts = new Date().toTimeString().slice(0, 8)
      const next = [...s.logs, `${ts} ${line}`]
      // 滚动窗口：只留最近 N 条，防长会话无限增长
      return { logs: next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next }
    })
}))
