/**
 * 任务中心（阶段 10 · W3）动作 —— 桌面右栏「任务中心」面板的 `tasks.exec` /
 * `actions.exec` 调用层。
 *
 * 为什么拆成动作工厂（aceFelix，2026-10）：`backendStore.ts` 已近 800 行上限，
 * 资源/协同/扩展/感知四组动作都是这么拆出去的，本组照同一范式接入（只注入一个
 * client 取值器，不依赖其他 store）。
 *
 * 收发口径与 perceptActions 完全一致：用 `client.sendCommand` **直取回执**，不走
 * runCommand —— 面板里的错误要在面板里内联显示，不该写进聊天流。未连后端时读回
 * null、写回 `{ok:false}`，面板据此显离线态而不是抛异常。
 *
 * 三条安全口径（与后端 rpc_tasks.py 同源，别在面板里绕过）：
 * 1. **两拍动作**（`undo` / `undo_task` / `delete`）第一拍不带 confirm，只拿影响面；
 *    面板把 preview 摊开后由用户点「确认」再发第二拍。本层不自动补 confirm，
 *    把两拍合成一拍等于跳过用户。
 * 2. `cancel_hold` 撤的是还没执行的预约，一拍落手，不需要确认。
 * 3. `approve`（批准重试）一拍：点按钮本身就是表态，后端会顺带签一条**只限本步被拒
 *    工具 + 本目标目录 + 30 分钟**的租约，回执 message 里写清了放行范围，必须原样显示。
 *
 * @author aceFelix
 */

import { Cmd } from '../../../shared/contracts'
import {
  parseActionsSnapshot,
  parseTasksSnapshot,
  type ActionsSnapshot,
  type SpineGoal,
  type TaskOpResult,
  type TasksSnapshot
} from '../../../shared/tasks-contracts'
import { useTasksStore } from './tasksStore'
import type { JarvisWsClient } from '../api/ws'

/** 建目标入参（与后端 tasks.exec create 的字段同形，省略即不传）。 */
export interface CreateGoalPayload {
  /** 目标文本；写成「目标; 步骤一; 步骤二」即多步（分号分隔，与终端 /tasks add 同口径）。 */
  goal: string
  steps?: string[]
  /** 等待条件：字符串写法（"file_exists=path" / "time=2026-10-22T18:00"）或结构化对象。 */
  wait?: string | Record<string, unknown>
}

/** 目标管控动词（pause/resume/cancel/advance 一拍落手；delete 走两拍）。 */
export type GoalControlAction = 'pause' | 'resume' | 'cancel' | 'advance'

/** 拆出的任务中心动作集合（与 BackendStoreState 中同名成员签名一致）。 */
export interface TaskActions {
  /**
   * 拉目标台账快照（tasks.exec status）。
   *
   * @param limit 活跃目标条数上限（省略按后端默认 20）。
   * @returns 快照；未连后端或回执失败返回 null（面板保留旧数据或显离线态）。
   */
  fetchTasks: (limit?: number) => Promise<TasksSnapshot | null>
  /**
   * 拉副作用账本快照（actions.exec status）。
   *
   * 账本未启用时后端照样回快照（`enabled=false` + 一句说明），面板显示「未启用」
   * 而不是报错——这条底线与 percept.status.get 相同。
   */
  fetchActions: (limit?: number) => Promise<ActionsSnapshot | null>
  /** tasks.exec create：建一个目标（回执带结构化 goal，不靠文案截 id）。 */
  createGoal: (payload: CreateGoalPayload) => Promise<TaskOpResult<TasksSnapshot | null>>
  /** tasks.exec pause|resume|cancel|advance：目标级管控。 */
  controlGoal: (action: GoalControlAction, goalId: string) => Promise<TaskOpResult<TasksSnapshot | null>>
  /**
   * tasks.exec delete：删目标（**两拍**）。
   *
   * @param confirm false = 只取影响面预览（need_confirm=true，未落手）。
   */
  deleteGoal: (goalId: string, confirm: boolean) => Promise<TaskOpResult<TasksSnapshot | null>>
  /**
   * tasks.exec approve：批准一个等授权的步骤并让它重试。
   *
   * 后端会按本步记录的 `denied_tools` 签发限定范围的租约；`denied_tools` 为空时
   * 后端**拒绝放行**并给出原因，面板应据此禁用按钮而不是点了拿错。
   *
   * @param minutes 租约时长（分钟），省略用后端默认（30）。
   */
  approveStep: (
    goalId: string,
    stepId: string,
    minutes?: number
  ) => Promise<TaskOpResult<TasksSnapshot | null>>
  /** actions.exec cancel_hold：撤回仍在延时窗口里的预约（一拍，不需确认）。 */
  cancelHold: (recordId: string) => Promise<TaskOpResult<ActionsSnapshot | null>>
  /**
   * actions.exec undo：撤销一条已执行的副作用（**两拍**，粒度是整轮）。
   *
   * @param confirm false = 只取影响面（files / untracked_count / hint）。
   */
  undoRecord: (recordId: string, confirm: boolean) => Promise<TaskOpResult<ActionsSnapshot | null>>
  /**
   * actions.exec undo_task：按目标批量撤销（**两拍**，逐项报「撤了 / 撤不动 + 原因」）。
   */
  undoTask: (goalId: string, confirm: boolean) => Promise<TaskOpResult<ActionsSnapshot | null>>
  /**
   * 刷新任务中心两份快照（tasks.exec status + actions.exec status → tasksStore）。
   *
   * 口径同 `refreshRemote`（动作工厂直接回填自己的 store，面板只订阅 store）：
   * init 事件、`kind=task` 主动播报、面板自身挂载与刷新按钮都走这一个入口，
   * 「谁动了台账显示」这条线索只有一处。拉取失败**保留旧快照**（不抹成 null），
   * 清空只在断开时由 `tasksStore.resetAll()` 做——一次性动作失败不该让整块面板变空。
   */
  refreshTasks: () => Promise<void>
}

/** 组装任务中心动作：注入 client 取值器（避免模块环引用）。 */
export function buildTaskActions(getClient: () => JarvisWsClient | null): TaskActions {
  /** 读侧统一封装：失败一律回 null，面板自己决定显什么。 */
  const readOnce = async <T>(
    cmd: string,
    payload: Record<string, unknown>,
    parse: (raw: unknown) => T
  ): Promise<T | null> => {
    const client = getClient()
    if (!client) return null
    try {
      const reply = await client.sendCommand(cmd, payload)
      if (!reply.ok) return null
      return parse(reply.result)
    } catch {
      return null
    }
  }

  /** 写侧统一封装：业务成败取「传输 ok AND 业务 ok」，文案取后端 message。 */
  const opOnce = async <T>(
    cmd: string,
    payload: Record<string, unknown>,
    parse: (raw: unknown) => T
  ): Promise<TaskOpResult<T | null>> => {
    const client = getClient()
    if (!client) return { ok: false, message: '未连接到后端', snapshot: null }
    try {
      const reply = await client.sendCommand(cmd, payload)
      if (!reply.ok) return { ok: false, message: reply.error || '指令未被受理', snapshot: null }
      const data = parse(reply.result) as T & { ok: boolean; message: string; need_confirm?: boolean }
      return {
        ok: data.ok === true,
        message: data.message || '',
        snapshot: data,
        need_confirm: data.need_confirm === true
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), snapshot: null }
    }
  }

  const tasksOp = (payload: Record<string, unknown>) =>
    opOnce(Cmd.TasksExec, payload, parseTasksSnapshot)

  const actionsOp = (payload: Record<string, unknown>) =>
    opOnce(Cmd.ActionsExec, payload, parseActionsSnapshot)

  return {
    fetchTasks: (limit?: number) =>
      readOnce(Cmd.TasksExec, limit ? { action: 'status', limit } : { action: 'status' }, parseTasksSnapshot),

    fetchActions: (limit?: number) =>
      readOnce(Cmd.ActionsExec, limit ? { action: 'status', limit } : { action: 'status' }, parseActionsSnapshot),

    createGoal: (payload) => {
      const body: Record<string, unknown> = { action: 'create', goal: payload.goal }
      if (payload.steps?.length) body.steps = payload.steps
      if (payload.wait) body.wait = payload.wait
      return tasksOp(body)
    },

    controlGoal: (action, goalId) => tasksOp({ action, goal_id: goalId }),

    deleteGoal: (goalId, confirm) =>
      tasksOp(confirm ? { action: 'delete', goal_id: goalId, confirm: true } : { action: 'delete', goal_id: goalId }),

    approveStep: (goalId, stepId, minutes?) => {
      const body: Record<string, unknown> = { action: 'approve', goal_id: goalId, step_id: stepId }
      if (typeof minutes === 'number' && minutes > 0) body.minutes = Math.trunc(minutes)
      return tasksOp(body)
    },

    cancelHold: (recordId) => actionsOp({ action: 'cancel_hold', id: recordId }),

    undoRecord: (recordId, confirm) =>
      actionsOp(
        confirm ? { action: 'undo', id: recordId, confirm: true } : { action: 'undo', id: recordId }
      ),

    undoTask: (goalId, confirm) =>
      actionsOp(
        confirm
          ? { action: 'undo_task', goal_id: goalId, confirm: true }
          : { action: 'undo_task', goal_id: goalId }
      ),

    refreshTasks: async () => {
      // 并发拉两份快照：台账与账本是两套存储，串行会白等一个往返。
      // 未连接时 readOnce 回 null，这里直接返回，面板显离线态而不是报错。
      const client = getClient()
      if (!client) return
      const [tasks, actions] = await Promise.all([
        readOnce(Cmd.TasksExec, { action: 'status' }, parseTasksSnapshot),
        readOnce(Cmd.ActionsExec, { action: 'status' }, parseActionsSnapshot)
      ])
      const store = useTasksStore.getState()
      if (tasks) store.setTasks(tasks)
      if (actions) store.setActions(actions)
    }
  }
}

/** 目标是否处于「等用户授权」状态（面板据此才画批准按钮）。 */
export function goalAwaitingApproval(goal: SpineGoal): boolean {
  const step = goal.current_step
  return !!step && step.state === 'blocked' && step.block_reason === 'approval'
}
