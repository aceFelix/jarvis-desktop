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
import type { JarvisConnection } from '@renderer/stores/backendStore'

/** 假连接门面：三个刷新动作 + 提醒已读回执均为 spy。 */
function makeConn(): JarvisConnection {
  return {
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    refreshModels: vi.fn().mockResolvedValue(undefined),
    refreshVoices: vi.fn().mockResolvedValue(undefined),
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
    voiceState: ''
  })
  useMetricsStore.setState({ cpu: 0, memory: null, disk: null })
})

describe('dispatchServerEvent · 文本对话流', () => {
  it('assistant_text 流式累加到聊天 store', () => {
    dispatchServerEvent({ event: 'assistant_text', data: '你好' }, makeConn())
    dispatchServerEvent({ event: 'assistant_text', data: '世界' }, makeConn())
    const ai = useChatStore.getState().messages[0]
    expect(ai).toMatchObject({ kind: 'ai', text: '你好世界', streaming: true })
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
  it('init 触发三列表刷新', () => {
    const conn = makeConn()
    dispatchServerEvent({ event: 'init', data: null }, conn)
    expect(conn.refreshSessions).toHaveBeenCalled()
    expect(conn.refreshModels).toHaveBeenCalled()
    expect(conn.refreshVoices).toHaveBeenCalled()
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
