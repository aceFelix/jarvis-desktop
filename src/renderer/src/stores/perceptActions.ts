/**
 * 感知层（W2）动作 —— 桌面「管家服务 → 感知源」面板的两条 RPC。
 *
 * 为什么拆成动作工厂（aceFelix，2026-10）：backendStore 已近 800 行上限，此前
 * 资源/协同/扩展三组动作就是这么拆出去的，本组照同一范式接入（只需注入一个
 * client 取值器，无其他 store 依赖）。
 *
 * 收发口径与 sendEmail / 邮箱配置 / extensions.exec 完全一致：用
 * `client.sendCommand` **直取回执**，不走 runCommand——面板里的错误要在面板里
 * 内联显示，不该写进聊天流。未连后端时读回 null、写回 `{ok:false}`，面板据此
 * 显离线态而不是抛异常。
 *
 * @author aceFelix
 */

import { Cmd } from '../../../shared/contracts'
import {
  parsePerceptStatus,
  type PerceptConfigPatch,
  type PerceptStatus
} from '../../../shared/percept-contracts'
import type { JarvisWsClient } from '../api/ws'

/** 拆出的感知层动作集合（与 BackendStoreState 中同名成员签名一致）。 */
export interface PerceptActions {
  /**
   * 读取感知层状态快照（percept.status.get，2026-10 W2 第 5 步）。
   *
   * @param eventLimit 最近事件条数（后端上限 50；省略按后端默认）。
   * @returns 可渲染的状态快照；未连后端或回执失败返回 null（面板显离线态）。
   * @author aceFelix
   */
  fetchPerceptStatus: (eventLimit?: number) => Promise<PerceptStatus | null>
  /**
   * 保存感知配置（percept.config.set）：逐源开关与采集名单补丁。
   *
   * 后端顺序是「校验 → 落 settings.toml → 改运行时 → 宿主重装配总线」，所以
   * 成功回执里带回读后的完整快照（含 `hot_applied`）：false 表示配置已落盘但
   * 本次会话没重装配，面板必须提示「需重启才生效」，不能假装已经生效。
   *
   * @param patch 实际改动的键（后端白名单外的键会直接报错，不做静默忽略）。
   * @returns `ok` + 失败原因 `error` + 成功时的新快照 `status`。
   * @author aceFelix
   */
  savePerceptConfig: (
    patch: PerceptConfigPatch
  ) => Promise<{ ok: boolean; error?: string; status?: PerceptStatus }>
}

/** 组装感知层动作：注入 client 取值器（避免模块环引用）。 */
export function buildPerceptActions(getClient: () => JarvisWsClient | null): PerceptActions {
  return {
    fetchPerceptStatus: async (eventLimit?: number): Promise<PerceptStatus | null> => {
      const client = getClient()
      if (!client) return null
      try {
        const payload: Record<string, unknown> = {}
        if (typeof eventLimit === 'number' && eventLimit > 0) payload.event_limit = Math.trunc(eventLimit)
        const reply = await client.sendCommand(Cmd.PerceptStatusGet, payload)
        if (!reply.ok) return null
        return parsePerceptStatus(reply.result)
      } catch {
        return null
      }
    },

    savePerceptConfig: async (patch) => {
      const client = getClient()
      if (!client) return { ok: false, error: '未连接到后端' }
      try {
        const reply = await client.sendCommand(Cmd.PerceptConfigSet, { ...patch })
        if (!reply.ok) return { ok: false, error: reply.error ?? '保存失败' }
        return { ok: true, status: parsePerceptStatus(reply.result) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
