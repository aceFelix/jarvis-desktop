# jarvis-desktop 架构说明

> 章节结构对齐 `dsh-desktop`：运行时拓扑 → 启动流程 → 持久化数据 → 安全边界 → 协议契约。
> @author aceFelix

## 1. 运行时拓扑

jarvis-desktop 是 `jarvis` 的**桌面宿主壳**，本身不含 Agent 运行时。运行期由三类进程/上下文构成：

```
┌───────────────────────────── Electron 主进程（Node） ─────────────────────────────┐
│  index.ts   应用生命周期 / 单实例锁 / 主窗口 / IPC / 退出回收                        │
│  backend.ts BackendManager：spawn → 握手 → ready → kill（状态机）                   │
│  tray.ts    系统托盘（显隐窗口 / 退出）   logging.ts  userData/logs/desktop.log      │
└───────────────┬───────────────────────────────────────────────┬──────────────────┘
       spawn 子进程 │ stdout 握手 JSON                    IPC(contextBridge) │
                ▼                                                 ▼
┌──────── Python 子进程 ────────┐                    ┌────── 渲染进程（React） ──────┐
│ python -m agent.serve         │                    │ preload → window.jarvisDesktop│
│  ChatEngine（工作台同款引擎）  │   WS 127.0.0.1     │ api/ws.ts  JarvisWsClient      │
│  DesktopBridgeServer          │◄──────────────────►│ api/dispatcher.ts 事件→store   │
│  HTTP + WS（token 认证）       │   指令 / 事件流     │ stores（Zustand）+ components  │
└───────────────────────────────┘                    └───────────────────────────────┘
```

- **主进程**只做宿主能力：拉起并守护 Python 子进程、创建窗口、转发 IPC、退出时回收进程树。
- **Python 子进程**是唯一的 Agent 运行时，与 pywebview 工作台（`jarvis --gui`）共用同一套引擎零件，仅把宿主从 pywebview 换成 WebSocket 服务。
- **渲染进程**是纯 React UI，经 preload 暴露的最小 API 拿到连接信息后，直连 Python 的 WS 端口；不接触 Node/文件系统。

## 2. 启动流程

```
app.whenReady()
  → initLogging(userData)                       # 日志落到 userData/logs/desktop.log
  → app.setAppUserModelId('AceFelix.JARVIS...')  # 任务栏图标归属（Windows AUMID）
  → registerIpc()                               # GetBackendInfo / WindowControl
  → createWindow()                              # 无边框 + sandbox，show:false
  → createBackendManager({ appDir, onStatus })  # onStatus → webContents.send(BackendStatus)
  → createTray()                                # 常驻托盘
  → startBackend()
        BackendManager.start():
          resolvePythonEnv(env, appDir)         # JARVIS_PYTHON / JARVIS_REPO
          existsSync(repo)?  否 → error（弹窗提示）
          spawn(python, ['-m','agent.serve'], { cwd:repo, windowsHide:true })
          逐行读 stdout → parseHandshakeLine()
          收到 {type:'jarvis-serve-ready', port, token, pid} → state=ready
          onStatus('ready', info) ──┐
                                    ▼
  渲染进程 App: 挂载即 getBackendInfo() + 订阅 onBackendStatus
     applyBackendStatus('ready', info) → backendStore.connect(info)
        new JarvisWsClient(port, token).connect()   # ws://127.0.0.1:port/?token=...
        服务端首推 init 事件 → dispatcher 刷新 sessions/models/voices
        BootOverlay 在 ready && wsConnected 后消失
```

Python 侧 `run_serve` 的装配顺序（`agent/serve/app.py::_serve_main`）：
`ProactiveHub` + `ChatEngine`（registry_hook 挂载提醒/截止日期工具）+ `MetricsCollector` + `WorkbenchAPI` + `DesktopBridgeServer` → `server.start()` → `engine.start()` → `metrics.start()` → `start_event_pump()` → `hub.start()`（主动播报，事件泵启动后）→ 投递 `init` 事件 → **打印握手 JSON** → 监视 stdin EOF 等待停机（停机反序：`hub.stop()` → `server.stop()` → `metrics.stop()` → `engine.stop()`）。

### 后端生命周期状态机

| 状态 | 触发 | 渲染进程表现 |
|---|---|---|
| `idle` | 初始 | 启动遮罩 |
| `spawning` | `start()` 已 spawn 未握手 | 遮罩「正在拉起后端...」 |
| `ready` | 收到握手 JSON | 建立 WS，遮罩消失 |
| `error` | 仓库缺失 / spawn 失败 / 握手超时 / 提前退出 / 崩溃 | 遮罩显示诊断 + 日志路径 |
| `exited` | 主动 `stop()` | 遮罩「后端已退出」 |

握手超时阈值 `HANDSHAKE_TIMEOUT_MS = 30000`。退出回收：Windows 用 `taskkill /pid <pid> /T /F` 杀整棵进程树（serve 可能再派生 MCP/LSP 子进程），其余平台 `SIGTERM`。

## 3. 持久化数据

壳本身**几乎无状态**，唯一的敏感数据是 WS token，且刻意不落盘：

| 数据 | 位置 | 生命周期 |
|---|---|---|
| WS token | Python 生成 → stdout 握手 → 主进程内存 → IPC invoke → 渲染进程内存 | 仅内存，**不写磁盘、不进 localStorage**；后端重启即失效重发 |
| 端口 / pid | 同上（握手 JSON） | 仅内存 |
| 桌面壳日志 | `userData/logs/desktop.log` | 追加写，含 serve stderr 转储 |
| 会话 / 模型 / 音色偏好 | 由 **jarvis 自身**在其 workdir 持久化 | 壳不介入，仅经指令读写 |

## 4. 安全边界

- **进程隔离**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；渲染进程无 Node 能力，唯一入口是 preload 的 `window.jarvisDesktop`（6 个方法，白名单 IPC 通道；其中 `log` / `notify` 为单向 `send` 不等回执）。
- **网络收敛**：Python 的 `DesktopBridgeServer` 仅绑 `127.0.0.1` + 系统分配的随机端口，**不对局域网暴露**（这是与手机协同模式 `0.0.0.0` + 固定端口的关键差异）。WS 连接需 token 认证，token 错误服务端以 `4401` 关闭。
- **外链隔离**：`setWindowOpenHandler` 把 http(s) 外链交给系统浏览器，窗口内一律 `deny`。
- **token 保密**：见上节，全链路只在内存传递。
- **无边框窗口**：拖动区用 `-webkit-app-region: drag`，窗口控制按钮 `no-drag`，仅支持 minimize / close（close 只隐藏到托盘）。

## 5. 协议契约（前后端唯一来源）

**契约来源在 Python 侧** `jarvis/agent/serve/protocol.py`；TypeScript 镜像在 `src/shared/contracts.ts`。两边改动必须同步。

- 传输：WebSocket，JSON 文本帧。
- 指令（客户端→服务端）：`{"type": "<cmd>", ...params}`。
- 事件（服务端→客户端）：`{"event": "<name>", "data": <payload>}`。
- 回执（request/response 型指令）：`{"event": "reply", "data": {"type", "ok", "result" | "error"}}`。
- 握手（stdout 单行）：`{"type": "jarvis-serve-ready", "port", "http_port", "token", "pid"}`。

### 指令一览（20 条）

| 指令 | 参数 | result |
|---|---|---|
| `message` | `text`［, `images` / `files` 附件］ | null（结果走流式事件） |
| `sessions.list` | — | `[{name, updated_at, message_count, model}]` |
| `sessions.open` | `name` | null（结果走 `session_loaded`） |
| `sessions.new` | — | null（结果走 `session_new`） |
| `models.list` | — | `[{name, vendor, desc, current}]` |
| `models.select` | `name` | bool（是否持久化成功） |
| `voices.list` | — | `[{name, description, current}]` |
| `voices.select` | `name` | bool |
| `metrics.get` | — | `{cpu, memory, disk}` |
| `state.get` | — | `{provider, model, ..., mcp}`（`mcp` 为连接快照 `{connected, failed, tools}` 或 null） |
| `schedule.list` | — | `{reminders: [{id, content, trigger_at, repeat}], deadlines: [{id, title, due_date, days_left, status}]}`（hub 未装配时空列表） |
| `cost.get` | — | `{provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, dialogs, messages}` |
| `answer_user` | `text` | null（回填 ask_user 弹窗） |
| `reply.abort` | — | bool（停止当前回复：服务端线程安全取消引擎 send 任务，取消路径仍发 `assistant_done` 收尾；无进行中回复时 false） |
| `talk.start` | — | null（结果走 `talk_started`） |
| `talk.stop` | — | null（结果走 `talk_stopped`） |
| `voice.start` | — | null（结果走 `voice_started`；与 `talk` 互斥，引擎自动停对方） |
| `voice.stop` | — | null（结果走 `voice_stopped`） |
| `voice.interrupt` | — | bool（打断当前播报/识别，不停会话；与麦克风 barge-in 双通道） |
| `proactive.ack` | `task_id` | bool（确认主动提醒已读、停升级重发；serve 侧 hub 未装配时 ok=false） |

### 消息附件（📎 / 粘贴）

`message` 指令可选附件字段（ChatArea 📎 按钮多选 / 输入框粘贴图片入口，待发送 chips 可移除）：

- `images`：`[{data: base64, media_type}]`，≤8 张、单 base64 ≤10M 字符 → 后端转
  `ImageContent` 走 vision 链路（与 REPL `/image` `/paste` 同一底层）；用户气泡显缩略图；
- `files`：`[{name, content}]`，≤5 个、单 content ≤20 万字符 → 后端拼进消息正文的
  「附带文件」代码块（超 2 万字符截断），模型直接读内容；
- 校验在 `DesktopBridgeServer._cmd_message` 入队前快速失败（reply ok=false），不进引擎队列；
- 纯图片消息（空文本）可发送；历史回放（`session_loaded`）不传 base64，图片块折叠为
  `[图片×N]` 标记。

### 右栏五区块（设置 / 任务中心 / 用量 / 系统状态 / 运行健康）

右栏（`RightSidebar.tsx`）自上而下五区块；任务/用量/健康数据集中在 `stores/rightStore.ts`，
设置区块走独立的 `stores/settingsStore.ts`（纯渲染层偏好，不走后端指令）：

- **设置**：主题（深色/浅色）+ 界面语言（中文/English），行式布局（标签 + 分段控件）便于
  追加新设置项。主题经 `applyTheme` 写 `<html data-theme>`，main.css 末尾浅色覆盖块依选择器
  生效（深色字面量不动，只覆盖结构性表面色与文本色）；语言经 `i18n.ts` 的 zh/en 字典 +
  `useT()` 驱动，v1 覆盖静态界面文案（栏标题/按钮/空态/placeholder/设置项），运行时状态
  文本（状态栏、语音阶段）与后端事件消息暂保持中文。两者 localStorage 持久化、重启保持。
- **任务中心**：`schedule.list` 的待触发提醒（时间升序）+ 活跃截止日期（`days_left`
  倒计时，≤3 天标黄、逾期标红）+ 最近简报折叠块（`proactive_notify` kind=briefing 时更新）；
- **会话与用量**：`cost.get` 的当前模型 + token 四类累计（输入/输出/缓存读/缓存写合并展示）
  + 对话轮数/消息条数；
- **系统状态**：既有 CPU/内存/磁盘三指标卡（`metrics` 事件每 2 秒推送）；
- **运行健康**：`state.get` 的 `mcp` 连接快照（成功/失败名单 + 工具数，null 显示未启用）
  + 事件日志流（滚动 30 条：回复完成/工具调用/info/warn/error/主动播报）。

刷新时机（`dispatcher.ts` 接线）：`init` 六路齐刷（左栏三面板 + schedule/cost/state）；
`assistant_done` 刷 `cost.get`（一轮对话消耗了 token）；`proactive_notify` 刷 `schedule.list`
（fired 任务离列、days_left 更新）。待发送附件集中在 `stores/attachStore.ts`（从 ChatArea
提升），截屏与 📎/粘贴共用同一份 chips 列表。

原「快捷操作」区块（2026-09 下线）拆解去向：📸 截屏入口迁入输入栏 📎 旁（主进程
`desktopCapturer` 取主屏 1280×720 缩略图 → preload `captureScreen` → `attachStore.addImage`
入附件 chips，复用消息附件链路走 vision）；📋 复制改为 AI 气泡右下角消息级「复制」按钮
（`CopyRow`，流式结束后才出现，复制成功短暂变「已复制」）；＋新会话沿用左栏「新建会话」，
■停止回复沿用输入栏发送/停止双态按钮。

### 事件一览

- **对话流**：`user_message` / `assistant_text`（流式增量）/ `assistant_thinking` / `tool_use` / `tool_result` / `assistant_done`
- **会话**：`init` / `session_ready` / `session_loaded` / `session_new`
- **提示**：`info` / `warn` / `error` / `status` / `ask_user`
- **指标**：`metrics`（每 2 秒推送）
- **实时语音**：`talk_started` / `talk_stopped` / `volume` / `user_speaking` / `ai_speaking` / `user_transcript` / `ai_transcript` / `ai_transcript_delta`
- **半双工语音**：`voice_started` / `voice_stopped` / `voice_state`（payload 为 `listening｜thinking｜speaking｜standby｜exited`）/ `voice_user_transcript` / `voice_ai_text_delta`（流式增量）/ `voice_ai_text`（全量）——音频 I/O 留 serve 本机 pyaudio，壳只做遥控 + 状态/文字显示
- **主动播报**：`proactive_notify`（payload `{kind: briefing｜reminder｜deadline, title, text, task_id}`；由 serve 侧 `ProactiveHub` 装配的每日简报 / 对话提醒 / 截止日期触发，仅 `--serve` / 桌面壳运行期间生效）

渲染侧 `api/dispatcher.ts` 把上述事件映射进 Zustand store（`chatStore` / `leftStore` / `metricsStore` / `rightStore`）与反应炉动画实例，组件只订阅 store 切片——与 workbench 前端 `app.js::dispatchEvent` 口径一致。其中 `proactive_notify` 除上屏聊天气泡外，还调 `window.jarvisDesktop.notify` 经主进程弹 Windows 原生通知（`src/main/notify.ts`），reminder 带 `task_id` 时回发 `proactive.ack`。
