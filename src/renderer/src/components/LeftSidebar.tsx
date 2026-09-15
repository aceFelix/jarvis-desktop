/**
 * 左栏：模式切换（文本/实时/语音）+ 三面板切换（历史会话/模型/音色）+ 状态 footer。
 *
 * 面板切换即刷新对应列表（sessions.list / models.list / voices.list 指令）；
 * 列表项悬停/选中字体变蓝（与 workbench 交互口径一致，样式在 main.css）。
 *
 * @author aceFelix
 */

import { useEffect } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useLeftStore, type ChatMode, type LeftPanel } from '../stores/leftStore'

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
        <span className="col-title">控制台</span>
      </div>

      {/* 模式切换 */}
      <div className="segmented">
        <button
          className={`seg-btn${mode === 'text' ? ' active' : ''}`}
          title="文本对话"
          onClick={() => switchMode('text')}
        >
          💬 文本
        </button>
        <button
          className={`seg-btn${mode === 'talk' ? ' active' : ''}`}
          title="实时语音（/talk）"
          onClick={() => switchMode('talk')}
        >
          🎙️ 实时
        </button>
        <button
          className={`seg-btn${mode === 'voice' ? ' active' : ''}`}
          title="半双工语音（/voice：说话→回复→再听）"
          onClick={() => switchMode('voice')}
        >
          🎤 语音
        </button>
      </div>

      {/* 面板切换：历史会话 ⇄ 模型 ⇄ 音色 */}
      <div className="segmented">
        {(
          [
            ['history', '📜 历史会话'],
            ['model', '🤖 模型'],
            ['voice', '🎵 音色']
          ] as Array<[LeftPanel, string]>
        ).map(([panel, label]) => (
          <button
            key={panel}
            className={`seg-btn${activePanel === panel ? ' active' : ''}`}
            onClick={() => setActivePanel(panel)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 面板一：历史会话 */}
      {activePanel === 'history' ? (
        <div className="panel" data-testid="panel-history">
          <div className="list-area">
            {sessions.slice(0, 60).map((s) => (
              <ListItem
                key={s.name}
                title={s.name}
                sub={`${new Date(s.updated_at * 1000).toLocaleString()} · ${s.message_count} 条消息`}
                onClick={() => void backend.openSession(s.name)}
              />
            ))}
          </div>
          <button className="action-btn" onClick={() => void backend.newSession()}>
            ＋ 新建会话
          </button>
        </div>
      ) : null}

      {/* 面板二：模型 */}
      {activePanel === 'model' ? (
        <div className="panel" data-testid="panel-model">
          <div className="panel-label">对话模型</div>
          <div className="list-area">
            {models.map((m) => (
              <ListItem
                key={m.name}
                title={m.name}
                sub={[m.desc || m.vendor || '', m.current ? '· 当前' : '']
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
          <div className="panel-label">TTS 音色</div>
          <div className="list-area">
            {voices.map((v) => (
              <ListItem
                key={v.name}
                title={v.name}
                sub={`${v.description ?? ''}${v.current ? ' · 当前' : ''}`}
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
        {talkActive ? <span className="talk-flag">🎙️ 实时中</span> : null}
        {voiceActive ? <span className="talk-flag">🎤 语音中</span> : null}
      </footer>
    </aside>
  )
}
