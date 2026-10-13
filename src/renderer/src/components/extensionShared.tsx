/**
 * 扩展服务面板公共件（2026-10）：子面板返回头 + 清单拉取 hook。
 *
 * 「扩展服务」面板下五个子面板（MCP / 内置工具 / 技能 / 插件 / harness）结构同构：
 * 返回头（← 回分类清单）+ 各自内容。返回头与「挂载即拉清单、可手动重载」的取数
 * 逻辑抽在此处复用，避免五份复制（见 code-structure.md 的禁止复制粘贴复用）。
 *
 * @author aceFelix
 */

import { useCallback, useEffect, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useExtensionStore } from '../stores/extensionStore'
import { useT } from '../i18n'
import type { ExtensionCategory } from '../../../shared/contracts'

/**
 * 子面板返回头：← 回分类清单（不退出整个扩展面板）。
 *
 * @param titleKey 面板标题的 i18n 键（如 `extension.cat.mcp`）。
 * @author aceFelix
 */
export function ExtensionSubhead({ titleKey }: { titleKey: string }): JSX.Element {
  const t = useT()
  const closeCategory = useExtensionStore((s) => s.closeCategory)
  return (
    <div className="butler-subhead">
      <button
        className="settings-back"
        data-testid="btn-extension-back"
        title={t('extension.back')}
        onClick={closeCategory}
      >
        ←
      </button>
      <span className="col-title">{t(titleKey)}</span>
    </div>
  )
}

/** 清单拉取 hook 的返回值。 */
export interface ExtensionData<T> {
  /** 拉取到的 data（未就绪/失败为 null）。 */
  data: T | null
  /** 首次/重载进行中。 */
  loading: boolean
  /** 失败文案（空串=正常）。 */
  error: string
  /** 重新拉取（写操作成功后调用刷新）。 */
  reload: () => Promise<void>
}

/**
 * 只读清单拉取 hook：挂载即拉一次，参数变化时重拉；返回 reload 供写操作后刷新。
 *
 * 用 `client.sendCommand` 直取回执（不走 runCommand，不污染聊天流），失败文案
 * 由调用面板内联展示（与邮箱服务面板同口径）。
 *
 * @param category 扩展分类。
 * @param action 动作名（通常为 'list'）。
 * @param params 动作参数（对象；内部按 JSON 序列化做依赖比较）。
 * @author aceFelix
 */
export function useExtensionData<T>(
  category: ExtensionCategory,
  action: string,
  params: Record<string, unknown> = {}
): ExtensionData<T> {
  const runExtension = useBackendStore((s) => s.runExtension)
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // params 为字面量对象，用序列化值做依赖，避免每次渲染重拉
  const paramsKey = JSON.stringify(params)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    const env = await runExtension<T>(category, action, JSON.parse(paramsKey))
    setLoading(false)
    if (env.ok) {
      setData((env.data ?? null) as T | null)
      setError('')
    } else {
      setError(env.message ?? '加载失败')
    }
  }, [category, action, paramsKey, runExtension])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload }
}
