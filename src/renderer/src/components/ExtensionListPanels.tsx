/**
 * 扩展服务 · 只读清单子面板（ExtensionPanel 内嵌）：内置工具 / 技能。
 *
 * 两类都是「代码或目录注册、桌面不可增删」的只读清单，故合并在同一文件：
 * - ExtensionToolsPanel：后端活动 registry 的已注册工具（名称 + 一句话说明）；
 * - ExtensionSkillsPanel：技能搜索目录 + 已加载技能（名称 / 来源 / 描述 / 适用场景）。
 *
 * 均带关键字过滤（本地过滤已拉取的清单，不再往返后端）。取数经
 * backendStore.runExtension → extensions.exec。@author aceFelix
 */

import { useMemo, useState } from 'react'
import { useT } from '../i18n'
import { ExtensionSubhead, useExtensionData } from './extensionShared'
import type { SkillItem, SkillsData, ToolItem } from '../../../shared/contracts'

/** 大小写不敏感的包含匹配（关键字为空则全通过）。 */
function matches(keyword: string, ...fields: string[]): boolean {
  const k = keyword.trim().toLowerCase()
  if (!k) return true
  return fields.some((f) => (f ?? '').toLowerCase().includes(k))
}

/** 通用关键字输入行（两个子面板共用）。 */
function SearchRow({
  value,
  onChange,
  testId
}: {
  value: string
  onChange: (v: string) => void
  testId: string
}): JSX.Element {
  const t = useT()
  return (
    <div className="setting-row extension-search">
      <input
        className="model-input"
        data-testid={testId}
        placeholder={t('extension.searchPlaceholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** 扩展服务 · 内置工具面板（只读，带搜索）。 */
export function ExtensionToolsPanel(): JSX.Element {
  const t = useT()
  const { data, loading, error } = useExtensionData<ToolItem[]>('tools', 'list')
  const [keyword, setKeyword] = useState('')

  const items = useMemo(
    () => (data ?? []).filter((it) => matches(keyword, it.name, it.description)),
    [data, keyword]
  )

  return (
    <div className="settings-panel" data-testid="extension-tools">
      <ExtensionSubhead titleKey="extension.cat.tools" />
      <div className="setting-hint extension-count">
        {t('extension.tools.count', { n: items.length })}
      </div>
      <SearchRow value={keyword} onChange={setKeyword} testId="tools-search" />

      {loading ? (
        <div className="side-empty" data-testid="tools-loading">
          {t('extension.loading')}
        </div>
      ) : error ? (
        <div className="side-empty" data-testid="tools-error">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="side-empty" data-testid="tools-empty">
          {t('extension.empty')}
        </div>
      ) : (
        <div className="extension-list" data-testid="tools-list">
          {items.map((it) => (
            <div className="extension-row" key={it.name} data-testid={`tool-item-${it.name}`}>
              <div className="extension-row-main">
                <span className="extension-row-name">{it.name}</span>
                <span className="extension-row-desc">{it.description}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 扩展服务 · 技能面板（只读：已加载技能 + 技能搜索目录，带搜索）。 */
export function ExtensionSkillsPanel(): JSX.Element {
  const t = useT()
  const { data, loading, error } = useExtensionData<SkillsData>('skills', 'list')
  const [keyword, setKeyword] = useState('')

  const skills = useMemo(
    () =>
      (data?.skills ?? []).filter((it) =>
        matches(keyword, it.name, it.description, it.when_to_use)
      ),
    [data, keyword]
  )

  return (
    <div className="settings-panel" data-testid="extension-skills">
      <ExtensionSubhead titleKey="extension.cat.skills" />
      <div className="setting-hint extension-count">
        {t('extension.skills.count', { n: skills.length })}
      </div>
      <SearchRow value={keyword} onChange={setKeyword} testId="skills-search" />

      {loading ? (
        <div className="side-empty" data-testid="skills-loading">
          {t('extension.loading')}
        </div>
      ) : error ? (
        <div className="side-empty" data-testid="skills-error">
          {error}
        </div>
      ) : skills.length === 0 ? (
        <div className="side-empty" data-testid="skills-empty">
          {t('extension.empty')}
        </div>
      ) : (
        <div className="extension-list" data-testid="skills-list">
          {skills.map((it: SkillItem) => (
            <div className="extension-row" key={it.name} data-testid={`skill-item-${it.name}`}>
              <div className="extension-row-main">
                <span className="extension-row-name">{it.name}</span>
                <span className="extension-row-desc">{it.description}</span>
                {it.when_to_use ? (
                  <span className="extension-row-meta">
                    {t('extension.skills.when')}: {it.when_to_use}
                  </span>
                ) : null}
                {it.source ? (
                  <span className="extension-row-meta">{it.source}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.dirs.length > 0 ? (
        <div className="extension-dirs" data-testid="skills-dirs">
          <span className="setting-label">{t('extension.skills.dirs')}</span>
          {data.dirs.map((d) => (
            <div className="extension-row-meta" key={d.label}>
              {d.label}: {d.path}
              {d.exists ? '' : ` (${t('extension.skills.dirMissing')})`}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
