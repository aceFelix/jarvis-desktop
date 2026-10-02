/**
 * dispatchServerEvent 单测 —— WS 事件到各 store 的路由（对齐 workbench app.js dispatchEvent）。
 *
 * 用假 JarvisConnection（三个 refresh 为 spy）驱动，断言聊天 / 左栏 / 指标 store 切片
 * 与状态栏回调。reactor 未注册（getReactor()=null），语音类事件走可选链不报错。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  dispatchServerEvent,
  talkStatusLabels,
  voiceStatusLabels,
  asSessionList,
  asModelList,
  asVoiceList,
  type StatusLabel
} from '@renderer/api/dispatcher'
import { useChatStore } from '@renderer/stores/chatStore'
import { useLeftStore } from '@renderer/stores/leftStore'
import { useMetricsStore } from '@renderer/stores/metricsStore'
import { useRightStore } from '@renderer/stores/rightStore'
import { useRemoteStore } from '@renderer/stores/remoteStore'
import type { JarvisConnection } from '@renderer/stores/backendStore'

/** 假连接门面：八个刷新动作 + 提醒已读回执均为 spy。 */
function makeConn(): JarvisConnection {
  return {
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    refreshModels: vi.fn().mockResolvedValue(undefined),
    refreshVoices: vi.fn().mockResolvedValue(undefined),
    refreshSchedule: vi.fn().mockResolvedValue(undefined),
    refreshCost: vi.fn().mockResolvedValue(undefined),
    refreshState: vi.fn().mockResolvedValue(undefined),
    refreshSettings: vi.fn().mockResolvedValue(undefined),
    // 项目区刷新（2026-08）：init / project_switched 都会拉取一次。
    // @author aceFelix
    refreshProjects: vi.fn().mockResolvedValue(undefined),
    // 跨设备协同连接态刷新（2026-10）：init 拉取一次回填 remoteStore。
    // @author aceFelix
    refreshRemote: vi.fn().mockResolvedValue(undefined),
    ackProactive: vi.fn()
  }
}

beforeEach(() => {
  useChatStore.getState().clear()
  useLeftStore.setState({
    sessions: [],
    models: [],
    voices: [],
    activePanel: 'history',
    mode: 'text',
    talkActive: false,
    voiceActive: false,
    voiceState: '',
    // 待生效模型为瞬态：复位避免串场到下一个用例。@author aceFelix
    pendingModel: '',
    // 项目区（2026-08）瞬态字段一并复位：避免上一用例已回填的项目信息射干下个子项目相关断言。
    // @author aceFelix
    currentProject: null,
    recentProjects: [],
    pendingProjectPath: ''
  })
  useMetricsStore.setState({ cpu: 0, memory: null, disk: null })
  useRightStore.setState({ reminders: [], deadlines: [], latestBriefing: '', cost: null, mcp: null, logs: [] })
  // 跨设备协同连接态（2026-10）：复位避免串场。
  // @author aceFelix
  useRemoteStore.setState({ phoneConnected: false, wechatConnected: false })
})

describe('dispatchServerEvent · 文本对话流', () => {
  it('assistant_text 流式累加到聊天 store', () => {
    dispatchServerEvent({ event: 'assistant_text', data: '你好' }, makeConn())
    dispatchServerEvent({ event: 'assistant_text', data: '世界' }, makeConn())
    const ai = useChatStore.getState().messages[0]
    expect(ai).toMatchObject({ kind: 'ai', text: '你好世界', streaming: true })
  })

  // ask_user 应答闭环入口：事件→应答条状态（后端 answer_user 才能解锁），
  // 链路断在任意一环都会让引擎干等 600s 超时表现为整轮卡死。
  // @author aceFelix
  it('ask_user 事件弹出应答条（askPrompt），应答后可收起', () => {
    dispatchServerEvent({ event: 'ask_user', data: '是否重试一次?' }, makeConn())
    expect(useChatStore.getState().askPrompt).toBe('是否重试一次?')
    useChatStore.getState().hideAskUser()
    expect(useChatStore.getState().askPrompt).toBeNull()
  })

  it('assistant_thinking 累加思考文本', () => {
    dispatchServerEvent({ event: 'assistant_thinking', data: '想' }, makeConn())
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: 'ai', thinking: '想' })
  })

  it('assistant_done 收尾并回报就绪', () => {
    const onStatus = vi.fn()
    dispatchServerEvent({ event: 'assistant_text', data: 'x' }, makeConn())
    dispatchServerEvent({ event: 'assistant_done', data: null }, makeConn(), onStatus)
    expect(useChatStore.getState().messages[0]).toMatchObject({ streaming: false })
    expect(onStatus).toHaveBeenCalledWith({ text: '就绪', tone: 'idle' } satisfies StatusLabel)
  })

  it('assistant_done 撤销 busy（发送按钮从停止态恢复）', () => {
    // 回复中：sendMessage 置 busy，服务端 assistant_done（含 reply.abort
    // 取消路径）必须收尾。@author aceFelix
    useChatStore.getState().setBusy(true)
    dispatchServerEvent({ event: 'assistant_done', data: null }, makeConn())
    expect(useChatStore.getState().busy).toBe(false)
  })

  it('远端轮次活动事件自动置 busy（busy 初始 false，模拟手机/微信发起）', () => {
    // 桌面未本地 sendMessage（busy=false），但收到引擎活动事件时应切为“正在工作”，
    // 使发送按钮变“停止”。@author aceFelix
    expect(useChatStore.getState().busy).toBe(false)
    dispatchServerEvent({ event: 'assistant_text', data: '回复中' }, makeConn())
    expect(useChatStore.getState().busy).toBe(true)
  })

  it('tool_use / assistant_thinking 也置 busy（无前置文本直接开跑）', () => {
    // 计划模式直接执行工具、或先思考再回复：都应让按钮进入停止态。
    // @author aceFelix
    expect(useChatStore.getState().busy).toBe(false)
    dispatchServerEvent(
      { event: 'tool_use', data: { name: 'Bash', id: 'c1', input: { command: 'ls' } } },
      makeConn()
    )
    expect(useChatStore.getState().busy).toBe(true)
    useChatStore.getState().setBusy(false)
    dispatchServerEvent({ event: 'assistant_thinking', data: '想' }, makeConn())
    expect(useChatStore.getState().busy).toBe(true)
  })

  it('assistant_done 收尾未回填的工具卡（取消/报错后不留“执行中”）', () => {
    // reply.abort 取消时 Bash 被 kill、不发 tool_result；assistant_done 必须
    // 把这张挂起的卡定稿，否则永远停在“执行中”。@author aceFelix
    dispatchServerEvent(
      { event: 'tool_use', data: { name: 'Bash', id: 'c_run', input: { command: 'rmdir' } } },
      makeConn()
    )
    dispatchServerEvent({ event: 'assistant_done', data: null }, makeConn())
    expect(useChatStore.getState().messages.find((m) => m.kind === 'tool')).toMatchObject({
      done: true,
      isError: true
    })
  })

  it('assistant_done 刷新右栏用量卡（一轮对话消耗了 token）', () => {
    const conn = makeConn()
    dispatchServerEvent({ event: 'assistant_done', data: null }, conn)
    expect(conn.refreshCost).toHaveBeenCalled()
  })

  it('user_message 回显被跳过（防双气泡）', () => {
    dispatchServerEvent({ event: 'user_message', data: 'hi' }, makeConn())
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('tool_use → tool_result 建卡并按 id 回填', () => {
    dispatchServerEvent(
      { event: 'tool_use', data: { name: 'read', id: 'c1', input: { p: 1 } } },
      makeConn()
    )
    const card = useChatStore.getState().messages.find((m) => m.kind === 'tool')
    expect(card).toMatchObject({ name: 'read', done: false })
    dispatchServerEvent(
      { event: 'tool_result', data: { id: 'c1', name: 'read', content: 'ok', is_error: false } },
      makeConn()
    )
    expect(useChatStore.getState().messages.find((m) => m.kind === 'tool')).toMatchObject({
      done: true,
      output: 'ok',
      isError: false
    })
  })

  it('info / warn / error → 系统提示与状态栏', () => {
    const onStatus = vi.fn()
    dispatchServerEvent({ event: 'info', data: '提示' }, makeConn())
    dispatchServerEvent({ event: 'warn', data: '警告' }, makeConn())
    dispatchServerEvent({ event: 'error', data: '崩溃' }, makeConn(), onStatus)
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys).toHaveLength(3)
    expect(sys[0]).toMatchObject({ tone: 'info', text: '提示' })
    expect(sys[1].kind === 'system' && sys[1].text).toContain('⚠')
    expect(sys[2]).toMatchObject({ tone: 'error' })
    expect(onStatus).toHaveBeenCalledWith({ text: '出错', tone: 'err' } satisfies StatusLabel)
  })
})

describe('dispatchServerEvent · 会话与初始化', () => {
  it('init 触发八面刷新（左栏三面板 + 右栏任务/用量/运行健康 + 设置回填 + 项目区）', () => {
    const conn = makeConn()
    const onStatus = vi.fn()
    dispatchServerEvent({ event: 'init', data: null }, conn, onStatus)
    expect(conn.refreshSessions).toHaveBeenCalled()
    expect(conn.refreshModels).toHaveBeenCalled()
    expect(conn.refreshVoices).toHaveBeenCalled()
    expect(conn.refreshSchedule).toHaveBeenCalled()
    expect(conn.refreshCost).toHaveBeenCalled()
    expect(conn.refreshState).toHaveBeenCalled()
    expect(conn.refreshSettings).toHaveBeenCalled()
    // 2026-08 项目工作区：init 一并拉 project.get + projects.list
    expect(conn.refreshProjects).toHaveBeenCalled()
    // 2026-10 跨设备协同：init 拉 phone.status + wechat.status 回填连接态
    expect(conn.refreshRemote).toHaveBeenCalled()
    // 握手完成即把状态栏从「等待后端启动...」切到「就绪」（2026-08 修复）。@author aceFelix
    expect(onStatus).toHaveBeenCalledWith({ text: '就绪', tone: 'idle' } satisfies StatusLabel)
  })

  it('session_new 清空并提示', () => {
    const conn = makeConn()
    useChatStore.getState().addUser('旧消息')
    dispatchServerEvent({ event: 'session_new', data: null }, conn)
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'system', text: '已开启新会话' })
    expect(conn.refreshSessions).toHaveBeenCalled()
  })

  it('session_ready 只刷新会话列表不清空气泡（保护首发用户气泡）', () => {
    // 首条 send 触发引擎 _ensure_session 发本事件；若带清屏语义会吞掉
    // 乐观上屏的首发用户气泡（fixlog: session-ready-first-bubble-swallow）。
    // @author aceFelix
    const conn = makeConn()
    useChatStore.getState().addUser('你好jarvis')
    dispatchServerEvent({ event: 'session_ready', data: { name: 'session-x' } }, conn)
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'user', text: '你好jarvis' })
    expect(conn.refreshSessions).toHaveBeenCalled()
  })

  it('session_deleted 只刷列表不清屏（删当前会话另由 session_new 收尾）', () => {
    // 删除完成通知：仅刷新会话列表，保留当前气泡（删当前会话时
    // 引擎另发 session_new 清聊天区）。@author aceFelix
    const conn = makeConn()
    useChatStore.getState().addUser('还在看的消息')
    dispatchServerEvent({ event: 'session_deleted', data: { name: 's1' } }, conn)
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'user', text: '还在看的消息' })
    expect(conn.refreshSessions).toHaveBeenCalled()
  })

  it('session_renamed 只刷列表不清屏', () => {
    const conn = makeConn()
    useChatStore.getState().addUser('改名中的消息')
    dispatchServerEvent({ event: 'session_renamed', data: { name: '新名' } }, conn)
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'user', text: '改名中的消息' })
    expect(conn.refreshSessions).toHaveBeenCalled()
  })

  it('session_loaded 回放历史并追加恢复提示', () => {
    dispatchServerEvent(
      {
        event: 'session_loaded',
        data: { name: 's1', messages: [{ role: 'user', text: '问' }, { role: 'assistant', text: '答' }] }
      },
      makeConn()
    )
    const kinds = useChatStore.getState().messages.map((m) => m.kind)
    expect(kinds).toEqual(['user', 'ai', 'system'])
    const last = useChatStore.getState().messages[2]
    expect(last.kind === 'system' && last.text).toContain('s1')
  })
})

describe('dispatchServerEvent · 模型热切换回执 model_switched', () => {
  it('清「待生效」标记并刷模型列表/用量/状态（列表「当前」随之移动）', () => {
    const conn = makeConn()
    useLeftStore.setState({ pendingModel: 'qwen3.8-2.4t-a95b' })

    dispatchServerEvent({ event: 'model_switched', data: { model: 'qwen3.8-2.4t-a95b' } }, conn)

    expect(useLeftStore.getState().pendingModel).toBe('')
    expect(conn.refreshModels).toHaveBeenCalledTimes(1)
    expect(conn.refreshCost).toHaveBeenCalledTimes(1)
    expect(conn.refreshState).toHaveBeenCalledTimes(1)
  })

  it('事件模型与刚点选的另一个模型不一致：保留新标记（免误清）', () => {
    const conn = makeConn()
    useLeftStore.setState({ pendingModel: 'deepseek-v4-pro' })

    dispatchServerEvent({ event: 'model_switched', data: { model: 'qwen-flash' } }, conn)

    expect(useLeftStore.getState().pendingModel).toBe('deepseek-v4-pro')
  })

  it('payload 缺 model：仍清标记（事件本身就是「已落地」信号）', () => {
    const conn = makeConn()
    useLeftStore.setState({ pendingModel: 'qwen-flash' })

    dispatchServerEvent({ event: 'model_switched', data: null }, conn)

    expect(useLeftStore.getState().pendingModel).toBe('')
  })
})

/**
 * 项目热切换回执 project_switched（2026-08 桌面项目工作区）。
 * 口径参照 model_switched：引擎已写回 settings.workdir + 重建提示词 + 新会话，
 * payload {workdir, name} 直接射入 leftStore.currentProject；只清匹配项的
 * pendingProjectPath，刷会话列表与项目区。
 * @author aceFelix
 */
describe('dispatchServerEvent · 项目热切换回执 project_switched', () => {
  it('写入 currentProject、清匹配项的 pendingProjectPath、刷会话列表与项目区', () => {
    const conn = makeConn()
    useLeftStore.setState({
      currentProject: { workdir: 'D:/proj/old', name: 'old', persisted: true },
      pendingProjectPath: 'D:/proj/new'
    })

    dispatchServerEvent(
      { event: 'project_switched', data: { workdir: 'D:/proj/new', name: 'new' } },
      conn
    )

    expect(useLeftStore.getState().currentProject).toEqual({
      workdir: 'D:/proj/new',
      name: 'new',
      persisted: true
    })
    expect(useLeftStore.getState().pendingProjectPath).toBe('')
    expect(conn.refreshSessions).toHaveBeenCalledTimes(1)
    expect(conn.refreshProjects).toHaveBeenCalledTimes(1)
  })

  it('事件与刚点选的另一个项目不一致：保留新 pending（免误清）', () => {
    const conn = makeConn()
    useLeftStore.setState({
      currentProject: null,
      pendingProjectPath: 'D:/proj/c'
    })

    dispatchServerEvent(
      { event: 'project_switched', data: { workdir: 'D:/proj/a', name: 'a' } },
      conn
    )

    expect(useLeftStore.getState().pendingProjectPath).toBe('D:/proj/c')
    // currentProject 仍然以事件 payload 写回（事件 = 已落地）
    expect(useLeftStore.getState().currentProject?.workdir).toBe('D:/proj/a')
  })

  it('payload 缺 workdir（理论上不到达的异常事件）：保守清 pending 不写 currentProject', () => {
    const conn = makeConn()
    useLeftStore.setState({
      currentProject: { workdir: 'D:/proj/x', name: 'x', persisted: true },
      pendingProjectPath: 'D:/proj/x'
    })

    dispatchServerEvent({ event: 'project_switched', data: {} }, conn)

    expect(useLeftStore.getState().pendingProjectPath).toBe('')
    expect(useLeftStore.getState().currentProject?.workdir).toBe('D:/proj/x')
    // 仍然会刷会话列表与项目区（事件本身代语句法：引擎已处理一轮）
    expect(conn.refreshSessions).toHaveBeenCalledTimes(1)
    expect(conn.refreshProjects).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchServerEvent · 状态与实时语音', () => {
  it('status（实时标签）驱动状态栏 talk 语气', () => {
    const onStatus = vi.fn()
    dispatchServerEvent({ event: 'status', data: 'listening' }, makeConn(), onStatus)
    expect(onStatus).toHaveBeenCalledWith({
      text: talkStatusLabels.listening,
      tone: 'talk'
    } satisfies StatusLabel)
  })

  it('status（普通文案）走 idle 语气', () => {
    const onStatus = vi.fn()
    dispatchServerEvent({ event: 'status', data: '自定义状态' }, makeConn(), onStatus)
    expect(onStatus).toHaveBeenCalledWith({ text: '自定义状态', tone: 'idle' } satisfies StatusLabel)
  })

  it('talk_started / talk_stopped 切换左栏实时标记与模式', () => {
    const conn = makeConn()
    const onStatus = vi.fn()
    dispatchServerEvent({ event: 'talk_started', data: null }, conn)
    expect(useLeftStore.getState().talkActive).toBe(true)
    dispatchServerEvent({ event: 'talk_stopped', data: null }, conn, onStatus)
    expect(useLeftStore.getState().talkActive).toBe(false)
    expect(useLeftStore.getState().mode).toBe('text')
  })

  it('ai_transcript_delta → ai_transcript 替换为全量文本', () => {
    dispatchServerEvent({ event: 'ai_transcript_delta', data: '部分' }, makeConn())
    dispatchServerEvent({ event: 'ai_transcript', data: '完整回复' }, makeConn())
    const ai = useChatStore.getState().messages.filter((m) => m.kind === 'ai')
    expect(ai).toHaveLength(1)
    expect(ai[0]).toMatchObject({ text: '完整回复', streaming: false })
  })

  it('user_transcript 落用户气泡', () => {
    dispatchServerEvent({ event: 'user_transcript', data: '我说的话' }, makeConn())
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: 'user', text: '我说的话' })
  })
})

describe('dispatchServerEvent · 半双工语音 voice', () => {
  it('voice_started 置 voiceActive 并切 voice 模式', () => {
    dispatchServerEvent({ event: 'voice_started', data: null }, makeConn())
    expect(useLeftStore.getState().voiceActive).toBe(true)
    expect(useLeftStore.getState().mode).toBe('voice')
  })

  it('voice_stopped 清 voiceActive/voiceState 并回 text', () => {
    const onStatus = vi.fn()
    useLeftStore.setState({ voiceActive: true, voiceState: 'speaking', mode: 'voice' })
    dispatchServerEvent({ event: 'voice_stopped', data: null }, makeConn(), onStatus)
    const st = useLeftStore.getState()
    expect(st.voiceActive).toBe(false)
    expect(st.voiceState).toBe('')
    expect(st.mode).toBe('text')
    expect(onStatus).toHaveBeenCalledWith({ text: '就绪', tone: 'idle' } satisfies StatusLabel)
  })

  it('voice_state 写 voiceState 并驱动状态条 talk 语气', () => {
    const onStatus = vi.fn()
    dispatchServerEvent({ event: 'voice_state', data: 'listening' }, makeConn(), onStatus)
    expect(useLeftStore.getState().voiceState).toBe('listening')
    expect(onStatus).toHaveBeenCalledWith({
      text: voiceStatusLabels.listening,
      tone: 'talk'
    } satisfies StatusLabel)
  })

  it('voice_state 一轮迁移 listening→thinking→speaking 取末态', () => {
    const conn = makeConn()
    for (const st of ['listening', 'thinking', 'speaking']) {
      dispatchServerEvent({ event: 'voice_state', data: st }, conn)
    }
    expect(useLeftStore.getState().voiceState).toBe('speaking')
  })

  it('voice_user_transcript 落用户气泡', () => {
    dispatchServerEvent({ event: 'voice_user_transcript', data: '提醒我喝水' }, makeConn())
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: 'user', text: '提醒我喝水' })
  })

  it('voice_ai_text_delta → voice_ai_text 替换为全量文本', () => {
    const conn = makeConn()
    dispatchServerEvent({ event: 'voice_ai_text_delta', data: '好的' }, conn)
    dispatchServerEvent({ event: 'voice_ai_text_delta', data: '，已' }, conn)
    dispatchServerEvent({ event: 'voice_ai_text', data: '好的，已提醒你' }, conn)
    const ai = useChatStore.getState().messages.filter((m) => m.kind === 'ai')
    expect(ai).toHaveLength(1)
    expect(ai[0]).toMatchObject({ text: '好的，已提醒你', streaming: false })
  })

  it('talk_started 权威置 talk 模式（voice→talk 互斥复位）', () => {
    // voice 运行中被 talk 抢占：引擎先发的 voice_stopped 把 mode 重置 text，
    // 随后 talk_started 必须把 mode 复位为 talk（与 voice_started 对称）。
    useLeftStore.setState({ voiceActive: true, mode: 'voice' })
    dispatchServerEvent({ event: 'voice_stopped', data: null }, makeConn())
    expect(useLeftStore.getState().mode).toBe('text')
    dispatchServerEvent({ event: 'talk_started', data: null }, makeConn())
    expect(useLeftStore.getState().mode).toBe('talk')
    expect(useLeftStore.getState().talkActive).toBe(true)
  })
})

describe('dispatchServerEvent · 指标与健壮性', () => {
  it('metrics 更新指标 store', () => {
    dispatchServerEvent(
      { event: 'metrics', data: { cpu: 42, memory: { percent: 50 }, disk: { percent: 10 } } },
      makeConn()
    )
    const st = useMetricsStore.getState()
    expect(st.cpu).toBe(42)
    expect(st.memory?.percent).toBe(50)
    expect(st.disk?.percent).toBe(10)
  })

  it('未知事件静默忽略', () => {
    expect(() => dispatchServerEvent({ event: 'whatever', data: 1 }, makeConn())).not.toThrow()
    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})

describe('dispatchServerEvent · MCP 就绪 mcp_ready', () => {
  it('payload 合法：直接写入右栏运行健康 mcp 快照', () => {
    const conn = makeConn()
    dispatchServerEvent(
      {
        event: 'mcp_ready',
        data: { connected: ['amap-maps'], failed: ['tyc-mcp'], tools: 5 }
      },
      conn
    )
    expect(useRightStore.getState().mcp).toEqual({
      connected: ['amap-maps'],
      failed: ['tyc-mcp'],
      tools: 5
    })
    // 走 payload 直写，无需再发一次 state.get
    expect(conn.refreshState).not.toHaveBeenCalled()
  })

  it('tools 缺省/非法回退为 0', () => {
    dispatchServerEvent(
      { event: 'mcp_ready', data: { connected: [], failed: ['x'] } },
      makeConn()
    )
    expect(useRightStore.getState().mcp).toEqual({ connected: [], failed: ['x'], tools: 0 })
  })

  it('payload 结构非法：退回主动拉一次 state.get', () => {
    const conn = makeConn()
    dispatchServerEvent({ event: 'mcp_ready', data: null }, conn)
    expect(conn.refreshState).toHaveBeenCalledTimes(1)
    expect(useRightStore.getState().mcp).toBeNull()
  })
})

describe('列表类型守卫', () => {
  it('数组透传，非数组回退空数组', () => {
    expect(asSessionList([{ name: 'a' }])).toEqual([{ name: 'a' }])
    expect(asSessionList(null)).toEqual([])
    expect(asModelList('x')).toEqual([])
    expect(asVoiceList([])).toEqual([])
  })
})

describe('dispatchServerEvent · 主动播报 proactive_notify', () => {
  // node 环境无 window：stub 一个带 jarvisDesktop.notify 的假 window，
  // 驱动 dispatcher 的系统通知分支（dispatcher 内 try/catch 容错缺失）
  let notifySpy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    notifySpy = vi.fn()
    ;(globalThis as unknown as { window: unknown }).window = {
      jarvisDesktop: { notify: notifySpy }
    }
  })
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('briefing 全文上屏为系统气泡 + 弹通知，不 ack', () => {
    const conn = makeConn()
    const text = '早上好，先生。以下是今日简报：\n\n📅 今天是工作日'
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'briefing', title: '贾维斯主动提醒', text } },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys).toHaveLength(1)
    expect(sys[0].kind === 'system' && sys[0].text).toBe(text)
    expect(notifySpy).toHaveBeenCalledWith({ title: '贾维斯主动提醒', body: text })
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('briefing 原文进右栏最近简报 + 刷新任务中心', () => {
    // 任务中心联动：简报更新 latestBriefing；提醒触发/截止日期检查后
    // 列表有变化（fired 离列、days_left 更新），统一刷新。@author aceFelix
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'briefing', title: '贾维斯主动提醒', text: '今日简报' } },
      conn
    )
    expect(useRightStore.getState().latestBriefing).toBe('今日简报')
    expect(conn.refreshSchedule).toHaveBeenCalled()
  })

  it('reminder 带 ⏰ 前缀上屏 + 弹通知 + 按 task_id 回执', () => {
    const conn = makeConn()
    dispatchServerEvent(
      {
        event: 'proactive_notify',
        data: { kind: 'reminder', title: '贾维斯提醒', text: '开会', task_id: 't1' }
      },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys[0].kind === 'system' && sys[0].text).toBe('⏰ 开会')
    expect(notifySpy).toHaveBeenCalledWith({ title: '贾维斯提醒', body: '开会' })
    expect(conn.ackProactive).toHaveBeenCalledWith('t1')
  })

  it('reminder 无 task_id → 不回执（无从确认）', () => {
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'reminder', title: '提醒', text: '喝水' } },
      conn
    )
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('deadline 全文上屏（无 ⏰ 前缀）+ 弹通知，不 ack', () => {
    const conn = makeConn()
    dispatchServerEvent(
      {
        event: 'proactive_notify',
        data: { kind: 'deadline', title: '贾维斯主动提醒', text: '📋 截止日期提醒：\n  • 明天：交报告' }
      },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys[0].kind === 'system' && sys[0].text).toContain('截止日期提醒')
    expect(sys[0].kind === 'system' && sys[0].text.startsWith('⏰')).toBe(false)
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('未知 kind 容错：按非 reminder 处理（全文上屏 + 通知，不 ack）', () => {
    const conn = makeConn()
    expect(() =>
      dispatchServerEvent(
        { event: 'proactive_notify', data: { kind: 'weird', title: 'T', text: 'X' } },
        conn
      )
    ).not.toThrow()
    expect(notifySpy).toHaveBeenCalledWith({ title: 'T', body: 'X' })
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('payload 缺失字段容错：空 data 不抛异常', () => {
    const conn = makeConn()
    expect(() =>
      dispatchServerEvent({ event: 'proactive_notify', data: null }, conn)
    ).not.toThrow()
  })

  it('window.jarvisDesktop 缺失时静默降级（不上屏失败）', () => {
    // 覆盖 preload 未注入 notify 的旧壳：try/catch 吞掉，气泡照常上屏
    ;(globalThis as unknown as { window: unknown }).window = {}
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'briefing', title: 'T', text: '正文' } },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys).toHaveLength(1)
  })
})

describe('dispatchServerEvent · 跨设备协同（qrcode / remote_state）', () => {
  // qrcode 事件→内联二维码卡片；remote_state 事件→remoteStore + 卡片 connected 同步。@author aceFelix
  it('qrcode 事件上屏一条手机二维码卡片', () => {
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'phone', url: 'http://127.0.0.1:8765/?token=abc' } },
      makeConn()
    )
    const card = useChatStore.getState().messages[0]
    expect(card).toMatchObject({ kind: 'qrcode', channel: 'phone', connected: false })
  })

  it('同通道重复 qrcode 事件就地刷新 url（不堆叠）', () => {
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'phone', url: 'u1' } }, makeConn())
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'phone', url: 'u2' } }, makeConn())
    const qr = useChatStore.getState().messages.filter((m) => m.kind === 'qrcode')
    expect(qr).toHaveLength(1)
    expect(qr[0]).toMatchObject({ url: 'u2' })
  })

  it('fresh 新连接：清理旧未连接卡片并在底部新建（重连不往上翻）', () => {
    // 先有一条旧未连接二维码 + 一条后续消息（模拟历史往下堆）
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'wechat', url: 'old' } }, makeConn())
    dispatchServerEvent({ event: 'info', data: '微信已断开' }, makeConn())
    // 重连：fresh=True → 旧未连接卡片被移除，新卡片在列表末尾
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'wechat', url: 'new', fresh: true } },
      makeConn()
    )
    const msgs = useChatStore.getState().messages
    const qr = msgs.filter((m) => m.kind === 'qrcode')
    expect(qr).toHaveLength(1)
    expect(qr[0]).toMatchObject({ url: 'new', connected: false })
    // 新二维码卡片位于消息列表末尾（配合自动滚底即在当前视口）
    expect(msgs[msgs.length - 1]).toMatchObject({ kind: 'qrcode', url: 'new' })
  })

  it('fresh 新连接：保留已连接历史卡片，仅清理未连接旧卡片', () => {
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'phone', url: 'p1', fresh: true } },
      makeConn()
    )
    // 上一张连上了 → 变已连接（应作为历史保留）
    dispatchServerEvent({ event: 'remote_state', data: { channel: 'phone', connected: true } }, makeConn())
    // 再次新连接：已连接旧卡保留，底部新建一张未连接
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'phone', url: 'p2', fresh: true } },
      makeConn()
    )
    const qr = useChatStore.getState().messages.filter((m) => m.kind === 'qrcode')
    expect(qr).toHaveLength(2)
    expect(qr[0]).toMatchObject({ url: 'p1', connected: true })
    expect(qr[1]).toMatchObject({ url: 'p2', connected: false })
  })

  it('remote_state 写 phone 连接态并收起对应二维码卡片', () => {
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'phone', url: 'u1' } }, makeConn())
    dispatchServerEvent({ event: 'remote_state', data: { channel: 'phone', connected: true } }, makeConn())
    expect(useRemoteStore.getState().phoneConnected).toBe(true)
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: 'qrcode', channel: 'phone', connected: true })
  })

  it('remote_state 无卡片时仅写连接态（微信登录无扫码上屏场景）', () => {
    dispatchServerEvent({ event: 'remote_state', data: { channel: 'wechat', connected: true } }, makeConn())
    expect(useRemoteStore.getState().wechatConnected).toBe(true)
    expect(useChatStore.getState().messages.filter((m) => m.kind === 'qrcode')).toHaveLength(0)
  })

  it('channel 缺失的畸形事件静默忽略', () => {
    expect(() => dispatchServerEvent({ event: 'remote_state', data: { connected: true } }, makeConn())).not.toThrow()
  })

  it('remote_user_message 上屏一条带来源标记的用户气泡（微信）', () => {
    dispatchServerEvent(
      { event: 'remote_user_message', data: { channel: 'wechat', text: '后天天气如何' } },
      makeConn()
    )
    const m = useChatStore.getState().messages[0]
    expect(m).toMatchObject({ kind: 'user', text: '后天天气如何', source: 'wechat' })
  })

  it('remote_user_message 先收尾上一条未定稿的流式 AI 气泡（防续写）', () => {
    // 模拟上一条微信回复的 assistant_done 漏收：气泡仍 streaming
    useChatStore.getState().appendAssistantText('旧回复')
    dispatchServerEvent(
      { event: 'remote_user_message', data: { channel: 'wechat', text: '新问题' } },
      makeConn()
    )
    const msgs = useChatStore.getState().messages
    const ai = msgs.find((m) => m.kind === 'ai')
    expect(ai && ai.kind === 'ai' && ai.streaming).toBe(false)
    expect(msgs[msgs.length - 1]).toMatchObject({ kind: 'user', source: 'wechat', text: '新问题' })
  })
})
