/**
 * 应用图标解析单一来源：窗口（任务栏/Alt-Tab）与托盘共用同一取图标逻辑。
 *
 * 背景（aceFelix）：此前仅 tray.ts 自行加载反应炉图标，BrowserWindow 未设 icon，
 * dev 模式任务栏显示 Electron 内置原子 logo，与托盘反应炉不一致（2026-09-10
 * 用户实机截图反馈）。现统一收敛到本模块：候选顺序为用户目录实底版 →
 * 本仓库 build 资源，窗口与托盘都从这里取，杜绝再次分叉。
 *
 * @author aceFelix
 */

import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * 纯函数：从候选路径中挑第一个存在的（不依赖 electron 运行时，便于单测）。
 *
 * @param candidates - 按优先级排列的图标候选路径。
 * @returns 第一个存在的路径；全部缺失返回 null。
 */
export function pickIconPath(candidates: string[]): string | null {
  return candidates.find((p) => existsSync(p)) ?? null
}

/** 图标候选路径（按优先级）：用户目录实底版 → 本仓库 build 资源。 */
export function iconCandidates(): string[] {
  return [
    join(app.getPath('home'), '.jarvis', 'jarvis_window.ico'),
    join(__dirname, '../../build/icon.ico')
  ]
}

/** 应用图标路径（BrowserWindow icon 选项等用）；候选全缺失返回 null。 */
export function resolveIconPath(): string | null {
  return pickIconPath(iconCandidates())
}

/**
 * 加载应用图标 NativeImage（Tray 等用）。
 *
 * @returns 图标图像；路径缺失或加载失败返回 null，调用方自行降级。
 */
export function loadAppIcon(): NativeImage | null {
  const path = resolveIconPath()
  if (!path) return null
  const image = nativeImage.createFromPath(path)
  return image.isEmpty() ? null : image
}
