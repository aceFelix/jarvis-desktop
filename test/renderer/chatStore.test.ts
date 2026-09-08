/**
 * chatStore 单测 —— 消息流 store 的全部 action（流式增量、工具卡回填、历史回放）。
 *
 * 这是"消息气泡流式渲染"的数据层验证；组件层渲染在 components.test.tsx。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, type MessageItem } from '@renderer/stores/chatStore'

/** 取指定 kind 的消息（收窄类型，方便断言字段）。 */
function pick<T extends MessageItem['kind']>(
  kind: T
): Array<Extract<MessageItem, { kind: T }>> {
  return useChatStore
    .getState()
    .messages.filter((m) => m.kind === kind) as Array<Extract<MessageItem, { kind: T }>>
}

beforeEach(() => {
  useChatStore.getState().clear()
})

describe('chatStore', () => {
  it('addUser 追加用户气泡', () => {
    useChatStore.getState().addUser('你好')
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'user', text: '你好' })
  })

  it('流式增量累加到同一 AI 气泡', () => {
    const s = useChatStore.getState()
    s.appendAssistantText('你好')
    s.appendAssistantText('，世界')
    const ai = pick('ai')
    expect(ai).toHaveLength(1)
    expect(ai[0]).toMatchObject({ text: '你好，世界', streaming: true })
  })

  it('thinking 与 text 分别累加到同一气泡', () => {
    const s = useChatStore.getState()
    s.appendThinking('思考中')
    s.appendAssistantText('答复')
    expect(pick('ai')[0]).toMatchObject({ thinking: '思考中', text: '答复' })
  })

  it('finishAssistant 结束流式并清 busy', () => {
    const s = useChatStore.getState()
    s.setBusy(true)
    s.appendAssistantText('完成')
    s.finishAssistant()
    const st = useChatStore.getState()
    expect(st.busy).toBe(false)
    expect(pick('ai')[0].streaming).toBe(false)
  })

  it('finishAssistant 后再 append 会新建气泡', () => {
    const s = useChatStore.getState()
    s.appendAssistantText('a')
    s.finishAssistant()
    s.appendAssistantText('b')
    const ai = pick('ai')
    expect(ai).toHaveLength(2)
    expect(ai[0].text).toBe('a')
    expect(ai[1].text).toBe('b')
  })

  it('addToolCard 建卡 + fillToolResult 按 id 回填', () => {
    const s = useChatStore.getState()
    s.addToolCard('read_file', 'call_1', '{"path":"x"}')
    expect(pick('tool')[0]).toMatchObject({ name: 'read_file', done: false })
    s.fillToolResult('call_1', 'read_file', '内容', false)
    expect(pick('tool')[0]).toMatchObject({ done: true, output: '内容', isError: false })
  })

  it('fillToolResult 无匹配卡时补一张完成卡（乱序/回放）', () => {
    useChatStore.getState().fillToolResult('ghost', '工具', '结果', true)
    expect(pick('tool')[0]).toMatchObject({
      toolId: 'ghost',
      done: true,
      isError: true,
      output: '结果'
    })
  })

  it('空输出回填为占位文案', () => {
    const s = useChatStore.getState()
    s.addToolCard('t', 'id1', 'in')
    s.fillToolResult('id1', 't', '', false)
    expect(pick('tool')[0].output).toBe('(无输出)')
  })

  it('ask_user 显示与隐藏', () => {
    const s = useChatStore.getState()
    s.showAskUser('是否继续？')
    expect(useChatStore.getState().askPrompt).toBe('是否继续？')
    s.hideAskUser()
    expect(useChatStore.getState().askPrompt).toBeNull()
  })

  it('addSystem 带 tone', () => {
    useChatStore.getState().addSystem('出错了', 'error')
    expect(pick('system')[0]).toMatchObject({ tone: 'error', text: '出错了' })
  })

  it('replayHistory 回放：用户 / AI / 工具计数，跳过空轮次', () => {
    useChatStore.getState().replayHistory([
      { role: 'user', text: '问' },
      { role: 'assistant', text: '答', tool_count: 2 },
      { role: 'assistant', text: '' }
    ])
    const kinds = useChatStore.getState().messages.map((m) => m.kind)
    expect(kinds).toEqual(['user', 'ai', 'tool'])
    expect(pick('tool')[0].name).toContain('×2')
  })

  it('clear 清空消息 / busy / askPrompt', () => {
    const s = useChatStore.getState()
    s.addUser('x')
    s.setBusy(true)
    s.showAskUser('q')
    s.clear()
    const st = useChatStore.getState()
    expect(st.messages).toEqual([])
    expect(st.busy).toBe(false)
    expect(st.askPrompt).toBeNull()
  })
})
