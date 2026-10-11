/**
 * 桌面壳自动更新（electron-updater 封装）。
 *
 * 交互（方案 a）：启动静默检查 → 有新版本才显示按钮 → 点击下载（带进度）
 * → 「重启安装」→ 退出 → NSIS 覆盖安装 → 自动重启。
 *
 * 设计要点：
 * - 仅打包态生效（dev 下 electron-updater 会抛错，app.isPackaged 守卫）；
 * - autoDownload=false：不自动下载，等用户点按钮；autoInstallOnAppQuit=false：
 *   不静默安装，安装时机与后端回收由 index.ts 掌控；
 * - 本模块只做「检查 / 下载 / 发起安装」与事件→UpdateStatusEvent 映射，
 *   更新状态经 emit 回调交给主进程推送给渲染层（不直接依赖 BrowserWindow）。
 *
 * @author aceFelix
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log, logError } from './logging'
import type { UpdateStatusEvent } from '../shared/contracts'

/** 状态回调（由 index.ts 注入 → 转发渲染进程）。 */
type EmitFn = (e: UpdateStatusEvent) => void

/**
 * 初始化更新器：设置下载策略并订阅 autoUpdater 事件映射为 UpdateStatusEvent。
 *
 * @param emit 状态回调（主进程模块级单例，重复调用会覆盖上一次回调）
 * @author aceFelix
 */
export function initUpdater(emit: EmitFn): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    log(`检测到新版本 ${info.version}`)
    emit({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    emit({ state: 'idle' })
  })
  autoUpdater.on('download-progress', (progress) => {
    emit({ state: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log(`新版本 ${info.version} 已下载，等待重启安装`)
    emit({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    logError('自动更新出错', err)
    emit({ state: 'error', error: err instanceof Error ? err.message : String(err) })
  })
}

/**
 * 启动时检查更新（仅打包态）。非阻塞：失败静默写日志，不弹窗、不显示按钮。
 * @author aceFelix
 */
export function checkOnStartup(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch((err) => {
    logError('检查更新失败', err)
  })
}

/** 下载新安装包（渲染层点「更新」按钮触发）。 */
export async function download(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

/**
 * 发起安装并重启。
 *
 * 注意：本函数只触发 quitAndInstall，**不负责回收后端子进程**——
 * 调用方（index.ts 的 UpdateInstall handler）须先置 `quitting = true` 并
 * `await backend.stop()` 回收 jarvis-serve.exe，避免文件被占用导致覆盖安装失败。
 * @author aceFelix
 */
export async function install(): Promise<void> {
  autoUpdater.quitAndInstall(false, true)
}
