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
  CaptureScreen: 'jarvis:capture-screen'
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
  VoicesList: 'voices.list',
  VoicesSelect: 'voices.select',
  MetricsGet: 'metrics.get',
  StateGet: 'state.get',
  /** 右栏任务中心数据源：待触发提醒 + 活跃截止日期。 */
  ScheduleList: 'schedule.list',
  /** 右栏用量卡数据源：会话 token 累计 + 对话轮数 + 消息条数。 */
  CostGet: 'cost.get',
  AnswerUser: 'answer_user',
  TalkStart: 'talk.start',
  TalkStop: 'talk.stop',
  VoiceStart: 'voice.start',
  VoiceStop: 'voice.stop',
  VoiceInterrupt: 'voice.interrupt',
  ProactiveAck: 'proactive.ack',
  /** 设置面板数据源：用户可改开关的运行时值（settings.get）。 */
  SettingsGet: 'settings.get',
  /** 设置面板写回：修改并持久化用户可改开关（settings.set）。 */
  SettingsSet: 'settings.set',
  /** 停止当前回复（发送按钮二次点击）：服务端线程安全取消引擎 send 任务。 */
  ReplyAbort: 'reply.abort'
} as const
