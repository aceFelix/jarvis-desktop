/**
 * 左栏资源与运行时切换动作（自 backendStore 拆出，2026-10）。
 *
 * 拆分动机：backendStore 承载「连接生命周期 + 全部指令动作」已超单文件
 * 800 行上限，按 code-structure 规则把成块的资源管理动作（模型 CRUD /
 * 音色 CRUD / 权限模式 / 思考档位）外移为动作工厂——行为、口径、注释
 * 与原实现完全一致；runCommand 与列表刷新经依赖注入，避免模块间环引用。
 *
 * @author aceFelix
 */

import {
  Cmd,
  type ModelAddPayload,
  type ModelEditPayload,
  type PermissionMode,
  type ThinkingEffort,
  type VoiceAddPayload,
  type VoiceSelectResult
} from '../../../shared/contracts'
import { useChatStore } from './chatStore'
import { useLeftStore } from './leftStore'
import { useRuntimeStore } from './runtimeStore'

/** backendStore.runCommand 的依赖签名（发指令查回执，失败写聊天流回 null）。 */
export type RunCommand = (type: string, params?: Record<string, unknown>) => Promise<unknown | null>

/** 拆出的动作集合（与 BackendStoreState 中同名成员签名一致，store 侧展开合并）。 */
export interface ResourceActions {
  selectModel: (name: string) => Promise<void>
  setMode: (mode: PermissionMode) => Promise<void>
  setThinking: (effort: ThinkingEffort) => Promise<void>
  addModel: (payload: ModelAddPayload) => Promise<boolean>
  editModel: (payload: ModelEditPayload) => Promise<boolean>
  removeModel: (name: string) => Promise<boolean>
  selectVoice: (name: string) => Promise<void>
  addVoice: (payload: VoiceAddPayload) => Promise<boolean>
  deleteVoice: (name: string) => Promise<boolean>
}

/** 组装资源动作：注入 runCommand 与模型/音色列表刷新（仍归 backendStore 的 refresh*）。 */
export function buildResourceActions(deps: {
  runCommand: RunCommand
  refreshModels: () => Promise<void>
  refreshVoices: () => Promise<void>
}): ResourceActions {
  const { runCommand } = deps
  return {
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
      await deps.refreshModels()
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
      await deps.refreshModels()
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
      await deps.refreshModels()
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
      await deps.refreshModels()
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
      await deps.refreshVoices()
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
      await deps.refreshVoices()
      return true
    },

    deleteVoice: async (name) => {
      // 左栏右键自定义音色 → 删除按钮：仅自定义音色可删（内置音色由后端
      // 拒绝弹错）。删的是当前在用音色仍允许（[tts] voice 不变，下次合成
      // 照旧，与模型面板删当前模型同口径）。@author aceFelix
      const result = await runCommand(Cmd.VoicesDelete, { name })
      if (result === null) return false
      useChatStore.getState().addSystem(`音色「${name}」已删除`)
      await deps.refreshVoices()
      return true
    }
  }
}
