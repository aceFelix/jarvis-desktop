/**
 * 右栏「任务中心」→「副作用账本」区块：看贾维斯动过什么，并就地撤回。
 *
 * 设计取向（aceFelix，2026-10 阶段 10 W3）：
 * - **能不能撤只问后端**：`reversible` 与 `undo_spec.kind` 由 `core/actions/journal.py`
 *   判定（邮件已发出就是 `kind='none'`），前端不再自己猜「这个看起来能撤吗」。
 *   撤不回的项画一行「撤不回」并把后端 reason 挂 title，不给按钮。
 * - **两种粒度分得清**：`cancel_hold` 撤的是还没执行的预约（一拍、什么都不做）；
 *   `undo` 撤的是已经执行的副作用，粒度是**整轮**（回到本轮开始前的工作区），
 *   所以必须两拍——第一拍的影响面清单（含「N 个新建文件会被删除」）摊开后再问一次。
 * - **倒计时只给 held 项**：没有预约时不起定时器，避免面板常驻一个 1 秒心跳。
 * - 反馈条与「跨会话目标」区块共用 `tasksStore.notice`，靠 `panel` 字段分流，
 *   同一条后端原文不会在两个区块各画一遍。
 *
 * @author aceFelix
 */

import { useCallback, useEffect, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useTasksStore } from '../stores/tasksStore'
import {
  fmtEpoch,
  shortId,
  type ActionsSnapshot,
  type EffectRecordInfo,
  type TaskOpResult,
  type UndoFileChange,
  type UndoPreview
} from '../../../shared/tasks-contracts'
import { useT } from '../i18n'

/** 账本状态 → 色标类名（未知状态归 bad，绝不显示成「看起来正常」）。 */
function stateTone(state: string): 'held' | 'ok' | 'dim' | 'bad' {
  if (state === 'held') return 'held'
  if (state === 'applied') return 'ok'
  if (state === 'undone' || state === 'cancelled') return 'dim'
  return 'bad'
}

/** 已知账本状态（后端 ALL_STATES）：不在表里的状态不直接拼键名，
 * 否则 `t()` 找不到键会把内部字符串（"tasks.journal.state.foo"）画到面板上。 */
const KNOWN_STATES = ['held', 'applied', 'undone', 'failed', 'cancelled']

/** 从回执 preview 字段取对象形影响面（undo_task 那里是数组，必须区分开）。 */
function asUndoPreview(preview: ActionsSnapshot['preview']): UndoPreview | null {
  if (!preview || Array.isArray(preview)) return null
  return preview
}

export default function EffectJournalPanel(): JSX.Element {
  const t = useT()
  const actions = useTasksStore((s) => s.actions)
  const busy = useTasksStore((s) => s.busy)
  const notice = useTasksStore((s) => s.notice)
  const confirm = useTasksStore((s) => s.confirm)
  const setActions = useTasksStore((s) => s.setActions)
  const setBusy = useTasksStore((s) => s.setBusy)
  const setNotice = useTasksStore((s) => s.setNotice)
  const setConfirm = useTasksStore((s) => s.setConfirm)
  const refreshTasks = useBackendStore((s) => s.refreshTasks)
  const cancelHold = useBackendStore((s) => s.cancelHold)
  const undoRecord = useBackendStore((s) => s.undoRecord)

  // held 项的倒计时：只在真有预约在窗时起心跳，无预约不占定时器
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const hasHeld = !!actions?.held.length

  useEffect(() => {
    if (!hasHeld) return
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [hasHeld])

  /**
   * actions.exec 动作骨架：置忙 → 调用 → 回填账本快照 → 显示后端原文。
   *
   * 只有成功才执行 `onDone`（第一拍据此挂确认卡）；失败时后端 message 已经说明
   * 原因（账本未启用 / 记录不存在 / 撤不回），前端不改写。
   */
  const runJournalOp = useCallback(
    async (
      job: () => Promise<TaskOpResult<ActionsSnapshot | null>>,
      onDone?: (res: TaskOpResult<ActionsSnapshot | null>) => void
    ) => {
      setBusy(true)
      try {
        const res = await job()
        if (res.snapshot) setActions(res.snapshot)
        setNotice({ text: res.message, tone: res.ok ? 'ok' : 'warn', panel: 'journal' })
        if (res.ok) onDone?.(res)
      } finally {
        setBusy(false)
      }
    },
    [setBusy, setNotice, setActions]
  )

  /** 撤回预约：一拍落手（它什么都没做过，不需要二次确认）。 */
  const doCancelHold = (record: EffectRecordInfo) =>
    void runJournalOp(() => cancelHold(record.id))

  /** 回退这一轮第一拍：只取影响面（文件清单 + 新建文件计数 + 整轮提醒）。 */
  const askUndo = (record: EffectRecordInfo) =>
    void runJournalOp(
      () => undoRecord(record.id, false),
      (res) => {
        const snap = res.snapshot
        if (!snap?.need_confirm) return
        const preview = asUndoPreview(snap.preview)
        setConfirm({
          kind: 'undo-record',
          id: record.id,
          title: `${record.tool} · ${record.preview || shortId(record.id)}`,
          files: preview?.files ?? [],
          untrackedCount: preview?.untracked_count ?? 0,
          hint: preview?.hint ?? ''
        })
      }
    )

  /** 第二拍落手：带 confirm 重发 undo，成功即收起确认卡。 */
  const doConfirmUndo = () => {
    const pending = confirm
    if (!pending || pending.kind !== 'undo-record') return
    void runJournalOp(() => undoRecord(pending.id, true), () => setConfirm(null))
  }

  const snap = actions
  const held = snap?.held ?? []
  const recent = snap?.recent ?? []
  const counts = snap?.counts ?? {}
  const items = snap?.items ?? []

  return (
    <div className="tasks-block" data-testid="effect-journal-panel">
      <div className="tasks-head" data-testid="journal-head">
        <span className={snap && !snap.enabled ? 'tasks-driver-off' : 'tasks-driver-on'}>
          {!snap
            ? t('tasks.offline')
            : t('tasks.journal.counts', {
                applied: String(counts.applied ?? 0),
                undone: String(counts.undone ?? 0),
                held: String(counts.held ?? 0)
              })}
        </span>
        <span className="tasks-head-actions">
          <button
            type="button"
            className="tasks-mini-btn"
            title={t('tasks.refreshTip')}
            disabled={busy}
            onClick={() => void refreshTasks()}
          >
            {t('tasks.refresh')}
          </button>
        </span>
      </div>

      {snap && !snap.enabled ? (
        <div className="side-empty" data-testid="journal-disabled">
          {t('tasks.journal.disabled')}
        </div>
      ) : null}

      {snap?.enabled ? (
        <div className="setting-hint" data-testid="journal-window">
          {t('tasks.journal.windowLine', {
            sec: String(snap.actions_config.undo_window_s),
            size: String(snap.window_size)
          })}
          {snap.held_labels.length ? ` ｜ ${t('tasks.journal.heldLabels', { labels: snap.held_labels.join('、') })}` : ''}
        </div>
      ) : null}

      {snap?.enabled && held.length ? (
        <>
          <div className="tasks-section-title">{t('tasks.journal.held', { n: String(held.length) })}</div>
          <ul className="tasks-record-ul" data-testid="journal-held-list">
            {held.map((r, i) => (
              <RecordRow
                key={`${r.id}-${i}`}
                record={r}
                now={now}
                busy={busy}
                onCancelHold={doCancelHold}
              />
            ))}
          </ul>
        </>
      ) : null}

      {snap?.enabled && !held.length ? (
        <div className="side-empty" data-testid="journal-held-empty">
          {t('tasks.journal.heldEmpty')}
        </div>
      ) : null}

      {snap?.enabled ? <div className="tasks-section-title">{t('tasks.journal.recent')}</div> : null}

      {snap?.enabled && recent.length ? (
        <ul className="tasks-record-ul" data-testid="journal-recent-list">
          {recent.map((r, i) => (
            <RecordRow key={`${r.id}-${i}`} record={r} now={now} busy={busy} onAskUndo={askUndo} />
          ))}
        </ul>
      ) : snap?.enabled ? (
        <div className="side-empty" data-testid="journal-empty">
          {t('tasks.journal.empty')}
        </div>
      ) : null}

      {confirm?.kind === 'undo-record' ? (
        <div className="tasks-confirm" data-testid="journal-confirm">
          <div className="tasks-confirm-title">{t('tasks.confirmUndo.title')}</div>
          <div className="tasks-confirm-target" title={confirm.id}>
            {confirm.title}
          </div>
          <ul className="tasks-confirm-ul">
            {(confirm.files ?? []).map((f: UndoFileChange, i) => (
              <li key={`${f.path}-${i}`} className="tasks-confirm-li" title={f.path}>
                {f.status} {f.path}
              </li>
            ))}
            {confirm.untrackedCount ? (
              <li className="tasks-confirm-li">
                {t('tasks.confirmUndo.untracked', { n: String(confirm.untrackedCount) })}
              </li>
            ) : null}
            {!confirm.files?.length && !confirm.untrackedCount ? (
              <li className="tasks-confirm-li">{t('tasks.confirm.emptyPreview')}</li>
            ) : null}
          </ul>
          {confirm.hint ? <div className="setting-hint">{confirm.hint}</div> : null}
          <div className="tasks-form-actions">
            <button
              type="button"
              className="tasks-mini-btn primary"
              data-testid="journal-confirm-do"
              disabled={busy}
              onClick={doConfirmUndo}
            >
              {t('tasks.confirm.doIt')}
            </button>
            <button type="button" className="tasks-mini-btn" disabled={busy} onClick={() => setConfirm(null)}>
              {t('tasks.confirm.back')}
            </button>
          </div>
        </div>
      ) : null}

      {items.length ? (
        <details className="tasks-steps" data-testid="journal-items">
          <summary>{t('tasks.journal.itemsToggle')}</summary>
          <ul className="tasks-steps-ul">
            {items.map((line, i) => (
              <li key={`${line}-${i}`} className="tasks-steps-li">
                {line}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {notice?.panel === 'journal' && notice.text ? (
        <div className={`tasks-notice tone-${notice.tone}`} data-testid="journal-notice">
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}

/** 单条账本记录：时间 + 工具 + 预览 + 状态 + 归属目标，按状态给「撤回」或「回退这一轮」。 */
function RecordRow({
  record,
  now,
  busy,
  onCancelHold,
  onAskUndo
}: {
  record: EffectRecordInfo
  now: number
  busy: boolean
  onCancelHold?: (record: EffectRecordInfo) => void
  onAskUndo?: (record: EffectRecordInfo) => void
}): JSX.Element {
  const t = useT()
  const isHeld = record.state === 'held'
  const stateText = KNOWN_STATES.includes(record.state)
    ? t(`tasks.journal.state.${record.state}`)
    : t('tasks.journal.state.unknown')
  const dueLeft = Math.max(0, Math.ceil(record.due_at - now))
  return (
    <li className="tasks-record" data-testid="journal-record" title={record.workdir || record.session_id}>
      <div className="tasks-record-main">
        <span className={`tasks-goal-dot to-${stateTone(record.state)}`} />
        <span className="tasks-record-time">{fmtEpoch(record.ts)}</span>
        <span className="tasks-record-tool">{record.tool}</span>
        <span className="tasks-record-preview">{record.preview || shortId(record.id)}</span>
      </div>
      <div className="tasks-goal-meta">
        <span className={`tasks-chip tone-${stateTone(record.state)}`}>{stateText}</span>
        {isHeld ? (
          <span className="tasks-chip">
            {record.due_at <= now ? t('tasks.journal.duePassed') : t('tasks.journal.dueIn', { sec: String(dueLeft) })}
          </span>
        ) : null}
        {record.task_id ? (
          <span className="tasks-chip" title={record.task_id}>
            {t('tasks.journal.belongsTo', { id: shortId(record.task_id) })}
          </span>
        ) : null}
        {record.error ? (
          <span className="tasks-chip warn" title={record.error}>
            {t('tasks.journal.error', { err: record.error })}
          </span>
        ) : null}
      </div>
      <div className="tasks-goal-actions">
        {isHeld && onCancelHold ? (
          <button
            type="button"
            className="tasks-mini-btn"
            data-testid="journal-cancel-hold"
            title={t('tasks.journal.cancelHoldTip')}
            disabled={busy}
            onClick={() => onCancelHold(record)}
          >
            {t('tasks.journal.cancelHold')}
          </button>
        ) : null}
        {!isHeld && onAskUndo && record.reversible ? (
          <button
            type="button"
            className="tasks-mini-btn"
            data-testid="journal-undo-btn"
            title={t('tasks.journal.undoTip')}
            disabled={busy}
            onClick={() => onAskUndo(record)}
          >
            {t('tasks.journal.undo')}
          </button>
        ) : null}
        {!isHeld && !record.reversible ? (
          <span className="tasks-record-frozen" title={record.undo_spec.reason || t('tasks.journal.notUndoable')}>
            {t('tasks.journal.notUndoable')}
          </span>
        ) : null}
      </div>
    </li>
  )
}
