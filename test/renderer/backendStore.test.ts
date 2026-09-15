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

/** 造一个只关心 sendCommand 的假客户端（回执恒 ok）。 */
function fakeClient(): { sendCommand: ReturnType<typeof vi.fn> } {
  return { sendCommand: vi.fn().mockResolvedValue({ ok: true, result: null }) }
}

beforeEach(() => {
  useChatStore.getState().clear()
  useLeftStore.setState({ mode: 'text', talkActive: false, voiceActive: false, voiceState: '' })
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
