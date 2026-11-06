/**
 * 右栏「代理团队」区块 —— 看每个子代理/队友此刻在做什么，并可单独停止。
 *
 * 设计取向（aceFelix，2026-11）：
 * - **状态与动作两行说清**：第一行是身份（名字 · 角色）+ 状态徽标，第二行才是
 *   `activity`（后端给的人话）；两者都缺时回落到任务摘要，不给空行。
 * - **只对活着的代理画控制按钮**：`done/failed/stopped/offline` 一律不给「停止」；
 *   `offline` 是团队文件里残留、本进程没在跑的成员，点了也没人接。
 * - **不做乐观更新**：停止/发消息后一律用回执里的整份快照刷新；失败在面板内联
 *   提示（`.agents-notice`），不写进聊天流——这是运维状态，不是对话内容。
 * - **活动流整份替换**：后端 `agents_state` 推送的就是全量快照，面板不再自己
 *   合并增量，避免两套顺序互相盖掉。
 *
 * @author aceFelix
 */

import { useCallback, useEffect, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useAgentsStore } from '../stores/agentsStore'
import { isAgentActive, isAgentTerminal, type AgentInfo } from '../../../shared/agents-contracts'
import { useT } from '../i18n'

/** 状态 → 色标类名（未知值归 unknown，颜色只由 CSS 主题变量决定）。 */
function statusTone(status: string): 'run' | 'idle' | 'done' | 'bad' | 'unknown' {
  if (isAgentActive(status)) return 'run'
  if (status === 'idle') return 'idle'
  if (status === 'done') return 'done'
  if (status === 'failed' || status === 'stopped') return 'bad'
  return 'unknown'
}

/** 状态文案键（缺词条时回落状态原文，面板不会空着）。 */
function statusLabel(t: ReturnType<typeof useT>, status: string): string {
  const key = `agents.status.${status}`
  const label = t(key)
  return label === key ? status : label
}

export default function AgentTeamPanel(): JSX.Element {
  const t = useT()
  const snapshot = useAgentsStore((s) => s.snapshot)
  const busy = useAgentsStore((s) => s.busy)
  const notice = useAgentsStore((s) => s.notice)
  const setAgents = useAgentsStore((s) => s.setAgents)
  const setBusy = useAgentsStore((s) => s.setBusy)
  const setNotice = useAgentsStore((s) => s.setNotice)
  const refreshAgents = useBackendStore((s) => s.refreshAgents)
  const stopAgent = useBackendStore((s) => s.stopAgent)
  const messageAgent = useBackendStore((s) => s.messageAgent)

  // 行内「发消息」输入框：只对当前展开的那一行显示，避免每行常驻输入框。
  const [messaging, setMessaging] = useState('')
  const [draft, setDraft] = useState('')

  // 挂载即拉一次：右栏可能在 init 之后才被打开（切到任务中心视图时组件才挂载）。
  useEffect(() => {
    void refreshAgents()
  }, [refreshAgents])

  /** 停止一个代理：只停它自己，主对话继续。 */
  const onStop = useCallback(
    async (agent: AgentInfo) => {
      setBusy(true)
      const result = await stopAgent(agent.agent_id)
      if (result.snapshot) setAgents(result.snapshot)
      setNotice({ text: result.message, tone: result.ok ? 'ok' : 'warn' })
      setBusy(false)
    },
    [stopAgent, setAgents, setBusy, setNotice]
  )

  /** 给队友发补充指令（同步子代理会被后端明确拒绝）。 */
  const onSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || !messaging) return
    setBusy(true)
    const result = await messageAgent(messaging, text)
    if (result.snapshot) setAgents(result.snapshot)
    setNotice({ text: result.message, tone: result.ok ? 'ok' : 'warn' })
    if (result.ok) {
      setMessaging('')
      setDraft('')
    }
    setBusy(false)
  }, [draft, messaging, messageAgent, setAgents, setBusy, setNotice])

  const agents = snapshot?.agents ?? []
  const counts = snapshot?.counts
  const taskList = snapshot?.task_list

  return (
    <div className="agents-panel" data-testid="agents-panel">
      {/* 头部：团队名 + 计数 + 刷新 */}
      <div className="agents-head">
        <span className="agents-team-name">
          {snapshot?.team.name
            ? t('agents.team', { name: snapshot.team.name })
            : t('agents.teamNone')}
        </span>
        <button
          type="button"
          className="agents-btn agents-btn-ghost"
          onClick={() => void refreshAgents()}
          disabled={busy}
          title={t('agents.refreshTip')}
        >
          {t('agents.refresh')}
        </button>
      </div>

      {counts && counts.total > 0 ? (
        <div className="agents-counts">
          {counts.running > 0 ? (
            <span className="agents-count agents-count-run">
              {t('agents.running', { n: counts.running })}
            </span>
          ) : null}
          {counts.idle > 0 ? (
            <span className="agents-count">{t('agents.idle', { n: counts.idle })}</span>
          ) : null}
          {counts.done > 0 ? (
            <span className="agents-count agents-count-done">
              {t('agents.done', { n: counts.done })}
            </span>
          ) : null}
          {counts.failed > 0 ? (
            <span className="agents-count agents-count-bad">
              {t('agents.failed', { n: counts.failed })}
            </span>
          ) : null}
          {counts.offline > 0 ? (
            <span className="agents-count">{t('agents.offlineCount', { n: counts.offline })}</span>
          ) : null}
        </div>
      ) : null}

      {/* 空态：未连接 / 会话未初始化 / 还没有代理 */}
      {!snapshot ? (
        <div className="side-empty">{t('agents.offline')}</div>
      ) : !snapshot.enabled ? (
        <div className="side-empty">{t('agents.disabled')}</div>
      ) : agents.length === 0 ? (
        <div className="side-empty">{t('agents.empty')}</div>
      ) : (
        <div className="agents-list">
          {agents.map((agent) => {
            const active = isAgentActive(agent.status)
            const terminal = isAgentTerminal(agent.status)
            const secondLine =
              agent.activity || agent.current_tool || agent.task || t('agents.noTask')
            return (
              <div
                className={`agents-row${active ? ' agents-row-active' : ''}`}
                key={agent.agent_id}
                data-testid={`agent-row-${agent.agent_id}`}
              >
                <div className="agents-row-head">
                  <span className={`agents-dot agents-dot-${statusTone(agent.status)}`} />
                  <span className="agents-name">{agent.name}</span>
                  <span className="agents-role">{agent.role}</span>
                  <span className={`agents-status agents-status-${statusTone(agent.status)}`}>
                    {statusLabel(t, agent.status)}
                  </span>
                </div>
                <div className="agents-activity" title={secondLine}>
                  {secondLine}
                </div>
                {agent.status === 'failed' && agent.error ? (
                  <div className="agents-error">{t('agents.failedReason', { err: agent.error })}</div>
                ) : null}
                {agent.tool_calls > 0 ? (
                  <div className="agents-meta">{t('agents.toolCalls', { n: agent.tool_calls })}</div>
                ) : null}

                {/* 控制面：活着的行才给按钮；队友额外给「发消息」 */}
                {!terminal ? (
                  <div className="agents-row-actions">
                    {agent.mode === 'teammate' ? (
                      <button
                        type="button"
                        className="agents-btn agents-btn-ghost"
                        disabled={busy}
                        onClick={() => {
                          setMessaging(messaging === agent.agent_id ? '' : agent.agent_id)
                          setDraft('')
                        }}
                      >
                        {t('agents.message')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="agents-btn"
                      disabled={busy}
                      title={t('agents.stopTip')}
                      onClick={() => void onStop(agent)}
                    >
                      {t('agents.stop')}
                    </button>
                  </div>
                ) : null}

                {messaging === agent.agent_id ? (
                  <div className="agents-message-form">
                    <input
                      className="agents-input"
                      value={draft}
                      placeholder={t('agents.messagePlaceholder')}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void onSend()
                        }
                      }}
                    />
                    <div className="agents-message-actions">
                      <button
                        type="button"
                        className="agents-btn"
                        disabled={busy || !draft.trim()}
                        onClick={() => void onSend()}
                      >
                        {t('agents.send')}
                      </button>
                      <button
                        type="button"
                        className="agents-btn agents-btn-ghost"
                        disabled={busy}
                        onClick={() => {
                          setMessaging('')
                          setDraft('')
                        }}
                      >
                        {t('agents.cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* 共享任务台账进度（有任务才画） */}
      {taskList && taskList.total > 0 ? (
        <div className="agents-task-line">
          {t('agents.taskProgress', { done: taskList.completed, total: taskList.total })}
          {taskList.in_progress > 0
            ? ` · ${t('agents.inProgress', { n: taskList.in_progress })}`
            : ''}
        </div>
      ) : null}

      {busy ? <div className="agents-busy">{t('agents.busy')}</div> : null}
      {notice ? (
        <div className={`agents-notice${notice.tone === 'warn' ? ' agents-notice-warn' : ''}`}>
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}
