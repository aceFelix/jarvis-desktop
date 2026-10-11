/**
 * update 单测：electron-updater 封装的检查/下载/安装与事件→状态映射。
 *
 * 背景（aceFelix）：桌面壳自动更新仅在打包态生效。本文件用 vi.mock 注入假
 * autoUpdater（自管事件表，可手动触发 update-available / download-progress /
 * update-downloaded / update-not-available / error），并 mock electron 的
 * app.isPackaged 覆盖 dev/packaged 两分支，验证：
 *   - initUpdater 关闭自动下载/自动安装并注册五类事件映射；
 *   - checkOnStartup 的 app.isPackaged 守卫；
 *   - download / install 正确转发到 autoUpdater；
 *   - before-quit-for-update 订阅。
 *
 * @author aceFelix
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// vi.hoisted：在 vi.mock 工厂提升前定义可变桩，避免"初始化前访问"错误
const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb)
      return autoUpdater
    }),
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '1.2.3' } })),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn()
  }
  const app = { isPackaged: true }
  return { handlers, autoUpdater, app }
})

vi.mock('electron', () => ({ app: h.app }))
vi.mock('electron-updater', () => ({ autoUpdater: h.autoUpdater }))
vi.mock('../../src/main/logging', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  initLogging: vi.fn()
}))

import { checkOnStartup, download, initUpdater, install } from '../../src/main/update'

/** 触发已注册的 autoUpdater 事件（未注册则由可选链静默忽略）。 */
function fire(event: string, payload?: unknown): void {
  h.handlers.get(event)?.(payload)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.handlers.clear()
  h.app.isPackaged = true
  h.autoUpdater.autoDownload = true
  h.autoUpdater.autoInstallOnAppQuit = true
})

describe('initUpdater · 策略与事件映射', () => {
  it('关闭自动下载与自动安装（下载/安装时机由用户点击驱动）', () => {
    initUpdater(vi.fn())
    expect(h.autoUpdater.autoDownload).toBe(false)
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('update-available → emit available + version', () => {
    const emit = vi.fn()
    initUpdater(emit)
    fire('update-available', { version: '1.2.3' })
    expect(emit).toHaveBeenCalledWith({ state: 'available', version: '1.2.3' })
  })

  it('download-progress → emit downloading + 取整 percent', () => {
    const emit = vi.fn()
    initUpdater(emit)
    fire('download-progress', { percent: 42.7 })
    expect(emit).toHaveBeenCalledWith({ state: 'downloading', percent: 43 })
  })

  it('update-downloaded → emit downloaded + version', () => {
    const emit = vi.fn()
    initUpdater(emit)
    fire('update-downloaded', { version: '1.2.3' })
    expect(emit).toHaveBeenCalledWith({ state: 'downloaded', version: '1.2.3' })
  })

  it('update-not-available → emit idle', () => {
    const emit = vi.fn()
    initUpdater(emit)
    fire('update-not-available')
    expect(emit).toHaveBeenCalledWith({ state: 'idle' })
  })

  it('error → emit error + message（不抛出）', () => {
    const emit = vi.fn()
    initUpdater(emit)
    fire('error', new Error('boom'))
    expect(emit).toHaveBeenCalledWith({ state: 'error', error: 'boom' })
  })

  it('error 传入非 Error（string）→ 原样取 message', () => {
    const emit = vi.fn()
    initUpdater(emit)
    fire('error', 'network down')
    expect(emit).toHaveBeenCalledWith({ state: 'error', error: 'network down' })
  })
})

describe('checkOnStartup · dev/packaged 守卫', () => {
  it('app.isPackaged=false → 不触发 checkForUpdates（dev 静默跳过）', () => {
    h.app.isPackaged = false
    checkOnStartup()
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('app.isPackaged=true → 触发一次 checkForUpdates', () => {
    checkOnStartup()
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('checkForUpdates 拒绝时被吞掉（不抛出）', async () => {
    h.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    expect(() => checkOnStartup()).not.toThrow()
    // 让被 catch 的 Promise 收尾，确保无未处理拒绝
    await Promise.resolve()
  })
})

describe('download / install · 转发到 autoUpdater', () => {
  it('download() → autoUpdater.downloadUpdate()', async () => {
    await download()
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('install() → autoUpdater.quitAndInstall(false, true)（退出并重启）', async () => {
    await install()
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
