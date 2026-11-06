// @vitest-environment jsdom
/**
 * 代理团队面板测试（2026-11 多 Agent 协作）。
 *
 * 覆盖：
 * - parseAgentsSnapshot：完整快照、脏数据回落（缺字段/坏类型/非数组）；
 * - isAgentActive / isAgentTerminal 的状态口径；
 * - AgentTeamPanel：离线空态、未初始化空态、运行/空闲/离线三种行、只在活着的行
 *   画「停止」、队友额外有「发消息」、失败行显示原因；
 * - buildAgentsActions：未连 client 读回 null、写回 ok=false；status 成功回填 store。
 *
 * 后端侧 agents.exec 的语义在 jarvis 的 tests/serve/test_serve_agents_rpc.py 覆盖，
 * 这里只验「契约 → store → 面板呈现」。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import AgentTeamPanel from '@renderer/components/AgentTeamPanel'
import { useAgentsStore } from '@renderer/stores/agentsStore'
import { buildAgentsActions } from '@renderer/stores/agentsActions'
import { useBackendStore } from '@renderer/stores/backendStore'
import {
  isAgentActive,
  isAgentTerminal,
  parseAgentsSnapshot,
  type AgentsSnapshot
} from '../../src/shared/agents-contracts'
import { Cmd } from '../../src/shared/contracts'
import type { JarvisWsClient } from '@renderer/api/ws'

/** 造一条代理记录（默认 explorer 在跑）。 */
function makeAgent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent_id: 'sub-explorer-1',
    name: 'explorer-1',
    role: 'explorer',
    mode: 'subagent',
    team: 'demo',
    status: 'running',
    task: '找所有 TODO',
    current_tool: 'Grep TODO',
    activity: '搜索 TODO',
    output: '',
    started_at: 1,
    updated_at: 2,
    iterations: 1,
    tool_calls: 2,
    error: '',
    ...over
  }
}

/** 造一份完整快照（默认一条运行中的子代理）。 */
function makeSnapshot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    action: 'status',
    message: '',
    enabled: true,
    team: { name: 'demo', description: '', lead_agent_id: 'team-lead@demo', member_count: 2 },
    agents: [makeAgent()],
    counts: { total: 1, running: 1, idle: 0, offline: 0, done: 0, failed: 0, stopped: 0 },
    task_list: { total: 2, pending: 1, in_progress: 1, completed: 0, items: [] },
    ...over
  }
}

beforeEach(() => {
  useAgentsStore.getState().resetAll()
})

afterEach(() => {
  cleanup()
  useAgentsStore.getState().resetAll()
})

describe('agents contracts', () => {
  it('parses a full snapshot', () => {
    const snap = parseAgentsSnapshot(makeSnapshot())
    expect(snap.enabled).toBe(true)
    expect(snap.team.name).toBe('demo')
    expect(snap.agents).toHaveLength(1)
    expect(snap.agents[0].role).toBe('explorer')
    expect(snap.counts.running).toBe(1)
    expect(snap.task_list.in_progress).toBe(1)
  })

  it('falls back on dirty payloads instead of throwing', () => {
    const snap = parseAgentsSnapshot({
      enabled: 'yes',
      team: 'oops',
      agents: 'not-an-array',
      counts: null,
      task_list: []
    })
    expect(snap.enabled).toBe(false)
    expect(snap.team.name).toBe('')
    expect(snap.agents).toEqual([])
    expect(snap.counts.total).toBe(0)
    expect(snap.task_list.items).toEqual([])
    // null / undefined 也不炸
    expect(parseAgentsSnapshot(null).agents).toEqual([])
  })

  it('classifies statuses consistently', () => {
    expect(isAgentActive('starting')).toBe(true)
    expect(isAgentActive('running')).toBe(true)
    expect(isAgentActive('thinking')).toBe(true)
    expect(isAgentActive('idle')).toBe(false)
    expect(isAgentTerminal('done')).toBe(true)
    expect(isAgentTerminal('failed')).toBe(true)
    expect(isAgentTerminal('stopped')).toBe(true)
    expect(isAgentTerminal('offline')).toBe(true)
    expect(isAgentTerminal('running')).toBe(false)
  })

  it('declares the agents command in the shared contract', () => {
    expect(Cmd.AgentsExec).toBe('agents.exec')
  })
})

describe('AgentTeamPanel', () => {
  it('shows the offline empty state before any snapshot', () => {
    render(<AgentTeamPanel />)
    expect(screen.getByTestId('agents-panel')).toBeTruthy()
    expect(screen.getByText('未连接后端：拿不到代理状态')).toBeTruthy()
  })

  it('shows the disabled state when the session is not initialised', () => {
    const snap = parseAgentsSnapshot(makeSnapshot({ enabled: false, agents: [] }))
    useAgentsStore.getState().setAgents(snap)
    render(<AgentTeamPanel />)
    expect(screen.getByText(/会话还没初始化/)).toBeTruthy()
  })

  it('renders running / idle / offline rows with their activity', () => {
    const snap = parseAgentsSnapshot(
      makeSnapshot({
        agents: [
          makeAgent(),
          makeAgent({
            agent_id: 'researcher@demo',
            name: 'researcher',
            role: 'researcher',
            mode: 'teammate',
            status: 'idle',
            activity: '空闲，等待新任务',
            current_tool: ''
          }),
          makeAgent({
            agent_id: 'coder@demo',
            name: 'coder',
            role: 'coder',
            mode: 'teammate',
            status: 'offline',
            activity: '',
            current_tool: ''
          })
        ],
        counts: { total: 3, running: 1, idle: 1, offline: 1, done: 0, failed: 0, stopped: 0 }
      })
    )
    useAgentsStore.getState().setAgents(snap)
    render(<AgentTeamPanel />)

    expect(screen.getByTestId('agent-row-sub-explorer-1')).toBeTruthy()
    expect(screen.getByText('搜索 TODO')).toBeTruthy()
    expect(screen.getByText('空闲，等待新任务')).toBeTruthy()
    expect(screen.getByText('未运行')).toBeTruthy()
  })

  it('only draws Stop on live rows and Message on teammates', () => {
    const snap = parseAgentsSnapshot(
      makeSnapshot({
        agents: [
          makeAgent(),
          makeAgent({ agent_id: 'done-1', name: 'coder-1', status: 'done', mode: 'subagent' })
        ]
      })
    )
    useAgentsStore.getState().setAgents(snap)
    render(<AgentTeamPanel />)

    const rows = screen.getAllByRole('button')
    const stopButtons = rows.filter((b) => (b as HTMLButtonElement).textContent === '停止')
    // 两条记录里只有运行中的那条有「停止」；已完成的没有
    expect(stopButtons).toHaveLength(1)
    // 子代理没有邮箱：只出现停止，不出现发消息
    expect(rows.some((b) => (b as HTMLButtonElement).textContent === '发消息')).toBe(false)
  })

  it('shows failure reason and never offers Stop for failed rows', () => {
    const snap = parseAgentsSnapshot(
      makeSnapshot({
        agents: [makeAgent({ status: 'failed', error: 'RuntimeError: boom' })]
      })
    )
    useAgentsStore.getState().setAgents(snap)
    render(<AgentTeamPanel />)
    expect(screen.getByText(/失败原因：RuntimeError: boom/)).toBeTruthy()
    expect(screen.queryByText('停止')).toBeNull()
  })
})

describe('buildAgentsActions', () => {
  const fakeClient = (result: unknown, ok = true) =>
    ({
      sendCommand: vi.fn().mockResolvedValue({ ok, result, error: '' })
    }) as unknown as JarvisWsClient

  it('returns null when no client is connected', async () => {
    const actions = buildAgentsActions(() => null)
    expect(await actions.fetchAgents()).toBeNull()
    const op = await actions.stopAgent('x')
    expect(op.ok).toBe(false)
    expect(op.message).toContain('未连接')
  })

  it('refreshes the store from a status reply', async () => {
    const client = fakeClient(makeSnapshot())
    const actions = buildAgentsActions(() => client)
    await actions.refreshAgents()
    const snap = useAgentsStore.getState().snapshot as AgentsSnapshot
    expect(snap.team.name).toBe('demo')
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.AgentsExec, { action: 'status' })
  })

  it('keeps the old snapshot when the reply fails', async () => {
    const snap = parseAgentsSnapshot(makeSnapshot())
    useAgentsStore.getState().setAgents(snap)
    const actions = buildAgentsActions(() => fakeClient(null, false))
    await actions.refreshAgents()
    expect((useAgentsStore.getState().snapshot as AgentsSnapshot).team.name).toBe('demo')
  })
})

// backendStore 仅用于面板动作依赖，这里不触发真实 WS：清掉残留连接。
beforeEach(() => {
  useBackendStore.setState({ client: null })
})
