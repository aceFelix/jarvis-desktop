/**
 * 设置面板「长期记忆」分组（2026-11）。
 *
 * 两行：用户级（`~/.jarvis/MEMORY.md`，跨项目）与项目级
 * （`<当前项目>/.jarvis/MEMORY.md`）。点任意一行 → 打开气泡编辑器
 * （`MemoryBubble`）浏览/整体改写；行内展示路径、字数与首行预览。
 *
 * 数据源：`memory.get`（挂载时拉一次，之后由 `memory_changed` 事件驱动重拉）。
 * 与模型侧共用同一对文件：模型用 MemoryUpdate 只追加，用户在这里可整体编辑。
 *
 * 未选项目时项目级行置灰并说明先选项目（不发指令，避免后端报错）。
 * @author aceFelix
 */

import { useEffect, useState } from 'react'
import { memoryEntryOf, type MemoryEntry, type MemoryScope } from '../../../shared/memory-contracts'
import { useBackendStore } from '../stores/backendStore'
import { useMemoryStore } from '../stores/memoryStore'
import { useT } from '../i18n'
import MemoryBubble from './MemoryBubble'

/** 取首行预览：跳过 Markdown 标题行，找不到就给空串。 */
function previewOf(content: string, limit = 64): string {
  const line = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  const text = line ?? ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** 一行记忆入口：可点击打开气泡；项目级无项目/无快照时显提示。 */
function MemoryRow({
  scope,
  entry,
  disabledReason,
  onOpen
}: {
  scope: MemoryScope
  entry: MemoryEntry | null
  disabledReason?: string
  onOpen: (scope: MemoryScope) => void
}): JSX.Element {
  const t = useT()
  const label = scope === 'user' ? t('memory.userScope') : t('memory.projectScope')
  const preview = entry ? previewOf(entry.content) : ''
  const disabled = !entry || !!disabledReason
  return (
    <button
      className={`setting-row memory-row${disabled ? ' disabled' : ''}`}
      data-testid={`memory-row-${scope}`}
      disabled={disabled}
      onClick={() => {
        if (entry) onOpen(scope)
      }}
    >
      <span className="memory-row-head">
        <span className="setting-label">{label}</span>
        <span className="memory-row-meta">
          {disabledReason
            ? disabledReason
            : entry
              ? t('memory.charCount', { count: entry.chars, max: 100_000 })
              : t('memory.empty')}
        </span>
      </span>
      <span className="memory-row-preview">
        {disabledReason ? t('memory.noProject') : preview || t('memory.emptyHint')}
      </span>
      {entry ? (
        <span className="memory-row-path" title={entry.path} data-testid={`memory-path-${scope}`}>
          {entry.path}
        </span>
      ) : null}
    </button>
  )
}

export default function MemoryPanel(): JSX.Element {
  const t = useT()
  const snapshot = useMemoryStore((s) => s.snapshot)
  const loading = useMemoryStore((s) => s.loading)
  const fetchMemory = useBackendStore((s) => s.fetchMemory)
  const [editingScope, setEditingScope] = useState<MemoryScope | null>(null)

  // 挂载即拉一次：设置面板是懒渲染的，init 的全局刷新可能早于本面板挂载。
  useEffect(() => {
    void fetchMemory()
  }, [fetchMemory])

  const userEntry = memoryEntryOf(snapshot, 'user')
  // 气泡读 store 里的实时条目（不是点击瞬间的快照）：保存回执/外部刷新后
  // 气泡里的基线随之更新，避免拿旧对象覆盖新内容。@author aceFelix
  const liveEntry = editingScope ? memoryEntryOf(snapshot, editingScope) : null

  return (
    <div className="settings-panel" data-testid="settings-memory">
      <p className="setting-hint">{t('memory.sectionHint')}</p>
      {snapshot ? (
        <>
          <MemoryRow scope="user" entry={userEntry} onOpen={setEditingScope} />
          <MemoryRow
            scope="project"
            entry={memoryEntryOf(snapshot, 'project')}
            disabledReason={snapshot.workdir ? '' : t('memory.noProject')}
            onOpen={setEditingScope}
          />
        </>
      ) : (
        <div className="side-empty" data-testid="memory-offline">
          {loading ? t('memory.loading') : t('memory.offline')}
        </div>
      )}
      {editingScope && liveEntry ? (
        <MemoryBubble scope={editingScope} entry={liveEntry} onClose={() => setEditingScope(null)} />
      ) : null}
    </div>
  )
}
