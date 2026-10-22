/**
 * 扩展服务 · 可安装市场子面板（ExtensionPanel 内嵌）：插件 / harness。
 *
 * 两类都是「从市场安装、可卸载/启停」的扩展，交互同构故合并在同一文件：
 * - ExtensionPluginsPanel：已安装插件清单（版本/来源/禁用态）+ 市场搜索安装；
 * - ExtensionHarnessPanel：已安装 harness 清单 + 市场浏览安装（需满足 requires）。
 *
 * 写操作（install/uninstall/enable/disable）成功后重拉清单并提示；卸载走两步确认。
 * 取数/写操作经 backendStore.runExtension → extensions.exec，错误内联展示。
 * @author aceFelix
 */

import { useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useT } from '../i18n'
import { ExtensionSubhead, useExtensionData } from './extensionShared'
import type {
  HarnessItem,
  HarnessMarketItem,
  PluginItem,
  PluginMarketItem
} from '../../../shared/extension-contracts'

/** 已安装插件面板（plugins.install/uninstall/enable/disable + 市场搜索）。 */
export function ExtensionPluginsPanel(): JSX.Element {
  const t = useT()
  const runExtension = useBackendStore((s) => s.runExtension)
  const { data, loading, error, reload } = useExtensionData<PluginItem[]>('plugins', 'list')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<PluginMarketItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [fail, setFail] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')

  /** 市场搜索（search 动作，关键词可空=列全部）。 */
  const search = async (): Promise<void> => {
    setFail('')
    setNotice('')
    setSearching(true)
    const env = await runExtension<PluginMarketItem[]>('plugins', 'search', { keyword })
    setSearching(false)
    if (env.ok) setResults(env.data ?? [])
    else setFail(env.message ?? t('extension.failed'))
  }

  /** 写操作：install/uninstall/enable/disable → 刷新已安装清单。 */
  const runWrite = async (action: string, name: string): Promise<void> => {
    setNotice('')
    setFail('')
    setBusy(`${action}:${name}`)
    const env = await runExtension('plugins', action, { name })
    setBusy('')
    setPendingDelete('')
    if (env.ok) {
      setNotice(env.message ?? t('extension.done'))
      await reload()
    } else {
      setFail(env.message ?? t('extension.failed'))
    }
  }

  const installed = data ?? []

  return (
    <div className="settings-panel" data-testid="extension-plugins">
      <ExtensionSubhead titleKey="extension.cat.plugins" />

      {/* 市场搜索：输入关键词 → 搜索 → 结果列表（已装项标灰不可再装） */}
      <div className="extension-search-row">
        <input
          className="model-input"
          data-testid="plugins-search-input"
          placeholder={t('extension.market.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <button
          className="action-btn"
          data-testid="plugins-search-btn"
          disabled={searching}
          onClick={() => void search()}
        >
          {searching ? t('extension.searching') : t('extension.search')}
        </button>
      </div>

      {results !== null ? (
        results.length === 0 ? (
          <div className="side-empty" data-testid="plugins-market-empty">
            {t('extension.market.empty')}
          </div>
        ) : (
          <div className="extension-list" data-testid="plugins-market-list">
            {results.map((p) => (
              <div className="extension-row" key={p.name} data-testid={`plugin-market-${p.name}`}>
                <div className="extension-row-main">
                  <span className="extension-row-name">{p.name}</span>
                  <span className="extension-row-desc">{p.description}</span>
                  <span className="extension-row-meta">
                    {p.version ? `v${p.version} · ` : ''}
                    {p.source}
                  </span>
                </div>
                <div className="extension-row-actions">
                  <button
                    className="action-btn primary"
                    data-testid={`plugin-install-${p.name}`}
                    disabled={p.installed || !!busy}
                    onClick={() => void runWrite('install', p.name)}
                  >
                    {p.installed ? t('extension.installed') : t('extension.install')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {/* 已安装清单 */}
      <div className="setting-label extension-section-title">{t('extension.installedTitle')}</div>
      {loading ? (
        <div className="side-empty" data-testid="plugins-loading">
          {t('extension.loading')}
        </div>
      ) : error ? (
        <div className="side-empty" data-testid="plugins-error">
          {error}
        </div>
      ) : installed.length === 0 ? (
        <div className="side-empty" data-testid="plugins-empty">
          {t('extension.plugins.empty')}
        </div>
      ) : (
        <div className="extension-list" data-testid="plugins-list">
          {installed.map((p) => (
            <div className="extension-row" key={p.name} data-testid={`plugin-item-${p.name}`}>
              <div className="extension-row-main">
                <span className="extension-row-name">{p.name}</span>
                <span className="extension-row-meta">
                  {p.version ? `v${p.version} · ` : ''}
                  {p.source} · {p.disabled ? t('extension.disabled') : t('extension.enabled')}
                </span>
              </div>
              <div className="extension-row-actions">
                <button
                  className="action-btn"
                  data-testid={`plugin-toggle-${p.name}`}
                  disabled={!!busy}
                  onClick={() => void runWrite(p.disabled ? 'enable' : 'disable', p.name)}
                >
                  {p.disabled ? t('extension.enable') : t('extension.disable')}
                </button>
                <button
                  className="action-btn danger"
                  data-testid={`plugin-delete-${p.name}`}
                  disabled={!!busy}
                  onClick={() => {
                    setNotice('')
                    setFail('')
                    if (pendingDelete === p.name) void runWrite('uninstall', p.name)
                    else setPendingDelete(p.name)
                  }}
                >
                  {pendingDelete === p.name
                    ? t('extension.confirmUninstall')
                    : t('extension.uninstall')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {notice ? (
        <div className="butler-email-sent" data-testid="plugins-notice">
          {notice}
        </div>
      ) : null}
      {fail ? (
        <div className="model-form-error" data-testid="plugins-fail">
          {fail}
        </div>
      ) : null}
    </div>
  )
}

/** 已安装 harness 面板（harness.install/uninstall/enable/disable + 市场浏览）。 */
export function ExtensionHarnessPanel(): JSX.Element {
  const t = useT()
  const runExtension = useBackendStore((s) => s.runExtension)
  const { data, loading, error, reload } = useExtensionData<HarnessItem[]>('harness', 'list')
  const [market, setMarket] = useState<HarnessMarketItem[] | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [fail, setFail] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')

  /** 展开/收起市场清单（首次点击拉取，再点收起）。 */
  const toggleMarket = async (): Promise<void> => {
    if (market !== null) {
      setMarket(null)
      return
    }
    setFail('')
    setNotice('')
    setMarketLoading(true)
    const env = await runExtension<HarnessMarketItem[]>('harness', 'market')
    setMarketLoading(false)
    if (env.ok) setMarket(env.data ?? [])
    else setFail(env.message ?? t('extension.failed'))
  }

  /** 写操作：install/uninstall/enable/disable → 刷新已安装清单。 */
  const runWrite = async (action: string, id: string): Promise<void> => {
    setNotice('')
    setFail('')
    setBusy(`${action}:${id}`)
    const env = await runExtension('harness', action, { id })
    setBusy('')
    setPendingDelete('')
    if (env.ok) {
      setNotice(env.message ?? t('extension.done'))
      await reload()
    } else {
      setFail(env.message ?? t('extension.failed'))
    }
  }

  const installed = data ?? []

  return (
    <div className="settings-panel" data-testid="extension-harness">
      <ExtensionSubhead titleKey="extension.cat.harness" />

      <div className="model-form-actions">
        <button
          className="action-btn"
          data-testid="harness-market-toggle"
          disabled={marketLoading}
          onClick={() => void toggleMarket()}
        >
          {market === null
            ? marketLoading
              ? t('extension.loading')
              : t('extension.market.browse')
            : t('extension.market.hide')}
        </button>
      </div>

      {market !== null ? (
        market.length === 0 ? (
          <div className="side-empty" data-testid="harness-market-empty">
            {t('extension.market.empty')}
          </div>
        ) : (
          <div className="extension-list" data-testid="harness-market-list">
            {market.map((h) => (
              <div className="extension-row" key={h.id} data-testid={`harness-market-${h.id}`}>
                <div className="extension-row-main">
                  <span className="extension-row-name">{h.name}</span>
                  <span className="extension-row-desc">{h.description}</span>
                  {h.requires ? (
                    <span className="extension-row-meta">
                      {t('extension.harness.requires')}: {h.requires}
                    </span>
                  ) : null}
                </div>
                <div className="extension-row-actions">
                  <button
                    className="action-btn primary"
                    data-testid={`harness-install-${h.id}`}
                    disabled={h.installed || !!busy}
                    onClick={() => void runWrite('install', h.id)}
                  >
                    {h.installed ? t('extension.installed') : t('extension.install')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      <div className="setting-label extension-section-title">{t('extension.installedTitle')}</div>
      {loading ? (
        <div className="side-empty" data-testid="harness-loading">
          {t('extension.loading')}
        </div>
      ) : error ? (
        <div className="side-empty" data-testid="harness-error">
          {error}
        </div>
      ) : installed.length === 0 ? (
        <div className="side-empty" data-testid="harness-empty">
          {t('extension.harness.empty')}
        </div>
      ) : (
        <div className="extension-list" data-testid="harness-list">
          {installed.map((h) => (
            <div className="extension-row" key={h.id} data-testid={`harness-item-${h.id}`}>
              <div className="extension-row-main">
                <span className="extension-row-name">{h.name}</span>
                <span className="extension-row-desc">{h.description}</span>
                <span className="extension-row-meta">
                  {h.disabled ? t('extension.disabled') : t('extension.enabled')}
                </span>
              </div>
              <div className="extension-row-actions">
                <button
                  className="action-btn"
                  data-testid={`harness-toggle-${h.id}`}
                  disabled={!!busy}
                  onClick={() => void runWrite(h.disabled ? 'enable' : 'disable', h.id)}
                >
                  {h.disabled ? t('extension.enable') : t('extension.disable')}
                </button>
                <button
                  className="action-btn danger"
                  data-testid={`harness-delete-${h.id}`}
                  disabled={!!busy}
                  onClick={() => {
                    setNotice('')
                    setFail('')
                    if (pendingDelete === h.id) void runWrite('uninstall', h.id)
                    else setPendingDelete(h.id)
                  }}
                >
                  {pendingDelete === h.id
                    ? t('extension.confirmUninstall')
                    : t('extension.uninstall')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {notice ? (
        <div className="butler-email-sent" data-testid="harness-notice">
          {notice}
        </div>
      ) : null}
      {fail ? (
        <div className="model-form-error" data-testid="harness-fail">
          {fail}
        </div>
      ) : null}
    </div>
  )
}
