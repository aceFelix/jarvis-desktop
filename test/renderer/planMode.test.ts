/**
 * 规划模式事件测试（2026-11）：`plan_submitted` → 聊天区系统消息。
 *
 * 只验「事件 → 呈现」这一段；后端 ExitPlanMode 的落盘/模式恢复由 jarvis 的
 * tests/tools/test_plan_mode.py 覆盖。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { dispatchServerEvent } from '@renderer/api/dispatcher'
import { useChatStore } from '@renderer/stores/chatStore'
import { makeConn, resetDispatcherStores } from './dispatcherFixtures'

beforeEach(() => {
  resetDispatcherStores()
})

describe('plan_submitted', () => {
  it('renders the plan summary, path and preview as a system message', () => {
    dispatchServerEvent(
      {
        event: 'plan_submitted',
        data: {
          content: '# 方案\n1. 先读代码\n2. 再改',
          summary: '两步走',
          path: '/project/.jarvis/PLAN.md'
        }
      },
      makeConn()
    )

    const messages = useChatStore.getState().messages
    const last = messages[messages.length - 1]
    expect(last.kind).toBe('system')
    if (last.kind !== 'system') throw new Error('expected system message')
    expect(last.text).toContain('计划已提交')
    expect(last.text).toContain('两步走')
    expect(last.text).toContain('/project/.jarvis/PLAN.md')
    expect(last.text).toContain('先读代码')
  })

  it('tolerates a missing summary/path and still shows the title', () => {
    dispatchServerEvent({ event: 'plan_submitted', data: {} }, makeConn())
    const messages = useChatStore.getState().messages
    const last = messages[messages.length - 1]
    expect(last.kind).toBe('system')
    if (last.kind !== 'system') throw new Error('expected system message')
    expect(last.text).toBe('计划已提交')
  })
})
