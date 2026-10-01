/**
 * 主进程 / preload / 渲染进程共享契约。
 *
 * 与 jarvis 侧 `agent/serve/protocol.py` 一一对应（唯一契约来源在 Python 侧，
 * 此处是 TypeScript 镜像；两边改动必须同步）。
 *
 * @author aceFelix
 */

/** serve 进程 stdout 握手 JSON（单行，type 为就绪标记）。 */
export interface HandshakeInfo {
  type: 'jarvis-serve-ready'
  /** WebSocket 端口（渲染进程连它）。 */
  port: number
  /** HTTP 静态服务端口（一期未用，保留）。 */
  http_port: number
  /** WS 认证 token（不落盘、不进 localStorage）。 */
  token: string
  /** serve 进程 PID（诊断用）。 */
  pid: number
}

/** 握手标记值（与 protocol.SERVE_READY_MARKER 对齐）。 */
export const SERVE_READY_MARKER = 'jarvis-serve-ready'

/** 交给渲染进程的后端连接信息（握手 JSON 去掉 type 标记）。 */
export interface BackendInfo {
  port: number
  httpPort: number
  token: string
  pid: number
}

/** 后端生命周期状态（渲染进程据此显示启动进度/错误）。 */
export type BackendState = 'idle' | 'spawning' | 'ready' | 'error' | 'exited'

/** 主进程 → 渲染进程的状态推送 payload。 */
export interface BackendStatusEvent {
  state: BackendState
  info?: BackendInfo
  error?: string
}

/** IPC 通道名集中管理（preload 与主进程共用，防字符串漂移）。 */
export const IpcChannels = {
  /** invoke：取后端连接信息（未就绪返回 null）。 */
  GetBackendInfo: 'jarvis:get-backend-info',
  /** invoke：窗口控制（minimize / close）。 */
  WindowControl: 'jarvis:window-control',
  /** 主进程 → 渲染进程：后端状态变化推送。 */
  BackendStatus: 'jarvis:backend-status',
  /** 渲染进程 → 主进程：日志桥（写入 userData/logs/desktop.log，现场诊断用）。 */
  RendererLog: 'jarvis:renderer-log',
  /** 渲染进程 → 主进程：系统通知（主动播报弹 Windows 通知，单向 send）。 */
  SystemNotify: 'jarvis:system-notify',
  /** invoke：截取主屏缩略图（右栏快捷操作「截屏发给贾维斯」）。 */
  CaptureScreen: 'jarvis:capture-screen',
  /**
    * invoke：弹出系统目录选择器（左栏「项目」区「打开文件夹」）。
   * 返回选中绝对路径或 null（取消）。后端对路径做二次校验，不自动建目录。
   * @author aceFelix
   */
  SelectDirectory: 'jarvis:select-directory'
} as const

/** 截屏结果（主进程 desktopCapturer → 渲染进程附件区）。 */
export interface ScreenCapture {
  /** PNG base64（随 message 指令 images 字段上送，走 vision）。 */
  data: string
  media_type: string
}

/** 系统通知请求体（渲染进程 → 主进程，主进程 Electron Notification 弹窗）。 */
export interface NotifyRequest {
  title: string
  body: string
}

/**
 * 主动播报事件 payload（镜像 protocol.EVT_PROACTIVE_NOTIFY，源自 ProactiveHub）。
 *
 * kind：briefing=每日简报 / reminder=用户提醒 / deadline=截止日期提醒。
 * task_id 仅 reminder 携带（窗口可见时回 proactive.ack 停止升级重发）。
 */
export interface ProactiveNotifyPayload {
  kind: 'briefing' | 'reminder' | 'deadline' | string
  title: string
  text: string
  task_id?: string
}

/** 窗口控制动作（自绘标题栏按钮）。 */
export type WindowAction = 'minimize' | 'close'

/**
 * 后端联动设置镜像（settings.get 白名单键，与 jarvis 侧
 * agent/config/desktop_settings.py 的 DESKTOP_SETTING_SPECS 同口径）。
 *
 * 第一批：主动播报 TTS / 每日简报 / 截止日期追踪 / TTS 音量语速；
 * null = 尚未拉取/后端未连接（面板据此显离线态）。
 * 主题/语言等纯前端偏好不入此协议（桌面壳 localStorage 自治）。
 */
export interface BackendSettings {
  proactive_tts_enabled: boolean | null
  briefing_enabled: boolean | null
  briefing_time: string | null
  deadline_enabled: boolean | null
  deadline_check_time: string | null
  tts_volume: number | null
  tts_speech_rate: number | null
}

/** BackendSettings 的键集合（面板渲染/测试遍历用）。 */
export type BackendSettingKey = keyof BackendSettings

/** settings.get 回执 result 的宽容解析：类型不符/缺字段一律置 null（离线态）。 */
export function parseBackendSettings(payload: unknown): BackendSettings {
  const p = (payload ?? {}) as Record<string, unknown>
  const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
  const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const asNum = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  return {
    proactive_tts_enabled: asBool(p.proactive_tts_enabled),
    briefing_enabled: asBool(p.briefing_enabled),
    briefing_time: asStr(p.briefing_time),
    deadline_enabled: asBool(p.deadline_enabled),
    deadline_check_time: asStr(p.deadline_check_time),
    tts_volume: asNum(p.tts_volume),
    tts_speech_rate: asNum(p.tts_speech_rate)
  }
}

/**
 * 旧名兼容别名：设置面板 payload 即白名单键镜像。
 * @deprecated 新代码直接用 BackendSettings。
 */
export type SettingsPayload = Partial<BackendSettings>

/**
 * 半双工语音会话状态（镜像 voice_events.STATE_*）。
 *
 * voice_state 事件的 payload 即此字符串：dialog=对话中 / listening=聆听 /
 * thinking=思考 / speaking=播报 / standby=待机 / exited=已退出。
 */
export type VoiceState =
  | 'dialog'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'standby'
  | 'exited'

/** models.add 入参（左栏「添加模型」表单；字段与 serve _rpc_models_add 同口径）。 */
export interface ModelAddPayload {
  name: string
  /** 模型厂商（写入 provider/vendor），如 deepseek / dashscope。 */
  vendor: string
  /** 接口类型（api_format）：openai / anthropic / dashscope / zai。 */
  api_format: string
  /** 留空则由后端按厂商 + 接口类型推断（与 /models 添加口径一致）。 */
  base_url: string
  /** 留空则用全局 Key（环境变量）；非空时后端同步写入系统 keyring。 */
  api_key: string
  /** text（纯文本）/ multimodal（支持图片）。 */
  model_type: string
}

/**
 * 模型配置默认值（models.list 每项 config 字段，编辑表单预填用）。
 *
 * has_key 是「有没有 Key」的布尔值 —— 明文密钥不回传渲染进程，
 * 因此表单里 Key 留空表示「保持原 Key 不变」（见 ModelEditPayload）。
 */
export interface ModelConfigDraft {
  vendor: string
  api_format: string
  base_url: string
  model_type: string
  has_key: boolean
}

/**
 * models.edit 入参（左栏双击模型项 → 编辑表单；与 serve _rpc_models_edit 同口径）。
 *
 * 与 models.add 的差异：所有字段留空 = 沿用现值（不填默认值），
 * api_key 留空 = **保持原 Key 不变**（桌面壳不回显密钥，不能把「未填」当清空）；
 * new_name 非空且与原名不同 = 改名（仅自定义模型，内置模型名固定）。
 */
export interface ModelEditPayload {
  name: string
  /** 新模型名（留空 = 不改名；内置模型改名会被后端拒绝）。 */
  new_name?: string
  vendor?: string
  api_format?: string
  base_url?: string
  api_key?: string
  model_type?: string
}

/** models.edit 回执 result（hot_switched=true 表示已入队强制热切换运行中的模型）。 */
export interface ModelEditResult {
  name: string
  vendor: string
  api_format: string
  base_url: string
  model_type: string
  hot_switched: boolean
}

/** models.remove 回执 result（was_current=true 时前端提示「当前仍在使用该模型」）。 */
export interface ModelRemoveResult {
  name: string
  was_current: boolean
}

/**
 * TTS 音色目录项（voices.list 每项，2026-09-28 音色-模型适配）。
 *
 * 镜像 jarvis 侧 WorkbenchAPI.list_voices：全量内置+自定义目录，当前音色置顶。
 * model = 适配模型（空 = 不限）；linked = 点选后将联动切换的 TTS 模型
 *（兼容/不限时 null，前端据此预告）；custom=true 项可双击编辑/右键删除。
 */
export interface VoiceCatalogItem {
  name: string
  /** DashScope voice 参数（内置音色 name 即 voice_id；复刻音色为 voice_id）。 */
  voice_id: string
  description: string
  vendor: string
  /** 适配模型（家族前缀或具体模型，逗号分隔多值；空串 = 不限）。 */
  model: string
  /** 点选后将联动切换的 TTS 模型（无需联动为 null）。 */
  linked: string | null
  current: boolean
  /** 是否自定义音色（仅自定义项可删/可遮蔽编辑）。 */
  custom: boolean
}

/** voices.add 入参（左栏音色表单；字段与 serve _rpc_voices_add 同口径，同名 upsert=编辑）。 */
export interface VoiceAddPayload {
  name: string
  voice_id: string
  /** 适配模型（留空 = 不限，切换时不联动改模型）。 */
  model: string
  description: string
}

/** voices.select 回执 result（linked_model 非空 = 切换时联动换了 TTS 模型）。 */
export interface VoiceSelectResult {
  ok: boolean
  name?: string
  voice_id?: string
  linked_model?: string | null
  old_model?: string | null
  error?: string
}

/** WS 指令 type 常量（镜像 protocol.CMD_*）。 */
export const Cmd = {
  Message: 'message',
  SessionsList: 'sessions.list',
  SessionsOpen: 'sessions.open',
  SessionsNew: 'sessions.new',
  SessionsRename: 'sessions.rename',
  SessionsDelete: 'sessions.delete',
  ModelsList: 'models.list',
  ModelsSelect: 'models.select',
  /** 左栏「添加模型」表单：添加/覆盖自定义模型并持久化（models.add）。 */
  ModelsAdd: 'models.add',
  /** 左栏双击模型项 → 修改模型配置（models.edit，所有字段留空=保持原值）。 */
  ModelsEdit: 'models.edit',
  /** 左栏右键模型项 → 删除自定义模型（models.remove，仅自定义模型可删）。 */
  ModelsRemove: 'models.remove',
  VoicesList: 'voices.list',
  VoicesSelect: 'voices.select',
  /** 左栏音色面板「添加音色」表单：添加/覆盖自定义音色（voices.add）。 */
  VoicesAdd: 'voices.add',
  /** 左栏右键自定义音色 → 删除（voices.delete，仅自定义音色可删）。 */
  VoicesDelete: 'voices.delete',
  MetricsGet: 'metrics.get',
  StateGet: 'state.get',
  /** 右栏任务中心数据源：待触发提醒 + 活跃截止日期。 */
  ScheduleList: 'schedule.list',
  /** 右栏用量卡数据源：会话 token 累计 + 对话轮数 + 消息条数。 */
  CostGet: 'cost.get',
  AnswerUser: 'answer_user',
  TalkStart: 'talk.start',
  TalkStop: 'talk.stop',
  /**
   * 全双工麦克风帧（2026-09-28）：data 为 base64 PCM16 16kHz 单声道，~100ms/帧。
   * fire-and-forget（用 wsClient.send 而非 runCommand），仅 duplex 会话消费。
   */
  TalkAudio: 'talk.audio',
  VoiceStart: 'voice.start',
  VoiceStop: 'voice.stop',
  VoiceInterrupt: 'voice.interrupt',
  ProactiveAck: 'proactive.ack',
  /** 设置面板数据源：用户可改开关的运行时值（settings.get）。 */
  SettingsGet: 'settings.get',
  /** 设置面板写回：修改并持久化用户可改开关（settings.set）。 */
  SettingsSet: 'settings.set',
  /** 停止当前回复（发送按钮二次点击）：服务端线程安全取消引擎 send 任务。 */
  ReplyAbort: 'reply.abort',
  /**
   * 项目工作区（2026-08桌面改造）：切换当前 workdir（project.set）。
   * 服务端入队即返回，落地走 `project_switched` 事件（与 models.select 同口径）。
   * @author aceFelix
   */
  ProjectSet: 'project.set',
  /** 读取当前项目信息（workdir/name/persisted）。 */
  ProjectGet: 'project.get',
  /** 列出最近项目（按 last_opened 倒序）。 */
  ProjectsList: 'projects.list',
  /** 从最近列表移除指定项目（不删磁盘目录）。 */
  ProjectsForget: 'projects.forget',
  /**
   * 工作（权限）模式切换（mode.set）：default/plan/accept_edits/yolo。
   * 服务端入队即返回，引擎在当前轮结束后热重建 orchestrator（与 models.select 同口径）。
   * @author aceFelix
   */
  ModeSet: 'mode.set',
  /**
   * 思考强度切换（think.set）：off/on/low/medium/high。
   * 服务端按厂商 THINKING_CONFIGS 翻译成原生参数；入队即返回。
   * @author aceFelix
   */
  ThinkSet: 'think.set',
  /**
   * 跨设备协同（2026-10）：手机 PWA / 微信 ClawBot 接入桌面。
   * connect/disconnect 入队即回执，二维码走 qrcode 事件、连接态走 remote_state；
   * status 供重开桌面回填；wechat.pairing 回喂手机端数字配对码。
   * @author aceFelix
   */
  PhoneConnect: 'phone.connect',
  PhoneDisconnect: 'phone.disconnect',
  PhoneStatus: 'phone.status',
  WechatConnect: 'wechat.connect',
  WechatDisconnect: 'wechat.disconnect',
  WechatStatus: 'wechat.status',
  WechatPairing: 'wechat.pairing'
} as const

/** 跨设备协同通道（qrcode / remote_state 事件的 channel 字段）。 */
export type RemoteChannel = 'phone' | 'wechat'

/**
 * qrcode 事件 payload（镜像 protocol.EVT_QRCODE）：连接二维码就绪。
 * url = 扫码/访问地址字符串，前端用 qrcode 库内联渲染成聊天区卡片。
 * fresh=true 表示一次新连接（在底部新建卡片、清理旧未连接卡片），否则为
 * 同一连接内二维码过期刷新（就地刷新最后一张未连接卡片，不堆叠）。
 */
export interface QrcodePayload {
  channel: RemoteChannel
  url: string
  fresh?: boolean
}

/** remote_state 事件 payload（镜像 protocol.EVT_REMOTE_STATE）：连接态变更。 */
export interface RemoteStatePayload {
  channel: RemoteChannel
  connected: boolean
}

/**
 * remote_user_message 事件 payload（镜像 protocol.EVT_REMOTE_USER_MESSAGE）：
 * 手机 / 微信入站用户消息，桌面按普通用户气泡渲染并标注来源 channel。
 */
export interface RemoteUserMessagePayload {
  channel: RemoteChannel
  text: string
}

/** phone.status 回执 result。 */
export interface PhoneStatusResult {
  active: boolean
  url: string
}

/** wechat.status 回执 result。 */
export interface WechatStatusResult {
  connected: boolean
}

/**
 * 工作（权限）模式：镜像 jarvis 侧 agent.permissions.modes 与终端 /mode。
 * default=写需确认/危险拒绝 / plan=只读规划 / accept_edits=文件编辑自动放行 / yolo=全自动。
 * @author aceFelix
 */
export type PermissionMode = 'default' | 'plan' | 'accept_edits' | 'yolo'

/**
 * 思考强度统一档位：镜像 jarvis 侧 off/on/low/medium/high（后端按厂商翻译为
 * thinking_budget / reasoning_effort 等原生参数）。
 * @author aceFelix
 */
export type ThinkingEffort = 'off' | 'on' | 'low' | 'medium' | 'high'

/**
 * state.get 中与输入区两个选择器相关的运行时快照（供 runtimeStore 首屏/重连初始化）。
 * @author aceFelix
 */
export interface RuntimeStateSnapshot {
  permissionMode: PermissionMode
  thinkingEffort: ThinkingEffort
  /** 当前厂商可选档位（空数组=不支持思考，选择器置灰）。 */
  thinkingSupported: ThinkingEffort[]
}

const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'plan', 'accept_edits', 'yolo']
const THINKING_EFFORTS: readonly ThinkingEffort[] = ['off', 'on', 'low', 'medium', 'high']

/**
 * state.get 回执的宽容解析：非法/缺失模式回退 default，思考档位回退 off，
 * supported 过滤为合法档位集合子集（脏值剔除）。缺字段视为后端未升级 → 保守默认。
 * @author aceFelix
 */
export function parseRuntimeState(payload: unknown): RuntimeStateSnapshot {
  const p = (payload ?? {}) as Record<string, unknown>
  const mode =
    typeof p.permission_mode === 'string' &&
    (PERMISSION_MODES as readonly string[]).includes(p.permission_mode)
      ? (p.permission_mode as PermissionMode)
      : 'default'
  const effort =
    typeof p.thinking_effort === 'string' &&
    (THINKING_EFFORTS as readonly string[]).includes(p.thinking_effort)
      ? (p.thinking_effort as ThinkingEffort)
      : 'off'
  const supported = Array.isArray(p.thinking_supported)
    ? (p.thinking_supported.filter(
        (v): v is ThinkingEffort =>
          typeof v === 'string' && (THINKING_EFFORTS as readonly string[]).includes(v)
      ) as ThinkingEffort[])
    : []
  return { permissionMode: mode, thinkingEffort: effort, thinkingSupported: supported }
}

/**
 * 项目工作区数据契约（镜像 jarvis 侧 WorkbenchAPI 与 projects_registry）。
 *
 * - `ProjectItem`：projects.toml 单条记录 + 存在性 `exists`（供前端置灰）；
 * - `CurrentProject`：当前 workdir + 目录名 + 是否已持久化到 projects.toml。
 * @author aceFelix
 */
export interface ProjectItem {
  /** 绝对路径（唯一键）。 */
  path: string
  /** 目录 basename。 */
  name: string
  /** ISO 时间戳。 */
  last_opened: string
  /** 目录当前是否存在（删除/外接盘未插则 false，前端置灰）。 */
  exists: boolean
}

export interface CurrentProject {
  workdir: string
  name: string
  /** workdir 是否已写入 projects.toml（serve 启动默认值可能未持久化）。 */
  persisted: boolean
}
