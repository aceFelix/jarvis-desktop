/**
 * 渲染进程全局类型声明：window.jarvisDesktop（preload 暴露面）。
 *
 * @author aceFelix
 */

import type {
  BackendInfo,
  BackendStatusEvent,
  WindowAction
} from '../shared/contracts'

export interface JarvisDesktopApi {
  getBackendInfo(): Promise<BackendInfo | null>
  windowControl(action: WindowAction): Promise<void>
  onBackendStatus(callback: (status: BackendStatusEvent) => void): () => void
  /** 日志桥：渲染进程诊断信息经主进程写入 desktop.log。 */
  log(msg: string): void
}

declare global {
  interface Window {
    jarvisDesktop: JarvisDesktopApi
  }
}

export {}
