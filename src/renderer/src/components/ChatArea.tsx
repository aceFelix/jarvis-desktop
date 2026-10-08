/**
 * 中栏对话主区：消息流（气泡/思考块/工具组/系统提示）+ ask_user 条 + 输入区。
 *
 * 交互口径与 workbench 一致：
 * - Enter 发送、Shift+Enter 换行、输入框自适应高度（封顶 120px）；
 * - 新消息自动滚底；
 * - AI 气泡完成流式后右下角带「复制」消息级操作（替代原右栏复制回复）；
 * - 输入栏 📎 附件（选择 / 粘贴图片→ 附件区，随消息上送）/ 🗜 手动压缩上下文（/compact）。
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
import { useChatStore } from '../stores/chatStore'
import { useLeftStore } from '../stores/leftStore'
import { useAttachStore } from '../stores/attachStore'
import { useRuntimeStore } from '../stores/runtimeStore'
import ThemedSelect, { type SelectOption } from './ThemedSelect'
import RemoteConnectMenu from './RemoteConnectMenu'
// 消息流渲染组件集（自本文件拆出，2026-10 遵守单文件 800 行上限）
import { MessageView, ToolGroup, groupMessages } from './ChatMessageViews'
// 输入框 / 命令补全弹层（slash.commands，2026-10）
import { useSlashAutocomplete } from './SlashAutocomplete'
import type { PermissionMode, ThinkingEffort, CheckpointPreviewResult } from '../../../shared/contracts'
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

/**
 * 撤回确认弹窗（消息级回溯，2026-10）：展示该轮将回滚的工作区文件清单
 * （来自 checkpoint.preview）+ 「同时回滚工作区文件」开关（无检查点时禁用）
 * + 确认/取消。沿用终端风玻璃面/按钮皮肤类。@author aceFelix
 */
function RewindDialog({
  loading,
  preview,
  restoreFiles,
  setRestoreFiles,
  onConfirm,
  onCancel
}: {
  loading: boolean
  preview: CheckpointPreviewResult | null
  restoreFiles: boolean
  setRestoreFiles: (v: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const g = useGlyphs()
  const canRestore = !!preview?.has_checkpoint
  const files = preview?.files ?? []
  const MAX_SHOW = 30
  const shown = files.slice(0, MAX_SHOW)
  return (
    <div className="rewind-backdrop" data-testid="rewind-backdrop" onClick={onCancel}>
      <div
        className="rewind-dialog glass-bar"
        data-testid="rewind-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rewind-title">{t('chat.rewindTitle')}</div>
        <div className="rewind-body">
          {loading ? (
            <div className="rewind-hint" data-testid="rewind-loading">
              {t('chat.rewindPreviewLoading')}
            </div>
          ) : !preview || !preview.ok ? (
            <div className="rewind-hint error" data-testid="rewind-preview-fail">
              {t('chat.rewindPreviewFail', { reason: preview?.reason || t('chat.rewindNoCheckpoint') })}
            </div>
          ) : !canRestore ? (
            <div className="rewind-hint" data-testid="rewind-no-checkpoint">
              {preview.reason || t('chat.rewindNoCheckpoint')}
            </div>
          ) : files.length ? (
            <>
              <div className="rewind-subhead">{t('chat.rewindFilesHeading')}</div>
              <ul className="rewind-files" data-testid="rewind-files">
                {shown.map((f, i) => (
                  <li key={i}>
                    <span className="rewind-file-status">{f.status}</span> {f.path}
                  </li>
                ))}
              </ul>
              {files.length > shown.length ? (
                <div className="rewind-hint">{t('chat.rewindMore', { n: files.length })}</div>
              ) : null}
            </>
          ) : (
            <div className="rewind-hint" data-testid="rewind-files-none">
              {t('chat.rewindFilesNone')}
            </div>
          )}
        </div>
        <label className={`rewind-restore${canRestore ? '' : ' disabled'}`}>
          <input
            type="checkbox"
            data-testid="rewind-restore-checkbox"
            checked={canRestore && restoreFiles}
            disabled={!canRestore}
            onChange={(e) => setRestoreFiles(e.target.checked)}
          />
          {t('chat.rewindRestoreFiles')}
        </label>
        <div className="rewind-actions">
          <button className="action-btn" data-testid="rewind-cancel" onClick={onCancel}>
            {t('chat.rewindCancel')}
          </button>
          <button
            className="action-btn danger"
            data-testid="rewind-confirm"
            onClick={onConfirm}
            disabled={loading}
          >
            {g.rewind} {t('chat.rewindConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatArea(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  // 渲染分组：连续工具项聚合（groupMessages 纯函数）；useMemo 只为省重算，
  // 节点 key 由首条消息 id 决定，分组变化不会让工具组重挂载丢折叠态。
  // @author aceFelix
  const nodes = useMemo(() => groupMessages(messages), [messages])
  // 用户气泡 → 尾部数（从最后一条往前数第几 user 气泡，含）：撤回按钮据此定位
  // user_tail_count，与后端 _is_visible_user_message 的尾部计数口径对齐。
  // @author aceFelix
  const userTailById = useMemo(() => {
    const map: Record<number, number> = {}
    let seen = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].kind === 'user') {
        seen += 1
        map[messages[i].id] = seen
      }
    }
    return map
  }, [messages])
  const askPrompt = useChatStore((s) => s.askPrompt)
  // busy：回复进行中（sendMessage 置位，assistant_done 收尾），驱动
  // 发送按钮切换为“停止”态。@author aceFelix
  const busy = useChatStore((s) => s.busy)
  const sendMessage = useBackendStore((s) => s.sendMessage)
  // 斜杠命令透传（slash.exec）：输入框 / 前缀走命令通道而非 LLM。@author aceFelix
  const execSlash = useBackendStore((s) => s.execSlash)
  const abortReply = useBackendStore((s) => s.abortReply)
  // 消息级回溯（撤回）：预览取改动清单、rewind 发指令（真实结果走 rewound 事件）。
  // @author aceFelix
  const previewCheckpoint = useBackendStore((s) => s.previewCheckpoint)
  const rewindMessage = useBackendStore((s) => s.rewindMessage)
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
  // 撤回确认弹窗态：rewindTail = 待撤回的尾部数（null=未开）；preview 为
  // checkpoint.preview 回执；restoreFiles = 「同时回滚工作区文件」勾选态。
  // reqId 防预览竞态：弹窗已关/切向新目标时旧预览回执回写。
  // @author aceFelix
  const [rewindTail, setRewindTail] = useState<number | null>(null)
  const [rewindPreview, setRewindPreview] = useState<CheckpointPreviewResult | null>(null)
  const [rewindLoading, setRewindLoading] = useState(false)
  const [restoreFiles, setRestoreFiles] = useState(true)
  const rewindReqRef = useRef(0)
  // 待发送附件集中在 attachStore：选文件 / 粘贴图片共用同一份
  // chips 列表（入列后在此处可见可删）。@author aceFelix
  const pending = useAttachStore((s) => s.pending)
  const addFiles = useAttachStore((s) => s.addFiles)
  const removeAttach = useAttachStore((s) => s.remove)
  const clearAttach = useAttachStore((s) => s.clear)
  const historyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const askInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // / 命令补全弹层（slash.commands，2026-10）：整条输入是 "/xxx" 时弹层
  // 接管 ↑↓/Tab/Enter/Esc，选中项（命令名+尾随空格）写回输入框；
  // Enter 发送仍由本组件 doSend 收尾（斜杠前缀走 execSlash）。@author aceFelix
  const slashAc = useSlashAutocomplete(draft, inputRef, (name) => {
    setDraft(name)
    if (inputRef.current) inputRef.current.style.height = 'auto'
    inputRef.current?.focus()
  })

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
    // 斜杠命令透传（slash.exec，2026-10）：输入以 / 开头整条按终端命令转发
    // 后端白名单执行（不再当聊天文本发给 LLM）；命令不携带附件，有附件时
    // 仍走普通发送。@author aceFelix
    if (text.startsWith('/') && !pending.length) {
      setDraft('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
      void execSlash(text)
      return
    }
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

  // 撤回：点用户气泡「撤回」→ 开弹窗并发 checkpoint.preview 取改动清单（reqId
  // 防预览竞态）；确认后发 checkpoint.rewind（入队即返），裁气泡由 rewound 事件
  // 经 dispatcher 驱动（本地不在此处裁，避免与事件双裁）。@author aceFelix
  const openRewind = async (tail: number): Promise<void> => {
    const reqId = ++rewindReqRef.current
    setRewindTail(tail)
    setRewindPreview(null)
    setRestoreFiles(true)
    setRewindLoading(true)
    const res = await previewCheckpoint(tail)
    if (rewindReqRef.current !== reqId) return
    setRewindPreview(res)
    setRewindLoading(false)
  }

  const closeRewind = (): void => {
    rewindReqRef.current += 1
    setRewindTail(null)
    setRewindPreview(null)
    setRewindLoading(false)
  }

  const confirmRewind = (): void => {
    if (rewindTail === null) return
    const restore = restoreFiles && !!rewindPreview?.has_checkpoint
    void rewindMessage(rewindTail, restore)
    closeRewind()
  }

  return (
    <main id="center-col">
      <div id="chat-history" ref={historyRef}>
        {nodes.map((n) =>
          'tools' in n ? (
            <ToolGroup key={n.key} items={n.tools} />
          ) : (
            <MessageView
              key={n.key}
              item={n.item}
              userTail={n.item.kind === 'user' ? userTailById[n.item.id] : undefined}
              onRewind={(tail) => void openRewind(tail)}
              rewindDisabled={!wsConnected || busy}
            />
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
          {/* 🗜 手动压缩上下文（替掉原截屏按钮）：透传 /compact 到引擎执行，
              结果走 slash_result 命令输出卡片 */}
          <button
            className="action-btn"
            data-testid="btn-compact"
            title={t('chat.compactTip')}
            onClick={() => void execSlash('/compact')}
            disabled={!wsConnected || busy}
          >
            {g.compact}
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
            // 补全弹层优先接管按键（↑↓/Tab/Esc/Enter 选中候选）；
            // 未消化（含输入已完整时 Enter 直通）才走发送。@author aceFelix
            if (slashAc.handleKeyDown(e)) return
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

      {/* / 命令补全浮层（portal 已挂 body，此处仅占位透出 JSX） */}
      {slashAc.overlay}

      {rewindTail !== null ? (
        <RewindDialog
          loading={rewindLoading}
          preview={rewindPreview}
          restoreFiles={restoreFiles}
          setRestoreFiles={setRestoreFiles}
          onConfirm={confirmRewind}
          onCancel={closeRewind}
        />
      ) : null}
    </main>
  )
}
