/**
 * 消息流 store —— 中栏聊天区唯一数据源。
 *
 * 消息模型（判别联合，React 渲染按 kind 分发）：
 * - user：用户气泡（本地发送即上屏，引擎 user_message 回显跳过防双气泡）
 * - ai：AI 气泡（流式增量 text/thinking，streaming 标记当前流式目标）
 * - tool：工具卡片（tool_use 创建 → tool_result 按 id 回填；轮次结束时仍未回填的收尾为中断态）
 * - system：系统提示（info/warn/error，带 tone 决定配色）
 *
 * WS 事件在 actions 里消化（dispatcher 调用），组件只订阅切片。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { RemoteChannel } from '../../../shared/contracts'

export type MessageItem =
  // source：远端通道（手机 / 微信）入站消息的来源标记，本地输入无此字段。
  // 渲染时气泡样式与本地用户消息一致（右对齐），仅标签改显“微信 / 手机”。
  | { kind: 'user'; id: number; text: string; images?: string[]; source?: RemoteChannel }
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
  // qrcode：跨设备协同连接卡片（手机 / 微信），url 由渲染层用 qrcode 库画成
  // 二维码；connected 置真后卡片收起二维码改显「已连接」（连接完成后不再需要扫码）。
  // @author aceFelix
  | {
      kind: 'qrcode'
      id: number
      channel: RemoteChannel
      url: string
      connected: boolean
    }

let nextId = 1
const genId = (): number => nextId++

export interface ChatState {
  messages: MessageItem[]
  /** ask_user 弹窗（权限确认等），null 表示未激活。 */
  askPrompt: string | null
  /** 状态栏：busy（思考中）/ idle。 */
  busy: boolean

  /** 用户气泡：images 为缩略图 data URL（仅展示，模型侧走 WS 的 base64 字段）；
   * source 为远端通道（手机 / 微信）入站消息的来源标记。 */
  addUser: (text: string, images?: string[], source?: RemoteChannel) => void
  appendAssistantText: (delta: string) => void
  appendThinking: (delta: string) => void
  finishAssistant: () => void
  addSystem: (text: string, tone?: 'info' | 'warn' | 'error') => void
  addToolCard: (name: string, toolId: string, input: string) => void
  fillToolResult: (toolId: string, name: string, content: string, isError: boolean) => void
  showAskUser: (prompt: string) => void
  hideAskUser: () => void
  /**
   * 新增/更新一条跨设备协同二维码卡片。
   * - fresh=true：一次新连接 → 清理该通道旧未连接卡片，在底部新建一张（重连
   *   自动滚到底部即可看到，无需往上翻找）。
   * - fresh=false/缺省：同一连接内二维码过期刷新 → 就地更新最后一条未连接
   *   卡片 url（不堆叠多张）。@author aceFelix
   */
  addQrcode: (channel: RemoteChannel, url: string, fresh?: boolean) => void
  /** 把指定通道最新的二维码卡片标为已连接/未连接。@author aceFelix */
  setQrcodeConnected: (channel: RemoteChannel, connected: boolean) => void
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

/** 反向查找首个满足条件的下标（findLastIndex 的 es2020 兼容替身）。 */
function findLast(
  list: MessageItem[],
  pred: (m: MessageItem) => boolean
): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (pred(list[i])) return i
  }
  return -1
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  askPrompt: null,
  busy: false,

  addUser: (text, images, source) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          kind: 'user',
          id: genId(),
          text,
          images: images?.length ? images : undefined,
          source
        }
      ]
    })),

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
      messages: s.messages.map((m) => {
        if (m.kind === 'ai' && m.streaming) return { ...m, streaming: false }
        // 一轮结束（正常收尾 / reply.abort 取消 / 中途报错）时，把仍未收到
        // tool_result 的工具卡一并定稿：被取消的 Bash 等子进程不会再回结果，
        // 若不收尾卡片会永远停在“执行中”，用户误判为命令卡死、也以为停止无效。
        // 标为已完成 + 失败态（✗）并附中断说明，让工具组正常折叠收起。
        // @author aceFelix
        if (m.kind === 'tool' && !m.done) {
          return {
            ...m,
            done: true,
            isError: true,
            output: m.output || '（本轮已结束：未收到该工具结果，可能已被停止或中途出错）'
          }
        }
        return m
      })
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

  addQrcode: (channel, url, fresh) =>
    set((s) => {
      const card: Extract<MessageItem, { kind: 'qrcode' }> = {
        kind: 'qrcode',
        id: genId(),
        channel,
        url,
        connected: false
      }
      // 新连接（fresh）：先移除该通道旧未连接卡片（重连不留死二维码），
      // 再在底部追加新卡片 → 配合自动滚底，用户总能在当前视口看到二维码。
      // @author aceFelix
      if (fresh) {
        const cleaned = s.messages.filter(
          (m) => !(m.kind === 'qrcode' && m.channel === channel && !m.connected)
        )
        return { messages: [...cleaned, card] }
      }
      // 刷新（同一连接内二维码过期重生成）→ 就地更新最后一条未连接卡片 url
      const idx = findLast(
        s.messages,
        (m) => m.kind === 'qrcode' && m.channel === channel && !m.connected
      )
      if (idx >= 0) {
        const list = [...s.messages]
        const cur = list[idx] as Extract<MessageItem, { kind: 'qrcode' }>
        list[idx] = { ...cur, url }
        return { messages: list }
      }
      return { messages: [...s.messages, card] }
    }),

  setQrcodeConnected: (channel, connected) =>
    set((s) => {
      const idx = findLast(s.messages, (m) => m.kind === 'qrcode' && m.channel === channel)
      if (idx < 0) return {}
      const list = [...s.messages]
      const cur = list[idx] as Extract<MessageItem, { kind: 'qrcode' }>
      list[idx] = { ...cur, connected }
      return { messages: list }
    }),

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
