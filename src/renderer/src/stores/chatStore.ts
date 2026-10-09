/**
 * 消息流 store —— 中栏聊天区唯一数据源。
 *
 * 消息模型（判别联合，React 渲染按 kind 分发）：
 * - user：用户气泡（本地发送即上屏，引擎 user_message 回显跳过防双气泡）
 * - ai：AI 气泡（流式增量 text/thinking，streaming 标记当前流式目标）
 * - tool：工具卡片（tool_use 创建 → tool_result 按 id 回填；轮次结束时仍未回填的收尾为中断态）
 * - system：系统提示（info/warn/error，带 tone 决定配色）
 * - slash：斜杠命令透传输出卡片（slash.exec 的 slash_result 事件，等宽全文）
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
  // slash：斜杠命令透传（slash.exec，2026-10）—— slash_result 事件的命令输出卡片：
  // command = 命令原文（summary 行），text = 捕获输出全文，isError = 执行失败态。
  // @author aceFelix
  | { kind: 'slash'; id: number; command: string; text: string; isError: boolean }
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
  /**
   * 停止闸门：点「停止」（reply.abort）后置 true，assistant_done 到达或新一轮
   * 发送时清 false。置 true 期间 dispatcher 丢弃在途/排队的 assistant_text /
   * assistant_thinking / tool_use 增量——后端取消虽即时，但取消前已经 WS 送达或
   * 正在被 React 逐条渲染的思考增量若不加闸门会继续追加（无流式气泡时还会新建
   * 一条），表现为「点了停止 jarvis 还在输出思考、无法马上停止」。
   * @author aceFelix
   */
  aborted: boolean

  /** 用户气泡：images 为缩略图 data URL（仅展示，模型侧走 WS 的 base64 字段）；
   * source 为远端通道（手机 / 微信）入站消息的来源标记。 */
  addUser: (text: string, images?: string[], source?: RemoteChannel) => void
  /**
   * 实时语音用户转写入列（带顺序修复）：DashScope 输入转写
   * （input_audio_transcription.completed）异步滞后，常晚于本轮 AI 回复转写
   * （response.audio_transcript.delta）到达，直接追加会让用户气泡落在 AI
   * 回复气泡之后。此动作把用户气泡插到「尾部在途 AI/工具卡之前」——从尾部
   * 向前越过 ai/tool 项，遇到流式中的 AI 气泡（本轮回复起点）即停；沿途无
   * 流式气泡（无在途回复，如开场问候已说完）则保持追加语义，不扰动历史。
   * @author aceFelix
   */
  addUserTranscript: (text: string) => void
  appendAssistantText: (delta: string) => void
  appendThinking: (delta: string) => void
  finishAssistant: () => void
  addSystem: (text: string, tone?: 'info' | 'warn' | 'error') => void
  /**
   * 斜杠命令输出卡片（slash_result 事件）：命令原文 + 捕获全文 + 成败态。
   * 不受 aborted 停止闸门影响（命令结果不是流式增量）。@author aceFelix
   */
  addSlash: (command: string, text: string, isError: boolean) => void
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
  /** 设置停止闸门（abortReply 置 true / assistant_done、新一轮发送清 false）。 */
  setAborted: (aborted: boolean) => void
  clear: () => void
  /**
   * 撤回：从尾部数第 userTailCount 条用户气泡起（含）裁到列表末尾，
   * 并复位 busy / askPrompt（与后端 checkpoint_ops.rewind 截断 _messages 同口径）。
   * 用户气泡不足 userTailCount 条时不做任何改动（返回 false，调用方据此提示）。
   * 由 dispatcher 消化 rewound 事件（ok=true）时按 removed_user 调用。
   * @author aceFelix
   */
  rewindTailFromUser: (userTailCount: number) => boolean
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

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  askPrompt: null,
  busy: false,
  aborted: false,

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

  addUserTranscript: (text) =>
    set((s) => {
      const msg: MessageItem = { kind: 'user', id: genId(), text }
      const list = [...s.messages]
      // 从尾部向前确定插入点：越过本轮已到的 ai/tool 项，停在流式中的
      // AI 气泡（本轮回复起点）之前；遇非 ai/tool 项（历史用户消息 /
      // 系统 / 二维码等）或整段无流式气泡则不重排，保持追加语义。
      let insertAt = list.length
      let sawStreaming = false
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]
        if (m.kind === 'ai' || m.kind === 'tool') {
          insertAt = i
          if (m.kind === 'ai' && m.streaming) {
            sawStreaming = true
            break
          }
          continue
        }
        break
      }
      if (!sawStreaming) return { messages: [...s.messages, msg] }
      list.splice(insertAt, 0, msg)
      return { messages: list }
    }),

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

  addSlash: (command, text, isError) =>
    set((s) => ({
      messages: [...s.messages, { kind: 'slash', id: genId(), command, text, isError }]
    })),

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
  setAborted: (aborted) => set({ aborted }),
  clear: () => set({ messages: [], askPrompt: null, busy: false, aborted: false }),

  rewindTailFromUser: (userTailCount) => {
    if (userTailCount < 1) return false
    const list = get().messages
    let seen = 0
    let start = -1
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].kind === 'user') {
        seen++
        if (seen >= userTailCount) {
          start = i
          break
        }
      }
    }
    if (start < 0) return false
    set({ messages: list.slice(0, start), busy: false, askPrompt: null })
    return true
  },

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
