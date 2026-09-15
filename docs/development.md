# jarvis-desktop 开发指南

> 本地环境、环境变量、测试、人工走查清单、二期路线图。@author aceFelix

## 1. 本地环境

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 18（推荐 20+） | 构建 / 运行 Electron |
| Python | jarvis 的运行环境 | 拉起 `agent.serve` 后端 |
| websockets | jarvis 核心依赖（2026-09 起） | serve 模式的 WS 传输层，随 jarvis 安装自动就绪 |
| jarvis 源码 | 同级 `../jarvis` | 一期 dev 模式直接依赖源码仓库 |

```powershell
# 首次安装
npm install
# 若 Electron 二进制因证书/代理下载失败，用国内镜像重装：
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; npm install
```

## 2. 环境变量

主进程 `backend.ts::resolvePythonEnv` 读取以下变量定位 Python 后端：

| 变量 | 默认 | 说明 |
|---|---|---|
| `JARVIS_PYTHON` | `python` | 解释器命令或绝对路径（venv 场景填 `...\Scripts\python.exe`） |
| `JARVIS_REPO` | `<本仓库>/../jarvis` | jarvis 源码仓库根目录（须含 `agent/` 包） |

示例（指定 venv 与非同级仓库）：

```powershell
$env:JARVIS_PYTHON="E:\2.MyProjects\MyAgentChat\J.A.R.V.I.S\jarvis\.venv\Scripts\python.exe"
$env:JARVIS_REPO="E:\2.MyProjects\MyAgentChat\J.A.R.V.I.S\jarvis"
npm run dev
```

> 后端启动失败时，主进程弹窗会给出诊断，并指向日志 `userData/logs/desktop.log`
> （Windows: `%APPDATA%/jarvis-desktop/logs/desktop.log`）。serve 子进程的 stderr 也会转储到该日志。

## 3. 常用命令

```powershell
npm run dev        # 开发模式：热重载 + 拉起 Python 后端
npm run build      # 打包 main/preload/renderer 到 out/
npm run typecheck  # tsc：tsconfig.node.json（主进程/测试 main）+ tsconfig.web.json（渲染/测试 renderer）
npm run test       # vitest run（全部单测）
npm run test:watch # vitest 监听模式
```

### 图标资源（build/icon.ico）

`electron-builder.yml` 的 `win.icon` 与 `tray.ts` 的兜底图标路径都指向 `build/icon.ico`（多尺寸 16~256，深蓝实底反应炉图案）。该文件由脚本生成并入库，重生成方式（需 jarvis 环境已装 Pillow）：

```powershell
# 复用 jarvis agent/daemon/autostart.py 的反应炉绘制逻辑，单一图案来源
python scripts/gen_icon.py
```

**窗口与托盘同源**：任务栏/Alt-Tab 图标（`BrowserWindow.icon`）与托盘图标都经 `src/main/appIcon.ts` 解析（候选顺序：`~/.jarvis/jarvis_window.ico` → `build/icon.ico`），杜绝「任务栏 Electron 原子 logo、托盘反应炉」的分叉（2026-09-10 实机反馈修复）。

## 4. 测试

vitest 分两个环境：`test/main/**` 与 `test/preload/**`（node 环境，主进程 / preload 逻辑）与 `test/renderer/**`（默认 node，组件测试文件头用 `// @vitest-environment jsdom` 单独声明）。共 **122 用例**：

| 测试文件 | 覆盖 |
|---|---|
| `test/main/backend.test.ts` | `parseHandshakeLine`（正常/残缺/超时行）、`resolvePythonEnv`、`BackendManager` 状态机（spawn→ready、stderr 噪声、仓库缺失、spawn 抛错、提前退出、握手超时、stop 杀进程树、意外退出、重复 start 复用） |
| `test/main/appIcon.test.ts` | 图标候选优先级（用户目录实底版 → build/icon.ico）、全缺失降级 null、build/icon.ico 入库守卫、加载失败降级 |
| `test/main/notify.test.ts` | `showSystemNotification`（主动播报系统通知）：isSupported 弹窗、title 空回退 J.A.R.V.I.S、title+body 全空不弹、构造异常吞掉、窗口未聚焦 flashFrame / 已聚焦不闪 / 无窗口降级 |
| `test/preload/index.test.ts` | preload 暴露面契约：`jarvisDesktop` 键、notify 通道存在、notify 走 SystemNotify 通道原样 send、通道名稳定契约、既有能力（log/windowControl/onBackendStatus）未被挤掉 |
| `test/renderer/ws.test.ts` | `JarvisWsClient`：URL 构造与 token 编码、handleRaw 事件分发、sendCommand 回执兑现、同类型 FIFO 匹配、send 只发不等、断线拒绝 pending + 退避重连、close 不重连 |
| `test/renderer/chatStore.test.ts` | 消息流 store 全部 action：流式增量、thinking/text 分累、finishAssistant、工具卡建卡与按 id 回填、乱序补卡、ask_user、replayHistory、clear |
| `test/renderer/dispatcher.test.ts` | `dispatchServerEvent` 全事件路由 → chat/left/metrics store 与状态栏回调（含 `assistant_done` 撤销 busy，驱动发送/停止双态按钮恢复）；列表类型守卫；`proactive_notify` 主动播报（briefing/reminder/deadline 上屏、reminder 带 task_id 回 ack、系统通知调用、window 缺失降级）；半双工语音 `voice_*` 事件（started/stopped/state 迁移/user_transcript/ai_text_delta→ai_text 全量替换、talk_started 权威复位 talk 模式） |
| `test/renderer/components.test.tsx` | React 组件（@testing-library/react）：ChatArea 气泡流式渲染 + 光标 + 工具卡 + ask_user + 发送禁用 + 发送/停止双态按钮（busy 时变“■ 停止”、点击发 `reply.abort`、busy 中 Enter 不叠发）+ 语音状态条（voiceActive 显示阶段文案 + 打断/退出按钮）；LeftSidebar 面板切换 + 列表渲染 + 模式高亮（文本/实时/语音三按钮）+ 语音中 footer 标记；RightSidebar 指标；TitleBar 窗口控制 IPC |
| `test/renderer/backendStore.test.ts` | 半双工语音指令路由：`toggleVoice`（未激活→置 voice 模式 + `voice.start`；已激活→`voice.stop`）、`interruptVoice`（`voice.interrupt`）；停止回复：`abortReply`（发 `reply.abort`、状态栏“正在停止...”、不改 busy）；未连接（client 为 null）降级不抛异常 |

> 组件测试不渲染 `App` / `ReactorCanvas`（会挂载 canvas 动画，jsdom 无 2D 上下文），逐个渲染纯展示组件；后端 client 默认 null，组件不会真正发起 WS 连接。

### 测试实现要点（避免踩坑）

- **假子进程**：`backend.test.ts` 用 `EventEmitter` 冒充 `stdout/stderr/exit`，经 `spawnFn` 注入；`child_process.spawn` 被 mock 以拦截 Windows 下 `killChild` 的 `taskkill` 调用，测试不会真去杀进程。
- **假 WebSocket**：`ws.test.ts` 把 `globalThis.WebSocket` 换成假类（带 `OPEN`/`CONNECTING` 静态值），手动触发 `onopen/onmessage/onclose`。
- **超时用例**：先挂上 `expect(p).rejects` 断言（同步注册 handler）再 `advanceTimersByTimeAsync`，否则 reject 会被 Node 记为瞬时未处理拒绝。
- **假 Electron 通知**：`notify.test.ts` 用 `vi.hoisted` 造可变 `Notification` 假类 + `isSupported`，再 `vi.mock('electron')`，避免「初始化前访问」；dispatcher 测试在 node 环境用 `globalThis.window` 桩注入 `jarvisDesktop.notify` spy（afterEach 删除）。

## 5. 人工走查清单（实机验收）

自动化测试覆盖纯逻辑，以下端到端链路需在实机 `npm run dev` 后人工走查：

- [ ] **启动**：`npm run dev` 弹出无边框深蓝窗口，任务栏/托盘图标为 J.A.R.V.I.S 反应炉图案。
- [ ] **握手**：启动遮罩短暂显示「正在拉起 jarvis 后端...」后消失（说明 stdout 握手 JSON 解析成功、WS 已连）；`desktop.log` 有「后端就绪: ws_port=... pid=...」。
- [ ] **发消息**：输入框敲字 → Enter 发送 → 用户气泡立即上屏 → AI 气泡流式增量渲染（带闪烁光标）→ 结束后光标消失。
- [ ] **停止回复**：发送后按钮变“■ 停止”→ 回复进行中点击 → 流式中断、系统提示“已停止回复”、按钮恢复“发送”且可继续发新消息；回复中 Enter 不叠发。
- [ ] **工具卡片**：触发带工具的提问 → 中栏出现可折叠工具卡片（`…` → `✓`/`✗`），展开见入参与输出。
- [ ] **切模型**：左栏切到「模型」面板 → 列表可滚动 → 点非当前模型 → 提示「模型已切换为 X（下次对话生效）」→ 当前标记移动。
- [ ] **切音色 / 历史会话**：音色面板同上；历史面板点会话 → 回放历史消息 + 「已恢复会话「X」」。
- [ ] **右栏指标**：CPU/内存/磁盘每 ~2 秒刷新，CPU>85% 进度条变红。
- [ ] **实时语音**（如后端支持）：切「实时」模式 → 反应炉进入聆听/说话律动 → 状态栏文案随 `status` 事件变化。
- [ ] **半双工语音**（如后端配好 STT/TTS）：切「🎤 语音」模式 → 中栏出现语音状态条「聆听中...」 → 说话自动识别上屏用户气泡 → AI 回复流式上屏 + 本机扬声器 TTS 播报 → 自动回聆听（连续循环）；播报中点「✋ 打断」或直接开口 → 立即停播回聆听（双通道）；点「⏹ 退出语音」或说退下词 → 回文本模式；语音中切「实时」→ 自动停语音（互斥）。
- [ ] **托盘**：点关闭按钮 → 窗口隐藏到托盘（进程不退）；托盘菜单「显示」→ 窗口恢复；二次运行 `npm run dev` → 聚焦已有窗口（单实例锁）。
- [ ] **退出回收**：托盘菜单「退出」→ 窗口关闭 + **Python 进程被杀**（任务管理器确认无孤儿 `python -m agent.serve`；Windows 走 `taskkill /T` 杀进程树）。
- [ ] **主动播报**：`briefing_time` 临时改为 2 分钟后重启 `npm run dev` → 到点聊天区出现简报气泡 + Windows 系统通知；对话「1 分钟后提醒我喝水」→ 到点 ⏰ 气泡 + 通知；关闭窗口只剩托盘时通知仍弹（主进程 Notification 不依赖窗口）。详见 [`jarvis/docs/plans/proactive-desktop.md`](../../jarvis/docs/plans/proactive-desktop.md)。
- [ ] **降级路径**：故意把 `JARVIS_REPO` 指向不存在目录 → 弹窗提示「找不到 jarvis 仓库」+ 日志路径，遮罩显示诊断文案（不白屏、不悬挂）。

## 6. 二期路线图（本次不做）

- 主动播报 TTS 待机语音（`proactive_notify` 事件已带全文，届时桌面侧加语音通道即可，不改协议）。
- NSIS 安装包 + 代码签名（Windows 正式分发）。
- `electron-updater` 自动更新。
- 故障恢复 / 安全模式（后端崩溃自动重启 + 降级 UI）。
- PyInstaller 捆绑 Python 运行时，脱离本机环境依赖（真正免安装分发）。
- 实时语音模式深度接入、手机 Bridge 复用。
