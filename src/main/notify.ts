/**
 * 系统通知模块 —— 主动播报经 Electron 主进程弹 Windows 原生通知。
 *
 * 为什么走主进程 Notification 而非渲染端 HTML5 Notification：
 * - 桌面壳关闭按钮只隐藏窗口（常驻托盘），窗口隐藏/最小化时渲染端通知
 *   不可靠；主进程 Notification 与窗口生命周期解耦，托盘态照样弹。
 *
 * 职责单一：接收 {title, body} → 弹通知；窗口未聚焦时附加任务栏闪烁。
 * 纯逻辑抽函数便于单测（vi.mock('electron') 注入 Notification/BrowserWindow）。
 *
 * @author aceFelix
 */

import { BrowserWindow, Notification } from 'electron'
import { log } from './logging'
import type { NotifyRequest } from '../shared/contracts'

/**
 * 弹一条系统通知；窗口未聚焦时闪烁任务栏提醒。
 *
 * @param req - 通知请求体（title/body）。
 * @param getFocusedWindow - 取"应关联的窗口"的函数（默认取主窗口）。
 *   抽成参数便于单测注入假窗口，避免依赖真实 BrowserWindow 状态。
 */
export function showSystemNotification(
  req: NotifyRequest,
  getFocusedWindow: () => BrowserWindow | null = () => BrowserWindow.getAllWindows()[0] ?? null
): void {
  const title = String(req?.title ?? '').trim()
  const body = String(req?.body ?? '').trim()
  if (!title && !body) {
    // 空通知直接忽略（防误弹空白气泡）
    return
  }
  try {
    if (Notification.isSupported()) {
      new Notification({ title: title || 'J.A.R.V.I.S', body }).show()
    }
  } catch (err) {
    log(`系统通知弹出失败: ${err instanceof Error ? err.message : String(err)}`)
  }
  // 窗口未聚焦（隐藏/最小化/失焦）时闪烁任务栏，引导用户注意
  const win = getFocusedWindow()
  if (win && !win.isDestroyed() && !win.isFocused()) {
    win.flashFrame(true)
  }
}
