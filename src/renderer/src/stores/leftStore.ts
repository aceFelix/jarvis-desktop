/**
 * 左栏数据 store —— 会话历史 / 模型 / 音色三面板 + UI 状态（活动面板、模式）。
 *
 * 数据经 WS request/response 指令拉取（sessions.list 等），
 * 切换动作发指令后本地刷新列表（与 workbench 交互口径一致）。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { ModelConfigDraft, VoiceState } from '../../../shared/contracts'

export interface SessionItem {
  name: string
  updated_at: number
  message_count: number
  model: string
  /** 是否引擎当前会话（后端 sessions.list 现比标记，左栏选中态数据源）。 */
  current?: boolean
}

export interface ModelItem {
  name: string
  vendor?: string
  desc?: string
  current?: boolean
  /** builtin=内置模型（[llm.models]）/ custom=用户添加（[llm.custom_models]）。 */
  source?: 'builtin' | 'custom' | string
  /** 是否可改配置（两类都可：内置模型改的是用户级覆盖配置）。 */
  editable?: boolean
  /** 是否可删（仅自定义模型；内置模型右键不显示删除按钮）。 */
  removable?: boolean
  /** 编辑表单默认值（双击模型项进编辑时预填；明文密钥不回传）。 */
  config?: ModelConfigDraft
}

export interface VoiceItem {
  name: string
  description?: string
  current?: boolean
}

/** 左栏活动面板。 */
export type LeftPanel = 'history' | 'model' | 'voice'

/** 对话模式：文本 / 实时语音 / 半双工语音。 */
export type ChatMode = 'text' | 'talk' | 'voice'

export interface LeftState {
  sessions: SessionItem[]
  models: ModelItem[]
  voices: VoiceItem[]
  activePanel: LeftPanel
  mode: ChatMode
  talkActive: boolean
  /** 半双工语音会话是否运行中（voice_started/stopped 驱动）。 */
  voiceActive: boolean
  /** 当前语音阶段（voice_state 驱动，''=无）；ChatArea 状态条文案据此渲染。 */
  voiceState: VoiceState | ''
  /** 左栏模型面板视图：true=模型表单（ModelForm 组件整体替换列表）。
   *  与右栏 uiStore 的设置面板同模式：独立组件 + 条件渲染，提交/取消后回列表。
   *  @author aceFelix */
  modelFormOpen: boolean
  /** 表单模式：''=添加新模型（models.add）；非空=编辑该模型的配置
   *  （models.edit，双击模型项进入）。@author aceFelix */
  modelFormTarget: string
  /** 已点选、待引擎落地热切换的模型名（''=无）。
   *
   * 桌面壳 models.select 写盘后由引擎在指令队列里热切换运行中的模型，落地推
   * model_switched 事件；本字段标记「已请求、还没落地」的中间态（正有一轮回复
   * 在跑时切换在该轮结束后生效），列表项据此显「待生效」并抑制重复点选。
   * 事件到达后由 dispatcher 清空。@author aceFelix */
  pendingModel: string
  /** 已点选、待下次语音会话生效的 TTS 音色名（''=无，口径同 pendingModel）。 */
  pendingVoice: string

  setSessions: (list: SessionItem[]) => void
  setModels: (list: ModelItem[]) => void
  setVoices: (list: VoiceItem[]) => void
  setActivePanel: (panel: LeftPanel) => void
  setMode: (mode: ChatMode) => void
  setTalkActive: (active: boolean) => void
  setVoiceActive: (active: boolean) => void
  setVoiceState: (state: VoiceState | '') => void
  /** 记录/清空待生效模型：点选时由 selectModel 乐观标记，引擎 model_switched 落地后清空。 */
  setPendingModel: (name: string) => void
  /** 记录/清空待生效音色（口径同 setPendingModel）。 */
  setPendingVoice: (name: string) => void
  /** 模型列表末项「添加模型」：进入表单。 */
  openModelForm: () => void
  /** 双击模型项：进入该模型的配置编辑表单（target 非空，表单据此预填）。 */
  editModelForm: (name: string) => void
  /** 表单返回/提交成功：回模型列表（同时清空编辑目标）。 */
  closeModelForm: () => void
}

export const useLeftStore = create<LeftState>((set) => ({
  sessions: [],
  models: [],
  voices: [],
  activePanel: 'history',
  mode: 'text',
  talkActive: false,
  voiceActive: false,
  voiceState: '',
  modelFormOpen: false,
  modelFormTarget: '',
  pendingModel: '',
  pendingVoice: '',

  setSessions: (sessions) => set({ sessions }),
  setModels: (models) => set({ models }),
  setVoices: (voices) => set({ voices }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setMode: (mode) => set({ mode }),
  setTalkActive: (talkActive) => set({ talkActive }),
  setVoiceActive: (voiceActive) => set({ voiceActive }),
  setVoiceState: (voiceState) => set({ voiceState }),
  setPendingModel: (pendingModel) => set({ pendingModel }),
  setPendingVoice: (pendingVoice) => set({ pendingVoice }),
  openModelForm: () => set({ modelFormOpen: true, modelFormTarget: '' }),
  editModelForm: (modelFormTarget) => set({ modelFormOpen: true, modelFormTarget }),
  closeModelForm: () => set({ modelFormOpen: false, modelFormTarget: '' })
}))
