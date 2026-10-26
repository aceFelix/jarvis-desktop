/**
 * 扩展服务 store —— 右栏「扩展服务面板」内部的瞬态状态。
 *
 * 面板本身的进入/退出（右栏视图切换）由 uiStore.rightView 驱动；这里只管
 * 面板内「当前打开哪一类扩展」：''=分类清单（面板首页），其余为五类之一
 * （mcp / tools / skills / plugins / harness）。
 *
 * 各类清单与表单数据由各子面板自行持有（挂载即拉取、卸载即丢弃，与
 * EmailServicePanel 同口径），不集中进本 store，避免全局状态膨胀。状态不持久化，
 * 离开面板/重启回分类清单是预期行为。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import type { ExtensionCategory } from '../../../shared/extension-contracts'

/** 面板内当前分类：''=分类清单（面板首页）。 */
export type ActiveCategory = '' | ExtensionCategory

interface ExtensionState {
  /** 面板内当前视图（''=分类清单；ExtensionPanel 据此条件渲染子面板）。 */
  activeCategory: ActiveCategory
  /** 在面板内选定某分类（清单项点击）。 */
  openCategory: (category: ExtensionCategory) => void
  /** 关闭当前分类回分类清单（子面板返回/面板重新进入共用）。 */
  closeCategory: () => void
}

export const useExtensionStore = create<ExtensionState>((set) => ({
  activeCategory: '',
  openCategory: (activeCategory) => set({ activeCategory }),
  closeCategory: () => set({ activeCategory: '' })
}))
