/**
 * 管家服务·邮箱服务面板（ButlerPanel 内嵌，替换原直接渲染的 EmailForm）。
 *
 * 三层结构：
 * - 子返回头（← 回服务清单，调 butlerStore.closeService）+ 服务名「邮箱服务」；
 * - 「当前邮箱」概览卡：发件邮箱（sender 留空回退 smtp_user）/ SMTP host:port /
 *   启用状态 / 授权码是否已配置 —— 让用户一眼看到当前正在使用的邮箱；
 * - 两个子标签：「邮箱配置」（EmailConfigForm，查看并修改邮箱与 SMTP 配置）/
 *   「发送邮件」（复用 EmailForm）。
 *
 * 挂载即经 backendStore.fetchEmailConfig 拉取配置快照（离线/失败回 null →
 * 概览区显离线态，标签仍可见但配置表单换离线提示）。配置数据由本组件持有，
 * 不新增全局 store 状态，离开面板即随卸载丢弃，重进重新拉取。
 *
 * @author aceFelix
 */

import { useCallback, useEffect, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useButlerStore } from '../stores/butlerStore'
import { useT } from '../i18n'
import EmailConfigForm from './EmailConfigForm'
import EmailForm from './EmailForm'
import type { EmailConfig } from '../../../shared/contracts'

/** 面板内子视图：'config'=邮箱配置；'send'=发送邮件。 */
type EmailTab = 'config' | 'send'

export default function EmailServicePanel(): JSX.Element {
  const t = useT()
  const closeService = useButlerStore((s) => s.closeService)
  const fetchEmailConfig = useBackendStore((s) => s.fetchEmailConfig)

  const [tab, setTab] = useState<EmailTab>('config')
  const [config, setConfig] = useState<EmailConfig | null>(null)
  const [loading, setLoading] = useState(true)

  /** 拉取当前邮箱配置快照（离线/失败回 null，概览与表单显离线态）。 */
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    const c = await fetchEmailConfig()
    setConfig(c)
    setLoading(false)
  }, [fetchEmailConfig])

  useEffect(() => {
    void reload()
  }, [reload])

  // 发件邮箱：优先取发件人显示配置（sender），留空回退账号（smtp_user）
  const fromAddress = config ? config.sender.trim() || config.smtp_user.trim() : ''

  return (
    <div className="settings-panel" data-testid="email-service">
      {/* 子返回头：回服务清单（不退出整个管家面板） */}
      <div className="butler-subhead">
        <button
          className="settings-back"
          data-testid="btn-email-service-back"
          title={t('butler.emailService.back')}
          onClick={closeService}
        >
          ←
        </button>
        <span className="col-title">{t('butler.service.email')}</span>
      </div>

      {loading ? (
        <div className="side-empty" data-testid="email-service-loading">
          {t('butler.emailService.loading')}
        </div>
      ) : !config ? (
        <div className="side-empty" data-testid="email-service-offline">
          {t('butler.emailService.offline')}
        </div>
      ) : (
        <>
          {/* 当前邮箱概览：发件邮箱 / SMTP / 状态 / 授权码 */}
          <div className="butler-overview" data-testid="email-overview">
            <div className="butler-overview-row">
              <span className="butler-overview-key">{t('butler.emailService.current')}</span>
              <span className="butler-overview-value" data-testid="email-overview-current">
                {fromAddress || t('butler.emailService.notConfigured')}
              </span>
            </div>
            <div className="butler-overview-row">
              <span className="butler-overview-key">{t('butler.emailService.smtp')}</span>
              <span className="butler-overview-value">
                {config.smtp_host ? `${config.smtp_host}:${config.smtp_port}` : t('butler.emailService.notConfigured')}
              </span>
            </div>
            <div className="butler-overview-row">
              <span className="butler-overview-key">{t('butler.emailService.status')}</span>
              <span className="butler-overview-value">
                {config.enabled ? t('butler.emailService.enabledOn') : t('butler.emailService.enabledOff')}
              </span>
            </div>
            <div className="butler-overview-row">
              <span className="butler-overview-key">{t('butler.emailService.password')}</span>
              <span className="butler-overview-value">
                {config.has_password
                  ? t('butler.emailService.passwordSet')
                  : t('butler.emailService.passwordUnset')}
              </span>
            </div>
          </div>

          {/* 子标签：邮箱配置 / 发送邮件 */}
          <div className="segmented butler-tabs">
            <button
              className={`seg-btn${tab === 'config' ? ' active' : ''}`}
              data-testid="email-tab-config"
              onClick={() => setTab('config')}
            >
              {t('butler.emailService.tabConfig')}
            </button>
            <button
              className={`seg-btn${tab === 'send' ? ' active' : ''}`}
              data-testid="email-tab-send"
              onClick={() => setTab('send')}
            >
              {t('butler.emailService.tabSend')}
            </button>
          </div>

          {tab === 'config' ? (
            <EmailConfigForm config={config} onSaved={setConfig} />
          ) : (
            <EmailForm />
          )}
        </>
      )}
    </div>
  )
}
