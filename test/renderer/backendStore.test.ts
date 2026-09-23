/**
 * backendStore 半双工语音指令单测 —— toggleVoice / interruptVoice 的指令路由。
 *
 * 注入假 WS 客户端（sendCommand 为 spy），断言：
 * - toggleVoice 未激活 → 置 voice 模式 + 发 voice.start；
 * - toggleVoice 已激活 → 发 voice.stop；
 * - interruptVoice → 发 voice.interrupt（不动模式/激活态）。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Cmd } from '../../src/shared/contracts'
import type { JarvisWsClient } from '@renderer/api/ws'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useLeftStore } from '@renderer/stores/leftStore'
import { useChatStore } from '@renderer/stores/chatStore'
import { useRightStore } from '@renderer/stores/rightStore'

/** 造一个只关心 sendCommand 的假客户端（回执恒 ok）。 */
function fakeClient(): { sendCommand: ReturnType<typeof vi.fn> } {
  return { sendCommand: vi.fn().mockResolvedValue({ ok: true, result: null }) }
}

beforeEach(() => {
  useChatStore.getState().clear()
  useLeftStore.setState({ mode: 'text', talkActive: false, voiceActive: false, voiceState: '' })
  useRightStore.setState({ reminders: [], deadlines: [], latestBriefing: '', cost: null, mcp: null, logs: [] })
})

afterEach(() => {
  useBackendStore.setState({ client: null })
})

describe('backendStore · 半双工语音指令', () => {
  it('toggleVoice 未激活时置 voice 模式并发 voice.start', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useLeftStore.setState({ voiceActive: false, mode: 'text' })

    await useBackendStore.getState().toggleVoice()

    expect(useLeftStore.getState().mode).toBe('voice')
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.VoiceStart, {})
  })

  it('toggleVoice 已激活时发 voice.stop（不改模式）', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useLeftStore.setState({ voiceActive: true, mode: 'voice' })

    await useBackendStore.getState().toggleVoice()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.VoiceStop, {})
    expect(useLeftStore.getState().mode).toBe('voice')
  })

  it('interruptVoice 发 voice.interrupt', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useLeftStore.setState({ voiceActive: true, mode: 'voice' })

    await useBackendStore.getState().interruptVoice()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.VoiceInterrupt, {})
  })

  it('未连接（client 为 null）时 toggleVoice 不抛异常，落系统错误提示', async () => {
    useBackendStore.setState({ client: null })
    await expect(useBackendStore.getState().toggleVoice()).resolves.not.toThrow()
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.length).toBeGreaterThan(0)
  })
})

describe('backendStore · sendMessage 附件', () => {
  it('带附件：payload 含 images/files，气泡带缩略图 data URL', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().sendMessage('看图', {
      images: [{ data: 'QUJD', media_type: 'image/png' }],
      files: [{ name: 'a.md', content: '# x' }]
    })

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.Message, {
      text: '看图',
      images: [{ data: 'QUJD', media_type: 'image/png' }],
      files: [{ name: 'a.md', content: '# x' }]
    })
    const user = useChatStore.getState().messages[0]
    expect(user.kind === 'user' ? user.images?.[0] : null).toBe('data:image/png;base64,QUJD')
  })

  it('纯图片（空文本）也发送', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().sendMessage('', {
      images: [{ data: 'QUJD', media_type: 'image/png' }]
    })

    expect(client.sendCommand).toHaveBeenCalledTimes(1)
    const [, payload] = client.sendCommand.mock.calls[0]
    expect(payload.text).toBe('')
    expect(payload.images).toHaveLength(1)
  })

  it('空文本且无有效附件：不发指令', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().sendMessage('  ', { images: [{ data: '', media_type: 'image/png' }] })

    expect(client.sendCommand).not.toHaveBeenCalled()
  })
})

describe('backendStore · 右栏刷新动作', () => {
  it('refreshSchedule 发 schedule.list 并映射 reminders/deadlines 进 rightStore', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({
      ok: true,
      result: {
        reminders: [{ id: 't1', content: '开会', trigger_at: '2026-09-23T09:00:00', repeat: 'daily' }],
        deadlines: [{ id: 'd1', title: 'Q3 交付', due_date: '2099-01-01', days_left: 100, status: 'active' }]
      }
    })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().refreshSchedule()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ScheduleList, {})
    const right = useRightStore.getState()
    expect(right.reminders).toHaveLength(1)
    expect(right.reminders[0].content).toBe('开会')
    expect(right.deadlines[0].title).toBe('Q3 交付')
  })

  it('refreshCost 发 cost.get 并写入用量统计', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({
      ok: true,
      result: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_tokens: 50,
        cache_creation_tokens: 10,
        dialogs: 2,
        messages: 5
      }
    })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().refreshCost()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.CostGet, {})
    expect(useRightStore.getState().cost).toMatchObject({ model: 'deepseek-chat', input_tokens: 1200, dialogs: 2 })
  })

  it('refreshState 发 state.get 并提取 mcp 快照（缺键时落 null）', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({
      ok: true,
      result: { provider: 'p', model: 'm', mcp: { connected: ['amap'], failed: [], tools: 3 } }
    })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().refreshState()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.StateGet, {})
    expect(useRightStore.getState().mcp).toEqual({ connected: ['amap'], failed: [], tools: 3 })
  })
})

describe('backendStore · 停止回复 reply.abort', () => {
  it('abortReply 发 reply.abort，状态栏置“正在停止...”，不改 busy', async () => {
    // busy 由服务端 assistant_done 统一收尾，abortReply 只发指令。
    // @author aceFelix
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useChatStore.getState().setBusy(true)

    await useBackendStore.getState().abortReply()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ReplyAbort, {})
    expect(useBackendStore.getState().statusLabel).toMatchObject({ text: '正在停止...', tone: 'busy' })
    expect(useChatStore.getState().busy).toBe(true)
  })

  it('未连接时 abortReply 不抛异常，落系统错误提示', async () => {
    useBackendStore.setState({ client: null })
    await expect(useBackendStore.getState().abortReply()).resolves.not.toThrow()
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.length).toBeGreaterThan(0)
  })
})
