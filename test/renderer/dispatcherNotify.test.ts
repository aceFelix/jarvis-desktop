/**
 * dispatchServerEvent 单测（播报与外联域）—— 主动播报 / 跨设备协同 / 消息回溯 /
 * 斜杠命令输出卡片四类事件的落地。
 *
 * 从 `dispatcher.test.ts` 拆出（aceFelix，2026-10 阶段 10 W3）：原文件已越过单文件
 * 800 行上限，按**事件域**拆分而不是按用例数量切半；假连接门面与各 store 的复位
 * 放在 `dispatcherFixtures.ts` 由两个文件共用（复制一份就会在门面加动作时漏改一边）。
 * 聊天流 / 会话与初始化 / 左栏与指标等其余事件仍在 `dispatcher.test.ts`。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dispatchServerEvent } from '@renderer/api/dispatcher'
import { useChatStore } from '@renderer/stores/chatStore'
import { useRightStore } from '@renderer/stores/rightStore'
import { useRemoteStore } from '@renderer/stores/remoteStore'
import { makeConn, resetDispatcherStores } from './dispatcherFixtures'

beforeEach(() => {
  resetDispatcherStores()
})

describe('dispatchServerEvent · 主动播报 proactive_notify', () => {
  // node 环境无 window：stub 一个带 jarvisDesktop.notify 的假 window，
  // 驱动 dispatcher 的系统通知分支（dispatcher 内 try/catch 容错缺失）
  let notifySpy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    notifySpy = vi.fn()
    ;(globalThis as unknown as { window: unknown }).window = {
      jarvisDesktop: { notify: notifySpy }
    }
  })
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('briefing 全文上屏为系统气泡 + 弹通知，不 ack', () => {
    const conn = makeConn()
    const text = '早上好，先生。以下是今日简报：\n\n📅 今天是工作日'
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'briefing', title: '贾维斯主动提醒', text } },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys).toHaveLength(1)
    expect(sys[0].kind === 'system' && sys[0].text).toBe(text)
    expect(notifySpy).toHaveBeenCalledWith({ title: '贾维斯主动提醒', body: text })
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('briefing 原文进右栏最近简报 + 刷新任务中心', () => {
    // 任务中心联动：简报更新 latestBriefing；提醒触发/截止日期检查后
    // 列表有变化（fired 离列、days_left 更新），统一刷新。@author aceFelix
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'briefing', title: '贾维斯主动提醒', text: '今日简报' } },
      conn
    )
    expect(useRightStore.getState().latestBriefing).toBe('今日简报')
    expect(conn.refreshSchedule).toHaveBeenCalled()
  })

  it('task 播报刷新任务中心（台账与账本都已变化）', () => {
    // 驱动器报「做完一步 / 卡住了 / 等你授权」时两份快照都旧了，不刷新就会
    // 停在旧状态（批准按钮会因快照未更新而看不到）。@author aceFelix
    const conn = makeConn()
    dispatchServerEvent(
      {
        event: 'proactive_notify',
        data: { kind: 'task', title: '任务脊柱', text: '目标「收集纪要」已完成：2/2 步' }
      },
      conn
    )
    expect(conn.refreshTasks).toHaveBeenCalledTimes(1)
    expect(conn.refreshSchedule).toHaveBeenCalled()
  })

  it('非 task 播报不刷任务中心（免得每条简报都多两个往返）', () => {
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'deadline', title: 'T', text: 'X' } },
      conn
    )
    expect(conn.refreshTasks).not.toHaveBeenCalled()
  })

  it('reminder 带 ⏰ 前缀上屏 + 弹通知 + 按 task_id 回执', () => {
    const conn = makeConn()
    dispatchServerEvent(
      {
        event: 'proactive_notify',
        data: { kind: 'reminder', title: '贾维斯提醒', text: '开会', task_id: 't1' }
      },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys[0].kind === 'system' && sys[0].text).toBe('⏰ 开会')
    expect(notifySpy).toHaveBeenCalledWith({ title: '贾维斯提醒', body: '开会' })
    expect(conn.ackProactive).toHaveBeenCalledWith('t1')
  })

  it('reminder 无 task_id → 不回执（无从确认）', () => {
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'reminder', title: '提醒', text: '喝水' } },
      conn
    )
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('deadline 全文上屏（无 ⏰ 前缀）+ 弹通知，不 ack', () => {
    const conn = makeConn()
    dispatchServerEvent(
      {
        event: 'proactive_notify',
        data: { kind: 'deadline', title: '贾维斯主动提醒', text: '📋 截止日期提醒：\n  • 明天：交报告' }
      },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys[0].kind === 'system' && sys[0].text).toContain('截止日期提醒')
    expect(sys[0].kind === 'system' && sys[0].text.startsWith('⏰')).toBe(false)
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('未知 kind 容错：按非 reminder 处理（全文上屏 + 通知，不 ack）', () => {
    const conn = makeConn()
    expect(() =>
      dispatchServerEvent(
        { event: 'proactive_notify', data: { kind: 'weird', title: 'T', text: 'X' } },
        conn
      )
    ).not.toThrow()
    expect(notifySpy).toHaveBeenCalledWith({ title: 'T', body: 'X' })
    expect(conn.ackProactive).not.toHaveBeenCalled()
  })

  it('payload 缺失字段容错：空 data 不抛异常', () => {
    const conn = makeConn()
    expect(() =>
      dispatchServerEvent({ event: 'proactive_notify', data: null }, conn)
    ).not.toThrow()
  })

  it('window.jarvisDesktop 缺失时静默降级（不上屏失败）', () => {
    // 覆盖 preload 未注入 notify 的旧壳：try/catch 吞掉，气泡照常上屏
    ;(globalThis as unknown as { window: unknown }).window = {}
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'proactive_notify', data: { kind: 'briefing', title: 'T', text: '正文' } },
      conn
    )
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys).toHaveLength(1)
  })
})

describe('dispatchServerEvent · 跨设备协同（qrcode / remote_state）', () => {
  // qrcode 事件→内联二维码卡片；remote_state 事件→remoteStore + 卡片 connected 同步。@author aceFelix
  it('qrcode 事件上屏一条手机二维码卡片', () => {
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'phone', url: 'http://127.0.0.1:8765/?token=abc' } },
      makeConn()
    )
    const card = useChatStore.getState().messages[0]
    expect(card).toMatchObject({ kind: 'qrcode', channel: 'phone', connected: false })
  })

  it('同通道重复 qrcode 事件就地刷新 url（不堆叠）', () => {
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'phone', url: 'u1' } }, makeConn())
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'phone', url: 'u2' } }, makeConn())
    const qr = useChatStore.getState().messages.filter((m) => m.kind === 'qrcode')
    expect(qr).toHaveLength(1)
    expect(qr[0]).toMatchObject({ url: 'u2' })
  })

  it('fresh 新连接：清理旧未连接卡片并在底部新建（重连不往上翻）', () => {
    // 先有一条旧未连接二维码 + 一条后续消息（模拟历史往下堆）
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'wechat', url: 'old' } }, makeConn())
    dispatchServerEvent({ event: 'info', data: '微信已断开' }, makeConn())
    // 重连：fresh=True → 旧未连接卡片被移除，新卡片在列表末尾
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'wechat', url: 'new', fresh: true } },
      makeConn()
    )
    const msgs = useChatStore.getState().messages
    const qr = msgs.filter((m) => m.kind === 'qrcode')
    expect(qr).toHaveLength(1)
    expect(qr[0]).toMatchObject({ url: 'new', connected: false })
    // 新二维码卡片位于消息列表末尾（配合自动滚底即在当前视口）
    expect(msgs[msgs.length - 1]).toMatchObject({ kind: 'qrcode', url: 'new' })
  })

  it('fresh 新连接：保留已连接历史卡片，仅清理未连接旧卡片', () => {
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'phone', url: 'p1', fresh: true } },
      makeConn()
    )
    // 上一张连上了 → 变已连接（应作为历史保留）
    dispatchServerEvent({ event: 'remote_state', data: { channel: 'phone', connected: true } }, makeConn())
    // 再次新连接：已连接旧卡保留，底部新建一张未连接
    dispatchServerEvent(
      { event: 'qrcode', data: { channel: 'phone', url: 'p2', fresh: true } },
      makeConn()
    )
    const qr = useChatStore.getState().messages.filter((m) => m.kind === 'qrcode')
    expect(qr).toHaveLength(2)
    expect(qr[0]).toMatchObject({ url: 'p1', connected: true })
    expect(qr[1]).toMatchObject({ url: 'p2', connected: false })
  })

  it('remote_state 写 phone 连接态并收起对应二维码卡片', () => {
    dispatchServerEvent({ event: 'qrcode', data: { channel: 'phone', url: 'u1' } }, makeConn())
    dispatchServerEvent({ event: 'remote_state', data: { channel: 'phone', connected: true } }, makeConn())
    expect(useRemoteStore.getState().phoneConnected).toBe(true)
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: 'qrcode', channel: 'phone', connected: true })
  })

  it('remote_state 无卡片时仅写连接态（微信登录无扫码上屏场景）', () => {
    dispatchServerEvent({ event: 'remote_state', data: { channel: 'wechat', connected: true } }, makeConn())
    expect(useRemoteStore.getState().wechatConnected).toBe(true)
    expect(useChatStore.getState().messages.filter((m) => m.kind === 'qrcode')).toHaveLength(0)
  })

  it('channel 缺失的畸形事件静默忽略', () => {
    expect(() => dispatchServerEvent({ event: 'remote_state', data: { connected: true } }, makeConn())).not.toThrow()
  })

  it('remote_user_message 上屏一条带来源标记的用户气泡（微信）', () => {
    dispatchServerEvent(
      { event: 'remote_user_message', data: { channel: 'wechat', text: '后天天气如何' } },
      makeConn()
    )
    const m = useChatStore.getState().messages[0]
    expect(m).toMatchObject({ kind: 'user', text: '后天天气如何', source: 'wechat' })
  })

  it('remote_user_message 先收尾上一条未定稿的流式 AI 气泡（防续写）', () => {
    // 模拟上一条微信回复的 assistant_done 漏收：气泡仍 streaming
    useChatStore.getState().appendAssistantText('旧回复')
    dispatchServerEvent(
      { event: 'remote_user_message', data: { channel: 'wechat', text: '新问题' } },
      makeConn()
    )
    const msgs = useChatStore.getState().messages
    const ai = msgs.find((m) => m.kind === 'ai')
    expect(ai && ai.kind === 'ai' && ai.streaming).toBe(false)
    expect(msgs[msgs.length - 1]).toMatchObject({ kind: 'user', source: 'wechat', text: '新问题' })
  })
})

// 消息级回溯（撤回）：checkpoint.rewind 落地推 rewound 事件 → 按 removed_user
// 裁本地用户气泡及其后全部内容 + 按 files_restored/reason 提示；失败不裁。
// @author aceFelix
describe('dispatchServerEvent · 消息回溯 rewound', () => {
  /** 造两条用户轮：user1/ai1/user2/ai2（尾部数 2 = 从 user1 起撤回）。 */
  function seedTwoTurns(): void {
    const c = useChatStore.getState()
    c.addUser('第一条')
    c.appendAssistantText('回复一')
    c.finishAssistant()
    c.addUser('第二条')
    c.appendAssistantText('回复二')
    c.finishAssistant()
  }

  /** 只取对话气泡（排除撤回后追加的 system 提示），圆活计数。 */
  function conv(): string[] {
    return useChatStore
      .getState()
      .messages.filter((m) => m.kind !== 'system')
      .map((m) => m.kind)
  }

  it('ok=true：按 removed_user 从尾部裁掉对应用户气泡及其后全部气泡', () => {
    seedTwoTurns()
    expect(conv()).toHaveLength(4)
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'rewound', data: { ok: true, removed: 4, removed_user: 2, files_restored: true, reason: '' } },
      conn
    )
    expect(conv()).toHaveLength(0)
    expect(conn.refreshSessions).toHaveBeenCalled()
    expect(conn.refreshCost).toHaveBeenCalled()
  })

  it('ok=true 尾部数 1：只删最后一条用户轮（保留更早的轮）', () => {
    seedTwoTurns()
    dispatchServerEvent(
      { event: 'rewound', data: { ok: true, removed: 2, removed_user: 1, files_restored: false, reason: '' } },
      makeConn()
    )
    expect(conv()).toEqual(['user', 'ai'])
  })

  it('ok=true files_restored=false 带 reason：提示里附降级说明', () => {
    seedTwoTurns()
    dispatchServerEvent(
      { event: 'rewound', data: { ok: true, removed: 2, removed_user: 1, files_restored: false, reason: '无可用检查点，仅回退对话' } },
      makeConn()
    )
    expect(conv()).toEqual(['user', 'ai'])
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.some((m) => m.kind === 'system' && m.text.includes('仅回退对话'))).toBe(true)
  })

  it('ok=false：不裁任何气泡，仅弹错（与后端「失败不截断」语义对齐）', () => {
    seedTwoTurns()
    dispatchServerEvent(
      { event: 'rewound', data: { ok: false, removed: 0, removed_user: 0, files_restored: false, reason: '文件回滚失败：目标提交不存在' } },
      makeConn()
    )
    expect(conv()).toHaveLength(4)
    const sys = useChatStore.getState().messages.filter((m) => m.kind === 'system')
    expect(sys.some((m) => m.kind === 'system' && m.text.includes('撤回失败'))).toBe(true)
  })

  it('removed_user 缺失/为 0：不裁气泡但仍提示成功（防误删）', () => {
    seedTwoTurns()
    dispatchServerEvent(
      { event: 'rewound', data: { ok: true, removed: 2, files_restored: true, reason: '' } },
      makeConn()
    )
    expect(conv()).toHaveLength(4)
  })
})

// ---- 斜杠命令透传（slash.exec → slash_result 事件，2026-10） ----
// @author aceFelix
describe('dispatchServerEvent · slash_result 命令输出卡片', () => {
  it('ok=true：落 slash 卡片（命令原文/输出全文/非错态），收尾 busy 并刷用量', () => {
    useChatStore.getState().setBusy(true)
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'slash_result', data: { command: '/cost', ok: true, text: '输入 123 输出 45' } },
      conn
    )
    const m = useChatStore.getState().messages[0]
    expect(m).toMatchObject({ kind: 'slash', command: '/cost', text: '输入 123 输出 45', isError: false })
    expect(useChatStore.getState().busy).toBe(false)
    expect(conn.refreshCost).toHaveBeenCalled()
  })

  it('ok=false：卡片带错态（isError=true），拒绝文案原样透出', () => {
    dispatchServerEvent(
      { event: 'slash_result', data: { command: '/init', ok: false, text: '/init 暂不支持在桌面执行' } },
      makeConn()
    )
    const m = useChatStore.getState().messages[0]
    expect(m).toMatchObject({ kind: 'slash', isError: true })
    if (m.kind === 'slash') expect(m.text).toContain('暂不支持')
  })

  it('停止闸门开启中仍接收 slash_result（命令结果不是流式增量，不受闸门影响）', () => {
    useChatStore.getState().setAborted(true)
    dispatchServerEvent(
      { event: 'slash_result', data: { command: '/doctor', ok: true, text: '自检通过' } },
      makeConn()
    )
    expect(useChatStore.getState().messages.some((m) => m.kind === 'slash')).toBe(true)
  })
})

