/**
 * dispatchServerEvent 单测 —— WS 事件到各 store 的路由（对齐 workbench app.js dispatchEvent）。
 *
 * 用假 JarvisConnection（三个 refresh 为 spy）驱动，断言聊天 / 左栏 / 指标 store 切片
 * 与状态栏回调。reactor 未注册（getReactor()=null），语音类事件走可选链不报错。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  dispatchServerEvent,
  talkStatusLabels,
  asSessionList,
  asModelList,
  asVoiceList,
  type StatusLabel
} from '@renderer/api/dispatcher'
import { useChatStore } from '@renderer/stores/chatStore'
import { useLeftStore } from '@renderer/stores/leftStore'
import { useMetricsStore } from '@renderer/stores/metricsStore'
import type { JarvisConnection } from '@renderer/stores/backendStore'

/** 假连接门面：三个刷新动作均为 spy。 */
function makeConn(): JarvisConnection {
  return {
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    refreshModels: vi.fn().mockResolvedValue(undefined),
    refreshVoices: vi.fn().mockResolvedValue(undefined)
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
    talkActive: false
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
