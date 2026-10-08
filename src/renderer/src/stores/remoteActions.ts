/**
 * 跨设备协同动作（自 backendStore 拆出，2026-10）。
 *
 * 拆分动机：backendStore 超过单文件 800 行上限，把手机 PWA / 微信
 * ClawBot 的一组指令动作外移为动作工厂；行为与原实现一致，
 * runCommand 依赖注入避免模块环引用。
 *
 * @author aceFelix
 */

import { Cmd } from '../../../shared/contracts'
import { useRemoteStore } from './remoteStore'
import type { RunCommand } from './resourceActions'

/** 拆出的协同动作集合（与 BackendStoreState 中同名成员签名一致）。 */
export interface RemoteActions {
  /** 启动手机协同（二维码走 qrcode 事件回聊天区）。 */
  connectPhone: () => Promise<void>
  /** 断开手机协同。 */
  disconnectPhone: () => Promise<void>
  /** 启动微信扫码登录（二维码走事件、配对码走内联输入）。 */
  connectWechat: () => Promise<void>
  /** 断开微信连接。 */
  disconnectWechat: () => Promise<void>
  /** 回喂微信手机端显示的数字配对码。 */
  submitWechatPairing: (code: string) => Promise<void>
  /** 拉取手机/微信连接态回填 remoteStore（init 时调一次）。 */
  refreshRemote: () => Promise<void>
}

/** 组装协同动作：只需注入 runCommand。 */
export function buildRemoteActions(runCommand: RunCommand): RemoteActions {
  return {
    connectPhone: async () => {
      // 入队即返回：真正的 ensure_session + 起桥接在引擎串行落地，
      // 完成后推 qrcode / remote_state 事件。失败由 runCommand 统一弹错。
      // @author aceFelix
      await runCommand(Cmd.PhoneConnect)
    },

    disconnectPhone: async () => {
      await runCommand(Cmd.PhoneDisconnect)
    },

    connectWechat: async () => {
      await runCommand(Cmd.WechatConnect)
    },

    disconnectWechat: async () => {
      await runCommand(Cmd.WechatDisconnect)
    },

    submitWechatPairing: async (code) => {
      // 微信配对码：回喂引擎 login 线程阻塞等待的队列（终端是 input()）。
      // @author aceFelix
      await runCommand(Cmd.WechatPairing, { code })
    },

    refreshRemote: async () => {
      // 重开/重连桌面时回填连接态（二维码卡片不回放，仅按钮态需准确）。
      // @author aceFelix
      const phone = await runCommand(Cmd.PhoneStatus)
      if (phone !== null) {
        useRemoteStore.getState().setPhone(!!(phone as { active?: boolean }).active)
      }
      const wechat = await runCommand(Cmd.WechatStatus)
      if (wechat !== null) {
        useRemoteStore.getState().setWechat(!!(wechat as { connected?: boolean }).connected)
      }
    }
  }
}
