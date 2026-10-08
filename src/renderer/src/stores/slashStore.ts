/**
 * 斜杠命令补全目录 store（slash.commands，2026-10）。
 *
 * 职责单一：只承载「桌面可执行的斜杠命令列表」，供输入框 / 前缀弹层补全
 * 消费。数据源为后端 slash_bridge.build_desktop_commands（白名单透传 /
 * 原生控件 / 已安装技能三类），由 backendStore.refreshSlashCommands 在
 * init 事件时刷新（首屏与重连各一次）；技能随 workdir 安装/卸载变化，
 * 每次 init 重拉保持目录新鲜。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { SlashCommandItem } from '../../../shared/contracts'

interface SlashState {
  /** 补全目录（slash.commands RPC 回执；未就绪时为空数组=不弹补全）。 */
  commands: SlashCommandItem[]
  /** 全量回填命令目录（refreshSlashCommands 成功回执时调用）。 */
  setCommands: (commands: SlashCommandItem[]) => void
}

export const useSlashStore = create<SlashState>((set) => ({
  commands: [],
  setCommands: (commands) => set({ commands })
}))
