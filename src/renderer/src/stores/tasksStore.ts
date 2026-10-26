/**
 * 任务中心（阶段 10 · W3）状态 store —— 右栏「任务中心」两个新区块的数据与交互态。
 *
 * 职责边界（aceFelix，2026-10）：本 store 只装**后端快照 + 面板交互态**，不装业务
 * 规则：台账/账本的语义全在 jarvis 侧 `core/tasks/spine_ops.py` 与
 * `core/actions/journal.py`，动作层（`taskActions.ts`）只做参数搬运。刷新时机由
 * dispatcher（`proactive_notify` 的 `kind=task`）与面板自身的挂载/按钮触发。
 *
 * 为什么不塞进 `rightStore`：rightStore 是「只读展示型」快照（提醒/截止/用量/健康），
 * 而任务中心带**写操作与两拍确认**——把确认态混进去会让「谁能动台账」这条线索散在
 * 两个 store 里，撤销类误操作的排查成本正好集中在这里。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type {
  ActionsSnapshot,
  EffectRecordInfo,
  SpineGoal,
  TasksSnapshot,
  UndoFileChange
} from '../../../shared/tasks-contracts'

/** 需要第二拍确认的动作种类（各面板只处理自己那一种）。 */
export type ConfirmKind = 'delete-goal' | 'undo-record' | 'undo-task'

/**
 * 两拍确认的第一拍结果（后端 `need_confirm=true` 时摊给用户看的影响面）。
 *
 * 刻意只存展示要用的字段：第二拍靠 `kind` + `id` 重发，不复用第一拍的回执，
 * 免得面板拿着旧快照盖掉后端已经变化的状态。
 */
export interface ConfirmRequest {
  kind: ConfirmKind
  /** 目标 id（delete-goal / undo-task）或账本记录 id（undo-record）。 */
  id: string
  /** 一行标题：让用户看清"要动的到底是哪一个"。 */
  title: string
  /** undo（整轮回滚）的文件影响面。 */
  files?: UndoFileChange[]
  /** undo 的"检查点后新建文件将被删除"计数。 */
  untrackedCount?: number
  /** 后端原样提醒（整轮粒度那句必须显示，不能省）。 */
  hint?: string
  /** undo-task 第一拍的记录清单。 */
  records?: EffectRecordInfo[]
  /** delete 第一拍带回的目标明细。 */
  goal?: SpineGoal
}

/** 面板归属：两个区块共用一份 notice 态，靠它判定谁该显示（同一条文案不画两遍）。 */
export type NoticePanel = 'spine' | 'journal'

/** 面板内联反馈（成功/失败都显示在面板里，绝不写进聊天流）。 */
export interface TaskNotice {
  text: string
  tone: 'ok' | 'warn'
  /** 该反馈属于哪个区块。 */
  panel: NoticePanel
}

export interface TasksState {
  /** 最近一次 tasks.exec 快照（null = 还没拉到/未连接）。 */
  tasks: TasksSnapshot | null
  /** 最近一次 actions.exec 快照。 */
  actions: ActionsSnapshot | null
  /** 任一动作在途（两个区块的按钮一起置灰，避免连点成重复提交）。 */
  busy: boolean
  notice: TaskNotice | null
  confirm: ConfirmRequest | null

  setTasks: (snapshot: TasksSnapshot | null) => void
  setActions: (snapshot: ActionsSnapshot | null) => void
  setBusy: (busy: boolean) => void
  setNotice: (notice: TaskNotice | null) => void
  setConfirm: (confirm: ConfirmRequest | null) => void
  /** 断开连接或后端重启时清空：留着旧台账显示会诱导用户对不存在的目标操作。 */
  resetAll: () => void
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: null,
  actions: null,
  busy: false,
  notice: null,
  confirm: null,

  setTasks: (snapshot) => set({ tasks: snapshot }),
  setActions: (snapshot) => set({ actions: snapshot }),
  setBusy: (busy) => set({ busy }),
  setNotice: (notice) => set({ notice }),
  setConfirm: (confirm) => set({ confirm }),
  resetAll: () => set({ tasks: null, actions: null, notice: null, confirm: null, busy: false })
}))
