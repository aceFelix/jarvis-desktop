/**
 * 运行时输入态 store —— 工作（权限）模式 + 思考强度（桌面输入区两个选择器）。
 *
 * 职责单一：只承载「当前选择」，不与 chatStore/leftStore 混杂。
 * - 初值由 backendStore.refreshState（state.get）经 applyRuntimeState 回填
 *  （首屏与重连各一次）；
 * - setMode/setThinking 由 backendStore 的动作在指令成功落地后写入（乐观口径
 *  与 selectModel 类似：切换下轮生效，符合引擎指令队列语义）；
 * - thinkingSupported 为空表示当前厂商不支持思考控制，选择器据此置灰。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { PermissionMode, ThinkingEffort, RuntimeStateSnapshot } from '../../../shared/contracts'

interface RuntimeState {
  /** 当前工作（权限）模式。 */
  permissionMode: PermissionMode
  /** 当前思考强度档位。 */
  thinkingEffort: ThinkingEffort
  /** 当前厂商可选档位（空=不支持思考，选择器置灰）。 */
  thinkingSupported: ThinkingEffort[]
  /** state.get 回执整体回填（首屏/重连初始化）。 */
  applyRuntimeState: (snapshot: RuntimeStateSnapshot) => void
  /** 仅写模式（setMode 指令成功后调用）。 */
  setMode: (mode: PermissionMode) => void
  /** 仅写思考档位（setThinking 指令成功后调用）。 */
  setThinking: (effort: ThinkingEffort) => void
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  permissionMode: 'default',
  thinkingEffort: 'off',
  thinkingSupported: [],
  applyRuntimeState: (snapshot) =>
    set({
      permissionMode: snapshot.permissionMode,
      thinkingEffort: snapshot.thinkingEffort,
      thinkingSupported: snapshot.thinkingSupported
    }),
  setMode: (mode) => set({ permissionMode: mode }),
  setThinking: (effort) => set({ thinkingEffort: effort })
}))
