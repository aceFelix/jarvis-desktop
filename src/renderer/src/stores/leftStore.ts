/**
 * 左栏数据 store —— 会话历史 / 模型 / 音色三面板 + UI 状态（活动面板、模式）。
 *
 * 数据经 WS request/response 指令拉取（sessions.list 等），
 * 切换动作发指令后本地刷新列表（与 workbench 交互口径一致）。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { VoiceState } from '../../../shared/contracts'

export interface SessionItem {
  name: string
  updated_at: number
  message_count: number
  model: string
}

export interface ModelItem {
  name: string
  vendor?: string
  desc?: string
  current?: boolean
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

  setSessions: (list: SessionItem[]) => void
  setModels: (list: ModelItem[]) => void
  setVoices: (list: VoiceItem[]) => void
  setActivePanel: (panel: LeftPanel) => void
  setMode: (mode: ChatMode) => void
  setTalkActive: (active: boolean) => void
  setVoiceActive: (active: boolean) => void
  setVoiceState: (state: VoiceState | '') => void
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

  setSessions: (sessions) => set({ sessions }),
  setModels: (models) => set({ models }),
  setVoices: (voices) => set({ voices }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setMode: (mode) => set({ mode }),
  setTalkActive: (talkActive) => set({ talkActive }),
  setVoiceActive: (voiceActive) => set({ voiceActive }),
  setVoiceState: (voiceState) => set({ voiceState })
}))
