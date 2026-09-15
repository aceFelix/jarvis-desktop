/**
 * jarvis-desktop 主进程入口。
 *
 * 职责（对齐 dsh-desktop 原则：壳不重写 Agent 运行时，只管桌面宿主能力）：
 * - 单实例锁：二次启动聚焦已有窗口；
 * - 主窗口：无边框 + 自绘标题栏，contextIsolation/sandbox 全开；
 * - 后端生命周期：BackendManager 拉起 `python -m agent.serve`，
 *   握手就绪后经 IPC 推送 port/token 给渲染进程；
 * - 托盘：显隐窗口 / 退出；关闭按钮只隐藏窗口（常驻托盘），退出走托盘菜单；
 * - 退出回收：kill serve 进程树，防孤儿 Python。
 *
 * @author aceFelix
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import {
  createBackendManager,
  getBackendManager,
  type BackendManager
} from './backend'
import { initLogging, log, logError } from './logging'
import { resolveIconPath } from './appIcon'
import { showSystemNotification } from './notify'
import { createTray, destroyTray } from './tray'
import { IpcChannels, type NotifyRequest, type WindowAction } from '../shared/contracts'

let mainWindow: BrowserWindow | null = null
let backend: BackendManager | null = null
/** 主动退出标记：区分"关窗隐藏"与"真退出"。 */
let quitting = false

/** 渲染进程入口（dev 由 electron-vite 注入 URL，生产加载打包产物）。 */
const DEV_RENDERER_URL = process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  // 任务栏/Alt-Tab 图标与托盘同源（appIcon.ts）：不设时 dev 模式会显示
  // Electron 内置原子 logo，与托盘反应炉不一致（2026-09-10 实机反馈）
  const iconPath = resolveIconPath()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false, // 自绘标题栏（渲染进程 WindowControl IPC 控制最小化/关闭）
    backgroundColor: '#081220', // 深蓝实底，避免启动白闪
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // 关闭 = 隐藏到托盘（退出走托盘菜单），与 workbench 常驻口径一致
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // 外链交给系统浏览器（安全边界：窗口内只跑本地 UI）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (DEV_RENDERER_URL) {
    mainWindow.loadURL(DEV_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 启动后端并把状态推送给渲染进程；失败弹窗提示（含日志路径）。 */
async function startBackend(): Promise<void> {
  if (!backend) return
  try {
    await backend.start()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    dialog.showErrorBox(
      'J.A.R.V.I.S 后端启动失败',
      `${message}\n\n请检查：\n1. Python 已安装且在 PATH（或设置 JARVIS_PYTHON）\n` +
        `2. jarvis 仓库路径正确（或设置 JARVIS_REPO）\n3. 依赖已安装（pip install -e .）\n\n` +
        `详细日志：${join(app.getPath('userData'), 'logs', 'desktop.log')}`
    )
  }
}

/** 注册 IPC：渲染进程取后端信息 / 窗口控制。 */
function registerIpc(): void {
  ipcMain.handle(IpcChannels.GetBackendInfo, () => {
    const mgr = getBackendManager()
    if (!mgr || mgr.getState() !== 'ready') return null
    return mgr.getInfo()
  })
  ipcMain.handle(IpcChannels.WindowControl, (_event, action: WindowAction) => {
    if (!mainWindow) return
    if (action === 'minimize') {
      mainWindow.minimize()
    } else if (action === 'close') {
      // 关闭只隐藏（常驻托盘）；真退出走托盘菜单
      mainWindow.hide()
    }
  })
  // 渲染进程日志桥：统一落 desktop.log，便于现场诊断（如 WS 双连接排查）
  // @author aceFelix
  ipcMain.on(IpcChannels.RendererLog, (_event, msg: unknown) => {
    log(`[renderer] ${String(msg)}`)
  })
  // 系统通知桥：主动播报（简报/提醒/截止日期）经主进程弹 Windows 原生通知，
  // 窗口未聚焦时附加任务栏闪烁（托盘态也可靠）
  // @author aceFelix
  ipcMain.on(IpcChannels.SystemNotify, (_event, req: NotifyRequest) => {
    showSystemNotification(req, () => mainWindow)
  })
}

/** 单实例锁：拿不到锁直接退出（首实例收到 second-instance 聚焦窗口）。 */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    initLogging(app.getPath('userData'))
    log(`jarvis-desktop 启动 (v${app.getVersion()})`)
    app.setAppUserModelId('AceFelix.JARVIS.Workbench')

    registerIpc()
    createWindow()

    backend = createBackendManager({
      appDir: app.getAppPath(),
      onStatus: (state, info, error) => {
        // 状态变化推给渲染进程（启动进度 / 崩溃提示）
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcChannels.BackendStatus, {
            state,
            info,
            error
          })
        }
      }
    })
    createTray(mainWindow!, async () => {
      quitting = true
      await backend?.stop()
      destroyTray()
      app.quit()
    })
    void startBackend()
  })

  app.on('window-all-closed', () => {
    // 常驻托盘：窗口全关不退出（真退出走托盘菜单）
  })

  app.on('before-quit', (e) => {
    // 退出前先回收 serve 进程树（防孤儿 Python 占端口）
    const mgr = getBackendManager()
    if (mgr && mgr.getState() === 'ready') {
      e.preventDefault()
      quitting = true
      mgr
        .stop()
        .catch((err) => logError('退出时回收后端失败', err))
        .finally(() => {
          destroyTray()
          app.quit()
        })
    } else {
      quitting = true
      destroyTray()
    }
  })
}
