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
  type CurrentProject,
  type ModelAddPayload,
  type ModelEditPayload,
  type PermissionMode,
  type ProjectItem,
  type ThinkingEffort,
  type VoiceAddPayload,
  type VoiceSelectResult
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
import { useRemoteStore } from './remoteStore'
import { useSettingsStore } from './settingsStore'
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
  /** 会话改名（成功由 session_renamed 事件刷列表）。@author aceFelix */
  renameSession: (name: string, newName: string) => Promise<void>
  /** 会话删除（成功由 session_deleted 事件刷列表；删当前会话另收 session_new）。@author aceFelix */
  deleteSession: (name: string) => Promise<void>
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
        // 里清会吞首发用户气泡（该事件总在首轮回合中途到达）。@author aceFelix
        if (prevInfo && prevInfo.pid !== info.pid) useChatStore.getState().clear()
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

    selectModel: async (name) => {
      const left = useLeftStore.getState()
      // 已是当前模型 / 已点选同一模型：不发指令、不重复提示（列表标记已表明选择被接受）。
      // @author aceFelix
      if (name === left.pendingModel) return
      if (left.models.some((m) => m.name === name && m.current)) return
      // 乐观标记「待生效」：写盘成功后引擎会在指令队列里热切换运行中的模型，
      // 落地后推 model_switched（本事件清标记 + 刷列表让「当前」移动）；
      // 先标记后发指令，免得事件比回执先到时标记残留。切换成功的气泡由
      // 引擎的 info 事件上屏，这里不重复提示。@author aceFelix
      left.setPendingModel(name)
      const result = await runCommand(Cmd.ModelsSelect, { name })
      if (result !== true) {
        // 回执 ok=false（runCommand 已写错误）或写盘失败：撤销标记，用户可重试
        useLeftStore.getState().setPendingModel('')
        if (result === false) {
          useChatStore
            .getState()
            .addSystem(`✗ 模型切换失败（未能写入用户级配置）：${name}`, 'error')
        }
        return
      }
      // 列表此刻仍标旧模型为 current：切换落地后由 model_switched 再刷一次
      await get().refreshModels()
    },

    setMode: async (mode) => {
      // 工作（权限）模式切换：入队即返回，业务结果在 result.ok（mode.set 回执 dict）。
      // 成功后写 runtimeStore（下轮生效，引擎队列串行）；失败由 runCommand 统一弹错。
      // @author aceFelix
      const cur = useRuntimeStore.getState().permissionMode
      if (cur === mode) return
      const result = await runCommand(Cmd.ModeSet, { mode })
      if (result === null) return
      const res = result as { ok?: boolean; error?: string }
      if (!res?.ok) {
        useChatStore.getState().addSystem(`✗ 模式切换失败：${res?.error ?? mode}`, 'error')
        return
      }
      useRuntimeStore.getState().setMode(mode)
    },

    setThinking: async (effort) => {
      // 思考强度切换：同 setMode 口径（result.ok 为业务结果）。
      // @author aceFelix
      const cur = useRuntimeStore.getState().thinkingEffort
      if (cur === effort) return
      const result = await runCommand(Cmd.ThinkSet, { effort })
      if (result === null) return
      const res = result as { ok?: boolean; error?: string }
      if (!res?.ok) {
        useChatStore.getState().addSystem(`✗ 思考档位切换失败：${res?.error ?? effort}`, 'error')
        return
      }
      useRuntimeStore.getState().setThinking(effort)
    },

    addModel: async (payload) => {
      // 左栏「添加模型」表单提交：后端校验 + 写盘 + 内存同步，成功后刷模型列表；
      // 失败由 runCommand 统一弹错误并回 false（表单保持打开，用户可修正重试）。
      // @author aceFelix
      const result = await runCommand(Cmd.ModelsAdd, { ...payload })
      if (result === null) return false
      const info = result as { name?: string }
      useChatStore
        .getState()
        .addSystem(`模型「${info.name ?? payload.name}」已添加，点击列表项可切换`)
      await get().refreshModels()
      return true
    },

    editModel: async (payload) => {
      // 左栏双击模型项 → 编辑表单提交：后端按新配置写盘 + 同步内存；改的是
      // 当前运行模型时还会强制热切换 provider（回执 hot_switched），端点/接口
      // 类型改动立即生效。刷列表让名字/厂商/端点收敛。@author aceFelix
      const result = await runCommand(Cmd.ModelsEdit, { ...payload })
      if (result === null) return false
      const info = result as { name?: string; hot_switched?: boolean }
      const target = info.name ?? payload.name
      useChatStore
        .getState()
        .addSystem(
          info.hot_switched
            ? `模型「${target}」配置已更新，当前会话已按新配置重连`
            : `模型「${target}」配置已更新`
        )
      await get().refreshModels()
      return true
    },

    removeModel: async (name) => {
      // 左栏右键模型项 → 删除按钮：仅自定义模型可删（内置模型由后端拒绝）。
      // 删的是当前运行模型时后端回报 was_current（不动运行中的 provider，
      // 不打断正在跑的回复），这里提示用户另选。@author aceFelix
      const result = await runCommand(Cmd.ModelsRemove, { name })
      if (result === null) return false
      const info = result as { was_current?: boolean }
      useChatStore
        .getState()
        .addSystem(
          info.was_current
            ? `模型「${name}」已删除，当前会话仍在用它，建议另选一个模型`
            : `模型「${name}」已删除`
        )
      await get().refreshModels()
      return true
    },

    selectVoice: async (name) => {
      // 去重与失败判定同 selectModel；2026-09-28 音色-模型适配后回执升级为
      // dict：业务结果在 result.ok（传输层失败 runCommand 已回 null 并弹错），
      // linked_model 非空 = 后端联动换了 TTS 模型，提示里明示口径。
      // @author aceFelix
      const left = useLeftStore.getState()
      if (name === left.pendingVoice) return
      const result = await runCommand(Cmd.VoicesSelect, { name })
      if (result === null) return
      const res = result as VoiceSelectResult
      if (!res?.ok) {
        useChatStore.getState().addSystem(`✗ 音色切换失败：${res?.error ?? name}`, 'error')
        return
      }
      left.setPendingVoice(res.name ?? name)
      useChatStore
        .getState()
        .addSystem(
          res.linked_model
            ? `音色已切换为 ${res.name ?? name}（联动 TTS 模型 ${res.linked_model}，下次语音生效）`
            : `音色已切换为 ${res.name ?? name}（下次语音生效）`
        )
      await get().refreshVoices()
    },

    addVoice: async (payload) => {
      // 左栏音色表单提交：后端校验 + 写盘 + 内存同步（同名 upsert=编辑），
      // 成功后刷音色列表；失败由 runCommand 统一弹错误并回 null（表单保持
      // 打开，用户可修正重试）。@author aceFelix
      const result = await runCommand(Cmd.VoicesAdd, { ...payload })
      if (result === null) return false
      const info = result as { name?: string }
      useChatStore
        .getState()
        .addSystem(`音色「${info.name ?? payload.name}」已保存，点击列表项可切换`)
      await get().refreshVoices()
      return true
    },

    deleteVoice: async (name) => {
      // 左栏右键自定义音色 → 删除按钮：仅自定义音色可删（内置音色由后端
      // 拒绝弹错）。删的是当前在用音色仍允许（[tts] voice 不变，下次合成
      // 照旧，与模型面板删当前模型同口径）。@author aceFelix
      const result = await runCommand(Cmd.VoicesDelete, { name })
      if (result === null) return false
      useChatStore.getState().addSystem(`音色「${name}」已删除`)
      await get().refreshVoices()
      return true
    },

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

    // ---- 跨设备协同（手机 / 微信）----
    connectPhone: async () => {
      // 入队即返回：真正的 ensure_session + 起桥接在引擎串行落地，
      // 完成后推 qrcode / remote_state 事件。失败由 runCommand 统一弹错。
      // @author aceFelix
      await runCommand(Cmd.PhoneConnect)
    },

    disconnectPhone: async () => {
      await runCommand(Cmd.PhoneDisconnect)
    },

    connectWechat: async () => {
      await runCommand(Cmd.WechatConnect)
    },

    disconnectWechat: async () => {
      await runCommand(Cmd.WechatDisconnect)
    },

    submitWechatPairing: async (code) => {
      // 微信配对码：回喂引擎 login 线程阻塞等待的队列（终端是 input()）。
      // @author aceFelix
      await runCommand(Cmd.WechatPairing, { code })
    },

    refreshRemote: async () => {
      // 重开/重连桌面时回填连接态（二维码卡片不回放，仅按钮态需准确）。
      // @author aceFelix
      const phone = await runCommand(Cmd.PhoneStatus)
      if (phone !== null) {
        useRemoteStore.getState().setPhone(!!(phone as { active?: boolean }).active)
      }
      const wechat = await runCommand(Cmd.WechatStatus)
      if (wechat !== null) {
        useRemoteStore.getState().setWechat(!!(wechat as { connected?: boolean }).connected)
      }
    }
  }
})
