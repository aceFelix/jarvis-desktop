/**
 * 中栏对话主区：消息流（气泡/思考块/工具组/系统提示）+ ask_user 条 + 输入区。
 *
 * 交互口径与 workbench 一致：
 * - Enter 发送、Shift+Enter 换行、输入框自适应高度（封顶 120px）；
 * - 新消息自动滚底；
 * - AI 气泡完成流式后右下角带「复制」消息级操作（替代原右栏复制回复）；
 * - 输入栏 📎 附件 / 📸 截屏（主进程 desktopCapturer → 附件区，随消息上送）。
 *
 * 降噪口径（2026-09，纯渲染层，不动 store / 协议）：
 * - 思考块：流式中自动展开（实时可见），本轮回复结束（streaming=false）
 *   自动收起成一行标题，点开可看全文（正文限高内部滚动，超长不撑爆气泡）；
 * - 工具组：连续的 tool 项聚合成一条可折叠框（单条不包组），执行中展开
 *   看进度「执行中：Bash」→ 全部完成后自动收起成一行；有失败时仍收起，
 *   但标题标红计数（扫一眼即知，点开可见是哪条）；
 * - 自动态与手点不打架：受控 details + onToggle 把用户操作同步回 state。
 *
 * @author aceFelix
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useBackendStore, type SendAttachments } from '../stores/backendStore'
import { useChatStore, type MessageItem } from '../stores/chatStore'
import { useLeftStore } from '../stores/leftStore'
import { useAttachStore } from '../stores/attachStore'
import { useRuntimeStore } from '../stores/runtimeStore'
import ThemedSelect, { type SelectOption } from './ThemedSelect'
import RemoteConnectMenu from './RemoteConnectMenu'
import QrcodeCard from './QrcodeCard'
import type { PermissionMode, ThinkingEffort } from '../../../shared/contracts'
import { voiceStatusLabels } from '../api/dispatcher'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'

// 📎 可选类型：图片走 vision；其余按文本文件读内容拼进消息
// @author aceFelix
const ATTACH_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,.md,.txt,.py,.json,.toml,.yaml,.yml,.csv,.log,.js,.ts,.jsx,.tsx,.html,.css,.ini,.xml,.sql,.sh,.bat,.ps1'

// 思考档位 → i18n 文案键（输入区思考选择器标签映射）。@author aceFelix
const THINK_KEYS: Record<ThinkingEffort, string> = {
  off: 'chat.think.off',
  on: 'chat.think.on',
  low: 'chat.think.low',
  medium: 'chat.think.medium',
  high: 'chat.think.high'
}

/** 工具项（消息判别联合窄化，工具组使用）。 */
type ToolItem = Extract<MessageItem, { kind: 'tool' }>

/** AI 气泡右下角操作行：复制本条回复（复制成功短暂变「已复制」）。 */
function CopyRow({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const t = useT()
  const g = useGlyphs()

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
        {copied ? t('chat.copied') : `${g.copy} ${t('chat.copy')}`}
      </button>
    </div>
  )
}

/**
 * 思考块（2026-09 折叠化）：流式中自动展开，本轮回复结束自动收起成一行。
 *
 * 自动态跟随 streaming（流式结束 effect 收起）；用户手点后 onToggle 同步回
 * state，React 不会把用户的选择抢回去（此后 streaming 不再变化即不再干预）。
 *
 * @author aceFelix
 */
function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(streaming)
  useEffect(() => setOpen(streaming), [streaming])

  return (
    <details
      className="thinking-block"
      data-testid="thinking-block"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {t('chat.thinking')} · {t('chat.thinkingChars', { n: text.length })}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  )
}

/** 单条消息渲染（按 kind 判别分发）。 */
function MessageView({ item }: { item: MessageItem }): JSX.Element {
  const t = useT()
  switch (item.kind) {
    case 'user':
      return (
        <div className="message user" data-testid="msg-user">
          <div className="message-label">
            {/* 远端入站消息标来源（微信 / 手机），本地输入显“你” */}
            {item.source === 'wechat'
              ? t('chat.wechat')
              : item.source === 'phone'
                ? t('chat.phone')
                : t('chat.you')}
          </div>
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
          {item.thinking ? <ThinkingBlock text={item.thinking} streaming={item.streaming} /> : null}
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
    case 'system': {
      const errCls = item.tone === 'error' ? ' error-msg' : ''
      // 多行系统/警告/错误提示（如工具失败重试的长 dump）折叠：首行做标题、
      // 点开看全文，避免一大块铺满聊天区；单行短提示（如“微信已断开”）保持原样。
      // @author aceFelix
      const nl = item.text.indexOf('\n')
      if (nl < 0) {
        return (
          <div className={`message system${errCls}`} data-testid="msg-system">
            {item.text}
          </div>
        )
      }
      return (
        <details className={`message system collapsible${errCls}`} data-testid="msg-system">
          <summary>{item.text.slice(0, nl)}</summary>
          <div className="system-body">{item.text.slice(nl + 1)}</div>
        </details>
      )
    }
    // 跨设备协同连接二维码卡片（手机 / 微信）：url 由 QrcodeCard 用 qrcode 库
    // 画成图，微信卡片额外内联配对码输入。@author aceFelix
    case 'qrcode':
      return <QrcodeCard item={item} />
  }
}

/**
 * 工具组（2026-09）：连续的工具调用聚合成一条框，消掉「十几个框堆满一屏」。
 *
 * - 执行中：自动展开，标题实时显示当前跑的是哪个工具；
 * - 全部完成：自动收起成一行「⛭ 工具调用 ×N ✓」；
 * - 有失败：仍收起，但标题标红计数（error class 同步标红边框），
 *   点开是组内每条原工具卡（可再单独展开看入参/输出，两级折叠）。
 *
 * @author aceFelix
 */
function ToolGroup({ items }: { items: ToolItem[] }): JSX.Element {
  const t = useT()
  const allDone = items.every((i) => i.done)
  const failed = items.filter((i) => i.isError).length
  const running = items.find((i) => !i.done)
  const [open, setOpen] = useState(!allDone)
  useEffect(() => setOpen(!allDone), [allDone])

  return (
    <details
      className={`tool-group${failed ? ' error' : ''}`}
      data-testid="tool-group"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {t('chat.toolGroup', { n: items.length })}
        {failed ? (
          <span className="tool-group-fail"> · {t('chat.toolGroupFail', { n: failed })}</span>
        ) : running ? (
          <span className="tool-group-run"> · {t('chat.toolGroupRun', { name: running.name })}</span>
        ) : (
          ' ✓'
        )}
      </summary>
      <div className="tool-group-body">
        {items.map((it) => (
          <MessageView key={it.id} item={it} />
        ))}
      </div>
    </details>
  )
}

/** 渲染节点：单条消息，或一个工具组（连续工具项聚合）。 */
type RenderNode = { key: string; item: MessageItem } | { key: string; tools: ToolItem[] }

/**
 * 消息流 → 渲染节点分组（纯函数）：
 * - 连续的 tool 项且 **≥2 条** 聚成一个工具组（单条不包组，少一层点击）；
 * - 历史回放的工具占位（toolId 为空，本身是「历史工具调用 ×N」汇总卡）不并入组；
 * - 其余节点（用户/AI/系统提示）保持原序单条渲染；中间夹非 tool 项即切组。
 *
 * @author aceFelix
 */
function groupMessages(messages: MessageItem[]): RenderNode[] {
  const nodes: RenderNode[] = []
  let buf: ToolItem[] = []
  const flush = (): void => {
    if (!buf.length) return
    nodes.push(buf.length === 1 ? { key: `t${buf[0].id}`, item: buf[0] } : { key: `g${buf[0].id}`, tools: buf })
    buf = []
  }
  for (const m of messages) {
    if (m.kind === 'tool' && m.toolId) {
      buf.push(m)
      continue
    }
    flush()
    nodes.push({ key: `m${m.id}`, item: m })
  }
  flush()
  return nodes
}

export default function ChatArea(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  // 渲染分组：连续工具项聚合（groupMessages 纯函数）；useMemo 只为省重算，
  // 节点 key 由首条消息 id 决定，分组变化不会让工具组重挂载丢折叠态。
  // @author aceFelix
  const nodes = useMemo(() => groupMessages(messages), [messages])
  const askPrompt = useChatStore((s) => s.askPrompt)
  // busy：回复进行中（sendMessage 置位，assistant_done 收尾），驱动
  // 发送按钮切换为“停止”态。@author aceFelix
  const busy = useChatStore((s) => s.busy)
  const sendMessage = useBackendStore((s) => s.sendMessage)
  const abortReply = useBackendStore((s) => s.abortReply)
  const answerUser = useBackendStore((s) => s.answerUser)
  const toggleVoice = useBackendStore((s) => s.toggleVoice)
  const interruptVoice = useBackendStore((s) => s.interruptVoice)
  // 输入区工具条：工作（权限）模式 + 思考强度（初值由 state.get 回填 runtimeStore）。
  // @author aceFelix
  const permissionMode = useRuntimeStore((s) => s.permissionMode)
  const thinkingEffort = useRuntimeStore((s) => s.thinkingEffort)
  const thinkingSupported = useRuntimeStore((s) => s.thinkingSupported)
  const setMode = useBackendStore((s) => s.setMode)
  const setThinking = useBackendStore((s) => s.setThinking)
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
  const g = useGlyphs()

  // 输入区工具条两个选择器的选项（工作模式固定四项；思考按当前厂商 supported 动态取档）。
  // supported 为空=该厂商无思考控制 → 渲染单条「关闭思考」并置灰（disabled）。
  // @author aceFelix
  const modeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'default', label: t('chat.mode.default') },
      { value: 'plan', label: t('chat.mode.plan') },
      { value: 'accept_edits', label: t('chat.mode.acceptEdits') },
      { value: 'yolo', label: t('chat.mode.yolo') }
    ],
    [t]
  )
  const thinkOptions = useMemo<SelectOption[]>(() => {
    const opts = thinkingSupported.map((e) => ({ value: e, label: t(THINK_KEYS[e] ?? 'chat.think.off') }))
    return opts.length ? opts : [{ value: thinkingEffort, label: t('chat.think.off') }]
  }, [thinkingSupported, thinkingEffort, t])
  const thinkingDisabled = thinkingSupported.length === 0

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
        {nodes.map((n) =>
          'tools' in n ? (
            <ToolGroup key={n.key} items={n.tools} />
          ) : (
            <MessageView key={n.key} item={n.item} />
          )
        )}
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
            {g.interrupt} {t('chat.interrupt')}
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
                  {g.fileChip} {p.name}
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
        {/* 左侧控制区：📎 附件 / 📸 截屏 + 工作模式 / 思考强度，2×2 竖排成一组。
            模式与思考切换下轮生效（引擎指令队列串行），busy/未连接时不禁用切换。@author aceFelix */}
        <div className="composer-side composer-side-left">
          <button
            className="action-btn"
            data-testid="btn-attach"
            title={t('chat.attachTip')}
            onClick={() => fileInputRef.current?.click()}
            disabled={!wsConnected || busy}
          >
            {g.attach}
          </button>
          {/* 📸 截屏入口（自右栏快捷操作迁入输入栏）：截图入附件区随消息上送 */}
          <button
            className="action-btn"
            data-testid="btn-capture"
            title={t('chat.captureTip')}
            onClick={() => void doCapture()}
            disabled={!wsConnected || busy}
          >
            {g.capture}
          </button>
          <div className="composer-toolbar" data-testid="composer-toolbar">
            <ThemedSelect
              testid="select-mode"
              ariaLabel={t('chat.modeTip')}
              value={permissionMode}
              options={modeOptions}
              onChange={(v) => void setMode(v as PermissionMode)}
            />
            <ThemedSelect
              testid="select-think"
              ariaLabel={t('chat.thinkTip')}
              value={thinkingEffort}
              options={thinkOptions}
              disabled={thinkingDisabled}
              onChange={(v) => void setThinking(v as ThinkingEffort)}
            />
          </div>
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          placeholder={t('chat.placeholder')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 240)}px`
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
        {/* 右侧控制区：发送/停止 + 实时语音，竖排一列。
            发送/停止双态按钮：busy 时变“■ 停止”，再点发 reply.abort 中断回复。
            @author aceFelix */}
        <div className="composer-side composer-side-right">
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
          {/* 跨设备协同下拉按钮（取代原 [LIV] 实时语音入口：左栏已有 [LIV]）：
              点选手机 / 微信发起连接，二维码内联回聊天区。@author aceFelix */}
          <RemoteConnectMenu />
        </div>
      </footer>
    </main>
  )
}
