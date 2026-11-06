/**
 * 代理团队（多 Agent 协作）桌面契约 —— 镜像 jarvis 侧 `agents.exec` / `agents_state`。
 *
 * 唯一真源（改面板前先读这两处；本文件只做「宽容解析 + 类型声明」，
 * 字段一律保持后端 snake_case，不两侧各维护一份命名映射）：
 * - `agent/serve/rpc_agents.py`：快照拼装与 status/stop/message 口径
 * - `agent/collaboration/activity.py`：状态机（starting/running/thinking/idle/
 *   done/failed/stopped）与 current_tool / activity 的含义
 *
 * 两条容易踩错的口径：
 * - **`offline` 是前端专用语义**：团队文件里还在、但本次进程没有活动记录的成员，
 *   后端会补成 `status=offline`，表示「上次没退干净/重启了」。它不是失败，也不
 *   可停止，面板只如实展示。
 * - **`current_tool` 与 `activity` 不是一回事**：前者是工具名 + 参数摘要（机器视角），
 *   后者是一句人话（面板第二行）。两者都可能为空，面板要回落到 `task` 摘要。
 *
 * @author aceFelix
 */

/** 代理状态：starting | running | thinking | idle | offline | done | failed | stopped。 */
export type AgentStatus = string

/** 单个子代理 / 队友的活动记录（后端 AgentActivity.to_dict() + 团队补行）。 */
export interface AgentInfo {
  agent_id: string
  name: string
  /** explorer / researcher / coder / general。 */
  role: string
  /** subagent（一次性同步）/ teammate（持久队友）。 */
  mode: string
  team: string
  status: AgentStatus
  /** 任务摘要（prompt 前 120 字）。 */
  task: string
  /** 当前工具 + 参数摘要（空 = 不在调工具）。 */
  current_tool: string
  /** 一行当前动作人话（面板第二行）。 */
  activity: string
  /** 最近输出摘要（≤200 字）。 */
  output: string
  started_at: number
  updated_at: number
  iterations: number
  tool_calls: number
  error: string
}

/** 团队头信息（来自 ~/.jarvis/teams/<name>/config.json）。 */
export interface TeamInfo {
  name: string
  description: string
  lead_agent_id: string
  member_count: number
}

/** 共享任务台账摘要（队友领取/完成情况）。 */
export interface TeamTaskItem {
  id: string
  subject: string
  status: string
  owner: string
  active_form: string
}

export interface TeamTaskSummary {
  total: number
  pending: number
  in_progress: number
  completed: number
  items: TeamTaskItem[]
}

/** 计数（与后端同一口径；面板头部一行展示）。 */
export interface AgentCounts {
  total: number
  running: number
  idle: number
  offline: number
  done: number
  failed: number
  stopped: number
}

/** `agents.exec status` 回执 / `agents_state` 事件载荷（同一形状）。 */
export interface AgentsSnapshot {
  ok: boolean
  action: string
  message: string
  /** 团队是否已装配（false = 会话还没初始化过，面板显示空态）。 */
  enabled: boolean
  team: TeamInfo
  agents: AgentInfo[]
  counts: AgentCounts
  task_list: TeamTaskSummary
}

/** 一次控制动作的归一结果：业务成败 + 文案 + 最新快照。 */
export interface AgentOpResult {
  ok: boolean
  message: string
  snapshot: AgentsSnapshot | null
}

// ---- 宽容解析：缺字段/坏类型一律落到安全默认，绝不抛异常 ----

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

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function parseAgent(raw: unknown): AgentInfo {
  const d = asRecord(raw)
  return {
    agent_id: asString(d.agent_id),
    name: asString(d.name),
    role: asString(d.role) || 'general',
    mode: asString(d.mode) || 'subagent',
    team: asString(d.team),
    status: asString(d.status) || 'starting',
    task: asString(d.task),
    current_tool: asString(d.current_tool),
    activity: asString(d.activity),
    output: asString(d.output),
    started_at: asNumber(d.started_at),
    updated_at: asNumber(d.updated_at),
    iterations: asNumber(d.iterations),
    tool_calls: asNumber(d.tool_calls),
    error: asString(d.error)
  }
}

function parseCounts(raw: unknown): AgentCounts {
  const d = asRecord(raw)
  return {
    total: asNumber(d.total),
    running: asNumber(d.running),
    idle: asNumber(d.idle),
    offline: asNumber(d.offline),
    done: asNumber(d.done),
    failed: asNumber(d.failed),
    stopped: asNumber(d.stopped)
  }
}

function parseTaskSummary(raw: unknown): TeamTaskSummary {
  const d = asRecord(raw)
  return {
    total: asNumber(d.total),
    pending: asNumber(d.pending),
    in_progress: asNumber(d.in_progress),
    completed: asNumber(d.completed),
    items: asList(d.items).map((item) => {
      const t = asRecord(item)
      return {
        id: asString(t.id),
        subject: asString(t.subject),
        status: asString(t.status),
        owner: asString(t.owner),
        active_form: asString(t.active_form)
      }
    })
  }
}

/**
 * 解析 `agents.exec` 回执 / `agents_state` 载荷。
 *
 * 读侧永不抛异常是后端给的底线（团队未装配也回空快照），前端同样只做默认值
 * 收敛：未连后端时上层直接给 null，不会走到这里。
 * @author aceFelix
 */
export function parseAgentsSnapshot(payload: unknown): AgentsSnapshot {
  const d = asRecord(payload)
  const team = asRecord(d.team)
  return {
    ok: asBool(d.ok),
    action: asString(d.action),
    message: asString(d.message),
    enabled: asBool(d.enabled),
    team: {
      name: asString(team.name),
      description: asString(team.description),
      lead_agent_id: asString(team.lead_agent_id),
      member_count: asNumber(team.member_count)
    },
    agents: asList(d.agents).map(parseAgent),
    counts: parseCounts(d.counts),
    task_list: parseTaskSummary(d.task_list)
  }
}

/** 状态是否属于「正在跑」（面板据此画停止按钮与高亮）。 */
export function isAgentActive(status: AgentStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'thinking'
}

/** 状态是否已收尾（不给控制按钮）。 */
export function isAgentTerminal(status: AgentStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'stopped' || status === 'offline'
}
