// @vitest-environment jsdom
/**
 * 感知源面板测试（2026-10 阶段 9 W2 第 5 步）：管家服务第二项「感知源」的
 * 契约解析、指令收发与面板交互。
 *
 * 覆盖：
 * - parsePerceptStatus / parsePerceptConfig：完整快照、脏数据回落（缺字段/类型
 *   不符/非数组）、`log_events` 出厂缺省必须回 true（否则「没配过」误显「已关」）；
 * - perceptEnableKey / perceptDetailEntries / formatEventTime / perceptEventSummary；
 * - perceptActions：未连 client 读回 null、写回 ok=false；event_limit 透传；
 *   回执 ok=false → null；保存失败错误内联；
 * - ButlerPanel：服务清单两个入口；点「感知源」进面板；
 * - PerceptSourcePanel：总览各行文案、总开关即时保存并用回执快照刷新、
 *   hot_applied=false 的降级提示、离线态、子标签切换；
 * - PerceptSourceList：未装配收编位不给开关只给理由、观察范围展开、失败徽标；
 * - PerceptScopeForm：只提交实际改动的键、分钟阈值本地校验拦截；
 * - PerceptEventList：事件渲染与「总线未运行」说明。
 *
 * 后端侧 percept.* 的语义（校验/落盘/重装配）在 jarvis 的
 * tests/serve/test_serve_percept_rpc.py 覆盖，这里只验「UI 事件 → 动作调用」与
 * 回执 → 界面呈现。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import ButlerPanel from '@renderer/components/ButlerPanel'
import PerceptSourcePanel from '@renderer/components/PerceptSourcePanel'
import PerceptSourceList from '@renderer/components/PerceptSourceList'
import PerceptScopeForm from '@renderer/components/PerceptScopeForm'
import PerceptEventList from '@renderer/components/PerceptEventList'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useButlerStore } from '@renderer/stores/butlerStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import {
  formatEventTime,
  parsePerceptConfig,
  parsePerceptStatus,
  perceptDetailEntries,
  perceptEnableKey,
  perceptEventSummary,
  type PerceptConfig,
  type PerceptSourceInfo
} from '../../src/shared/percept-contracts'

/** 造一个逐源状态（默认「已实现 + 已注册 + 已开启」，按需覆盖）。 */
function makeSource(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'window',
    label: '前台窗口',
    hint: '只记「切到哪个应用」',
    enabled: true,
    implemented: true,
    registered: true,
    bus_enabled: true,
    stats: {
      enabled: true,
      interval_s: 0,
      events: 2,
      collected: 3,
      errors: 0,
      auto_disabled: false,
      last_error: ''
    },
    detail: { process: 'chrome', title: '订单表.xlsx', exclude_apps: ['1password'] },
    ...over
  }
}

/** 造一份完整状态快照（结构对齐后端 build_status + config 段）。 */
function makeStatus(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    assembled: true,
    bus_running: true,
    counters: { emit: 3, dedup: 1 },
    dedup_window_s: 300,
    log_file: 'C:/Users/me/.jarvis/percept/events.jsonl',
    log_events: true,
    sources: [
      makeSource(),
      makeSource({ name: 'file', label: '目录堆积', detail: { watch_dirs: ['E:/Downloads'] } }),
      makeSource({
        name: 'calendar',
        label: '日历事件',
        implemented: false,
        registered: false,
        bus_enabled: false,
        enabled: false,
        detail: {},
        pending_reason: '本期未装配：面板上刻意不给开关'
      })
    ],
    recent_events: [
      {
        ts: 1762000000,
        source: 'window',
        kind: 'focus_changed',
        payload: { summary: '切到 Chrome · 订单表.xlsx' },
        salience_hint: 0.3,
        dedup_key: 'chrome|订单表.xlsx'
      }
    ],
    pending: ['calendar', 'system', 'schedule'],
    notify_budget: {
      day: '2026-10-18',
      count: 3,
      daily_max: 10,
      pending: 2,
      quiet_hours: '23:00-07:00'
    },
    config: {
      enabled: true,
      window_enabled: true,
      file_enabled: true,
      vcs_enabled: false,
      mail_enabled: false,
      vision_enabled: false,
      log_events: true,
      file_watch_dirs: ['E:/Downloads'],
      vcs_repos: [],
      mail_watch_senders: [],
      window_exclude_apps: ['1password'],
      window_linger_minutes: 45,
      vision_auto_stop_minutes: 0
    },
    ...over
  }
}

/** 注入假读动作。 */
function injectFetch(status: unknown = makeStatus()): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(status)
  useBackendStore.setState({ fetchPerceptStatus: fn } as never)
  return fn
}

/** 注入假写动作（默认回执一份带 hot_applied=true 的快照）。 */
function injectSave(result: { ok: boolean; error?: string; status?: unknown } = { ok: true, status: makeStatus({ hot_applied: true }) }): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(result)
  useBackendStore.setState({ savePerceptConfig: fn } as never)
  return fn
}

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh')
  useButlerStore.setState({ activeService: '' })
  useBackendStore.setState({ client: null, wsConnected: true })
})

afterEach(() => {
  cleanup()
  useBackendStore.setState({ client: null } as never)
})

describe('percept-contracts · 宽容解析', () => {
  it('完整快照：逐源、事件、计数、config 段都按后端字段落地', () => {
    const status = parsePerceptStatus(makeStatus({ hot_applied: false, applied: { enabled: false } }))
    expect(status.enabled).toBe(true)
    expect(status.assembled).toBe(true)
    expect(status.counters).toEqual({ emit: 3, dedup: 1 })
    expect(status.sources).toHaveLength(3)
    expect(status.sources[0].name).toBe('window')
    expect(status.sources[0].stats.events).toBe(2)
    expect(status.sources[2].implemented).toBe(false)
    expect(status.sources[2].pending_reason).toContain('本期未装配')
    expect(status.recent_events[0].payload.summary).toContain('Chrome')
    expect(status.config.file_watch_dirs).toEqual(['E:/Downloads'])
    expect(status.hot_applied).toBe(false)
    expect(status.applied).toEqual({ enabled: false })
  })

  it('脏数据不抛：sources/recent_events 非数组回空，事件缺 source/kind 丢弃', () => {
    const status = parsePerceptStatus({
      sources: 'oops',
      recent_events: [{ kind: 'only_kind' }, { source: 'window', kind: 'ok', payload: {} }],
      counters: { emit: 'NaN-ish' },
      dedup_window_s: 'x'
    })
    expect(status.sources).toEqual([])
    expect(status.recent_events).toHaveLength(1)
    expect(status.counters).toEqual({})
    expect(status.dedup_window_s).toBe(0)
    expect(status.assembled).toBe(false)
  })

  it('config 缺字段回落出厂缺省，log_events 必须回 true（不能把「没配过」显成「已关」）', () => {
    const cfg = parsePerceptConfig({ enabled: true, file_watch_dirs: ['  a ', 'a', '', 1] })
    expect(cfg.log_events).toBe(true)
    expect(cfg.window_linger_minutes).toBe(0)
    expect(cfg.file_watch_dirs).toEqual(['a'])
    expect(cfg.vcs_repos).toEqual([])
  })

  it('逐源开关键：已实现的源有键，未装配的收编位回空串（面板据此不给开关）', () => {
    expect(perceptEnableKey('window')).toBe('window_enabled')
    expect(perceptEnableKey('vision')).toBe('vision_enabled')
    expect(perceptEnableKey('calendar')).toBe('')
    expect(perceptEnableKey('system')).toBe('')
  })

  it('源自报细节：标量与字符串数组成行，嵌套对象/空值跳过，布尔用中性符号', () => {
    const rows = perceptDetailEntries({
      watch_dirs: ['E:/Downloads', 'E:/Desktop'],
      baselined: true,
      grow_threshold: 5,
      snapshot: { a: 1 },
      state_path: '',
      nothing: null
    })
    expect(rows).toEqual([
      { key: 'watch_dirs', value: 'E:/Downloads · E:/Desktop' },
      { key: 'baselined', value: '✓' },
      { key: 'grow_threshold', value: '5' }
    ])
  })

  it('事件摘要与时间：summary 缺失回退 kind，非法 ts 回空串', () => {
    const event = parsePerceptStatus({
      recent_events: [{ ts: 0, source: 'file', kind: 'dir_grown', payload: {} }]
    }).recent_events[0]
    expect(perceptEventSummary(event)).toBe('dir_grown')
    expect(formatEventTime(event.ts)).toBe('')
  })
})

describe('perceptActions · 指令收发', () => {
  /** 造一个假 client（只实现 sendCommand）。 */
  function fakeClient(sendCommand: ReturnType<typeof vi.fn>): void {
    useBackendStore.setState({ client: { sendCommand } as never })
  }

  it('未连后端：读回 null、写回 ok=false（面板显离线态而不是抛异常）', async () => {
    const store = useBackendStore.getState()
    await expect(store.fetchPerceptStatus()).resolves.toBeNull()
    await expect(store.savePerceptConfig({ enabled: true })).resolves.toMatchObject({
      ok: false,
      error: '未连接到后端'
    })
  })

  it('读：event_limit 透传成 event_limit 字段，回执 result 走宽容解析', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, result: makeStatus() })
    fakeClient(send)
    const status = await useBackendStore.getState().fetchPerceptStatus(5)
    expect(send).toHaveBeenCalledWith('percept.status.get', { event_limit: 5 })
    expect(status?.sources[0].label).toBe('前台窗口')
  })

  it('读：省略 event_limit 时不塞非法字段；回执 ok=false 回 null', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, error: '未知指令' })
    fakeClient(send)
    const status = await useBackendStore.getState().fetchPerceptStatus()
    expect(send).toHaveBeenCalledWith('percept.status.get', {})
    expect(status).toBeNull()
  })

  it('写：成功带回读快照（含 hot_applied），失败把后端错误原样交给面板内联显示', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, result: makeStatus({ hot_applied: false }) })
    fakeClient(send)
    const res = await useBackendStore.getState().savePerceptConfig({ window_enabled: false })
    expect(send).toHaveBeenCalledWith('percept.config.set', { window_enabled: false })
    expect(res.ok).toBe(true)
    expect(res.status?.hot_applied).toBe(false)

    send.mockResolvedValue({ ok: false, error: '不支持的感知配置项 dedup_window_s' })
    const failed = await useBackendStore.getState().savePerceptConfig({ enabled: true })
    expect(failed).toMatchObject({ ok: false, error: '不支持的感知配置项 dedup_window_s' })
  })
})

describe('ButlerPanel · 服务清单', () => {
  it('清单里有「邮箱服务」与「感知源」两个入口', () => {
    render(<ButlerPanel />)
    expect(screen.getByTestId('btn-butler-email')).toBeInTheDocument()
    expect(screen.getByTestId('btn-butler-percept')).toHaveTextContent('感知源')
  })

  it('点「感知源」→ 渲染感知源面板，清单收起', async () => {
    injectFetch()
    render(<ButlerPanel />)
    fireEvent.click(screen.getByTestId('btn-butler-percept'))
    expect(useButlerStore.getState().activeService).toBe('percept')
    await waitFor(() => expect(screen.getByTestId('percept-overview')).toBeInTheDocument())
    expect(screen.queryByTestId('butler-service-list')).not.toBeInTheDocument()
  })
})

describe('PerceptSourcePanel', () => {
  it('总览：装配/运行/计数/去重窗口/留痕路径逐行呈现', async () => {
    injectFetch()
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-overview')).toBeInTheDocument())

    const overview = screen.getByTestId('percept-overview')
    // 口径修正：这一行取的是 hub 是否接线，不是“总线装没装”（采集判据在下一行）
    expect(screen.getByTestId('percept-assembled')).toHaveTextContent('已接线')
    expect(screen.getByTestId('percept-running')).toHaveTextContent('采集中')
    expect(overview).toHaveTextContent('emit 3')
    expect(overview).toHaveTextContent('300 秒内同一件事只算一次')
    expect(screen.getByTestId('percept-log-file')).toHaveTextContent('events.jsonl')
  })

  it('宿主未接线时显「需以后端 serve 模式运行」而不是报错', async () => {
    injectFetch(makeStatus({ assembled: false, bus_running: false, counters: {}, log_file: '' }))
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-assembled')).toBeInTheDocument())
    expect(screen.getByTestId('percept-assembled')).toHaveTextContent('未接线')
    // 开关开着但拿不到路径（总线未运行/老后端）：说“暂无路径”，不能谎报“已关闭”
    expect(screen.getByTestId('percept-log-file')).toHaveTextContent('总线未运行')
  })

  it('留痕开关真关时才显「已关闭」', async () => {
    injectFetch(makeStatus({ log_file: '', log_events: false }))
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-log-file')).toBeInTheDocument())
    expect(screen.getByTestId('percept-log-file')).toHaveTextContent('已关闭')
  })

  it('打扰预算行：解释“采到了为什么不说”（今日额度 + 待补播）', async () => {
    injectFetch()
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-budget')).toBeInTheDocument())
    expect(screen.getByTestId('percept-budget')).toHaveTextContent('今日 3/10')
    expect(screen.getByTestId('percept-budget')).toHaveTextContent('待补播 2 条')
  })

  it('后端没给预算（未启用或老版本）：整行不显示，也不编一个 0/0 出来', async () => {
    // 契约层：字段缺失/类型不对/`daily_max<=0` 都回 null
    expect(parsePerceptStatus(makeStatus({ notify_budget: undefined })).notify_budget).toBeNull()
    expect(parsePerceptStatus(makeStatus({ notify_budget: 'x' })).notify_budget).toBeNull()
    expect(
      parsePerceptStatus(makeStatus({ notify_budget: { count: 1, daily_max: 0 } })).notify_budget
    ).toBeNull()
    injectFetch(makeStatus({ notify_budget: undefined }))
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-log-file')).toBeInTheDocument())
    expect(screen.queryByTestId('percept-budget')).not.toBeInTheDocument()
  })

  it('总开关关掉：即时提交 {enabled:false}，并用回执快照刷新（不是乐观更新）', async () => {
    injectFetch()
    const save = injectSave({ ok: true, status: makeStatus({ enabled: false, hot_applied: true }) })
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-master-toggle')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('percept-master-toggle'))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: false }))
    // 回执 enabled=false → 开关的 aria-checked 跟着真实状态走
    await waitFor(() =>
      expect(screen.getByTestId('percept-master-toggle')).toHaveAttribute('aria-checked', 'false')
    )
    expect(screen.getByTestId('percept-notice')).toHaveTextContent('已保存并重装配')
  })

  it('hot_applied=false：提示「本次会话没能重装配，重启后端后生效」', async () => {
    injectFetch()
    injectSave({ ok: true, status: makeStatus({ hot_applied: false }) })
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-master-toggle')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('percept-master-toggle'))
    await waitFor(() => expect(screen.getByTestId('percept-notice')).toBeInTheDocument())
    expect(screen.getByTestId('percept-notice')).toHaveTextContent('重启后端后生效')
  })

  it('保存失败：错误内联显示，面板继续显示改之前的状态', async () => {
    injectFetch()
    injectSave({ ok: false, error: 'settings.toml 落盘失败' })
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-master-toggle')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('percept-master-toggle'))
    await waitFor(() => expect(screen.getByTestId('percept-error')).toHaveTextContent('落盘失败'))
    expect(screen.getByTestId('percept-master-toggle')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('percept-notice')).not.toBeInTheDocument()
    // 反馈条必须排在总览之前（sticky 钉在顶部）：错误落在长面板底部时，用户
    // 只会以为“开关坏了”——2026-10 走查就是被这一点挡住了真缺陷。
    const bar = screen.getByTestId('percept-feedback')
    // eslint-disable-next-line no-bitwise
    expect(
      bar.compareDocumentPosition(screen.getByTestId('percept-overview')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('读侧离线：显离线提示，不渲染开关', async () => {
    injectFetch(null)
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-offline')).toBeInTheDocument())
    expect(screen.queryByTestId('percept-master-toggle')).not.toBeInTheDocument()
  })

  it('三个子标签切换：感知源 / 采集名单 / 最近事件', async () => {
    injectFetch()
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-source-list')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('percept-tab-scope'))
    expect(screen.getByTestId('percept-scope-form')).toBeInTheDocument()
    expect(screen.queryByTestId('percept-source-list')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('percept-tab-events'))
    expect(screen.getByTestId('percept-event-list')).toBeInTheDocument()
    expect(screen.queryByTestId('percept-scope-form')).not.toBeInTheDocument()
  })

  it('刷新按钮重新拉一次状态', async () => {
    const fetch = injectFetch()
    render(<PerceptSourcePanel />)
    await waitFor(() => expect(screen.getByTestId('percept-overview')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('btn-percept-refresh'))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })
})

describe('PerceptSourceList', () => {
  /** 解析出面板状态里的逐源项（用真实解析器，避免测试与后端字段漂移）。 */
  function sourcesOf(): PerceptSourceInfo[] {
    return parsePerceptStatus(makeStatus()).sources
  }

  it('已实现的源给开关，未装配的收编位只给理由（面板上没有假开关）', () => {
    const onPatch = vi.fn()
    render(<PerceptSourceList sources={sourcesOf()} busy={false} onPatch={onPatch} />)

    expect(screen.getByTestId('percept-source-toggle-window')).toBeInTheDocument()
    expect(screen.queryByTestId('percept-source-toggle-calendar')).not.toBeInTheDocument()
    expect(screen.getByTestId('percept-pending-reason-calendar')).toHaveTextContent('本期未装配')
  })

  it('点开关：按源名推补丁键提交', () => {
    const onPatch = vi.fn()
    render(<PerceptSourceList sources={sourcesOf()} busy={false} onPatch={onPatch} />)

    fireEvent.click(screen.getByTestId('percept-source-toggle-file'))
    expect(onPatch).toHaveBeenCalledWith({ file_enabled: false })
  })

  it('账本徽标：采集/投递计数、未注册提示、连续失败与末次错误', () => {
    const sources = parsePerceptStatus({
      sources: [
        makeSource({
          registered: false,
          stats: {
            enabled: true,
            interval_s: 30,
            events: 0,
            collected: 7,
            errors: 4,
            auto_disabled: true,
            last_error: 'IMAP 连接被重置'
          }
        })
      ]
    }).sources
    render(<PerceptSourceList sources={sources} busy={false} onPatch={vi.fn()} />)

    const status = screen.getByTestId('percept-source-status-window')
    expect(status).toHaveTextContent('采到 7 条')
    expect(status).toHaveTextContent('未装配到总线')
    expect(status).toHaveTextContent('连续失败已自动停用')
    expect(screen.getByTestId('percept-source-error-window')).toHaveTextContent('IMAP 连接被重置')
  })

  it('观察范围默认收起，点「观察范围」展开后端自报的行', () => {
    const sources = sourcesOf()
    render(<PerceptSourceList sources={sources} busy={false} onPatch={vi.fn()} />)

    expect(screen.queryByTestId('percept-source-detail-window')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('percept-source-detail-btn-window'))
    const detail = screen.getByTestId('percept-source-detail-window')
    expect(detail).toHaveTextContent('exclude_apps')
    expect(detail).toHaveTextContent('1password')
  })
})

describe('PerceptScopeForm', () => {
  let config: PerceptConfig

  beforeEach(() => {
    config = parsePerceptStatus(makeStatus()).config
  })

  it('草稿按当前配置回填（名单每行一项、分钟原值）', () => {
    render(<PerceptScopeForm config={config} busy={false} onPatch={vi.fn()} />)
    expect(screen.getByTestId('percept-input-file_watch_dirs')).toHaveValue('E:/Downloads')
    expect(screen.getByTestId('percept-input-window_exclude_apps')).toHaveValue('1password')
    expect(screen.getByTestId('percept-input-window_linger_minutes')).toHaveValue('45')
  })

  it('只提交实际改动的键，且切分时去重丢空', async () => {
    const onPatch = vi.fn()
    render(<PerceptScopeForm config={config} busy={false} onPatch={onPatch} />)

    fireEvent.change(screen.getByTestId('percept-input-vcs_repos'), {
      target: { value: ' E:/repo/a \nE:/repo/a\n\n' }
    })
    fireEvent.click(screen.getByTestId('percept-scope-save'))

    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1))
    expect(onPatch).toHaveBeenCalledWith({ vcs_repos: ['E:/repo/a'] })
  })

  it('没改动就点保存：不发补丁（后端会因空补丁报错，那种报错没有意义）', async () => {
    const onPatch = vi.fn()
    render(<PerceptScopeForm config={config} busy={false} onPatch={onPatch} />)
    fireEvent.click(screen.getByTestId('percept-scope-save'))
    await waitFor(() => expect(onPatch).not.toHaveBeenCalled())
  })

  it('分钟非法（空/小数/越界）：本地拦截报错且不调 onPatch', async () => {
    const onPatch = vi.fn()
    render(<PerceptScopeForm config={config} busy={false} onPatch={onPatch} />)

    fireEvent.change(screen.getByTestId('percept-input-window_linger_minutes'), {
      target: { value: '1441' }
    })
    fireEvent.click(screen.getByTestId('percept-scope-save'))
    expect(screen.getByTestId('percept-scope-error')).toBeInTheDocument()
    expect(onPatch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('percept-input-window_linger_minutes'), {
      target: { value: '30' }
    })
    fireEvent.click(screen.getByTestId('percept-scope-save'))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ window_linger_minutes: 30 }))
  })
})

describe('PerceptEventList', () => {
  it('渲染事件行：源名 + 摘要 + 显著性', () => {
    const status = parsePerceptStatus(makeStatus())
    render(<PerceptEventList status={status} />)

    const item = screen.getByTestId('percept-event')
    expect(within(item).getByText('前台窗口')).toBeInTheDocument()
    expect(item).toHaveTextContent('切到 Chrome · 订单表.xlsx')
    expect(item).toHaveTextContent('显著性 0.30')
  })

  it('总线没跑：显说明而不是「暂无事件」', () => {
    const status = parsePerceptStatus(makeStatus({ bus_running: false, recent_events: [] }))
    render(<PerceptEventList status={status} />)
    expect(screen.getByTestId('percept-events-idle')).toHaveTextContent('总线未运行')
    expect(screen.queryByTestId('percept-events-empty')).not.toBeInTheDocument()
  })

  it('在跑但一条没采到：显空态', () => {
    const status = parsePerceptStatus(makeStatus({ recent_events: [] }))
    render(<PerceptEventList status={status} />)
    expect(screen.getByTestId('percept-events-empty')).toHaveTextContent('还没有采到事件')
  })
})
