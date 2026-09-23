/**
 * 后端连接 store —— 桌面壳与 jarvis serve 的连接生命周期 + 全部指令动作。
 *
 * 职责：
 * - 监听主进程 BackendStatus 推送，ready 时建立 WS 连接（token 认证）；
 * - WS 事件交给 dispatcher 消化进各 store；
 * - 组件层只调用这里的动作方法（sendMessage / selectModel / ...），
 *   不直接接触 WS 客户端。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import { Cmd, type BackendInfo, type BackendState } from '../../../shared/contracts'
import { JarvisWsClient } from '../api/ws'
import {
  asModelList,
  asSessionList,
  asVoiceList,
  dispatchServerEvent,
  type StatusLabel
} from '../api/dispatcher'
import { useChatStore } from './chatStore'
import { useLeftStore } from './leftStore'
import { useMetricsStore, type MetricsPayload } from './metricsStore'
import {
  useRightStore,
  type CostInfo,
  type DeadlineItem,
  type McpStatus,
  type ReminderItem
} from './rightStore'

/** 消息附件载荷（与 serve/server.py 入队校验同口径）：
 * - images：base64 图片块，后端转 ImageContent 走 vision；
 * - files：文本文件内容，后端拼进消息正文。
 * @author aceFelix */
export interface SendAttachments {
  images?: Array<{ data: string; media_type: string }>
  files?: Array<{ name: string; content: string }>
}

/** 连接级动作集合（dispatcher 回调依赖，避免循环引用具体 store 实现）。 */
export interface JarvisConnection {
  refreshSessions: () => Promise<void>
  refreshModels: () => Promise<void>
  refreshVoices: () => Promise<void>
  /** 右栏任务中心刷新（schedule.list → rightStore）。 */
  refreshSchedule: () => Promise<void>
  /** 右栏用量卡刷新（cost.get → rightStore）。 */
  refreshCost: () => Promise<void>
  /** 右栏运行健康刷新（state.get 的 mcp 快照 → rightStore）。 */
  refreshState: () => Promise<void>
  /** 提醒已读回执（proactive.ack）：fire-and-forget，失败静默。 */
  ackProactive: (taskId: string) => void
}

/**
 * 同 realm 存活 WS 客户端指针（globalThis 跨模块实例共享）。
 *
 * 实测出现过渲染进程同时持有两条 ESTABLISHED WS 连接、每条都把流式
 * 增量 dispatch 一遍（回复逐词重复）。store 级幂等守卫挡不住"第二个
 * 客户端创建时 store.client 恰为 null"的漏网路径，故在 realm 级再上一
 * 道保险：新连接接管前必先关闭任何仍存活的旧客户端。
 *
 * @author aceFelix
 */
function liveWsSlot(): { current: JarvisWsClient | null } {
  const realm = globalThis as typeof globalThis & { __jarvisLiveWs?: { current: JarvisWsClient | null } }
  if (!realm.__jarvisLiveWs) realm.__jarvisLiveWs = { current: null }
  return realm.__jarvisLiveWs
}

/** 渲染进程日志桥（不可用时静默降级，不影响业务）。 */
function rlog(msg: string): void {
  try {
    window.jarvisDesktop?.log?.(msg)
  } catch {
    // 忽略日志失败
  }
}

export interface BackendStoreState {
  state: BackendState
  info: BackendInfo | null
  error: string
  wsConnected: boolean
  statusLabel: StatusLabel
  client: JarvisWsClient | null

  /** 主进程状态推送入口（App 订阅 onBackendStatus 后转发进来）。 */
  applyBackendStatus: (state: BackendState, info?: BackendInfo, error?: string) => void
  /** 建立 WS 连接（幂等：已连/连接中直接返回）。 */
  connect: (info: BackendInfo) => void
  /** 主动断开（测试/重启用）。 */
  disconnect: () => void

  // ---- 指令动作（组件层入口） ----
  /** 发送消息（可带附件）：images 走 vision，files 由后端拼进正文。 */
  sendMessage: (text: string, attachments?: SendAttachments) => Promise<void>
  /** 停止当前回复（reply.abort）：busy 由服务端 assistant_done 事件收尾。 */
  abortReply: () => Promise<void>
  newSession: () => Promise<void>
  openSession: (name: string) => Promise<void>
  selectModel: (name: string) => Promise<void>
  selectVoice: (name: string) => Promise<void>
  answerUser: (text: string) => Promise<void>
  toggleTalk: () => Promise<void>
  /** 切换半双工语音（voiceActive 时发 VoiceStop，否则置 voice 模式发 VoiceStart）。 */
  toggleVoice: () => Promise<void>
  /** 打断当前语音播报/识别（voice.interrupt），不停会话。 */
  interruptVoice: () => Promise<void>
  refreshSessions: () => Promise<void>
  refreshModels: () => Promise<void>
  refreshVoices: () => Promise<void>
  refreshSchedule: () => Promise<void>
  refreshCost: () => Promise<void>
  refreshState: () => Promise<void>
  fetchMetrics: () => Promise<void>
}

export const useBackendStore = create<BackendStoreState>((set, get) => {
  /** dispatcher 用的连接门面（指向 store 自身动作）。 */
  const conn: JarvisConnection = {
    refreshSessions: () => get().refreshSessions(),
    refreshModels: () => get().refreshModels(),
    refreshVoices: () => get().refreshVoices(),
    refreshSchedule: () => get().refreshSchedule(),
    refreshCost: () => get().refreshCost(),
    refreshState: () => get().refreshState(),
    ackProactive: (taskId) => {
      // 提醒已读回执：只发不等（send），失败静默——不因回执问题把错误
      // 写进聊天流（与 runCommand 的显式指令不同，这是后台自动确认）。
      // 服务端会回 reply，但无 pending 项时 ws.handleRaw 自然丢弃。
      // @author aceFelix
      const client = get().client
      if (!client || !taskId) return
      try {
        client.send(Cmd.ProactiveAck, { task_id: taskId })
      } catch {
        // 忽略发送失败（未连接/已断开）
      }
    }
  }

  /** 发指令并检查回执；失败时把错误写进聊天流（统一错误出口）。 */
  async function runCommand(
    type: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown | null> {
    const client = get().client
    if (!client) {
      useChatStore.getState().addSystem('✗ 未连接到后端', 'error')
      return null
    }
    try {
      const reply = await client.sendCommand(type, params)
      if (!reply.ok) {
        useChatStore.getState().addSystem(`✗ ${reply.error ?? '指令失败'}`, 'error')
        return null
      }
      return reply.result ?? null
    } catch (err) {
      useChatStore
        .getState()
        .addSystem(`✗ ${err instanceof Error ? err.message : String(err)}`, 'error')
      return null
    }
  }

  return {
    state: 'idle',
    info: null,
    error: '',
    wsConnected: false,
    statusLabel: { text: '等待后端启动...', tone: 'idle' },
    client: null,

    applyBackendStatus: (state, info, error) => {
      set({ state, info: info ?? get().info, error: error ?? '' })
      if (state === 'ready' && info) {
        get().connect(info)
      } else if (state === 'error' || state === 'exited') {
        // 后端崩溃/退出：断开 WS，状态栏提示（重连由主进程重启后端驱动）
        get().disconnect()
        set({ statusLabel: { text: error ? `后端异常：${error}` : '后端已退出', tone: 'err' } })
      } else if (state === 'spawning') {
        set({ statusLabel: { text: '后端启动中...', tone: 'idle' } })
      }
    },

    connect: (info) => {
      const existing = get().client
      if (existing) return
      const client = new JarvisWsClient({
        port: info.port,
        token: info.token,
        onEvent: (msg) =>
          dispatchServerEvent(msg, conn, (label) => set({ statusLabel: label })),
        onConnectionChange: (connected) => {
          set({ wsConnected: connected })
          if (!connected) {
            set({ statusLabel: { text: '与后端断开，重连中...', tone: 'err' } })
          }
        }
      })
      // realm 级单例保险：关闭任何漏网存活旧客户端，杜绝双连接双消费
      // （流式增量被两条连接各 dispatch 一遍 → 回复逐词重复）。
      // @author aceFelix
      const slot = liveWsSlot()
      if (slot.current && slot.current !== client) {
        rlog('ws connect: kill leaked previous client')
        slot.current.close()
      }
      slot.current = client
      rlog(`ws connect port=${info.port} stack=${new Error().stack ?? ''}`)
      set({ client })
      client.connect()
    },

    disconnect: () => {
      const client = get().client
      if (client) {
        client.close()
        const slot = liveWsSlot()
        if (slot.current === client) slot.current = null
        rlog('ws disconnect')
        set({ client: null, wsConnected: false })
      }
    },

    // ---- 指令动作 ----

    sendMessage: async (text, attachments) => {
      const trimmed = text.trim()
      // 附件口径与 serve/server.py 入队校验一致：空 data/空 content 的条目不发
      const images = attachments?.images?.filter((i) => i.data) ?? []
      const files = attachments?.files?.filter((f) => f.content) ?? []
      if (!trimmed && !images.length && !files.length) return
      const chat = useChatStore.getState()
      // 气泡缩略图：base64 → data URL（仅本地展示；WS 传原始 base64 字段）
      chat.addUser(
        trimmed,
        images.length ? images.map((i) => `data:${i.media_type};base64,${i.data}`) : undefined
      )
      chat.setBusy(true)
      set({ statusLabel: { text: '思考中...', tone: 'busy' } })
      const result = await runCommand(Cmd.Message, {
        text: trimmed,
        images: images.length ? images : undefined,
        files: files.length ? files : undefined
      })
      if (result === null) {
        // 回执失败：撤销 busy（成功路径由 assistant_done 事件收尾）
        chat.setBusy(false)
        set({ statusLabel: { text: '就绪', tone: 'idle' } })
      }
    },

    abortReply: async () => {
      // 停止回复：只发指令不改 busy——引擎取消后 _handle_send 的 finally
      // 仍会发 assistant_done，由 dispatcher 统一收尾（setBusy(false)+状态栏）。
      // @author aceFelix
      set({ statusLabel: { text: '正在停止...', tone: 'busy' } })
      await runCommand(Cmd.ReplyAbort)
    },

    newSession: async () => {
      await runCommand(Cmd.SessionsNew)
    },

    openSession: async (name) => {
      await runCommand(Cmd.SessionsOpen, { name })
    },

    selectModel: async (name) => {
      const result = await runCommand(Cmd.ModelsSelect, { name })
      if (result !== null) {
        useChatStore.getState().addSystem(`模型已切换为 ${name}（下次对话生效）`)
        await get().refreshModels()
      }
    },

    selectVoice: async (name) => {
      const result = await runCommand(Cmd.VoicesSelect, { name })
      if (result !== null) {
        useChatStore.getState().addSystem(`音色已切换为 ${name}（下次语音生效）`)
        await get().refreshVoices()
      }
    },

    answerUser: async (text) => {
      useChatStore.getState().hideAskUser()
      await runCommand(Cmd.AnswerUser, { text })
    },

    toggleTalk: async () => {
      const left = useLeftStore.getState()
      if (left.talkActive) {
        await runCommand(Cmd.TalkStop)
      } else {
        left.setMode('talk')
        await runCommand(Cmd.TalkStart)
      }
    },

    toggleVoice: async () => {
      const left = useLeftStore.getState()
      if (left.voiceActive) {
        await runCommand(Cmd.VoiceStop)
      } else {
        left.setMode('voice')
        await runCommand(Cmd.VoiceStart)
      }
    },

    interruptVoice: async () => {
      await runCommand(Cmd.VoiceInterrupt)
    },

    refreshSessions: async () => {
      const result = await runCommand(Cmd.SessionsList)
      if (result !== null) useLeftStore.getState().setSessions(asSessionList(result))
    },

    refreshModels: async () => {
      const result = await runCommand(Cmd.ModelsList)
      if (result !== null) useLeftStore.getState().setModels(asModelList(result))
    },

    refreshVoices: async () => {
      const result = await runCommand(Cmd.VoicesList)
      if (result !== null) useLeftStore.getState().setVoices(asVoiceList(result))
    },

    refreshSchedule: async () => {
      // 任务中心：schedule.list → reminders/deadlines 两列表（hub 未装配时
      // 后端返回空列表，前端自然空态）。@author aceFelix
      const result = await runCommand(Cmd.ScheduleList)
      if (result !== null) {
        const r = result as { reminders?: ReminderItem[]; deadlines?: DeadlineItem[] }
        useRightStore
          .getState()
          .setSchedule(
            Array.isArray(r.reminders) ? r.reminders : [],
            Array.isArray(r.deadlines) ? r.deadlines : []
          )
      }
    },

    refreshCost: async () => {
      // 用量卡：cost.get → token 累计/轮数/消息数。@author aceFelix
      const result = await runCommand(Cmd.CostGet)
      if (result !== null) useRightStore.getState().setCost(result as CostInfo)
    },

    refreshState: async () => {
      // 运行健康：state.get 的 mcp 快照（null=MCP 未启用）。@author aceFelix
      const result = await runCommand(Cmd.StateGet)
      if (result !== null) {
        useRightStore.getState().setMcp((result as { mcp?: McpStatus | null }).mcp ?? null)
      }
    },

    fetchMetrics: async () => {
      const result = await runCommand(Cmd.MetricsGet)
      if (result !== null) {
        useMetricsStore.getState().update(result as MetricsPayload)
      }
    }
  }
})
