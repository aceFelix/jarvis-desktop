/**
 * 代理团队（多 Agent 协作）状态 store —— 右栏「代理团队」区块的数据与交互态。
 *
 * 职责边界（aceFelix，2026-11）：只装**后端快照 + 面板交互态**，不装业务规则。
 * 状态机、谁在跑、能不能停全由 jarvis 侧 `agent/collaboration/activity.py` 与
 * `agent/serve/rpc_agents.py` 决定；动作层（`agentsActions.ts`）只做参数搬运。
 *
 * 刷新时机：
 * - `init` 事件与面板挂载 → `refreshAgents()`（一次 WS 往返拿全量快照）；
 * - 后端活动台账变更 → `agents_state` 事件整份替换（不做增量合并，避免
 *   两套真相在面板里打架）；
 * - 断开连接 → `resetAll()` 清空，防止对不存在的代理点「停止」。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { AgentsSnapshot } from '../../../shared/agents-contracts'

/** 面板内联反馈（成功/失败都显示在面板里，绝不写进聊天流）。 */
export interface AgentsNotice {
  text: string
  tone: 'ok' | 'warn'
}

export interface AgentsState {
  /** 最近一次快照（null = 还没拉到/未连接）。 */
  snapshot: AgentsSnapshot | null
  /** 控制动作在途（按钮统一置灰，避免连点重复发送）。 */
  busy: boolean
  notice: AgentsNotice | null

  setAgents: (snapshot: AgentsSnapshot | null) => void
  setBusy: (busy: boolean) => void
  setNotice: (notice: AgentsNotice | null) => void
  /** 断开连接或后端重启时清空。 */
  resetAll: () => void
}

export const useAgentsStore = create<AgentsState>((set) => ({
  snapshot: null,
  busy: false,
  notice: null,

  setAgents: (snapshot) => set({ snapshot }),
  setBusy: (busy) => set({ busy }),
  setNotice: (notice) => set({ notice }),
  resetAll: () => set({ snapshot: null, busy: false, notice: null })
}))
