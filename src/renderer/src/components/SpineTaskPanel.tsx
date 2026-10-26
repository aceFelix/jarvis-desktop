/**
 * 右栏「任务中心」→「跨会话目标」区块：看目标卡在哪，并就地管控。
 *
 * 设计取向（aceFelix，2026-10 阶段 10 W3）：
 * - **驱动器状态与配置开关分开画**：`driver_running` 是"线程真的在跑"，
 *   `tasks_config.enabled` 是"配置意图"。只画一条就会出现"面板显示已开、实际没人推"
 *   的假可用（W2 感知层同一个坑，后端 snapshot 刻意分两字段回传）。
 * - **删除与批量撤销都是两拍**：第一拍只拿影响面（后端 `need_confirm=true`，
 *   一字未动），把清单摊开后再问一次。跳过第二拍等于替用户做决定。
 * - **批准按钮只在"等授权"时出现，且必须有被拒工具清单**：后端按 `denied_tools`
 *   签发限定范围的租约，清单为空时它会拒绝放行——按钮禁用并说明原因，比点了报错好。
 * - 所有反馈写在面板内（`.tasks-notice`），不进聊天流：这些是运维状态不是对话内容。
 *
 * @author aceFelix
 */

import { useCallback, useEffect, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useTasksStore } from '../stores/tasksStore'
import { goalAwaitingApproval, type GoalControlAction } from '../stores/taskActions'
import {
  shortId,
  type ActionsSnapshot,
  type EffectRecordInfo,
  type SpineGoal,
  type TaskOpResult,
  type TasksSnapshot
} from '../../../shared/tasks-contracts'
import { useT } from '../i18n'

/** 目标状态 → 行首色标类名（与后端 GOAL_STATUSES 对齐，未知值归 to-unknown）。 */
function statusTone(status: string): 'run' | 'pause' | 'done' | 'bad' | 'unknown' {
  if (status === 'active') return 'run'
  if (status === 'paused') return 'pause'
  if (status === 'done') return 'done'
  if (status === 'failed' || status === 'cancelled') return 'bad'
  return 'unknown'
}

export default function SpineTaskPanel(): JSX.Element {
  const t = useT()
  const tasks = useTasksStore((s) => s.tasks)
  const busy = useTasksStore((s) => s.busy)
  const notice = useTasksStore((s) => s.notice)
  const confirm = useTasksStore((s) => s.confirm)
  const setTasks = useTasksStore((s) => s.setTasks)
  const setActions = useTasksStore((s) => s.setActions)
  const setBusy = useTasksStore((s) => s.setBusy)
  const setNotice = useTasksStore((s) => s.setNotice)
  const setConfirm = useTasksStore((s) => s.setConfirm)
  const refreshTasks = useBackendStore((s) => s.refreshTasks)
  const controlGoal = useBackendStore((s) => s.controlGoal)
  const createGoal = useBackendStore((s) => s.createGoal)
  const deleteGoal = useBackendStore((s) => s.deleteGoal)
  const approveStep = useBackendStore((s) => s.approveStep)
  const undoTask = useBackendStore((s) => s.undoTask)

  // 建目标表单：默认收起，右栏空间小，常驻输入框会挤掉真正要看的台账
  const [creating, setCreating] = useState(false)
  const [goalText, setGoalText] = useState('')
  const [waitText, setWaitText] = useState('')

  /**
   * 统一的动作骨架：置忙 → 调用 → 把回执带的快照写回 store → 显示后端原文。
   *
   * 文案一律用后端 `message`（那里才知道到底发生了什么），前端不改写、不美化：
   * 面板把「撤不动」写成「已撤销」就是又一次谎报。泛型 `T` 分开两份快照
   * （tasks.exec 回台账、actions.exec 回账本），由下面两个薄包装指定写回哪一份。
   */
  const runOp = useCallback(
    async <T,>(
      job: () => Promise<TaskOpResult<T | null>>,
      apply: (snapshot: T) => void,
      onDone?: (res: TaskOpResult<T | null>) => void
    ) => {
      setBusy(true)
      try {
        const res = await job()
        if (res.snapshot) apply(res.snapshot)
        setNotice({ text: res.message, tone: res.ok ? 'ok' : 'warn', panel: 'spine' })
        if (res.ok) onDone?.(res)
      } finally {
        setBusy(false)
      }
    },
    [setBusy, setNotice]
  )

  /** tasks.exec 动作：回执里的台账快照回填 `tasksStore.tasks`。 */
  const runTasks = (
    job: () => Promise<TaskOpResult<TasksSnapshot | null>>,
    onDone?: (res: TaskOpResult<TasksSnapshot | null>) => void
  ) => void runOp(job, (snap) => setTasks(snap), onDone)

  /** actions.exec 动作：回执里的账本快照回填 `tasksStore.actions`。 */
  const runActions = (
    job: () => Promise<TaskOpResult<ActionsSnapshot | null>>,
    onDone?: (res: TaskOpResult<ActionsSnapshot | null>) => void
  ) => void runOp(job, (snap) => setActions(snap), onDone)

  const doControl = (action: GoalControlAction, goalId: string) =>
    runTasks(() => controlGoal(action, goalId))

  /** 删除第一拍：拿到影响面就把确认卡挂上（后端一字未动）。 */
  const askDelete = (goal: SpineGoal) =>
    runTasks(
      () => deleteGoal(goal.id, false),
      (res) => {
        if (res.snapshot?.need_confirm !== true) return
        setConfirm({
          kind: 'delete-goal',
          id: goal.id,
          title: goal.goal,
          goal: res.snapshot.goal
        })
      }
    )

  /**
   * 批量撤销第一拍：走 actions.exec，影响面是该目标名下的账本条目清单。
   *
   * 后端 `undo_task` 第一拍的 `preview` 是**数组**（与 `undo` 的对象形影响面不同），
   * 契约里两者共用一个字段，所以这里必须按数组取，不能当 UndoPreview 用。
   */
  const askUndoTask = (goal: SpineGoal) =>
    runActions(
      () => undoTask(goal.id, false),
      (res) => {
        const snap = res.snapshot
        if (!snap?.need_confirm) return
        const records: EffectRecordInfo[] = Array.isArray(snap.preview) ? snap.preview : []
        setConfirm({ kind: 'undo-task', id: goal.id, title: goal.goal, records })
      }
    )

  const submitCreate = () => {
    const text = goalText.trim()
    if (!text) {
      setNotice({ text: t('tasks.goalNeedsText'), tone: 'warn', panel: 'spine' })
      return
    }
    runTasks(
      () => createGoal({ goal: text, wait: waitText.trim() || undefined }),
      () => {
        setCreating(false)
        setGoalText('')
        setWaitText('')
      }
    )
  }

  /** 批准并重试：被拒清单为空时不发请求（后端也会拒，白跑一个往返）。 */
  const doApprove = (goal: SpineGoal) => {
    const step = goal.current_step
    if (!step) return
    if (!step.denied_tools.length) {
      setNotice({ text: t('tasks.approveNoTools'), tone: 'warn', panel: 'spine' })
      return
    }
    runTasks(() => approveStep(goal.id, step.id))
  }

  /** 第二拍落手：按确认卡的种类重发同一动词并带上 confirm。 */
  const doConfirm = () => {
    const pending = confirm
    if (!pending) return
    if (pending.kind === 'delete-goal') {
      runTasks(() => deleteGoal(pending.id, true), () => setConfirm(null))
    } else {
      runActions(() => undoTask(pending.id, true), () => setConfirm(null))
    }
  }

  // 挂载即拉一次：面板可能比 init 事件晚开（右栏折叠过），自己保证首屏有数据。
  // 与播报刷新同一个入口 refreshTasks（台账 + 账本两份快照一起回）。
  useEffect(() => {
    void refreshTasks()
  }, [refreshTasks])

  const snap = tasks
  const goals = snap?.goals ?? []
  const driverLine = !snap
    ? t('tasks.offline')
    : snap.driver_running
      ? t('tasks.driverOn')
      : snap.tasks_config.enabled
        ? t('tasks.driverOff')
        : t('tasks.configOff')

  return (
    <div className="tasks-block" data-testid="spine-task-panel">
      <div className="tasks-head" data-testid="spine-driver-line">
        <span className={snap?.driver_running ? 'tasks-driver-on' : 'tasks-driver-off'}>{driverLine}</span>
        <span className="tasks-head-actions">
          <button type="button" className="tasks-mini-btn" title={t('tasks.refreshTip')} disabled={busy} onClick={() => void refreshTasks()}>
            {t('tasks.refresh')}
          </button>
          {!creating ? (
            <button type="button" className="tasks-mini-btn" disabled={busy} onClick={() => setCreating(true)}>
              {t('tasks.create')}
            </button>
          ) : null}
        </span>
      </div>

      {creating ? (
        <div className="tasks-form" data-testid="spine-create-form">
          <input
            className="model-input"
            data-testid="spine-goal-input"
            value={goalText}
            placeholder={t('tasks.goalPlaceholder')}
            onChange={(e) => setGoalText(e.target.value)}
          />
          <input
            className="model-input"
            data-testid="spine-wait-input"
            value={waitText}
            placeholder={t('tasks.waitPlaceholder')}
            onChange={(e) => setWaitText(e.target.value)}
          />
          <div className="tasks-form-actions">
            <button type="button" className="tasks-mini-btn primary" disabled={busy} onClick={submitCreate}>
              {t('tasks.submit')}
            </button>
            <button type="button" className="tasks-mini-btn" disabled={busy} onClick={() => setCreating(false)}>
              {t('tasks.formCancel')}
            </button>
          </div>
        </div>
      ) : null}

      {goals.length ? (
        <ul className="tasks-goal-ul" data-testid="spine-goal-list">
          {goals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              busy={busy}
              onControl={doControl}
              onAskDelete={askDelete}
              onAskUndoTask={askUndoTask}
              onApprove={doApprove}
            />
          ))}
        </ul>
      ) : (
        <div className="side-empty" data-testid="spine-goal-empty">
          {t('tasks.empty')}
        </div>
      )}

      {confirm?.kind === 'delete-goal' || confirm?.kind === 'undo-task' ? (
        <div className="tasks-confirm" data-testid="spine-confirm">
          <div className="tasks-confirm-title">
            {confirm.kind === 'delete-goal' ? t('tasks.confirmDelete.title') : t('tasks.confirmUndoTask.title')}
          </div>
          <div className="tasks-confirm-target" title={confirm.id}>
            {confirm.title || shortId(confirm.id)}
          </div>
          {confirm.kind === 'delete-goal' ? (
            <div className="setting-hint">{t('tasks.confirmDelete.hint')}</div>
          ) : (
            <ul className="tasks-confirm-ul">
              {(confirm.records ?? []).map((r) => (
                <li key={r.id} className="tasks-confirm-li" title={r.preview}>
                  {r.tool} · {r.preview || shortId(r.id)}
                </li>
              ))}
              {!confirm.records?.length ? <li className="tasks-confirm-li">{t('tasks.confirm.emptyPreview')}</li> : null}
            </ul>
          )}
          <div className="tasks-form-actions">
            <button
              type="button"
              className="tasks-mini-btn primary"
              disabled={busy}
              data-testid="spine-confirm-do"
              onClick={doConfirm}
            >
              {t('tasks.confirm.doIt')}
            </button>
            <button type="button" className="tasks-mini-btn" disabled={busy} onClick={() => setConfirm(null)}>
              {t('tasks.confirm.back')}
            </button>
          </div>
        </div>
      ) : null}

      {notice?.panel === 'spine' && notice.text ? (
        <div className={`tasks-notice tone-${notice.tone}`} data-testid="spine-notice">
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}

/** 单个目标行：状态 + 进度 + 「等什么/最迟/被拦」说明 + 操作按钮组。 */
function GoalRow({
  goal,
  busy,
  onControl,
  onAskDelete,
  onAskUndoTask,
  onApprove
}: {
  goal: SpineGoal
  busy: boolean
  onControl: (action: GoalControlAction, goalId: string) => void
  onAskDelete: (goal: SpineGoal) => void
  onAskUndoTask: (goal: SpineGoal) => void
  onApprove: (goal: SpineGoal) => void
}): JSX.Element {
  const t = useT()
  const step = goal.current_step
  const awaiting = goalAwaitingApproval(goal)
  const paused = goal.status === 'paused'
  const open = goal.status === 'active' || paused

  return (
    <li className="tasks-goal" data-testid="spine-goal" title={goal.summary || goal.goal}>
      <div className="tasks-goal-main">
        <span className={`tasks-goal-dot to-${statusTone(goal.status)}`} />
        <span className="tasks-goal-text">{goal.goal}</span>
        <span className="tasks-goal-progress">{goal.progress}</span>
      </div>
      {step ? (
        <div className="tasks-goal-meta">
          {awaiting ? <span className="tasks-chip warn">{t('tasks.awaitingApproval')}</span> : null}
          {step.wait ? <span className="tasks-chip">{t('tasks.stepWait', { wait: step.wait })}</span> : null}
          {step.next_run_at ? <span className="tasks-chip">{t('tasks.stepNextRun', { when: step.next_run_at })}</span> : null}
          {step.attempts > 0 ? <span className="tasks-chip">{t('tasks.stepAttempts', { n: String(step.attempts) })}</span> : null}
          {step.denied_tools.length ? (
            <span className="tasks-chip warn">{t('tasks.deniedBy', { tools: step.denied_tools.join('、') })}</span>
          ) : null}
        </div>
      ) : null}
      {goal.steps.length > 1 ? (
        <details className="tasks-steps">
          <summary>{t('tasks.stepsToggle')}</summary>
          <ul className="tasks-steps-ul">
            {goal.steps.map((s) => (
              <li key={s.id} className="tasks-steps-li" title={s.result || s.last_error || s.desc}>
                <span className={`tasks-goal-dot to-${s.state}`}>{s.state === 'done' ? '✓' : '·'}</span> {s.desc}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {open ? (
        <div className="tasks-goal-actions">
          {/* 批准只在“目标还在跑且等授权”时出现：暂停中的目标驱动器不会重试，
              签了租约也只是放着过期，先给「继续」才对得上用户的意图。
              @author aceFelix */}
          {awaiting && !paused ? (
            <button
              type="button"
              className="tasks-mini-btn primary"
              data-testid="spine-approve-btn"
              disabled={busy}
              title={step?.denied_tools.length ? step.denied_tools.join('、') : t('tasks.approveNoTools')}
              onClick={() => onApprove(goal)}
            >
              {t('tasks.approve')}
            </button>
          ) : (
            <button
              type="button"
              className="tasks-mini-btn"
              disabled={busy}
              onClick={() => onControl(paused ? 'resume' : 'pause', goal.id)}
            >
              {paused ? t('tasks.resume') : t('tasks.pause')}
            </button>
          )}
          {step?.wait ? (
            <button type="button" className="tasks-mini-btn" disabled={busy} onClick={() => onControl('advance', goal.id)}>
              {t('tasks.advance')}
            </button>
          ) : null}
          <button type="button" className="tasks-mini-btn" disabled={busy} onClick={() => onAskUndoTask(goal)}>
            {t('tasks.undoTask')}
          </button>
          <button type="button" className="tasks-mini-btn" disabled={busy} onClick={() => onControl('cancel', goal.id)}>
            {t('tasks.abort')}
          </button>
          <button type="button" className="tasks-mini-btn danger" disabled={busy} onClick={() => onAskDelete(goal)}>
            {t('tasks.remove')}
          </button>
        </div>
      ) : null}
    </li>
  )
}
