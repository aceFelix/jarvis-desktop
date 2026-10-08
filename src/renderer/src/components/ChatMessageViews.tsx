/**
 * 中栏消息流渲染组件集（自 ChatArea 拆出，2026-10）：
 * 单条消息（用户/AI/工具/系统/二维码/斜杠输出）、工具组聚合与渲染分组纯函数。
 *
 * 拆分动机：ChatArea 主组件（输入区/撤回弹窗/订阅逻辑）代码量逼近单文件
 * 800 行上限，按 code-structure 规则把「纯消息渲染」这一独立职责外移；
 * 降噪口径（思考块/工具组自动折叠）与样式类名保持原样，不改行为。
 *
 * @author aceFelix
 */

import { useEffect, useState } from 'react'
import { useChatStore, type MessageItem } from '../stores/chatStore'
import QrcodeCard from './QrcodeCard'
import { useT } from '../i18n'
import { useGlyphs } from '../glyphs'

/** 工具项（消息判别联合窄化，工具组使用）。 */
export type ToolItem = Extract<MessageItem, { kind: 'tool' }>

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

/** 单条消息渲染（按 kind 判别分发）。
 * userTail/onRewind 仅用户气泡用：hover 显「撤回」（按尾部数定位）。@author aceFelix */
export function MessageView({
  item,
  userTail,
  onRewind,
  rewindDisabled
}: {
  item: MessageItem
  userTail?: number
  onRewind?: (tail: number) => void
  rewindDisabled?: boolean
}): JSX.Element {
  const t = useT()
  const g = useGlyphs()
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
          {/* 用户气泡 hover 撤回入口（与 AI 气泡复制按钮同一操作行样式）：
              尾部数 userTail 定位撤回起点，未连/回复进行中置灰。@author aceFelix */}
          {userTail && onRewind ? (
            <div className="msg-actions">
              <button
                className="msg-action-btn"
                data-testid="btn-rewind-msg"
                title={t('chat.rewindTip')}
                disabled={rewindDisabled}
                onClick={() => onRewind(userTail)}
              >
                {g.rewind} {t('chat.rewind')}
              </button>
            </div>
          ) : null}
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
    // 斜杠命令透传输出卡片（slash.exec → slash_result 事件）
    // @author aceFelix
    case 'slash':
      return <SlashCard item={item} />
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
export function ToolGroup({ items }: { items: ToolItem[] }): JSX.Element {
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

/**
 * 斜杠命令输出卡片（slash.exec，2026-10）：slash_result 事件的渲染单元。
 * 叠加 system 皮肤类沿用三主题配色；summary = 命令原文，正文 = 捕获输出
 * 全文（等宽 pre，命令行表格对齐靠空格，禁折行改横向滚动）。默认展开：
 * 命令是用户主动执行的，结果看一眼就要看到，点击可收起。
 * @author aceFelix
 */
export function SlashCard({ item }: { item: Extract<MessageItem, { kind: 'slash' }> }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <details
      className={`message system slash${item.isError ? ' error-msg' : ''}`}
      data-testid="msg-slash"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>$ {item.command}</summary>
      <pre className="slash-body">{item.text}</pre>
    </details>
  )
}

/** 渲染节点：单条消息，或一个工具组（连续工具项聚合）。 */
export type RenderNode = { key: string; item: MessageItem } | { key: string; tools: ToolItem[] }

/**
 * 消息流 → 渲染节点分组（纯函数）：
 * - 连续的 tool 项且 **≥2 条** 聚成一个工具组（单条不包组，少一层点击）；
 * - 历史回放的工具占位（toolId 为空，本身是「历史工具调用 ×N」汇总卡）不并入组；
 * - 其余节点（用户/AI/系统提示）保持原序单条渲染；中间夹非 tool 项即切组。
 *
 * @author aceFelix
 */
export function groupMessages(messages: MessageItem[]): RenderNode[] {
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
