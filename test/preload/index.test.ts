/**
 * preload 暴露面契约测试 —— 锁定 notify 系统通知通道。
 *
 * 背景（aceFelix）：主动播报的系统通知经 preload 暴露的 jarvisDesktop.notify
 * 走 IPC 单向 send 到主进程。preload 是渲染进程唯一合法的 Node 能力入口，
 * 暴露面漂移会静默打断通知链，故用本测试锁定：
 * - exposeInMainWorld 以 'jarvisDesktop' 键暴露；
 * - api.notify 存在且为函数；
 * - 调用 notify 以 SystemNotify 通道 + 原样 payload 走 ipcRenderer.send。
 *
 * @author aceFelix
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// vi.hoisted：在 vi.mock 工厂提升前定义可捕获的桩
const h = vi.hoisted(() => {
  const exposed: Record<string, Record<string, unknown>> = {}
  const exposeInMainWorld = vi.fn((key: string, api: Record<string, unknown>) => {
    exposed[key] = api
  })
  const send = vi.fn()
  const invoke = vi.fn()
  const on = vi.fn()
  const removeListener = vi.fn()
  return { exposed, exposeInMainWorld, send, invoke, on, removeListener }
})

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: h.exposeInMainWorld },
  ipcRenderer: {
    send: h.send,
    invoke: h.invoke,
    on: h.on,
    removeListener: h.removeListener
  }
}))

// 导入即触发 exposeInMainWorld（preload 模块加载副作用）
import '../../src/preload/index'
import { IpcChannels } from '../../src/shared/contracts'

/** 取暴露的 jarvisDesktop api（类型收敛为记录）。 */
function exposedApi(): Record<string, unknown> {
  return h.exposed['jarvisDesktop'] ?? {}
}

beforeEach(() => {
  h.send.mockClear()
})

describe('preload 暴露面', () => {
  it("以 'jarvisDesktop' 键暴露 api", () => {
    expect(h.exposeInMainWorld).toHaveBeenCalledWith('jarvisDesktop', expect.any(Object))
    expect(exposedApi()).toBeTruthy()
  })

  it('notify 通道存在且为函数', () => {
    expect(typeof exposedApi().notify).toBe('function')
  })

  it('notify 以 SystemNotify 通道 + 原样 payload 走 ipcRenderer.send', () => {
    const notify = exposedApi().notify as (req: { title: string; body: string }) => void
    notify({ title: '贾维斯提醒', body: '开会' })
    expect(h.send).toHaveBeenCalledWith(IpcChannels.SystemNotify, {
      title: '贾维斯提醒',
      body: '开会'
    })
  })

  it('SystemNotify 通道名是稳定契约（改名会断链）', () => {
    expect(IpcChannels.SystemNotify).toBe('jarvis:system-notify')
  })

  it('既有能力未被 notify 挤掉（log/windowControl/onBackendStatus 仍在）', () => {
    const api = exposedApi()
    expect(typeof api.log).toBe('function')
    expect(typeof api.windowControl).toBe('function')
    expect(typeof api.onBackendStatus).toBe('function')
    expect(typeof api.getBackendInfo).toBe('function')
  })
})
