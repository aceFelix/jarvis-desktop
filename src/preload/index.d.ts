/**
 * 渲染进程全局类型声明：window.jarvisDesktop（preload 暴露面）。
 *
 * @author aceFelix
 */

import type {
  BackendInfo,
  BackendStatusEvent,
  NotifyRequest,
  ScreenCapture,
  WindowAction
} from '../shared/contracts'

export interface JarvisDesktopApi {
  getBackendInfo(): Promise<BackendInfo | null>
  windowControl(action: WindowAction): Promise<void>
  onBackendStatus(callback: (status: BackendStatusEvent) => void): () => void
  /** 日志桥：渲染进程诊断信息经主进程写入 desktop.log。 */
  log(msg: string): void
  /** 系统通知桥：主动播报经主进程弹 Windows 原生通知（单向）。 */
  notify(req: NotifyRequest): void
  /** 截屏桥：主屏缩略图 PNG base64（无可用屏源时 null）。 */
  captureScreen(): Promise<ScreenCapture | null>
}

declare global {
  interface Window {
    jarvisDesktop: JarvisDesktopApi
  }
}

export {}
