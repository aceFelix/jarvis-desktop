/**
 * 长期记忆面板状态（桌面「设置 → 长期记忆」，2026-11）。
 *
 * 只保存 `memory.get` 的最近一份快照与请求态，不做乐观更新：
 * 保存后以后端回执/`memory_changed` 重拉为准，避免面板显示与磁盘两份真相。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { MemorySnapshot, MemoryScope } from '../../../shared/memory-contracts'

interface MemoryState {
  /** 最近一次成功拉取的快照；null = 尚未拉取（面板显离线/空态）。 */
  snapshot: MemorySnapshot | null
  /** 正在拉取。 */
  loading: boolean
  /** 正在保存的范围；null = 无保存请求。 */
  savingScope: MemoryScope | null
  /** 最近一次失败原因（面板内联提示，不写聊天流）。 */
  error: string
  setSnapshot: (snapshot: MemorySnapshot) => void
  setLoading: (loading: boolean) => void
  setSavingScope: (scope: MemoryScope | null) => void
  setError: (error: string) => void
  /** 断开连接/重连时清空，避免展示上一后端的旧记忆。 */
  reset: () => void
}

/** 长期记忆面板状态仓库。@author aceFelix */
export const useMemoryStore = create<MemoryState>((set) => ({
  snapshot: null,
  loading: false,
  savingScope: null,
  error: '',
  setSnapshot: (snapshot) => set({ snapshot, error: '' }),
  setLoading: (loading) => set({ loading }),
  setSavingScope: (savingScope) => set({ savingScope }),
  setError: (error) => set({ error }),
  reset: () => set({ snapshot: null, loading: false, savingScope: null, error: '' })
}))
