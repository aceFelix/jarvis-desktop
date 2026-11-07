/**
 * 长期记忆气泡编辑器（2026-11）。
 *
 * 从设置面板的「长期记忆」行点开后浮在右栏左侧的一张卡片：整篇 MEMORY.md
 * 原文可读可改，保存即整体覆盖该范围（后端原子写 + 保留一份 .bak）。
 *
 * 交互约定：
 * - 打开时以磁盘内容为基线；用户改过（dirty）后，外部刷新不会覆盖草稿，
 *   避免模型刚追加的一条把用户正在写的整篇冲掉；
 * - 保存成功后停在气泡里显示「已保存，下一轮对话生效」，用户可继续编辑或关闭；
 * - Esc 关闭，Ctrl/⌘+Enter 保存；关闭前 dirty 会弹确认（避免误丢整篇改动）。
 *
 * @author aceFelix
 */

import { useCallback, useEffect, useState } from 'react'
import { MEMORY_MAX_CHARS, type MemoryEntry, type MemoryScope } from '../../../shared/memory-contracts'
import { useBackendStore } from '../stores/backendStore'
import { useMemoryStore } from '../stores/memoryStore'
import { useT } from '../i18n'

interface Props {
  scope: MemoryScope
  entry: MemoryEntry
  onClose: () => void
}

export default function MemoryBubble({ scope, entry, onClose }: Props): JSX.Element {
  const t = useT()
  const saveMemory = useBackendStore((s) => s.saveMemory)
  const saving = useMemoryStore((s) => s.savingScope === scope)
  const [draft, setDraft] = useState(entry.content)
  const [status, setStatus] = useState<'idle' | 'saved'>('idle')
  const [error, setError] = useState('')
  // 草稿基线：外部刷新到达时，只有内容与基线一致（用户没改过）才接受覆盖。
  const [baseline, setBaseline] = useState(entry.content)

  useEffect(() => {
    if (entry.content === baseline) return
    // 磁盘内容变了：用户没动过草稿就跟上，动过就保留草稿并提示。
    if (draft === baseline) {
      setDraft(entry.content)
      setBaseline(entry.content)
      setStatus('idle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.content])

  const dirty = draft !== baseline

  const close = useCallback(() => {
    if (dirty && !window.confirm(t('memory.discardConfirm'))) return
    onClose()
  }, [dirty, onClose, t])

  const save = useCallback(async () => {
    if (saving) return
    if (draft.length > MEMORY_MAX_CHARS) {
      setError(t('memory.tooLong', { max: MEMORY_MAX_CHARS }))
      return
    }
    setError('')
    const saved = await saveMemory(scope, draft)
    if (saved) {
      setBaseline(saved.entry.content)
      setDraft(saved.entry.content)
      setStatus('saved')
    } else {
      // 失败原因已写进 memoryStore.error，这里取当前快照再提示一次更直接
      setError(t('memory.saveFailed'))
    }
  }, [draft, saveMemory, saving, scope, t])

  // 键盘：Esc 关闭 / Ctrl(⌘)+Enter 保存。绑定在气泡容器上（textarea 内也生效）。
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void save()
    }
  }

  const title = scope === 'user' ? t('memory.bubbleTitleUser') : t('memory.bubbleTitleProject')

  return (
    <div
      className="memory-bubble"
      data-testid={`memory-bubble-${scope}`}
      role="dialog"
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <div className="memory-bubble-head">
        <span className="memory-bubble-title">{title}</span>
        <button
          className="memory-bubble-close"
          title={t('memory.close')}
          aria-label={t('memory.close')}
          data-testid="memory-bubble-close"
          onClick={close}
        >
          ✕
        </button>
      </div>

      <p className="memory-bubble-hint">{t('memory.bubbleHint')}</p>
      <p className="memory-bubble-path" title={entry.path} data-testid="memory-bubble-path">
        {entry.path}
      </p>

      <textarea
        className="memory-bubble-editor"
        data-testid="memory-bubble-editor"
        value={draft}
        spellCheck={false}
        placeholder={t('memory.placeholder')}
        onChange={(e) => {
          setDraft(e.target.value)
          setStatus('idle')
          setError('')
        }}
      />

      <div className="memory-bubble-foot">
        <span
          className={`memory-bubble-count${draft.length > MEMORY_MAX_CHARS ? ' over' : ''}`}
          data-testid="memory-bubble-count"
        >
          {t('memory.charCount', { count: draft.length, max: MEMORY_MAX_CHARS })}
        </span>
        <div className="memory-bubble-actions">
          {status === 'saved' ? (
            <span className="memory-bubble-saved" data-testid="memory-bubble-saved">
              {t('memory.saved')}
            </span>
          ) : null}
          <button
            className="memory-btn"
            data-testid="memory-bubble-reload"
            disabled={saving || !dirty}
            onClick={() => {
              setDraft(baseline)
              setStatus('idle')
              setError('')
            }}
          >
            {t('memory.reload')}
          </button>
          <button
            className="memory-btn primary"
            data-testid="memory-bubble-save"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? t('memory.saving') : t('memory.save')}
          </button>
        </div>
      </div>
      {error ? (
        <p className="memory-bubble-error" data-testid="memory-bubble-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
