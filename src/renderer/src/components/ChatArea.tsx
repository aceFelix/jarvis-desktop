/**
 * 中栏对话主区：消息流（气泡/工具卡片/系统提示）+ ask_user 条 + 输入区。
 *
 * 交互口径与 workbench 一致：
 * - Enter 发送、Shift+Enter 换行、输入框自适应高度（封顶 120px）；
 * - 新消息自动滚底；
 * - 工具卡片 details/summary 原生折叠；
 * - AI 气泡完成流式后右下角带「复制」消息级操作（替代原右栏复制回复）；
 * - 输入栏 📎 附件 / 📸 截屏（主进程 desktopCapturer → 附件区，随消息上送）。
 *
 * @author aceFelix
 */

import { useEffect, useRef, useState } from 'react'
import { useBackendStore, type SendAttachments } from '../stores/backendStore'
import { useChatStore, type MessageItem } from '../stores/chatStore'
import { useLeftStore } from '../stores/leftStore'
import { useAttachStore } from '../stores/attachStore'
import { voiceStatusLabels } from '../api/dispatcher'
import { useT } from '../i18n'

// 📎 可选类型：图片走 vision；其余按文本文件读内容拼进消息
// @author aceFelix
const ATTACH_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,.md,.txt,.py,.json,.toml,.yaml,.yml,.csv,.log,.js,.ts,.jsx,.tsx,.html,.css,.ini,.xml,.sql,.sh,.bat,.ps1'

/** AI 气泡右下角操作行：复制本条回复（复制成功短暂变「已复制」）。 */
function CopyRow({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const t = useT()

  const doCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      useChatStore.getState().addSystem(t('chat.copyFail'), 'error')
    }
  }

  return (
    <div className="msg-actions">
      <button
        className="msg-action-btn"
        data-testid="btn-copy-msg"
        title={t('chat.copyTip')}
        onClick={() => void doCopy()}
      >
        {copied ? t('chat.copied') : t('chat.copy')}
      </button>
    </div>
  )
}

/** 单条消息渲染（按 kind 判别分发）。 */
function MessageView({ item }: { item: MessageItem }): JSX.Element {
  const t = useT()
  switch (item.kind) {
    case 'user':
      return (
        <div className="message user" data-testid="msg-user">
          <div className="message-label">{t('chat.you')}</div>
          {item.images?.length ? (
            <div className="msg-thumbs" data-testid="msg-thumbs">
              {item.images.map((src, i) => (
                <img key={i} src={src} alt={`附件图片 ${i + 1}`} />
              ))}
            </div>
          ) : null}
          <div>{item.text}</div>
        </div>
      )
    case 'ai':
      return (
        <div className="message ai" data-testid="msg-ai">
          <div className="message-label">{t('chat.jarvis')}</div>
          {item.thinking ? <div className="thinking-block">{item.thinking}</div> : null}
          <div>
            {item.text}
            {item.streaming ? <span className="cursor-blink">▍</span> : null}
          </div>
          {/* 流式结束后才给复制入口（复制半成品无意义） */}
          {item.text && !item.streaming ? <CopyRow text={item.text} /> : null}
        </div>
      )
    case 'tool':
      return (
        <details className={`tool-card${item.isError ? ' error' : ''}`} data-testid="tool-card">
          <summary>
            {item.name}
            {item.done ? (item.isError ? ' ✗' : ' ✓') : ' …'}
          </summary>
          <div className="tool-body">
            {item.input ? `${item.input}\n────\n` : ''}
            {item.output || '(执行中...)'}
          </div>
        </details>
      )
    case 'system':
      return (
        <div className={`message system${item.tone === 'error' ? ' error-msg' : ''}`} data-testid="msg-system">
          {item.text}
        </div>
      )
  }
}

export default function ChatArea(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const askPrompt = useChatStore((s) => s.askPrompt)
  // busy：回复进行中（sendMessage 置位，assistant_done 收尾），驱动
  // 发送按钮切换为“停止”态。@author aceFelix
  const busy = useChatStore((s) => s.busy)
  const sendMessage = useBackendStore((s) => s.sendMessage)
  const abortReply = useBackendStore((s) => s.abortReply)
  const answerUser = useBackendStore((s) => s.answerUser)
  const toggleTalk = useBackendStore((s) => s.toggleTalk)
  const toggleVoice = useBackendStore((s) => s.toggleVoice)
  const interruptVoice = useBackendStore((s) => s.interruptVoice)
  // 半双工语音：会话运行中标记 + 当前阶段（驱动状态条文案）。
  const voiceActive = useLeftStore((s) => s.voiceActive)
  const voiceState = useLeftStore((s) => s.voiceState)
  // 发送/麦克风按钮可用性跟随 WS 连接状态（未连上时置灰）
  const wsConnected = useBackendStore((s) => s.wsConnected)

  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState('')
  // 待发送附件集中在 attachStore：与输入栏 📸 截屏按钮共用同一份
  // chips 列表（截屏入列后在此处可见可删）。@author aceFelix
  const pending = useAttachStore((s) => s.pending)
  const addFiles = useAttachStore((s) => s.addFiles)
  const addImage = useAttachStore((s) => s.addImage)
  const removeAttach = useAttachStore((s) => s.remove)
  const clearAttach = useAttachStore((s) => s.clear)
  const historyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const askInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 新消息自动滚底
  useEffect(() => {
    const el = historyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // ask_user 出现时聚焦回答输入框
  useEffect(() => {
    if (askPrompt !== null) {
      setAnswer('')
      askInputRef.current?.focus()
    }
  }, [askPrompt])

  const doSend = (): void => {
    const text = draft.trim()
    // 纯附件（如只贴图）也允许发送：后端会补最小指令文本
    if (!text && !pending.length) return
    // 回复进行中禁止再发（引擎指令串行，叠发只会排队到下一轮）
    if (busy) return
    // 组装附件载荷：图片 → base64 块；文本文件 → name+content
    // @author aceFelix
    let attachments: SendAttachments | undefined
    if (pending.length) {
      attachments = {
        images: pending
          .filter((p) => p.kind === 'image')
          .map((p) => ({ data: p.b64 || '', media_type: p.mediaType || 'image/png' })),
        files: pending
          .filter((p) => p.kind === 'file')
          .map((p) => ({ name: p.name, content: p.content || '' }))
      }
    }
    setDraft('')
    clearAttach()
    if (inputRef.current) inputRef.current.style.height = 'auto'
    void sendMessage(text, attachments)
  }

  const doAnswer = (): void => {
    void answerUser(answer)
  }

  const t = useT()

  /** 截屏 → 附件区（主进程 desktopCapturer 抓主屏缩略图，复用附件 vision 链路）。 */
  const doCapture = async (): Promise<void> => {
    try {
      const shot = await window.jarvisDesktop?.captureScreen?.()
      if (!shot?.data) {
        useChatStore.getState().addSystem(t('chat.captureFailNoSource'), 'error')
        return
      }
      addImage(`屏幕截图-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`, shot.data, shot.media_type)
      useChatStore.getState().addSystem(t('chat.captureOk'))
    } catch (err) {
      useChatStore
        .getState()
        .addSystem(t('chat.captureFail', { reason: err instanceof Error ? err.message : String(err) }), 'error')
    }
  }

  return (
    <main id="center-col">
      <div id="chat-history" ref={historyRef}>
        {messages.map((m) => (
          <MessageView key={m.id} item={m} />
        ))}
      </div>

      {askPrompt !== null ? (
        <div id="ask-user-bar" data-testid="ask-user-bar">
          <span id="ask-user-text">{askPrompt}</span>
          <input
            ref={askInputRef}
            type="text"
            placeholder={t('chat.askPlaceholder')}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doAnswer()
            }}
          />
          <button className="action-btn" onClick={doAnswer}>
            {t('chat.send')}
          </button>
        </div>
      ) : null}

      {voiceActive ? (
        <div id="voice-bar" data-testid="voice-bar">
          <span className="voice-state" data-testid="voice-state">
            {voiceState ? (voiceStatusLabels[voiceState] ?? t('chat.voiceDefault')) : t('chat.voiceOn')}
          </span>
          <button
            className="action-btn"
            data-testid="voice-interrupt"
            title={t('chat.interruptTip')}
            onClick={() => void interruptVoice()}
            disabled={!wsConnected}
          >
            {t('chat.interrupt')}
          </button>
          <button
            className="action-btn"
            data-testid="voice-exit"
            title={t('chat.exitVoiceTip')}
            onClick={() => void toggleVoice()}
            disabled={!wsConnected}
          >
            {t('chat.exitVoice')}
          </button>
        </div>
      ) : null}

      {pending.length ? (
        <div id="attach-chips" data-testid="attach-chips">
          {pending.map((p) => (
            <span key={p.id} className="attach-chip">
              {p.kind === 'image' ? (
                <img src={p.dataUrl} alt={p.name} title={p.name} />
              ) : (
                <span className="chip-name" title={p.name}>
                  📄 {p.name}
                </span>
              )}
              <button
                className="chip-remove"
                title={t('chat.chipRemoveTip')}
                onClick={() => removeAttach(p.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <footer id="input-bar" className="glass-bar">
        {/* 📎 附件入口：隐藏 file input + 按钮触发；图片走 vision，
            文本文件读内容随消息上送（后端拼进正文）。@author aceFelix */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          style={{ display: 'none' }}
          data-testid="attach-input"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = '' // 清空允许重复选同一文件
          }}
        />
        <button
          className="action-btn"
          data-testid="btn-attach"
          title={t('chat.attachTip')}
          onClick={() => fileInputRef.current?.click()}
          disabled={!wsConnected || busy}
        >
          📎
        </button>
        {/* 📸 截屏入口（自右栏快捷操作迁入输入栏）：截图入附件区随消息上送 */}
        <button
          className="action-btn"
          data-testid="btn-capture"
          title={t('chat.captureTip')}
          onClick={() => void doCapture()}
          disabled={!wsConnected || busy}
        >
          📸
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          placeholder={t('chat.placeholder')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`
          }}
          onPaste={(e) => {
            // 粘贴图片入附件区（截图后 Ctrl+V 直接贴图）；纯文本粘贴不受影响
            const files = Array.from(e.clipboardData?.files ?? [])
            if (!files.length) return
            e.preventDefault()
            addFiles(files)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              doSend()
            }
          }}
        />
        {/* 发送/停止双态按钮：busy 时变“■ 停止”，再点发 reply.abort 中断回复。
            停止不依赖 WS 回执前先置灰，故不加 wsConnected 禁用以外的限制。
            @author aceFelix */}
        {busy ? (
          <button
            className="action-btn danger"
            data-testid="btn-stop"
            title={t('chat.stopTip')}
            onClick={() => void abortReply()}
            disabled={!wsConnected}
          >
            {t('chat.stop')}
          </button>
        ) : (
          <button
            className="action-btn primary"
            data-testid="btn-send"
            onClick={doSend}
            disabled={!wsConnected}
          >
            {t('chat.send')}
          </button>
        )}
        <button
          className={`action-btn${wsConnected ? '' : ' disabled'}`}
          title={t('chat.micTip')}
          onClick={() => void toggleTalk()}
          disabled={!wsConnected}
        >
          🎙️
        </button>
      </footer>
    </main>
  )
}
