/**
 * 右栏信息面板：任务中心 / 会话与用量 / 系统状态 / 运行健康 四区块。
 *
 * 设置已独立为 SettingsPanel 组件（标题栏齿轮进入，整体替换本面板），
 * 本组件只留运行时信息展示。
 *
 * 数据源：
 * - 任务中心/用量/运行健康：rightStore（dispatcher 在 init /
 *   assistant_done / proactive_notify 时触发刷新）；
 * - 系统状态：metrics 事件每 2 秒推送进 useMetricsStore；
 *   CPU > 85% 时进度条变红（hot），与 workbench 口径一致。
 *
 * @author aceFelix
 */

import { useMetricsStore } from '../stores/metricsStore'
import { useRightStore, type DeadlineItem } from '../stores/rightStore'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'

function gb(detail: { used_gb?: number; total_gb?: number } | null): string {
  if (!detail?.total_gb) return ''
  return `${detail.used_gb ?? 0} / ${detail.total_gb} GB`
}

/** 提醒触发时间格式化：ISO 串 → "MM-dd HH:mm"（解析失败原样返回）。 */
function fmtTriggerAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

/** 重复模式标签（once 不标，daily/weekly 走 i18n）。 */
function repeatLabel(repeat: string, t: ReturnType<typeof useT>): string {
  if (repeat === 'daily') return t('right.daily')
  if (repeat === 'weekly') return t('right.weekly')
  return ''
}

/** 截止日期倒计时文案：负数=已逾期，0=今天截止。 */
function deadlineLabel(item: DeadlineItem, t: ReturnType<typeof useT>): { text: string; tone: 'ok' | 'soon' | 'over' } {
  const days = item.days_left
  if (days === null || days === undefined) return { text: item.due_date, tone: 'ok' }
  if (days < 0) return { text: t('right.overdue', { n: -days }), tone: 'over' }
  if (days === 0) return { text: t('right.dueToday'), tone: 'soon' }
  if (days <= 3) return { text: t('right.daysLeft', { n: days }), tone: 'soon' }
  return { text: t('right.daysLeft', { n: days }), tone: 'ok' }
}

/** 千分位分组（token 计数展示）。 */
function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

/** 任务中心：待触发提醒 + 活跃截止日期 + 最近简报。 */
function TaskCenter(): JSX.Element {
  const reminders = useRightStore((s) => s.reminders)
  const deadlines = useRightStore((s) => s.deadlines)
  const briefing = useRightStore((s) => s.latestBriefing)
  const t = useT()
  const g = useGlyphs()

  return (
    <div data-testid="task-center">
      {reminders.length === 0 && deadlines.length === 0 ? (
        <div className="side-empty">{t('right.noTasks')}</div>
      ) : (
        <ul className="task-list">
          {reminders.slice(0, 5).map((r) => (
            <li key={r.id} className="task-item" title={r.content}>
              <span className="task-time">{fmtTriggerAt(r.trigger_at)}</span>
              <span className="task-text">{g.taskReminder} {r.content}</span>
              {repeatLabel(r.repeat, t) ? (
                <span className="task-tag">{repeatLabel(r.repeat, t)}</span>
              ) : null}
            </li>
          ))}
          {deadlines.slice(0, 5).map((d) => {
            const label = deadlineLabel(d, t)
            return (
              <li key={d.id} className="task-item" title={`${d.title}（${d.due_date}）`}>
                <span className={`task-time due-${label.tone}`}>{label.text}</span>
                <span className="task-text">{g.taskDeadline} {d.title}</span>
              </li>
            )
          })}
        </ul>
      )}
      {briefing ? (
        <details className="briefing-block" data-testid="latest-briefing">
          <summary>{t('right.briefing')}</summary>
          <div className="briefing-text">{briefing}</div>
        </details>
      ) : null}
    </div>
  )
}

/** 会话与用量卡：当前模型 + token 累计 + 缓存命中率 + 对话轮数/消息条数。 */
function UsageCard(): JSX.Element {
  const cost = useRightStore((s) => s.cost)
  const t = useT()
  if (!cost) return <div className="side-empty">{t('right.noCost')}</div>
  const cacheTotal = cost.cache_read_tokens + cost.cache_creation_tokens
  // 缓存命中率：直接用后端算好的 cost.cache_hit_rate（口径见 Usage.cache_hit_rate，
  // 区分 OpenAI / Anthropic 两种协议的分母），前端不重算，避免与 /cost 对不上；
  // 旧后端无该字段时隐藏整行，不留空白指标。@author aceFelix
  const hitRate = typeof cost.cache_hit_rate === 'number' ? cost.cache_hit_rate : null
  return (
    <div className="usage-card" data-testid="usage-card">
      <div className="usage-row">
        <span>{t('right.model')}</span>
        <span className="usage-value" title={cost.model}>{cost.model || '—'}</span>
      </div>
      <div className="usage-row">
        <span>{t('right.dialogs')}</span>
        <span className="usage-value">{t('right.dialogsValue', { d: cost.dialogs, m: cost.messages })}</span>
      </div>
      <div className="usage-row">
        <span>{t('right.inputTokens')}</span>
        <span className="usage-value">{fmtNum(cost.input_tokens)}</span>
      </div>
      <div className="usage-row">
        <span>{t('right.outputTokens')}</span>
        <span className="usage-value">{fmtNum(cost.output_tokens)}</span>
      </div>
      <div className="usage-row">
        <span>{t('right.cacheTokens')}</span>
        <span className="usage-value" title={t('right.cacheTitle', { r: fmtNum(cost.cache_read_tokens), w: fmtNum(cost.cache_creation_tokens) })}>
          {fmtNum(cacheTotal)}
        </span>
      </div>
      {hitRate !== null ? (
        <div className="usage-row" data-testid="usage-cache-hit-rate">
          <span>{t('right.cacheHitRate')}</span>
          <span
            className="usage-value"
            title={t('right.cacheHitRateTitle', { r: fmtNum(cost.cache_read_tokens), i: fmtNum(cost.input_tokens) })}
          >
            {hitRate.toFixed(1)}%
          </span>
        </div>
      ) : null}
      {/* 上下文窗口占用（cost.get 的 context_*，口径同 REPL /context）：
          一行百分比 + 下方进度条（>85% 标 hot），title 透出「已用/窗口 token」
          与窗口来源（窗口/假设窗口）；旧后端无字段时整块隐藏。@author aceFelix */}
      {typeof cost.context_percent === 'number' ? (
        <>
          <div className="usage-row" data-testid="usage-context">
            <span>{t('right.context')}</span>
            <span
              className="usage-value"
              title={t('right.contextTitle', {
                used: fmtNum(cost.context_used ?? 0),
                window: fmtNum(cost.context_window ?? 0),
                label: t(cost.context_configured ? 'right.contextWindow' : 'right.contextAssumedWindow')
              })}
            >
              {(cost.context_percent ?? 0).toFixed(1)}%
            </span>
          </div>
          <div className="gauge usage-context-gauge">
            <div
              className={`gauge-fill${(cost.context_percent ?? 0) > 85 ? ' hot' : ''}`}
              style={{ width: `${Math.min(cost.context_percent ?? 0, 100)}%` }}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 运行健康：MCP 连接快照 + 事件日志流（滚动 30 条）。 */
function HealthPanel(): JSX.Element {
  const mcp = useRightStore((s) => s.mcp)
  const logs = useRightStore((s) => s.logs)
  const t = useT()
  return (
    <div data-testid="health-panel">
      <div className="mcp-line" data-testid="mcp-status">
        {mcp === null ? (
          <span className="side-empty">{t('right.mcpOff')}</span>
        ) : (
          <>
            <span className={mcp.failed.length ? 'mcp-warn' : 'mcp-ok'}>
              {t('right.mcpUp', { c: mcp.connected.length })}
              {mcp.failed.length ? t('right.mcpFailedSuffix', { f: mcp.failed.length }) : ''}
              {t('right.mcpTools', { t: mcp.tools })}
            </span>
            {mcp.failed.length ? (
              <div className="mcp-failed" title={mcp.failed.join('、')}>
                {t('right.mcpFailedLabel')}{mcp.failed.join('、')}
              </div>
            ) : null}
          </>
        )}
      </div>
      {logs.length ? (
        <div className="log-feed" data-testid="log-feed">
          {[...logs].reverse().map((line, i) => (
            <div key={i} className="log-line">{line}</div>
          ))}
        </div>
      ) : (
        <div className="side-empty">{t('right.noLogs')}</div>
      )}
    </div>
  )
}

export default function RightSidebar(): JSX.Element {
  const cpu = useMetricsStore((s) => s.cpu)
  const memory = useMetricsStore((s) => s.memory)
  const disk = useMetricsStore((s) => s.disk)
  const t = useT()

  const memPercent = memory?.percent ?? 0
  const diskPercent = disk?.percent ?? 0

  return (
    <aside id="right-col" className="glass-col">
      <div className="col-header">
        <span className="col-title">{t('right.tasks')}</span>
      </div>
      <TaskCenter />

      <div className="col-header">
        <span className="col-title">{t('right.usage')}</span>
      </div>
      <UsageCard />

      <div className="col-header">
        <span className="col-title">{t('right.system')}</span>
      </div>

      <div className="metric-card">
        <div className="metric-head">
          <span>CPU</span>
          <span className="metric-value">{cpu}%</span>
        </div>
        <div className="gauge">
          <div
            className={`gauge-fill${cpu > 85 ? ' hot' : ''}`}
            style={{ width: `${cpu}%` }}
          />
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-head">
          <span>{t('right.memory')}</span>
          <span className="metric-value">{memPercent}%</span>
        </div>
        <div className="gauge">
          <div className="gauge-fill" style={{ width: `${memPercent}%` }} />
        </div>
        <div className="metric-detail">{gb(memory)}</div>
      </div>

      <div className="metric-card">
        <div className="metric-head">
          <span>{t('right.disk')}</span>
          <span className="metric-value">{diskPercent}%</span>
        </div>
        <div className="gauge">
          <div className="gauge-fill" style={{ width: `${diskPercent}%` }} />
        </div>
        <div className="metric-detail">{gb(disk)}</div>
      </div>

      <div className="col-header">
        <span className="col-title">{t('right.health')}</span>
      </div>
      <HealthPanel />
    </aside>
  )
}
