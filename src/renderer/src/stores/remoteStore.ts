/**
 * 跨设备协同连接态 store —— 手机 PWA / 微信 ClawBot 的连接状态（桌面下拉按钮）。
 *
 * 职责单一：只承载「手机 / 微信当前是否已连接」，供输入区下拉按钮切换文案与
 * 高亮，不与 chatStore（二维码卡片走消息流）/ runtimeStore（模式/思考）混杂。
 * - 初值由 backendStore.refreshRemote（phone.status + wechat.status）在 init
 *   事件时回填（首屏与重连各一次），避免重开桌面后按钮态与实际脱节；
 * - remote_state 事件到达时经 setPhone/setWechat 实时更新。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

interface RemoteState {
  /** 手机 PWA 桥接是否已启动（phone.status.active）。 */
  phoneConnected: boolean
  /** 微信 ClawBot 是否已登录（wechat.status.connected）。 */
  wechatConnected: boolean
  /** 写手机连接态（remote_state 事件 / phone.status 回填）。 */
  setPhone: (connected: boolean) => void
  /** 写微信连接态（remote_state 事件 / wechat.status 回填）。 */
  setWechat: (connected: boolean) => void
}

export const useRemoteStore = create<RemoteState>((set) => ({
  phoneConnected: false,
  wechatConnected: false,
  setPhone: (connected) => set({ phoneConnected: connected }),
  setWechat: (connected) => set({ wechatConnected: connected })
}))
