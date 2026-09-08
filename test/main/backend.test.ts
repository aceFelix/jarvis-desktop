/**
 * backend.ts 单测 —— stdout 握手解析、Python 环境定位、BackendManager 生命周期状态机。
 *
 * 覆盖计划 B5：握手（正常 / 残缺 / 超时）、spawn→ready→kill 状态机、
 * Python / 仓库缺失降级路径。做法：
 * - `spawnFn` 注入假子进程（EventEmitter 冒充 stdout/stderr/exit），不真正拉起 Python；
 * - `child_process.spawn` 被 mock（拦截 Windows 下 killChild 的 taskkill 调用）；
 * - `./logging` 被 mock（避免测试输出被日志刷屏）。
 *
 * @author aceFelix
 */

import { EventEmitter } from 'events'
import { tmpdir } from 'os'
import { resolve as resolvePath } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// child_process.spawn 被 mock：killChild 在 win32 下会调用 spawn('taskkill', ...)，
// 用 spy 拦截，避免测试真的去杀进程；serve 子进程本身走 spawnFn 注入的假进程。
const { spawnSpy } = vi.hoisted(() => ({ spawnSpy: vi.fn() }))
vi.mock('child_process', () => ({ spawn: spawnSpy }))
vi.mock('../../src/main/logging', () => ({ log: vi.fn(), logError: vi.fn() }))

import {
  parseHandshakeLine,
  resolvePythonEnv,
  BackendManager,
  type SpawnFn
} from '../../src/main/backend'
import { SERVE_READY_MARKER } from '../../src/shared/contracts'

/** 假子进程形状（仅覆盖 backend.ts 用到的成员）。 */
interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (enc: string) => void }
  stderr: EventEmitter & { setEncoding: (enc: string) => void }
  pid: number
  killed: boolean
  kill: (signal?: string) => boolean
}

/** 构造一个假子进程（stdout/stderr 可 emit data，on 监听 exit/error）。 */
function makeFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild
  const stdout = new EventEmitter() as FakeChild['stdout']
  stdout.setEncoding = () => {}
  const stderr = new EventEmitter() as FakeChild['stderr']
  stderr.setEncoding = () => {}
  child.stdout = stdout
  child.stderr = stderr
  child.pid = pid
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  return child
}

/** 一条合法握手 JSON 行。 */
const GOOD_LINE = JSON.stringify({
  type: SERVE_READY_MARKER,
  port: 51234,
  http_port: 51235,
  token: 'abc123',
  pid: 999
})

describe('parseHandshakeLine', () => {
  it('解析完整握手 JSON', () => {
    const info = parseHandshakeLine(GOOD_LINE)
    expect(info).not.toBeNull()
    expect(info?.port).toBe(51234)
    expect(info?.http_port).toBe(51235)
    expect(info?.token).toBe('abc123')
    expect(info?.pid).toBe(999)
  })

  it('容忍前后空白与换行', () => {
    expect(parseHandshakeLine(`  ${GOOD_LINE}\n`)?.port).toBe(51234)
  })

  it('http_port / pid 缺失时回退为 0', () => {
    const line = JSON.stringify({ type: SERVE_READY_MARKER, port: 8080, token: 't' })
    const info = parseHandshakeLine(line)
    expect(info?.http_port).toBe(0)
    expect(info?.pid).toBe(0)
  })

  it.each([
    ['type 非就绪标记', JSON.stringify({ type: 'other', port: 1, token: 't' })],
    ['port 为 0', JSON.stringify({ type: SERVE_READY_MARKER, port: 0, token: 't' })],
    ['port 缺失', JSON.stringify({ type: SERVE_READY_MARKER, token: 't' })],
    ['token 为空串', JSON.stringify({ type: SERVE_READY_MARKER, port: 1, token: '' })],
    ['token 缺失', JSON.stringify({ type: SERVE_READY_MARKER, port: 1 })],
    ['普通启动日志', 'Loading agent modules...'],
    ['残缺 JSON', '{"type":"jarvis-serve-'],
    ['非 { 开头', 'warn: {"port":1}']
  ])('残缺/无关行返回 null（%s）', (_label, line) => {
    expect(parseHandshakeLine(line)).toBeNull()
  })
})

describe('resolvePythonEnv', () => {
  it('默认 python + 相对 appDir 的 ../jarvis', () => {
    const env = resolvePythonEnv({}, '/app/desktop')
    expect(env.python).toBe('python')
    expect(env.repo).toBe(resolvePath('/app/desktop', '..', 'jarvis'))
  })

  it('环境变量覆盖 python 与 repo', () => {
    const env = resolvePythonEnv({ JARVIS_PYTHON: 'py311', JARVIS_REPO: '/x/y' }, '/app')
    expect(env.python).toBe('py311')
    expect(env.repo).toBe(resolvePath('/x/y'))
  })
})

describe('BackendManager 生命周期', () => {
  let child: FakeChild | undefined
  let onStatus: ReturnType<typeof vi.fn>

  /** 造一个注入了假 spawn 的管理器（默认指向真实存在的临时目录作 repo）。 */
  function makeManager(opts: Record<string, unknown> = {}): BackendManager {
    child = undefined
    const spawnFn = vi.fn(() => {
      child = makeFakeChild()
      return child as unknown as ReturnType<SpawnFn>
    }) as unknown as SpawnFn
    onStatus = vi.fn()
    return new BackendManager({
      env: { JARVIS_REPO: tmpdir() },
      spawnFn,
      onStatus,
      ...opts
    })
  }

  beforeEach(() => {
    spawnSpy.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawn → 握手 → ready，并透出连接信息', async () => {
    const mgr = makeManager()
    const p = mgr.start()
    expect(mgr.getState()).toBe('spawning')
    // 子进程已在 start() 内同步创建，模拟它打印握手行
    child!.stdout.emit('data', `${GOOD_LINE}\n`)
    const info = await p
    expect(info).toEqual({ port: 51234, httpPort: 51235, token: 'abc123', pid: 999 })
    expect(mgr.getState()).toBe('ready')
    expect(mgr.getInfo()?.token).toBe('abc123')
    // 状态回调依次收到 spawning / ready
    expect(onStatus).toHaveBeenCalledWith('spawning', undefined, undefined)
    expect(onStatus).toHaveBeenCalledWith('ready', info, undefined)
  })

  it('stderr 噪声不中断握手等待', async () => {
    const mgr = makeManager()
    const p = mgr.start()
    child!.stderr.emit('data', 'DeprecationWarning: something\n')
    child!.stdout.emit('data', 'not-json-yet\n')
    child!.stdout.emit('data', `${GOOD_LINE}\n`)
    await expect(p).resolves.toMatchObject({ port: 51234 })
    expect(mgr.getState()).toBe('ready')
  })

  it('仓库不存在 → error 且给出 JARVIS_REPO 提示', async () => {
    const mgr = makeManager({
      env: { JARVIS_REPO: resolvePath(tmpdir(), '__jarvis_no_such_dir__') }
    })
    await expect(mgr.start()).rejects.toThrow(/找不到 jarvis 仓库/)
    expect(mgr.getState()).toBe('error')
    expect(mgr.getLastError()).toContain('JARVIS_REPO')
  })

  it('spawn 抛错（Python 缺失）→ error', async () => {
    child = undefined
    const spawnFn = vi.fn(() => {
      throw new Error('ENOENT')
    }) as unknown as SpawnFn
    onStatus = vi.fn()
    const mgr = new BackendManager({ env: { JARVIS_REPO: tmpdir() }, spawnFn, onStatus })
    await expect(mgr.start()).rejects.toThrow(/spawn 失败/)
    expect(mgr.getState()).toBe('error')
    expect(mgr.getLastError()).toContain('Python')
  })

  it('握手前进程退出 → error', async () => {
    const mgr = makeManager()
    const p = mgr.start()
    child!.emit('exit', 1, null)
    await expect(p).rejects.toThrow(/提前退出/)
    expect(mgr.getState()).toBe('error')
  })

  it('握手超时 → error', async () => {
    vi.useFakeTimers()
    const mgr = makeManager({ handshakeTimeoutMs: 50 })
    const p = mgr.start()
    // 先挂上拒绝断言（同步注册 handler）再推进计时器：否则 reject 发生在
    // await 之后、handler 之前，会被 Node 记为瞬时未处理拒绝。
    const assertion = expect(p).rejects.toThrow(/超时/)
    await vi.advanceTimersByTimeAsync(60)
    await assertion
    expect(mgr.getState()).toBe('error')
  })

  it('ready 后 stop() 杀进程树并转 exited', async () => {
    const mgr = makeManager()
    const p = mgr.start()
    child!.stdout.emit('data', `${GOOD_LINE}\n`)
    await p
    const fake = child!
    await mgr.stop()
    expect(mgr.getState()).toBe('exited')
    expect(mgr.getInfo()).toBeNull()
    if (process.platform === 'win32') {
      expect(spawnSpy).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', String(fake.pid), '/T', '/F'],
        expect.objectContaining({ windowsHide: true })
      )
    } else {
      expect(fake.killed).toBe(true)
    }
  })

  it('ready 后意外退出 → error（非主动停机视为崩溃）', async () => {
    const mgr = makeManager()
    const p = mgr.start()
    child!.stdout.emit('data', `${GOOD_LINE}\n`)
    await p
    child!.emit('exit', 0, null)
    expect(mgr.getState()).toBe('error')
    expect(onStatus).toHaveBeenLastCalledWith(
      'error',
      undefined,
      expect.stringContaining('意外退出')
    )
  })

  it('重复 start()：已 ready 直接复用，不重复 spawn', async () => {
    const mgr = makeManager()
    const p = mgr.start()
    child!.stdout.emit('data', `${GOOD_LINE}\n`)
    const first = await p
    const second = await mgr.start()
    expect(second).toBe(first)
  })
})
