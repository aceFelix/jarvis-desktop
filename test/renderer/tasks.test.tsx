// @vitest-environment jsdom
/**
 * 任务中心测试（2026-10 阶段 10 W3）：右栏「跨会话目标」+「副作用账本」两个新区块的
 * 契约解析、指令收发与面板交互。
 *
 * 覆盖：
 * - parseTasksSnapshot / parseActionsSnapshot / parseEffectRecord / parseUndoPreview：
 *   完整快照、脏数据回落（缺字段/类型不符/非数组）、`denied_tools` 缺失给空表
 *   （批准按钮据此禁用）、`preview` 的对象形与数组形分别收敛；
 * - shortId / fmtEpoch；
 * - taskActions：未连 client 读回 null、写回 ok=false；两拍动作第一拍**绝不带
 *   confirm**；approve 的 minutes 透传；`refreshTasks` 成功回填两份快照、失败保留
 *   旧数据、离线不动；
 * - SpineTaskPanel：驱动器三态文案、等授权才画批准按钮、`denied_tools` 为空时
 *   点了不发请求、建目标表单校验、删除与批量撤销的两拍流程（确认卡内容取自第一拍）；
 * - EffectJournalPanel：账本未启用的说明、held 行一拍撤回、applied 行两拍回退
 *   （影响面清单 + 整轮提醒原文）、撤不回的项不给按钮、反馈条按 panel 分流。
 *
 * 后端侧 tasks.exec / actions.exec 的语义（租约范围、两拍、落盘）在 jarvis 的
 * tests/serve/test_serve_tasks_rpc.py 与 tests/core/test_driver_approval_blocked.py
 * 覆盖，这里只验「UI 事件 → 动作调用」与回执 → 界面呈现。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import SpineTaskPanel from '@renderer/components/SpineTaskPanel'
import EffectJournalPanel from '@renderer/components/EffectJournalPanel'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useTasksStore } from '@renderer/stores/tasksStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import {
  fmtEpoch,
  parseActionsSnapshot,
  parseTasksSnapshot,
  shortId,
  type ActionsSnapshot,
  type TasksSnapshot
} from '../../src/shared/tasks-contracts'

/** 造一个目标（默认「第二步等授权」，按需覆盖）。 */
function makeGoal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'goal-0001',
    goal: '收集本周纪要',
    status: 'active',
    progress: '1/2',
    summary: '等你授权',
    workdir: 'E:/demo',
    session_id: 's1',
    created_at: '2026-10-20T10:00:00',
    updated_at: '2026-10-22T10:00:00',
    current_step: {
      id: 'step-2',
      desc: '汇总成 weekly.txt',
      state: 'blocked',
      block_reason: 'approval',
      attempts: 1,
      wait: '',
      next_run_at: '',
      journal_ids: ['abc123456789'],
      denied_tools: ['WriteFile']
    },
    steps: [
      { id: 'step-1', desc: '收集纪要', state: 'done', wait: '', result: 'ok', last_error: '', journal_ids: [], denied_tools: [] },
      { id: 'step-2', desc: '汇总成 weekly.txt', state: 'blocked', wait: '', result: '', last_error: '', journal_ids: ['abc123456789'], denied_tools: ['WriteFile'] }
    ],
    ...over
  }
}

/** 造一份 tasks.exec 回执（结构对齐后端 rpc_tasks._tasks_status）。 */
function makeTasksReply(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    action: 'status',
    message: '',
    goals: [makeGoal()],
    count: 1,
    driver_running: true,
    base_dir: 'C:/Users/me/.jarvis/goals',
    tasks_config: {
      enabled: true,
      wait_deadline_hours: 24,
      step_max_attempts: 3,
      retry_backoff_s: 30,
      blocked_ask_days: 3
    },
    ...over
  }
}

/** 造一条账本记录（默认「已执行且可回退」）。 */
function makeRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rec0000000001',
    ts: 1762000000,
    tool: 'WriteFile',
    preview: '写入 weekly.txt',
    state: 'applied',
    due_at: 0,
    task_id: 'goal-0001',
    session_id: 's1',
    workdir: 'E:/demo',
    reversible: true,
    error: '',
    updated_at: 1762000010,
    undo_spec: { kind: 'checkpoint', cid: 'cp-1', workdir: 'E:/demo' },
    args: { path: 'weekly.txt' },
    ...over
  }
}

/** 造一份 actions.exec 回执（默认「1 条在窗 + 1 条最近记录」）。 */
function makeActionsReply(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    action: 'status',
    message: '',
    enabled: true,
    counts: { held: 1, applied: 2, undone: 0 },
    held: [makeRecord({ state: 'held', due_at: Math.floor(Date.now() / 1000) + 30 })],
    held_labels: ['写文件'],
    window_size: 1,
    recent: [makeRecord()],
    actions_config: {
      undo_window_s: 60,
      track_local_writes: true,
      hold_blocks_equivalent: false,
      irreversible_tools: ['SendEmail']
    },
    ...over
  }
}

/** 注入假 client（只实现 sendCommand）。 */
function fakeClient(sendCommand: ReturnType<typeof vi.fn>): void {
  useBackendStore.setState({ client: { sendCommand } as never })
}

/** 注入 SpineTaskPanel 要用的后端动作（默认为成功回执；over 必须在 setState 前合入，
 * 否则 store 里存的还是默认那个无实现的 spy）。@author aceFelix */
function injectSpineActions(over: Record<string, unknown> = {}) {
  const fns = {
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    controlGoal: vi.fn().mockResolvedValue({ ok: true, message: '已暂停', snapshot: null }),
    createGoal: vi.fn().mockResolvedValue({
      ok: true,
      message: '已建立目标',
      snapshot: parseTasksSnapshot(makeTasksReply({ action: 'create' }))
    }),
    deleteGoal: vi.fn().mockResolvedValue({ ok: true, message: '未落手', snapshot: null }),
    approveStep: vi.fn().mockResolvedValue({ ok: true, message: '已签发租约', snapshot: null }),
    undoTask: vi.fn().mockResolvedValue({ ok: true, message: '未落手', snapshot: null }),
    ...over
  }
  useBackendStore.setState(fns as never)
  return fns as Record<string, ReturnType<typeof vi.fn>>
}

/** 注入 EffectJournalPanel 要用的后端动作（同样先合 over 再 setState）。 */
function injectJournalActions(over: Record<string, unknown> = {}) {
  const fns = {
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    cancelHold: vi.fn().mockResolvedValue({
      ok: true,
      message: '已撤回预约',
      snapshot: parseActionsSnapshot(makeActionsReply())
    }),
    undoRecord: vi.fn().mockResolvedValue({ ok: true, message: '未落手', snapshot: null }),
    ...over
  }
  useBackendStore.setState(fns as never)
  return fns as Record<string, ReturnType<typeof vi.fn>>
}

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh')
  useBackendStore.setState({ client: null, wsConnected: true })
  useTasksStore.getState().resetAll()
})

afterEach(() => {
  cleanup()
  useTasksStore.getState().resetAll()
})

describe('tasks-contracts · 宽容解析', () => {
  it('完整快照：目标、当前步、被拒工具清单逐字段落地', () => {
    const snap: TasksSnapshot = parseTasksSnapshot(makeTasksReply())
    expect(snap.driver_running).toBe(true)
    expect(snap.tasks_config.blocked_ask_days).toBe(3)
    const goal = snap.goals[0]
    expect(goal.progress).toBe('1/2')
    expect(goal.current_step?.block_reason).toBe('approval')
    expect(goal.current_step?.denied_tools).toEqual(['WriteFile'])
    expect(goal.steps).toHaveLength(2)
  })

  it('脏数据回落：goals 非数组、配置缺字段、denied_tools 缺失都不抛异常', () => {
    const snap = parseTasksSnapshot({
      ok: true,
      goals: '不是数组',
      count: '三',
      tasks_config: { enabled: 'yes' },
      goals_2: null
    })
    expect(snap.goals).toEqual([])
    expect(snap.count).toBe(0)
    // 类型不符的布尔不视为 true：只有真 true 才算开了
    expect(snap.tasks_config.enabled).toBe(false)
    const noDenied = parseTasksSnapshot({ goals: [{ id: 'g', goal: 'x' }] })
    expect(noDenied.goals[0].current_step).toBeNull()
    expect(noDenied.goals[0].steps).toEqual([])
  })

  it('步骤明细缺 denied_tools 时给空表（批准按钮据此禁用，不是 undefined）', () => {
    const snap = parseTasksSnapshot({ goals: [{ id: 'g', current_step: { id: 's', state: 'blocked', block_reason: 'approval' } }] })
    expect(snap.goals[0].current_step?.denied_tools).toEqual([])
  })

  it('actions 快照：counts 非数字落 0，未知记录字段给安全默认', () => {
    const snap: ActionsSnapshot = parseActionsSnapshot({
      enabled: true,
      counts: { applied: 'x', held: 2 },
      recent: [{ id: 'r1', state: 'weird' }]
    })
    expect(snap.counts.applied).toBe(0)
    expect(snap.counts.held).toBe(2)
    expect(snap.recent[0].reversible).toBe(false)
    expect(snap.recent[0].undo_spec.kind).toBe('')
    expect(snap.held).toEqual([])
  })

  it('preview 两种形状分别收敛：undo 是对象、undo_task 是数组', () => {
    const objectForm = parseActionsSnapshot({
      preview: { files: [{ status: 'M', path: 'a.txt' }], untracked_count: 2, workdir: 'E:/demo', hint: '整轮回退' }
    })
    expect(objectForm.preview).toMatchObject({ files: [{ status: 'M', path: 'a.txt' }], untracked_count: 2 })
    const arrayForm = parseActionsSnapshot({ preview: [{ id: 'r1', tool: 'WriteFile' }] })
    expect(Array.isArray(arrayForm.preview)).toBe(true)
    expect((arrayForm.preview as Array<{ id: string }>)[0].id).toBe('r1')
  })

  it('shortId / fmtEpoch：长 id 截 8 位，非法时间戳原样回数字串', () => {
    expect(shortId('abc123456789')).toBe('abc12345')
    expect(shortId('short')).toBe('short')
    expect(fmtEpoch(0)).toBe('')
  })
})

describe('taskActions · 指令收发', () => {
  it('未连后端：读回 null、写回 ok=false（面板显离线态而不是抛异常）', async () => {
    const store = useBackendStore.getState()
    await expect(store.fetchTasks()).resolves.toBeNull()
    await expect(store.fetchActions()).resolves.toBeNull()
    await expect(store.controlGoal('pause', 'g1')).resolves.toMatchObject({ ok: false, message: '未连接到后端' })
  })

  it('create：goal / steps / wait 只在有值时才进 payload', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, result: makeTasksReply({ action: 'create' }) })
    fakeClient(send)
    await useBackendStore.getState().createGoal({ goal: '收集纪要', steps: ['甲', '乙'], wait: 'time=2026-10-23T09:00' })
    expect(send).toHaveBeenCalledWith('tasks.exec', {
      action: 'create',
      goal: '收集纪要',
      steps: ['甲', '乙'],
      wait: 'time=2026-10-23T09:00'
    })
    await useBackendStore.getState().createGoal({ goal: '只有一条目标' })
    expect(send).toHaveBeenLastCalledWith('tasks.exec', { action: 'create', goal: '只有一条目标' })
  })

  it('两拍动作：第一拍不带 confirm，第二拍才带（delete / undo / undo_task 同口径）', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, result: makeTasksReply({ action: 'delete', need_confirm: true }) })
    fakeClient(send)
    const first = await useBackendStore.getState().deleteGoal('g1', false)
    expect(send).toHaveBeenLastCalledWith('tasks.exec', { action: 'delete', goal_id: 'g1' })
    // need_confirm 必须原样透出，面板据此挂确认卡而不是当成失败
    expect(first.need_confirm).toBe(true)
    await useBackendStore.getState().deleteGoal('g1', true)
    expect(send).toHaveBeenLastCalledWith('tasks.exec', { action: 'delete', goal_id: 'g1', confirm: true })

    const sendActions = vi.fn().mockResolvedValue({ ok: true, result: makeActionsReply({ action: 'undo', need_confirm: true }) })
    useBackendStore.setState({ client: { sendCommand: sendActions } as never })
    await useBackendStore.getState().undoRecord('r1', false)
    expect(sendActions).toHaveBeenLastCalledWith('actions.exec', { action: 'undo', id: 'r1' })
    await useBackendStore.getState().undoTask('g1', true)
    expect(sendActions).toHaveBeenLastCalledWith('actions.exec', { action: 'undo_task', goal_id: 'g1', confirm: true })
  })

  it('cancel_hold 一拍落手：只带 id，不塞 confirm', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, result: makeActionsReply({ action: 'cancel_hold' }) })
    fakeClient(send)
    const res = await useBackendStore.getState().cancelHold('r1')
    expect(send).toHaveBeenCalledWith('actions.exec', { action: 'cancel_hold', id: 'r1' })
    expect(res.ok).toBe(true)
  })

  it('approve：minutes 省略时不传（用后端默认），传了才带上且取整', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, result: makeTasksReply({ action: 'approve' }) })
    fakeClient(send)
    await useBackendStore.getState().approveStep('g1', 's2')
    expect(send).toHaveBeenLastCalledWith('tasks.exec', { action: 'approve', goal_id: 'g1', step_id: 's2' })
    await useBackendStore.getState().approveStep('g1', 's2', 12.7)
    expect(send).toHaveBeenLastCalledWith('tasks.exec', { action: 'approve', goal_id: 'g1', step_id: 's2', minutes: 12 })
  })

  it('业务失败与传输失败都回 ok=false，文案取后端原文', async () => {
    fakeClient(vi.fn().mockResolvedValue({ ok: true, result: { ok: false, message: '驱动器没起，没有可批准的步骤' } }))
    await expect(useBackendStore.getState().approveStep('g1', 's2')).resolves.toMatchObject({
      ok: false,
      message: '驱动器没起，没有可批准的步骤'
    })
    fakeClient(vi.fn().mockResolvedValue({ ok: false, error: '指令未被受理' }))
    await expect(useBackendStore.getState().controlGoal('pause', 'g1')).resolves.toMatchObject({
      ok: false,
      message: '指令未被受理'
    })
  })

  it('refreshTasks：成功回填两份快照，单侧失败保留旧数据', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: makeTasksReply() })
      .mockResolvedValueOnce({ ok: true, result: makeActionsReply() })
    fakeClient(send)
    await useBackendStore.getState().refreshTasks()
    expect(useTasksStore.getState().tasks?.count).toBe(1)
    expect(useTasksStore.getState().actions?.enabled).toBe(true)

    // 下一次账本读取失败：台账/账本都不该被抹成 null
    send.mockImplementationOnce(() => Promise.resolve({ ok: false, error: '超时' }))
    send.mockImplementationOnce(() => Promise.resolve({ ok: false, error: '超时' }))
    await useBackendStore.getState().refreshTasks()
    expect(useTasksStore.getState().tasks?.count).toBe(1)
    expect(useTasksStore.getState().actions?.enabled).toBe(true)
  })

  it('refreshTasks：未连接时不动 store（断开由 resetAll 负责）', async () => {
    useTasksStore.getState().setTasks(parseTasksSnapshot(makeTasksReply()))
    await useBackendStore.getState().refreshTasks()
    expect(useTasksStore.getState().tasks?.count).toBe(1)
  })
})

describe('SpineTaskPanel · 跨会话目标', () => {
  it('挂载即拉一次快照，并显示驱动器在跑', async () => {
    useTasksStore.getState().setTasks(parseTasksSnapshot(makeTasksReply()))
    const fns = injectSpineActions()
    render(<SpineTaskPanel />)
    await waitFor(() => expect(fns.refreshTasks).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('spine-driver-line').textContent).toContain('驱动器在盯')
  })

  it('驱动器没起与配置没开分别说（不出现"看起来正常"的假可用）', () => {
    useTasksStore.getState().setTasks(
      parseTasksSnapshot(makeTasksReply({ driver_running: false, tasks_config: { enabled: true } }))
    )
    const { rerender } = render(<SpineTaskPanel />)
    expect(screen.getByTestId('spine-driver-line').textContent).toContain('驱动器未起')

    useTasksStore.getState().setTasks(
      parseTasksSnapshot(makeTasksReply({ driver_running: false, tasks_config: { enabled: false } }))
    )
    rerender(<SpineTaskPanel />)
    expect(screen.getByTestId('spine-driver-line').textContent).toContain('[tasks] 是关的')
  })

  it('没有快照时显未连接，而不是显空台账', () => {
    injectSpineActions()
    render(<SpineTaskPanel />)
    expect(screen.getByTestId('spine-driver-line').textContent).toContain('未连接后端')
  })

  it('等授权的目标画批准按钮，点击按目标与步骤 id 发 approve', async () => {
    useTasksStore.getState().setTasks(parseTasksSnapshot(makeTasksReply()))
    const fns = injectSpineActions()
    render(<SpineTaskPanel />)
    fireEvent.click(screen.getByTestId('spine-approve-btn'))
    await waitFor(() => expect(fns.approveStep).toHaveBeenCalledWith('goal-0001', 'step-2'))
    expect(screen.getByTestId('spine-goal').textContent).toContain('等你授权')
    expect(screen.getByTestId('spine-goal').textContent).toContain('被拦：WriteFile')
  })

  it('被拦工具清单为空时不发请求（后端也会拒，白跑一个往返）', async () => {
    useTasksStore.getState().setTasks(
      parseTasksSnapshot({
        goals: [
          makeGoal({
            current_step: { id: 'step-2', state: 'blocked', block_reason: 'approval', denied_tools: [] }
          })
        ]
      })
    )
    const fns = injectSpineActions()
    render(<SpineTaskPanel />)
    fireEvent.click(screen.getByTestId('spine-approve-btn'))
    expect(fns.approveStep).not.toHaveBeenCalled()
    expect(screen.getByTestId('spine-notice').textContent).toContain('不签范围不明的放行')
  })

  it('非等授权的活跃目标画暂停，暂停态画继续（暂停时不递批准）', () => {
    useTasksStore.getState().setTasks(
      parseTasksSnapshot({ goals: [makeGoal({ status: 'active', current_step: { id: 's', state: 'pending', denied_tools: [] } })] })
    )
    const { rerender } = render(<SpineTaskPanel />)
    expect(screen.getByText('暂停')).toBeTruthy()

    // 暂停 + 等授权：驱动器不会重试，递「批准」只能给「继续」——签了租约也是放着过期
    useTasksStore.getState().setTasks(parseTasksSnapshot({ goals: [makeGoal({ status: 'paused' })] }))
    rerender(<SpineTaskPanel />)
    expect(screen.getByText('继续')).toBeTruthy()
    expect(screen.queryByTestId('spine-approve-btn')).toBeNull()
    // 但「等你授权」的 chip 仍然显示，不让用户漏掉那个目标在等什么
    expect(screen.getByTestId('spine-goal').textContent).toContain('等你授权')
  })

  it('建目标：空文本拦下，非空提交后收起表单', async () => {
    const fns = injectSpineActions()
    render(<SpineTaskPanel />)
    fireEvent.click(screen.getByText('建一个'))
    fireEvent.click(screen.getByText('建立目标'))
    expect(fns.createGoal).not.toHaveBeenCalled()
    expect(screen.getByTestId('spine-notice').textContent).toContain('目标文本不能为空')

    fireEvent.change(screen.getByTestId('spine-goal-input'), { target: { value: '整理下载目录' } })
    fireEvent.change(screen.getByTestId('spine-wait-input'), { target: { value: 'file_exists=D:/a.txt' } })
    fireEvent.click(screen.getByText('建立目标'))
    await waitFor(() =>
      expect(fns.createGoal).toHaveBeenCalledWith({ goal: '整理下载目录', wait: 'file_exists=D:/a.txt' })
    )
    expect(screen.queryByTestId('spine-create-form')).toBeNull()
  })

  it('删除走两拍：第一拍的影响面挂成确认卡，确认后才带 confirm 重发', async () => {
    useTasksStore.getState().setTasks(parseTasksSnapshot(makeTasksReply()))
    const first = { ok: true, need_confirm: true, message: '要删的是这个目标', snapshot: null }
    const fns = injectSpineActions({
      deleteGoal: vi
        .fn()
        .mockResolvedValueOnce({ ...first, snapshot: parseTasksSnapshot(makeTasksReply({ action: 'delete', need_confirm: true, goal: makeGoal() })) })
        .mockResolvedValueOnce({ ok: true, message: '已删除', snapshot: parseTasksSnapshot(makeTasksReply({ goals: [], count: 0 })) })
    })
    render(<SpineTaskPanel />)
    fireEvent.click(screen.getByText('删除'))
    await waitFor(() => expect(fns.deleteGoal).toHaveBeenCalledWith('goal-0001', false))
    expect(screen.getByTestId('spine-confirm').textContent).toContain('要删掉的是这个目标')

    fireEvent.click(screen.getByTestId('spine-confirm-do'))
    await waitFor(() => expect(fns.deleteGoal).toHaveBeenCalledWith('goal-0001', true))
    await waitFor(() => expect(screen.queryByTestId('spine-confirm')).toBeNull())
    expect(useTasksStore.getState().tasks?.count).toBe(0)
  })

  it('批量撤销走 actions.exec：第一拍是记录数组，确认后第二拍带 confirm', async () => {
    useTasksStore.getState().setTasks(parseTasksSnapshot(makeTasksReply()))
    const previewRecords = [
      { ...makeRecord(), id: 'r1' },
      { ...makeRecord(), id: 'r2', tool: 'SendEmail', reversible: false, undo_spec: { kind: 'none', reason: '邮件已发出' } }
    ]
    const fns = injectSpineActions({
      undoTask: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          need_confirm: true,
          message: '该目标名下有 2 条副作用',
          snapshot: parseActionsSnapshot(makeActionsReply({ action: 'undo_task', need_confirm: true, preview: previewRecords }))
        })
        .mockResolvedValueOnce({
          ok: true,
          message: '撤了 1 条，撤不动 1 条',
          snapshot: parseActionsSnapshot(makeActionsReply({ action: 'undo_task', items: ['r1 已回退', 'r2 撤不回：邮件已发出'] }))
        })
    })
    render(<SpineTaskPanel />)
    fireEvent.click(screen.getByText('撤销它的改动'))
    await waitFor(() => expect(fns.undoTask).toHaveBeenCalledWith('goal-0001', false))
    expect(screen.getByTestId('spine-confirm').textContent).toContain('SendEmail')

    fireEvent.click(screen.getByTestId('spine-confirm-do'))
    await waitFor(() => expect(fns.undoTask).toHaveBeenCalledWith('goal-0001', true))
    expect(screen.getByTestId('spine-notice').textContent).toContain('撤不动')
  })

  it('空台账给可读的空态说明', () => {
    useTasksStore.getState().setTasks(parseTasksSnapshot(makeTasksReply({ goals: [], count: 0 })))
    injectSpineActions()
    render(<SpineTaskPanel />)
    expect(screen.getByTestId('spine-goal-empty').textContent).toContain('还没有长线目标')
  })
})

describe('EffectJournalPanel · 副作用账本', () => {
  it('账本未启用时只说明不画撤销入口', () => {
    useTasksStore.getState().setActions(parseActionsSnapshot({ enabled: false, message: '未启用' }))
    render(<EffectJournalPanel />)
    expect(screen.getByTestId('journal-disabled').textContent).toContain('副作用账本未启用')
    expect(screen.queryAllByTestId('journal-undo-btn')).toHaveLength(0)
  })

  it('held 项给倒计时与一拍撤回（不塞 confirm）', async () => {
    useTasksStore.getState().setActions(parseActionsSnapshot(makeActionsReply()))
    const fns = injectJournalActions()
    render(<EffectJournalPanel />)
    expect(screen.getByTestId('journal-window').textContent).toContain('回退窗口 60 秒')
    expect(screen.getByTestId('journal-held-list').textContent).toContain('待执行')

    fireEvent.click(screen.getByTestId('journal-cancel-hold'))
    await waitFor(() => expect(fns.cancelHold).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('journal-notice').textContent).toContain('已撤回预约')
  })

  it('回退这一轮走两拍：文件清单与整轮提醒都摊开后才带 confirm', async () => {
    const preview = {
      files: [{ status: 'M', path: 'weekly.txt' }],
      untracked_count: 2,
      workdir: 'E:/demo',
      hint: '回退粒度是整轮，不是单个文件'
    }
    const fns = injectJournalActions({
      undoRecord: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          need_confirm: true,
          message: '影响面如下',
          snapshot: parseActionsSnapshot(makeActionsReply({ action: 'undo', need_confirm: true, preview }))
        })
        .mockResolvedValueOnce({
          ok: true,
          message: '已回退到本轮开始前',
          snapshot: parseActionsSnapshot(makeActionsReply({ action: 'undo' }))
        })
    })
    useTasksStore.getState().setActions(parseActionsSnapshot(makeActionsReply()))
    render(<EffectJournalPanel />)
    fireEvent.click(screen.getByTestId('journal-undo-btn'))
    await waitFor(() => expect(fns.undoRecord).toHaveBeenCalledWith('rec0000000001', false))
    const card = screen.getByTestId('journal-confirm')
    expect(card.textContent).toContain('weekly.txt')
    expect(card.textContent).toContain('另有 2 个新建文件会被删除')
    // 后端的整轮提醒必须原样显示，不能省
    expect(card.textContent).toContain('回退粒度是整轮')

    fireEvent.click(screen.getByTestId('journal-confirm-do'))
    await waitFor(() => expect(fns.undoRecord).toHaveBeenCalledWith('rec0000000001', true))
    expect(screen.queryByTestId('journal-confirm')).toBeNull()
  })

  it('撤不回的项只说撤不回并带上后端原因，不给按钮', () => {
    useTasksStore.getState().setActions(
      parseActionsSnapshot(
        makeActionsReply({
          held: [],
          recent: [makeRecord({ reversible: false, undo_spec: { kind: 'none', reason: '邮件已发出，收件人那边不在我手里' } })]
        })
      )
    )
    injectJournalActions()
    render(<EffectJournalPanel />)
    expect(screen.queryByTestId('journal-undo-btn')).toBeNull()
    const frozen = screen.getByText('撤不回')
    expect(frozen.getAttribute('title')).toContain('邮件已发出')
  })

  it('未知状态收敛成「未知状态」，不把内部键名画到界面上', () => {
    useTasksStore.getState().setActions(parseActionsSnapshot(makeActionsReply({ held: [], recent: [makeRecord({ state: 'weird' })] })))
    injectJournalActions()
    render(<EffectJournalPanel />)
    expect(screen.getByTestId('journal-recent-list').textContent).toContain('未知状态')
    expect(screen.getByTestId('journal-recent-list').textContent).not.toContain('tasks.journal.state')
  })

  it('反馈条按 panel 分流：账本的提示不会串到目标区块', () => {
    useTasksStore.getState().setNotice({ text: '已回退到本轮开始前', tone: 'ok', panel: 'journal' })
    useTasksStore.getState().setTasks(parseTasksSnapshot(makeTasksReply()))
    injectSpineActions()
    const { container } = render(
      <div>
        <SpineTaskPanel />
        <EffectJournalPanel />
      </div>
    )
    const spine = container.querySelector('[data-testid="spine-task-panel"]')
    const journal = container.querySelector('[data-testid="effect-journal-panel"]')
    expect(spine?.textContent).not.toContain('已回退到本轮开始前')
    expect(journal?.textContent).toContain('已回退到本轮开始前')
  })
})
