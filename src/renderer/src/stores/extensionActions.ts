/**
 * 扩展服务动作（自 backendStore 拆出，2026-10）。
 *
 * 「扩展服务」面板（MCP / 内置工具 / 技能 / 插件 / harness 五类）的所有读写都走
 * 同一条 RPC `extensions.exec`（category + action + 其余参数），回执为统一信封
 * `ExtensionEnvelope`。面板内的错误应在面板内联显示、不污染对话流，故用
 * `client.sendCommand` 直取回执（**不走 runCommand**，与 sendEmail/邮箱配置同口径）。
 *
 * 拆成动作工厂而非内联进 backendStore：那里已近 800 行上限，且本组动作只需注入
 * 一个 client 取值器，无其他 store 依赖。@author aceFelix
 */

import { Cmd } from '../../../shared/contracts'
import type { ExtensionCategory, ExtensionEnvelope } from '../../../shared/extension-contracts'
import type { JarvisWsClient } from '../api/ws'

/** 拆出的扩展服务动作集合（与 BackendStoreState 中同名成员签名一致）。 */
export interface ExtensionActions {
  /**
   * 调用扩展服务 RPC（extensions.exec）。
   *
   * @param category 扩展分类（mcp/tools/skills/plugins/harness）。
   * @param action 该分类下的动作名（list/search/add/update/remove/enable/disable…）。
   * @param params 其余动作参数，原样透传给后端。
   * @returns 统一回执信封；未连后端或传输异常时返回 `{ok:false, message}`。
   * @author aceFelix
   */
  runExtension: <T = unknown>(
    category: ExtensionCategory,
    action: string,
    params?: Record<string, unknown>
  ) => Promise<ExtensionEnvelope<T>>
}

/** 组装扩展服务动作：注入 client 取值器（避免模块环引用）。 */
export function buildExtensionActions(getClient: () => JarvisWsClient | null): ExtensionActions {
  return {
    runExtension: async <T,>(
      category: ExtensionCategory,
      action: string,
      params: Record<string, unknown> = {}
    ): Promise<ExtensionEnvelope<T>> => {
      const client = getClient()
      if (!client) return { ok: false, message: '未连接到后端' }
      try {
        const reply = await client.sendCommand(Cmd.Extensions, { category, action, ...params })
        if (!reply.ok) return { ok: false, message: reply.error ?? '操作失败' }
        const result = (reply.result ?? {}) as ExtensionEnvelope<T>
        return { ok: result.ok !== false, data: result.data, message: result.message }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
