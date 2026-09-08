/**
 * 消息流 store —— 中栏聊天区唯一数据源。
 *
 * 消息模型（判别联合，React 渲染按 kind 分发）：
 * - user：用户气泡（本地发送即上屏，引擎 user_message 回显跳过防双气泡）
 * - ai：AI 气泡（流式增量 text/thinking，streaming 标记当前流式目标）
 * - tool：工具卡片（tool_use 创建 → tool_result 按 id 回填）
 * - system：系统提示（info/warn/error，带 tone 决定配色）
 *
 * WS 事件在 actions 里消化（dispatcher 调用），组件只订阅切片。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

export type MessageItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'ai'; id: number; text: string; thinking: string; streaming: boolean }
  | {
      kind: 'tool'
      id: number
      toolId: string
      name: string
      input: string
      output: string
      isError: boolean
      done: boolean
    }
  | { kind: 'system'; id: number; text: string; tone: 'info' | 'warn' | 'error' }

let nextId = 1
const genId = (): number => nextId++

export interface ChatState {
  messages: MessageItem[]
  /** ask_user 弹窗（权限确认等），null 表示未激活。 */
  askPrompt: string | null
  /** 状态栏：busy（思考中）/ idle。 */
  busy: boolean

  addUser: (text: string) => void
  appendAssistantText: (delta: string) => void
  appendThinking: (delta: string) => void
  finishAssistant: () => void
  addSystem: (text: string, tone?: 'info' | 'warn' | 'error') => void
  addToolCard: (name: string, toolId: string, input: string) => void
  fillToolResult: (toolId: string, name: string, content: string, isError: boolean) => void
  showAskUser: (prompt: string) => void
  hideAskUser: () => void
  setBusy: (busy: boolean) => void
  clear: () => void
  /** 恢复历史会话：清空后回放（与 workbench session_loaded 口径一致）。 */
  replayHistory: (messages: Array<{ role: string; text?: string; tool_count?: number }>) => void
}

/** 取当前流式中的 AI 气泡下标（无则 -1）。 */
function streamingIndex(list: MessageItem[]): number {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.kind === 'ai' && m.streaming) return i
  }
  return -1
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  askPrompt: null,
  busy: false,

  addUser: (text) =>
    set((s) => ({ messages: [...s.messages, { kind: 'user', id: genId(), text }] })),

  appendAssistantText: (delta) =>
    set((s) => {
      const list = [...s.messages]
      let idx = streamingIndex(list)
      if (idx < 0) {
        list.push({ kind: 'ai', id: genId(), text: '', thinking: '', streaming: true })
        idx = list.length - 1
      }
      const cur = list[idx] as Extract<MessageItem, { kind: 'ai' }>
      list[idx] = { ...cur, text: cur.text + delta }
      return { messages: list }
    }),

  appendThinking: (delta) =>
    set((s) => {
      const list = [...s.messages]
      let idx = streamingIndex(list)
      if (idx < 0) {
        list.push({ kind: 'ai', id: genId(), text: '', thinking: '', streaming: true })
        idx = list.length - 1
      }
      const cur = list[idx] as Extract<MessageItem, { kind: 'ai' }>
      list[idx] = { ...cur, thinking: cur.thinking + delta }
      return { messages: list }
    }),

  finishAssistant: () =>
    set((s) => ({
      busy: false,
      messages: s.messages.map((m) =>
        m.kind === 'ai' && m.streaming ? { ...m, streaming: false } : m
      )
    })),

  addSystem: (text, tone = 'info') =>
    set((s) => ({ messages: [...s.messages, { kind: 'system', id: genId(), text, tone }] })),

  addToolCard: (name, toolId, input) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { kind: 'tool', id: genId(), toolId, name, input, output: '', isError: false, done: false }
      ]
    })),

  fillToolResult: (toolId, name, content, isError) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.kind === 'tool' && m.toolId === toolId)
      if (idx < 0) {
        // 结果先到（历史回放/乱序）：补一张已完成卡片
        return {
          messages: [
            ...s.messages,
            {
              kind: 'tool' as const,
              id: genId(),
              toolId,
              name,
              input: '',
              output: content || '(无输出)',
              isError,
              done: true
            }
          ]
        }
      }
      const list = [...s.messages]
      const cur = list[idx] as Extract<MessageItem, { kind: 'tool' }>
      list[idx] = { ...cur, output: content || '(无输出)', isError, done: true }
      return { messages: list }
    }),

  showAskUser: (prompt) => set({ askPrompt: prompt }),
  hideAskUser: () => set({ askPrompt: null }),
  setBusy: (busy) => set({ busy }),
  clear: () => set({ messages: [], askPrompt: null, busy: false }),

  replayHistory: (messages) =>
    set(() => {
      const list: MessageItem[] = []
      for (const m of messages) {
        if (m.role === 'assistant') {
          // 无文本的纯工具轮次不生成空气泡（与 workbench 口径一致）
          if (m.text) {
            list.push({ kind: 'ai', id: genId(), text: m.text, thinking: '', streaming: false })
          }
          if (m.tool_count) {
            list.push({
              kind: 'tool',
              id: genId(),
              toolId: '',
              name: `历史工具调用 ×${m.tool_count}`,
              input: '(历史会话)',
              output: '(历史会话)',
              isError: false,
              done: true
            })
          }
        } else if (m.text) {
          list.push({ kind: 'user', id: genId(), text: m.text })
        }
      }
      return { messages: list, askPrompt: null, busy: false }
    })
}))
