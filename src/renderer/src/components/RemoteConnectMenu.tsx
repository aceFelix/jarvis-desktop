/**
 * 输入栏「跨设备协同」下拉按钮 —— 取代原 [LIV] 实时语音入口（左栏已有 [LIV]）。
 *
 * 职责：提供一个二选菜单（📱 手机 / 💬 微信），点选即发起对应通道的连接/断开。
 * - 连接态来自 remoteStore（init 时 refreshRemote 回填 + remote_state 事件实时刷新），
 *   决定每行显示「连接」还是「断开」，并在触发按钮上以连接数徽标提示；
 * - 连接动作是「入队即返回」：真正的 ensure_session + 起桥接在引擎串行落地，
 *   二维码经 qrcode 事件回到中间聊天区（QrcodeCard），此处不阻塞、不展示二维码；
 * - 点击菜单项后自动收起菜单（下一步在聊天区看码）。
 *
 * 卸载 / 外部点击都会关闭菜单，避免 popover 悬留。
 *
 * @author aceFelix
 */

import { useEffect, useRef, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useRemoteStore } from '../stores/remoteStore'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'

export default function RemoteConnectMenu(): JSX.Element {
  const t = useT()
  const g = useGlyphs()
  // 未连上后端时禁用（与原 [LIV] 麦克风按钮同口径：仅看 wsConnected）
  const wsConnected = useBackendStore((s) => s.wsConnected)
  const connectPhone = useBackendStore((s) => s.connectPhone)
  const disconnectPhone = useBackendStore((s) => s.disconnectPhone)
  const connectWechat = useBackendStore((s) => s.connectWechat)
  const disconnectWechat = useBackendStore((s) => s.disconnectWechat)
  const phoneConnected = useRemoteStore((s) => s.phoneConnected)
  const wechatConnected = useRemoteStore((s) => s.wechatConnected)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 已连接通道数（触发按钮徽标）
  const activeCount = (phoneConnected ? 1 : 0) + (wechatConnected ? 1 : 0)

  // 点击菜单外部收起
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  /** 执行一个连接/断开动作后收起菜单（动作本身入队即返回，不等待桥接结果）。 */
  const run = (fn: () => Promise<void>): void => {
    setOpen(false)
    void fn()
  }

  return (
    <div className="remote-menu" ref={rootRef} data-testid="remote-menu">
      <button
        className={`action-btn remote-menu-trigger${activeCount ? ' active' : ''}`}
        title={t('chat.connect.tip')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!wsConnected}
        onClick={() => setOpen((v) => !v)}
      >
        {g.link}
        {activeCount ? <span className="remote-menu-badge">{activeCount}</span> : null}
      </button>

      {open ? (
        <div className="remote-menu-pop" role="menu" data-testid="remote-menu-pop">
          {/* 手机通道行 */}
          <div className="remote-menu-row">
            <span className="remote-menu-label">
              {t('chat.connect.phone')}
              <em>{t('chat.connect.phoneTip')}</em>
            </span>
            <button
              className={`action-btn${phoneConnected ? ' danger' : ' primary'}`}
              data-testid="btn-connect-phone"
              onClick={() => run(phoneConnected ? disconnectPhone : connectPhone)}
            >
              {phoneConnected ? t('chat.connect.disconnect') : t('chat.connect.connect')}
            </button>
          </div>
          {/* 微信通道行 */}
          <div className="remote-menu-row">
            <span className="remote-menu-label">
              {t('chat.connect.wechat')}
              <em>{t('chat.connect.wechatTip')}</em>
            </span>
            <button
              className={`action-btn${wechatConnected ? ' danger' : ' primary'}`}
              data-testid="btn-connect-wechat"
              onClick={() => run(wechatConnected ? disconnectWechat : connectWechat)}
            >
              {wechatConnected ? t('chat.connect.disconnect') : t('chat.connect.connect')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
