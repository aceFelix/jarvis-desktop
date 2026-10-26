/**
 * 任务中心（阶段 10 · W3）文案 —— 从 `i18n.ts` 拆出的业务域词条。
 *
 * 为什么单独成文件（aceFelix，2026-10）：`i18n.ts` 已近 800 行上限，而右栏「任务
 * 中心」两个新区块（跨会话目标 + 副作用账本）词条面很宽。拆的是**业务域**不是
 * 语言：同一批键的中英文仍在一个文件里相邻，先例见 `i18n-butler.ts`。
 *
 * 口径提示：撤销类文案要如实表达「整轮粒度」和「撤不回」，不写「已恢复」「放心点」
 * 这类给不出保证的安慰话——面板说的每句话用户都会当真。
 *
 * @author aceFelix
 */

type Dict = Record<string, string>

/** 中文 · 任务中心（跨会话目标台账 + 副作用账本）。 */
export const zhTasks: Dict = {
  // ---- 区块小标题 ----
  'tasks.spine.head': '跨会话目标',
  'tasks.journal.head': '副作用账本',

  // ---- 驱动器状态（线程在跑 ≠ 配置开启，两条口径分开说）----
  'tasks.driverOn': '驱动器在盯',
  'tasks.driverOff': '驱动器未起：目标建了也不会自己往下走（需开 [tasks] enabled 并配好凭据）',
  'tasks.configOff': '配置里 [tasks] 是关的，现在只能手动推进',

  // ---- 目标清单与空态 ----
  'tasks.empty': '还没有长线目标。可以点「建一个」，或直接对贾维斯说“替我盯着……”',
  'tasks.create': '建一个',
  'tasks.goalPlaceholder': '目标；可选步骤用分号隔开，例：收集本周纪要; 汇总成 weekly.txt',
  'tasks.waitPlaceholder': '等待条件（可选）：time=2026-10-23T09:00 或 file_exists=D:\\a.txt',
  'tasks.submit': '建立目标',
  'tasks.formCancel': '先不建',
  'tasks.goalNeedsText': '目标文本不能为空',

  // ---- 目标行的操作（一拍落手类）----
  'tasks.pause': '暂停',
  'tasks.resume': '继续',
  'tasks.abort': '放弃',
  'tasks.advance': '跳过等待',
  'tasks.remove': '删除',
  'tasks.approve': '批准并重试',
  'tasks.approveNoTools': '这一步没记下被拦的工具名，面板不签范围不明的放行（请在终端用 /lease 显式放行）',
  'tasks.undoTask': '撤销它的改动',
  'tasks.awaitingApproval': '等你授权',

  // ---- 目标行的状态说明 ----
  'tasks.stepWait': '等待：{wait}',
  'tasks.stepNextRun': '最迟 {when}',
  'tasks.stepAttempts': '已试 {n} 次',
  'tasks.deniedBy': '被拦：{tools}',
  'tasks.stepsToggle': '步骤明细',

  // ---- 两拍确认（后端未落手，只回影响面）----
  'tasks.confirmDelete.title': '要删掉的是这个目标：',
  'tasks.confirmDelete.hint': '删除会连同它挂着的等待与预约一起抹掉，且不可恢复。',
  'tasks.confirmUndo.title': '整轮回滚会影响这些文件：',
  'tasks.confirmUndo.untracked': '另有 {n} 个新建文件会被删除',
  'tasks.confirmUndoTask.title': '该目标名下已执行的副作用：',
  'tasks.confirm.emptyPreview': '后端没给出影响面清单（检查点可能已过期），仍要继续请点确认。',
  'tasks.confirm.doIt': '确认执行',
  'tasks.confirm.back': '先不动',

  // ---- 副作用账本 ----
  'tasks.journal.disabled': '副作用账本未启用（[actions].journal_enabled=false）',
  'tasks.journal.empty': '账本还空着：我动过文件、发过东西都会记在这里',
  'tasks.journal.held': '扣住待发（{n}）',
  'tasks.journal.heldEmpty': '没有正在扣住的预约',
  'tasks.journal.recent': '最近记录',
  'tasks.journal.counts': '已执行 {applied} · 已撤销 {undone} · 待执行 {held}',
  'tasks.journal.windowLine': '回退窗口 {sec} 秒 · 窗内 {size} 条',
  'tasks.journal.heldLabels': '可回退的动作类型：{labels}',
  'tasks.journal.cancelHold': '撤回',
  'tasks.journal.cancelHoldTip': '撤回还没执行的预约（不做任何事，不需要二次确认）',
  'tasks.journal.undo': '回退这一轮',
  'tasks.journal.undoTip': '回到本轮开始前的工作区（粒度是整轮，不是单文件）',
  'tasks.journal.notUndoable': '撤不回',
  'tasks.journal.dueIn': '{sec} 秒后自动执行',
  'tasks.journal.duePassed': '已到点（等驱动器接手）',
  'tasks.journal.belongsTo': '来自目标 {id}',
  'tasks.journal.itemsToggle': '逐项结果',
  'tasks.journal.error': '失败原因：{err}',
  'tasks.journal.state.held': '待执行',
  'tasks.journal.state.applied': '已执行',
  'tasks.journal.state.undone': '已撤销',
  'tasks.journal.state.failed': '失败',
  'tasks.journal.state.cancelled': '已撤回',
  'tasks.journal.state.unknown': '未知状态',

  // ---- 反馈条 ----
  'tasks.refresh': '刷新',
  'tasks.refreshTip': '重新拉取台账与账本快照',
  'tasks.offline': '未连接后端：拿不到台账',
  'tasks.busy': '处理中…'
}

/** English · task center (cross-session goals + effect journal). */
export const enTasks: Dict = {
  // ---- Section heads ----
  'tasks.spine.head': 'Cross-session goals',
  'tasks.journal.head': 'Effect journal',

  // ---- Driver status (thread running ≠ config enabled, say both) ----
  'tasks.driverOn': 'Driver running',
  'tasks.driverOff': 'Driver not running: goals will not advance on their own (enable [tasks] enabled and provide credentials)',
  'tasks.configOff': '[tasks] is off in config, so nothing advances automatically',

  // ---- Goal list and empty state ----
  'tasks.empty': 'No long-run goals yet. Click “New goal”, or just tell Jarvis “keep an eye on …”',
  'tasks.create': 'New goal',
  'tasks.goalPlaceholder': 'Goal; optional steps separated by “;”, e.g. Collect notes; write weekly.txt',
  'tasks.waitPlaceholder': 'Wait condition (optional): time=2026-10-23T09:00 or file_exists=D:\\a.txt',
  'tasks.submit': 'Create goal',
  'tasks.formCancel': 'Cancel',
  'tasks.goalNeedsText': 'Goal text is required',

  // ---- One-shot goal controls ----
  'tasks.pause': 'Pause',
  'tasks.resume': 'Resume',
  'tasks.abort': 'Abandon',
  'tasks.advance': 'Skip wait',
  'tasks.remove': 'Delete',
  'tasks.approve': 'Approve & retry',
  'tasks.approveNoTools': 'This step recorded no blocked tool, so the panel will not grant an unscoped lease (use /lease in the terminal)',
  'tasks.undoTask': 'Undo its effects',
  'tasks.awaitingApproval': 'Awaiting approval',

  // ---- Goal line status details ----
  'tasks.stepWait': 'Waiting: {wait}',
  'tasks.stepNextRun': 'At latest {when}',
  'tasks.stepAttempts': '{n} attempts',
  'tasks.deniedBy': 'Blocked: {tools}',
  'tasks.stepsToggle': 'Step details',

  // ---- Two-step confirm (backend did nothing yet, only the impact preview) ----
  'tasks.confirmDelete.title': 'The goal to delete is:',
  'tasks.confirmDelete.hint': 'Deleting also drops its pending waits and reservations, and it cannot be undone.',
  'tasks.confirmUndo.title': 'Rolling back this turn touches these files:',
  'tasks.confirmUndo.untracked': '{n} newly created files will also be deleted',
  'tasks.confirmUndoTask.title': 'Effects already applied under this goal:',
  'tasks.confirm.emptyPreview': 'The backend returned no impact list (the checkpoint may have expired). Confirm to proceed anyway.',
  'tasks.confirm.doIt': 'Confirm',
  'tasks.confirm.back': 'Not now',

  // ---- Effect journal ----
  'tasks.journal.disabled': 'Effect journal is disabled ([actions].journal_enabled=false)',
  'tasks.journal.empty': 'Journal is empty: every file edit and outbound action lands here',
  'tasks.journal.held': 'Held ({n})',
  'tasks.journal.heldEmpty': 'No action is being held',
  'tasks.journal.recent': 'Recent',
  'tasks.journal.counts': 'applied {applied} · undone {undone} · held {held}',
  'tasks.journal.windowLine': 'undo window {sec}s · {size} in window',
  'tasks.journal.heldLabels': 'undoable tool types: {labels}',
  'tasks.journal.cancelHold': 'Withdraw',
  'tasks.journal.cancelHoldTip': 'Withdraw a reservation that has not run (does nothing, no second confirm)',
  'tasks.journal.undo': 'Roll back turn',
  'tasks.journal.undoTip': 'Restore the workspace to before this turn (whole turn, not one file)',
  'tasks.journal.notUndoable': 'Not undoable',
  'tasks.journal.dueIn': 'auto-executes in {sec}s',
  'tasks.journal.duePassed': 'due reached (driver will pick it up)',
  'tasks.journal.belongsTo': 'from goal {id}',
  'tasks.journal.itemsToggle': 'Per-item results',
  'tasks.journal.error': 'failure reason: {err}',
  'tasks.journal.state.held': 'held',
  'tasks.journal.state.applied': 'applied',
  'tasks.journal.state.undone': 'undone',
  'tasks.journal.state.failed': 'failed',
  'tasks.journal.state.cancelled': 'cancelled',
  'tasks.journal.state.unknown': 'unknown',

  // ---- Feedback bar ----
  'tasks.refresh': 'Refresh',
  'tasks.refreshTip': 'Reload ledger and journal snapshots',
  'tasks.offline': 'Backend not connected: no ledger',
  'tasks.busy': 'Working…'
}
