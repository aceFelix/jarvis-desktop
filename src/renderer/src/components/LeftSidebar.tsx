/**
 * 左栏：模式切换（文本/实时/语音）+ 三面板切换（历史会话/模型/音色）+ 状态 footer。
 *
 * 面板切换即刷新对应列表（sessions.list / models.list / voices.list 指令）；
 * 列表项悬停/选中字体变蓝（与 workbench 交互口径一致，样式在 main.css）。
 * 模型面板支持「＋ 添加模型」：列表末项点击进入 ModelForm 组件（整体替换
 * 列表，与右栏 SettingsPanel 同模式），提交走 models.add 指令。
 * 模型项交互对齐会话列表：双击进配置编辑表单（models.edit）、右键显删除
 * 按钮（models.remove，仅自定义模型可删）。
 * 音色面板（2026-09-28 音色-模型适配）同模型面板范式：末项「＋ 添加音色」
 * 进 VoiceForm（voices.add 同名 upsert=编辑）、双击自定义项编辑、右键删除
 *（voices.delete，仅自定义音色可删）；副行透出适配模型/将联动模型预告
 *（voices.list 全量目录的 model/linked 字段）。
 *
 * @author aceFelix
 */

import { useEffect, useRef, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useLeftStore, type ChatMode, type LeftPanel } from '../stores/leftStore'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'
import ModelForm from './ModelForm'
import VoiceForm from './VoiceForm'

/** 历史会话项：单击加载（220ms 延时让位双击）、双击内联改名、右键显删除按钮。
 *
 * 改名输入框：Enter/失焦提交，Esc 取消；空名或未变化视为取消。
 * 删除按钮仅右键后出现在项右侧，点击才真删（二次确认）。
 * @author aceFelix
 */
function SessionItem(props: {
  name: string
  sub: string
  current: boolean
  pendingDelete: boolean
  editing: boolean
  delGlyph: string
  delTip: string
  onOpen: () => void
  onContextMenu: () => void
  onEditStart: () => void
  onDelete: () => void
  onRename: (newName: string) => void
  onEditEnd: () => void
}): JSX.Element {
  const clickTimer = useRef<number | null>(null)
  const [draft, setDraft] = useState(props.name)
  // 进入编辑态时同步草稿（避免上次未提交的残留）。@author aceFelix
  useEffect(() => {
    if (props.editing) setDraft(props.name)
  }, [props.editing, props.name])

  const commit = (): void => {
    const v = draft.trim()
    if (v && v !== props.name) props.onRename(v)
    else props.onEditEnd()
  }

  return (
    <div
      className={`list-item session-item${props.current ? ' current' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        // 单击延时：双击（改名）会先清掉该定时器，避免「想改名却先加载一次」
        if (clickTimer.current) window.clearTimeout(clickTimer.current)
        clickTimer.current = window.setTimeout(props.onOpen, 220)
      }}
      onDoubleClick={() => {
        if (clickTimer.current) window.clearTimeout(clickTimer.current)
        props.onEditStart()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        props.onContextMenu()
      }}
      onKeyDown={(e) => {
        if (!props.editing && (e.key === 'Enter' || e.key === ' ')) props.onOpen()
      }}
    >
      {props.editing ? (
        <input
          className="session-rename-input"
          data-testid="session-rename-input"
          value={draft}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') props.onEditEnd()
          }}
          onBlur={commit}
        />
      ) : (
        <>
          <span className="session-title">{props.name}</span>
          <span className="sub">{props.sub}</span>
          {props.pendingDelete ? (
            <button
              className="session-del-btn"
              data-testid="session-del-btn"
              title={props.delTip}
              onClick={(e) => {
                e.stopPropagation()
                props.onDelete()
              }}
            >
              {props.delGlyph}
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}

/** 通用列表项（标题 + 副行 + 当前标记）；extraClass/testid 供特殊项（如「＋ 添加模型」）使用。 */
function ListItem(props: {
  title: string
  sub?: string
  current?: boolean
  onClick?: () => void
  extraClass?: string
  testid?: string
}): JSX.Element {
  return (
    <div
      className={`list-item${props.current ? ' current' : ''}${props.extraClass ? ` ${props.extraClass}` : ''}`}
      data-testid={props.testid}
      onClick={props.onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') props.onClick?.()
      }}
    >
      <span>{props.title}</span>
      {props.sub ? <span className="sub">{props.sub}</span> : null}
    </div>
  )
}

/** 模型 / 音色项：单击切换（220ms 延时让位双击）、双击进编辑表单、右键显删除按钮。
 *
 * 交互范式对齐会话列表（SessionItem）；同一组件被模型面板与音色面板复用
 *（2026-09-28 音色面板接入时 testid 参数化，避免复制粘贴两份）。差异：
 * - 双击不内联改名，而是切到 ModelForm / VoiceForm 编辑该项（字段多，内联框放不下），
 *   改名在表单里完成（音色名则直接锁定，同名 upsert 即编辑）；
 * - 删除按钮仅 removable（自定义项）出现 —— 内置模型/音色后端拒绝删除；
 * - 当前/待生效项仍可双击、右键（noop 只去掉手型与悬停高亮，不再屏蔽指针
 *   事件），否则「改当前项配置」这条最常用的路径点不进去。
 * @author aceFelix
 */
function ModelItem(props: {
  name: string
  sub: string
  current: boolean
  extraClass: string
  selectable: boolean
  removable: boolean
  pendingDelete: boolean
  delGlyph: string
  delTip: string
  tip: string
  /** 项 testid（默认 model-item；音色面板传 voice-item）。 */
  testid?: string
  /** 删除按钮 testid（默认 model-del-btn；音色面板传 voice-del-btn）。 */
  delTestid?: string
  onSelect: () => void
  onEdit: () => void
  onContextMenu: () => void
  onDelete: () => void
}): JSX.Element {
  const clickTimer = useRef<number | null>(null)

  return (
    <div
      className={`list-item model-item${props.current ? ' current' : ''}${props.extraClass ? ` ${props.extraClass}` : ''}`}
      data-testid={props.testid ?? 'model-item'}
      data-name={props.name}
      role="button"
      tabIndex={0}
      title={props.tip}
      onClick={() => {
        // 单击延时：双击（进编辑）会先清掉该定时器，避免「想改配置却先切了模型」
        if (clickTimer.current) window.clearTimeout(clickTimer.current)
        if (props.selectable) clickTimer.current = window.setTimeout(props.onSelect, 220)
      }}
      onDoubleClick={() => {
        if (clickTimer.current) window.clearTimeout(clickTimer.current)
        props.onEdit()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        props.onContextMenu()
      }}
      onKeyDown={(e) => {
        if (props.selectable && (e.key === 'Enter' || e.key === ' ')) props.onSelect()
      }}
    >
      <span>{props.name}</span>
      {props.sub ? <span className="sub">{props.sub}</span> : null}
      {props.pendingDelete && props.removable ? (
        <button
          className="session-del-btn"
          data-testid={props.delTestid ?? 'model-del-btn'}
          title={props.delTip}
          onClick={(e) => {
            e.stopPropagation()
            props.onDelete()
          }}
        >
          {props.delGlyph}
        </button>
      ) : null}
    </div>
  )
}

/** 模型 / 音色项状态类：已选中（current）或已点选待重启（pending）都不再响应点选。
 *
 * 后端 models.select / voices.select 只持久化配置（重启引擎才加载），列表的 current
 * 不会随点选移动；若不给这两类项去掉手型与悬停高亮，用户会以为没选中而反复点，
 * 每次都弹一条「已切换」提示。
 *
 * 注：noop 只负责视觉（去手型 + 悬停不变色），**不再屏蔽指针事件** ——
 * 当前模型仍需可双击改配置、可右键删。点选去重由各项的 onClick 守卫负责。
 * @author aceFelix
 */
function selectItemClass(current?: boolean, pending?: boolean): string {
  if (current) return 'noop'
  return pending ? 'pending noop' : ''
}

export default function LeftSidebar(): JSX.Element {
  const {
    sessions,
    models,
    voices,
    activePanel,
    mode,
    talkActive,
    voiceActive,
    modelFormOpen,
    modelFormTarget,
    voiceFormOpen,
    voiceFormTarget,
    pendingModel,
    pendingVoice
  } = useLeftStore()
  const { setActivePanel, setMode, openModelForm, editModelForm, openVoiceForm, editVoiceForm } = useLeftStore()
  const backend = useBackendStore()
  const t = useT()
  const g = useGlyphs()
  // 会话项交互态：pendingDelete=右键待删会话名；editing=双击内联改名会话名。
  // @author aceFelix
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // 模型项交互态：pendingDeleteModel=右键待删模型名（仅自定义模型会显示删除按钮）。
  // @author aceFelix
  const [pendingDeleteModel, setPendingDeleteModel] = useState<string | null>(null)
  // 音色项交互态：右键待删自定义音色名（口径同模型面板，2026-09-28）。
  // @author aceFelix
  const [pendingDeleteVoice, setPendingDeleteVoice] = useState<string | null>(null)

  // 面板切换即刷新对应数据（与 workbench switchPanel 口径一致）。
  // 守卫用 wsConnected 而非 client：client 在 connect() 里一创建就非 null，
  // 但此时 WS 仍处 CONNECTING 未 OPEN，发指令会被 sendCommand 拒绝并误报
  // "未连接到后端"；wsConnected 仅在 onopen 后置真，保证刷新发生在连接就绪后。
  // @author aceFelix
  useEffect(() => {
    if (!backend.wsConnected) return
    // 面板切换时收起待删态（避免切回时残留上一个面板的删除按钮）。@author aceFelix
    setPendingDelete(null)
    setPendingDeleteModel(null)
    setPendingDeleteVoice(null)
    setEditing(null)
    if (activePanel === 'history') void backend.refreshSessions()
    else if (activePanel === 'model') void backend.refreshModels()
    else void backend.refreshVoices()
  }, [activePanel, backend.wsConnected])

  const switchMode = (next: ChatMode): void => {
    if (next === mode) return
    // 语音 / 实时：交给各自 toggle（内部 setMode 并发 start；引擎侧互斥自动停对方）。
    if (next === 'voice') {
      void backend.toggleVoice()
      return
    }
    if (next === 'talk') {
      void backend.toggleTalk()
      return
    }
    // 文本：停掉当前正在跑的实时 / 半双工语音（停完由 *_stopped 事件回 text）。
    if (talkActive) void backend.toggleTalk()
    else if (voiceActive) void backend.toggleVoice()
    else setMode('text')
  }

  return (
    <aside id="left-col" className="glass-col">
      <div className="col-header">
        <span className="col-title">{t('left.console')}</span>
      </div>

      {/* 模式切换 */}
      <div className="segmented">
        <button
          className={`seg-btn${mode === 'text' ? ' active' : ''}`}
          title={t('left.mode.text.tip')}
          onClick={() => switchMode('text')}
        >
          {g.modeText} {t('left.mode.text')}
        </button>
        <button
          className={`seg-btn${mode === 'talk' ? ' active' : ''}`}
          title={t('left.mode.talk.tip')}
          onClick={() => switchMode('talk')}
        >
          {g.modeTalk} {t('left.mode.talk')}
        </button>
        <button
          className={`seg-btn${mode === 'voice' ? ' active' : ''}`}
          title={t('left.mode.voice.tip')}
          onClick={() => switchMode('voice')}
        >
          {g.modeVoice} {t('left.mode.voice')}
        </button>
      </div>

      {/* 面板切换：历史会话 ⇄ 模型 ⇄ 音色 */}
      <div className="segmented">
        {(
          [
            ['history', t('left.panel.history'), g.panelHistory],
            ['model', t('left.panel.model'), g.panelModel],
            ['voice', t('left.panel.voice'), g.panelVoice]
          ] as Array<[LeftPanel, string, string]>
        ).map(([panel, label, glyph]) => (
          <button
            key={panel}
            className={`seg-btn${activePanel === panel ? ' active' : ''}`}
            onClick={() => setActivePanel(panel)}
          >
            {glyph} {label}
          </button>
        ))}
      </div>

      {/* 面板一：历史会话 */}
      {activePanel === 'history' ? (
        <div className="panel" data-testid="panel-history">
          <div
            className="list-area"
            onContextMenu={(e) => {
              // 空白处右键：收起删除按钮。@author aceFelix
              e.preventDefault()
              setPendingDelete(null)
            }}
          >
            {sessions.slice(0, 60).map((s) => (
              <SessionItem
                key={s.name}
                name={s.name}
                sub={`${new Date(s.updated_at * 1000).toLocaleString()} · ${t('left.messagesCount', { n: s.message_count })}`}
                current={!!s.current}
                pendingDelete={pendingDelete === s.name}
                editing={editing === s.name}
                delGlyph={g.sessionDelete}
                delTip={t('left.deleteSession')}
                onOpen={() => {
                  setPendingDelete(null)
                  setEditing(null)
                  if (!s.current) void backend.openSession(s.name)
                }}
                onContextMenu={() => setPendingDelete((p) => (p === s.name ? null : s.name))}
                onEditStart={() => {
                  setPendingDelete(null)
                  setEditing(s.name)
                }}
                onDelete={() => {
                  setPendingDelete(null)
                  void backend.deleteSession(s.name)
                }}
                onRename={(v) => {
                  setEditing(null)
                  void backend.renameSession(s.name, v)
                }}
                onEditEnd={() => setEditing(null)}
              />
            ))}
          </div>
          <button className="action-btn" onClick={() => void backend.newSession()}>
            {t('left.newSession')}
          </button>
        </div>
      ) : null}

      {/* 面板二：模型（列表 ⇄ 模型表单；表单为独立组件，同右栏设置面板模式） */}
      {activePanel === 'model' ? (
        modelFormOpen ? (
          // key 随编辑目标变化：连续双击不同模型时强制重挂载，表单草稿不残留
          <ModelForm key={modelFormTarget || 'add'} />
        ) : (
          <div className="panel" data-testid="panel-model">
            <div className="panel-label">{t('left.modelTitle')}</div>
            <div
              className="list-area"
              onContextMenu={(e) => {
                // 空白处右键：收起删除按钮。@author aceFelix
                e.preventDefault()
                setPendingDeleteModel(null)
              }}
            >
              {models.map((m) => {
                // 已选中 / 待生效的项不再发点选指令（去重）；但仍可双击改配置。
                const selectable = !m.current && m.name !== pendingModel
                return (
                  <ModelItem
                    key={m.name}
                    name={m.name}
                    sub={[
                      m.desc || m.vendor || '',
                      // 「当前」（运行中）优先于「待生效」（已点选待引擎落地），二者互斥
                      m.current
                        ? `· ${t('left.current')}`
                        : m.name === pendingModel
                          ? `· ${t('left.pending')}`
                          : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    current={!!m.current}
                    extraClass={selectItemClass(m.current, m.name === pendingModel)}
                    selectable={selectable}
                    removable={!!m.removable}
                    pendingDelete={pendingDeleteModel === m.name}
                    delGlyph={g.sessionDelete}
                    delTip={t('left.deleteModel')}
                    tip={m.removable ? t('left.modelItemTip') : t('left.modelItemTipBuiltin')}
                    onSelect={() => void backend.selectModel(m.name)}
                    onEdit={() => {
                      // 双击 → 进入该模型的配置编辑表单（预填现值，名字可改）
                      setPendingDeleteModel(null)
                      editModelForm(m.name)
                    }}
                    onContextMenu={() => {
                      // 内置模型不可删：右键不显示删除按钮（后端也会拒绝）
                      if (!m.removable) {
                        setPendingDeleteModel(null)
                        return
                      }
                      setPendingDeleteModel((p) => (p === m.name ? null : m.name))
                    }}
                    onDelete={() => {
                      setPendingDeleteModel(null)
                      void backend.removeModel(m.name)
                    }}
                  />
                )
              })}
              {/* 列表末项：进入添加模型表单（字段口径同 REPL /models 添加其他模型） */}
              <ListItem
                title={t('left.addModel')}
                sub={t('left.addModelHint')}
                extraClass="add-model"
                testid="model-add-item"
                onClick={openModelForm}
              />
            </div>
            {/* 操作提示：模型面板的双击/右键是隐式交互，给一行可发现性提示 */}
            <div className="panel-hint" data-testid="model-ops-hint">
              {t('left.modelOpsHint')}
            </div>
          </div>
        )
      ) : null}

      {/* 面板三：音色（列表 ⇄ 音色表单；2026-09-28 音色-模型适配，交互范式同模型面板） */}
      {activePanel === 'voice' ? (
        voiceFormOpen ? (
          // key 随编辑目标变化：连续双击不同音色时强制重挂载，表单草稿不残留
          <VoiceForm key={voiceFormTarget || 'add'} />
        ) : (
          <div className="panel" data-testid="panel-voice">
            <div className="panel-label">{t('left.voiceTitle')}</div>
            <div
              className="list-area"
              onContextMenu={(e) => {
                // 空白处右键：收起删除按钮。@author aceFelix
                e.preventDefault()
                setPendingDeleteVoice(null)
              }}
            >
              {voices.map((v) => {
                // 去重口径同模型项：已选中 / 待生效不再发 voices.select
                const selectable = !v.current && v.name !== pendingVoice
                // 副行：描述 + 适配/联动预告（linked 非空=点选将联动换模型，
                // 否则显适配模型；不限时不显）+ 当前/待生效标记
                const modelTag = v.linked
                  ? t('left.voiceLinks', { model: v.linked })
                  : v.model
                    ? t('left.voiceFits', { model: v.model })
                    : ''
                return (
                  <ModelItem
                    key={v.name}
                    name={v.name}
                    sub={[v.description || '', modelTag, v.current ? `· ${t('left.current')}` : v.name === pendingVoice ? `· ${t('left.pending')}` : '']
                      .filter(Boolean)
                      .join(' ')}
                    current={!!v.current}
                    extraClass={selectItemClass(v.current, v.name === pendingVoice)}
                    selectable={selectable}
                    removable={!!v.custom}
                    pendingDelete={pendingDeleteVoice === v.name}
                    delGlyph={g.sessionDelete}
                    delTip={t('left.deleteVoice')}
                    tip={v.custom ? t('left.voiceItemTip') : t('left.voiceItemTipBuiltin')}
                    testid="voice-item"
                    delTestid="voice-del-btn"
                    onSelect={() => void backend.selectVoice(v.name)}
                    onEdit={() => {
                      // 双击→进自定义音色编辑表单（同名 upsert）；内置音色不可编辑
                      if (!v.custom) return
                      setPendingDeleteVoice(null)
                      editVoiceForm(v.name)
                    }}
                    onContextMenu={() => {
                      // 内置音色不可删：右键不显示删除按钮（后端也会拒绝）
                      if (!v.custom) {
                        setPendingDeleteVoice(null)
                        return
                      }
                      setPendingDeleteVoice((p) => (p === v.name ? null : v.name))
                    }}
                    onDelete={() => {
                      setPendingDeleteVoice(null)
                      void backend.deleteVoice(v.name)
                    }}
                  />
                )
              })}
              {/* 列表末项：进入添加音色表单（字段口径同 REPL /tts-voice 添加）；
                  add-model 类为添加项通用样式 */}
              <ListItem
                title={t('left.addVoice')}
                sub={t('left.addVoiceHint')}
                extraClass="add-model"
                testid="voice-add-item"
                onClick={openVoiceForm}
              />
            </div>
            {/* 操作提示：音色面板的双击/右键是隐式交互，给一行可发现性提示 */}
            <div className="panel-hint" data-testid="voice-ops-hint">
              {t('left.voiceOpsHint')}
            </div>
          </div>
        )
      ) : null}

      {/* 状态 footer */}
      <footer id="left-footer">
        <span className={`status-dot ${backend.statusLabel.tone === 'busy' ? 'busy' : backend.statusLabel.tone === 'err' ? 'err' : backend.statusLabel.tone === 'talk' ? 'talk' : 'idle'}`} />
        <span id="status-text">{backend.statusLabel.text}</span>
        {talkActive ? <span className="talk-flag">{g.talkActive} {t('left.talkActive')}</span> : null}
        {voiceActive ? <span className="talk-flag">{g.voiceActive} {t('left.voiceActive')}</span> : null}
      </footer>
    </aside>
  )
}
