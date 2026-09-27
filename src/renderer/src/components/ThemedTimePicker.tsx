/**
 * 主题化时间选择器（自绘，替代原生 <input type="time">）。
 *
 * 动机（2026-09 实机反馈）：原生 time 输入框点时钟图标弹出的时/分面板由 Chromium
 * 内部 UI 绘制（白底 + 系统蓝选中 + 系统圆角），CSS 完全够不到，与荧光绿/电光蓝/
 * 金属银三张皮肤都不搭。改为小时/分钟两个主题化下拉并排（复用 ThemedSelect：主题化
 * 触发器 + portal 浮层 + 键盘/滚动契约），外观与其它下拉同口径，交互仍是一次点选。
 *
 * 取值口径：value 为后端设置项格式 "HH:MM"；解析失败只影响显示（回退 00:00），
 * 任一侧改动即把两侧拼回完整 HH:MM 回调，绝不吐出非法值。
 *
 * @author aceFelix
 */

import ThemedSelect, { type SelectOption } from './ThemedSelect'
import { useT } from '../i18n'

/** 两位补零（00-23 / 00-59）。 */
const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 小时选项 00-23。 */
const HOUR_OPTIONS: SelectOption[] = Array.from({ length: 24 }, (_, i) => {
  const v = pad2(i)
  return { value: v, label: v }
})

/** 分钟选项 00-59（与原生 time 面板同口径给全量；浮层内可滚动查看）。 */
const MINUTE_OPTIONS: SelectOption[] = Array.from({ length: 60 }, (_, i) => {
  const v = pad2(i)
  return { value: v, label: v }
})

/** 解析 "HH:MM"：不合规则回退 00:00（仅用于显示，回调始终拼合法值）。 */
function split(value: string): { hour: string; minute: string } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return m ? { hour: m[1], minute: m[2] } : { hour: '00', minute: '00' }
}

export default function ThemedTimePicker(props: {
  /** 当前值（"HH:MM"）。 */
  value: string
  /** 任一侧改动即回调完整 "HH:MM"。 */
  onChange: (value: string) => void
  /** 容器 data-testid（两个下拉自动派生 `-hour` / `-minute`）。 */
  testid?: string
  /** 行标签（拼出「<标签> 小时 / <标签> 分钟」的无障碍名）。 */
  ariaLabel?: string
}): JSX.Element {
  const t = useT()
  const { hour, minute } = split(props.value)
  return (
    <div className="themed-time" data-testid={props.testid} data-value={props.value}>
      <ThemedSelect
        testid={props.testid ? `${props.testid}-hour` : undefined}
        ariaLabel={`${props.ariaLabel ?? ''} ${t('settings.hour')}`.trim()}
        value={hour}
        options={HOUR_OPTIONS}
        onChange={(h) => props.onChange(`${h}:${minute}`)}
      />
      <span className="themed-time-sep">:</span>
      <ThemedSelect
        testid={props.testid ? `${props.testid}-minute` : undefined}
        ariaLabel={`${props.ariaLabel ?? ''} ${t('settings.minute')}`.trim()}
        value={minute}
        options={MINUTE_OPTIONS}
        onChange={(m) => props.onChange(`${hour}:${m}`)}
      />
    </div>
  )
}
