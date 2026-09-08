/**
 * preload：contextBridge 最小暴露面（渲染进程唯一合法的 Node 能力入口）。
 *
 * 安全边界：
 * - 不暴露 ipcRenderer 本体，只暴露白名单通道；
 * - token 仅在内存传递（invoke 返回），不落盘、不进 localStorage；
 * - 窗口控制只支持 minimize / close 两个动作。
 *
 * @author aceFelix
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type BackendInfo,
  type BackendStatusEvent,
  type WindowAction
} from '../shared/contracts'

/** 暴露给渲染进程的 API（window.jarvisDesktop）。 */
const api = {
  /** 取后端连接信息；未就绪返回 null（渲染进程轮询或等状态推送）。 */
  getBackendInfo: (): Promise<BackendInfo | null> =>
    ipcRenderer.invoke(IpcChannels.GetBackendInfo),

  /** 窗口控制（自绘标题栏按钮）。 */
  windowControl: (action: WindowAction): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WindowControl, action),

  /**
   * 日志桥：渲染进程现场诊断信息经主进程写入 desktop.log。
   * 单向 send 不等回执（日志失败不影响业务）。
   *
   * @author aceFelix
   */
  log: (msg: string): void => {
    ipcRenderer.send(IpcChannels.RendererLog, String(msg))
  },

  /**
   * 订阅后端状态推送（spawning/ready/error/exited）。
   * 返回取消订阅函数（React useEffect cleanup 用）。
   */
  onBackendStatus: (
    callback: (status: BackendStatusEvent) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: BackendStatusEvent): void => {
      callback(status)
    }
    ipcRenderer.on(IpcChannels.BackendStatus, listener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.BackendStatus, listener)
    }
  }
}

export type JarvisDesktopApi = typeof api

contextBridge.exposeInMainWorld('jarvisDesktop', api)
