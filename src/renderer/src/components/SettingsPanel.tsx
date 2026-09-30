/**
 * 设置面板（独立组件）：整体替换右栏信息面板（App 按 uiStore.rightView 切换）。
 *
 * 结构：返回头（← 回信息面板）+ 四个分组：
 * - 外观（主题/语言/字体，本地偏好，localStorage 持久化）；
 * - 语音播报（主动播报 TTS 开关 + 音量/语速滑杆，后端联动）；
 * - 每日简报（开关 + 简报时间，后端联动，改动触发调度热重注册）；
 * - 截止日期追踪（开关 + 检查时间，后端联动）。
 *
 * 后端联动项真源在 jarvis settings.toml（白名单见 agent/config/
 * desktop_settings.py）：settings.get 回填、settings.set 写回（乐观更新 +
 * 失败回滚由 backendStore.setBackendSetting 承担）；单键 null（未拉取/未
 * 连接）时该行显示离线态文案。时间项用自绘 <ThemedTimePicker>（小时/分钟两个主题化
 * 下拉并排；原生 input[type=time] 的弹出面板由 Chromium 内部绘制，无法主题化），
 * 点选即提交合法 HH:MM（后端二次校验）。
 *
 * 复用右栏容器样式（#right-col + glass-col），视觉与三栏布局口径一致。
 *
 * @author aceFelix
 */

import { useBackendStore } from '../stores/backendStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { useT } from '../i18n'
import ThemedTimePicker from './ThemedTimePicker'
import FontPicker from './FontPicker'

/** 行组件公共 props：label/hintKey/testid 前缀由父组件传入。 */
interface RowProps {
  labelKey: string
  hintKey?: string
  testid: string
}

/** 开关行：值为 null 显离线态，否则渲染拨动开关（点击乐观写回）。 */
function ToggleRow({
  labelKey,
  hintKey,
  testid,
  settingKey
}: RowProps & { settingKey: 'proactive_tts_enabled' | 'briefing_enabled' | 'deadline_enabled' }): JSX.Element {
  const value = useSettingsStore((s) => s.backendSettings[settingKey])
  const setBackendSetting = useBackendStore((s) => s.setBackendSetting)
  const t = useT()
  return (
    <div className="setting-row">
      <span className="setting-label">{t(labelKey)}</span>
      {hintKey ? <div className="setting-hint">{t(hintKey)}</div> : null}
      {value === null ? (
        <div className="side-empty" data-testid={`${testid}-offline`}>
          {t('settings.offline')}
        </div>
      ) : (
        <button
          role="switch"
          aria-checked={value}
          className={`toggle${value ? ' on' : ''}`}
          data-testid={`toggle-${testid}`}
          onClick={() => void setBackendSetting(settingKey, !value)}
        />
      )}
    </div>
  )
}

/** 时间行（HH:MM）：自绘时间选择器，点选即写回；值为 null 显离线态。 */
function TimeRow({
  labelKey,
  testid,
  settingKey
}: RowProps & { settingKey: 'briefing_time' | 'deadline_check_time' }): JSX.Element {
  const value = useSettingsStore((s) => s.backendSettings[settingKey])
  const setBackendSetting = useBackendStore((s) => s.setBackendSetting)
  const t = useT()
  // 自绘选择器恒产生合法 HH:MM（点选即提交，无半填状态）；仍校验一次，脏值不敲后端
  const commit = (next: string): void => {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(next)) void setBackendSetting(settingKey, next)
  }
  return (
    <div className="setting-row">
      <span className="setting-label">{t(labelKey)}</span>
      {value === null ? (
        <div className="side-empty" data-testid={`${testid}-offline`}>
          {t('settings.offline')}
        </div>
      ) : (
        <ThemedTimePicker testid={`time-${testid}`} ariaLabel={t(labelKey)} value={value} onChange={commit} />
      )}
    </div>
  )
}

/** 数值滑杆行：拖动即时乐观写回（后端校验范围），旁边显示当前值。 */
function RangeRow({
  labelKey,
  testid,
  settingKey,
  min,
  max,
  step,
  display
}: RowProps & {
  settingKey: 'tts_volume' | 'tts_speech_rate'
  min: number
  max: number
  step: number
  display: (v: number) => string
}): JSX.Element {
  const value = useSettingsStore((s) => s.backendSettings[settingKey])
  const setBackendSetting = useBackendStore((s) => s.setBackendSetting)
  const t = useT()
  return (
    <div className="setting-row">
      <span className="setting-label">{t(labelKey)}</span>
      {value === null ? (
        <div className="side-empty" data-testid={`${testid}-offline`}>
          {t('settings.offline')}
        </div>
      ) : (
        <div className="setting-range">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            data-testid={`range-${testid}`}
            onChange={(e) => void setBackendSetting(settingKey, Number(e.target.value))}
          />
          <output className="setting-range-value" data-testid={`${testid}-value`}>
            {display(value)}
          </output>
        </div>
      )}
    </div>
  )
}

export default function SettingsPanel(): JSX.Element {
  const theme = useSettingsStore((s) => s.theme)
  const language = useSettingsStore((s) => s.language)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const fontLatin = useSettingsStore((s) => s.fontLatin)
  const fontCjk = useSettingsStore((s) => s.fontCjk)
  const setFontLatin = useSettingsStore((s) => s.setFontLatin)
  const setFontCjk = useSettingsStore((s) => s.setFontCjk)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const t = useT()

  return (
    <aside id="right-col" className="glass-col" data-testid="settings-view">
      <div className="col-header settings-head">
        <button
          className="settings-back"
          data-testid="btn-settings-back"
          title={t('settings.back')}
          onClick={closeSettings}
        >
          ←
        </button>
        <span className="col-title">{t('settings.title')}</span>
        <span />
      </div>

      {/* 外观：主题 / 语言（本地偏好，localStorage 持久化） */}
      <div className="col-header">
        <span className="col-title">{t('settings.appearance')}</span>
      </div>
      <div className="settings-panel" data-testid="settings-panel">
        <div className="setting-row">
          <span className="setting-label">{t('settings.theme')}</span>
          <div className="segmented">
            {/* 三主题同风格（Y2K 像素复古）仅配色不同：荧光绿排第一（亦为首启默认）。
                作者：aceFelix */}
            <button
              className={`seg-btn${theme === 'retro' ? ' active' : ''}`}
              data-testid="btn-theme-retro"
              onClick={() => setTheme('retro')}
            >
              {t('settings.theme.retro')}
            </button>
            <button
              className={`seg-btn${theme === 'dark' ? ' active' : ''}`}
              data-testid="btn-theme-dark"
              onClick={() => setTheme('dark')}
            >
              {t('settings.theme.dark')}
            </button>
            <button
              className={`seg-btn${theme === 'light' ? ' active' : ''}`}
              data-testid="btn-theme-light"
              onClick={() => setTheme('light')}
            >
              {t('settings.theme.light')}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">{t('settings.language')}</span>
          <div className="segmented">
            <button
              className={`seg-btn${language === 'zh' ? ' active' : ''}`}
              data-testid="btn-lang-zh"
              onClick={() => setLanguage('zh')}
            >
              中文
            </button>
            <button
              className={`seg-btn${language === 'en' ? ' active' : ''}`}
              data-testid="btn-lang-en"
              onClick={() => setLanguage('en')}
            >
              English
            </button>
          </div>
        </div>
        {/* 字体：英文/中文各自单设（本地偏好，localStorage 持久化）；下拉数据源为
            本机枚举字体，未选回落主题默认等宽栈。选项以自身字体预览，中文字体行
            置顶并打「含中文」标签。@author aceFelix */}
        <div className="setting-row">
          <span className="setting-label">{t('settings.fontLatin')}</span>
          <FontPicker
            testid="font-latin"
            ariaLabel={t('settings.fontLatin')}
            cjkFirst={false}
            value={fontLatin}
            onChange={setFontLatin}
          />
        </div>
        <div className="setting-row">
          <span className="setting-label">{t('settings.fontCjk')}</span>
          <FontPicker
            testid="font-cjk"
            ariaLabel={t('settings.fontCjk')}
            cjkFirst
            value={fontCjk}
            onChange={setFontCjk}
          />
        </div>
      </div>

      {/* 语音播报：主动播报 TTS 开关 + 音量/语速（后端联动） */}
      <div className="col-header">
        <span className="col-title">{t('settings.voiceSection')}</span>
      </div>
      <div className="settings-panel">
        <ToggleRow
          labelKey="settings.proactiveTts"
          hintKey="settings.proactiveTtsHint"
          testid="proactive-tts"
          settingKey="proactive_tts_enabled"
        />
        <RangeRow
          labelKey="settings.ttsVolume"
          testid="tts-volume"
          settingKey="tts_volume"
          min={0}
          max={100}
          step={1}
          display={(v) => String(v)}
        />
        <RangeRow
          labelKey="settings.ttsSpeechRate"
          testid="tts-speech-rate"
          settingKey="tts_speech_rate"
          min={0.5}
          max={2}
          step={0.05}
          display={(v) => `${v.toFixed(2)}×`}
        />
      </div>

      {/* 每日简报：开关 + 简报时间（后端联动，改动触发调度热重注册） */}
      <div className="col-header">
        <span className="col-title">{t('settings.briefingSection')}</span>
      </div>
      <div className="settings-panel">
        <ToggleRow
          labelKey="settings.briefingEnabled"
          hintKey="settings.briefingEnabledHint"
          testid="briefing"
          settingKey="briefing_enabled"
        />
        <TimeRow labelKey="settings.briefingTime" testid="briefing-time" settingKey="briefing_time" />
      </div>

      {/* 截止日期追踪：开关 + 每日检查时间（后端联动） */}
      <div className="col-header">
        <span className="col-title">{t('settings.deadlineSection')}</span>
      </div>
      <div className="settings-panel">
        <ToggleRow
          labelKey="settings.deadlineEnabled"
          hintKey="settings.deadlineEnabledHint"
          testid="deadline"
          settingKey="deadline_enabled"
        />
        <TimeRow
          labelKey="settings.deadlineCheckTime"
          testid="deadline-check-time"
          settingKey="deadline_check_time"
        />
      </div>
    </aside>
  )
}
