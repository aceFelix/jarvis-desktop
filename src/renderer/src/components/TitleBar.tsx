/**
 * 自绘标题栏（无边框窗口）：整条可拖动（-webkit-app-region: drag），
 * 窗口控制按钮经 preload IPC 转给主进程。
 *
 * 无全屏按钮：窗口即普通可缩放窗口，全屏诉求走系统快捷键（与 workbench
 * "不提供全屏"的口径一致）。
 *
 * @author aceFelix
 */

import { useT } from '../i18n'

export default function TitleBar(): JSX.Element {
  const t = useT()
  const minimize = (): void => {
    void window.jarvisDesktop?.windowControl('minimize')
  }
  const close = (): void => {
    void window.jarvisDesktop?.windowControl('close')
  }

  return (
    <header id="title-bar">
      <span id="title-drag">
        <span id="title-logo">J.A.R.V.I.S</span>
        <span id="title-sub">{t('app.subtitle')}</span>
      </span>
      <div id="win-controls">
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
