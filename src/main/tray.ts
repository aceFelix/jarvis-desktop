/**
 * 系统托盘：复用 jarvis 反应炉图标（~/.jarvis/jarvis_window.ico 深蓝实底版），
 * 提供 显示/隐藏窗口 与 退出 两个菜单项。
 *
 * 图标缺失时托盘仍可创建（Electron 用默认占位图标），不阻塞主流程。
 *
 * @author aceFelix
 */

import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { log } from './logging'

let tray: Tray | null = null

/** 托盘图标候选路径（按优先级）：用户目录实底版 → 本仓库 build 资源。 */
function iconCandidates(): string[] {
  return [
    join(app.getPath('home'), '.jarvis', 'jarvis_window.ico'),
    join(__dirname, '../../build/icon.ico')
  ]
}

/**
 * 创建托盘（app ready 后调用一次）。
 *
 * @param win - 主窗口（菜单项控制其显隐）。
 * @param onQuit - 退出菜单回调（index.ts 里做后端回收 + app.quit）。
 */
export function createTray(win: BrowserWindow, onQuit: () => void): Tray | null {
  if (tray) return tray
  const iconPath = iconCandidates().find((p) => existsSync(p))
  // Windows 托盘推荐 16px；ico 多尺寸文件由 nativeImage 自行选取
  const image = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()
  if (!iconPath) log('托盘图标缺失（~/.jarvis/jarvis_window.ico 与 build/icon.ico 均不存在）')

  tray = new Tray(image)
  tray.setToolTip('J.A.R.V.I.S 桌面工作台')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 / 隐藏窗口',
        click: () => {
          if (win.isVisible() && !win.isMinimized()) {
            win.hide()
          } else {
            win.show()
            win.focus()
          }
        }
      },
      { type: 'separator' },
      { label: '退出', click: onQuit }
    ])
  )
  // 单击托盘图标切换窗口显隐（与菜单第一项同口径）
  tray.on('click', () => {
    if (win.isVisible() && !win.isMinimized()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
  })
  return tray
}

/** 销毁托盘（退出前调用，避免 Windows 残留幽灵图标）。 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
