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
  /**
   * 项目工作区：目录选择器桥。主进程 Electron dialog.showOpenDialog
   * 返回选中绝对路径；取消返回 null。后端对 path 二次校验存在 + 绝对。
   * @author aceFelix
   */
  selectDirectory(): Promise<string | null>
}

declare global {
  interface Window {
    jarvisDesktop: JarvisDesktopApi
  }
}

export {}
