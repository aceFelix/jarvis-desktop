/**
 * 感知层（阶段 9 · W2）桌面契约 —— 镜像 jarvis 侧 `percept.*` 两条指令的回执。
 *
 * 为什么独立成文件（aceFelix，2026-10）：`contracts.ts` 已近 800 行上限，而感知
 * 面板的类型面很宽（逐源状态 + 源自报细节 + 事件明细 + 可编辑配置快照）。契约的
 * **唯一真源仍是后端**：`agent/core/percept/status.py`（状态拼装）与
 * `agent/config/percept_settings.py`（可改白名单）。本文件只做「宽容解析 + 类型
 * 声明」，字段名一律保持后端的 snake_case，避免两侧各自维护一份命名映射。
 *
 * 口径承诺（与后端注释同源，改动前请先读那两个文件）：
 * - `sources[].enabled` 是「总开关 AND 逐源开关」的**装配期结论**，不是运行时事实；
 *   运行时以 `registered`（总线有没有这个源）与 `bus_enabled` 判断；
 * - 未装配的收编位（阶段 11 之后只剩 schedule）`implemented=false` 且带
 *   `pending_reason`，面板**刻意不给开关**——有开关背后没人采比没有开关更糟；
 * - `hot_applied` 只在 `percept.config.set` 的回执里出现：false = 配置已落盘但
 *   本次会话没重装配（宿主不在或装配抛错），面板须提示「需重启才生效」。
 *
 * @author aceFelix
 */

/** 单源总线账本（后端 `PerceptBus.stats().sources[name]`；源未注册时为 `{}`）。 */
export interface PerceptSourceStats {
  /** 该源在总线里是否启用（与 enabled 的区别：这是运行期实例的标记）。 */
  enabled: boolean
  /** 轮询间隔秒（0 = 事件驱动/不自轮询，如窗口钩子与 IMAP IDLE）。 */
  interval_s: number
  /** 已投递事件条数。 */
  events: number
  /** 采集计数（含被去重合并的）。 */
  collected: number
  /** 连续失败次数（达阈值自动停用）。 */
  errors: number
  /** 是否已被系统熔断停用。 */
  auto_disabled: boolean
  /** 末次错误摘要（空串 = 没有）。 */
  last_error: string
}

/** 单条感知事件（后端 `PerceptEvent.to_dict()`，面板「到底采到了什么」自查用）。 */
export interface PerceptEventInfo {
  /** 墙上时钟秒（Unix 时间戳，面板格式化成 HH:mm）。 */
  ts: number
  source: string
  kind: string
  /** 事件负载：后端保证有 `summary`（人话摘要），其余字段按源而异。 */
  payload: Record<string, unknown>
  /** 显著性先验（0-1，三道闸的地板分入参）。 */
  salience_hint: number
  /** 去重键。 */
  dedup_key: string
}

/** 逐源状态（`percept.status.get` 的 sources 项）。 */
export interface PerceptSourceInfo {
  name: string
  /** 面板标题（中文，后端给的单一真源）。 */
  label: string
  /** 一句话说明：这个源采什么、不采什么。 */
  hint: string
  /** 总开关 AND 逐源开关（面板上的勾选态）。 */
  enabled: boolean
  /** 本期是否已实现（false = 收编位，灰显不给开关）。 */
  implemented: boolean
  /** 总线里是否注册了该源（宿主接线 + 装配成功才为 true）。 */
  registered: boolean
  /** 运行期实例的启用标记。 */
  bus_enabled: boolean
  stats: PerceptSourceStats
  /** 源自报细节（`source.state()`）：观察目录、登记仓库、末次错误原因等。 */
  detail: Record<string, unknown>
  /** 未装配的固定理由（已实现源为空串）。 */
  pending_reason: string
}

/** 面板可改的 `[percept]` 配置快照（后端 `read_percept_config`）。 */
export interface PerceptConfig {
  enabled: boolean
  window_enabled: boolean
  file_enabled: boolean
  vcs_enabled: boolean
  mail_enabled: boolean
  vision_enabled: boolean
  /** 本地留痕（jsonl）开关：出厂默认开，关掉后面板只剩内存态历史。 */
  log_events: boolean
  file_watch_dirs: string[]
  vcs_repos: string[]
  mail_watch_senders: string[]
  window_exclude_apps: string[]
  /** 前台窗口停留提醒阈值分钟（0 = 不提醒）。 */
  window_linger_minutes: number
  /** 摄像头空闲自动关闭分钟（0 = 不自动关闭）。 */
  vision_auto_stop_minutes: number
}

/**
 * `percept.config.set` 请求补丁：只提交实际改动的键。
 * 后端白名单外的键**直接报错**（不是静默忽略），类型收窄即第一道防线。
 */
export type PerceptConfigPatch = Partial<PerceptConfig>

/** W1 打扰预算的当前状态（回答“采到了为什么不说”的那一行）。 */
export interface NotifyBudget {
  /** 计数所属日期（后端按日重置）。 */
  day: string
  /** 今日已播次数。 */
  count: number
  /** 每日播报上限（<=0 = 后端没给，面板不显示那一行）。 */
  daily_max: number
  /** 入库待补播的条数（静默时段与超额度攒下的）。 */
  pending: number
  /** 静默时段（"HH:MM-HH:MM"，空串 = 未启用）。 */
  quiet_hours: string
}

/** `percept.status.get` / `percept.config.set` 共同的回执结构（后者多两字段）。 */
export interface PerceptStatus {
  enabled: boolean
  /** 宿主是否已接线（serve 场景）：区分「没接线」与「接了线但全关」。 */
  assembled: boolean
  bus_running: boolean
  /** 三道闸计数：emit / dedup / throttle / low_salience / no_subscriber 等。 */
  counters: Record<string, number>
  dedup_window_s: number
  /** 留痕文件绝对路径（空串 = 没开留痕）。 */
  log_file: string
  log_events: boolean
  sources: PerceptSourceInfo[]
  /** 最近事件（倒序，最新在前）。 */
  recent_events: PerceptEventInfo[]
  /** 未装配的收编位名单。 */
  pending: string[]
  /** 面板可编辑的配置快照（编辑表单的回填数据源）。 */
  config: PerceptConfig
  /**
   * W1 打扰预算快照；null = 预算未启用或后端版本不认识这个字段。
   * 感知事件被门槛判为“不值得打扰”时不会出现在任何计数里，
   * 面板需要这一行才能解释“jsonl 在涨但没人吵我”。
   */
  notify_budget: NotifyBudget | null
  /** 本次保存后宿主是否真的重装配过（null = 这是只读快照、没有保存语义）。 */
  hot_applied: boolean | null
  /** 本次实际写入的规范化补丁（null = 同上）。 */
  applied: PerceptConfigPatch | null
}

/** 空配置（解析兜底：全关 + 空名单，与后端出厂缺省一致，仅 log_events 默认开）。 */
function emptyConfig(): PerceptConfig {
  return {
    enabled: false,
    window_enabled: false,
    file_enabled: false,
    vcs_enabled: false,
    mail_enabled: false,
    vision_enabled: false,
    log_events: true,
    file_watch_dirs: [],
    vcs_repos: [],
    mail_watch_senders: [],
    window_exclude_apps: [],
    window_linger_minutes: 0,
    vision_auto_stop_minutes: 0
  }
}

const BOOL_KEYS: Array<keyof PerceptConfig> = [
  'enabled',
  'window_enabled',
  'file_enabled',
  'vcs_enabled',
  'mail_enabled',
  'vision_enabled',
  'log_events'
]
const LIST_KEYS: Array<keyof PerceptConfig> = [
  'file_watch_dirs',
  'vcs_repos',
  'mail_watch_senders',
  'window_exclude_apps'
]
const INT_KEYS: Array<keyof PerceptConfig> = ['window_linger_minutes', 'vision_auto_stop_minutes']

/** 字符串数组宽容解析：非数组回空，非字符串项丢弃，逐项 trim 去空。 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const item = raw.trim()
    if (item && !out.includes(item)) out.push(item)
  }
  return out
}

/**
 * `[percept]` 配置快照解析：只认白名单里的键，类型不符逐项回落缺省。
 *
 * 注意 `log_events` 的缺省是 **true**（出厂默认开），所以后端没给这个键时不能
 * 按 falsy 兜底成「已关」——那是把「没配过」误显成「用户已关」。
 * @author aceFelix
 */
export function parsePerceptConfig(payload: unknown): PerceptConfig {
  const p = (payload ?? {}) as Record<string, unknown>
  // 先落回一份无类型中间物再整体转回来：`cfg[key] = v` 在 key 是联合类型时
  // 写入类型会被收窄成 never（各键值类型不同），绕开它比逐个写 13 行赋值更轻；
  // 起步仍是空配置缺省（接口没有字符串索引签名，需先转成 Record 才能拷进中间物）
  const cfg: Record<string, unknown> = {
    ...(emptyConfig() as unknown as Record<string, unknown>)
  }
  for (const key of BOOL_KEYS) {
    if (typeof p[key] === 'boolean') cfg[key] = p[key]
  }
  for (const key of LIST_KEYS) {
    cfg[key] = toStringList(p[key])
  }
  for (const key of INT_KEYS) {
    const v = p[key]
    if (typeof v === 'number' && Number.isFinite(v)) cfg[key] = Math.trunc(v)
  }
  return cfg as unknown as PerceptConfig
}

/** 单源账本解析（未注册的源后端回 `{}`，这里回一份全零账本供渲染取用）。 */
function parseSourceStats(payload: unknown): PerceptSourceStats {
  const p = (payload ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0)
  return {
    enabled: p.enabled === true,
    interval_s: num(p.interval_s),
    events: num(p.events),
    collected: num(p.collected),
    errors: num(p.errors),
    auto_disabled: p.auto_disabled === true,
    last_error: typeof p.last_error === 'string' ? p.last_error : ''
  }
}

/** 逐源项解析：缺 label/hint 回落源名，detail/stats 缺失回空对象。 */
function parseSource(payload: unknown): PerceptSourceInfo | null {
  const p = (payload ?? {}) as Record<string, unknown>
  const name = typeof p.name === 'string' ? p.name : ''
  if (!name) return null
  return {
    name,
    label: typeof p.label === 'string' && p.label ? p.label : name,
    hint: typeof p.hint === 'string' ? p.hint : '',
    enabled: p.enabled === true,
    implemented: p.implemented === true,
    registered: p.registered === true,
    bus_enabled: p.bus_enabled === true,
    stats: parseSourceStats(p.stats),
    detail: (p.detail ?? {}) as Record<string, unknown>,
    pending_reason: typeof p.pending_reason === 'string' ? p.pending_reason : ''
  }
}

/** 事件解析：source/kind 缺失的脏数据直接丢掉（面板不做半截渲染）。 */
function parseEvent(payload: unknown): PerceptEventInfo | null {
  const p = (payload ?? {}) as Record<string, unknown>
  if (typeof p.source !== 'string' || typeof p.kind !== 'string') return null
  const hint = typeof p.salience_hint === 'number' && Number.isFinite(p.salience_hint) ? p.salience_hint : 0.5
  return {
    ts: typeof p.ts === 'number' && Number.isFinite(p.ts) ? p.ts : 0,
    source: p.source,
    kind: p.kind,
    payload: (p.payload ?? {}) as Record<string, unknown>,
    salience_hint: hint,
    dedup_key: typeof p.dedup_key === 'string' ? p.dedup_key : ''
  }
}

/** 规范化补丁回读（`applied`）：只保留白名单里类型正确的键。 */
function parseApplied(payload: unknown): PerceptConfigPatch | null {
  if (!payload || typeof payload !== 'object') return null
  const merged = { ...emptyConfig(), ...parsePerceptConfig(payload) }
  const raw = payload as Record<string, unknown>
  const out: PerceptConfigPatch = {}
  for (const key of [...BOOL_KEYS, ...LIST_KEYS, ...INT_KEYS]) {
    if (key in raw) (out as Record<string, unknown>)[key] = merged[key]
  }
  return out
}

/**
 * 打扰预算段的宽容解析：缺字段回默认值，整个字段缺失/类型不对回 null。
 *
 * 回 null 而不是零值对象：面板要能区分“预算未启用”与“今日一次没播”，
 * 前者不该显示那一行，后者是正常状态。
 * @author aceFelix
 */
function parseNotifyBudget(raw: unknown): NotifyBudget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
  const dailyMax = num(p.daily_max)
  if (dailyMax <= 0) return null
  return {
    day: typeof p.day === 'string' ? p.day : '',
    count: num(p.count),
    daily_max: dailyMax,
    pending: num(p.pending),
    quiet_hours: typeof p.quiet_hours === 'string' ? p.quiet_hours : ''
  }
}

/**
 * `percept.status.get` / `percept.config.set` 回执的宽容解析。
 *
 * 原则与 parseEmailConfig 一致：**读侧永不抛异常**，坏字段回落安全默认值，
 * 面板拿到的一定是可渲染的结构（后端版本先行、桌面后行时也不会白屏）。
 * @author aceFelix
 */
export function parsePerceptStatus(payload: unknown): PerceptStatus {
  const p = (payload ?? {}) as Record<string, unknown>
  const counters: Record<string, number> = {}
  const rawCounters = (p.counters ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(rawCounters)) {
    if (typeof v === 'number' && Number.isFinite(v)) counters[k] = Math.trunc(v)
  }
  const sources = Array.isArray(p.sources)
    ? (p.sources.map(parseSource).filter(Boolean) as PerceptSourceInfo[])
    : []
  const recentEvents = Array.isArray(p.recent_events)
    ? (p.recent_events.map(parseEvent).filter(Boolean) as PerceptEventInfo[])
    : []
  return {
    enabled: p.enabled === true,
    assembled: p.assembled === true,
    bus_running: p.bus_running === true,
    counters,
    dedup_window_s:
      typeof p.dedup_window_s === 'number' && Number.isFinite(p.dedup_window_s)
        ? Math.trunc(p.dedup_window_s)
        : 0,
    log_file: typeof p.log_file === 'string' ? p.log_file : '',
    log_events: typeof p.log_events === 'boolean' ? p.log_events : true,
    sources,
    recent_events: recentEvents,
    pending: toStringList(p.pending),
    config: parsePerceptConfig(p.config),
    notify_budget: parseNotifyBudget(p.notify_budget),
    hot_applied: typeof p.hot_applied === 'boolean' ? p.hot_applied : null,
    applied: parseApplied(p.applied)
  }
}

/** 事件摘要（后端保证 `payload.summary` 存在；缺失时退回 kind，绝不渲染空行）。 */
export function perceptEventSummary(event: PerceptEventInfo): string {
  const summary = event.payload.summary
  if (typeof summary === 'string' && summary.trim()) return summary.trim()
  return event.kind
}

/** 事件秒级时间戳 → `HH:mm`（本地时区；ts 非法回空串，由调用方兜底）。 */
export function formatEventTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 源自报细节（`source.state()`）的可视化行。
 *
 * 只保留能一眼读懂的标量与字符串数组（布尔用中性符号），嵌套对象/空值跳过：
 * 面板的职责是「让用户看见采集范围」，不是把后端内部结构照搬过来。键名**故意
 * 不翻译**——它们由后端各源自报、命名会随实现演进，前端手抄一份对照表必定漂移。
 * @author aceFelix
 */
export function perceptDetailEntries(
  detail: Record<string, unknown>
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  for (const [key, value] of Object.entries(detail ?? {})) {
    if (typeof value === 'string') {
      if (value.trim()) out.push({ key, value: value.trim() })
    } else if (typeof value === 'number') {
      out.push({ key, value: String(value) })
    } else if (typeof value === 'boolean') {
      out.push({ key, value: value ? '✓' : '—' })
    } else if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === 'string' && !!v.trim())
      if (items.length) out.push({ key, value: items.join(' · ') })
    }
    // 其余（对象/null/空数组）不展示：嵌套结构属于实现细节
  }
  return out
}

/** 闸门计数的展示行（后端 counters 是开放字典，新闸门口径不需改前端就能显示）。 */
export function perceptCounterEntries(counters: Record<string, number>): Array<{ key: string; value: number }> {
  return Object.entries(counters ?? {})
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
}

/** 面板上有对应开关的源（与后端 `PERCEPT_CONFIG_FIELDS` 的 `*_enabled` 一致）。 */
const ENABLE_KEYS: ReadonlySet<string> = new Set([
  'window_enabled',
  'file_enabled',
  'vcs_enabled',
  'mail_enabled',
  'vision_enabled',
  'calendar_enabled',
  'system_enabled'
])

/** 感知段里非开关、但也会影响面板展示的键（阶段 12 模型可改的那几项）。 */
const PERCEPT_PARAM_KEYS: ReadonlySet<string> = new Set(['window_linger_minutes'])

/**
 * 该协议键是否属于感知配置（模型改完要连带刷新感知源面板）。
 *
 * 与 `ENABLE_KEYS` 的区别：这里要多认一个总开关——它在协议层叫
 * `percept_enabled`，而面板内部的 `PerceptConfig` 叫 `enabled`，直接拿
 * `ENABLE_KEYS` 判会漏掉“模型把感知整个关了”这件事。
 *
 * 判错的代价不对称：多认一个只是多拉一次 `percept.status.get`（便宜），
 * 漏认则面板一直显示旧开关（用户以为没关）。
 * @author aceFelix
 */
export function isPerceptConfigKey(key: string): boolean {
  return key === 'percept_enabled' || ENABLE_KEYS.has(key) || PERCEPT_PARAM_KEYS.has(key)
}

/**
 * 源名 → 面板可改的逐源开关键（`${name}_enabled`）。
 *
 * 不在白名单里（阶段 11 之后只剩 schedule 一个收编位）回空串，
 * 调用方据此**不给开关**：比“开关点了采不到东西”更好的设计是没有开关。
 * @author aceFelix
 */
export function perceptEnableKey(name: string): string {
  const candidate = `${name}_enabled`
  return ENABLE_KEYS.has(candidate) ? candidate : ''
}
