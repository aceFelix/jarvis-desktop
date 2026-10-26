/**
 * 管家服务（邮箱）动作 —— 桌面壳「管家服务」面板邮箱两项能力的指令收发层。
 *
 * 为什么拆成动作工厂（aceFelix，2026-10 阶段 10 W3）：`backendStore.ts` 已到 780 行、
 * 离 800 上限只剩一点余量，而资源/协同/扩展/感知/任务五组动作早就用同一范式拆出去了，
 * 邮箱这三条（发送 + 配置读 + 配置写）同属一个业务域，整块搬出行为不变。
 *
 * 口径与其余拆出的动作层一致：用 `client.sendCommand` **直取回执**，不走 runCommand
 * —— 表单的错误要在表单里内联显示，不该写进聊天流；未连后端一律回 `ok=false` / null，
 * 面板据此显离线态而不是抛异常。
 *
 * @author aceFelix
 */

import { Cmd, parseEmailConfig, type EmailConfig, type EmailConfigPatch, type EmailSendPayload } from '../../../shared/contracts'
import type { JarvisWsClient } from '../api/ws'

/** 拆出的邮箱动作集合（与 BackendStoreState 中同名成员签名一致）。 */
export interface ButlerActions {
  /**
   * 邮件发送（email.send）：表单点「发送」即用户确认，后端刻意绕过工具默认的 ASK
   * 询问。`ok/error` 原样回给表单内联显示；未连后端回 ok=false + 文案。
   */
  sendEmail: (payload: EmailSendPayload) => Promise<{ ok: boolean; error?: string }>
  /**
   * 邮箱配置读取（email.config.get）：面板打开时拉当前发件邮箱与 SMTP 配置。
   *
   * @returns 配置快照；未连后端或回执失败返回 null（表单显离线态）。
   */
  fetchEmailConfig: () => Promise<EmailConfig | null>
  /**
   * 邮箱配置保存（email.config.set）：只提交改动补丁（授权码留空 = 保持原值），
   * 成功后回读后端快照（含 `has_password`）供表单刷新。
   */
  saveEmailConfig: (
    patch: EmailConfigPatch
  ) => Promise<{ ok: boolean; error?: string; config?: EmailConfig }>
}

/** 组装邮箱动作：注入 client 取值器（避免模块环引用）。 */
export function buildButlerActions(getClient: () => JarvisWsClient | null): ButlerActions {
  /** 三条动作的共用骨架：离线与异常都收敛成 `fallback`，不向外抛。 */
  const askOnce = async <T>(
    cmd: string,
    payload: Record<string, unknown>,
    read: (reply: { ok: boolean; result?: unknown; error?: string }) => T,
    fallback: T
  ): Promise<T> => {
    const client = getClient()
    if (!client) return fallback
    try {
      return read(await client.sendCommand(cmd, payload))
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) } as T
    }
  }

  return {
    sendEmail: (payload) =>
      askOnce<{ ok: boolean; error?: string }>(
        Cmd.EmailSend,
        { ...payload },
        (reply) => ({ ok: reply.ok, error: reply.ok ? undefined : reply.error ?? '发送失败' }),
        { ok: false, error: '未连接到后端' }
      ),

    fetchEmailConfig: () =>
      askOnce<EmailConfig | null>(
        Cmd.EmailConfigGet,
        {},
        (reply) => (reply.ok ? parseEmailConfig(reply.result) : null),
        null
      ),

    saveEmailConfig: (patch) =>
      askOnce<{ ok: boolean; error?: string; config?: EmailConfig }>(
        Cmd.EmailConfigSet,
        { ...patch },
        (reply) =>
          reply.ok
            ? { ok: true, config: parseEmailConfig(reply.result) }
            : { ok: false, error: reply.error ?? '保存失败' },
        { ok: false, error: '未连接到后端' }
      )
  }
}
