/**
 * 反应炉动画实例引用 —— React 组件树之外的可变单例。
 *
 * ReactorCanvas 组件挂载时注册 ArcReactor 实例，dispatcher 收到
 * volume / user_speaking / ai_speaking / status 事件时直接驱动它
 * （动画是命令式对象，不适合放进 React 状态）。
 *
 * @author aceFelix
 */

import type { ArcReactor } from '../reactor'

let instance: ArcReactor | null = null

export function setReactor(reactor: ArcReactor | null): void {
  instance = reactor
}

export function getReactor(): ArcReactor | null {
  return instance
}
