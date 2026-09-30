/**
 * 服务端事件分发器 —— WS 事件 → Zustand store actions（对齐 workbench app.js dispatchEvent）。
 *
 * 纯函数模块：不持有状态，dispatcher 依赖全部 store 与 reactorRef，
 * 单测可直接以事件对象驱动并断言 store 切片。
 *
 * @author aceFelix
 */

import type { ServerEvent } from '../api/ws'
import type {
  CurrentProject,
  ProactiveNotifyPayload,
  VoiceState
} from '../../../shared/contracts'
import { useChatStore } from '../stores/chatStore'
import { useLeftStore, type ModelItem, type SessionItem, type VoiceItem } from '../stores/leftStore'
import { useMetricsStore, type MetricsPayload } from '../stores/metricsStore'
import { useRightStore, type McpStatus } from '../stores/rightStore'
import { getReactor } from '../stores/reactorRef'
import type { ReactorStatus } from '../reactor'
import type { JarvisConnection } from '../stores/backendStore'
import { flushTalkAudio, pushTalkAudio, startTalkPlayback, stopTalkPlayback } from '../audio/talkPlayback'

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

/** 运行健康日志流入口：右栏滚动展示最近事件（带时间戳由 store 添加）。 */
function logLine(text: string): void {
  useRightStore.getState().pushLog(text)
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
    // ---- 初始化：刷新左栏三面板 + 右栏任务中心/用量/运行健康 + 设置面板 ----
    case 'init':
      void conn.refreshSessions()
      void conn.refreshModels()
      void conn.refreshVoices()
      void conn.refreshSchedule()
      void conn.refreshCost()
      void conn.refreshState()
      void conn.refreshSettings()
      // 项目工作区：当前项目 + 最近项目列表一并拉取（一次 WS 往返内完成）。
      // @author aceFelix
      void conn.refreshProjects()
      // 握手完成：状态栏从启动期的「等待后端启动...」切到「就绪」。init 是每连接
      // 首帧，此前只有首轮回复结束/断线才会刷新状态文案，连上后端后长期挂着
      // 「等待后端启动...」会让人误以为后端没起来。@author aceFelix
      onStatus?.({ text: '就绪', tone: 'idle' })
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
      // 一轮对话消耗了 token：刷新右栏用量卡。@author aceFelix
      void conn.refreshCost()
      logLine('回复完成')
      break
    case 'tool_use': {
      const p = payload as { name?: string; id?: string; input?: unknown }
      chat.addToolCard(p?.name ?? '工具', p?.id ?? '', JSON.stringify(p?.input ?? {}, null, 2))
      logLine(`工具调用：${p?.name ?? '工具'}`)
      break
    }
    case 'tool_result': {
      const p = payload as { id?: string; name?: string; content?: string; is_error?: boolean }
      chat.fillToolResult(p?.id ?? '', p?.name ?? '工具', p?.content ?? '', !!p?.is_error)
      break
    }
    case 'info':
      chat.addSystem(String(payload ?? ''))
      logLine(String(payload ?? ''))
      break
    case 'warn':
      chat.addSystem(`⚠ ${payload ?? ''}`, 'warn')
      logLine(`⚠ ${payload ?? ''}`)
      break
    case 'error':
      chat.addSystem(`✗ ${payload ?? ''}`, 'error')
      logLine(`✗ ${payload ?? ''}`)
      onStatus?.({ text: '出错', tone: 'err' })
      break
    case 'ask_user':
      chat.showAskUser(String(payload ?? ''))
      break

    // ---- 模型热切换（引擎落地回执） ----
    case 'model_switched': {
      // 引擎已把运行中的 provider / 模型换成 payload.model：清「待生效」标记
      // （只清匹配项，免误清新点选的另一个模型）+ 刷模型列表让「当前」移动
      // + 刷用量卡与状态（右栏 model / provider 跟着变）。成功气泡由引擎的
      // info 事件上屏，此处不重复提示。@author aceFelix
      const p = payload as { model?: string }
      const cur = useLeftStore.getState()
      if (!p?.model || cur.pendingModel === p.model) cur.setPendingModel('')
      void conn.refreshModels()
      void conn.refreshCost()
      void conn.refreshState()
      logLine(`模型已切换：${p?.model ?? ''}`)
      break
    }

    // ---- 项目热切换（引擎落地回执，同口径参照 model_switched） ----
    // payload {workdir, name}：引擎已完成 settings.workdir 重写 + 系统提示词
    // 重建 + 新会话创建 + projects.toml 置顶（handle_set_workdir）。前端这里：
    // - 只清匹配项的 pendingProjectPath，避免“快速连续点选 A→B”时 B 事件
    //   到达后把 A 的残留一并吞掉；
    // - 刷会话列表（新会话行）+ 项目区（最近列表、当前项目字段）；
    // - 当前项目直接以事件 payload 写回，不再走一次 project.get（省一次往返）。
    // 成功气泡由引擎 info 事件上屏，不重复提示。@author aceFelix
    case 'project_switched': {
      const p = payload as { workdir?: string; name?: string }
      const cur = useLeftStore.getState()
      const workdir = String(p?.workdir ?? '')
      const name = String(p?.name ?? '')
      if (workdir) {
        const next: CurrentProject = { workdir, name: name || workdir, persisted: true }
        cur.setCurrentProject(next)
        if (cur.pendingProjectPath === workdir) cur.setPendingProjectPath('')
      } else if (cur.pendingProjectPath) {
        // 无 workdir 的异常事件（理论上不到达）：保守清 pending，避免项目区长期“待生效”
        cur.setPendingProjectPath('')
      }
      void conn.refreshSessions()
      void conn.refreshProjects()
      logLine(`项目已切换：${name || workdir}`)
      break
    }

    // ---- 会话管理 ----
    case 'session_renamed':
      // 标题生成改名通知：只刷新左栏会话列表，绝不清空气泡。@author aceFelix
      void conn.refreshSessions()
      break
    case 'session_ready':
      // 引擎装配完成通知：只刷新会话列表，绝不清屏。
      // 首条 send 触发 _ensure_session 发本事件，清屏语义会吞掉乐观上屏的
      // 首发用户气泡（实测：启动后首条消息只剩 AI 回复、用户气泡消失）。
      // 「清屏初始化」语义已迁移到 backendStore 连接生命周期：后端进程
      // pid 换代时清旧气泡。@author aceFelix
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
    case 'session_deleted':
      // 会话删除完成：只刷列表（删当前会话时引擎另发 session_new 清聊天区）。
      // @author aceFelix
      void conn.refreshSessions()
      break
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
      // 全双工音频通路：AI 语音帧经 talk_audio 事件回放（半双工 PyAudio 路径
      // 不会发该事件，startTalkPlayback 幂等无副作用）
      startTalkPlayback()
      break
    case 'talk_stopped':
      left.setTalkActive(false)
      left.setMode('text')
      stopTalkPlayback()
      onStatus?.({ text: '就绪', tone: 'idle' })
      break
    case 'talk_audio':
      // AI 语音帧（非空 base64）/ 打断 flush（空串，引擎 spk.stop_stream 镜像）。
      // 注意此事件频率 ~50Hz，处理路径必须轻（只做入队，不做渲染）。
      if (typeof payload === 'string') pushTalkAudio(payload)
      break
    case 'volume':
      getReactor()?.setVolume(Number(payload) || 0)
      break
    case 'user_speaking':
      getReactor()?.setUserSpeaking(!!payload)
      // 全双工打断：用户开口 → 清空 AI 播放队列（引擎同帧已在本地 flush）
      if (payload) flushTalkAudio()
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
      // 任务中心联动：简报原文上右栏；提醒触发/截止日期检查后列表有变化
      //（ fired 任务离列、days_left 更新），统一刷新。@author aceFelix
      if (kind === 'briefing') {
        useRightStore.getState().setBriefing(text)
      }
      void conn.refreshSchedule()
      logLine(`主动播报（${kind}）：${title}`)
      break
    }

    // ---- 系统指标 ----
    case 'metrics':
      useMetricsStore.getState().update((payload ?? {}) as MetricsPayload)
      break

    // ---- MCP 连接落定：刷新右栏运行健康 ----
    case 'mcp_ready': {
      // 引擎后台预热连完 MCP（约 9s）后推一次，payload 即 state.get 的 mcp 快照。
      // init 时快照常为 None（右栏显示「MCP 未启用」），本事件补刷成真实连接态。
      // 结构非法时退回主动拉一次 state.get，避免谎报。@author aceFelix
      const p = payload as Partial<McpStatus> | null
      if (p && Array.isArray(p.connected) && Array.isArray(p.failed)) {
        useRightStore
          .getState()
          .setMcp({ connected: p.connected, failed: p.failed, tools: Number(p.tools) || 0 })
      } else {
        void conn.refreshState()
      }
      break
    }

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
