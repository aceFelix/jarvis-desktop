/**
 * 根组件：三栏布局装配 + 后端连接引导。
 *
 * 启动流：挂载即查询后端信息（可能已就绪）→ 订阅主进程状态推送 →
 * ready 时 backendStore 自动建立 WS 连接；未就绪期间显示启动遮罩
 * （spawning 进度 / error 诊断文案）。
 *
 * @author aceFelix
 */

import { useEffect } from 'react'
import ReactorCanvas from './components/ReactorCanvas'
import TitleBar from './components/TitleBar'
import LeftSidebar from './components/LeftSidebar'
import ChatArea from './components/ChatArea'
import RightSidebar from './components/RightSidebar'
import { useBackendStore } from './stores/backendStore'
import { useT } from './i18n'

/** 后端未就绪时的全屏遮罩（启动进度 / 错误诊断）。 */
function BootOverlay(): JSX.Element {
  const state = useBackendStore((s) => s.state)
  const error = useBackendStore((s) => s.error)
  const t = useT()
  return (
    <div id="boot-overlay" data-testid="boot-overlay">
      <div className="boot-card">
        <div className="boot-title">J.A.R.V.I.S</div>
        {state === 'error' || state === 'exited' ? (
          <>
            <div className="boot-error">{t('boot.error')}</div>
            <pre className="boot-detail">{error || t('boot.exited')}</pre>
            <div className="boot-hint">{t('boot.errorHint')}</div>
          </>
        ) : (
          <>
            <div className="boot-spinner" />
            <div className="boot-hint">{t('boot.loading')}</div>
          </>
        )}
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const applyBackendStatus = useBackendStore((s) => s.applyBackendStatus)
  const ready = useBackendStore((s) => s.state === 'ready')
  const wsConnected = useBackendStore((s) => s.wsConnected)

  useEffect(() => {
    const desktop = window.jarvisDesktop
    if (!desktop) return
    // 挂载即查一次（后端可能先于渲染进程就绪）
    void desktop.getBackendInfo().then((info) => {
      if (info) applyBackendStatus('ready', info)
    })
    // 订阅主进程状态推送（spawning/ready/error/exited）
    const unsubscribe = desktop.onBackendStatus((status) => {
      applyBackendStatus(status.state, status.info, status.error)
    })
    return unsubscribe
  }, [applyBackendStatus])

  return (
    <>
      <ReactorCanvas />
      <TitleBar />
      <div id="workbench">
        <LeftSidebar />
        <ChatArea />
        <RightSidebar />
      </div>
      {!ready || !wsConnected ? <BootOverlay /> : null}
    </>
  )
}
