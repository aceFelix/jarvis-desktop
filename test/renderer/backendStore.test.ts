// @vitest-environment jsdom
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
import { EMPTY_BACKEND_SETTINGS, useSettingsStore } from '@renderer/stores/settingsStore'

// applyBackendStatus 的 ready 路径会经 connect() 构造 JarvisWsClient，
// jsdom 下真发 WebSocket 连接：替换为无操作实现（仅影响构造点；
// 其余用例直接 setState 注入假客户端，不经构造）。@author aceFelix
vi.mock('@renderer/api/ws', () => {
  class FakeJarvisWsClient {
    connect = vi.fn()
    close = vi.fn()
    send = vi.fn()
    sendCommand = vi.fn().mockResolvedValue({ ok: true, result: null })
  }
  return { JarvisWsClient: FakeJarvisWsClient }
})

/** 造一个只关心 sendCommand 的假客户端（回执恒 ok）。 */
function fakeClient(): { sendCommand: ReturnType<typeof vi.fn> } {
  return { sendCommand: vi.fn().mockResolvedValue({ ok: true, result: null }) }
}

beforeEach(() => {
  useChatStore.getState().clear()
  useLeftStore.setState({ mode: 'text', talkActive: false, voiceActive: false, voiceState: '' })
  useRightStore.setState({ reminders: [], deadlines: [], latestBriefing: '', cost: null, mcp: null, logs: [] })
  useSettingsStore.setState({ backendSettings: { ...EMPTY_BACKEND_SETTINGS } })
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

describe('backendStore · 会话改名/删除指令', () => {
  // 改名/删除只发指令，列表刷新由 session_renamed/session_deleted 事件驱动。
  // @author aceFelix
  it('renameSession 发 sessions.rename，payload 携 name/new_name', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().renameSession('旧名', '新名')

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SessionsRename, {
      name: '旧名',
      new_name: '新名'
    })
  })

  it('deleteSession 发 sessions.delete，payload 携 name', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().deleteSession('待删会话')

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SessionsDelete, { name: '待删会话' })
  })

  it('未连接时 renameSession 不抛异常，落系统错误提示', async () => {
    useBackendStore.setState({ client: null })
    await expect(
      useBackendStore.getState().renameSession('a', 'b')
    ).resolves.not.toThrow()
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.length).toBeGreaterThan(0)
  })

  it('服务端回错（ok:false）时 renameSession 落系统错误提示', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({ ok: false, error: '目标会话名已存在' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().renameSession('a', '已占名')

    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.some((m) => (m.kind === 'system' ? m.text.includes('已存在') : false))).toBe(true)
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

describe('backendStore · 设置面板 settings.*', () => {
  it('refreshSettings 发 settings.get 并全量回填 backendSettings（脏数据置 null）', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({
      ok: true,
      result: {
        proactive_tts_enabled: false,
        briefing_enabled: true,
        briefing_time: '07:15',
        deadline_enabled: true,
        deadline_check_time: '21:00',
        tts_volume: 60,
        tts_speech_rate: 'bad-type'
      }
    })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().refreshSettings()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsGet, {})
    const s = useSettingsStore.getState().backendSettings
    expect(s.proactive_tts_enabled).toBe(false)
    expect(s.briefing_time).toBe('07:15')
    expect(s.tts_volume).toBe(60)
    expect(s.tts_speech_rate).toBe(null) // 类型不符 → 离线态
  })

  it('setBackendSetting 乐观更新并发 settings.set（布尔/数值/时间键通用）', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({ ok: true, result: {} })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useSettingsStore.setState({
      backendSettings: { ...EMPTY_BACKEND_SETTINGS, proactive_tts_enabled: false, tts_volume: 50 }
    })

    await useBackendStore.getState().setBackendSetting('proactive_tts_enabled', true)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, { proactive_tts_enabled: true })
    expect(useSettingsStore.getState().backendSettings.proactive_tts_enabled).toBe(true)

    await useBackendStore.getState().setBackendSetting('tts_volume', 80)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, { tts_volume: 80 })
    expect(useSettingsStore.getState().backendSettings.tts_volume).toBe(80)

    await useBackendStore.getState().setBackendSetting('briefing_time', '06:30')
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, { briefing_time: '06:30' })
    expect(useSettingsStore.getState().backendSettings.briefing_time).toBe('06:30')
  })

  it('setBackendSetting 值未变时不发指令（避免重复落盘/重注册）', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({ ok: true, result: {} })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useSettingsStore.setState({
      backendSettings: { ...EMPTY_BACKEND_SETTINGS, tts_volume: 50 }
    })

    await useBackendStore.getState().setBackendSetting('tts_volume', 50)

    expect(client.sendCommand).not.toHaveBeenCalled()
  })

  it('setBackendSetting 回执失败时回滚原值', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({ ok: false, error: 'settings.toml 落盘失败' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useSettingsStore.setState({
      backendSettings: { ...EMPTY_BACKEND_SETTINGS, proactive_tts_enabled: false }
    })

    await useBackendStore.getState().setBackendSetting('proactive_tts_enabled', true)

    // 乐观更新被回滚，且错误写入聊天流（runCommand 统一出口）
    expect(useSettingsStore.getState().backendSettings.proactive_tts_enabled).toBe(false)
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.length).toBeGreaterThan(0)
  })

  it('未连接时 setBackendSetting 不抛异常，镜像回滚到 null（不谎报可改态）', async () => {
    useBackendStore.setState({ client: null })
    await expect(
      useBackendStore.getState().setBackendSetting('proactive_tts_enabled', true)
    ).resolves.not.toThrow()
    expect(useSettingsStore.getState().backendSettings.proactive_tts_enabled).toBe(null)
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

describe('backendStore · 后端进程换代清屏初始化', () => {
  // 原 session_ready 携带的清屏初始化语义迁移至此：ready 且 pid 变化 →
  // 清旧气泡；同 pid（瞬断重连）/ 首次 ready（无历史 info）→ 不清
  // （在 session_ready 里清会吞首发用户气泡）。@author aceFelix
  const infoOf = (pid: number) => ({ port: 8765, httpPort: 8766, token: 't', pid })

  beforeEach(() => {
    useBackendStore.setState({ info: null, client: null })
  })

  it('ready 且 pid 变化：清掉旧气泡并连接新后端', () => {
    useChatStore.getState().addUser('旧后端遗留')
    useBackendStore.setState({ info: infoOf(111) })

    useBackendStore.getState().applyBackendStatus('ready', infoOf(222))

    expect(useChatStore.getState().messages).toHaveLength(0)
    expect(useBackendStore.getState().client).not.toBeNull()
  })

  it('ready 同 pid（瞬断重连）：不清进行中的气泡', () => {
    useChatStore.getState().addUser('进行中对话')
    useBackendStore.setState({ info: infoOf(111) })

    useBackendStore.getState().applyBackendStatus('ready', infoOf(111))

    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('首次 ready（无历史 info）：不清空', () => {
    useChatStore.getState().addUser('启动前残留')

    useBackendStore.getState().applyBackendStatus('ready', infoOf(333))

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useBackendStore.getState().client).not.toBeNull()
  })
})
