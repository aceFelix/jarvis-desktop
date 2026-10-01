// @vitest-environment jsdom
/**
 * runtimeStore 单测 —— 输入区运行时选择态（工作模式 + 思考强度）。
 *
 * 覆盖 applyRuntimeState（state.get 整体回填）、setMode / setThinking 单项写入。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'

beforeEach(() => {
  useRuntimeStore.setState({ permissionMode: 'default', thinkingEffort: 'off', thinkingSupported: [] })
})

describe('runtimeStore', () => {
  it('默认态：default / off / 无可选档位', () => {
    const s = useRuntimeStore.getState()
    expect(s.permissionMode).toBe('default')
    expect(s.thinkingEffort).toBe('off')
    expect(s.thinkingSupported).toEqual([])
  })

  it('applyRuntimeState 整体回填（首屏/重连）', () => {
    useRuntimeStore
      .getState()
      .applyRuntimeState({ permissionMode: 'yolo', thinkingEffort: 'high', thinkingSupported: ['off', 'low', 'medium', 'high'] })
    const s = useRuntimeStore.getState()
    expect(s.permissionMode).toBe('yolo')
    expect(s.thinkingEffort).toBe('high')
    expect(s.thinkingSupported).toEqual(['off', 'low', 'medium', 'high'])
  })

  it('setMode 只改模式，不动思考字段', () => {
    useRuntimeStore.getState().applyRuntimeState({ permissionMode: 'default', thinkingEffort: 'low', thinkingSupported: ['off', 'low'] })
    useRuntimeStore.getState().setMode('plan')
    const s = useRuntimeStore.getState()
    expect(s.permissionMode).toBe('plan')
    expect(s.thinkingEffort).toBe('low')
    expect(s.thinkingSupported).toEqual(['off', 'low'])
  })

  it('setThinking 只改档位，不动模式', () => {
    useRuntimeStore.getState().setMode('accept_edits')
    useRuntimeStore.getState().setThinking('medium')
    const s = useRuntimeStore.getState()
    expect(s.permissionMode).toBe('accept_edits')
    expect(s.thinkingEffort).toBe('medium')
  })
})
