/**
 * 扩展服务面板（独立组件）：整体替换右栏信息面板（App 按 uiStore.rightView 切换，
 * 与 SettingsPanel / ButlerPanel 同机制）。标题栏「扩展服务」按钮进入。
 *
 * 结构：返回头（← 回信息面板，复用 .settings-head/.settings-back）+ 两级视图：
 * - 分类清单（extensionStore.activeCategory === ''）：五类扩展入口（MCP 服务 /
 *   内置工具 / 技能 / 插件 / harness），后续扩展只需往 CATEGORIES 加条目 + i18n
 *   加文案；
 * - 分类视图：按 activeCategory 渲染对应子面板（MCP 完整管理；工具/技能只读清单；
 *   插件/harness 市场安装与启停）。
 *
 * 每次面板挂载（重新进入）都重置回分类清单——面板离开视图即卸载，挂载即新入口。
 *
 * @author aceFelix
 */

import { useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useExtensionStore, type ActiveCategory } from '../stores/extensionStore'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'
import ExtensionMcpPanel from './ExtensionMcpPanel'
import { ExtensionSkillsPanel, ExtensionToolsPanel } from './ExtensionListPanels'
import { ExtensionHarnessPanel, ExtensionPluginsPanel } from './ExtensionMarketPanels'

/** 分类清单（后续扩展：往这里加一项 + i18n 加文案即可）。 */
const CATEGORIES: Array<{
  id: Exclude<ActiveCategory, ''>
  labelKey: string
  descKey: string
}> = [
  { id: 'mcp', labelKey: 'extension.cat.mcp', descKey: 'extension.cat.mcpDesc' },
  { id: 'tools', labelKey: 'extension.cat.tools', descKey: 'extension.cat.toolsDesc' },
  { id: 'skills', labelKey: 'extension.cat.skills', descKey: 'extension.cat.skillsDesc' },
  { id: 'plugins', labelKey: 'extension.cat.plugins', descKey: 'extension.cat.pluginsDesc' },
  { id: 'harness', labelKey: 'extension.cat.harness', descKey: 'extension.cat.harnessDesc' }
]

/** 按当前分类渲染对应子面板（未选分类时不调用）。 */
function renderCategory(category: Exclude<ActiveCategory, ''>): JSX.Element {
  switch (category) {
    case 'mcp':
      return <ExtensionMcpPanel />
    case 'tools':
      return <ExtensionToolsPanel />
    case 'skills':
      return <ExtensionSkillsPanel />
    case 'plugins':
      return <ExtensionPluginsPanel />
    default:
      return <ExtensionHarnessPanel />
  }
}

export default function ExtensionPanel(): JSX.Element {
  const t = useT()
  const g = useGlyphs()
  const closeExtension = useUiStore((s) => s.closeExtension)
  const activeCategory = useExtensionStore((s) => s.activeCategory)
  const openCategory = useExtensionStore((s) => s.openCategory)
  const closeCategory = useExtensionStore((s) => s.closeCategory)

  // 面板每次挂载（重新进入）都回分类清单，不残留上次打开的类别
  useEffect(() => {
    closeCategory()
    // 仅挂载时执行一次；closeCategory 引用稳定（zustand set 动作）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <aside id="right-col" className="glass-col" data-testid="extension-view">
      <div className="col-header settings-head">
        <button
          className="settings-back"
          data-testid="btn-extension-close"
          title={t('settings.back')}
          onClick={closeExtension}
        >
          ←
        </button>
        <span className="col-title">
          {g.extension} {t('extension.title')}
        </span>
        <span />
      </div>

      {activeCategory === '' ? (
        <div className="settings-panel" data-testid="extension-category-list">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className="butler-service-item"
              data-testid={`btn-extension-${c.id}`}
              onClick={() => openCategory(c.id)}
            >
              <span className="butler-service-name">{t(c.labelKey)}</span>
              <span className="butler-service-desc">{t(c.descKey)}</span>
            </button>
          ))}
        </div>
      ) : (
        renderCategory(activeCategory)
      )}
    </aside>
  )
}
