/**
 * 感知源面板 →「最近事件」子视图：隐私自查的入口。
 *
 * 设计取向（aceFelix，2026-10 W2 第 5 步）：这一节不是「功能展示」，而是把
 * 「J.A.R.V.I.S 到底记了我什么」摊开给用户看。事件明细**原样渲染后端给的
 * `payload.summary`**，前端不做二次脱敏——脱敏在采集侧已经做过（窗口标题剥凭据
 * 并截断、密码类应用零事件、邮件只取信封头），这里再加一层只会让自查失真。
 *
 * 条数上限由后端 `EVENT_LIMIT`（50）决定，全量历史在留痕文件里（路径显示在总览
 * 卡，关掉「本地留痕事件」后那里会显「未开启」）。总线没跑时列表必然为空，这里
 * 给一条"总线未运行"的说明，避免用户把"没事件"误读成"没在采"或"坏了"。
 *
 * @author aceFelix
 */

import { useT } from '../i18n'
import {
  formatEventTime,
  perceptEventSummary,
  type PerceptEventInfo,
  type PerceptStatus
} from '../../../shared/percept-contracts'

/** 组件 props：整份状态快照（要用源名 → 显示名的映射）。 */
interface Props {
  status: PerceptStatus
}

export default function PerceptEventList({ status }: Props): JSX.Element {
  const t = useT()
  // 源名 → 面板显示名（后端 SOURCE_LABELS 给的中文，与「感知源」标签页一致）
  const labels = new Map(status.sources.map((s) => [s.name, s.label]))

  return (
    <div className="percept-events" data-testid="percept-event-list">
      <div className="setting-hint percept-events-hint">{t('butler.percept.eventsLimitHint')}</div>

      {!status.bus_running ? (
        <div className="side-empty" data-testid="percept-events-idle">
          {t('butler.percept.eventsNoBus')}
        </div>
      ) : null}

      {status.recent_events.length ? (
        <ul className="percept-event-ul">
          {status.recent_events.map((event, index) => (
            <EventRow
              key={`${event.dedup_key || event.kind}-${index}`}
              event={event}
              label={labels.get(event.source) ?? event.source}
            />
          ))}
        </ul>
      ) : status.bus_running ? (
        <div className="side-empty" data-testid="percept-events-empty">
          {t('butler.percept.eventsEmpty')}
        </div>
      ) : null}
    </div>
  )
}

/** 单条事件：时间 + 源名 + 摘要 + 显著性先验。 */
function EventRow({ event, label }: { event: PerceptEventInfo; label: string }): JSX.Element {
  const t = useT()
  const time = formatEventTime(event.ts)
  return (
    <li className="percept-event" data-testid="percept-event">
      <span className="percept-event-time">{time}</span>
      <span className="percept-event-source">{label}</span>
      <span className="percept-event-summary">{perceptEventSummary(event)}</span>
      <span className="percept-event-salience">
        {t('butler.percept.eventsSalience', { n: event.salience_hint.toFixed(2) })}
      </span>
    </li>
  )
}
