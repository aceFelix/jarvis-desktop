/**
 * notify 单测：主进程系统通知弹出与任务栏闪烁分支。
 *
 * 背景（aceFelix）：主动播报（每日简报/提醒/截止日期）经渲染进程 IPC 落到
 * 主进程 showSystemNotification，弹 Electron 原生通知；窗口未聚焦（隐藏/最小化
 * 到托盘）时附加 flashFrame。用 vi.hoisted 造 Notification 假类捕获构造与 show，
 * 窗口状态用注入的假 BrowserWindow 驱动，覆盖聚焦/失焦/已销毁/无窗口四分支。
 *
 * @author aceFelix
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// vi.hoisted：在 vi.mock 工厂提升前定义可变桩，避免"初始化前访问"错误
const h = vi.hoisted(() => {
  const instances: Array<{ opts: unknown; show: () => void }> = []
  const show = vi.fn()
  const isSupported = vi.fn(() => true)
  class FakeNotification {
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
      instances.push({ opts, show })
    }
    show = show
  }
  const getAllWindows = vi.fn(() => [] as unknown[])
  return { instances, show, isSupported, FakeNotification, getAllWindows }
})

vi.mock('electron', () => ({
  // 静态 isSupported 挂到类上（notify.ts 调 Notification.isSupported()）
  Notification: Object.assign(h.FakeNotification, { isSupported: h.isSupported }),
  BrowserWindow: { getAllWindows: h.getAllWindows }
}))

// logging 只在通知构造异常的 catch 分支用到；mock 掉避免拉起真实 electron app
vi.mock('../../src/main/logging', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  initLogging: vi.fn()
}))

import { showSystemNotification } from '../../src/main/notify'

/** 造一个假窗口（可配聚焦/销毁状态）。 */
function fakeWin(opts: { focused?: boolean; destroyed?: boolean } = {}) {
  return {
    isDestroyed: () => opts.destroyed ?? false,
    isFocused: () => opts.focused ?? true,
    flashFrame: vi.fn()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.instances.length = 0
  h.isSupported.mockReturnValue(true)
})

describe('showSystemNotification · 弹通知', () => {
  it('isSupported 时构造 Notification 并 show（title/body 透传）', () => {
    showSystemNotification({ title: '贾维斯提醒', body: '开会' }, () => null)
    expect(h.isSupported).toHaveBeenCalled()
    expect(h.instances).toHaveLength(1)
    expect(h.instances[0].opts).toEqual({ title: '贾维斯提醒', body: '开会' })
    expect(h.show).toHaveBeenCalled()
  })

  it('title 为空回退 J.A.R.V.I.S（避免空标题通知）', () => {
    showSystemNotification({ title: '  ', body: '正文' }, () => null)
    expect(h.instances[0].opts).toEqual({ title: 'J.A.R.V.I.S', body: '正文' })
  })

  it('title 与 body 均空 → 不弹（防空白气泡）', () => {
    showSystemNotification({ title: '', body: '   ' }, () => null)
    expect(h.instances).toHaveLength(0)
    expect(h.show).not.toHaveBeenCalled()
  })

  it('isSupported=false → 不构造、不 show（平台不支持降级）', () => {
    h.isSupported.mockReturnValue(false)
    showSystemNotification({ title: 't', body: 'b' }, () => null)
    expect(h.instances).toHaveLength(0)
    expect(h.show).not.toHaveBeenCalled()
  })

  it('Notification 构造抛异常时被 catch，不影响后续 flashFrame', () => {
    h.isSupported.mockImplementation(() => {
      throw new Error('boom')
    })
    const win = fakeWin({ focused: false })
    expect(() =>
      showSystemNotification({ title: 't', body: 'b' }, () => win as never)
    ).not.toThrow()
    // 通知虽炸，任务栏闪烁分支仍执行
    expect(win.flashFrame).toHaveBeenCalledWith(true)
  })
})

describe('showSystemNotification · 任务栏闪烁', () => {
  it('窗口未聚焦（托盘态）→ flashFrame(true)', () => {
    const win = fakeWin({ focused: false })
    showSystemNotification({ title: 't', body: 'b' }, () => win as never)
    expect(win.flashFrame).toHaveBeenCalledWith(true)
  })

  it('窗口已聚焦 → 不闪烁（用户正在看，不打扰）', () => {
    const win = fakeWin({ focused: true })
    showSystemNotification({ title: 't', body: 'b' }, () => win as never)
    expect(win.flashFrame).not.toHaveBeenCalled()
  })

  it('窗口已销毁 → 不闪烁（防访问失效窗口）', () => {
    const win = fakeWin({ focused: false, destroyed: true })
    showSystemNotification({ title: 't', body: 'b' }, () => win as never)
    expect(win.flashFrame).not.toHaveBeenCalled()
  })

  it('无窗口（null）→ 不抛异常', () => {
    expect(() =>
      showSystemNotification({ title: 't', body: 'b' }, () => null)
    ).not.toThrow()
  })
})
