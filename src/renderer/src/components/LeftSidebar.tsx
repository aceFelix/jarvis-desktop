/**
 * 左栏：模式切换（文本/实时/语音）+ 三面板切换（历史会话/模型/音色）+ 状态 footer。
 *
 * 面板切换即刷新对应列表（sessions.list / models.list / voices.list 指令）；
 * 列表项悬停/选中字体变蓝（与 workbench 交互口径一致，样式在 main.css）。
 *
 * @author aceFelix
 */

import { useEffect, useRef, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useLeftStore, type ChatMode, type LeftPanel } from '../stores/leftStore'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'

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

/** 通用列表项（标题 + 副行 + 当前标记）。 */
function ListItem(props: {
  title: string
  sub?: string
  current?: boolean
  onClick?: () => void
}): JSX.Element {
  return (
    <div
      className={`list-item${props.current ? ' current' : ''}`}
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

export default function LeftSidebar(): JSX.Element {
  const { sessions, models, voices, activePanel, mode, talkActive, voiceActive } = useLeftStore()
  const { setActivePanel, setMode } = useLeftStore()
  const backend = useBackendStore()
  const t = useT()
  const g = useGlyphs()
  // 会话项交互态：pendingDelete=右键待删会话名；editing=双击内联改名会话名。
  // @author aceFelix
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  // 面板切换即刷新对应数据（与 workbench switchPanel 口径一致）。
  // 守卫用 wsConnected 而非 client：client 在 connect() 里一创建就非 null，
  // 但此时 WS 仍处 CONNECTING 未 OPEN，发指令会被 sendCommand 拒绝并误报
  // "未连接到后端"；wsConnected 仅在 onopen 后置真，保证刷新发生在连接就绪后。
  // @author aceFelix
  useEffect(() => {
    if (!backend.wsConnected) return
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

      {/* 面板二：模型 */}
      {activePanel === 'model' ? (
        <div className="panel" data-testid="panel-model">
          <div className="panel-label">{t('left.modelTitle')}</div>
          <div className="list-area">
            {models.map((m) => (
              <ListItem
                key={m.name}
                title={m.name}
                sub={[m.desc || m.vendor || '', m.current ? `· ${t('left.current')}` : '']
                  .filter(Boolean)
                  .join(' ')}
                current={m.current}
                onClick={m.current ? undefined : () => void backend.selectModel(m.name)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* 面板三：音色 */}
      {activePanel === 'voice' ? (
        <div className="panel" data-testid="panel-voice">
          <div className="panel-label">{t('left.voiceTitle')}</div>
          <div className="list-area">
            {voices.map((v) => (
              <ListItem
                key={v.name}
                title={v.name}
                sub={`${v.description ?? ''}${v.current ? ` · ${t('left.current')}` : ''}`}
                current={v.current}
                onClick={v.current ? undefined : () => void backend.selectVoice(v.name)}
              />
            ))}
          </div>
        </div>
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
