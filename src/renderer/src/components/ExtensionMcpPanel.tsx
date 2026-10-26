/**
 * 扩展服务 · MCP 服务面板（ExtensionPanel 内嵌子面板）。
 *
 * 完整管理 `~/.jarvis/mcp.json` 里的 MCP server：清单（名称 / 命令 / 状态 / 工具数）+
 * 新增 / 编辑 / 删除 / 启用禁用。启用禁用写后端独立禁用名单
 * `~/.jarvis/mcp_disabled.json`（不改 mcp.json，规避触碰含明文占位 token 的配置），
 * 连接态由后端 mcp.list 快照回传。
 *
 * 交互沿用清单-表单两级：清单页（+ 「新增服务」按钮）⇄ 表单页（新增/编辑共用，
 * 编辑时名不可改——名字是 mcp.json 的键）。删除走「两步确认」（点删除 → 就地变
 * 「确认删除」，再点才真删，与左栏模型删除同口径）。
 *
 * 取数/写操作均经 backendStore.runExtension → extensions.exec，错误内联展示，
 * 不写进聊天流。@author aceFelix
 */

import { useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useT } from '../i18n'
import { ExtensionSubhead, useExtensionData } from './extensionShared'
import type { McpListData, McpServerItem } from '../../../shared/extension-contracts'

/** 表单页状态：null=清单页；'new'=新增；McpServerItem=编辑该 server。 */
type FormTarget = null | 'new' | McpServerItem

export default function ExtensionMcpPanel(): JSX.Element {
  const t = useT()
  const runExtension = useBackendStore((s) => s.runExtension)
  const { data, loading, error, reload } = useExtensionData<McpListData>('mcp', 'list')
  const [target, setTarget] = useState<FormTarget>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [fail, setFail] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')

  /** 清空操作反馈（列表操作前调用）。 */
  const clearFeedback = (): void => {
    setNotice('')
    setFail('')
  }

  /**
   * 执行一次 MCP 写操作（enable/disable/remove）：成功后刷新清单并提示。
   *
   * @param action 动作名（enable/disable/remove）。
   * @param name 目标 server 名。
   * @author aceFelix
   */
  const runWrite = async (action: string, name: string): Promise<void> => {
    clearFeedback()
    setBusy(`${action}:${name}`)
    const env = await runExtension('mcp', action, { name })
    setBusy('')
    setPendingDelete('')
    if (env.ok) {
      setNotice(env.message ?? '')
      await reload()
    } else {
      setFail(env.message ?? t('extension.failed'))
    }
  }

  const servers = data?.servers ?? []

  return (
    <div className="settings-panel" data-testid="extension-mcp">
      <ExtensionSubhead titleKey="extension.cat.mcp" />

      {target === null ? (
        <>
          {/* 配置路径 + 总开关概览 */}
          {data ? (
            <div className="butler-overview" data-testid="mcp-overview">
              <div className="butler-overview-row">
                <span className="butler-overview-key">{t('extension.mcp.configPath')}</span>
                <span className="butler-overview-value">{data.config_path}</span>
              </div>
              <div className="butler-overview-row">
                <span className="butler-overview-key">{t('extension.mcp.switch')}</span>
                <span className="butler-overview-value">
                  {data.enabled ? t('extension.mcp.enabledOn') : t('extension.mcp.enabledOff')}
                </span>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="side-empty" data-testid="mcp-loading">
              {t('extension.loading')}
            </div>
          ) : error ? (
            <div className="side-empty" data-testid="mcp-error">
              {error}
            </div>
          ) : servers.length === 0 ? (
            <div className="side-empty" data-testid="mcp-empty">
              {t('extension.mcp.empty')}
            </div>
          ) : (
            <div className="extension-list" data-testid="mcp-list">
              {servers.map((s) => (
                <div className="extension-row" key={s.name} data-testid={`mcp-item-${s.name}`}>
                  <div className="extension-row-main">
                    <span className="extension-row-name">{s.name}</span>
                    <span className="extension-row-desc">
                      {s.command} {s.args.join(' ')}
                    </span>
                    <span className="extension-row-meta">
                      {s.connected
                        ? t('extension.mcp.connected', { n: s.tools.length })
                        : t('extension.mcp.disconnected')}
                      {' · '}
                      {s.disabled ? t('extension.mcp.disabled') : t('extension.mcp.enabled')}
                    </span>
                  </div>
                  <div className="extension-row-actions">
                    <button
                      className="action-btn"
                      data-testid={`mcp-edit-${s.name}`}
                      disabled={!!busy}
                      onClick={() => {
                        clearFeedback()
                        setTarget(s)
                      }}
                    >
                      {t('extension.edit')}
                    </button>
                    <button
                      className="action-btn"
                      data-testid={`mcp-toggle-${s.name}`}
                      disabled={!!busy}
                      onClick={() => void runWrite(s.disabled ? 'enable' : 'disable', s.name)}
                    >
                      {s.disabled ? t('extension.enable') : t('extension.disable')}
                    </button>
                    <button
                      className="action-btn danger"
                      data-testid={`mcp-delete-${s.name}`}
                      disabled={!!busy}
                      onClick={() => {
                        clearFeedback()
                        if (pendingDelete === s.name) void runWrite('remove', s.name)
                        else setPendingDelete(s.name)
                      }}
                    >
                      {pendingDelete === s.name ? t('extension.confirmDelete') : t('extension.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {notice ? (
            <div className="butler-email-sent" data-testid="mcp-notice">
              {notice}
            </div>
          ) : null}
          {fail ? (
            <div className="model-form-error" data-testid="mcp-fail">
              {fail}
            </div>
          ) : null}

          <div className="model-form-actions">
            <button
              className="action-btn primary"
              data-testid="mcp-add"
              onClick={() => {
                clearFeedback()
                setTarget('new')
              }}
            >
              {t('extension.mcp.add')}
            </button>
          </div>
        </>
      ) : (
        <McpForm
          target={target}
          onDone={async (msg) => {
            setTarget(null)
            clearFeedback()
            setNotice(msg)
            await reload()
          }}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  )
}

/** MCP 新增/编辑表单（编辑时名只读——名字是 mcp.json 的键）。 */
function McpForm({
  target,
  onDone,
  onCancel
}: {
  target: 'new' | McpServerItem
  onDone: (msg: string) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const runExtension = useBackendStore((s) => s.runExtension)
  const isNew = target === 'new'
  const edit = isNew ? null : target

  const [name, setName] = useState(edit?.name ?? '')
  const [command, setCommand] = useState(edit?.command ?? '')
  const [args, setArgs] = useState((edit?.args ?? []).join(' '))
  const [env, setEnv] = useState(
    Object.entries(edit?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /** 提交：新增走 add（同名拒绝），编辑走 update（覆盖）。 */
  const submit = async (): Promise<void> => {
    if (!name.trim() || !command.trim()) {
      setError(t('extension.mcp.required'))
      return
    }
    setError('')
    setSaving(true)
    const env2 = await runExtension('mcp', isNew ? 'add' : 'update', { name, command, args, env })
    setSaving(false)
    if (env2.ok) await onDone(env2.message ?? '')
    else setError(env2.message ?? t('extension.failed'))
  }

  return (
    <div className="settings-panel" data-testid="mcp-form">
      <div className="setting-row">
        <span className="setting-label">{t('extension.mcp.name')}</span>
        <input
          className="model-input"
          data-testid="mcp-form-name"
          placeholder={t('extension.mcp.namePlaceholder')}
          value={name}
          readOnly={!isNew}
          onChange={(e) => {
            setName(e.target.value)
            if (error) setError('')
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('extension.mcp.command')}</span>
        <div className="setting-hint">{t('extension.mcp.commandHint')}</div>
        <input
          className="model-input"
          data-testid="mcp-form-command"
          placeholder="npx"
          value={command}
          onChange={(e) => {
            setCommand(e.target.value)
            if (error) setError('')
          }}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('extension.mcp.args')}</span>
        <div className="setting-hint">{t('extension.mcp.argsHint')}</div>
        <input
          className="model-input"
          data-testid="mcp-form-args"
          placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('extension.mcp.env')}</span>
        <div className="setting-hint">{t('extension.mcp.envHint')}</div>
        <textarea
          className="model-input butler-textarea"
          data-testid="mcp-form-env"
          rows={4}
          placeholder={'GITHUB_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN}'}
          value={env}
          onChange={(e) => setEnv(e.target.value)}
        />
      </div>

      {error ? (
        <div className="model-form-error" data-testid="mcp-form-error">
          {error}
        </div>
      ) : null}

      <div className="model-form-actions">
        <button
          className="action-btn primary"
          data-testid="mcp-form-submit"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? t('extension.saving') : t('extension.save')}
        </button>
        <button className="action-btn" data-testid="mcp-form-cancel" onClick={onCancel}>
          {t('extension.cancel')}
        </button>
      </div>
    </div>
  )
}
