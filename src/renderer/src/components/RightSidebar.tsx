/**
 * 右栏：系统指标三卡片（CPU / 内存 / 磁盘）。
 *
 * 数据源：metrics 事件每 2 秒推送进 useMetricsStore；
 * CPU > 85% 时进度条变红（hot），与 workbench 口径一致。
 *
 * @author aceFelix
 */

import { useMetricsStore } from '../stores/metricsStore'

function gb(detail: { used_gb?: number; total_gb?: number } | null): string {
  if (!detail?.total_gb) return ''
  return `${detail.used_gb ?? 0} / ${detail.total_gb} GB`
}

export default function RightSidebar(): JSX.Element {
  const cpu = useMetricsStore((s) => s.cpu)
  const memory = useMetricsStore((s) => s.memory)
  const disk = useMetricsStore((s) => s.disk)

  const memPercent = memory?.percent ?? 0
  const diskPercent = disk?.percent ?? 0

  return (
    <aside id="right-col" className="glass-col">
      <div className="col-header">
        <span className="col-title">系统状态</span>
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
          <span>内存</span>
          <span className="metric-value">{memPercent}%</span>
        </div>
        <div className="gauge">
          <div className="gauge-fill" style={{ width: `${memPercent}%` }} />
        </div>
        <div className="metric-detail">{gb(memory)}</div>
      </div>

      <div className="metric-card">
        <div className="metric-head">
          <span>磁盘</span>
          <span className="metric-value">{diskPercent}%</span>
        </div>
        <div className="gauge">
          <div className="gauge-fill" style={{ width: `${diskPercent}%` }} />
        </div>
        <div className="metric-detail">{gb(disk)}</div>
      </div>
    </aside>
  )
}
