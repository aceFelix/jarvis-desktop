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
  RendererLog: 'jarvis:renderer-log'
} as const

/** 窗口控制动作（自绘标题栏按钮）。 */
export type WindowAction = 'minimize' | 'close'

/** WS 指令 type 常量（镜像 protocol.CMD_*）。 */
export const Cmd = {
  Message: 'message',
  SessionsList: 'sessions.list',
  SessionsOpen: 'sessions.open',
  SessionsNew: 'sessions.new',
  ModelsList: 'models.list',
  ModelsSelect: 'models.select',
  VoicesList: 'voices.list',
  VoicesSelect: 'voices.select',
  MetricsGet: 'metrics.get',
  StateGet: 'state.get',
  AnswerUser: 'answer_user',
  TalkStart: 'talk.start',
  TalkStop: 'talk.stop'
} as const
