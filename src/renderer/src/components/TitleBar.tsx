/**
 * 自绘标题栏（无边框窗口）：整条可拖动（-webkit-app-region: drag），
 * 窗口控制按钮经 preload IPC 转给主进程。
 *
 * 无全屏按钮：窗口即普通可缩放窗口，全屏诉求走系统快捷键（与 workbench
 * "不提供全屏"的口径一致）。
 *
 * @author aceFelix
 */

export default function TitleBar(): JSX.Element {
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
        <span id="title-sub">· 桌面工作台</span>
      </span>
      <div id="win-controls">
        <button className="win-btn" title="最小化" onClick={minimize}>
          ─
        </button>
        <button className="win-btn close" title="关闭（隐藏到托盘）" onClick={close}>
          ✕
        </button>
      </div>
    </header>
  )
}
