/**
 * 感知源面板 →「采集名单」子视图：白名单目录/仓库/发件人/排除应用 + 两个分钟阈值。
 *
 * 这是「缩小采集范围」的主入口（aceFelix，2026-10 W2 第 5 步）：用户最关心的往往
 * 不是「开哪个源」，而是「它别看我那个目录 / 这个应用别记」。表单只覆盖后端
 * `PERCEPT_CONFIG_FIELDS` 里的名单与分钟项——去重窗口、显著性地板分、采样间隔等
 * 极客参数刻意不做控件（只能手改 TOML），免得面板变成配置文件编辑器。
 *
 * 三条实现口径：
 * 1. **每行一项**的文本域（对齐扩展面板 MCP 环境变量的输入习惯），提交前本地
 *    切分、trim、丢空行、去重——后端也做同样的规范化，前端提前做只是为了让
 *    「改了没」的判断准确（见第 2 条）；
 * 2. **只提交实际改动的键**：全量提交会把没动的名单原样重写一遍，既让
 *    settings.toml 的 diff 变脏，也会触发不必要的总线重装配；
 * 3. 分钟阈值在本地先校验（0-1440 整数），非法值不入后端；上限与后端
 *    `MINUTES_MAX` 同口径，改一边必须改两边。
 *
 * @author aceFelix
 */

import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import type { PerceptConfig, PerceptConfigPatch } from '../../../shared/percept-contracts'

/** 分钟阈值的合法上限（与后端 percept_settings.MINUTES_MAX 同口径）。 */
const MINUTES_MAX = 1440

/** 名单类协议键（值必定是字符串数组）。 */
type ListKey =
  | 'file_watch_dirs'
  | 'vcs_repos'
  | 'mail_watch_senders'
  | 'window_exclude_apps'

/** 分钟类协议键（值必定是整数）。 */
type MinuteKey = 'window_linger_minutes' | 'vision_auto_stop_minutes'

/** 组件 props。 */
interface Props {
  /** 后端回读的配置快照（草稿的数据源）。 */
  config: PerceptConfig
  /** 有写回在飞时禁用保存。 */
  busy: boolean
  /** 提交一份补丁（父组件统一处理回执、错误与提示）。 */
  onPatch: (patch: PerceptConfigPatch) => Promise<void>
}

/** 名单类字段定义（键 = 后端协议键，label/hint = i18n 键）。 */
const LIST_FIELDS: Array<{ key: ListKey; labelKey: string; hintKey: string }> = [
  { key: 'file_watch_dirs', labelKey: 'butler.percept.fileWatchDirs', hintKey: 'butler.percept.fileWatchDirsHint' },
  { key: 'vcs_repos', labelKey: 'butler.percept.vcsRepos', hintKey: 'butler.percept.vcsReposHint' },
  {
    key: 'mail_watch_senders',
    labelKey: 'butler.percept.mailWatchSenders',
    hintKey: 'butler.percept.mailWatchSendersHint'
  },
  {
    key: 'window_exclude_apps',
    labelKey: 'butler.percept.windowExcludeApps',
    hintKey: 'butler.percept.windowExcludeAppsHint'
  }
]

/** 分钟阈值字段定义。 */
const MINUTE_FIELDS: Array<{ key: MinuteKey; labelKey: string; hintKey: string }> = [
  {
    key: 'window_linger_minutes',
    labelKey: 'butler.percept.windowLingerMinutes',
    hintKey: 'butler.percept.windowLingerMinutesHint'
  },
  {
    key: 'vision_auto_stop_minutes',
    labelKey: 'butler.percept.visionAutoStopMinutes',
    hintKey: 'butler.percept.visionAutoStopMinutesHint'
  }
]

/** 字符串数组 → 文本域内容（每行一项）。 */
function toText(items: unknown): string {
  return Array.isArray(items) ? items.map((v) => String(v)).join('\n') : ''
}

/** 文本域内容 → 规范化数组（切行、trim、丢空、按序去重；与后端 _clean_list 同口径）。 */
function toList(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const item = raw.trim()
    if (item && !out.includes(item)) out.push(item)
  }
  return out
}

export default function PerceptScopeForm({ config, busy, onPatch }: Props): JSX.Element {
  const t = useT()
  const [lists, setLists] = useState<Record<string, string>>(() => buildListDraft(config))
  const [minutes, setMinutes] = useState<Record<string, string>>(() => buildMinuteDraft(config))
  const [error, setError] = useState('')

  // 配置快照变化（保存成功回读 / 手动刷新）时重置草稿，避免草稿停留在旧值
  useEffect(() => {
    setLists(buildListDraft(config))
    setMinutes(buildMinuteDraft(config))
    setError('')
  }, [config])

  /** 组补丁：只带实际改动的键；分钟非法就地报错、不入后端。 */
  const submit = async (): Promise<void> => {
    const patch: PerceptConfigPatch = {}
    for (const field of LIST_FIELDS) {
      const next = toList(lists[field.key] ?? '')
      const current = config[field.key]
      if (JSON.stringify(next) !== JSON.stringify(current)) patch[field.key] = next
    }
    for (const field of MINUTE_FIELDS) {
      const raw = (minutes[field.key] ?? '').trim()
      const value = Number(raw)
      if (!raw || !Number.isInteger(value) || value < 0 || value > MINUTES_MAX) {
        setError(t('butler.percept.minutesInvalid', { label: t(field.labelKey) }))
        return
      }
      if (value !== config[field.key]) patch[field.key] = value
    }
    setError('')
    // 没有任何改动就不发补丁：空补丁会被后端拒绝（"至少需要一个有效的配置项"），
    // 那种报错对用户毫无意义
    if (Object.keys(patch).length) await onPatch(patch)
  }

  return (
    <div className="percept-scope" data-testid="percept-scope-form">
      <div className="setting-hint percept-scope-hint">{t('butler.percept.scopeHint')}</div>

      {LIST_FIELDS.map((field) => (
        <div className="setting-row" key={field.key} data-testid={`percept-field-${field.key}`}>
          <span className="setting-label">{t(field.labelKey)}</span>
          <div className="setting-hint">{t(field.hintKey)}</div>
          <textarea
            className="model-input butler-textarea percept-textarea"
            data-testid={`percept-input-${field.key}`}
            value={lists[field.key] ?? ''}
            onChange={(e) => {
              setLists((prev) => ({ ...prev, [field.key]: e.target.value }))
              if (error) setError('')
            }}
          />
        </div>
      ))}

      {MINUTE_FIELDS.map((field) => (
        <div className="setting-row" key={field.key} data-testid={`percept-field-${field.key}`}>
          <span className="setting-label">{t(field.labelKey)}</span>
          <div className="setting-hint">{t(field.hintKey)}</div>
          <input
            className="model-input"
            inputMode="numeric"
            data-testid={`percept-input-${field.key}`}
            value={minutes[field.key] ?? ''}
            onChange={(e) => {
              setMinutes((prev) => ({ ...prev, [field.key]: e.target.value }))
              if (error) setError('')
            }}
          />
        </div>
      ))}

      {error ? (
        <div className="model-form-error" data-testid="percept-scope-error">
          {error}
        </div>
      ) : null}

      <div className="model-form-actions">
        <button
          className="action-btn primary"
          data-testid="percept-scope-save"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? t('butler.emailConfig.saving') : t('butler.emailConfig.save')}
        </button>
      </div>
    </div>
  )
}

/** 名单草稿：当前快照 → 每行一项的文本。 */
function buildListDraft(config: PerceptConfig): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const field of LIST_FIELDS) draft[field.key] = toText(config[field.key])
  return draft
}

/** 分钟草稿：当前快照 → 输入框文本。 */
function buildMinuteDraft(config: PerceptConfig): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const field of MINUTE_FIELDS) draft[field.key] = String(config[field.key] ?? 0)
  return draft
}
