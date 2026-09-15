/**
 * 服务端事件分发器 —— WS 事件 → Zustand store actions（对齐 workbench app.js dispatchEvent）。
 *
 * 纯函数模块：不持有状态，dispatcher 依赖全部 store 与 reactorRef，
 * 单测可直接以事件对象驱动并断言 store 切片。
 *
 * @author aceFelix
 */

import type { ServerEvent } from '../api/ws'
import type { ProactiveNotifyPayload, VoiceState } from '../../../shared/contracts'
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

/** 半双工语音状态标签（voice_state → 状态条文案，镜像 voice_events.STATE_*）。 */
export const voiceStatusLabels: Record<string, string> = {
  dialog: '语音对话中',
  listening: '聆听中...',
  thinking: '思考中...',
  speaking: '播报中...',
  standby: '语音待命',
  exited: '语音已退出'
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
      // 回复收尾（含 reply.abort 取消路径）：撤销 busy，发送按钮从
      // “停止”态恢复为“发送”态。@author aceFelix
      chat.setBusy(false)
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
      // 权威置 talk 模式：voice→talk 互斥切换时，引擎先发的 voice_stopped 会
      // 把 mode 重置为 text，这里复位保证最终停在 talk（与 voice_started 对称）。
      // @author aceFelix
      left.setMode('talk')
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

    // ---- 半双工语音（/voice：STT→LLM→TTS 连续循环，本机出声） ----
    case 'voice_started':
      left.setVoiceActive(true)
      left.setMode('voice')
      break
    case 'voice_stopped':
      left.setVoiceActive(false)
      left.setVoiceState('')
      left.setMode('text')
      onStatus?.({ text: '就绪', tone: 'idle' })
      break
    case 'voice_state': {
      const st = String(payload ?? '')
      left.setVoiceState(st as VoiceState)
      if (voiceStatusLabels[st]) {
        onStatus?.({ text: voiceStatusLabels[st], tone: 'talk' })
      }
      break
    }
    case 'voice_user_transcript':
      chat.addUser(String(payload ?? ''))
      break
    case 'voice_ai_text_delta':
      chat.appendAssistantText(String(payload ?? ''))
      break
    case 'voice_ai_text': {
      // 全量文本：替换流式气泡并收尾（与 ai_transcript 同构）
      const text = String(payload ?? '')
      const messages = useChatStore.getState().messages
      const lastAi = [...messages].reverse().find((m) => m.kind === 'ai' && m.streaming)
      if (lastAi) {
        chat.appendAssistantText('')
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

    // ---- 主动播报（每日简报 / 用户提醒 / 截止日期） ----
    case 'proactive_notify': {
      const p = (payload ?? {}) as ProactiveNotifyPayload
      const kind = p.kind ?? 'briefing'
      const text = String(p.text ?? '')
      const title = String(p.title ?? '贾维斯主动提醒')
      // 上屏：reminder 带 ⏰ 前缀；briefing/deadline 全文多行系统气泡
      //（.message 基类 white-space: pre-wrap，\n 直接换行）
      chat.addSystem(kind === 'reminder' ? `⏰ ${text}` : text)
      // 主进程系统通知：窗口隐藏/最小化到托盘时依然弹（走 jarvisDesktop.notify）
      try {
        window.jarvisDesktop?.notify?.({ title, body: text })
      } catch {
        // 通知失败不影响上屏
      }
      // reminder 且带 task_id：窗口可见即视为已读，回执停止升级重发
      if (kind === 'reminder' && p.task_id) {
        conn.ackProactive(String(p.task_id))
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
