// @vitest-environment jsdom
/**
 * 管家服务组件测试（2026-10 改版：标题栏「设置」旁按钮 → 右栏管家服务面板，
 * 邮件发送表单内嵌面板，不再用下拉菜单 + 居中弹窗）。
 *
 * 覆盖：
 * - uiStore：openButler / closeButler 切换 rightView；
 * - butlerStore：openService / closeService（面板内服务视图）；
 * - TitleBar 管家服务按钮：未连后端置灰；点击进面板、再点退出（toggle）；
 * - ButlerPanel：默认渲染服务清单；点「邮件发送」进表单；挂载重置回清单；
 *   ← 返回回信息面板；
 * - EmailForm：主题/正文必填拦截；提交调用 backendStore.sendEmail；成功态
 *   （✓ 邮件已发送 + 关闭回清单）；失败态内联显示且表单不关闭；取消回清单。
 *
 * 后端 client 保持 null：只验证 UI 事件路由到 store 动作，指令收发在
 * backendStore.test.ts 覆盖（sendEmail）。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import TitleBar from '@renderer/components/TitleBar'
import ButlerPanel from '@renderer/components/ButlerPanel'
import EmailForm from '@renderer/components/EmailForm'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useButlerStore } from '@renderer/stores/butlerStore'
import { useUiStore } from '@renderer/stores/uiStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh')
  useButlerStore.setState({ activeService: '' })
  useUiStore.setState({ rightView: 'dashboard' })
  // 默认已连上后端，避免触发按钮被置灰挡掉交互
  useBackendStore.setState({ client: null, wsConnected: true })
})

afterEach(() => {
  cleanup()
})

describe('uiStore · 右栏视图', () => {
  it('openButler 进管家服务面板；closeButler 回信息面板', () => {
    useUiStore.getState().openButler()
    expect(useUiStore.getState().rightView).toBe('butler')
    useUiStore.getState().closeButler()
    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

describe('butlerStore', () => {
  it('openService 打开服务表单；closeService 回服务清单', () => {
    useButlerStore.getState().openService('email')
    expect(useButlerStore.getState().activeService).toBe('email')
    useButlerStore.getState().closeService()
    expect(useButlerStore.getState().activeService).toBe('')
  })
})

describe('TitleBar 管家服务按钮', () => {
  it('未连后端时置灰', () => {
    useBackendStore.setState({ wsConnected: false })
    render(<TitleBar />)
    expect(screen.getByTestId('btn-open-butler')).toBeDisabled()
  })

  it('点击进管家服务面板（rightView=butler、按钮高亮）；再点退出回信息面板', () => {
    render(<TitleBar />)
    const btn = screen.getByTestId('btn-open-butler')
    fireEvent.click(btn)
    expect(useUiStore.getState().rightView).toBe('butler')
    expect(btn.className).toContain('active')
    fireEvent.click(btn)
    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

describe('ButlerPanel', () => {
  it('默认渲染服务清单（含「邮件发送」入口）', () => {
    render(<ButlerPanel />)
    expect(screen.getByTestId('butler-view')).toBeInTheDocument()
    expect(screen.getByTestId('butler-service-list')).toBeInTheDocument()
    expect(screen.getByTestId('btn-butler-email')).toHaveTextContent('邮件发送')
  })

  it('挂载时重置回服务清单（不残留上次打开的表单）', () => {
    useButlerStore.setState({ activeService: 'email' })
    render(<ButlerPanel />)
    expect(screen.getByTestId('butler-service-list')).toBeInTheDocument()
    expect(screen.queryByTestId('email-form-subject')).not.toBeInTheDocument()
  })

  it('点「邮件发送」→ 渲染内嵌表单（清单收起）', () => {
    render(<ButlerPanel />)
    fireEvent.click(screen.getByTestId('btn-butler-email'))

    expect(useButlerStore.getState().activeService).toBe('email')
    expect(screen.getByTestId('email-form-subject')).toBeInTheDocument()
    expect(screen.queryByTestId('butler-service-list')).not.toBeInTheDocument()
  })

  it('← 返回按钮回信息面板（closeButler）', () => {
    useUiStore.setState({ rightView: 'butler' })
    render(<ButlerPanel />)
    fireEvent.click(screen.getByTestId('btn-butler-back'))

    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

describe('EmailForm', () => {
  /** 注入 sendEmail 假动作（返回可配置），避免真连后端。 */
  function injectSendEmail(res: { ok: boolean; error?: string }): ReturnType<typeof vi.fn> {
    const fn = vi.fn().mockResolvedValue(res)
    useBackendStore.setState({ sendEmail: fn } as never)
    return fn
  }

  /** 填入主题 + 正文（其余字段留空）。 */
  function fillRequired(subject = '标题', body = '正文'): void {
    fireEvent.change(screen.getByTestId('email-form-subject'), { target: { value: subject } })
    fireEvent.change(screen.getByTestId('email-form-body'), { target: { value: body } })
  }

  it('主题留空提交：本地拦截、显示必填错误、不调 sendEmail', async () => {
    const sendEmail = injectSendEmail({ ok: true })
    render(<EmailForm />)

    fireEvent.change(screen.getByTestId('email-form-body'), { target: { value: '正文' } })
    fireEvent.click(screen.getByTestId('email-form-submit'))

    expect(screen.getByTestId('email-form-error')).toHaveTextContent('主题和正文不能为空')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('正文留空提交：本地拦截、不调 sendEmail', () => {
    const sendEmail = injectSendEmail({ ok: true })
    render(<EmailForm />)

    fireEvent.change(screen.getByTestId('email-form-subject'), { target: { value: '标题' } })
    fireEvent.click(screen.getByTestId('email-form-submit'))

    expect(screen.getByTestId('email-form-error')).toBeInTheDocument()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('提交成功：调 sendEmail（携全部字段）并渲染发送成功态', async () => {
    const sendEmail = injectSendEmail({ ok: true })
    render(<EmailForm />)

    fireEvent.change(screen.getByTestId('email-form-to'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByTestId('email-form-cc'), { target: { value: 'c@b.com' } })
    fillRequired('周报', '本周内容')
    fireEvent.click(screen.getByTestId('email-form-submit'))

    await waitFor(() => expect(screen.getByTestId('email-form-sent')).toBeInTheDocument())
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      cc: 'c@b.com',
      bcc: '',
      subject: '周报',
      body: '本周内容'
    })
  })

  it('提交失败：内联显示错误、表单保持打开可修正', async () => {
    const sendEmail = injectSendEmail({ ok: false, error: '邮件功能未启用' })
    render(<EmailForm />)

    fillRequired()
    fireEvent.click(screen.getByTestId('email-form-submit'))

    await waitFor(() => expect(screen.getByTestId('email-form-error')).toHaveTextContent('邮件功能未启用'))
    // 表单未切成功态：字段仍在，可继续修改重试
    expect(screen.getByTestId('email-form-subject')).toBeInTheDocument()
    expect(screen.queryByTestId('email-form-sent')).not.toBeInTheDocument()
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('成功态点「关闭」/ 表单点「取消」回服务清单（closeService）', () => {
    useButlerStore.setState({ activeService: 'email' })
    render(<EmailForm />)

    fireEvent.click(screen.getByTestId('email-form-cancel'))
    expect(useButlerStore.getState().activeService).toBe('')
  })
})
