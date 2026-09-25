/**
 * 自绘标题栏（无边框窗口）：整条可拖动（-webkit-app-region: drag），
 * 窗口控制按钮经 preload IPC 转给主进程。
 *
 * 齿轮按钮：进入/退出设置面板（右栏整体替换为 SettingsPanel，
 * uiStore.rightView 驱动）；与窗口控制按钮同在 no-drag 区。
 *
 * 无全屏按钮：窗口即普通可缩放窗口，全屏诉求走系统快捷键（与 workbench
 * "不提供全屏"的口径一致）。
 *
 * @author aceFelix
 */

import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'
import { useUiStore } from '../stores/uiStore'

export default function TitleBar(): JSX.Element {
  const t = useT()
  const g = useGlyphs()
  const rightView = useUiStore((s) => s.rightView)
  const openSettings = useUiStore((s) => s.openSettings)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const minimize = (): void => {
    void window.jarvisDesktop?.windowControl('minimize')
  }
  const close = (): void => {
    void window.jarvisDesktop?.windowControl('close')
  }
  // 齿轮兼作 toggle：设置面板内再点一次直接回信息面板（与面板内 ← 等效）
  const toggleSettings = (): void => {
    if (rightView === 'settings') closeSettings()
    else openSettings()
  }

  return (
    <header id="title-bar">
      <span id="title-drag">
        <span id="title-logo">J.A.R.V.I.S</span>
        <span id="title-sub">{t('app.subtitle')}</span>
      </span>
      <div id="win-controls">
        <button
          className={`win-btn${rightView === 'settings' ? ' active' : ''}`}
          title={t('app.settingsTip')}
          data-testid="btn-open-settings"
          onClick={toggleSettings}
        >
          {g.settings}
        </button>
        <button className="win-btn" title={t('app.minimize')} onClick={minimize}>
          ─
        </button>
        <button className="win-btn close" title={t('app.closeTip')} onClick={close}>
          ✕
        </button>
      </div>
    </header>
  )
}
