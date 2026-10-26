/**
 * 任务中心（阶段 10 · W3）桌面契约 —— 镜像 jarvis 侧 `tasks.exec` / `actions.exec` 回执。
 *
 * 唯一真源（改面板前先读这三处；本文件只做「宽容解析 + 类型声明」，字段一律保持
 * 后端 snake_case，不两侧各维护一份命名映射）：
 * - `agent/serve/rpc_tasks.py`：动词表与安全口径（哪些动作要 confirm 两拍）
 * - `agent/core/tasks/spine_ops.py`：目标与步骤明细的拼装（`goal_detail` / `snapshot`）
 * - `agent/core/actions/journal.py`：副作用账本条目与两种 `undo_spec`
 *
 * 四条容易踩错的口径（都是 2026-10-22 实机走过的路，见 jarvis
 * `docs/fixlogs/w3-driver-approval-blocked-report.md`）：
 * - `driver_running`（线程真的在跑）与 `tasks_config.enabled`（配置意图）是两回事，
 *   只画一个就会出现「面板显示已开、实际没人推」的假可用；
 * - `need_confirm=true` 的回执**一定没有落手**：面板必须把影响面摊开再问一次，
 *   直接把 confirm 补上重发等于跳过用户；
 * - 文件类撤销的粒度是**整轮**（回到本轮开始前的工作区），不是单文件；
 *   `undo_spec.kind='none'` 的项（邮件已发出）永远撤不回，要如实说清；
 * - `denied_tools` 是「批准」能签多大租约的唯一依据：空数组时后端**拒绝放行**，
 *   面板要禁用批准按钮并说明原因，而不是点一次拿一次错误。
 *
 * @author aceFelix
 */

/** 目标状态：active | paused | done | failed | cancelled（后端 GOAL_STATUSES）。 */
export type GoalStatus = string

/** 步骤状态：pending | running | done | blocked | failed（后端 STEP_STATES）。 */
export type StepState = string

/** 阻塞原因：waiting | timeout | error | approval（后端 BLOCK_REASONS）。 */
export type BlockReason = string

/** 账本状态：held | applied | undone | failed | cancelled（后端 ALL_STATES）。 */
export type EffectState = string

/** 等授权中的阻塞原因（只有这一种状态需要「批准」按钮）。 */
export const BLOCK_REASON_APPROVAL = 'approval'

/** 步骤明细中的「当前步」（后端 goal_detail().current_step，驱动器只看这一步）。 */
export interface GoalStepDetail {
  id: string
  desc: string
  state: StepState
  block_reason: BlockReason
  /** 已尝试次数（重试上限由后端 [tasks].step_max_attempts 决定）。 */
  attempts: number
  /** 等待条件的人话摘要（空串 = 没有等待条件）。 */
  wait: string
  /** 最早可再次执行的时刻（ISO 串；空串 = 可立即执行）。 */
  next_run_at: string
  /** 本步产生的副作用账本 id（按目标批量撤销的关联线索）。 */
  journal_ids: string[]
  /** 本轮被权限拦下的工具名（批准按钮的放行范围依据）。 */
  denied_tools: string[]
}

/** 步骤清单项（后端 goal_detail().steps，比当前步少 attempts/block_reason/next_run_at）。 */
export interface GoalStepBrief {
  id: string
  desc: string
  state: StepState
  wait: string
  result: string
  last_error: string
  journal_ids: string[]
  denied_tools: string[]
}

/** 一个跨会话目标（后端 `goal_detail()` 全量字段）。 */
export interface SpineGoal {
  id: string
  goal: string
  status: GoalStatus
  /** 进度文本 "done/total"（后端拼好，面板不重算）。 */
  progress: string
  /** 一行台账摘要（后端 summary_line()，含「等什么 + 最迟」）。 */
  summary: string
  workdir: string
  session_id: string
  created_at: string
  updated_at: string
  current_step: GoalStepDetail | null
  steps: GoalStepBrief[]
}

/** `[tasks]` 里面板要显示的配置（只回开关与阈值，无敏感项）。 */
export interface TasksConfig {
  enabled: boolean
  wait_deadline_hours: number
  step_max_attempts: number
  retry_backoff_s: number
  blocked_ask_days: number
}

/** `tasks.exec` 回执（八个动词共用一个形状，缺省字段用不到就当没发生）。 */
export interface TasksSnapshot {
  ok: boolean
  action: string
  message: string
  goals: SpineGoal[]
  count: number
  /** 驱动线程是否真的在跑（与 tasks_config.enabled 分开画）。 */
  driver_running: boolean
  /** 台账目录（~/.jarvis/goals，面板只展示不解释）。 */
  base_dir: string
  tasks_config: TasksConfig
  /** delete 第一拍：true = 没落手，preview 里是影响面。 */
  need_confirm?: boolean
  /** create 与 delete 第一拍带回的结构化目标（面板不靠文案截 id）。 */
  goal?: SpineGoal
  /** undo_task 等批量动作的逐项结果文本。 */
  items?: string[]
}

/** 补偿计划：checkpoint = 回整轮工作区，none = 明确撤不回（带 reason）。 */
export interface EffectUndoSpec {
  kind: string
  cid?: string
  workdir?: string
  reason?: string
}

/** 一条副作用账本记录（后端 `EffectRecord.to_dict()`）。 */
export interface EffectRecordInfo {
  id: string
  /** 墙上时钟秒（面板格式化，不参与判定）。 */
  ts: number
  tool: string
  /** 一句话预览（含收件人之类的关键信息，是用户看懂"扣住了什么"的唯一线索）。 */
  preview: string
  state: EffectState
  /** 到点执行的时刻（held 项的倒计时依据）。 */
  due_at: number
  /** 归属目标 id（空 = 前台会话产生，不属于任何后台目标）。 */
  task_id: string
  session_id: string
  workdir: string
  /** 后端判定「这条能不能撤」。前端不再自己猜。 */
  reversible: boolean
  error: string
  updated_at: number
  undo_spec: EffectUndoSpec
  /** 冻结的参数（可能含敏感内容，面板默认不展示全文）。 */
  args: Record<string, unknown>
}

/** `[actions]` 配置快照。 */
export interface ActionsConfig {
  undo_window_s: number
  track_local_writes: boolean
  hold_blocks_equivalent: boolean
  irreversible_tools: string[]
}

/** 整轮回滚影响面里的一个文件改动。 */
export interface UndoFileChange {
  /** git 状态首字母：M/A/D。 */
  status: string
  path: string
}

/** `undo` 第一拍的影响面预览（后端 describe 检查点拼装）。 */
export interface UndoPreview {
  files: UndoFileChange[]
  /** 检查点之后新建、回滚时会被删掉的未跟踪文件数。 */
  untracked_count: number
  workdir: string
  /** 后端的整轮提醒文本（必须原样显示，不能省）。 */
  hint: string
}

/** `actions.exec` 回执。 */
export interface ActionsSnapshot {
  ok: boolean
  action: string
  message: string
  /** 账本是否启用；false 时面板显示「未启用」，不给空的撤销按钮。 */
  enabled: boolean
  counts: Record<string, number>
  /** 仍在延时窗口里的预约（可 cancel_hold）。 */
  held: EffectRecordInfo[]
  /** 在窗动作的展示文本（后端登记表原文）。 */
  held_labels: string[]
  /** 当前在窗条数。 */
  window_size: number
  /** 最近记录（可 undo）。 */
  recent: EffectRecordInfo[]
  actions_config: ActionsConfig
  need_confirm?: boolean
  /** undo 第一拍是 UndoPreview；undo_task 第一拍是记录数组（两种形状都可能出现）。 */
  preview?: UndoPreview | EffectRecordInfo[]
  items?: string[]
}

/** 一次动作调用的归一结果：业务成败 + 文案 + 最新快照（面板据此原地刷新）。 */
export interface TaskOpResult<T> {
  ok: boolean
  message: string
  /** 后端在每条回执里都带了整份快照；解析失败时为 null（面板保留旧数据）。 */
  snapshot: T | null
  need_confirm?: boolean
}

// ---- 宽容解析：任何缺字段/坏类型都落到安全默认，绝不抛异常 ----

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function asBool(v: unknown): boolean {
  return v === true
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** 解析步骤明细（current_step；null/缺字段 → null，面板据此少画一行）。 */
function parseStepDetail(raw: unknown): GoalStepDetail | null {
  if (!raw) return null
  const d = asRecord(raw)
  return {
    id: asString(d.id),
    desc: asString(d.desc),
    state: asString(d.state) || 'pending',
    block_reason: asString(d.block_reason),
    attempts: asNumber(d.attempts),
    wait: asString(d.wait),
    next_run_at: asString(d.next_run_at),
    journal_ids: asStringList(d.journal_ids),
    // 旧后端没这个键时给空表：批准按钮据此禁用，而不是点了拿错
    denied_tools: asStringList(d.denied_tools)
  }
}

/** 解析步骤清单项。 */
function parseStepBrief(raw: unknown): GoalStepBrief {
  const d = asRecord(raw)
  return {
    id: asString(d.id),
    desc: asString(d.desc),
    state: asString(d.state) || 'pending',
    wait: asString(d.wait),
    result: asString(d.result),
    last_error: asString(d.last_error),
    journal_ids: asStringList(d.journal_ids),
    denied_tools: asStringList(d.denied_tools)
  }
}

/** 解析一个目标（后端 goal_detail 的全量字段）。 */
export function parseSpineGoal(raw: unknown): SpineGoal {
  const d = asRecord(raw)
  return {
    id: asString(d.id),
    goal: asString(d.goal),
    status: asString(d.status) || 'active',
    progress: asString(d.progress),
    summary: asString(d.summary),
    workdir: asString(d.workdir),
    session_id: asString(d.session_id),
    created_at: asString(d.created_at),
    updated_at: asString(d.updated_at),
    current_step: parseStepDetail(d.current_step),
    steps: asList(d.steps).map(parseStepBrief)
  }
}

/**
 * 解析 `tasks.exec` 回执。
 *
 * 读侧永不抛异常是后端给的底线（账本未启用、台账读不到都回空快照），前端同样
 * 只做默认值收敛：未连后端时上层直接给 null，不会走到这里。
 * @author aceFelix
 */
export function parseTasksSnapshot(payload: unknown): TasksSnapshot {
  const d = asRecord(payload)
  const cfg = asRecord(d.tasks_config)
  return {
    ok: asBool(d.ok),
    action: asString(d.action),
    message: asString(d.message),
    goals: asList(d.goals).map(parseSpineGoal),
    count: asNumber(d.count),
    driver_running: asBool(d.driver_running),
    base_dir: asString(d.base_dir),
    tasks_config: {
      enabled: asBool(cfg.enabled),
      wait_deadline_hours: asNumber(cfg.wait_deadline_hours),
      step_max_attempts: asNumber(cfg.step_max_attempts),
      retry_backoff_s: asNumber(cfg.retry_backoff_s),
      blocked_ask_days: asNumber(cfg.blocked_ask_days)
    },
    need_confirm: d.need_confirm === true,
    goal: d.goal ? parseSpineGoal(d.goal) : undefined,
    items: asStringList(d.items)
  }
}

/** 解析一条账本记录。 */
export function parseEffectRecord(raw: unknown): EffectRecordInfo {
  const d = asRecord(raw)
  return {
    id: asString(d.id),
    ts: asNumber(d.ts),
    tool: asString(d.tool),
    preview: asString(d.preview),
    state: asString(d.state),
    due_at: asNumber(d.due_at),
    task_id: asString(d.task_id),
    session_id: asString(d.session_id),
    workdir: asString(d.workdir),
    reversible: asBool(d.reversible),
    error: asString(d.error),
    updated_at: asNumber(d.updated_at),
    undo_spec: {
      kind: asString(asRecord(d.undo_spec).kind),
      cid: asString(asRecord(d.undo_spec).cid),
      workdir: asString(asRecord(d.undo_spec).workdir),
      reason: asString(asRecord(d.undo_spec).reason)
    },
    args: asRecord(d.args)
  }
}

/** 解析 undo 第一拍的影响面（undo_task 的 preview 是数组，这里会回 null）。 */
export function parseUndoPreview(raw: unknown): UndoPreview | null {
  if (!raw || Array.isArray(raw)) return null
  const d = asRecord(raw)
  if (!Object.keys(d).length) return null
  return {
    files: asList(d.files).map((f) => ({ status: asString(asRecord(f).status), path: asString(asRecord(f).path) })),
    untracked_count: asNumber(d.untracked_count),
    workdir: asString(d.workdir),
    hint: asString(d.hint)
  }
}

/** 解析 `actions.exec` 回执（同样永不抛异常）。 */
export function parseActionsSnapshot(payload: unknown): ActionsSnapshot {
  const d = asRecord(payload)
  const cfg = asRecord(d.actions_config)
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(asRecord(d.counts))) counts[k] = asNumber(v)
  return {
    ok: asBool(d.ok),
    action: asString(d.action),
    message: asString(d.message),
    enabled: asBool(d.enabled),
    counts,
    held: asList(d.held).map(parseEffectRecord),
    held_labels: asStringList(d.held_labels),
    window_size: asNumber(d.window_size),
    recent: asList(d.recent).map(parseEffectRecord),
    actions_config: {
      undo_window_s: asNumber(cfg.undo_window_s),
      track_local_writes: asBool(cfg.track_local_writes),
      hold_blocks_equivalent: asBool(cfg.hold_blocks_equivalent),
      irreversible_tools: asStringList(cfg.irreversible_tools)
    },
    need_confirm: d.need_confirm === true,
    preview: parseUndoPreview(d.preview) ?? (Array.isArray(d.preview) ? asList(d.preview).map(parseEffectRecord) : undefined),
    items: asStringList(d.items)
  }
}

/** 记录 id 的短展示（后端 id 是 12 位 hex，面板只显示前 8 位并保留 title 全文）。 */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/** 墙上时钟秒 → "MM-dd HH:mm"（解析失败原样返回数字串）。 */
export function fmtEpoch(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return String(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}
