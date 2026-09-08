/**
 * JarvisWsClient 单测 —— 连接、指令 request/response 关联、事件分发、断线重连。
 *
 * 用假 WebSocket 替换全局构造器（node 环境无真实 socket），
 * 直接驱动 onopen/onmessage/onclose 回调验证客户端行为。
 *
 * @author aceFelix
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { JarvisWsClient } from '@renderer/api/ws'

/** 假 WebSocket：记录 send、暴露回调供测试手动触发。 */
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  url: string
  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  constructor(url: string) {
    this.url = url
    instances.push(this)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED
  }
}

let instances: FakeWebSocket[] = []
let origWs: unknown

beforeAll(() => {
  origWs = (globalThis as Record<string, unknown>).WebSocket
  ;(globalThis as Record<string, unknown>).WebSocket = FakeWebSocket
})
afterAll(() => {
  ;(globalThis as Record<string, unknown>).WebSocket = origWs
})
beforeEach(() => {
  instances = []
})
afterEach(() => {
  vi.useRealTimers()
})

/** 取最近创建的假 socket。 */
function lastWs(): FakeWebSocket {
  return instances[instances.length - 1]
}

describe('handleRaw 事件分发', () => {
  it('非 reply 事件交给 onEvent', () => {
    const onEvent = vi.fn()
    const client = new JarvisWsClient({ port: 1, token: 't', onEvent })
    client.handleRaw(JSON.stringify({ event: 'info', data: 'hi' }))
    expect(onEvent).toHaveBeenCalledWith({ event: 'info', data: 'hi' })
  })

  it('非法 JSON 静默忽略', () => {
    const onEvent = vi.fn()
    const client = new JarvisWsClient({ port: 1, token: 't', onEvent })
    expect(() => client.handleRaw('not json')).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('缺 event 字段忽略', () => {
    const onEvent = vi.fn()
    const client = new JarvisWsClient({ port: 1, token: 't', onEvent })
    client.handleRaw(JSON.stringify({ data: 1 }))
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('无对应 pending 的 reply 不触发 onEvent', () => {
    const onEvent = vi.fn()
    const client = new JarvisWsClient({ port: 1, token: 't', onEvent })
    client.handleRaw(JSON.stringify({ event: 'reply', data: { type: 'x', ok: true } }))
    expect(onEvent).not.toHaveBeenCalled()
  })
})

describe('connect / sendCommand', () => {
  it('connect 构造带 token 的 URL，onopen 后标记已连接', () => {
    const onConn = vi.fn()
    const client = new JarvisWsClient({ port: 5, token: 'tk', onConnectionChange: onConn })
    client.connect()
    expect(lastWs().url).toBe('ws://127.0.0.1:5/?token=tk')
    expect(client.isConnected()).toBe(false)
    lastWs().onopen?.()
    expect(client.isConnected()).toBe(true)
    expect(onConn).toHaveBeenCalledWith(true)
  })

  it('token 中的特殊字符被编码', () => {
    const client = new JarvisWsClient({ port: 1, token: 'a b&c' })
    client.connect()
    expect(lastWs().url).toContain('token=a%20b%26c')
  })

  it('未连接时 sendCommand 拒绝', async () => {
    const client = new JarvisWsClient({ port: 1, token: 't' })
    await expect(client.sendCommand('state.get')).rejects.toThrow(/未连接/)
  })

  it('sendCommand 发送指令并被 reply 兑现', async () => {
    const client = new JarvisWsClient({ port: 1, token: 't' })
    client.connect()
    lastWs().onopen?.()
    const p = client.sendCommand('models.select', { name: 'gpt' })
    expect(JSON.parse(lastWs().sent[0])).toEqual({ type: 'models.select', name: 'gpt' })
    lastWs().onmessage?.({
      data: JSON.stringify({
        event: 'reply',
        data: { type: 'models.select', ok: true, result: { applied: true } }
      })
    })
    await expect(p).resolves.toMatchObject({ ok: true, type: 'models.select' })
  })

  it('同类型指令按 FIFO 匹配回执', async () => {
    const client = new JarvisWsClient({ port: 1, token: 't' })
    client.connect()
    lastWs().onopen?.()
    const p1 = client.sendCommand('metrics.get')
    const p2 = client.sendCommand('metrics.get')
    lastWs().onmessage?.({
      data: JSON.stringify({ event: 'reply', data: { type: 'metrics.get', ok: true, result: { n: 1 } } })
    })
    lastWs().onmessage?.({
      data: JSON.stringify({ event: 'reply', data: { type: 'metrics.get', ok: true, result: { n: 2 } } })
    })
    expect((await p1).result).toEqual({ n: 1 })
    expect((await p2).result).toEqual({ n: 2 })
  })

  it('send 只发不等回执；未连接时静默', () => {
    const client = new JarvisWsClient({ port: 1, token: 't' })
    expect(() => client.send('message', { text: 'hi' })).not.toThrow()
    client.connect()
    lastWs().onopen?.()
    client.send('message', { text: 'hi' })
    expect(JSON.parse(lastWs().sent[0])).toEqual({ type: 'message', text: 'hi' })
  })

  it('断开时拒绝 pending、回调断连并退避重连', async () => {
    vi.useFakeTimers()
    const onConn = vi.fn()
    const client = new JarvisWsClient({
      port: 1,
      token: 't',
      onConnectionChange: onConn,
      reconnectBaseMs: 100
    })
    client.connect()
    lastWs().onopen?.()
    const p = client.sendCommand('state.get')
    const ws = lastWs()
    ws.readyState = FakeWebSocket.CLOSED
    ws.onclose?.()
    await expect(p).rejects.toThrow(/断开/)
    expect(onConn).toHaveBeenCalledWith(false)
    expect(client.isConnected()).toBe(false)
    // 退避后重连：产生新的 socket 实例
    await vi.advanceTimersByTimeAsync(150)
    expect(instances.length).toBe(2)
  })

  it('close 主动关闭后不再重连', () => {
    vi.useFakeTimers()
    const client = new JarvisWsClient({ port: 1, token: 't', reconnectBaseMs: 100 })
    client.connect()
    lastWs().onopen?.()
    client.close()
    expect(client.isConnected()).toBe(false)
    vi.advanceTimersByTime(500)
    expect(instances.length).toBe(1)
  })
})
