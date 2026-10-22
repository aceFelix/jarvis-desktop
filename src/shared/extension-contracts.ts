/**
 * 扩展服务（extensions.exec）数据契约 —— 从 `contracts.ts` 拆出。
 *
 * 为什么单独成文件（aceFelix，2026-10）：`contracts.ts` 已逼近 800 行上限，而阶段 10
 * 「任务中心」面板还要往 `Cmd` 里加两条指令。扩展域本身类型面就宽（五类清单 +
 * 两个市场 + 统一信封），照 `percept-contracts.ts` 的先例**按业务域拆**，而不是
 * 按语言或按类型拆。契约的唯一真源仍是 jarvis 侧
 * `agent/ui/workbench/extensions_api.py`，字段名一律保持后端 snake_case。
 *
 * @author aceFelix
 */

/**
 * 扩展服务数据契约（镜像 jarvis 侧 agent/ui/workbench/extensions_api.py）。
 *
 * 「扩展服务」面板（2026-10）集中管理五类扩展能力：MCP 服务 / 内置工具 / 技能 /
 * 插件 / harness。所有动作共用一条 RPC（extensions.exec），入参 `{category,
 * action, ...params}`，回执 result 为统一的 `ExtensionEnvelope`（ok 表示业务成败，
 * 失败文案走 message，不抛异常）。以下接口按分类镜像后端 data 结构。
 * @author aceFelix
 */
export type ExtensionCategory = 'mcp' | 'tools' | 'skills' | 'plugins' | 'harness'

/** extensions.exec 统一回执信封（ok=false 时 data 缺省、message 为失败原因）。 */
export interface ExtensionEnvelope<T = unknown> {
  ok: boolean
  data?: T
  message?: string
}

/** MCP server 条目（mcp.list → data.servers 单项）。 */
export interface McpServerItem {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  /** 是否在独立禁用名单 ~/.jarvis/mcp_disabled.json 中。 */
  disabled: boolean
  /** 当前是否已连接（运行中客户端快照）。 */
  connected: boolean
  /** 该 server 已加载的工具名（未连接时为空）。 */
  tools: string[]
}

/** mcp.list 的 data（配置路径 + MCP 总开关 + server 清单）。 */
export interface McpListData {
  config_path: string
  enabled: boolean
  servers: McpServerItem[]
}

/** mcp.add / mcp.update 入参（args/env 支持整段文本，后端按 shell/行规则解析）。 */
export interface McpUpsertPayload {
  name: string
  command: string
  args?: string
  env?: string
}

/** 内置工具条目（tools.list 单项；registry 由代码注册，只读）。 */
export interface ToolItem {
  name: string
  description: string
}

/** 技能搜索目录项（skills.list → data.dirs 单项）。 */
export interface SkillDir {
  label: string
  path: string
  exists: boolean
}

/** 已加载技能项（skills.list → data.skills 单项）。 */
export interface SkillItem {
  name: string
  /** 来源（内置 / 项目 / 用户目录等）。 */
  source: string
  description: string
  when_to_use: string
}

/** skills.list 的 data（技能目录清单 + 已加载技能）。 */
export interface SkillsData {
  dirs: SkillDir[]
  skills: SkillItem[]
}

/** 已安装插件项（plugins.list 单项）。 */
export interface PluginItem {
  name: string
  version: string
  source: string
  installed_at: string
  disabled: boolean
}

/** 插件市场条目（plugins.search 单项）。 */
export interface PluginMarketItem {
  name: string
  version: string
  description: string
  /** 来源展示（本地 / 远程）。 */
  source: string
  installed: boolean
}

/** 已安装 harness 项（harness.list 单项）。 */
export interface HarnessItem {
  id: string
  name: string
  description: string
  disabled: boolean
}

/** harness 市场条目（harness.market 单项）。 */
export interface HarnessMarketItem {
  id: string
  name: string
  description: string
  /** 依赖要求（如某 CLI 可执行文件，可为空）。 */
  requires: string
  installed: boolean
  source: string
}
