/**
 * WS 客户端封装 —— 与 `agent/serve` 协议对接（框架无关纯 TS，可单测）。
 *
 * 协议（镜像 protocol.py）：
 * - 连接：`ws://127.0.0.1:<port>/?token=<token>`（token 认证，错则 4401 断开）
 * - 指令：`{"type": "<cmd>", ...params}` → 回执 `{"event": "reply", "data": {...}}`
 * - 事件：`{"event": "<name>", "data": <payload>}`（流式推送）
 *
 * request/response 关联口径：服务端回执按指令 type 串行返回（serve 侧同一
 * 连接内指令顺序处理），客户端按 type 队列 FIFO 匹配 pending 请求。
 *
 * @author aceFelix
 */

/** 服务端事件消息信封。 */
export interface ServerEvent {
  event: string
  data: unknown
}

/** 指令回执 data 段。 */
export interface ReplyData {
  type: string
  ok: boolean
  result?: unknown
  error?: string
}

export interface JarvisWsOptions {
  port: number
  token: string
  /** 事件回调（reply 之外的所有事件）。 */
  onEvent?: (event: ServerEvent) => void
  /** 连接状态变化回调（重连提示用）。 */
  onConnectionChange?: (connected: boolean) => void
  /** 重连基础间隔毫秒（指数退避，封顶 10s）。默认 1000。 */
  reconnectBaseMs?: number
  /** WebSocket 构造注入（测试用假实现替换）。 */
  webSocketCtor?: new (url: string) => WebSocket
}

interface Pending {
  resolve: (reply: ReplyData) => void
  reject: (err: Error) => void
}

export class JarvisWsClient {
  private ws: WebSocket | null = null
  private closed = false
  private connected = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pending = new Map<string, Pending[]>()
  private readonly opts: JarvisWsOptions

  constructor(opts: JarvisWsOptions) {
    this.opts = opts
  }

  /** 建立连接（幂等；重复调用只在断开状态下重连）。 */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.closed = false
    const Ctor = this.opts.webSocketCtor ?? WebSocket
    const ws = new Ctor(`ws://127.0.0.1:${this.opts.port}/?token=${encodeURIComponent(this.opts.token)}`)
    this.ws = ws

    ws.onopen = () => {
      this.connected = true
      this.reconnectAttempts = 0
      this.opts.onConnectionChange?.(true)
    }
    ws.onmessage = (ev: MessageEvent) => this.handleRaw(String(ev.data))
    ws.onclose = () => {
      const wasConnected = this.connected
      this.connected = false
      if (wasConnected) this.opts.onConnectionChange?.(false)
      this.rejectAllPending(new Error('连接已断开'))
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose 会随后触发，统一在那里处理重连
    }
  }

  /** 主动关闭（不重连）。 */
  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectAllPending(new Error('客户端已关闭'))
    if (this.ws) {
      this.ws.onclose = null
      try {
        this.ws.close()
      } catch {
        // 忽略关闭异常
      }
      this.ws = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  /**
   * 发送指令并等待回执。
   *
   * @param type - 指令 type（Cmd 常量）。
   * @param params - 指令参数（平铺进消息体）。
   * @param timeoutMs - 回执超时（默认 15s）。
   */
  sendCommand(type: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<ReplyData> {
    return new Promise<ReplyData>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('未连接到后端'))
        return
      }
      const queue = this.pending.get(type) ?? []
      queue.push({ resolve, reject })
      this.pending.set(type, queue)
      const timer = setTimeout(() => {
        this.removePending(type, entry)
        reject(new Error(`指令 ${type} 回执超时`))
      }, timeoutMs)
      const entry: Pending = {
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      }
      // 替换占位项（带 timer 清理的最终版本）
      queue[queue.length - 1] = entry
      try {
        this.ws.send(JSON.stringify({ type, ...params }))
      } catch (err) {
        this.removePending(type, entry)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** 只发不等回执（message 等结果走事件流的指令）。 */
  send(type: string, params: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type, ...params }))
  }

  // ---- 内部 ----

  /** 解析一行 WS 消息并分发（纯逻辑，单测直接调用）。 */
  handleRaw(raw: string): void {
    let msg: ServerEvent
    try {
      msg = JSON.parse(raw) as ServerEvent
    } catch {
      return
    }
    if (!msg || typeof msg.event !== 'string') return
    if (msg.event === 'reply') {
      const data = msg.data as ReplyData
      const queue = this.pending.get(data?.type)
      if (queue && queue.length) {
        const entry = queue.shift()!
        if (!queue.length) this.pending.delete(data.type)
        entry.resolve(data)
      }
      return
    }
    this.opts.onEvent?.(msg)
  }

  private removePending(type: string, entry: Pending): void {
    const queue = this.pending.get(type)
    if (!queue) return
    const idx = queue.indexOf(entry)
    if (idx >= 0) queue.splice(idx, 1)
    if (!queue.length) this.pending.delete(type)
  }

  private rejectAllPending(err: Error): void {
    for (const [, queue] of this.pending) {
      for (const entry of queue) entry.reject(err)
    }
    this.pending.clear()
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return
    const base = this.opts.reconnectBaseMs ?? 1000
    const delay = Math.min(base * 2 ** this.reconnectAttempts, 10_000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
