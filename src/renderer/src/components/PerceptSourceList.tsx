/**
 * 感知源面板 →「感知源」子视图：逐源开关 + 运行账本 + 源自报的观察范围。
 *
 * 分两栏渲染（aceFelix，2026-10 W2 第 5 步）：
 * - 已实现的源：一行一个，带开关。开关直接调 `percept.config.set`（**即时保存**，
 *   与邮箱配置表单的「草稿 + 保存」不同——开关是单点决策，多一次点击就多一次
 *   「以为没生效」的怀疑）；行内还显示后端账本（采集/投递/失败计数、是否注册进
 *   总线、末次错误），让用户看得见「开了到底有没有在采」；
 * - 未装配的收编位（阶段 11 把 calendar / system 接进总线后，只剩 schedule）：
 *   灰显 + 固定理由，**刻意不给开关**。有开关背后没人采，比没有开关更糟
 *   （同后端 status.py 的口径）。
 *
 * 源名与一句话说明都来自后端（SOURCE_LABELS / SOURCE_HINTS 是单一真源），前端不
 * 再硬编码，避免两处漂移；英文界面下源名仍显中文，是这套口径的已知取舍。
 *
 * @author aceFelix
 */

import { useState } from 'react'
import { useT } from '../i18n'
import {
  perceptDetailEntries,
  perceptEnableKey,
  type PerceptConfigPatch,
  type PerceptSourceInfo
} from '../../../shared/percept-contracts'

/** 单源卡片的 props。 */
interface RowProps {
  /** 该源的后端状态。 */
  source: PerceptSourceInfo
  /** 有写回在飞时禁用开关。 */
  busy: boolean
  /** 提交一份补丁（父组件统一处理回执、错误与提示）。 */
  onPatch: (patch: PerceptConfigPatch) => Promise<void>
}

/** 组件 props：逐源状态列表 + 共用的忙碌态与补丁提交口。 */
interface Props extends Omit<RowProps, 'source'> {
  /** 后端逐源状态（已实现的排前面）。 */
  sources: PerceptSourceInfo[]
}

export default function PerceptSourceList({ sources, busy, onPatch }: Props): JSX.Element {
  const t = useT()
  return (
    <div className="percept-sources" data-testid="percept-source-list">
      {sources.map((source) =>
        source.implemented ? (
          <SourceRow key={source.name} source={source} busy={busy} onPatch={onPatch} />
        ) : (
          <div className="percept-source is-pending" key={source.name} data-testid={`percept-pending-${source.name}`}>
            <div className="percept-source-head">
              <span className="percept-source-name">{source.label}</span>
              <span className="percept-badge is-muted">{t('butler.percept.pending')}</span>
            </div>
            <div className="percept-source-hint" data-testid={`percept-pending-reason-${source.name}`}>
              {source.pending_reason || source.hint}
            </div>
          </div>
        )
      )}
    </div>
  )
}

/**
 * 单个已实现源的卡片：开关 + 状态徽标 + 可展开的「观察范围」。
 *
 * 开关的补丁键由源名推出（`perceptEnableKey`）；推不出键说明后端没给这个源留
 * 白名单口子，此时**只显示状态、不显示开关**，而不是发一份注定被拒的补丁。
 * @author aceFelix
 */
function SourceRow({ source, busy, onPatch }: RowProps): JSX.Element {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const enableKey = perceptEnableKey(source.name)
  const details = perceptDetailEntries(source.detail)
  const collected = source.stats.collected
  const emitted = source.stats.events

  return (
    <div className="percept-source" data-testid={`percept-source-${source.name}`}>
      <div className="percept-source-head">
        <span className="percept-source-name">{source.label}</span>
        {enableKey ? (
          <button
            role="switch"
            aria-checked={source.enabled}
            className={`toggle${source.enabled ? ' on' : ''}`}
            data-testid={`percept-source-toggle-${source.name}`}
            disabled={busy || !enableKey}
            onClick={() =>
              void onPatch({ [enableKey]: !source.enabled } as PerceptConfigPatch)
            }
          />
        ) : null}
      </div>

      <div className="percept-source-hint">{source.hint}</div>

      {/* 运行账本：启用态 + 是否注册进总线 + 采集/投递/失败计数 */}
      <div className="percept-source-badges" data-testid={`percept-source-status-${source.name}`}>
        <span className={`percept-badge${source.enabled ? ' is-on' : ' is-muted'}`}>
          {source.enabled ? t('butler.percept.sourceOn') : t('butler.percept.sourceOff')}
        </span>
        {collected > 0 ? (
          <span className="percept-badge">
            {t('butler.percept.sourceCollected', { n: collected })}
          </span>
        ) : null}
        {emitted > 0 ? (
          <span className="percept-badge">{t('butler.percept.sourceEvents', { n: emitted })}</span>
        ) : null}
        {!source.registered ? (
          <span className="percept-badge is-muted">{t('butler.percept.sourceNotRegistered')}</span>
        ) : null}
        {source.stats.auto_disabled ? (
          <span className="percept-badge is-warn">{t('butler.percept.sourceAutoDisabled')}</span>
        ) : null}
        {source.stats.errors > 0 ? (
          <span className="percept-badge is-warn">
            {t('butler.percept.sourceErrors', { n: source.stats.errors })}
          </span>
        ) : null}
      </div>

      {source.stats.last_error ? (
        <div className="percept-source-error" data-testid={`percept-source-error-${source.name}`}>
          {t('butler.percept.sourceLastError', { msg: source.stats.last_error })}
        </div>
      ) : null}

      {/* 观察范围：源自报的目录/仓库/名单（键名保持后端原样，见 percept-contracts） */}
      {details.length ? (
        <>
          <button
            className="percept-detail-toggle"
            data-testid={`percept-source-detail-btn-${source.name}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {t('butler.percept.detailToggle')}
          </button>
          {expanded ? (
            <div className="percept-detail" data-testid={`percept-source-detail-${source.name}`}>
              {details.map((row) => (
                <div className="percept-detail-row" key={row.key}>
                  <span className="percept-detail-key">{row.key}</span>
                  <span className="percept-detail-value">{row.value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="percept-detail-empty">{t('butler.percept.detailEmpty')}</div>
      )}
    </div>
  )
}
