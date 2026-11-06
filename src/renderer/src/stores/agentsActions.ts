/**
 * 代理团队动作 —— 桌面右栏「代理团队」面板的 `agents.exec` 调用层。
 *
 * 与 taskActions / perceptActions 同一范式（aceFelix，2026-11）：
 * - 用 `client.sendCommand` **直取回执**，不走 runCommand——面板里的错误
 *   要在面板内联显示，不该写进聊天流；
 * - 未连后端时读回 null、写回 `{ok:false}`，面板显离线态而不是抛异常；
 * - 写操作后用回执里的整份快照刷新（不做乐观更新），失败保留旧快照。
 *
 * 三个动作的安全口径与后端 `rpc_agents.py` 同源：
 * 1. `stop` 只停该代理自身，不触碰主会话回复；同步子代理走任务取消，
 *    队友走 shutdown 协议。
 * 2. `message` 只对后台队友有效（同步子代理没有邮箱，后端会明确拒绝）。
 * 3. 全部动作都不产生文件副作用，故不需要二次确认。
 *
 * @author aceFelix
 */

import { Cmd } from '../../../shared/contracts'
import { parseAgentsSnapshot, type AgentOpResult, type AgentsSnapshot } from '../../../shared/agents-contracts'
import { useAgentsStore } from './agentsStore'
import type { JarvisWsClient } from '../api/ws'

/** 拆出的代理团队动作集合（与 BackendStoreState 中同名成员签名一致）。 */
export interface AgentsActions {
  /**
   * 拉代理团队快照（`agents.exec status`）。
   *
   * @returns 快照；未连后端或回执失败返回 null（面板保留旧数据或显离线态）。
   */
  fetchAgents: () => Promise<AgentsSnapshot | null>
  /** 停止一个子代理/队友（只停它自己）。 */
  stopAgent: (agentId: string) => Promise<AgentOpResult>
  /** 给后台队友追加指令（同步子代理会被后端拒绝）。 */
  messageAgent: (agentId: string, text: string) => Promise<AgentOpResult>
  /**
   * 刷新代理团队快照（init / 面板挂载 / 手动刷新共用）。
   *
   * 失败保留旧快照；清空只在断开连接时由 `agentsStore.resetAll()` 做。
   */
  refreshAgents: () => Promise<void>
}

/** 组装代理团队动作：注入 client 取值器（避免模块环引用）。 */
export function buildAgentsActions(getClient: () => JarvisWsClient | null): AgentsActions {
  const readOnce = async (): Promise<AgentsSnapshot | null> => {
    const client = getClient()
    if (!client) return null
    try {
      const reply = await client.sendCommand(Cmd.AgentsExec, { action: 'status' })
      if (!reply.ok) return null
      return parseAgentsSnapshot(reply.result)
    } catch {
      return null
    }
  }

  const opOnce = async (payload: Record<string, unknown>): Promise<AgentOpResult> => {
    const client = getClient()
    if (!client) return { ok: false, message: '未连接到后端', snapshot: null }
    try {
      const reply = await client.sendCommand(Cmd.AgentsExec, payload)
      if (!reply.ok) {
        return { ok: false, message: reply.error || '指令未被受理', snapshot: null }
      }
      const data = parseAgentsSnapshot(reply.result)
      return { ok: data.ok === true, message: data.message, snapshot: data }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), snapshot: null }
    }
  }

  return {
    fetchAgents: readOnce,

    stopAgent: (agentId) => opOnce({ action: 'stop', agent_id: agentId }),

    messageAgent: (agentId, text) => opOnce({ action: 'message', agent_id: agentId, text }),

    refreshAgents: async () => {
      const snapshot = await readOnce()
      if (snapshot) useAgentsStore.getState().setAgents(snapshot)
    }
  }
}
