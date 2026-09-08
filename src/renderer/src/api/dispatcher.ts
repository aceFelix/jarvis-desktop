/**
 * 服务端事件分发器 —— WS 事件 → Zustand store actions（对齐 workbench app.js dispatchEvent）。
 *
 * 纯函数模块：不持有状态，dispatcher 依赖全部 store 与 reactorRef，
 * 单测可直接以事件对象驱动并断言 store 切片。
 *
 * @author aceFelix
 */

import type { ServerEvent } from '../api/ws'
import { useChatStore } from '../stores/chatStore'
import { useLeftStore, type ModelItem, type SessionItem, type VoiceItem } from '../stores/leftStore'
import { useMetricsStore, type MetricsPayload } from '../stores/metricsStore'
import { getReactor } from '../stores/reactorRef'
import type { ReactorStatus } from '../reactor'
import type { JarvisConnection } from '../stores/backendStore'

/** 实时模式状态标签（状态栏文案，与 workbench 一致）。 */
export const talkStatusLabels: Record<string, string> = {
  connecting: '实时连接中...',
  standby: '实时待命',
  listening: '聆听中...',
  speaking: '贾维斯说话中...',
  error: '实时连接异常'
}

/** 状态栏文案 store（status 事件与 busy 状态共用出口）。 */
export interface StatusLabel {
  text: string
  tone: 'idle' | 'busy' | 'talk' | 'err'
}

/**
 * 分发一条服务端事件。
 *
 * @param msg - WS 事件信封 `{event, data}`。
 * @param conn - 当前连接（init 时触发左栏数据刷新）。
 * @param onStatus - 状态栏文案回调（TitleBar/左栏 footer 消费）。
 */
export function dispatchServerEvent(
  msg: ServerEvent,
  conn: JarvisConnection,
  onStatus?: (label: StatusLabel) => void
): void {
  const chat = useChatStore.getState()
  const left = useLeftStore.getState()
  const payload = msg.data

  switch (msg.event) {
    // ---- 初始化：刷新左栏三面板数据 ----
    case 'init':
      void conn.refreshSessions()
      void conn.refreshModels()
      void conn.refreshVoices()
      break

    // ---- 文本对话流 ----
    case 'user_message':
      // 引擎回显：本地发送时已上屏，跳过防双气泡
      break
    case 'assistant_text':
      chat.appendAssistantText(String(payload ?? ''))
      break
    case 'assistant_thinking':
      chat.appendThinking(String(payload ?? ''))
      break
    case 'assistant_done':
      chat.finishAssistant()
      onStatus?.({ text: '就绪', tone: 'idle' })
      void conn.refreshSessions()
      break
    case 'tool_use': {
      const p = payload as { name?: string; id?: string; input?: unknown }
      chat.addToolCard(p?.name ?? '工具', p?.id ?? '', JSON.stringify(p?.input ?? {}, null, 2))
      break
    }
    case 'tool_result': {
      const p = payload as { id?: string; name?: string; content?: string; is_error?: boolean }
      chat.fillToolResult(p?.id ?? '', p?.name ?? '工具', p?.content ?? '', !!p?.is_error)
      break
    }
    case 'info':
      chat.addSystem(String(payload ?? ''))
      break
    case 'warn':
      chat.addSystem(`⚠ ${payload ?? ''}`, 'warn')
      break
    case 'error':
      chat.addSystem(`✗ ${payload ?? ''}`, 'error')
      onStatus?.({ text: '出错', tone: 'err' })
      break
    case 'ask_user':
      chat.showAskUser(String(payload ?? ''))
      break

    // ---- 会话管理 ----
    case 'session_renamed':
      // 标题生成改名通知：只刷新左栏会话列表，绝不清空气泡。
      // session_ready 带"清空初始化"语义（引擎装配完成），复用它会把
      // 刚流式渲染完的回复擦掉（实测首轮回复后整屏空白）。
      // @author aceFelix
      void conn.refreshSessions()
      break
    case 'session_ready':
      chat.clear()
      void conn.refreshSessions()
      break
    case 'session_new':
      chat.clear()
      chat.addSystem('已开启新会话')
      void conn.refreshSessions()
      break
    case 'session_loaded': {
      const p = payload as { name?: string; messages?: Array<{ role: string; text?: string; tool_count?: number }> }
      chat.replayHistory(p?.messages ?? [])
      chat.addSystem(`已恢复会话「${p?.name ?? ''}」`)
      void conn.refreshSessions()
      break
    }
    case 'status':
      if (typeof payload === 'string' && talkStatusLabels[payload]) {
        getReactor()?.setStatus(payload as ReactorStatus)
        onStatus?.({ text: talkStatusLabels[payload], tone: 'talk' })
      } else if (typeof payload === 'string') {
        onStatus?.({ text: payload, tone: 'idle' })
      }
      break

    // ---- 实时语音 ----
    case 'talk_started':
      left.setTalkActive(true)
      break
    case 'talk_stopped':
      left.setTalkActive(false)
      left.setMode('text')
      onStatus?.({ text: '就绪', tone: 'idle' })
      break
    case 'volume':
      getReactor()?.setVolume(Number(payload) || 0)
      break
    case 'user_speaking':
      getReactor()?.setUserSpeaking(!!payload)
      break
    case 'ai_speaking':
      getReactor()?.setAiSpeaking(!!payload)
      break
    case 'user_transcript':
      chat.addUser(String(payload ?? ''))
      break
    case 'ai_transcript_delta':
      chat.appendAssistantText(String(payload ?? ''))
      break
    case 'ai_transcript': {
      // 全量转写：替换流式气泡文本并收尾
      const text = String(payload ?? '')
      const messages = useChatStore.getState().messages
      const lastAi = [...messages].reverse().find((m) => m.kind === 'ai' && m.streaming)
      if (lastAi) {
        chat.appendAssistantText('') // 确保气泡存在
        useChatStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === lastAi.id && m.kind === 'ai' ? { ...m, text, streaming: false } : m
          )
        }))
      } else {
        chat.appendAssistantText(text)
        chat.finishAssistant()
      }
      break
    }

    // ---- 系统指标 ----
    case 'metrics':
      useMetricsStore.getState().update((payload ?? {}) as MetricsPayload)
      break

    default:
      // 未知事件静默忽略（协议向后兼容）
      break
  }
}

/** 左栏列表类型守卫复用（conn 刷新动作里做 payload 校验）。 */
export function asSessionList(value: unknown): SessionItem[] {
  return Array.isArray(value) ? (value as SessionItem[]) : []
}

export function asModelList(value: unknown): ModelItem[] {
  return Array.isArray(value) ? (value as ModelItem[]) : []
}

export function asVoiceList(value: unknown): VoiceItem[] {
  return Array.isArray(value) ? (value as VoiceItem[]) : []
}
