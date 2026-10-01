// @vitest-environment jsdom
/**
 * backendStore 半双工语音指令单测 —— toggleVoice / interruptVoice 的指令路由。
 *
 * 注入假 WS 客户端（sendCommand 为 spy），断言：
 * - toggleVoice 未激活 → 置 voice 模式 + 发 voice.start；
 * - toggleVoice 已激活 → 发 voice.stop；
 * - interruptVoice → 发 voice.interrupt（不动模式/激活态）。
 *
 * 另附模型/音色切换去重、会话改名删除，以及模型配置修改（models.edit）/删除
 * （models.remove）的指令路由用例。
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
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
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
  // 左栏状态跨用例共享：复位交互态，避免「上例已点选模型」影响下例。@author aceFelix
  useLeftStore.setState({
    mode: 'text',
    talkActive: false,
    voiceActive: false,
    voiceState: '',
    // 待生效选择（模型/音色）为瞬态：复位避免串场到下一个用例。@author aceFelix
    pendingModel: '',
    pendingVoice: '',
    // 项目区（2026-08）瞬态字段一并复位：上一用例已写入的项目信息与 pending 射干下一个。
    // @author aceFelix
    currentProject: null,
    recentProjects: [],
    pendingProjectPath: ''
  })
  useRightStore.setState({
    reminders: [],
    deadlines: [],
    latestBriefing: '',
    cost: null,
    mcp: null,
    logs: []
  })
  useSettingsStore.setState({ backendSettings: { ...EMPTY_BACKEND_SETTINGS } })
  useRuntimeStore.setState({ permissionMode: 'default', thinkingEffort: 'off', thinkingSupported: [] })
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

describe('backendStore · 模型 / 音色切换去重与热切换', () => {
  /** 造一个按指令类型回执的假客户端：select 回传入结果，list 回空列表。 */
  function selectClient(selectResult: unknown): { sendCommand: ReturnType<typeof vi.fn> } {
    return {
      sendCommand: vi.fn().mockImplementation((type: string) => {
        if (type === Cmd.ModelsList || type === Cmd.VoicesList) {
          return Promise.resolve({ ok: true, result: [] })
        }
        return Promise.resolve({ ok: true, result: selectResult })
      })
    }
  }

  const callsOf = (client: { sendCommand: ReturnType<typeof vi.fn> }, type: string): number =>
    client.sendCommand.mock.calls.filter(([t]) => t === type).length
  const tipsOf = (kw: string): number =>
    useChatStore
      .getState()
      .messages.filter((m) => m.kind === 'system' && m.text.includes(kw)).length

  it('重复点选同一模型：第二次不发指令、不本地弹气泡（气泡由引擎 info 上屏）', async () => {
    // 切换已改为引擎热切换：成功提示由引擎的 info 事件上屏，本地再弹一次就是
    // 双气泡；pendingModel 标记「已请求、未落地」，既防重复写盘，也喂列表
    // 「待生效」标记。@author aceFelix
    const client = selectClient(true)
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().selectModel('qwen-flash')
    await useBackendStore.getState().selectModel('qwen-flash')

    expect(callsOf(client, Cmd.ModelsSelect)).toBe(1)
    expect(tipsOf('模型已切换为')).toBe(0)
    expect(useLeftStore.getState().pendingModel).toBe('qwen-flash')

    // 换一个模型：照常发指令、待生效标记随之移动，仍不本地弹气泡
    await useBackendStore.getState().selectModel('deepseek-v4-pro')
    expect(callsOf(client, Cmd.ModelsSelect)).toBe(2)
    expect(tipsOf('模型已切换为')).toBe(0)
    expect(useLeftStore.getState().pendingModel).toBe('deepseek-v4-pro')
    // 写盘成功后刷一次列表；此刻 current 仍是旧模型，等 model_switched 再刷
    expect(callsOf(client, Cmd.ModelsList)).toBe(2)
  })

  it('已是当前模型（列表标 current）：不发指令、不记待生效', async () => {
    const client = selectClient(true)
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useLeftStore.setState({ models: [{ name: 'qwen-flash', current: true }] })

    await useBackendStore.getState().selectModel('qwen-flash')

    expect(callsOf(client, Cmd.ModelsSelect)).toBe(0)
    expect(useLeftStore.getState().pendingModel).toBe('')
  })

  it('音色重复点选同样去重（dict 回执，2026-09-28 音色-模型适配）', async () => {
    // voices.select 回执从 bool 升级为 {ok, name, voice_id, linked_model, old_model}：
    // 成功判定改看 result.ok，待生效标记取回执里的音色名。
    const client = selectClient({ ok: true, name: '晓晓', voice_id: 'x', linked_model: null, old_model: '' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().selectVoice('晓晓')
    await useBackendStore.getState().selectVoice('晓晓')

    expect(callsOf(client, Cmd.VoicesSelect)).toBe(1)
    expect(tipsOf('音色已切换为')).toBe(1)
    expect(useLeftStore.getState().pendingVoice).toBe('晓晓')
  })

  it('音色联动切换（linked_model 非空）：提示里明示联动模型', async () => {
    const client = selectClient({ ok: true, name: 'v3', voice_id: 'v3', linked_model: 'cosyvoice-v3-flash', old_model: 'cosyvoice-v2' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().selectVoice('v3')

    expect(tipsOf('联动 TTS 模型 cosyvoice-v3-flash')).toBe(1)
    expect(useLeftStore.getState().pendingVoice).toBe('v3')
  })

  it('音色切换业务失败（result.ok=false）：报后端错误、不记待生效', async () => {
    // 传输层 ok=true 但目录未命中：音色未写入配置，不能报假成功、不能记
    // 待生效（否则重复点选被去重静默吞掉，用户以为已选上）。
    const client = selectClient({ ok: false, error: '音色未找到：ghost' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().selectVoice('ghost')

    expect(tipsOf('音色已切换为')).toBe(0)
    expect(tipsOf('✗ 音色切换失败：音色未找到：ghost')).toBe(1)
    expect(useLeftStore.getState().pendingVoice).toBe('')
    // 未记待生效：再点仍会重试
    await useBackendStore.getState().selectVoice('ghost')
    expect(callsOf(client, Cmd.VoicesSelect)).toBe(2)
  })

  it('后端写盘失败（result=false）：报错、不记待生效、不报假成功', async () => {
    const client = selectClient(false)
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().selectModel('bad-model')

    expect(tipsOf('模型已切换为')).toBe(0)
    expect(tipsOf('✗ 模型切换失败')).toBe(1)
    expect(useLeftStore.getState().pendingModel).toBe('')
    // 未记待生效：再点仍会重试（否则用户以为已选上，实际没写盘）
    await useBackendStore.getState().selectModel('bad-model')
    expect(callsOf(client, Cmd.ModelsSelect)).toBe(2)
  })
})

describe('backendStore · 模型配置修改与删除指令', () => {
  // 桌面壳左栏模型面板：双击模型项进编辑表单（models.edit）、右键项内删除按钮
  // （models.remove）。后端同步写盘 + 同步内存，前端发指令后刷一次 models.list
  // 收敛列表；改的是当前运行模型回执 hot_switched，删的是当前模型回执
  // was_current（不动运行中的 provider，提示用户另选）。@author aceFelix

  /** 编辑载荷（api_key 留空 = 保持原 Key：桌面壳不回显密钥，未填不能当清空）。 */
  const payload = {
    name: 'my-model',
    new_name: 'my-model-v2',
    vendor: 'deepseek',
    api_format: 'openai',
    base_url: 'https://api.deepseek.com',
    api_key: '',
    model_type: 'text'
  }

  const tipsOf = (kw: string): number =>
    useChatStore
      .getState()
      .messages.filter((m) => m.kind === 'system' && m.text.includes(kw)).length

  /** 造一个按指令回执的假客户端：models.list 回空列表，其余回传入 result（ok=true）。 */
  function modelClient(result: unknown): { sendCommand: ReturnType<typeof vi.fn> } {
    return {
      sendCommand: vi.fn().mockImplementation((type: string) => {
        if (type === Cmd.ModelsList) return Promise.resolve({ ok: true, result: [] })
        return Promise.resolve({ ok: true, result })
      })
    }
  }

  /** 造一个后端拒绝的假客户端（ok=false，error 为拒绝原因）。 */
  function rejectClient(error: string): { sendCommand: ReturnType<typeof vi.fn> } {
    return { sendCommand: vi.fn().mockResolvedValue({ ok: false, error }) }
  }

  it('editModel 发 models.edit 并刷列表；未热切换时提示不带重连文案', async () => {
    const client = modelClient({ name: 'my-model-v2', hot_switched: false })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    const ok = await useBackendStore.getState().editModel(payload)

    expect(ok).toBe(true)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ModelsEdit, payload)
    // 提示用回执里的新名（改名后用户好对号入座）
    expect(tipsOf('模型「my-model-v2」配置已更新')).toBe(1)
    expect(tipsOf('已按新配置重连')).toBe(0)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ModelsList, {})
  })

  it('改的是当前运行模型（hot_switched）：提示说明已按新配置重连', async () => {
    const client = modelClient({ name: 'my-model', hot_switched: true })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().editModel({ ...payload, new_name: '' })

    expect(tipsOf('模型「my-model」配置已更新，当前会话已按新配置重连')).toBe(1)
  })

  it('removeModel 发 models.remove；删的是当前模型时提示建议另选', async () => {
    const client = modelClient({ name: 'my-model', was_current: true })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    const ok = await useBackendStore.getState().removeModel('my-model')

    expect(ok).toBe(true)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ModelsRemove, { name: 'my-model' })
    expect(tipsOf('已删除，当前会话仍在用它，建议另选一个模型')).toBe(1)
  })

  it('删除非当前模型：提示不带「建议另选」', async () => {
    const client = modelClient({ name: 'my-model', was_current: false })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().removeModel('my-model')

    expect(tipsOf('模型「my-model」已删除')).toBe(1)
    expect(tipsOf('建议另选')).toBe(0)
  })

  it('后端拒绝（ok=false）：返回 false、不刷列表，错误走聊天流出口', async () => {
    const client = rejectClient('内置模型不可删除：qwen-flash')
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    expect(await useBackendStore.getState().editModel(payload)).toBe(false)
    expect(await useBackendStore.getState().removeModel('qwen-flash')).toBe(false)
    expect(client.sendCommand).not.toHaveBeenCalledWith(Cmd.ModelsList, {})
    expect(tipsOf('内置模型不可删除')).toBeGreaterThan(0)
  })

  it('未连接（client 为 null）：返回 false 且不抛异常', async () => {
    useBackendStore.setState({ client: null })

    expect(await useBackendStore.getState().editModel(payload)).toBe(false)
    expect(await useBackendStore.getState().removeModel('my-model')).toBe(false)
    expect(tipsOf('✗ 未连接到后端')).toBeGreaterThan(0)
  })
})

describe('backendStore · 自定义音色添加与删除指令', () => {
  // 2026-09-28 音色-模型适配接入桌面壳：左栏音色表单提交（voices.add 同名
  // upsert=编辑）、右键自定义音色删除（voices.delete）。后端校验+写盘+同步
  // 内存，前端发指令后刷一次 voices.list 收敛列表；失败由 runCommand 统一
  // 弹错并回 null，表单保持打开可修正。@author aceFelix

  const voicePayload = {
    name: '我的声音',
    voice_id: 'my-clone',
    model: 'cosyvoice-v3-plus',
    description: '复刻'
  }

  const tipsOf = (kw: string): number =>
    useChatStore
      .getState()
      .messages.filter((m) => m.kind === 'system' && m.text.includes(kw)).length

  /** 造一个按指令回执的假客户端：voices.list 回空列表，其余回传入 result（ok=true）。 */
  function voiceClient(result: unknown): { sendCommand: ReturnType<typeof vi.fn> } {
    return {
      sendCommand: vi.fn().mockImplementation((type: string) => {
        if (type === Cmd.VoicesList) return Promise.resolve({ ok: true, result: [] })
        return Promise.resolve({ ok: true, result })
      })
    }
  }

  it('addVoice 发 voices.add 并刷列表；成功提示用回执里的音色名', async () => {
    const client = voiceClient({ ok: true, name: '我的声音' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    const ok = await useBackendStore.getState().addVoice(voicePayload)

    expect(ok).toBe(true)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.VoicesAdd, voicePayload)
    expect(tipsOf('音色「我的声音」已保存')).toBe(1)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.VoicesList, {})
  })

  it('deleteVoice 发 voices.delete 并刷列表；成功提示已删除', async () => {
    const client = voiceClient({ ok: true, name: '我的声音' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    const ok = await useBackendStore.getState().deleteVoice('我的声音')

    expect(ok).toBe(true)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.VoicesDelete, { name: '我的声音' })
    expect(tipsOf('音色「我的声音」已删除')).toBe(1)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.VoicesList, {})
  })

  it('后端拒绝（ok=false，如内置音色名/不可删）：返回 false、不刷列表，错误走聊天流', async () => {
    const client = {
      sendCommand: vi.fn().mockResolvedValue({ ok: false, error: '「longcheng_v3」是内置音色名，换一个名字' })
    }
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    expect(await useBackendStore.getState().addVoice({ ...voicePayload, name: 'longcheng_v3' })).toBe(false)
    expect(await useBackendStore.getState().deleteVoice('longcheng_v3')).toBe(false)
    expect(client.sendCommand).not.toHaveBeenCalledWith(Cmd.VoicesList, {})
    expect(tipsOf('内置音色名')).toBeGreaterThan(0)
  })

  it('未连接（client 为 null）：返回 false 且不抛异常', async () => {
    useBackendStore.setState({ client: null })

    expect(await useBackendStore.getState().addVoice(voicePayload)).toBe(false)
    expect(await useBackendStore.getState().deleteVoice('我的声音')).toBe(false)
    expect(tipsOf('✗ 未连接到后端')).toBeGreaterThan(0)
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

/**
 * 项目工作区（2026-08）：setProject / refreshProjects / forgetProject 指令路由。
 * 口径与模型面板一致：project.set 入队即返回（引擎后续推 project_switched），
 * refreshProjects 一次发 project.get + projects.list 两条指令。
 * @author aceFelix
 */
describe('backendStore · 项目工作区', () => {
  it('setProject 上送 project.set 并乐观标记 pendingProjectPath', async () => {
    const client = fakeClient()
    client.sendCommand.mockImplementation((type: string) => {
      if (type === Cmd.ProjectSet) {
        return Promise.resolve({ ok: true, result: { ok: true, workdir: 'D:/proj/x', name: 'x' } })
      }
      return Promise.resolve({ ok: true, result: null })
    })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useLeftStore.setState({
      currentProject: { workdir: 'D:/proj/old', name: 'old', persisted: true },
      pendingProjectPath: ''
    })

    await useBackendStore.getState().setProject('D:/proj/x')

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ProjectSet, { path: 'D:/proj/x' })
    expect(useLeftStore.getState().pendingProjectPath).toBe('D:/proj/x')
  })

  it('setProject 目标已为当前项目 → 不发指令、不标记 pending', async () => {
    const client = fakeClient()
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useLeftStore.setState({
      currentProject: { workdir: 'D:/proj/a', name: 'a', persisted: true },
      pendingProjectPath: ''
    })

    await useBackendStore.getState().setProject('D:/proj/a')

    expect(client.sendCommand).not.toHaveBeenCalled()
    expect(useLeftStore.getState().pendingProjectPath).toBe('')
  })

  it('setProject 回执失败（ok=false）→ 撤销 pendingProjectPath 并弹错', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({ ok: false, error: '项目路径非法' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useLeftStore.setState({ currentProject: null, pendingProjectPath: '' })

    await useBackendStore.getState().setProject('relative/path')

    expect(useLeftStore.getState().pendingProjectPath).toBe('')
    const msgs = useChatStore.getState().messages
    const last = msgs[msgs.length - 1]
    expect((last as { text?: string }).text).toContain('项目路径非法')
  })

  it('refreshProjects 拉 project.get + projects.list 并回填 leftStore', async () => {
    const client = fakeClient()
    client.sendCommand.mockImplementation((type: string) => {
      if (type === Cmd.ProjectGet) {
        return Promise.resolve({
          ok: true,
          result: { workdir: 'D:/proj/cur', name: 'cur', persisted: true }
        })
      }
      if (type === Cmd.ProjectsList) {
        return Promise.resolve({
          ok: true,
          result: [
            { path: 'D:/proj/cur', name: 'cur', last_opened: '2026-08-30T10:00:00', exists: true },
            { path: 'D:/proj/old', name: 'old', last_opened: '2026-08-29T09:00:00', exists: false }
          ]
        })
      }
      return Promise.resolve({ ok: true, result: null })
    })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().refreshProjects()

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ProjectGet, {})
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ProjectsList, {})
    expect(useLeftStore.getState().currentProject).toEqual({
      workdir: 'D:/proj/cur',
      name: 'cur',
      persisted: true
    })
    expect(useLeftStore.getState().recentProjects).toHaveLength(2)
    expect(useLeftStore.getState().recentProjects[1].exists).toBe(false)
  })

  it('forgetProject 上送 projects.forget 后重拉项目列表', async () => {
    const client = fakeClient()
    client.sendCommand.mockImplementation((type: string) => {
      if (type === Cmd.ProjectsForget) return Promise.resolve({ ok: true, result: true })
      if (type === Cmd.ProjectGet) return Promise.resolve({ ok: true, result: null })
      if (type === Cmd.ProjectsList) return Promise.resolve({ ok: true, result: [] })
      return Promise.resolve({ ok: true, result: null })
    })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    const ok = await useBackendStore.getState().forgetProject('D:/proj/gone')

    expect(ok).toBe(true)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ProjectsForget, { path: 'D:/proj/gone' })
    // forgetProject 内部会顺带 refreshProjects，验证 ProjectGet 也被拉过
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ProjectGet, {})
  })

  it('forgetProject 回执失败 → 回 false、不刷列表', async () => {
    const client = fakeClient()
    client.sendCommand.mockResolvedValue({ ok: false, error: 'bad path' })
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    const ok = await useBackendStore.getState().forgetProject('')

    expect(ok).toBe(false)
    expect(client.sendCommand).not.toHaveBeenCalled()
  })
})

// 工作模式 / 思考强度指令路由 + state.get 初始化 runtimeStore（2026-09 桌面输入区）。
// @author aceFelix
describe('backendStore · 工作模式 / 思考强度', () => {
  /** 按指令类型回执的假客户端（mode.set/think.set 回业务 dict，state.get 回快照）。 */
  function routedClient(resultFor: (type: string) => unknown): { sendCommand: ReturnType<typeof vi.fn> } {
    return { sendCommand: vi.fn().mockImplementation((type: string) => Promise.resolve({ ok: true, result: resultFor(type) })) }
  }

  it('setMode 成功（result.ok=true）→ 发 mode.set + 写 runtimeStore', async () => {
    const client = routedClient(() => ({ ok: true, mode: 'plan' }))
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().setMode('plan')

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ModeSet, { mode: 'plan' })
    expect(useRuntimeStore.getState().permissionMode).toBe('plan')
  })

  it('setMode 与当前相同 → 不发指令（去重）', async () => {
    useRuntimeStore.setState({ permissionMode: 'plan' })
    const client = routedClient(() => ({ ok: true, mode: 'plan' }))
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().setMode('plan')

    expect(client.sendCommand).not.toHaveBeenCalled()
  })

  it('setMode 业务失败（result.ok=false）→ 弹错、不写 store', async () => {
    const client = routedClient(() => ({ ok: false, error: '未知模式: nope' }))
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().setMode('plan')

    expect(useRuntimeStore.getState().permissionMode).toBe('default')
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.some((m) => m.kind === 'system' && m.text.includes('模式切换失败'))).toBe(true)
  })

  it('setThinking 成功 → 发 think.set + 写 runtimeStore', async () => {
    const client = routedClient(() => ({ ok: true, effort: 'high' }))
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().setThinking('high')

    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.ThinkSet, { effort: 'high' })
    expect(useRuntimeStore.getState().thinkingEffort).toBe('high')
  })

  it('refreshState 初始化 runtimeStore（state.get 回填）', async () => {
    const client = routedClient((type) =>
      type === Cmd.StateGet
        ? {
            mcp: null,
            permission_mode: 'accept_edits',
            thinking_effort: 'medium',
            thinking_supported: ['off', 'low', 'medium', 'high']
          }
        : null
    )
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().refreshState()

    const s = useRuntimeStore.getState()
    expect(s.permissionMode).toBe('accept_edits')
    expect(s.thinkingEffort).toBe('medium')
    expect(s.thinkingSupported).toEqual(['off', 'low', 'medium', 'high'])
  })

  it('refreshState 脏值宽容：非法模式/档位回退默认，supported 剔脏', async () => {
    const client = routedClient((type) =>
      type === Cmd.StateGet
        ? { permission_mode: 'ghost', thinking_effort: 'extreme', thinking_supported: ['off', 'bogus', 'high'] }
        : null
    )
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })

    await useBackendStore.getState().refreshState()

    const s = useRuntimeStore.getState()
    expect(s.permissionMode).toBe('default')
    expect(s.thinkingEffort).toBe('off')
    expect(s.thinkingSupported).toEqual(['off', 'high'])
  })
})
