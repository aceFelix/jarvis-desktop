/**
 * 桌面壳日志：写 userData/logs/desktop.log（对齐 dsh-desktop 的 harness.log 思路）。
 *
 * 主进程专用；渲染进程经 IPC 不直接写文件。初始化前调用 log() 会静默丢弃
 * （仅 console），保证模块加载顺序不敏感。
 *
 * @author aceFelix
 */

import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

let logFile: string | null = null

/** 初始化日志文件（app ready 后调用一次）。 */
export function initLogging(userDataPath: string): string {
  const dir = join(userDataPath, 'logs')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'desktop.log')
  logFile = file
  return file
}

function ts(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/** 追加一行日志（同时输出 console 便于 dev 调试）。 */
export function log(message: string): void {
  const line = `[${ts()}] ${message}`
  console.log(line)
  if (!logFile) return
  try {
    appendFileSync(logFile, line + '\n', 'utf-8')
  } catch {
    // 日志写入失败不影响主流程
  }
}

/** 追加一行错误日志。 */
export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '')
  log(detail ? `${message} | ${detail}` : message)
}
