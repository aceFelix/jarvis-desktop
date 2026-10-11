// @vitest-environment jsdom
/**
 * 管家服务组件测试（2026-10 改版：标题栏「设置」旁按钮 → 右栏管家服务面板；
 * 服务项「邮箱服务」内嵌 当前邮箱概览 + 邮箱配置 / 发送邮件 两个子标签）。
 *
 * 覆盖：
 * - uiStore：openButler / closeButler 切换 rightView；
 * - butlerStore：openService / closeService（面板内服务视图）；
 * - TitleBar 管家服务按钮：未连后端置灰；点击进面板、再点退出（toggle）；
 * - ButlerPanel：默认渲染服务清单；点「邮箱服务」进服务视图；挂载重置回清单；
 *   ← 返回回信息面板；
 * - EmailServicePanel：当前邮箱概览（发件邮箱回退 smtp_user / SMTP / 状态 /
 *   授权码）；子标签切换（配置 ↔ 发送）；离线态提示；
 * - EmailConfigForm：字段回填、保存组补丁、授权码留空不带、端口本地校验、成功态；
 * - EmailForm：主题/正文必填拦截；提交调用 backendStore.sendEmail；成功态；失败态。
 *
 * 后端 client 保持 null：只验证 UI 事件路由到 store 动作，指令收发在
 * backendStore.test.ts 覆盖（sendEmail / fetchEmailConfig / saveEmailConfig）。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import TitleBar from '@renderer/components/TitleBar'
import ButlerPanel from '@renderer/components/ButlerPanel'
import EmailServicePanel from '@renderer/components/EmailServicePanel'
import EmailConfigForm from '@renderer/components/EmailConfigForm'
import EmailForm from '@renderer/components/EmailForm'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useButlerStore } from '@renderer/stores/butlerStore'
import { useUiStore } from '@renderer/stores/uiStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

/** 造一个邮箱配置快照（结构对齐 contracts.EmailConfig），可按需覆盖字段。 */
function makeConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    smtp_host: 'smtp.163.com',
    smtp_port: 465,
    smtp_user: 'me@163.com',
    sender: '',
    default_recipient: '',
    has_password: false,
    ...over
  }
}

/** 注入假 fetchEmailConfig（默认回一份配置），避免真连后端。 */
function injectFetchEmailConfig(config: unknown = makeConfig()): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(config)
  useBackendStore.setState({ fetchEmailConfig: fn } as never)
  return fn
}

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
  it('默认渲染服务清单（含「邮箱服务」入口）', () => {
    render(<ButlerPanel />)
    expect(screen.getByTestId('butler-view')).toBeInTheDocument()
    expect(screen.getByTestId('butler-service-list')).toBeInTheDocument()
    expect(screen.getByTestId('btn-butler-email')).toHaveTextContent('邮箱服务')
  })

  it('挂载时重置回服务清单（不残留上次打开的服务视图）', () => {
    useButlerStore.setState({ activeService: 'email' })
    render(<ButlerPanel />)
    expect(screen.getByTestId('butler-service-list')).toBeInTheDocument()
    expect(screen.queryByTestId('email-service')).not.toBeInTheDocument()
  })

  it('点「邮箱服务」→ 渲染邮箱服务视图（清单收起）', () => {
    injectFetchEmailConfig()
    render(<ButlerPanel />)
    fireEvent.click(screen.getByTestId('btn-butler-email'))

    expect(useButlerStore.getState().activeService).toBe('email')
    expect(screen.getByTestId('email-service')).toBeInTheDocument()
    expect(screen.queryByTestId('butler-service-list')).not.toBeInTheDocument()
  })

  it('← 返回按钮回信息面板（closeButler）', () => {
    useUiStore.setState({ rightView: 'butler' })
    render(<ButlerPanel />)
    fireEvent.click(screen.getByTestId('btn-butler-back'))

    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

describe('EmailServicePanel', () => {
  it('当前邮箱概览：发件邮箱取 sender、留空回退 smtp_user；显示 SMTP/状态/授权码', async () => {
    injectFetchEmailConfig(makeConfig({ sender: 'boss@163.com', has_password: true }))
    render(<EmailServicePanel />)

    await waitFor(() => expect(screen.getByTestId('email-overview')).toBeInTheDocument())
    expect(screen.getByTestId('email-overview-current')).toHaveTextContent('boss@163.com')
    expect(screen.getByTestId('email-overview')).toHaveTextContent('smtp.163.com:465')
    expect(screen.getByTestId('email-overview')).toHaveTextContent('已配置')
  })

  it('sender 留空时当前邮箱回退到 smtp_user', async () => {
    injectFetchEmailConfig(makeConfig({ sender: '', smtp_user: 'me@163.com' }))
    render(<EmailServicePanel />)

    await waitFor(() => expect(screen.getByTestId('email-overview-current')).toBeInTheDocument())
    expect(screen.getByTestId('email-overview-current')).toHaveTextContent('me@163.com')
  })

  it('默认「邮箱配置」标签渲染配置表单；切到「发送邮件」标签渲染发送表单', async () => {
    injectFetchEmailConfig()
    render(<EmailServicePanel />)

    await waitFor(() => expect(screen.getByTestId('email-config-form')).toBeInTheDocument())
    expect(screen.queryByTestId('email-form')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('email-tab-send'))
    expect(screen.getByTestId('email-form')).toBeInTheDocument()
    expect(screen.queryByTestId('email-config-form')).not.toBeInTheDocument()
  })

  it('配置拉取失败（离线）：显离线提示', async () => {
    injectFetchEmailConfig(null)
    render(<EmailServicePanel />)

    await waitFor(() => expect(screen.getByTestId('email-service-offline')).toBeInTheDocument())
  })

  it('子返回按钮回服务清单（closeService）', async () => {
    injectFetchEmailConfig()
    useButlerStore.setState({ activeService: 'email' })
    render(<EmailServicePanel />)
    fireEvent.click(screen.getByTestId('btn-email-service-back'))

    expect(useButlerStore.getState().activeService).toBe('')
  })
})

describe('EmailConfigForm', () => {
  /** 注入 saveEmailConfig 假动作（返回可配置），避免真连后端。 */
  function injectSaveEmailConfig(res: {
    ok: boolean
    error?: string
    config?: Record<string, unknown>
  }): ReturnType<typeof vi.fn> {
    const fn = vi.fn().mockResolvedValue(res)
    useBackendStore.setState({ saveEmailConfig: fn } as never)
    return fn
  }

  it('字段按当前配置回填', () => {
    render(<EmailConfigForm config={makeConfig() as never} onSaved={vi.fn()} />)
    expect(screen.getByTestId('email-config-host')).toHaveValue('smtp.163.com')
    expect(screen.getByTestId('email-config-port')).toHaveValue('465')
    expect(screen.getByTestId('email-config-user')).toHaveValue('me@163.com')
    expect(screen.getByTestId('email-config-enabled')).toHaveAttribute('aria-checked', 'true')
  })

  it('保存：组补丁调 saveEmailConfig；授权码留空时补丁不含 smtp_password', async () => {
    const save = injectSaveEmailConfig({ ok: true, config: makeConfig({ sender: 'x@163.com' }) })
    const onSaved = vi.fn()
    render(<EmailConfigForm config={makeConfig() as never} onSaved={onSaved} />)

    fireEvent.change(screen.getByTestId('email-config-sender'), { target: { value: 'x@163.com' } })
    fireEvent.click(screen.getByTestId('email-config-save'))

    await waitFor(() => expect(screen.getByTestId('email-config-saved')).toBeInTheDocument())
    const patch = save.mock.calls[0][0] as Record<string, unknown>
    expect(patch).toMatchObject({
      enabled: true,
      smtp_host: 'smtp.163.com',
      smtp_port: 465,
      smtp_user: 'me@163.com',
      sender: 'x@163.com'
    })
    expect(patch).not.toHaveProperty('smtp_password')
    expect(onSaved).toHaveBeenCalled()
  })

  it('保存：填入授权码时补丁携带 smtp_password', async () => {
    const save = injectSaveEmailConfig({ ok: true, config: makeConfig() })
    render(<EmailConfigForm config={makeConfig() as never} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByTestId('email-config-password'), { target: { value: 'abcd1234' } })
    fireEvent.click(screen.getByTestId('email-config-save'))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect((save.mock.calls[0][0] as Record<string, unknown>).smtp_password).toBe('abcd1234')
  })

  it('端口非法：本地拦截显示错误、不调 saveEmailConfig', () => {
    const save = injectSaveEmailConfig({ ok: true })
    render(<EmailConfigForm config={makeConfig() as never} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByTestId('email-config-port'), { target: { value: '99999' } })
    fireEvent.click(screen.getByTestId('email-config-save'))

    expect(screen.getByTestId('email-config-error')).toHaveTextContent('SMTP 端口需为 1-65535 的整数')
    expect(save).not.toHaveBeenCalled()
  })

  it('保存失败：内联显示错误', async () => {
    injectSaveEmailConfig({ ok: false, error: 'settings.toml 落盘失败' })
    render(<EmailConfigForm config={makeConfig() as never} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByTestId('email-config-save'))

    await waitFor(() =>
      expect(screen.getByTestId('email-config-error')).toHaveTextContent('settings.toml 落盘失败')
    )
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
