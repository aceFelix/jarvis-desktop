/**
 * 管家服务 store —— 右栏「管家服务面板」内部的瞬态状态。
 *
 * 面板本身的进入/退出（右栏视图切换）由 uiStore.rightView 驱动；这里只管
 * 面板内「当前打开哪个服务」：''=服务清单（面板首页），'email'=邮件发送表单。
 *
 * 独立成 store（不塞进 uiStore）是为后续扩展多服务留位——新增服务只需往
 * 服务清单与 `activeService` 联合类型各加一项，动作口径不变。状态不持久化，
 * 离开面板/重启回服务清单是预期行为。
 *
 * @author aceFelix
 */

import { create } from 'zustand'

/** 管家服务标识：''=服务清单（面板首页）；'email'=邮件发送表单。 */
export type ButlerService = '' | 'email'

interface ButlerState {
  /** 面板内当前视图（''=服务清单；App/ButlerPanel 据此条件渲染）。 */
  activeService: ButlerService
  /** 在面板内选定某服务（清单项点击）。 */
  openService: (name: Exclude<ButlerService, ''>) => void
  /** 关闭当前服务回服务清单（表单取消/发送完成/面板重新进入共用）。 */
  closeService: () => void
}

export const useButlerStore = create<ButlerState>((set) => ({
  activeService: '',
  openService: (activeService) => set({ activeService }),
  closeService: () => set({ activeService: '' })
}))
