// @vitest-environment jsdom
/**
 * dispatchServerEvent 单测（配置变更域）—— `settings_changed` 事件的落地。
 *
 * 这条事件是 2026-10-26 实测缺陷的修复：设置面板只在 init（连上时）拉一次
 * `settings.get`，之后从不刷新。模型把音量 100 → 50 时文件与运行时都对了，
 * 但滑杆还停在 100——用户看到的第一反应就是「改了但界面没变」；更糟的是他
 * 这时顺手拖一下滑杆，面板会把 100 又写回去，静默覆盖掉模型的改动。
 *
 * 所以要钉三件事：
 *
 * 1. 收到事件必须重拉 `settings.get`（不是只改一条本地镜像）；
 * 2. 带感知键时**额外**让感知源面板重拉（它的开关也在模型可改范围内）；
 * 3. 不带感知键时不惊动感知面板（避免无意义重拉）。
 *
 * 环境声明为 jsdom 而不是默认的 node：本文件**运行时**导入了 backendStore，
 * 它在模块加载期就会调 `applyTheme()` → 摸 `document`。dispatcher 那边不会
 * 触发（那里的 `JarvisConnection` 只是类型导入，编译后不剩代码）。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { dispatchServerEvent } from '@renderer/api/dispatcher'
import { useBackendStore } from '@renderer/stores/backendStore'
import { makeConn, resetDispatcherStores } from './dispatcherFixtures'

beforeEach(() => {
  resetDispatcherStores()
  useBackendStore.setState({ perceptTick: 0 })
})

describe('dispatchServerEvent · settings_changed（阶段 12）', () => {
  it('重拉 settings.get —— 面板不能停在旧值', () => {
    const conn = makeConn()
    dispatchServerEvent({ event: 'settings_changed', data: { keys: ['tts_volume'] } }, conn)
    expect(conn.refreshSettings).toHaveBeenCalledTimes(1)
  })

  it('带感知键时额外让感知面板重拉', () => {
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'settings_changed', data: { keys: ['window_enabled'] } },
      conn
    )
    expect(conn.refreshSettings).toHaveBeenCalledTimes(1)
    expect(conn.refreshPercept).toHaveBeenCalledTimes(1)
  })

  it('总开关（percept_enabled）也算感知键', () => {
    // 协议层叫 percept_enabled，面板内部的 PerceptConfig 叫 enabled——
    // 用 ENABLE_KEYS 单判会漏掉「模型把感知整个关了」
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'settings_changed', data: { keys: ['percept_enabled'] } },
      conn
    )
    expect(conn.refreshPercept).toHaveBeenCalledTimes(1)
  })

  it('一批里只要有一个感知键就要刷感知面板', () => {
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'settings_changed', data: { keys: ['tts_volume', 'vcs_enabled'] } },
      conn
    )
    expect(conn.refreshPercept).toHaveBeenCalledTimes(1)
  })

  it('纯表达层键不惊动感知面板', () => {
    const conn = makeConn()
    dispatchServerEvent(
      { event: 'settings_changed', data: { keys: ['tts_volume', 'daily_max'] } },
      conn
    )
    expect(conn.refreshPercept).not.toHaveBeenCalled()
  })

  it('payload 缺 keys / 形状不对也不炸，且照样重拉设置', () => {
    // 后端将来改信封时宁可多拉一次，也不能让 dispatcher 抛异常吞掉后续事件
    const conn = makeConn()
    dispatchServerEvent({ event: 'settings_changed', data: null }, conn)
    dispatchServerEvent({ event: 'settings_changed', data: { keys: 'oops' } }, conn)
    expect(conn.refreshSettings).toHaveBeenCalledTimes(2)
    expect(conn.refreshPercept).not.toHaveBeenCalled()
  })
})

describe('backendStore.refreshPercept', () => {
  it('只递增计数器（真正的拉取由面板自己做）', () => {
    expect(useBackendStore.getState().perceptTick).toBe(0)
    useBackendStore.getState().refreshPercept()
    useBackendStore.getState().refreshPercept()
    expect(useBackendStore.getState().perceptTick).toBe(2)
  })
})
