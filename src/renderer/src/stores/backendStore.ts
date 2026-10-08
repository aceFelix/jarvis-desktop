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
import {
  Cmd,
  parseBackendSettings,
  parseRuntimeState,
  type BackendInfo,
  type BackendSettingKey,
  type BackendSettings,
  type BackendState,
  type CheckpointPreviewResult,
  type CurrentProject,
  type ModelAddPayload,
  type ModelEditPayload,
  type PermissionMode,
  type ProjectItem,
  type SlashCommandItem,
  type ThinkingEffort,
  type VoiceAddPayload
} from '../../../shared/contracts'
import { JarvisWsClient } from '../api/ws'
import { startTalkCapture, stopTalkCapture } from '../audio/talkCapture'
import {
  asModelList,
  asSessionList,
  asVoiceList,
  dispatchServerEvent,
  type StatusLabel
} from '../api/dispatcher'
import { useChatStore } from './chatStore'
import { useLeftStore } from './leftStore'
import { useRuntimeStore } from './runtimeStore'
// 模式/思考/模型/音色动作已拆出，remote store 不再直接引用
import { useSettingsStore } from './settingsStore'
import { useMetricsStore, type MetricsPayload } from './metricsStore'
import { useSlashStore } from './slashStore'
// 资源/协同两组动作拆出动作工厂（遵守单文件 800 行上限，行为不变）。@author aceFelix
import { buildResourceActions } from './resourceActions'
import { buildRemoteActions } from './remoteActions'
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
  /** 设置面板刷新（settings.get → settingsStore.backendSettings 全量回填）。 */
  refreshSettings: () => Promise<void>
  /**
   * 项目区刷新（project.get + projects.list → leftStore）。
   * init 事件拉起一次；project_switched 事件后重拉（上一次项目会自动置顶到最近）。
   * @author aceFelix
   */
  refreshProjects: () => Promise<void>
  /** 跨设备协同连接态刷新（phone.status + wechat.status → remoteStore）。@author aceFelix */
  refreshRemote: () => Promise<void>
  /** 斜杠命令补全目录刷新（slash.commands → slashStore；init 时调一次）。@author aceFelix */
  refreshSlashCommands: () => Promise<void>
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
  /**
   * 斜杠命令透传（slash.exec，2026-10）：输入框 / 前缀命令 → 本地回显命令
   * 气泡并置 busy，执行结果由 slash_result 事件收尾渲染（命令输出卡片）。
   * @author aceFelix
   */
  execSlash: (command: string) => Promise<void>
  /**
   * 斜杠命令补全目录刷新（slash.commands，2026-10）：拉桌面可执行命令
   * 列表回填 slashStore，供输入框 / 前缀弹层补全；失败静默保留旧目录。
   * @author aceFelix
   */
  refreshSlashCommands: () => Promise<void>
  /** 停止当前回复（reply.abort）：busy 由服务端 assistant_done 事件收尾。 */
  abortReply: () => Promise<void>
  newSession: () => Promise<void>
  openSession: (name: string) => Promise<void>
  /** 会话改名（成功由 session_renamed 事件刷列表）。@author aceFelix */
  renameSession: (name: string, newName: string) => Promise<void>
  /** 会话删除（成功由 session_deleted 事件刷列表；删当前会话另收 session_new）。@author aceFelix */
  deleteSession: (name: string) => Promise<void>
  /**
   * 撤回预览（checkpoint.preview）：查“从尾部数第 userTailCount 条用户消息起撤回”
   * 会连带回滚哪些工作区文件（只读同步直返，供确认弹窗展示）。
   * 返回业务 dict（result.ok 为业务结果）；传输失败由 runCommand 弹错并回 null。
   * @author aceFelix
   */
  previewCheckpoint: (userTailCount: number) => Promise<CheckpointPreviewResult | null>
  /**
   * 撤回消息（checkpoint.rewind）：截断该用户消息起（含）的对话 + 可选回滚工作区。
   * 入队即返回，真实结果走 rewound 事件（dispatcher 据此裁气泡 + 提示）；
   * 本地不在此处裁消息（避免与事件双裁）。
   * @author aceFelix
   */
  rewindMessage: (userTailCount: number, restoreFiles: boolean) => Promise<void>
  selectModel: (name: string) => Promise<void>
  /**
   * 切换工作（权限）模式（mode.set）：成功后写 runtimeStore.permissionMode。
   * 入队即返回，引擎在当前轮结束后热重建 orchestrator（与 selectModel 同口径）。
   * @author aceFelix
   */
  setMode: (mode: PermissionMode) => Promise<void>
  /**
   * 切换思考强度（think.set）：成功后写 runtimeStore.thinkingEffort。
   * @author aceFelix
   */
  setThinking: (effort: ThinkingEffort) => Promise<void>
  /** 添加/覆盖自定义模型（左栏「添加模型」表单）；返回是否成功（失败已弹错误）。 */
  addModel: (payload: ModelAddPayload) => Promise<boolean>
  /** 修改模型配置（左栏双击模型项 → 编辑表单）；返回是否成功（失败已弹错误）。 */
  editModel: (payload: ModelEditPayload) => Promise<boolean>
  /** 删除自定义模型（左栏右键模型项 → 删除按钮）；返回是否成功（失败已弹错误）。 */
  removeModel: (name: string) => Promise<boolean>
  selectVoice: (name: string) => Promise<void>
  /** 添加/覆盖自定义音色（左栏音色表单）；返回是否成功（失败已弹错误）。@author aceFelix */
  addVoice: (payload: VoiceAddPayload) => Promise<boolean>
  /** 删除自定义音色（左栏右键自定义音色 → 删除按钮）；内置音色后端拒绝。@author aceFelix */
  deleteVoice: (name: string) => Promise<boolean>
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
  refreshSettings: () => Promise<void>
  /** 项目区刷新：拉当前项目 + 最近项目列表，回填 leftStore。@author aceFelix */
  refreshProjects: () => Promise<void>
  /**
   * 切换当前项目（左栏「打开文件夹」成功回选、或最近项目项点击）。
   * 入队即返回，引擎推 project_switched 后才真止切换；中途用
   * `pendingProjectPath` 标记「已请求、尚未落地」的中间态。
   * @author aceFelix
   */
  setProject: (path: string) => Promise<void>
  /** 从最近列表移除项目（不删磁盘目录）。成功顺带刷 refreshProjects。@author aceFelix */
  forgetProject: (path: string) => Promise<boolean>
  /** 设置面板写回单个后端联动设置项（乐观更新 + 回执失败回滚）。 */
  setBackendSetting: <K extends BackendSettingKey>(key: K, value: NonNullable<BackendSettings[K]>) => Promise<void>
  fetchMetrics: () => Promise<void>

  // ---- 跨设备协同（手机 PWA / 微信 ClawBot，2026-10）----
  /** 启动手机协同（二维码走 qrcode 事件回聊天区）。@author aceFelix */
  connectPhone: () => Promise<void>
  /** 断开手机协同。@author aceFelix */
  disconnectPhone: () => Promise<void>
  /** 启动微信扫码登录（二维码走事件、配对码走内联输入）。@author aceFelix */
  connectWechat: () => Promise<void>
  /** 断开微信连接。@author aceFelix */
  disconnectWechat: () => Promise<void>
  /** 回喂微信手机端显示的数字配对码。@author aceFelix */
  submitWechatPairing: (code: string) => Promise<void>
  /** 拉取手机/微信连接态回填 remoteStore（init 时调一次）。@author aceFelix */
  refreshRemote: () => Promise<void>
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
    refreshSettings: () => get().refreshSettings(),
    refreshProjects: () => get().refreshProjects(),
    refreshRemote: () => get().refreshRemote(),
    refreshSlashCommands: () => get().refreshSlashCommands(),
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
      const prevInfo = get().info
      set({ state, info: info ?? prevInfo, error: error ?? '' })
      if (state === 'ready' && info) {
        // 接管原 session_ready 携带的「清屏初始化」语义：后端进程换代
        // （崩溃重启，pid 变化）时清掉上一后端的旧气泡。放在 session_ready
        // 里清会吞首发用户气泡（该事件总在首轮回合中途到达）。
        // @author aceFelix
        if (prevInfo && prevInfo.pid !== info.pid) {
          useChatStore.getState().clear()
        }
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
            // 断线即释放麦克风：talk 会话随连接终止，采集线程不再有意义；
            // 重连后用户重新进入 talk（talk 激活态由 talk_stopped 复位）
            stopTalkCapture()
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
      // 新一轮开始：清除上一轮可能残留的停止闸门，恢复正常流式渲染。
      // @author aceFelix
      chat.setAborted(false)
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

    execSlash: async (command) => {
      // 斜杠命令透传（slash.exec）：引擎不会为命令回推 user_message，
      // 本地先把命令原文上屏成用户气泡，再发指令；执行结果走 slash_result
      // 事件（dispatcher 收尾 busy/状态栏）。@author aceFelix
      const text = command.trim()
      if (!text.startsWith('/')) return
      const chat = useChatStore.getState()
      chat.addUser(text)
      chat.setBusy(true)
      chat.setAborted(false)
      set({ statusLabel: { text: '执行命令...', tone: 'busy' } })
      const result = await runCommand(Cmd.SlashExec, { command: text })
      // 传输失败（null）或形态校验拒绝（ok=false，不会有 slash_result 事件）：
      // 本地就地收尾，避免卡 busy。@author aceFelix
      const r = result as { ok?: boolean; error?: string } | null
      if (r === null || (r && r.ok === false)) {
        const c = useChatStore.getState()
        c.addSlash(text, r?.error || '命令未被后端受理（连接异常）', true)
        c.setBusy(false)
        set({ statusLabel: { text: '就绪', tone: 'idle' } })
      }
    },

    abortReply: async () => {
      // 停止回复：只发指令不改 busy——引擎取消后 _handle_send 的 finally
      // 仍会发 assistant_done，由 dispatcher 统一收尾（setBusy(false)+状态栏）。
      // 同时本地立即上开停止闸门：后端取消虽即时，但取消前已经 WS 送达 /
      // 正在渲染的思考增量会被 dispatcher 丢弃，从而“点了马上就停”。
      // @author aceFelix
      useChatStore.getState().setAborted(true)
      set({ statusLabel: { text: '正在停止...', tone: 'busy' } })
      const result = await runCommand(Cmd.ReplyAbort)
      // 竞态兜底：后端回执 false 表示当时已无在跑轮次可取消（刚好卡在
      // assistant_done 已发但未送达前端的窗口），此时不会再有收尾事件，
      // 本地直接解除闸门并结束本轮，避免状态卡在“正在停止...”。
      // @author aceFelix
      if (result === false) {
        const c = useChatStore.getState()
        c.setAborted(false)
        c.finishAssistant()
        c.setBusy(false)
        set({ statusLabel: { text: '就绪', tone: 'idle' } })
      }
    },

    newSession: async () => {
      await runCommand(Cmd.SessionsNew)
    },

    openSession: async (name) => {
      await runCommand(Cmd.SessionsOpen, { name })
    },

    renameSession: async (name, newName) => {
      // 列表刷新由 session_renamed 事件驱动，这里只管指令与错误出口。
      // @author aceFelix
      await runCommand(Cmd.SessionsRename, { name, new_name: newName })
    },

    deleteSession: async (name) => {
      // 同上：session_deleted / session_new 事件驱动列表与聊天区收尾。
      // @author aceFelix
      await runCommand(Cmd.SessionsDelete, { name })
    },

    previewCheckpoint: async (userTailCount) => {
      // 只读预览：runCommand 传输失败（参数非法/未连接）已弹错并回 null；
      // 业务结果在返回 dict 的 ok（“消息数不足”等情况 ok=false，调用方展示 reason）。
      // @author aceFelix
      const result = await runCommand(Cmd.CheckpointPreview, { user_tail_count: userTailCount })
      return (result as CheckpointPreviewResult | null) ?? null
    },

    rewindMessage: async (userTailCount, restoreFiles) => {
      // 入队即返回 {ok:true,pending:true}；真实结果走 rewound 事件（dispatcher 裁气泡）。
      // 本方法只发指令：传输失败由 runCommand 弹错；不在此处动本地消息列表。
      // @author aceFelix
      await runCommand(Cmd.CheckpointRewind, {
        user_tail_count: userTailCount,
        restore_files: restoreFiles
      })
    },

    // 资源/运行时切换动作（模型 CRUD / 音色 CRUD / 模式 / 思考档位）：
    // 成块拆出 resourceActions.ts 遵守单文件 800 行上限，行为不变。
    // @author aceFelix
    ...buildResourceActions({
      runCommand,
      refreshModels: () => get().refreshModels(),
      refreshVoices: () => get().refreshVoices()
    }),

    answerUser: async (text) => {
      useChatStore.getState().hideAskUser()
      await runCommand(Cmd.AnswerUser, { text })
    },

    toggleTalk: async () => {
      const left = useLeftStore.getState()
      if (left.talkActive) {
        await runCommand(Cmd.TalkStop)
        stopTalkCapture()
      } else {
        // 全双工音频通路（2026-09-28）：渲染进程采集（浏览器 AEC）→ talk.audio
        // 帧直喂服务端 RealtimeEngine。先乐观置模式（按钮即时高亮，UI 不等
        // 麦克风授权），采集失败再回退——授权弹窗/无设备时给出明确报错。
        left.setMode('talk')
        try {
          await startTalkCapture((frame) => {
            get().client?.send(Cmd.TalkAudio, { data: frame })
          })
        } catch (err) {
          left.setMode('text')
          useChatStore
            .getState()
            .addSystem(
              `✗ 麦克风采集失败：${err instanceof Error ? err.message : String(err)}`,
              'error'
            )
          return
        }
        await runCommand(Cmd.TalkStart, { duplex: true })
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
      if (result === null) return
      const list = asSessionList(result)
      useLeftStore.getState().setSessions(list)
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
      // 运行健康 + 输入区两选择器初值：state.get 的 mcp 快照（null=MCP 未启用）
      // + permission_mode/thinking_effort/thinking_supported（runtimeStore 首屏/重连初始化）。
      // @author aceFelix
      const result = await runCommand(Cmd.StateGet)
      if (result !== null) {
        useRightStore.getState().setMcp((result as { mcp?: McpStatus | null }).mcp ?? null)
        useRuntimeStore.getState().applyRuntimeState(parseRuntimeState(result))
      }
    },

    refreshSettings: async () => {
      // 设置面板：settings.get → backendSettings 全量回填（白名单键宽容解析，
      // 类型不符/缺字段置 null 显离线态）。@author aceFelix
      const result = await runCommand(Cmd.SettingsGet)
      if (result !== null) {
        useSettingsStore.getState().applyBackendSettings(parseBackendSettings(result))
      }
    },

    // ---- 项目工作区（2026-08 新增）----
    // 设计上“一个 serve 进程同一时刻只对应一个活跃项目”，切项目 = 开新会话；
    // project.set 入队即返回，引擎内部会在当前一轮回复完后串行落地（同
    // model_switch 范式），避免在流式输出中途抽走系统提示词造成上下文错乱。
    // 前端用 pendingProjectPath 标记中间态，project_switched 事件后由 dispatcher
    // 推入左Store.currentProject 并清 pending。@author aceFelix
    refreshProjects: async () => {
      // 1) project.get → currentProject；后端返回 {workdir, name, persisted}，
      // 旧版无字段时宽容降级为 null（避免接口升级时前端 crash）。
      const cur = await runCommand(Cmd.ProjectGet)
      if (cur !== null) {
        const c = cur as Partial<CurrentProject>
        useLeftStore.getState().setCurrentProject(
          c && typeof c.workdir === 'string'
            ? { workdir: c.workdir, name: String(c.name ?? ''), persisted: !!c.persisted }
            : null
        )
      }
      // 2) projects.list → recentProjects；后端给每项附 exists 供前端置灰，
      // 非列表回包（旧版 API 降级）处理为空列表。
      const list = await runCommand(Cmd.ProjectsList)
      if (list !== null) {
        useLeftStore.getState().setRecentProjects(
          Array.isArray(list) ? (list as ProjectItem[]) : []
        )
      }
    },

    setProject: async (path) => {
      const left = useLeftStore.getState()
      // 去重：已为当前项目 或 已点选同一项 → 不发指令、不弹提示（事件已推回可收敛）。
      if (!path) return
      if (left.currentProject?.workdir === path && !left.pendingProjectPath) return
      if (left.pendingProjectPath === path) return
      // 乐观标记待生效 → 发 project.set → 回执失败则撤销标记。
      left.setPendingProjectPath(path)
      const result = await runCommand(Cmd.ProjectSet, { path })
      if (result === null) {
        useLeftStore.getState().setPendingProjectPath('')
        return
      }
      // 入队成功：当前项目信息尚未变（project_switched 才更），先刷最近列表
      // 新项目会在后端 touch_project 中自动置顶（当 handle_set_workdir 落地时）；
      // 不在此处提前拉取避免与 project_switched 后的刷新重复。
    },

    forgetProject: async (path) => {
      // 仅从 projects.toml 中移除此记录，不删磁盘目录；后端 forget_project 回 false
      // 代表“不在最近列表中”（幂等），前端当作成功处理、仅刷列表。@author aceFelix
      if (!path) return false
      const result = await runCommand(Cmd.ProjectsForget, { path })
      if (result === null) return false
      await get().refreshProjects()
      return true
    },

    setBackendSetting: async (key, value) => {
      // 乐观更新 + 失败回滚：先写本地镜像保证手感，settings.set 回执失败时
      // 恢复原值（错误文案已由 runCommand 统一写进聊天流）；从未拉取过
      // 真源（prev=null，离线/未初始化）时失败回滚到 null，避免界面谎报
      // 一个无法写回后端的设置态。@author aceFelix
      const store = useSettingsStore.getState()
      const prev = store.backendSettings[key]
      if (prev === value) return
      store.applyBackendSettings({ [key]: value } as Partial<BackendSettings>)
      const result = await runCommand(Cmd.SettingsSet, { [key]: value })
      if (result === null) {
        if (prev === null) useSettingsStore.getState().clearBackendSetting(key)
        else
          useSettingsStore
            .getState()
            .applyBackendSettings({ [key]: prev } as Partial<BackendSettings>)
      }
    },

    fetchMetrics: async () => {
      const result = await runCommand(Cmd.MetricsGet)
      if (result !== null) {
        useMetricsStore.getState().update(result as MetricsPayload)
      }
    },

    // ---- 跨设备协同（手机 / 微信）：动作成块拆出 remoteActions.ts（800 行上限）。----
    ...buildRemoteActions(runCommand),

    refreshSlashCommands: async () => {
      // 斜杠命令补全目录（slash.commands）只读刷新：不走 runCommand（那是
      // 用户显式指令的统一弹错出口），离线/拒绝/形态异常一律静默保留旧
      // 目录——补全弹层不出而已，不打扰聊天流。@author aceFelix
      const client = get().client
      if (!client) return
      try {
        const reply = await client.sendCommand(Cmd.SlashCommands, {})
        if (reply.ok && Array.isArray(reply.result)) {
          useSlashStore.getState().setCommands(reply.result as SlashCommandItem[])
        }
      } catch {
        // 忽略（保留旧目录）
      }
    }
  }
})
