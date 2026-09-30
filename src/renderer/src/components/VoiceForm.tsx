/**
 * 音色表单（独立组件）：左栏音色面板里的「添加 / 修改」两用表单。
 *
 * 两种模式由 leftStore.voiceFormTarget 决定（列表末项「＋ 添加音色」→ 空，
 * 双击某个自定义音色项 → 该音色名）：
 *
 * - **添加模式**（target=''）：字段口径对齐 REPL /tts-voice 添加表单
 *   （jarvis 侧 voice_commands._add_tts_voice_flow），提交走 serve voices.add；
 * - **编辑模式**（target 非空）：预填该音色现值（voices.list 目录项），
 *   音色名锁定不可改（后端同名 upsert=覆盖编辑；改名请走「＋ 添加音色」
 *   新增后删除旧项），提交同样走 voices.add（同名覆盖）。
 *
 * 音色-模型硬约束（本表单存在的核心意义）：DashScope 系统音色按模型系列
 * 隔离、复刻 voice_id 绑定 target_model，故「适配模型」为必填语义字段 ——
 * 选家族 cosyvoice-v3（v3 系列通用）或具体模型；选「不限」则切换时不联动
 * 改 tts_model。后端在切换音色时按此字段自动联动校正模型（voices.select
 * 回执 linked_model）。当前仅支持阿里云 DashScope 厂商（与终端一致）。
 *
 * 结构复用 ModelForm 的行样式（.setting-row/.setting-label/.setting-hint）
 * 与 .model-input / ThemedSelect（自绘下拉随三主题皮肤），样式零新增。
 *
 * @author aceFelix
 */

import { useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useLeftStore } from '../stores/leftStore'
import { useT } from '../i18n'
import ThemedSelect from './ThemedSelect'

/**
 * 适配模型选项（与 jarvis 侧项目 TTS 模型口径一致）。
 * value 直接落 [tts.custom_voices."name"].model；''=不限。
 * @author aceFelix */
const VOICE_MODEL_OPTIONS = [
  '',
  'cosyvoice-v3',
  'cosyvoice-v3-flash',
  'cosyvoice-v3-plus',
  'cosyvoice-v3.5-plus'
] as const

export default function VoiceForm(): JSX.Element {
  const addVoice = useBackendStore((s) => s.addVoice)
  const closeVoiceForm = useLeftStore((s) => s.closeVoiceForm)
  const target = useLeftStore((s) => s.voiceFormTarget)
  const voices = useLeftStore((s) => s.voices)
  const t = useT()
  // 编辑目标（双击自定义项进入）：取列表项预填现值；不在列表里退化为添加模式
  const editing = target ? voices.find((v) => v.name === target) : undefined
  const inEdit = Boolean(target)
  // 表单草稿：音色名/voice_id 必填；适配模型默认家族前缀（v3 系列通用，
  // 与终端表单默认值同口径）
  const [name, setName] = useState(target || '')
  const [voiceId, setVoiceId] = useState(editing?.voice_id ?? '')
  const [model, setModel] = useState<string>(editing?.model ?? 'cosyvoice-v3')
  const [description, setDescription] = useState(
    editing && editing.description !== editing.name ? editing.description : ''
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /** 提交：本地必填校验（音色名/voice_id）→ voices.add（同名 upsert）→ 成功关闭回列表（失败保持打开可修正）。 */
  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('voiceForm.nameRequired'))
      return
    }
    if (!voiceId.trim()) {
      setError(t('voiceForm.voiceIdRequired'))
      return
    }
    setError('')
    setSubmitting(true)
    // 编辑与添加同走 voices.add：后端按音色名 upsert 覆盖 [tts.custom_voices]
    const ok = await addVoice({
      name: trimmed,
      voice_id: voiceId.trim(),
      model,
      description: description.trim()
    })
    setSubmitting(false)
    if (ok) closeVoiceForm()
  }

  return (
    <div className="panel" data-testid="panel-voice-form">
      <div className="col-header settings-head">
        <button
          className="settings-back"
          data-testid="btn-voice-form-back"
          title={t('left.voiceFormBack')}
          onClick={closeVoiceForm}
        >
          ←
        </button>
        <span className="col-title">
          {inEdit ? t('left.voiceFormEditTitle') : t('left.voiceFormTitle')}
        </span>
        <span />
      </div>

      {/* 字段区：面板高度不够时自身滚动（form-scroll，样式见 main.css），
          避免表单溢出压到左栏底部的项目区块上。@author aceFelix */}
      <div className="settings-panel form-scroll" data-testid="voice-form">
        {inEdit ? (
          <div className="setting-hint" data-testid="voice-form-target">
            {t('voiceForm.editingHint', { name: target })}
          </div>
        ) : null}

        <div className="setting-row">
          <span className="setting-label">{t('voiceForm.name')}</span>
          <div className="setting-hint">
            {inEdit ? t('voiceForm.nameLockedHint') : t('voiceForm.nameHint')}
          </div>
          <input
            className="model-input"
            data-testid="voice-form-name"
            value={name}
            disabled={inEdit}
            onChange={(e) => {
              setName(e.target.value)
              // 用户开始修正时清掉本地校验提示（错误由后端回执另行提示）
              if (error) setError('')
            }}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('voiceForm.voiceId')}</span>
          <div className="setting-hint">{t('voiceForm.voiceIdHint')}</div>
          <input
            className="model-input"
            data-testid="voice-form-voice-id"
            value={voiceId}
            onChange={(e) => {
              setVoiceId(e.target.value)
              if (error) setError('')
            }}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('voiceForm.model')}</span>
          <div className="setting-hint">{t('voiceForm.modelHint')}</div>
          <ThemedSelect
            testid="voice-form-model"
            ariaLabel={t('voiceForm.model')}
            value={model}
            options={VOICE_MODEL_OPTIONS.map((v) => ({
              value: v,
              label: v ? v : t('voiceForm.modelAny')
            }))}
            onChange={setModel}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('voiceForm.description')}</span>
          <div className="setting-hint">{t('voiceForm.descriptionHint')}</div>
          <input
            className="model-input"
            data-testid="voice-form-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

      </div>

      {/* 报错与操作按钮均在滚动区之外：校验失败原因常驻可见，
          字段滚到任意位置也能直接保存/取消。@author aceFelix */}
      {error ? (
        <div className="model-form-error" data-testid="voice-form-error">
          {error}
        </div>
      ) : null}

      <div className="model-form-actions">
        <button
          className="action-btn primary"
          data-testid="voice-form-submit"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {inEdit ? t('voiceForm.save') : t('voiceForm.submit')}
        </button>
        <button
          className="action-btn"
          data-testid="voice-form-cancel"
          onClick={closeVoiceForm}
        >
          {t('voiceForm.cancel')}
        </button>
      </div>
    </div>
  )
}
