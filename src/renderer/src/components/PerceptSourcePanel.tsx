/**
 * 管家服务·感知源面板（阶段 9 W2 第 5 步，ButlerPanel 内嵌视图）。
 *
 * 面板要回答的三个问题，正好对应三个子标签（aceFelix）：
 * - 「它在看我什么？」→ 感知源：逐源开关 + 源自报的观察范围（目录/仓库/名单）；
 * - 「能不能少看一点？」→ 采集名单：白名单目录、登记仓库、发件人白名单、排除应用、
 *   两个分钟阈值（后端白名单之外的极客参数刻意不放进面板）；
 * - 「到底采到了什么？」→ 最近事件：总线里最近若干条事件 + 留痕文件路径。
 *   这一节是隐私自查的入口，所以事件明细原样展示，不做前端二次脱敏。
 *
 * 数据与写回都走一条路：挂载即 `percept.status.get` 拉全量快照，任何开关或名单
 * 改动都调 `percept.config.set`，并用**后端回读的新快照**整体替换本地状态——
 * 本地不做乐观更新，面板显示的永远是后端此刻的真实拓扑。回执 `hot_applied=false`
 * 时如实提示「需重启才生效」，不假装已经生效。
 *
 * 反馈条（错误/保存回执）放在子返回头下方并做 `position: sticky`：2026-10
 * 人工走查发现写回失败时错误落在长面板底部（需滚动才能看到），用户拿到的唯一
 * 信息就是“开关点了没反应”，反而把真缺陷伪装成交互失灵（见 jarvis 仓
 * docs/fixlogs/percept-config-set-envelope-fix.md）。错误可见性属于功能。
 *
 * 结构复用邮箱服务视图的样式类（.butler-subhead/.butler-overview/.butler-tabs），
 * 感知专属样式见 styles/butler.css。状态由本组件持有，不新增全局 store 状态。
 *
 * @author aceFelix
 */

import { useEffect, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useButlerStore } from '../stores/butlerStore'
import { useT } from '../i18n'
import { perceptCounterEntries, type PerceptConfigPatch, type PerceptStatus } from '../../../shared/percept-contracts'
import PerceptSourceList from './PerceptSourceList'
import PerceptScopeForm from './PerceptScopeForm'
import PerceptEventList from './PerceptEventList'

/** 面板内子视图：sources=感知源；scope=采集名单；events=最近事件。 */
type PerceptTab = 'sources' | 'scope' | 'events'

/** 子标签定义（顺序即渲染顺序）。 */
const TABS: Array<{ id: PerceptTab; labelKey: string }> = [
  { id: 'sources', labelKey: 'butler.percept.tabSources' },
  { id: 'scope', labelKey: 'butler.percept.tabScope' },
  { id: 'events', labelKey: 'butler.percept.tabEvents' }
]

export default function PerceptSourcePanel(): JSX.Element {
  const t = useT()
  const closeService = useButlerStore((s) => s.closeService)
  const fetchPerceptStatus = useBackendStore((s) => s.fetchPerceptStatus)
  const savePerceptConfig = useBackendStore((s) => s.savePerceptConfig)

  const [tab, setTab] = useState<PerceptTab>('sources')
  const [status, setStatus] = useState<PerceptStatus | null>(null)
  const [loading, setLoading] = useState(true)
  // busy：有写回在飞。期间禁用所有开关与保存按钮——逐源 enabled 是装配期快照，
  // 并发补丁会让「最后一次重装配」的结果说不清属于哪次改动。
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  /** 重新拉取状态快照（挂载即拉 + 手动刷新；离线回 null → 显离线态）。 */
  const reload = async (): Promise<void> => {
    setLoading(true)
    const snapshot = await fetchPerceptStatus()
    setStatus(snapshot)
    setLoading(false)
    setError('')
    setNotice('')
  }

  useEffect(() => {
    void reload()
    // 仅挂载时拉一次；reload 引用每轮新建但只在此处调用一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPerceptStatus])

  /**
   * 提交一份配置补丁（开关即时保存 / 名单表单保存共用同一条路）。
   *
   * 成功后用后端回读的完整快照替换本地状态，计数与事件区随之刷新；失败只内联
   * 显示错误，不动本地状态（面板继续显示改之前的真实配置）。
   */
  const submit = async (patch: PerceptConfigPatch): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    const res = await savePerceptConfig(patch)
    setBusy(false)
    if (res.ok && res.status) {
      setStatus(res.status)
      // hot_applied=false：配置已落盘，但本次会话没能重装配总线
      setNotice(
        res.status.hot_applied === false
          ? t('butler.percept.scopeSavedHotOff')
          : t('butler.percept.scopeSaved')
      )
    } else {
      setError(res.error ?? t('butler.emailConfig.saveFailed'))
    }
  }

  if (loading) {
    return (
      <div className="settings-panel" data-testid="percept-service">
        <div className="butler-subhead">
          <button
            className="settings-back"
            data-testid="btn-percept-service-back"
            title={t('butler.percept.back')}
            onClick={closeService}
          >
            ←
          </button>
          <span className="col-title">{t('butler.service.percept')}</span>
        </div>
        <div className="side-empty" data-testid="percept-loading">
          {t('butler.percept.loading')}
        </div>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="settings-panel" data-testid="percept-service">
        <div className="butler-subhead">
          <button
            className="settings-back"
            data-testid="btn-percept-service-back"
            title={t('butler.percept.back')}
            onClick={closeService}
          >
            ←
          </button>
          <span className="col-title">{t('butler.service.percept')}</span>
        </div>
        <div className="side-empty" data-testid="percept-offline">
          {t('butler.percept.offline')}
        </div>
      </div>
    )
  }

  const counters = perceptCounterEntries(status.counters)

  return (
    <div className="settings-panel" data-testid="percept-service">
      {/* 子返回头：回服务清单 + 右侧刷新（总线在跑，计数与事件会自己变） */}
      <div className="butler-subhead percept-subhead">
        <button
          className="settings-back"
          data-testid="btn-percept-service-back"
          title={t('butler.percept.back')}
          onClick={closeService}
        >
          ←
        </button>
        <span className="col-title">{t('butler.service.percept')}</span>
        <button
          className="action-btn percept-refresh"
          data-testid="btn-percept-refresh"
          title={t('butler.percept.refresh')}
          disabled={busy}
          onClick={() => void reload()}
        >
          {t('butler.percept.refresh')}
        </button>
      </div>

      {/* 反馈条：错误与保存回执常驻可见（粘在子返回头下方，不随长面板滚出视野） */}
      {error || notice ? (
        <div className="percept-feedback" data-testid="percept-feedback">
          {error ? (
            <div className="model-form-error" data-testid="percept-error">
              {error}
            </div>
          ) : null}
          {notice && !error ? (
            <div className="percept-saved" data-testid="percept-notice">
              {notice}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 总览：总开关 + 装配/运行 + 三道闸计数 + 去重窗口 + 留痕 */}
      <div className="butler-overview" data-testid="percept-overview">
        <div className="butler-overview-row">
          <span className="butler-overview-key">{t('butler.percept.master')}</span>
          <button
            role="switch"
            aria-checked={status.enabled}
            className={`toggle${status.enabled ? ' on' : ''}`}
            data-testid="percept-master-toggle"
            disabled={busy}
            title={t('butler.percept.masterHint')}
            onClick={() => void submit({ enabled: !status.enabled })}
          />
        </div>
        <div className="butler-overview-row">
          <span className="butler-overview-key">{t('butler.percept.assembled')}</span>
          <span className="butler-overview-value" data-testid="percept-assembled">
            {status.assembled ? t('butler.percept.assembledOn') : t('butler.percept.assembledOff')}
          </span>
        </div>
        <div className="butler-overview-row">
          <span className="butler-overview-key">{t('butler.percept.running')}</span>
          <span className="butler-overview-value" data-testid="percept-running">
            {status.bus_running ? t('butler.percept.runningOn') : t('butler.percept.runningOff')}
          </span>
        </div>
        <div className="butler-overview-row percept-counters" data-testid="percept-counters">
          <span className="butler-overview-key">{t('butler.percept.counters')}</span>
          <span className="butler-overview-value">
            {counters.length
              ? counters.map((c) => `${c.key} ${c.value}`).join(' · ')
              : t('butler.percept.countersEmpty')}
          </span>
        </div>
        {status.dedup_window_s > 0 ? (
          <div className="butler-overview-row">
            <span className="butler-overview-key">{t('butler.percept.dedupWindow')}</span>
            <span className="butler-overview-value">
              {t('butler.percept.dedupWindowValue', { n: status.dedup_window_s })}
            </span>
          </div>
        ) : null}
        <div className="butler-overview-row">
          <span className="butler-overview-key">{t('butler.percept.logEvents')}</span>
          <button
            role="switch"
            aria-checked={status.log_events}
            className={`toggle${status.log_events ? ' on' : ''}`}
            data-testid="percept-log-toggle"
            disabled={busy}
            title={t('butler.percept.logEventsHint')}
            onClick={() => void submit({ log_events: !status.log_events })}
          />
        </div>
        <div className="butler-overview-row">
          <span className="butler-overview-key">{t('butler.percept.logFile')}</span>
          {/* 留痕路径三态：有路径→路径；开关真关→已关闭；开着但拿不到路径（总线
              未运行或老后端）→ 显式说“暂无路径”，不拿“未开启”兼底 */}
          <span className="butler-overview-value" data-testid="percept-log-file">
            {status.log_file
              ? status.log_file
              : status.log_events
                ? t('butler.percept.logFileNoBus')
                : t('butler.percept.logFileNone')}
          </span>
        </div>
        {status.notify_budget ? (
          <div className="butler-overview-row" data-testid="percept-budget">
            <span className="butler-overview-key">{t('butler.percept.budget')}</span>
            {/* 打扰预算：解释“jsonl 在涨但没声音”——额度用尽 / 静默时段 /
                被重要度门槛判为不值得打扰，三种情形对用户都是“没播报”。
                后端未启用预算时这个字段为 null，整行不显示（不编零）。 */}
            <span className="butler-overview-value">
              {t('butler.percept.budgetValue', {
                used: status.notify_budget.count,
                max: status.notify_budget.daily_max,
                pending: status.notify_budget.pending
              })}
            </span>
          </div>
        ) : null}
      </div>

      {/* 子标签：感知源 / 采集名单 / 最近事件 */}
      <div className="segmented butler-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`seg-btn${tab === item.id ? ' active' : ''}`}
            data-testid={`percept-tab-${item.id}`}
            onClick={() => setTab(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'sources' ? (
        <PerceptSourceList sources={status.sources} busy={busy} onPatch={submit} />
      ) : tab === 'scope' ? (
        <PerceptScopeForm config={status.config} busy={busy} onPatch={submit} />
      ) : (
        <PerceptEventList status={status} />
      )}
    </div>
  )
}
