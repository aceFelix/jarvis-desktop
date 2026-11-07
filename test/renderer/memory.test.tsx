// @vitest-environment jsdom
/**
 * 长期记忆（设置面板，2026-11）测试。
 *
 * 覆盖：
 * - `memory-contracts` 的宽容解析（完整/脏数据/缺字段）；
 * - `buildMemoryActions`：未连 client、读取成功回填、保存成功回填、失败保留旧快照；
 * - `MemoryPanel` + `MemoryBubble`：两行入口、无项目置灰、点开气泡、编辑保存后
 *   显示「已保存」且回执带正确的 scope/content。
 *
 * 后端 `memory.get/save` 的真实语义在 jarvis 的 tests/memory/test_memory_scopes.py 覆盖，
 * 这里只验「契约 → store → 面板呈现」。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import MemoryPanel from '@renderer/components/MemoryPanel'
import { buildMemoryActions } from '@renderer/stores/memoryActions'
import { useMemoryStore } from '@renderer/stores/memoryStore'
import { useBackendStore } from '@renderer/stores/backendStore'
import {
  memoryEntryOf,
  parseMemorySaveResult,
  parseMemorySnapshot
} from '../../src/shared/memory-contracts'
import { Cmd } from '../../src/shared/contracts'
import type { JarvisWsClient } from '@renderer/api/ws'

/** 造一份 memory.get 回执。 */
function makeSnapshot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workdir: 'E:/proj/demo',
    entries: [
      {
        scope: 'user',
        path: 'C:/Users/u/.jarvis/MEMORY.md',
        content: '# 长期记忆\n\n- 用户喜欢简洁回答（2026-11-06）',
        exists: true,
        chars: 38,
        updated_at: 100
      },
      {
        scope: 'project',
        path: 'E:/proj/demo/.jarvis/MEMORY.md',
        content: '',
        exists: false,
        chars: 0,
        updated_at: 0
      }
    ],
    ...over
  }
}

beforeEach(() => {
  useMemoryStore.getState().reset()
  useBackendStore.setState({ client: null })
})

afterEach(() => {
  cleanup()
  useMemoryStore.getState().reset()
  useBackendStore.setState({ client: null })
})

describe('memory contracts', () => {
  it('parses a full snapshot', () => {
    const snap = parseMemorySnapshot(makeSnapshot())
    expect(snap.workdir).toBe('E:/proj/demo')
    expect(snap.entries).toHaveLength(2)
    expect(memoryEntryOf(snap, 'user')?.chars).toBe(38)
    expect(memoryEntryOf(snap, 'project')?.exists).toBe(false)
  })

  it('falls back on dirty payloads instead of throwing', () => {
    const snap = parseMemorySnapshot({
      workdir: 123,
      entries: [{ scope: 'global', content: 'x' }, 'nope', null]
    })
    expect(snap.workdir).toBe('')
    expect(snap.entries).toEqual([])
    expect(parseMemorySnapshot(null).entries).toEqual([])
  })

  it('parses a save reply only when it carries a valid entry', () => {
    const ok = parseMemorySaveResult({
      scope: 'user',
      entry: (makeSnapshot().entries as Record<string, unknown>[])[0]
    })
    expect(ok?.entry.scope).toBe('user')
    expect(parseMemorySaveResult({ scope: 'user', entry: { scope: 'bad' } })).toBeNull()
    expect(parseMemorySaveResult(null)).toBeNull()
  })

  it('declares both memory commands in the shared contract', () => {
    expect(Cmd.MemoryGet).toBe('memory.get')
    expect(Cmd.MemorySave).toBe('memory.save')
  })
})

describe('buildMemoryActions', () => {
  const fakeClient = (result: unknown, ok = true) =>
    ({
      sendCommand: vi.fn().mockResolvedValue({ ok, result, error: '' })
    }) as unknown as JarvisWsClient

  it('reports offline instead of throwing when no client is connected', async () => {
    const actions = buildMemoryActions(() => null)
    expect(await actions.fetchMemory()).toBeNull()
    expect(useMemoryStore.getState().error).toContain('未连接')
    expect(await actions.saveMemory('user', 'x')).toBeNull()
  })

  it('fills the store from a get reply', async () => {
    const client = fakeClient(makeSnapshot())
    const actions = buildMemoryActions(() => client)
    await actions.refreshMemory()
    const snap = useMemoryStore.getState().snapshot
    expect(snap?.workdir).toBe('E:/proj/demo')
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.MemoryGet)
  })

  it('replaces only the saved scope after a save reply', async () => {
    const saveResult = {
      scope: 'user',
      entry: { ...(makeSnapshot().entries as Record<string, unknown>[])[0], content: '- 新记忆', chars: 7 }
    }
    const client = {
      sendCommand: vi.fn(async (type: string) =>
        type === Cmd.MemorySave
          ? { ok: true, result: saveResult, error: '' }
          : { ok: true, result: makeSnapshot(), error: '' }
      )
    } as unknown as JarvisWsClient
    const actions = buildMemoryActions(() => client)
    await actions.fetchMemory()
    const saved = await actions.saveMemory('user', '- 新记忆')
    expect(saved?.entry.content).toBe('- 新记忆')
    expect(client.sendCommand).toHaveBeenCalledWith(
      Cmd.MemorySave,
      { scope: 'user', content: '- 新记忆' },
      20000
    )
    // project 条目保持原样（保存不该顺手改动另一个范围）
    expect(memoryEntryOf(useMemoryStore.getState().snapshot, 'project')?.exists).toBe(false)
    expect(memoryEntryOf(useMemoryStore.getState().snapshot, 'user')?.chars).toBe(7)
  })

  it('keeps the old snapshot when the reply fails', async () => {
    const actions = buildMemoryActions(() => fakeClient(null, false))
    expect(await actions.fetchMemory()).toBeNull()
    expect(useMemoryStore.getState().snapshot).toBeNull()
  })
})

describe('MemoryPanel', () => {
  /** 面板测试用的 client：get 回快照、save 回保存结果（按指令区分）。 */
  const panelClient = (snapshot: Record<string, unknown>) =>
    ({
      sendCommand: vi.fn(async (type: string) =>
        type === Cmd.MemorySave
          ? {
              ok: true,
              result: {
                scope: 'user',
                entry: { ...(snapshot.entries as Record<string, unknown>[])[0], content: '- 只回答中文', chars: 7 }
              },
              error: ''
            }
          : { ok: true, result: snapshot, error: '' }
      )
    }) as unknown as JarvisWsClient

  it('renders user/project rows and disables project without a workdir', async () => {
    useBackendStore.setState({ client: panelClient(makeSnapshot({ workdir: '' })) })
    render(<MemoryPanel />)

    await waitFor(() => expect(screen.getByTestId('memory-row-user')).toBeTruthy())
    expect((screen.getByTestId('memory-row-project') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('用户级记忆（跨项目）')).toBeTruthy()
    expect(screen.getByText(/用户喜欢简洁回答/)).toBeTruthy()
  })

  it('opens the bubble and saves the edited content', async () => {
    useBackendStore.setState({ client: panelClient(makeSnapshot()) })
    const { container } = render(<MemoryPanel />)

    await waitFor(() => expect(screen.getByTestId('memory-row-user')).toBeTruthy())
    fireEvent.click(screen.getByTestId('memory-row-user'))
    expect(screen.getByTestId('memory-bubble-user')).toBeTruthy()

    const editor = screen.getByTestId('memory-bubble-editor') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '- 只回答中文' } })
    expect((screen.getByTestId('memory-bubble-save') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('memory-bubble-save'))

    await waitFor(() => expect(screen.getByTestId('memory-bubble-saved')).toBeTruthy())
    const calls = (useBackendStore.getState().client?.sendCommand as ReturnType<typeof vi.fn>).mock.calls
    const saveCall = calls.find((c: unknown[]) => c[0] === Cmd.MemorySave)
    expect(saveCall?.[1]).toMatchObject({ scope: 'user', content: '- 只回答中文' })
    // 容器里只保留一个气泡，未因重渲染重复挂载
    expect(container.querySelectorAll('.memory-bubble')).toHaveLength(1)
  })
})
