/**
 * 长期记忆动作 —— 桌面「设置 → 长期记忆」面板的 `memory.get / memory.save` 调用层。
 *
 * 与 agentsActions 同范式（aceFelix，2026-11）：
 * - 用 `client.sendCommand` 直取回执，不走 runCommand——保存失败要在气泡里
 *   内联显示，不该写进聊天流；
 * - 未连后端时读回 null、写回 `{ok:false}`，面板显离线态而不是抛异常；
 * - 写成功后直接回填回执里的最新快照，随后 `memory_changed` 事件到达时
 *   再重拉一次（多窗口/其他入口改同一文件时也能同步）。
 *
 * @author aceFelix
 */

import { Cmd } from '../../../shared/contracts'
import {
  parseMemorySaveResult,
  parseMemorySnapshot,
  type MemorySaveResult,
  type MemoryScope,
  type MemorySnapshot
} from '../../../shared/memory-contracts'
import { useMemoryStore } from './memoryStore'
import type { JarvisWsClient } from '../api/ws'

/** 拆出的长期记忆动作集合（与 BackendStoreState 中同名成员签名一致）。 */
export interface MemoryActions {
  /** 拉取两个范围的记忆快照；失败返回 null 并写 store.error（面板内联提示）。 */
  fetchMemory: () => Promise<MemorySnapshot | null>
  /** 整体保存一个范围；成功返回回执，失败返回 null 并写 store.error。 */
  saveMemory: (scope: MemoryScope, content: string) => Promise<MemorySaveResult | null>
  /** 刷新记忆快照并回填 store（init / 面板挂载 / memory_changed 共用）。 */
  refreshMemory: () => Promise<void>
}

/** 组装长期记忆动作：注入 client 取值器（避免模块环引用）。 */
export function buildMemoryActions(getClient: () => JarvisWsClient | null): MemoryActions {
  const store = useMemoryStore.getState()

  const readOnce = async (silent: boolean): Promise<MemorySnapshot | null> => {
    const client = getClient()
    if (!client) {
      if (!silent) store.setError('未连接到后端')
      return null
    }
    store.setLoading(true)
    try {
      const reply = await client.sendCommand(Cmd.MemoryGet)
      if (!reply.ok) {
        if (!silent) store.setError(reply.error || '读取长期记忆失败')
        return null
      }
      const snapshot = parseMemorySnapshot(reply.result)
      useMemoryStore.getState().setSnapshot(snapshot)
      return snapshot
    } catch (err) {
      if (!silent) {
        store.setError(err instanceof Error ? err.message : String(err))
      }
      return null
    } finally {
      useMemoryStore.getState().setLoading(false)
    }
  }

  return {
    fetchMemory: () => readOnce(false),

    saveMemory: async (scope, content) => {
      const client = getClient()
      if (!client) {
        store.setError('未连接到后端')
        return null
      }
      useMemoryStore.getState().setSavingScope(scope)
      try {
        const reply = await client.sendCommand(Cmd.MemorySave, { scope, content }, 20000)
        if (!reply.ok) {
          useMemoryStore.getState().setError(reply.error || '保存长期记忆失败')
          return null
        }
        const parsed = parseMemorySaveResult(reply.result)
        if (parsed) {
          // 用回执里的最新快照替换该范围，面板字数/预览立即更新；
          // 另一范围保持原样（保存不会改动它）。
          const cur = useMemoryStore.getState().snapshot
          const entries = cur ? cur.entries.filter((e) => e.scope !== parsed.scope) : []
          useMemoryStore.getState().setSnapshot({
            workdir: cur?.workdir ?? '',
            entries: [...entries, parsed.entry]
          })
        }
        return parsed
      } catch (err) {
        useMemoryStore.getState().setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        useMemoryStore.getState().setSavingScope(null)
      }
    },

    refreshMemory: async () => {
      // 事件驱动的后台刷新：失败不弹错误（保持旧快照即可）。
      await readOnce(true)
    }
  }
}
