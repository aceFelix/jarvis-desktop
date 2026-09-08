/**
 * 中栏对话主区：消息流（气泡/工具卡片/系统提示）+ ask_user 条 + 输入区。
 *
 * 交互口径与 workbench 一致：
 * - Enter 发送、Shift+Enter 换行、输入框自适应高度（封顶 120px）；
 * - 新消息自动滚底；
 * - 工具卡片 details/summary 原生折叠。
 *
 * @author aceFelix
 */

import { useEffect, useRef, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useChatStore, type MessageItem } from '../stores/chatStore'

/** 单条消息渲染（按 kind 判别分发）。 */
function MessageView({ item }: { item: MessageItem }): JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="message user" data-testid="msg-user">
          <div className="message-label">你</div>
          <div>{item.text}</div>
        </div>
      )
    case 'ai':
      return (
        <div className="message ai" data-testid="msg-ai">
          <div className="message-label">贾维斯</div>
          {item.thinking ? <div className="thinking-block">{item.thinking}</div> : null}
          <div>
            {item.text}
            {item.streaming ? <span className="cursor-blink">▍</span> : null}
          </div>
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
  const sendMessage = useBackendStore((s) => s.sendMessage)
  const answerUser = useBackendStore((s) => s.answerUser)
  const toggleTalk = useBackendStore((s) => s.toggleTalk)
  // 发送/麦克风按钮可用性跟随 WS 连接状态（未连上时置灰）
  const wsConnected = useBackendStore((s) => s.wsConnected)

  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState('')
  const historyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const askInputRef = useRef<HTMLInputElement>(null)

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
    if (!text) return
    setDraft('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    void sendMessage(text)
  }

  const doAnswer = (): void => {
    void answerUser(answer)
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
            placeholder="输入回答..."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doAnswer()
            }}
          />
          <button className="action-btn" onClick={doAnswer}>
            发送
          </button>
        </div>
      ) : null}

      <footer id="input-bar" className="glass-bar">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="和贾维斯说点什么...（Enter 发送，Shift+Enter 换行）"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              doSend()
            }
          }}
        />
        <button className="action-btn primary" onClick={doSend} disabled={!wsConnected}>
          发送
        </button>
        <button
          className={`action-btn${wsConnected ? '' : ' disabled'}`}
          title="开始/结束实时语音"
          onClick={() => void toggleTalk()}
          disabled={!wsConnected}
        >
          🎙️
        </button>
      </footer>
    </main>
  )
}
