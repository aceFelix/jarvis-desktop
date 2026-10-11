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
import { useUpdateStore } from '../stores/updateStore'

export default function TitleBar(): JSX.Element {
  const t = useT()
  const g = useGlyphs()
  const rightView = useUiStore((s) => s.rightView)
  const openSettings = useUiStore((s) => s.openSettings)
  const closeSettings = useUiStore((s) => s.closeSettings)
  // 自动更新状态（主进程推送经 App 写入 updateStore）
  const updateState = useUpdateStore((s) => s.state)
  const updateVersion = useUpdateStore((s) => s.version)
  const updatePercent = useUpdateStore((s) => s.percent)
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

  // 「有新版才显示按钮」：available/downloading/downloaded 三态可见；
  // error 若仍持有版本号则回退为可重试的「更新」（下载中断可再点，不必重启应用）。
  // 无版本号（如启动检查失败）则不渲染。
  const retryable = updateState === 'error' && !!updateVersion
  const showUpdate =
    updateState === 'available' ||
    updateState === 'downloading' ||
    updateState === 'downloaded' ||
    retryable
  const updateLabel =
    updateState === 'downloading'
      ? t('update.downloading', { percent: updatePercent })
      : updateState === 'downloaded'
        ? t('update.restart')
        : t('update.available')
  const updateTip =
    updateState === 'downloading'
      ? t('update.downloadingTip', { version: updateVersion, percent: updatePercent })
      : updateState === 'downloaded'
        ? t('update.restartTip', { version: updateVersion })
        : t('update.availableTip', { version: updateVersion })
  // 点击：available/error → 下载；downloaded → 退出安装；downloading 禁用不可点
  const onUpdateClick = (): void => {
    if (updateState === 'downloaded') void window.jarvisDesktop?.installUpdate()
    else if (updateState !== 'downloading') void window.jarvisDesktop?.downloadUpdate()
  }

  return (
    <header id="title-bar">
      <span id="title-drag">
        <span id="title-logo">J.A.R.V.I.S</span>
        <span id="title-sub">{t('app.subtitle')}</span>
      </span>
      <div id="win-controls">
        {showUpdate ? (
          <button
            className={`win-btn update-btn${updateState === 'downloaded' ? ' ready' : ''}`}
            title={updateTip}
            disabled={updateState === 'downloading'}
            data-testid="btn-update"
            onClick={onUpdateClick}
          >
            {updateState === 'downloaded' ? '⟳' : '⇩'} {updateLabel}
          </button>
        ) : null}
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
