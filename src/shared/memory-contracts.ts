/**
 * 长期记忆面板的类型契约（桌面「设置 → 长期记忆」，2026-11）。
 *
 * 镜像后端 `agent/serve/rpc_memory.py` 的回执形状：
 * - `memory.get` → `{ workdir, entries: MemoryEntry[] }`（无项目时只有 user）；
 * - `memory.save` → `{ scope, entry: MemoryEntry }`（保存后的最新快照）。
 *
 * 快照字段口径与后端 `memory.store.read_memory_scope` 一致；解析一律宽容，
 * 旧版后端缺字段时降级为空内容/0 字数，面板显「暂无记忆」而不是崩掉。
 *
 * @author aceFelix
 */

/** 记忆范围：user = `~/.jarvis/MEMORY.md`；project = `<workdir>/.jarvis/MEMORY.md`。 */
export type MemoryScope = 'user' | 'project'

/** 单文件字符上限（镜像后端 memory.store.MEMORY_MAX_CHARS，超出后端直接拒绝）。 */
export const MEMORY_MAX_CHARS = 100_000

/** 单个范围的记忆快照（read_memory_scope 的镜像）。 */
export interface MemoryEntry {
  scope: MemoryScope
  /** 记忆文件绝对路径（面板展示用，便于用户直接去改文件）。 */
  path: string
  /** 文件全文；文件不存在时为空串。 */
  content: string
  /** 文件是否已存在（false = 从未创建，面板显「暂无」而不是报错）。 */
  exists: boolean
  /** 全文字符数（后端按 len(content) 计）。 */
  chars: number
  /** 最后修改时间（epoch 秒，0 = 未知/不存在）。 */
  updated_at: number
}

/** `memory.get` 的完整回执。 */
export interface MemorySnapshot {
  /** 当前项目目录；空串 = 尚未选择项目（此时只有 user 条目）。 */
  workdir: string
  entries: MemoryEntry[]
}

/** `memory.save` 的回执。 */
export interface MemorySaveResult {
  scope: MemoryScope
  entry: MemoryEntry
}

/** 把任意回执宽容解析成单条记忆快照。 */
function parseEntry(raw: unknown): MemoryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const scope = r.scope === 'project' ? 'project' : r.scope === 'user' ? 'user' : null
  if (!scope) return null
  return {
    scope,
    path: typeof r.path === 'string' ? r.path : '',
    content: typeof r.content === 'string' ? r.content : '',
    exists: r.exists === true,
    chars: Number.isFinite(Number(r.chars)) ? Number(r.chars) : 0,
    updated_at: Number.isFinite(Number(r.updated_at)) ? Number(r.updated_at) : 0
  }
}

/**
 * 宽容解析 `memory.get` 回执。
 *
 * 非对象/缺 entries 时返回空快照（面板显离线/空态），不抛异常。
 * @author aceFelix
 */
export function parseMemorySnapshot(raw: unknown): MemorySnapshot {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const entries = Array.isArray(r.entries)
    ? r.entries.map(parseEntry).filter((e): e is MemoryEntry => e !== null)
    : []
  return {
    workdir: typeof r.workdir === 'string' ? r.workdir : '',
    entries
  }
}

/** 宽容解析 `memory.save` 回执；形状不合法返回 null（调用方保留旧快照）。 */
export function parseMemorySaveResult(raw: unknown): MemorySaveResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const entry = parseEntry(r.entry)
  if (!entry) return null
  return { scope: entry.scope, entry }
}

/** 按范围取条目；不存在返回 null。 */
export function memoryEntryOf(snapshot: MemorySnapshot | null, scope: MemoryScope): MemoryEntry | null {
  return snapshot?.entries.find((e) => e.scope === scope) ?? null
}
