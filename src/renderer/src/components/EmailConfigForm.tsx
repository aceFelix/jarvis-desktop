/**
 * 管家服务·邮箱服务面板 →「邮箱配置」子视图（面板内嵌）。
 *
 * 表单承载 settings.toml `[email]` 全部字段：启用开关 + SMTP 服务器/端口 +
 * 发件邮箱（账号）+ 授权码 + 发件人显示名 + 默认收件人；保存调
 * backendStore.saveEmailConfig（email.config.set），成功后用后端回读快照
 * （含 has_password）刷新草稿。授权码沿用「明文不回传、留空即保持原值」范式
 * （与模型编辑 api_key 同口径）：仅当用户实际输入时才随补丁提交。
 *
 * 端口在本地先校验（1-65535 整数），不合法不入后端；其余字段信任后端二次校验。
 * 结构复用设置/模型表单既有样式类（.settings-panel/.setting-row/.setting-label/
 * .setting-hint/.model-input/.model-form-actions/.model-form-error/.toggle），
 * 邮箱服务专属样式见 styles/butler.css。
 *
 * @author aceFelix
 */

import { useEffect, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useT } from '../i18n'
import type { EmailConfig, EmailConfigPatch } from '../../../shared/contracts'

/** 组件 props：当前配置快照 + 保存成功后的回读快照回填。 */
interface Props {
  /** 后端回读的当前配置（含 has_password，不含授权码明文）。 */
  config: EmailConfig
  /** 保存成功回调：父组件据此更新概览卡与本地 config。 */
  onSaved: (config: EmailConfig) => void
}

/** 端口合法范围（与后端 email_settings.PORT_MIN/PORT_MAX 同口径）。 */
const PORT_MIN = 1
const PORT_MAX = 65535

export default function EmailConfigForm({ config, onSaved }: Props): JSX.Element {
  const t = useT()
  const saveEmailConfig = useBackendStore((s) => s.saveEmailConfig)

  // 草稿态：进入即用当前快照回填；config 后续变化（保存后回读）时同步刷新
  const [enabled, setEnabled] = useState(config.enabled)
  const [smtpHost, setSmtpHost] = useState(config.smtp_host)
  const [smtpPort, setSmtpPort] = useState(String(config.smtp_port))
  const [smtpUser, setSmtpUser] = useState(config.smtp_user)
  const [smtpPassword, setSmtpPassword] = useState('')
  const [sender, setSender] = useState(config.sender)
  const [defaultRecipient, setDefaultRecipient] = useState(config.default_recipient)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // 配置快照变化（保存成功回读 / 父组件重新拉取）时重置草稿，授权码清空
  useEffect(() => {
    setEnabled(config.enabled)
    setSmtpHost(config.smtp_host)
    setSmtpPort(String(config.smtp_port))
    setSmtpUser(config.smtp_user)
    setSender(config.sender)
    setDefaultRecipient(config.default_recipient)
    setSmtpPassword('')
    setError('')
  }, [config])

  /** 提交保存：本地校验端口 → 组补丁（授权码空则不带） → saveEmailConfig。 */
  const submit = async (): Promise<void> => {
    const port = Number(smtpPort)
    if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
      setError(t('butler.emailConfig.portInvalid'))
      setSaved(false)
      return
    }
    setError('')
    setSaving(true)

    const patch: EmailConfigPatch = {
      enabled,
      smtp_host: smtpHost.trim(),
      smtp_port: port,
      smtp_user: smtpUser.trim(),
      sender: sender.trim(),
      default_recipient: defaultRecipient.trim()
    }
    // 授权码留空 = 保持原值不变：仅在用户实际输入时才随补丁提交
    if (smtpPassword) patch.smtp_password = smtpPassword

    const res = await saveEmailConfig(patch)
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      if (res.config) onSaved(res.config)
    } else {
      setSaved(false)
      setError(res.error ?? t('butler.emailConfig.saveFailed'))
    }
  }

  return (
    <div className="settings-panel" data-testid="email-config-form">
      <div className="setting-row">
        <span className="setting-label">{t('butler.emailConfig.enabled')}</span>
        <div className="setting-hint">{t('butler.emailConfig.enabledHint')}</div>
        <button
          role="switch"
          aria-checked={enabled}
          className={`toggle${enabled ? ' on' : ''}`}
          data-testid="email-config-enabled"
          onClick={() => {
            setEnabled((v) => !v)
            setSaved(false)
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('butler.emailConfig.smtpHost')}</span>
        <input
          className="model-input"
          data-testid="email-config-host"
          placeholder={t('butler.emailConfig.smtpHostPlaceholder')}
          value={smtpHost}
          onChange={(e) => {
            setSmtpHost(e.target.value)
            if (error) setError('')
            if (saved) setSaved(false)
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('butler.emailConfig.smtpPort')}</span>
        <input
          className="model-input"
          data-testid="email-config-port"
          inputMode="numeric"
          placeholder={t('butler.emailConfig.smtpPortPlaceholder')}
          value={smtpPort}
          onChange={(e) => {
            setSmtpPort(e.target.value)
            if (error) setError('')
            if (saved) setSaved(false)
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('butler.emailConfig.smtpUser')}</span>
        <div className="setting-hint">{t('butler.emailConfig.smtpUserHint')}</div>
        <input
          className="model-input"
          data-testid="email-config-user"
          placeholder={t('butler.emailConfig.smtpUserPlaceholder')}
          value={smtpUser}
          onChange={(e) => {
            setSmtpUser(e.target.value)
            if (error) setError('')
            if (saved) setSaved(false)
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('butler.emailConfig.smtpPassword')}</span>
        <div className="setting-hint">
          {config.has_password
            ? t('butler.emailConfig.smtpPasswordHintSet')
            : t('butler.emailConfig.smtpPasswordHint')}
        </div>
        <input
          className="model-input"
          type="password"
          data-testid="email-config-password"
          placeholder={
            config.has_password
              ? t('butler.emailConfig.smtpPasswordPlaceholderSet')
              : t('butler.emailConfig.smtpPasswordPlaceholder')
          }
          value={smtpPassword}
          onChange={(e) => {
            setSmtpPassword(e.target.value)
            if (error) setError('')
            if (saved) setSaved(false)
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('butler.emailConfig.sender')}</span>
        <div className="setting-hint">{t('butler.emailConfig.senderHint')}</div>
        <input
          className="model-input"
          data-testid="email-config-sender"
          placeholder={t('butler.emailConfig.senderPlaceholder')}
          value={sender}
          onChange={(e) => {
            setSender(e.target.value)
            if (error) setError('')
            if (saved) setSaved(false)
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('butler.emailConfig.defaultRecipient')}</span>
        <div className="setting-hint">{t('butler.emailConfig.defaultRecipientHint')}</div>
        <input
          className="model-input"
          data-testid="email-config-recipient"
          placeholder={t('butler.emailConfig.defaultRecipientPlaceholder')}
          value={defaultRecipient}
          onChange={(e) => {
            setDefaultRecipient(e.target.value)
            if (error) setError('')
            if (saved) setSaved(false)
          }}
        />
      </div>

      {error ? (
        <div className="model-form-error" data-testid="email-config-error">
          {error}
        </div>
      ) : null}

      {saved && !error ? (
        <div className="butler-email-sent" data-testid="email-config-saved">
          {t('butler.emailConfig.saved')}
        </div>
      ) : null}

      <div className="model-form-actions">
        <button
          className="action-btn primary"
          data-testid="email-config-save"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? t('butler.emailConfig.saving') : t('butler.emailConfig.save')}
        </button>
      </div>
    </div>
  )
}
