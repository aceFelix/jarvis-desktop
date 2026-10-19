/**
 * 管家服务面板（独立组件）：整体替换右栏信息面板（App 按 uiStore.rightView 切换，
 * 与 SettingsPanel 同机制）。标题栏「管家服务」按钮进入。
 *
 * 结构：返回头（← 回信息面板，复用 .settings-head/.settings-back）+ 两级视图：
 * - 服务清单（butlerStore.activeService === ''）：后续扩展只需往 SERVICES 加条目
 *   + i18n 加文案；
 * - 服务视图：按 activeService 在 SERVICE_VIEWS 里取对应组件（'email' →
 *   EmailServicePanel，'percept' → PerceptSourcePanel），均为面板内嵌、非弹窗。
 *   用映射表而非嵌套三元：服务只会越加越多，嵌套三元每加一个都要重写全部分支。
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
import EmailServicePanel from './EmailServicePanel'
import PerceptSourcePanel from './PerceptSourcePanel'

/** 服务清单（后续扩展：往这里加一项 + i18n 加文案 + SERVICE_VIEWS 加组件）。 */
const SERVICES: Array<{ id: Exclude<ButlerService, ''>; labelKey: string; descKey: string }> = [
  { id: 'email', labelKey: 'butler.service.email', descKey: 'butler.service.emailDesc' },
  { id: 'percept', labelKey: 'butler.service.percept', descKey: 'butler.service.perceptDesc' }
]

/**
 * 服务 id → 面板内视图组件。必须当作 JSX 元素渲染（<ServiceView />），
 * 不能 `SERVICE_VIEWS[id]()` 直接调用：那样子组件里的 hooks 会挂到本组件身上。
 * @author aceFelix
 */
const SERVICE_VIEWS: Record<Exclude<ButlerService, ''>, () => JSX.Element> = {
  email: EmailServicePanel,
  percept: PerceptSourcePanel
}

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

  // 服务视图组件（清单态为 null）：从映射表取，避免按服务数量堆嵌套三元
  const ServiceView = activeService === '' ? null : SERVICE_VIEWS[activeService]

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

      {ServiceView ? (
        <ServiceView />
      ) : (
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
      )}
    </aside>
  )
}
