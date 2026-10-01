/**
 * 跨设备协同连接二维码卡片 —— 内联显示在中间聊天区（消息流 kind:'qrcode'）。
 *
 * 职责：把后端 qrcode 事件推来的 url 画成二维码，引导用户扫码连接；
 * - 手机 / 微信通道一致：二维码 + 扫码提示，扫上即连（微信配对码为服务端偶发
 *   兜底步骤，桌面不再内联输入，正常扫码即可完成登录）；
 * - connected 置真（手机 WS 客户端真正接入 / 微信登录成功的 remote_state 事件）后
 *   收起二维码改显「✓ 已连接」；
 * - 二维码用 qrcode 库生成 dataURL 交给 <img>，前景/背景色读皮肤 --qr-code-* 变量
 *   随主题联动；生成失败回退显示原始 url，保证用户始终有可操作的连接入口。
 *
 * @author aceFelix
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { MessageItem } from '../stores/chatStore'
import { useT } from '../i18n'

/** 二维码消息项窄化类型（chatStore 判别联合）。 */
type QrcodeItem = Extract<MessageItem, { kind: 'qrcode' }>

export default function QrcodeCard({ item }: { item: QrcodeItem }): JSX.Element {
  const t = useT()
  const [dataUrl, setDataUrl] = useState('')
  const isWechat = item.channel === 'wechat'

  // url → 二维码 dataURL。前景/背景色读当前皮肤的 --qr-code-dark / --qr-code-light
  // 变量（缺省回退黑白保证可扫描），并监听 <html data-theme> 变化重绘，实现换肤联动。
  useEffect(() => {
    let alive = true
    const draw = (): void => {
      const cs = getComputedStyle(document.documentElement)
      const dark = cs.getPropertyValue('--qr-code-dark').trim() || '#000000'
      const light = cs.getPropertyValue('--qr-code-light').trim() || '#ffffff'
      setDataUrl('')
      QRCode.toDataURL(item.url, { margin: 1, width: 220, color: { dark, light } })
        .then((u) => {
          if (alive) setDataUrl(u)
        })
        .catch(() => {
          if (alive) setDataUrl('')
        })
    }
    draw()
    // 换肤时 data-theme 属性变化 → 重绘以拿到新主题色（jsdom 无 MutationObserver 问题）
    const mo = new MutationObserver(draw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      alive = false
      mo.disconnect()
    }
  }, [item.url])

  const titleKey = isWechat ? 'chat.qr.wechatTitle' : 'chat.qr.phoneTitle'

  return (
    <div
      className={`message qrcode-card${item.connected ? ' connected' : ''}`}
      data-testid={`qrcode-card-${item.channel}`}
    >
      <div className="message-label">{t(titleKey)}</div>

      {item.connected ? (
        <div className="qr-connected" data-testid="qr-connected">
          {t('chat.qr.connected')}
        </div>
      ) : (
        <>
          {dataUrl ? (
            <img className="qr-img" src={dataUrl} alt={t(titleKey)} data-testid="qr-img" />
          ) : (
            <div className="qr-fallback">
              {t('chat.qr.urlFallback')}
              <code>{item.url}</code>
            </div>
          )}
          <div className="qr-tip">
            {t(isWechat ? 'chat.qr.wechatScanTip' : 'chat.qr.scanTip')}
          </div>
        </>
      )}
    </div>
  )
}
