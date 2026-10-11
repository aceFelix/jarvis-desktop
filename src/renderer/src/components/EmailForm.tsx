/**
 * 管家服务·邮件发送表单（面板内嵌）—— 管家服务面板 →「邮件发送」服务视图。
 *
 * 交互：填写收件人/抄送/密送/主题/正文 → 点「发送」→ backendStore.sendEmail
 * 直连后端邮件工具（不经模型）。成功显示「✓ 邮件已发送」+「关闭」回服务清单；
 * 失败把错误内联显示、表单不关闭（可修正重试）。取消 → 回服务清单。
 *
 * 收件人留空时由后端回退到 settings.toml `[email].default_recipient`（提示见下）；
 * 主题/正文为本地必填拦截（与后端二次校验同口径）。首期不支持附件。
 *
 * 结构复用设置/模型表单的既有样式类（.settings-panel/.setting-row/.setting-label/
 * .setting-hint/.model-input/.model-form-actions），表单专属样式见 styles/butler.css。
 *
 * @author aceFelix
 */

import { useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useButlerStore } from '../stores/butlerStore'
import { useT } from '../i18n'

export default function EmailForm(): JSX.Element {
  const t = useT()
  const closeService = useButlerStore((s) => s.closeService)
  const sendEmail = useBackendStore((s) => s.sendEmail)

  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  /** 提交发送：本地校验主题/正文非空 → sendEmail → 成功态或内联错误。 */
  const submit = async (): Promise<void> => {
    if (!subject.trim() || !body.trim()) {
      setError(t('butler.email.required'))
      return
    }
    setError('')
    setSubmitting(true)
    const res = await sendEmail({ to, cc, bcc, subject, body })
    setSubmitting(false)
    if (res.ok) setSent(true)
    else setError(res.error ?? t('butler.email.offline'))
  }

  return (
    <div className="settings-panel" data-testid="email-form">
      {sent ? (
        <>
          <div className="butler-email-sent" data-testid="email-form-sent">
            {t('butler.email.sent')}
          </div>
          <div className="model-form-actions">
            <button className="action-btn primary" data-testid="email-form-done" onClick={closeService}>
              {t('butler.email.close')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="setting-row">
            <span className="setting-label">{t('butler.email.to')}</span>
            <div className="setting-hint">{t('butler.email.toHint')}</div>
            <input
              className="model-input"
              data-testid="email-form-to"
              placeholder={t('butler.email.toPlaceholder')}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">{t('butler.email.cc')}</span>
            <input
              className="model-input"
              data-testid="email-form-cc"
              placeholder={t('butler.email.ccPlaceholder')}
              value={cc}
              onChange={(e) => setCc(e.target.value)}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">{t('butler.email.bcc')}</span>
            <input
              className="model-input"
              data-testid="email-form-bcc"
              placeholder={t('butler.email.bccPlaceholder')}
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">{t('butler.email.subject')}</span>
            <input
              className="model-input"
              data-testid="email-form-subject"
              placeholder={t('butler.email.subjectPlaceholder')}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value)
                if (error) setError('')
              }}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">{t('butler.email.body')}</span>
            <textarea
              className="model-input butler-textarea"
              data-testid="email-form-body"
              rows={6}
              placeholder={t('butler.email.bodyPlaceholder')}
              value={body}
              onChange={(e) => {
                setBody(e.target.value)
                if (error) setError('')
              }}
            />
          </div>

          {error ? (
            <div className="model-form-error" data-testid="email-form-error">
              {error}
            </div>
          ) : null}

          <div className="model-form-actions">
            <button
              className="action-btn primary"
              data-testid="email-form-submit"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? t('butler.email.sending') : t('butler.email.submit')}
            </button>
            <button className="action-btn" data-testid="email-form-cancel" onClick={closeService}>
              {t('butler.email.cancel')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
