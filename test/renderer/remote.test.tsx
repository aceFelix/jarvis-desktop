// @vitest-environment jsdom
/**
 * 跨设备协同组件测试（2026-10 桌面接入手机 / 微信连接）。
 *
 * 覆盖：
 * - RemoteConnectMenu：未连后端置灰；点开菜单；手机/微信「连接 / 断开」按当前
 *   连接态路由到 backendStore 对应动作；动作后菜单自动收起；
 * - QrcodeCard：已连接显「✓ 已连接」；手机 / 微信通道一致，仅二维码 + 提示（桌面已
 *   去掉微信配对码内联输入，正常扫码即连）；二维码生成（jsdom 无 canvas）
 *   失败时回退显示原始 url。
 *
 * 后端 client 保持 null：只验证 UI 事件路由到 store 动作，指令收发在别处覆盖。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import RemoteConnectMenu from '@renderer/components/RemoteConnectMenu'
import QrcodeCard from '@renderer/components/QrcodeCard'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useRemoteStore } from '@renderer/stores/remoteStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useChatStore } from '@renderer/stores/chatStore'

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh')
  useRemoteStore.setState({ phoneConnected: false, wechatConnected: false })
  useChatStore.getState().clear()
  // 默认已连上后端，避免按钮被置灰挡掉交互
  useBackendStore.setState({ client: null, wsConnected: true })
})

afterEach(() => {
  cleanup()
})

describe('RemoteConnectMenu', () => {
  it('未连后端时触发按钮置灰', () => {
    useBackendStore.setState({ wsConnected: false })
    render(<RemoteConnectMenu />)
    const trigger = within(screen.getByTestId('remote-menu')).getByRole('button')
    expect(trigger).toBeDisabled()
  })

  it('点开菜单显示手机 / 微信两行', () => {
    render(<RemoteConnectMenu />)
    fireEvent.click(within(screen.getByTestId('remote-menu')).getByRole('button'))
    const pop = screen.getByTestId('remote-menu-pop')
    expect(within(pop).getByText('手机')).toBeInTheDocument()
    expect(within(pop).getByText('微信')).toBeInTheDocument()
  })

  it('未连接点手机行「连接」→ 调 connectPhone 并收起菜单', () => {
    const connectPhone = vi.fn().mockResolvedValue(undefined)
    useBackendStore.setState({ connectPhone } as never)
    render(<RemoteConnectMenu />)
    fireEvent.click(within(screen.getByTestId('remote-menu')).getByRole('button'))
    fireEvent.click(screen.getByTestId('btn-connect-phone'))
    expect(connectPhone).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('remote-menu-pop')).not.toBeInTheDocument()
  })

  it('已连接点微信行「断开」→ 调 disconnectWechat', () => {
    const disconnectWechat = vi.fn().mockResolvedValue(undefined)
    useBackendStore.setState({ disconnectWechat } as never)
    useRemoteStore.setState({ wechatConnected: true })
    render(<RemoteConnectMenu />)
    fireEvent.click(within(screen.getByTestId('remote-menu')).getByRole('button'))
    fireEvent.click(screen.getByTestId('btn-connect-wechat'))
    expect(disconnectWechat).toHaveBeenCalledTimes(1)
  })

  it('有已连接通道时触发按钮显示徽标计数', () => {
    useRemoteStore.setState({ phoneConnected: true })
    render(<RemoteConnectMenu />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})

describe('QrcodeCard', () => {
  it('已连接卡片显「✓ 已连接」，不渲染二维码与输入', () => {
    render(
      <QrcodeCard
        item={{ kind: 'qrcode', id: 1, channel: 'phone', url: 'http://x/?token=1', connected: true }}
      />
    )
    expect(screen.getByTestId('qr-connected')).toHaveTextContent('已连接')
    expect(screen.queryByTestId('btn-wechat-pairing')).not.toBeInTheDocument()
  })

  it('微信未连接卡片与手机一致：仅二维码 + 提示，无配对码输入', async () => {
    render(
      <QrcodeCard
        item={{ kind: 'qrcode', id: 2, channel: 'wechat', url: 'weixin://x?token=abc', connected: false }}
      />
    )
    // 桌面已去掉配对码内联输入（正常扫码即连），微信卡片不再出现输入框 / 提交按钮
    expect(screen.queryByTestId('wechat-pairing-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-wechat-pairing')).not.toBeInTheDocument()
    // jsdom 无 canvas → 回退显示原始 url
    await vi.waitFor(() =>
      expect(screen.getByTestId('qrcode-card-wechat')).toHaveTextContent('token=abc'),
    )
  })

  it('手机未连接：无配对码输入；二维码生成失败回退显示 url', async () => {
    render(
      <QrcodeCard
        item={{ kind: 'qrcode', id: 4, channel: 'phone', url: 'http://127.0.0.1/?token=abc', connected: false }}
      />
    )
    // 手机通道不显示配对码提交按钮
    expect(screen.queryByTestId('btn-wechat-pairing')).not.toBeInTheDocument()
    // jsdom 无 canvas，toDataURL 走回退分支：最终展示原始 url（.qr-fallback）
    await vi.waitFor(() => expect(screen.getByTestId('qrcode-card-phone')).toHaveTextContent('token=abc'))
  })
})
