/**
 * 模型表单（独立组件）：左栏模型面板里的「添加 / 修改」两用表单。
 *
 * 两种模式由 leftStore.modelFormTarget 决定（列表末项「＋ 添加模型」→ 空，
 * 双击某个模型项 → 该模型名）：
 *
 * - **添加模式**（target=''）：字段与校验口径对齐 REPL /models → 添加其他模型
 *   （jarvis 侧 agent/model_manager.py::_add_custom_model_flow），提交走
 *   serve models.add；
 * - **编辑模式**（target 非空）：预填该模型现值（models.list 每项 config），
 *   内置模型名锁定不可改，提交走 serve models.edit。
 *
 * 密钥口径（与 REPL 的一处刻意差异）：桌面壳不回显密钥，表单 Key 框始终为空，
 * **留空 = 保持原 Key 不变**（REPL 预填明文、留空即清空）；改的是当前运行
 * 模型时后端会强制重建 provider，端点/接口类型改动立即生效。
 *
 * 结构复用设置面板行样式（.setting-row/.setting-label/.setting-hint）与左栏
 * 容器样式（glass-col）：文本框走 .model-input，下拉走自绘的 ThemedSelect
 * （原生 select 展开列表由系统绘制、固定蓝高亮，不随三主题皮肤变化），
 * 两者配色/圆角都由三张皮肤覆盖。
 *
 * @author aceFelix
 */

import { useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useLeftStore } from '../stores/leftStore'
import { useT } from '../i18n'
import ThemedSelect from './ThemedSelect'

/** 模型厂商选项（value 写入 provider/vendor；与 model_manager._MODEL_VENDOR_OPTIONS 对齐）。 */
const VENDOR_OPTIONS = [
  'deepseek',
  'dashscope',
  'zhipu',
  'moonshot',
  'minimax',
  'siliconflow',
  'xiaomimimo',
  'google',
  'openai',
  'anthropic',
  'other'
] as const

/** 接口类型选项（api_format；与 serve _rpc_models_add 白名单一致）。 */
const API_FORMAT_OPTIONS = ['openai', 'anthropic', 'dashscope', 'zai'] as const

/** 模型类型选项（text 纯文本省 token / multimodal 支持图片）。 */
const MODEL_TYPE_OPTIONS = ['text', 'multimodal'] as const

export default function ModelForm(): JSX.Element {
  const addModel = useBackendStore((s) => s.addModel)
  const editModel = useBackendStore((s) => s.editModel)
  const closeModelForm = useLeftStore((s) => s.closeModelForm)
  const target = useLeftStore((s) => s.modelFormTarget)
  const models = useLeftStore((s) => s.models)
  const t = useT()
  // 编辑目标（双击模型项进入）：取列表项拿现值默认值；不在列表里则退化为添加模式
  const editing = target ? models.find((m) => m.name === target) : undefined
  const inEdit = Boolean(target)
  const draft = editing?.config
  // 内置模型名锁定：它来自项目级 [llm.models]，改名只会产生「幽灵模型」
  const nameLocked = editing?.source === 'builtin'
  // 表单草稿：添加模式默认值与 REPL 添加流程一致（厂商 deepseek / 接口 openai /
  // 类型 text）；编辑模式预填该模型现值（api_key 不回显 → 始终为空，留空=不改）。
  const [vendor, setVendor] = useState<string>(draft?.vendor || 'deepseek')
  const [name, setName] = useState(target || '')
  const [apiKey, setApiKey] = useState('')
  const [apiFormat, setApiFormat] = useState<string>(draft?.api_format || 'openai')
  const [baseUrl, setBaseUrl] = useState(draft?.base_url ?? '')
  const [modelType, setModelType] = useState<string>(draft?.model_type || 'text')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /** 提交：模型名必填本地校验 → models.add / models.edit → 成功关闭回列表（失败保持打开可修正）。 */
  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('modelForm.nameRequired'))
      return
    }
    setError('')
    setSubmitting(true)
    const ok = inEdit
      ? await editModel({
          name: target,
          // 改名仅自定义模型生效（内置模型名输入框已禁用，值恒等于原名）
          new_name: trimmed,
          vendor,
          api_format: apiFormat,
          base_url: baseUrl.trim(),
          // 留空 = 保持原 Key（桌面壳不回显密钥，不能把「未填」当清空）
          api_key: apiKey.trim(),
          model_type: modelType
        })
      : await addModel({
          name: trimmed,
          vendor,
          api_format: apiFormat,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          model_type: modelType
        })
    setSubmitting(false)
    if (ok) closeModelForm()
  }

  return (
    <div className="panel" data-testid="panel-model-form">
      <div className="col-header settings-head">
        <button
          className="settings-back"
          data-testid="btn-model-form-back"
          title={t('left.modelFormBack')}
          onClick={closeModelForm}
        >
          ←
        </button>
        <span className="col-title">
          {inEdit ? t('left.modelFormEditTitle') : t('left.modelFormTitle')}
        </span>
        <span />
      </div>

      {/* 字段区：面板高度不够时自身滚动（form-scroll，样式见 main.css），
          避免表单溢出压到左栏底部的项目区块上。@author aceFelix */}
      <div className="settings-panel form-scroll" data-testid="model-form">
        {inEdit ? (
          <div className="setting-hint" data-testid="model-form-target">
            {t('modelForm.editingHint', { name: target })}
          </div>
        ) : null}

        <div className="setting-row">
          <span className="setting-label">{t('modelForm.vendor')}</span>
          <ThemedSelect
            testid="model-form-vendor"
            ariaLabel={t('modelForm.vendor')}
            value={vendor}
            options={VENDOR_OPTIONS.map((v) => ({ value: v, label: t(`modelForm.vendor.${v}`) }))}
            onChange={setVendor}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('modelForm.name')}</span>
          <div className="setting-hint">
            {nameLocked ? t('modelForm.nameLockedHint') : t('modelForm.nameHint')}
          </div>
          <input
            className="model-input"
            data-testid="model-form-name"
            value={name}
            disabled={nameLocked}
            onChange={(e) => {
              setName(e.target.value)
              // 用户开始修正时清掉本地校验提示（错误由后端回执另行提示）
              if (error) setError('')
            }}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('modelForm.apiKey')}</span>
          <div className="setting-hint">
            {inEdit && draft?.has_key ? t('modelForm.apiKeyKeepHint') : t('modelForm.apiKeyHint')}
          </div>
          <input
            type="password"
            className="model-input"
            data-testid="model-form-api-key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('modelForm.apiFormat')}</span>
          <ThemedSelect
            testid="model-form-api-format"
            ariaLabel={t('modelForm.apiFormat')}
            value={apiFormat}
            options={API_FORMAT_OPTIONS.map((v) => ({ value: v, label: t(`modelForm.format.${v}`) }))}
            onChange={setApiFormat}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('modelForm.baseUrl')}</span>
          <div className="setting-hint">{t('modelForm.baseUrlHint')}</div>
          <input
            className="model-input"
            data-testid="model-form-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('modelForm.modelType')}</span>
          <ThemedSelect
            testid="model-form-model-type"
            ariaLabel={t('modelForm.modelType')}
            value={modelType}
            options={MODEL_TYPE_OPTIONS.map((v) => ({ value: v, label: t(`modelForm.type.${v}`) }))}
            onChange={setModelType}
          />
        </div>

      </div>

      {/* 报错与操作按钮均在滚动区之外：校验失败原因常驻可见（不必滚到
          字段区底部去找），字段滚到任意位置也能直接保存/取消。@author aceFelix */}
      {error ? (
        <div className="model-form-error" data-testid="model-form-error">
          {error}
        </div>
      ) : null}

      <div className="model-form-actions">
        <button
          className="action-btn primary"
          data-testid="model-form-submit"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {inEdit ? t('modelForm.save') : t('modelForm.submit')}
        </button>
        <button
          className="action-btn"
          data-testid="model-form-cancel"
          onClick={closeModelForm}
        >
          {t('modelForm.cancel')}
        </button>
      </div>
    </div>
  )
}
