/**
 * 后端进程管理：spawn `python -m agent.serve` 并解析 stdout 握手 JSON。
 *
 * 生命周期状态机：idle → spawning → ready → exited（任何阶段失败 → error）。
 * 对齐 dsh-desktop 的 harness-runtime 思路：壳不重写 Agent 运行时，
 * 只负责拉起、健康握手、退出回收（Windows 下 taskkill /T 杀进程树）。
 *
 * 一期 dev 模式：依赖本机 jarvis 源码仓库，经环境变量定位——
 * - JARVIS_PYTHON：Python 解释器（默认 "python"）
 * - JARVIS_REPO：jarvis 仓库路径（默认相对本仓库 "../jarvis"）
 *
 * 二期打包态：不再依赖本机 Python，改 spawn 随安装包分发的冻结后端
 * jarvis-serve.exe（electron-builder extraResources 放到 resources/jarvis-serve/）；
 * 亦可用 JARVIS_SERVE_EXE 显式指定 exe（自测/特殊部署）。
 *
 * @author aceFelix
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join as joinPath, resolve as resolvePath } from 'path'
import {
  SERVE_READY_MARKER,
  type BackendInfo,
  type BackendState,
  type HandshakeInfo
} from '../shared/contracts'
import { log, logError } from './logging'

/** 握手等待超时（毫秒）：超时判定 Python 环境异常。 */
export const HANDSHAKE_TIMEOUT_MS = 30_000

/** Python 环境定位结果。 */
export interface PythonEnv {
  python: string
  repo: string
}

/**
 * 定位 Python 解释器与 jarvis 仓库路径（纯函数，可测）。
 *
 * @param env - 环境变量表（测试注入）。
 * @param appDir - 应用根目录（打包后为 resources/app，dev 为仓库根）。
 */
export function resolvePythonEnv(
  env: NodeJS.ProcessEnv,
  appDir: string
): PythonEnv {
  const python = env.JARVIS_PYTHON || 'python'
  const repo = env.JARVIS_REPO
    ? resolvePath(env.JARVIS_REPO)
    : resolvePath(appDir, '..', 'jarvis')
  return { python, repo }
}

/**
 * 后端启动计划：统一描述 dev（python -m agent.serve）与打包态（冻结 exe）两种拉起方式。
 * mode 决定存在性校验与错误提示口径。@author aceFelix
 */
export interface LaunchPlan {
  /** spawn 可执行文件（python 解释器或 jarvis-serve.exe）。 */
  command: string
  /** 传给 command 的参数（dev 为 ['-m','agent.serve']；exe 无参）。 */
  args: string[]
  /** 子进程工作目录（dev 为 jarvis 仓库；exe 为其所在目录）。 */
  cwd: string
  /** 'exe' 用随包冻结后端；'python' 用本机解释器。 */
  mode: 'exe' | 'python'
  /** 人类可读标签（日志用）。 */
  label: string
}

/** resolveLaunchPlan 的输入（均可注入以便单测）。 */
export interface LaunchPlanInput {
  env: NodeJS.ProcessEnv
  appDir: string
  /** Electron app.isPackaged。 */
  isPackaged?: boolean
  /** Electron process.resourcesPath（打包态 resources 目录）。 */
  resourcesPath?: string
}

/**
 * 决策后端启动计划（纯函数，可测）。优先级：
 * 1) JARVIS_SERVE_EXE 显式 exe（自测/特殊部署，跨 dev/打包均生效）；
 * 2) 打包态（isPackaged + resourcesPath）用 resources/jarvis-serve/jarvis-serve.exe；
 * 3) 否则回退 dev：python -m agent.serve（本机 jarvis 仓库）。
 *
 * @author aceFelix
 */
export function resolveLaunchPlan(input: LaunchPlanInput): LaunchPlan {
  const { env, appDir, isPackaged, resourcesPath } = input
  const explicitExe = env.JARVIS_SERVE_EXE
  if (explicitExe) {
    const exe = resolvePath(explicitExe)
    return {
      command: exe,
      args: [],
      cwd: dirname(exe),
      mode: 'exe',
      label: exe
    }
  }
  if (isPackaged && resourcesPath) {
    const exe = joinPath(resourcesPath, 'jarvis-serve', 'jarvis-serve.exe')
    return {
      command: exe,
      args: [],
      cwd: dirname(exe),
      mode: 'exe',
      label: exe
    }
  }
  const { python, repo } = resolvePythonEnv(env, appDir)
  return {
    command: python,
    args: ['-m', 'agent.serve'],
    cwd: repo,
    mode: 'python',
    label: `${python} -m agent.serve (cwd=${repo})`
  }
}

/**
 * 从 stdout 行解析握手 JSON（纯函数，可测）。
 *
 * 只认单行、type 为就绪标记、port/token 字段齐全的 JSON；
 * 其余行（Python warning、启动日志等）一律返回 null 继续等。
 */
export function parseHandshakeLine(line: string): HandshakeInfo | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed) as Partial<HandshakeInfo>
    if (
      obj.type === SERVE_READY_MARKER &&
      typeof obj.port === 'number' &&
      obj.port > 0 &&
      typeof obj.token === 'string' &&
      obj.token.length > 0
    ) {
      return {
        type: SERVE_READY_MARKER,
        port: obj.port,
        http_port: typeof obj.http_port === 'number' ? obj.http_port : 0,
        token: obj.token,
        pid: typeof obj.pid === 'number' ? obj.pid : 0
      }
    }
  } catch {
    // 非 JSON 行：忽略
  }
  return null
}

/** spawn 注入点（测试用假进程替换）。 */
export type SpawnFn = (
  cmd: string,
  args: string[],
  options: Record<string, unknown>
) => ChildProcessWithoutNullStreams

export interface BackendManagerOptions {
  env?: NodeJS.ProcessEnv
  appDir?: string
  /** Electron app.isPackaged（index.ts 注入）：决定 dev/exe 拉起方式。 */
  isPackaged?: boolean
  /** Electron process.resourcesPath（index.ts 注入）：打包态 exe 所在 resources 目录。 */
  resourcesPath?: string
  spawnFn?: SpawnFn
  handshakeTimeoutMs?: number
  /** 状态变化回调（index.ts 里转发给渲染进程）。 */
  onStatus?: (state: BackendState, info?: BackendInfo, error?: string) => void
}

/**
 * serve 子进程管理器：start → 握手 → ready；stop/崩溃 → 回收。
 *
 * @author aceFelix
 */
export class BackendManager {
  private readonly opts: Required<
    Pick<BackendManagerOptions, 'env' | 'appDir' | 'handshakeTimeoutMs'>
  > & BackendManagerOptions
  private child: ChildProcessWithoutNullStreams | null = null
  private state: BackendState = 'idle'
  private info: BackendInfo | null = null
  private lastError = ''
  /** stop() 主动停机标记：区分"被杀"与"崩溃"。 */
  private stopping = false

  constructor(options: BackendManagerOptions = {}) {
    this.opts = {
      env: process.env,
      appDir: process.cwd(),
      handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
      ...options
    }
  }

  getState(): BackendState {
    return this.state
  }

  getInfo(): BackendInfo | null {
    return this.info
  }

  getLastError(): string {
    return this.lastError
  }

  /** 拉起 serve 子进程并等待握手（resolve 于 ready / reject 于失败）。 */
  start(): Promise<BackendInfo> {
    if (this.state === 'ready' && this.info) {
      return Promise.resolve(this.info)
    }
    if (this.state === 'spawning') {
      return Promise.reject(new Error('后端已在启动中'))
    }
    const plan = resolveLaunchPlan({
      env: this.opts.env ?? process.env,
      appDir: this.opts.appDir ?? process.cwd(),
      isPackaged: this.opts.isPackaged,
      resourcesPath: this.opts.resourcesPath
    })
    // 存在性校验按模式分开：dev 验仓库在否，exe 验内置后端在否。
    if (plan.mode === 'python' && !existsSync(plan.cwd)) {
      return this.fail(`找不到 jarvis 仓库: ${plan.cwd}（设置环境变量 JARVIS_REPO 指向它）`)
    }
    if (plan.mode === 'exe' && !existsSync(plan.command)) {
      return this.fail(`找不到内置后端可执行文件: ${plan.command}（安装包可能损坏，请重新安装）`)
    }
    log(`拉起后端: ${plan.label}`)
    this.stopping = false
    this.setState('spawning')

    return new Promise<BackendInfo>((resolve, reject) => {
      let settled = false
      const spawnFn = this.opts.spawnFn ?? (spawn as unknown as SpawnFn)
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawnFn(plan.command, plan.args, {
          cwd: plan.cwd,
          // Windows 下隐藏控制台窗口（python/exe 都需保留 stdout 管道握手）
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const hint =
          plan.mode === 'python'
            ? `检查 Python 是否安装: ${plan.command}`
            : `检查内置后端是否就绪: ${plan.command}`
        this.fail(`spawn 失败: ${msg}（${hint}）`).catch(reject)
        return
      }
      this.child = child

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.killChild()
        this.fail(`握手超时（${this.opts.handshakeTimeoutMs}ms 未收到就绪 JSON）`)
          .catch(reject)
      }, this.opts.handshakeTimeoutMs)

      let stdoutBuf = ''
      child.stdout.setEncoding('utf-8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuf += chunk
        let idx: number
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx)
          stdoutBuf = stdoutBuf.slice(idx + 1)
          const handshake = parseHandshakeLine(line)
          if (handshake && !settled) {
            settled = true
            clearTimeout(timer)
            this.info = {
              port: handshake.port,
              httpPort: handshake.http_port,
              token: handshake.token,
              pid: handshake.pid
            }
            log(`后端就绪: ws_port=${handshake.port} pid=${handshake.pid}`)
            this.setState('ready', this.info)
            resolve(this.info)
          }
        }
      })

      child.stderr.setEncoding('utf-8')
      child.stderr.on('data', (chunk: string) => {
        // stderr 只记日志（Python 警告不该中断握手等待）
        for (const line of chunk.split(/\r?\n/)) {
          if (line.trim()) log(`[serve:stderr] ${line}`)
        }
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.fail(`子进程错误: ${err.message}`).catch(reject)
      })

      child.on('exit', (code, signal) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          this.fail(
            `serve 进程提前退出 (code=${code}, signal=${signal})，`
              + `请检查后端启动命令（${plan.label}）及其运行环境`
          ).catch(reject)
          return
        }
        // 已就绪后的退出：非主动停机视为崩溃，通知渲染进程
        this.child = null
        if (this.stopping) {
          log(`后端已停止 (code=${code})`)
          this.setState('exited')
        } else {
          logError(`后端意外退出 (code=${code}, signal=${signal})`)
          this.setState('error', undefined, `后端进程意外退出 (code=${code})`)
        }
      })
    })
  }

  /** 主动停机：杀子进程树（Windows taskkill /T，其余 SIGTERM）。 */
  async stop(): Promise<void> {
    this.stopping = true
    this.killChild()
    this.info = null
    if (this.state !== 'idle') {
      this.setState('exited')
    }
  }

  private killChild(): void {
    const child = this.child
    if (!child || child.killed || child.pid === undefined) {
      this.child = null
      return
    }
    try {
      if (process.platform === 'win32') {
        // Windows：杀整棵进程树（serve 可能再派生 MCP/LSP 子进程）
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true
        })
      } else {
        child.kill('SIGTERM')
      }
    } catch (err) {
      logError('回收后端进程失败', err)
    }
    this.child = null
  }

  private setState(state: BackendState, info?: BackendInfo, error?: string): void {
    this.state = state
    if (error) this.lastError = error
    this.opts.onStatus?.(state, info, error)
  }

  /**
   * 置 error 态 + 记日志后【抛错】（返回 rejected promise）。
   *
   * 注意：本方法总是 reject，故调用方两种正确用法——
   * - start() 早退分支：直接 `return this.fail(...)`（把 rejected 透传给调用者）；
   * - Promise 执行器内：`this.fail(...).catch(reject)`（用 catch 兑现外层 reject，
   *   若误用 .then(reject) 则 reject 永不触发、start() 悬挂并产生未处理拒绝）。
   */
  private async fail(message: string): Promise<never> {
    logError(`后端启动失败: ${message}`)
    this.setState('error', undefined, message)
    throw new Error(message)
  }
}

/** 单例（index.ts 创建，IPC handler 引用）。 */
let manager: BackendManager | null = null

export function createBackendManager(options: BackendManagerOptions = {}): BackendManager {
  manager = new BackendManager(options)
  return manager
}

export function getBackendManager(): BackendManager | null {
  return manager
}

/** 供测试复位单例。 */
export function resetBackendManager(): void {
  manager = null
}
