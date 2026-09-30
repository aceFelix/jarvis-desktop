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
`ProactiveHub` + `ChatEngine`（registry_hook 挂载提醒/截止日期工具）+ `MetricsCollector` + `WorkbenchAPI` + `DesktopBridgeServer` → `server.start()` → `engine.start()` → `metrics.start()` → `start_event_pump()` → `hub.start()`（主动播报，事件泵启动后）→ **打印握手 JSON** → 监视 stdin EOF 等待停机（停机反序：`hub.stop()` → `server.stop()` → `metrics.stop()` → `engine.stop()`）。`init` 事件不在启动期投递（无在线客户端时 broadcast 静默丢弃），改为每连接首帧：`DesktopBridgeServer._on_client_connected` 在新 WS 认证通过后直发（payload 同 `state.get`，重连同覆盖）。

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
| 会话 / 模型 / 音色偏好 | 由 **jarvis 自身**在其 workdir 持久化（当前模型 → 会话/设置侧 `last_model`；左栏「添加模型」→ 用户级 `~/.jarvis/models.toml` 的 `[llm.custom_models."<name>"]`，API Key 同步系统 keyring） | 壳不介入，仅经指令读写 |

## 4. 安全边界

- **进程隔离**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；渲染进程无 Node 能力，唯一入口是 preload 的 `window.jarvisDesktop`（7 个方法，白名单 IPC 通道；其中 `log` / `notify` 为单向 `send` 不等回执，`selectDirectory` 为项目区目录选择器——只弹系统对话框取绝对路径，不读内容、不写文件，是否接受由后端 `project.set` 二次校验）。
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
  未注册指令（含缺 `type` 字段）由后端**立即**回 `ok=false` 失败回执（`BridgeServer._handle_ws`
  兜底，不静默忽略）——否则前端只能等到 `sendCommand` 默认 15s 超时，表现为
  「指令 X 回执超时」而看不到原因；典型触发是后端进程未重启（`python -m agent.serve`
  不热重载）而前端已热更新，错误文案会提示「请重启后端后重试」。
- 握手（stdout 单行）：`{"type": "jarvis-serve-ready", "port", "http_port", "token", "pid"}`。

### 指令一览（34 条）

| 指令 | 参数 | result |
|---|---|---|
| `message` | `text`［, `images` / `files` 附件］ | null（结果走流式事件） |
| `sessions.list` | — | `[{name, updated_at, message_count, model, current}]`（`current`=引擎当前会话，左栏选中态数据源） |
| `sessions.open` | `name` | null（结果走 `session_loaded`） |
| `sessions.new` | — | null（结果走 `session_new`） |
| `sessions.rename` | `name`, `new_name` | null（结果走 `session_renamed`；目标名占用/源不存在走 `warn`；改当前会话名会取消未落地的自动标题任务） |
| `sessions.delete` | `name` | null（结果走 `session_deleted`；删当前会话另走 `session_new` 清聊天区） |
| `models.list` | — | `[{name, vendor, desc, current, source, editable, removable, config}]`（`source`=`builtin`/`custom` 决定可改性；`config` = `{vendor, api_format, base_url, model_type, has_key}` 供编辑表单预填，**不回传明文 api_key**，只有 `has_key` 布尔） |
| `models.select` | `name` | bool（是否持久化成功）；写盘成功后 serve 侧把 `{"cmd": "switch_model"}` 入引擎队列，引擎线程内串行热切换运行中的 provider / QueryLoop（落地推 `model_switched`，失败推 `warn`），无需重启引擎 |
| `models.add` | `name`, `vendor`, `api_format`, `base_url`, `api_key`, `model_type` | `{name, vendor, api_format, base_url, model_type}`（左栏「添加模型」表单：写用户级 models.toml 的 `[llm.custom_models."<name>"]`，api_key 交系统 keyring；name/api_format/model_type 后端二次校验，非法回 ok=false；`base_url` 留空按厂商推断） |
| `models.edit` | `name`［, `new_name`, `vendor`, `api_format`, `base_url`, `api_key`, `model_type`］ | `{name, vendor, api_format, base_url, model_type, hot_switched}`（左栏双击模型项进编辑表单：内置模型名字锁定不可改、自定义模型可改名；未传字段=沿用现值，**`api_key` 留空=保持原 Key**（壳不回显密钥）；改的是当前运行模型时 serve 入队 `switch_model force=true` 强制重建 provider，端点/接口类型立即生效并回 `hot_switched=true`；内置模型改名/目标名已占用/名字不存在回 ok=false） |
| `models.remove` | `name` | `{name, was_current}`（左栏右键模型项 → 项内删除按钮：仅自定义模型可删——内置模型与「用户级 models.toml 无该段」均回 ok=false，后者防「删不掉但重启复活」；删当前模型不动运行中的 provider，仅回执提示另选） |
| `voices.list` | — | `[{name, voice_id, description, vendor, model, linked, current, custom}]`（全量音色目录：内置+自定义，当前音色置顶；`model`=适配模型、`linked`=现在点选会被联动成的 tts_model（不兼容预告），2026-09-28） |
| `voices.select` | `name` | `{ok, name, voice_id, linked_model, old_model}`（立即写盘、音色-模型不兼容时自动联动 `tts_model`；注意两层语义：传输/校验失败回 ok=false，目录未命中则 ok=true 但 `result.ok=false`，前端判 `result.ok` 并透出 `result.error`） |
| `voices.add` | `name`, `voice_id`［, `model`, `description`, `vendor`］ | `{ok, name}`（左栏「＋ 添加音色」表单 / 双击自定义项编辑：name、voice_id 必填（serve 校验 raise → ok=false），内置名遮蔽拒绝；upsert 即编辑（同名覆盖），写 settings.toml 的 `[tts.custom_voices]`） |
| `voices.delete` | `name` | `{ok, name}`（左栏右键自定义音色项 → 项内删除按钮：仅 custom 可删，内置回 ok=false；外科式删 `[tts.custom_voices."<name>"]` 段） |
| `metrics.get` | — | `{cpu, memory, disk}` |
| `state.get` | — | `{provider, model, ..., mcp}`（`mcp` 为连接快照 `{connected, failed, tools}` 或 null） |
| `schedule.list` | — | `{reminders: [{id, content, trigger_at, repeat}], deadlines: [{id, title, due_date, days_left, status}]}`（hub 未装配时空列表） |
| `cost.get` | — | `{provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cache_hit_rate（百分比，口径同 REPL `/cost`）, dialogs, messages}` |
| `answer_user` | `text` | null（回填 ask_user 弹窗） |
| `reply.abort` | — | bool（停止当前回复：服务端线程安全取消引擎 send 任务，取消路径仍发 `assistant_done` 收尾；无进行中回复时 false） |
| `talk.start` | `duplex?: bool` | null（结果走 `talk_started`；`duplex=true` 时服务端以真全双工桥接模式启动 /talk，麦克风/喇叭音频走壳，2026-09-28） |
| `talk.stop` | — | null（结果走 `talk_stopped`） |
| `talk.audio` | base64 PCM16 16k 帧 | 无回执（fire-and-forget，~100ms/帧，64KB 上限；仅 duplex 会话有效，渲染进程 `audio/talkCapture.ts` → 服务端 `BridgeMic`） |
| `voice.start` | — | null（结果走 `voice_started`；与 `talk` 互斥，引擎自动停对方） |
| `voice.stop` | — | null（结果走 `voice_stopped`） |
| `voice.interrupt` | — | bool（打断当前播报/识别，不停会话；与麦克风 barge-in 双通道） |
| `proactive.ack` | `task_id` | bool（确认主动提醒已读、停升级重发；serve 侧 hub 未装配时 ok=false） |
| `settings.get` | — | `{proactive_tts_enabled, briefing_enabled, briefing_time, deadline_enabled, deadline_check_time, tts_volume, tts_speech_rate}`（后端联动设置白名单，与 jarvis 侧 `agent/config/desktop_settings.py` 同口径；主题/语言为纯前端偏好不入协议） |
| `settings.set` | 单个白名单键 | `{key: value}`（serve 侧校验→先外科式落盘 settings.toml 对应节→再改运行时 Settings；简报/截止日期键额外触发 ProactiveHub 调度热重注册；落盘失败 ok=false 且不动运行时，壳侧回滚镜像） |
| `project.set` | `path`（绝对目录） | null（结果走 `project_switched`；非法/相对/不存在的路径 ok=false，**不**自动建目录）。serve 校验通过后入队引擎 `set_workdir`，引擎线程内串行重建系统提示词/重挂 harness/开新会话（2026-08） |
| `project.get` | — | `{workdir, name, persisted}`（`persisted=false`：serve 启动默认值尚未写入 projects.toml） |
| `projects.list` | — | `[{path, name, last_opened, exists}]`（按 `last_opened` 倒序；`exists=false` 前端置灰仍可移除） |
| `projects.forget` | `path` | bool（是否确有移除；只清 `~/.jarvis/projects.toml` 记录，**不删磁盘目录**） |

### 中栏降噪（思考 / 工具折叠，2026-09）

思考模型（qwen3.x 等）单轮思考常上千字，多步任务又常连跑十几个工具调用；两者原先都是
「全展开」渲染（思考块是普通 `div`、每个 `tool_use` 各占一张 `details` 卡），一轮任务就能把
中栏撑满好几屏。现按「**进行中可见、完成后收起**」重新组织渲染：

- **思考块**（`ThinkingBlock`）：流式期间自动展开（实时可见 + 自动滚底）；本轮结束
  （`assistant_done` → `chatStore.finishAssistant` 把 `streaming` 置 false）自动收起成一行
  「思考过程 · N 字」，正文限高 240px 内部滚动（超长思考不撑爆气泡）；
- **工具组**（`ToolGroup`）：连续的 `tool` 项在**渲染层**聚合成一条 `⛭ 工具调用 ×N` 框
  （`groupMessages` 纯函数；≥2 条才包组，单条直接渲染原卡片；历史回放的汇总卡 `toolId` 为空
  不并入；中间夹非 tool 项即切组），执行中展开、标题实时显示在跑的工具（「执行中：Bash」），
  全部 `done` 后自动收起；有失败仍收起，但标题标红 `✗N 失败`（`error` 类同步标红边框）；
  展开后组内仍是每条原工具卡，可再单独展开看入参/输出（两级折叠）；
  **轮次收尾兜底**：`finishAssistant`（`assistant_done` 驱动，含 `reply.abort` 取消与中途
  报错路径）会把仍未收到 `tool_result` 的工具卡一并定稿为 `done + isError`（附中断说明），
  避免被 kill 的 Bash 等子进程不回结果时卡片永久停在「执行中」（2026-09-30）；
- **手点优先**：两者都是受控 `<details>` + `onToggle` 把用户操作同步回 state，自动收起只在
  状态跃迁（`streaming` true→false / `allDone` false→true）那一次发生，用户手点后不被抢回；
- **零协议改动**：store 消息模型、WS 事件、后端一概没动——分组只发生在渲染层，
  `chatStore.messages` 仍是「一条工具一个 item」，历史回放与既有测试口径不变。

样式：`.thinking-block` / `.tool-group` 在 main.css 定基础，三张皮肤（theme-retro /
theme-dark-y2k / theme-light-y2k）用 `:is(.tool-card, .tool-group)` 统一配色，
`:where(...)` 去圆角列表同步纳入 `.tool-group`。

### 消息附件（📎 / 粘贴）

`message` 指令可选附件字段（ChatArea 📎 按钮多选 / 输入框粘贴图片入口，待发送 chips 可移除）：

- `images`：`[{data: base64, media_type}]`，≤8 张、单 base64 ≤10M 字符 → 后端转
  `ImageContent` 走 vision 链路（与 REPL `/image` `/paste` 同一底层）；用户气泡显缩略图；
- `files`：`[{name, content}]`，≤5 个、单 content ≤20 万字符 → 后端拼进消息正文的
  「附带文件」代码块（超 2 万字符截断），模型直接读内容；
- 校验在 `DesktopBridgeServer._cmd_message` 入队前快速失败（reply ok=false），不进引擎队列；
- 纯图片消息（空文本）可发送；历史回放（`session_loaded`）不传 base64，图片块折叠为
  `[图片×N]` 标记。

### 左栏项目工作区（切项目，2026-08）

左栏底部的「项目」区（`components/ProjectSection.tsx` + `styles/project-section.css`）把 serve
启动时固定的 `settings.workdir` 升级为可运行时切换的「工作区」（协议细节见 jarvis 侧
`docs/architecture/07-UI层.md` 的「项目热切换」）：

- **位置**：面板区（history / model / voice）之后、状态栏 `#left-footer` 之前，**底部常驻**；
  切三个面板时始终可见，列表再长也不被压缩（`.project-section` 的 `flex-shrink: 0`）。
  此前放在面板区之上（紧贴 `col-header`）会挤占顶部模式/面板切换的视线，2026-08 调整。
- **交互**：「＋ 打开文件夹」→ 主进程 `selectDirectory`（`dialog.showOpenDialog`，`properties: ['openDirectory']`，不加 `createDirectory`）→ 拿到绝对路径后发 `project.set`；
  最近项目项点击即切、右键项内出现「从列表移除」按钮（再点才发 `projects.forget`，二次确认）。
- **状态收敛**：`leftStore` 持 `currentProject` / `recentProjects` / `pendingProjectPath`，动作在
  `backendStore`（`setProject` / `refreshProjects` / `forgetProject`）。点选后用
  `pendingProjectPath` 打「待生效」标记（镜像 `pendingModel`），`project_switched` 事件到达时
  只清匹配项（快速连点不误清）；`init`（每连接首帧）与事件后各刷一次 `project.get` + `projects.list`。
- **配色随皮肤**：项目区不写死色值——描边用三皮肤共用的 `--edge-strong/mid/soft`，文本与
  强调色用 `--proj-text/bright/dim/error/panel/hover-bg/hover-fg`（同 `--scroll-thumb` 范式，
  由 `theme-dark-y2k.css` / `theme-retro.css` / `theme-light-y2k.css` 的 `:root[data-theme]` 块赋值），
  悬停取「反白」口径（同行 `.list-item:not(.noop):hover`）；三皮肤的 `:where(...)` 去圆角/去玻璃
  列表已纳入 `.project-section` / `.project-current` / `.project-recent-main` / `.project-forget-btn`。
- **状态栏握手刷新**：`init` 事件在刷七路数据之外把状态栏从启动期的「等待后端启动...」
  切到「就绪」（此前只有首轮回复结束/断线才刷新，连上后端后长期挂着启动文案会误导）。
- **旧后端兼容**：「打开文件夹」在未重启的旧后端上会立即收到 `ok=false`
  「后端不支持指令 project.set（…请重启后端后重试）」，错误秒级上屏（见上文传输层兜底）。

### 左栏模型面板（切换 / 添加 / 修改 / 删除，2026-09）

左栏「模型」面板（`LeftSidebar.tsx`）的项交互对齐会话列表：**双击**模型项进配置编辑表单、
**右键**模型项项内出现删除按钮（二次确认）；列表末项为「＋ 添加模型」（`model-add-item`，
虚线边框区别于普通模型项）：

- **视图替换**：点末项 → `leftStore.modelFormOpen` 置真 → `ModelForm.tsx`（独立组件）
  整体替换模型列表，与右栏 `SettingsPanel` 替换 `RightSidebar` 同一模式（瞬态，不持久化）；
  顶部 ← 或面板内「取消」回列表，提交成功后自动回列表。
- **字段口径**：模型厂商（11 项，对齐 jarvis `model_manager._MODEL_VENDOR_OPTIONS`）/ 模型名
  （必填，本地校验）/ API Key（password，留空=用全局 Key）/ 接口类型
  （openai｜anthropic｜dashscope｜zai）/ Base URL（留空按厂商推断）/ 模型类型
  （text｜multimodal）——与 REPL `/models` → 添加其他模型完全同口径。
- **提交链路**：`backendStore.addModel` → `models.add` 指令 → serve 侧 `_rpc_models_add`
  （name/api_format/model_type 白名单校验）→ `WorkbenchAPI.add_model` 复用
  `save_custom_model` + `_infer_base_url` 落盘并同步内存 → 成功后壳刷 `models.list`
  并在聊天流提示「模型「X」已添加」，回执失败保持表单打开（错误走聊天流统一出口）。
- **编辑模式（双击模型项）**：`leftStore.editModelForm(name)` 置 `modelFormTarget` 后，同一个
  `ModelForm` 以 `<ModelForm key={target || 'add'} />` 重挂载（连续双击不同模型不残留草稿）：
  字段预填该项 `config`（`models.list` 新带回 `source`/`editable`/`removable`/`config`，
  **不含明文 api_key 只给 `has_key`**）——内置模型（`source: 'builtin'`）「模型名」输入框禁用，
  自定义模型可改名；API Key 恒空、hint 改为「留空保持原 Key 不变」。提交走 `models.edit`
  → serve `_rpc_models_edit` → `WorkbenchAPI.edit_model`，成功后回列表 + 刷 `models.list` +
  提示「配置已更新」（改的是当前运行模型时后端强制重建 provider，提示补「当前会话已按新配置重连」）。
- **删除（右键模型项）**：右键 toggle 项内删除按钮（`model-del-btn`，仅 `removable`＝自定义模型
  渲染；右键空白处或切换面板自动收起），点击才发 `models.remove`；回执 `was_current` 决定文案
  （当前模型→「仍在用它，建议另选一个模型」），并刷 `models.list` 让该项消失。
- **可发现性**：面板底部一行 `panel-hint`（「双击模型改配置 · 右键自定义模型可删除」），
  模型项 `title` 提示同一内容（内置模型提示「（内置模型不可删除）」）。
  注：当前模型项仍带 `.noop`（去手型/悬停），但**不再屏蔽指针事件**，否则「改当前模型配置」
  这条最常用的路径点不进去——点选去重改由 `onClick` 守卫负责。
- **旧后端兼容**：若壳已新、后端进程仍旧（未重启，无 `models.add` 注册），后端会
  立即回 `ok=false`「后端不支持指令 models.add（…请重启后端后重试）」而非静默丢弃：
  错误秒级上屏，不会等到 15s 回执超时（见 jarvis `docs/fixlogs/unknown-command-silent-drop.md`）。
- **点选去重与「待生效」标记**：`models.select` 写 `last_model` 之后，serve 把 `switch_model`
  入引擎队列，引擎线程里换掉运行中的 provider / QueryLoop（`list_models` 的 `current` 改取
  引擎实时模型，不再是启动快照）——落地推 `model_switched`，壳据此清标记并刷列表，
  「· 当前」立刻移动；正有一轮回复在跑时切换在该轮结束后落地（指令队列串行）。
  `voices.select`（2026-09-28 起）立即写盘并在不兼容时联动 `tts_model`，但不热切换运行中的
  语音会话（下次语音生效），`voices.list` 的 `current` 不随点选移动，壳靠 `pendingVoice` 标「待生效」。
  写盘回执与事件之间存在空窗，壳仍需要自记选择，否则用户看不出是否选上就会反复点：
  `leftStore` 的 `pendingModel` / `pendingVoice`（瞬态、不持久化）在点选时
  乐观标记（先标记后发指令，免得事件比回执先到留下残留），`backendStore.selectModel`
  / `selectVoice` 先比对：同名 pending 或该模型已是 `current` 直接 return（不发指令、不弹提示）；
  `set_model` / `set_voice` 返回 `false`（写盘失败）时撤销标记，模型侧另提示
  「✗ 模型切换失败（未能写入用户级配置）：X」。**成功提示由引擎 `info` 事件上屏**
  （壳不再本地弹，否则与引擎提示叠成双气泡）；引擎构造 provider 失败时只推 `warn`、
  不推 `model_switched`，壳保留「待生效」标记供重试。列表项侧：副行显「· 待生效」（与「· 当前」
  互斥，运行时优先标 `current`），并加 `.pending`（各皮肤虚线框 + 亮字）与 `.noop`（`cursor: default`
  + `pointer-events: none`，连带让主题层的 `:hover` 规则失效，无需逐皮肤重写悬停色）。
- **表单字段区滚动**（`ModelForm` / `VoiceForm` 共用，2026-09-30 实机修复）：两个表单的
  字段容器除 `.settings-panel` 外另带 `.form-scroll`（样式在 `styles/main.css`）——
  `flex: 1` + `min-height: 0` + `overflow-y: auto`，面板高度不够时字段区自身出滚动条
  （外观与 `.list-area` 一致，走 `--scroll-thumb` / `--scroll-track` 变量随三张皮肤变色）。
  此前 `.settings-panel` 无滚动约束，字段溢出面板后与左栏底部常驻的「项目」区
  叠在一起（Base URL / 模型类型等字段被盖住、也点不到）。报错行与保存/取消按钮
  （`.model-form-actions`，已加 `flex-shrink: 0`）均在滚动区之外、作为 `.panel` 直接
  子项常驻：字段滚到任意位置都能直接提交，校验失败原因也不会滚出视口。
  仅表单加 `.form-scroll`，右栏 `SettingsPanel` 仍随外层整体滚动，行为不变。
- **运行健康日志区可读性**（`.log-feed` / `.log-line`，2026-09-30 实机修复）：复古主题下
  日志面板旧背景仅 `rgba(0,12,4,0.7)` 且 `backdrop-filter` 被主题层关闭，背后动画 CRT
  光斑透底，叠加 11px 等宽密排小字与全屏扫描线后糊成一片（实机反馈“重叠、看不清”）。
  修复：三张皮肤的 `.log-feed` 背景统一提到近不透明（retro `rgba(1,10,3,0.95)` /
  dark `0.95` / light `0.95`）挡住透底光斑；retro 日志文字由 `--retro-dim` 改为更亮的
  `--retro-text`；`.log-line` 基础行高放宽到 `1.7` 以扛住扫描线对笔画的切割。
- **样式**：行样式复用设置面板（`.setting-row` / `.setting-label` / `.setting-hint`），
  文本框走 `.model-input`、下拉与改名输入框走 `styles/controls.css`（表单控件层）；
  三个下拉为**自绘** `ThemedSelect.tsx`——原生 `<select>` 的展开
  列表由系统绘制（固定蓝高亮 + 系统圆角，不随皮肤且会盖住表单标签），故改为自绘触发器 +
  主题化浮层（类名 `.themed-select-*`）：浮层 `createPortal` 到 body（左栏 `.glass-col` 的
  `backdrop-filter` 会创建 containing block，留在原 DOM 内 fixed 会错位）并以视口坐标定位
  （下方空间不足时向上翻，打开期间滚动 / resize 即关闭），配色随三张皮肤（荧光绿亮绿反相 /
  电光蓝亮青反相 / 金属银灰底黑字）并纳入各主题去圆角 `:where(...)`；
  `.session-rename-input`（会话改名输入框）与 `.model-input` 同口径改走主题变量，
  不再写死蓝边；控件聚焦边框与文本选中高亮（`::selection`）也随主题走
  （`var(--edge-strong)` 与各皮肤覆盖块），不再出现浏览器默认蓝边/蓝底；
  简报/检查时间用**自绘** `ThemedTimePicker.tsx`（小时/分钟两个 `ThemedSelect`
  并排）——原生 `<input type="time">` 的时/分弹出面板由 Chromium 内部 UI 绘制
  （白底 + 系统蓝选中），CSS 无法触达，故弃用。

### 右栏四区块（任务中心 / 用量 / 系统状态 / 运行健康）与设置面板

右栏信息面板（`RightSidebar.tsx`）自上而下四区块；任务/用量/健康数据集中在 `stores/rightStore.ts`：

- **任务中心**：`schedule.list` 的待触发提醒（时间升序）+ 活跃截止日期（`days_left`
  倒计时，≤3 天标黄、逾期标红）+ 最近简报折叠块（`proactive_notify` kind=briefing 时更新）；
- **会话与用量**：`cost.get` 的当前模型 + token 四类累计（输入/输出/缓存读/缓存写合并展示）
  + **缓存命中率**（`cache_hit_rate`，一行百分比，`usage-cache-hit-rate`）+ 对话轮数/消息条数；
  命中率由后端 `Usage.cache_hit_rate` 按协议口径算好（与 REPL `/cost` 同一份实现，前端不重算），
  title 透出「命中 / 输入」明细；旧后端无该字段时隐藏整行不留空白；
- **系统状态**：既有 CPU/内存/磁盘三指标卡（`metrics` 事件每 2 秒推送）；
- **运行健康**：`state.get` 的 `mcp` 连接快照（成功/失败名单 + 工具数，null 显示未启用）
  + 事件日志流（滚动 30 条：回复完成/工具调用/info/warn/error/主动播报）。MCP 为后台
  预热（约 9s），`init` 拉到快照常为 null，连接落定后服务端推 `mcp_ready` 事件补齐。

刷新时机（`dispatcher.ts` 接线）：`init` 七路齐刷（左栏三面板 + schedule/cost/state + 设置回填）；
`assistant_done` 刷 `cost.get`（一轮对话消耗了 token）；`proactive_notify` 刷 `schedule.list`
（fired 任务离列、days_left 更新）；`mcp_ready` 直写右栏 `mcp` 快照（payload 结构非法时退回
主动拉一次 `state.get`，避免谎报）。待发送附件集中在 `stores/attachStore.ts`（从 ChatArea
提升），截屏与 📎/粘贴共用同一份 chips 列表。

原「快捷操作」区块（2026-09 下线）拆解去向：📸 截屏入口迁入输入栏 📎 旁（主进程
`desktopCapturer` 取主屏 1280×720 缩略图 → preload `captureScreen` → `attachStore.addImage`
入附件 chips，复用消息附件链路走 vision）；📋 复制改为 AI 气泡右下角消息级「复制」按钮
（`CopyRow`，流式结束后才出现，复制成功短暂变「已复制」）；＋新会话沿用左栏「新建会话」，
■停止回复沿用输入栏发送/停止双态按钮。

### 设置面板（独立组件，2026-09）

设置从右栏信息面板中独立出来：`SettingsPanel.tsx` 整体替换右栏（`App.tsx` 按
`stores/uiStore.ts` 的 `rightView: 'dashboard' | 'settings'` 条件渲染，瞬态不持久化，
重启回信息面板），入口为标题栏齿轮按钮（`TitleBar.tsx`，兼 toggle，激活态高亮），
面板内 ← 返回。四节（外观 + 语音播报 + 每日简报 + 截止日期追踪）：

- **外观**：主题（荧光绿/电光蓝/金属银——三主题同风格（Y2K 像素复古）仅配色不同，荧光绿排第一
  且首启默认——无持久化/非法值时回退 retro，用户显式选择经 localStorage 优先）+ 界面语言（中文/English）+ 字体（英文字体 / 中文字体各自单设），行式布局（标签 + 分段控件 / 可搜索下拉）。
  纯前端偏好（`stores/settingsStore.ts`，不走后端指令）：主题经 `applyTheme` 写
  `<html data-theme>`，三张皮肤覆盖块 `styles/theme-retro.css` / `styles/theme-dark-y2k.css` /
  `styles/theme-light-y2k.css` 依选择器生效；字体经 `applyFont` 拼「英文在前、中文次之、等宽尾兜底」的有序栈
  写 `<html style="--app-font">`，皮肤 `body` 以 `var(--app-font, <等宽栈>)` 引用——CSS 逐字符取第一个含其字形的
  字体，故拉丁归英文字体、汉字归中文字体，两者互不干扰；两者皆未选则不写变量→回落主题默认等宽终端栈（代码块/工具
  输出始终 `Consolas, monospace` 不受影响）；数据源为 Chromium Local Font Access API `window.queryLocalFonts`（首次点开
  下拉时于用户手势栈内经 `ThemedSelect` 的 `onOpen` 懒加载，主进程 `grantPermissions` 放行 `local-fonts` 权限；API 不可用/被拒
  回落到一份常见字体预设，见 `lib/fontUtils.ts` + `components/FontPicker.tsx`）；语言经 `i18n.ts` 的 zh/en 字典 + `useT()` 驱动。三者 localStorage 持久化、重启保持。
  控件类基底样式（输入框、自绘下拉 `.themed-select-*`、自绘时间选择器 `.themed-time*`、
  会话改名输入框、模型表单提示与动作区）
  位于 `styles/controls.css`——`main.tsx` 中紧随 `main.css`、早于三张皮肤引入（main.css 已超
  项目单文件 800 行规范，2026-09 按职责拆出控件层，只放基础取值、主题配色仍归各皮肤）。
  主进程 `BrowserWindow.backgroundColor` 为复古黑绿底 `#020602`（与默认荧光绿一致，防启动白闪）。
  - **荧光绿（CRT 终端）皮肤层**：`styles/theme-retro.css`（`[data-theme='retro']` 覆盖块，
    在 `main.tsx` 于 main.css 之后 import）——黑底荧光绿、扫描线叠层、点阵抖动、
    硬边像素（去圆角/去玻璃模糊）、等宽字辉光、方块滚动条，纯 CSS 无图片资源。
  - **电光蓝（Y2K 像素复古）皮肤层**：`styles/theme-dark-y2k.css`（`[data-theme='dark']`
    覆盖块，2026-09 替换原深蓝玻璃拟态底妆）——与荧光绿同族（硬边/扫描线/点阵抖动/等宽辉光/
    方块滚动条/反应炉像素化），视觉身份为电光蓝霓虹（#00e5ff 系）+
    Y2K 铬金属渐变（标题/选中态/主按钮渐变字与填充）+ 赛博网格底 + 像素切角（clip-path 缺角 +
    drop-shadow 像素投影）+ 斜角浮雕边框，纯 CSS 无图片资源。
  - **金属银（Y2K 像素复古 · 亮色）皮肤层**：`styles/theme-light-y2k.css`（`[data-theme='light']`
    覆盖块，2026-09 由原浅色玻璃拟态改造，main.css 末尾旧浅色覆盖块迁入本文件）——与前两张同族结构，
    视觉身份为铬银金属渐变（白-银-灰三段反光）+ 黑色描边/文字（无蓝相，与电光蓝区分）+ 亮底赛博网格/点阵抖动/中性灰扫描线，纯 CSS 无图片资源。
  - **Glyph 符号系统**：`glyphs.ts` 三张表（RETRO 方括号牌荧光绿 / Y2K 尖括号牌电光蓝 / SILVER 花括号牌金属银），
    `useGlyphs()` 订阅主题返回对应表；三表同属括号牌体系、仅括号形变不同（三主题视觉身份呼应）；
    i18n 文案剥离 emoji 前缀只留纯文字，组件侧 `{g.xxx} {t(key)}` 组合，切主题自动重渲染。
  - **反应炉像素化**：`reactor.ts::setRetro(on)` 仅切绿系配色表；`setPixelated(on)` 切 1/4 分辨率
    绘制（backing store 缩放，配合 CSS `image-rendering: pixelated` 放大成像素颗粒）——三主题
    均像素化（恒开）、配色各随主题；`ReactorCanvas.tsx` 订阅主题调两者。
- **后端联动设置（三组，2026-09 第一批扩键）**：真源在 jarvis 侧 settings.toml
  （白名单 schema 见 jarvis `agent/config/desktop_settings.py`，密钥/自由路径永不入协议），
  镜像在 `settingsStore.backendSettings`（单键 null=未拉取/未连接，对应行显离线态文案，
  不进 localStorage）：init 时 `settings.get` 经 `parseBackendSettings` 宽容解析全量回填
  （类型不符/缺字段置 null，兼容旧版后端）；改动时 `backendStore.setBackendSetting(key, value)`
  乐观更新 + 发 `settings.set`（值未变不发指令），回执失败回滚原值（prev=null 回滚到
  null，错误写聊天流）。三组控件：
  - **语音播报**：主动播报待机 TTS 开关（拨动开关 role=switch）+ 播报音量（0-100）/
    语速（0.5-2.0×）滑杆——TTS 参数每次播报现读 Settings，改完立即生效；
  - **每日简报**：启用开关 + 简报时间（自绘时间选择器 `ThemedTimePicker`：小时/分钟两个
    主题化下拉并排，点选即提交合法 HH:MM；原生 `<input type="time">` 的弹出面板由
    Chromium 内部绘制、无法主题化，已弃用）；
  - **截止日期追踪**：启用开关 + 每日检查时间。
  简报/截止日期是调度键：serve 侧改完运行时后额外经 `ProactiveHub.hot_update_schedule`
  撤旧任务重注册（调度任务是启动快照，不重注册新时间/新开关要重启才生效）。

### 事件一览

- **对话流**：`user_message` / `assistant_text`（流式增量）/ `assistant_thinking` / `tool_use` / `tool_result` / `assistant_done`
- **会话**：`init` / `session_ready` / `session_loaded` / `session_new` / `session_renamed` / `session_deleted`
- **提示**：`info` / `warn` / `error` / `status` / `ask_user`
- **模型热切换**：`model_switched`（payload `{model}`；引擎已把运行中的 provider / 模型换成 `model` 的落地回执：壳清匹配的「待生效」标记 + 刷 `models.list` / 成本 / 状态，「· 当前」随之移动）
- **项目工作区**：`project_switched`（payload `{workdir, name}`；`project.set` 在引擎线程内落地后推一次，与 `model_switched` 同为「入队即返回、落地走事件」：壳据此写当前项目、清匹配的「待生效」标记，并刷会话列表 + 项目区）
- **指标**：`metrics`（每 2 秒推送）
- **实时语音（真全双工）**：`talk_started` / `talk_stopped` / `volume` / `user_speaking` / `ai_speaking` / `user_transcript` / `ai_transcript` / `ai_transcript_delta` / `talk_audio`（下行 24kHz PCM 帧，base64；空串 payload = 打断 flush，由 `audio/talkPlayback.ts` 排播/清空）——duplex 会话下麦克风采集与播放均在渲染进程（浏览器 `getUserMedia({echoCancellation:true})` 系统级 AEC），服务端引擎只收发 WS 帧（`BridgeMic`/`BridgeSpk`，镜像 jarvis `agent/voice/realtime_bridge_audio.py`）
- **半双工语音**：`voice_started` / `voice_stopped` / `voice_state`（payload 为 `listening｜thinking｜speaking｜standby｜exited`）/ `voice_user_transcript` / `voice_ai_text_delta`（流式增量）/ `voice_ai_text`（全量）——音频 I/O 留 serve 本机 pyaudio，壳只做遥控 + 状态/文字显示
- **主动播报**：`proactive_notify`（payload `{kind: briefing｜reminder｜deadline, title, text, task_id}`；由 serve 侧 `ProactiveHub` 装配的每日简报 / 对话提醒 / 截止日期触发，仅 `--serve` / 桌面壳运行期间生效）

渲染侧 `api/dispatcher.ts` 把上述事件映射进 Zustand store（`chatStore` / `leftStore` / `metricsStore` / `rightStore`）与反应炉动画实例，组件只订阅 store 切片——与 workbench 前端 `app.js::dispatchEvent` 口径一致。其中 `proactive_notify` 除上屏聊天气泡外，还调 `window.jarvisDesktop.notify` 经主进程弹 Windows 原生通知（`src/main/notify.ts`），reminder 带 `task_id` 时回发 `proactive.ack`。

`session_ready` 仅为引擎装配完成通知（只刷新会话列表，不清屏）：该事件由 `_ensure_session`
在首轮回合中途发出，带清屏语义会吞掉乐观上屏的首发用户气泡（实测启动后首条消息只剩
AI 回复）。「清屏初始化」语义由 `backendStore.applyBackendStatus` 接管：检测到后端进程
pid 换代（崩溃重启）时清旧气泡；workbench `app.js` 同口径，清屏初始化由页面加载空屏与
`session_new` 兜底（fixlog: `session-ready-first-bubble-swallow`）。

### 左栏会话项交互（删除 / 改名）

`LeftSidebar.tsx::SessionItem` 与 workbench `app.js::refreshSessionList` 同口径：

- **单击**：220ms 延时后发 `sessions.open` 加载会话（当前会话不发）；延时用于让位双击，
  双击会先清掉该定时器，避免「想改名却先加载一次」。
- **双击**：标题就地换成 `input`（`session-rename-input`）内联改名，`Enter` / 失焦提交发
  `sessions.rename`，`Esc` 取消；空名或未变化视为取消。改当前会话名时引擎置
  `_title_generated=True` 并取消未落地的自动标题任务，防自动标题覆盖用户自定义名。
- **右键**：项右侧切出删除按钮（`session-del-btn`，荧光绿显 `[DEL]`、电光蓝显 `<DEL>`、金属银显 `{DEL}`），
  点击才真删发 `sessions.delete`（二次确认）；列表空白处右键收起删除按钮。

改名 / 删除均只发指令，列表刷新由回流事件 `session_renamed` / `session_deleted` 驱动（只刷列表
不清屏）；删当前会话时引擎复用新建语义另发 `session_new` 清聊天区。目标名已占用（存盘
文件存在）一律拒绝，不覆盖。
