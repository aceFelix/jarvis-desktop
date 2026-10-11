/**
 * 管家服务面板（独立组件）：整体替换右栏信息面板（App 按 uiStore.rightView 切换，
 * 与 SettingsPanel 同机制）。标题栏「管家服务」按钮进入。
 *
 * 结构：返回头（← 回信息面板，复用 .settings-head/.settings-back）+ 两级视图：
 * - 服务清单（butlerStore.activeService === ''）：后续扩展只需往 SERVICES 加条目
 *   + i18n 加文案；
 * - 服务表单（activeService === 'email'）：渲染 EmailForm（面板内嵌，非弹窗）。
 *
 * 每次面板挂载（重新进入）都重置回服务清单——面板离开视图即卸载，挂载即新入口。
 *
 * @author aceFelix
 */

import { useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useButlerStore, type ButlerService } from '../stores/butlerStore'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'
import EmailForm from './EmailForm'

/** 服务清单（后续扩展：往这里加一项 + i18n 加文案即可）。 */
const SERVICES: Array<{ id: Exclude<ButlerService, ''>; labelKey: string; descKey: string }> = [
  { id: 'email', labelKey: 'butler.service.email', descKey: 'butler.service.emailDesc' }
]

export default function ButlerPanel(): JSX.Element {
  const t = useT()
  const g = useGlyphs()
  const closeButler = useUiStore((s) => s.closeButler)
  const activeService = useButlerStore((s) => s.activeService)
  const openService = useButlerStore((s) => s.openService)
  const closeService = useButlerStore((s) => s.closeService)

  // 面板每次挂载（重新进入）都回服务清单，不残留上次打开的表单
  useEffect(() => {
    closeService()
    // 仅挂载时执行一次；closeService 引用稳定（zustand set 动作）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <aside id="right-col" className="glass-col" data-testid="butler-view">
      <div className="col-header settings-head">
        <button
          className="settings-back"
          data-testid="btn-butler-back"
          title={t('settings.back')}
          onClick={closeButler}
        >
          ←
        </button>
        <span className="col-title">
          {g.butler} {t('butler.title')}
        </span>
        <span />
      </div>

      {activeService === '' ? (
        <div className="settings-panel" data-testid="butler-service-list">
          {SERVICES.map((s) => (
            <button
              key={s.id}
              className="butler-service-item"
              data-testid={`btn-butler-${s.id}`}
              onClick={() => openService(s.id)}
            >
              <span className="butler-service-name">{t(s.labelKey)}</span>
              <span className="butler-service-desc">{t(s.descKey)}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmailForm />
      )}
    </aside>
  )
}
