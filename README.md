# jarvis-desktop

> J.A.R.V.I.S 桌面壳（Electron + React）—— 拉起 [`jarvis`](../jarvis) 的 `--serve` 后端，提供桌面宿主能力与全新 React UI。

[![CI](https://github.com/aceFelix/jarvis-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/aceFelix/jarvis-desktop/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue)]()

## 定位

`jarvis-desktop` 与 `jarvis` 是**上下游分离**的两个仓库（对齐 `dsh-desktop` / `deepseek-harness` 的关系）：

- **jarvis（上游，Python）**：Agent 运行时。`--serve` 模式启动一个 headless API 服务，复用与 pywebview 工作台完全相同的引擎零件（`ChatEngine` + `WorkbenchAPI` + `MetricsCollector`），经 WebSocket 对外提供指令/事件流。
- **jarvis-desktop（下游，Electron）**：桌面宿主。**不重写 Agent 运行时**，只负责：拉起并守护 `python -m agent.serve` 子进程、解析 stdout 握手 JSON、单实例、托盘、日志、系统通知（主动播报）、退出时回收 Python 进程树；UI 用 React 全新实现，但沿用 J.A.R.V.I.S 视觉语言。

```
jarvis（Python）                         jarvis-desktop（Electron）
┌──────────────────────────┐            ┌──────────────────────────────┐
│ python -m agent.serve     │  spawn     │ Main: BackendManager 生命周期 │
│   ChatEngine（工作台同款） │◄───────────│ 解析 stdout 握手 JSON         │
│   DesktopBridgeServer     │ 127.0.0.1  │ Preload: token/port 经 IPC    │
│   HTTP + WS（token 认证）  │◄───────────│ Renderer: React 三栏 UI       │
└──────────────────────────┘  WS 事件流   └──────────────────────────────┘
```

## 前置条件

一期为 **dev 模式**：桌面壳依赖本机 `jarvis` 源码仓库与 Python 环境（不捆绑 Python）。

1. **jarvis 仓库**：默认位于本仓库同级 `../jarvis`，或用环境变量 `JARVIS_REPO` 指定。
2. **Python 环境**：`jarvis` 的运行环境（`websockets` 已为其核心依赖，随安装自动就绪）。默认用 `python`，或用 `JARVIS_PYTHON` 指定解释器（如 venv 内的绝对路径）。
3. **Node.js**：≥ 18（推荐 20+），用于构建与运行 Electron。

## 运行

```powershell
# 1. 安装依赖（首次）
npm install

# 2. 启动开发模式（拉起 Electron 壳 + Python 后端）
npm run dev
```

> **Electron 二进制下载失败？** `npm install` 会从网络下载 Electron 运行时二进制。若因证书/代理报
> `unable to verify the first certificate`，可临时设置国内镜像后重装：
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; npm install
> ```
> 仅需类型检查 / 单测 / 打包（不实际启动窗口）时，可跳过该下载：
> ```powershell
> $env:ELECTRON_SKIP_BINARY_DOWNLOAD=1; npm install
> ```
> 但跳过之后 `npm run dev` 无法启动窗口，正式使用前仍需补下载 Electron 二进制。

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `JARVIS_PYTHON` | `python` | 拉起 `agent.serve` 用的 Python 解释器 |
| `JARVIS_REPO` | `../jarvis`（相对本仓库） | jarvis 源码仓库路径 |

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | electron-vite 开发模式（热重载 + 拉起后端） |
| `npm run build` | 打包主进程 / preload / 渲染进程到 `out/` |
| `npm run typecheck` | tsc 类型检查（node + web 两套程序） |
| `npm run test` | vitest 单测（227 用例：握手解析、生命周期状态机、图标解析、系统通知、WS 客户端、事件分发（含主动播报、半双工语音 `voice_*`、`assistant_done` 撤销 busy、init 七路刷新、briefing 任务中心联动）、store（含 `toggleVoice`/`interruptVoice`/`abortReply` 指令路由、`sendMessage` 附件 payload、右栏 schedule/cost/state 刷新映射、settings.get/set 接线（白名单全键回填/乐观更新/失败回滚/值未变不发指令）、`addModel` 添加模型（`models.add` 带表单参数、成功刷模型列表、回执失败回 false）、`editModel`/`removeModel` 模型改配与删除、settingsStore 主题（含复古、首启默认与非法值回退）/语言持久化与 backendSettings 镜像（含 parseBackendSettings 宽容解析）、i18n 查键）、glyphs 符号系统三主题映射、preload 契约、React 组件（含语音模式 UI、发送/停止双态按钮、📎 附件 chips 与气泡缩略图、AI 气泡复制按钮、输入栏 📸 截屏、中栏降噪折叠（思考块流式中展开/结束后自动收起、连续工具调用聚合成一条框（执行中展开显在跑的工具、全部完成后自动收起、失败标红计数）、单条工具不包组、中间夹提示切组、历史汇总卡不并组、手点展开不被抢回）、右栏四区块、独立设置面板（含复古主题切换、glyph 联动与简报/截止日期/TTS 音量语速四组后端联动控件）、左栏「＋ 添加模型」表单流（字段默认值 / 空名本地校验 / 自绘主题化下拉 ThemedSelect 的展开-选值-键盘-外点关闭 / models.add 提交后刷列表并回列表 / 回执失败保持表单打开）、左栏模型配置修改与删除（双击预填 / 内置名锁定 / Key 留空保持 / 右键删除）与标题栏齿轮切换）） |

### CI

push / PR 到 `main` 时 GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）自动在 Node 20/22 双版本上执行：`npm ci`（跳过 Electron 二进制下载）→ `typecheck` → `test` → `build`，不依赖 Python 后端与真实 Electron 运行时。

## 对话区降噪（思考 / 工具折叠）

思考模型（qwen3.x 等）的思考常有上千字，一轮任务又常连跑十几个工具，全部展开会把一屏撑满。
2026-09 起中栏按「**进行中可见、完成后收起**」口径渲染（纯渲染层，不动协议与后端）：

- **思考块**：思考流式期间自动展开实时可见，本轮回复结束（`assistant_done` →
  `finishAssistant`）自动收起成一行「思考过程 · N 字」；点开看全文，正文限高 240px
  内部滚动，超长思考不再撑爆气泡；
- **工具组**：连续的 `tool_use` 聚合为一条 `⛭ 工具调用 ×N` 框（不再「一个工具一个框」）。
  执行中自动展开、标题实时显示在跑的工具（「执行中：Bash」）；全部完成后自动收起成一行 ✓；
  有失败时**仍收起**但标题标红「✗N 失败」、边框同步变红（扫一眼即知，点开可见是哪条）；
  展开后仍是组内每条原工具卡（可再单独展开看入参/输出，两级折叠）；
- **分组边界**：只在**连续**工具项之间聚合——中间夹了 AI 文本或系统提示就切组；单条工具不包组
  （直接渲染原卡片，少一层点击）；历史回放的「历史工具调用 ×N」汇总卡（`toolId` 为空）不并入组；
- **手点优先**：受控 `<details>` + `onToggle` 把用户操作同步回 state——自动收起只在「本轮结束 /
  全部完成」那一刻发生一次，不会把你手动展开的块抢回去。

实现在 [src/renderer/src/components/ChatArea.tsx](src/renderer/src/components/ChatArea.tsx) 的
`ThinkingBlock` / `ToolGroup` / `groupMessages`（样式在 main.css + 三张皮肤同口径）。

## 消息附件（📎 / 粘贴）

输入栏 📎 按钮（多选）与输入框粘贴事件支持两类附件：

- **图片**（png/jpeg/webp/gif）：base64 后随 `message` 指令 `images` 字段上送，后端转
  `ImageContent` 走 vision 链路；用户气泡显缩略图；
- **文本文件**（.md/.txt/.py/.json 等）：读内容随 `files` 字段上送，后端拼进消息正文的
  「附带文件」代码块（超 2 万字符截断）。

上限（serve 入队校验快速失败，前端同口径提示）：单条 ≤8 张图片（base64 ≤10M 字符）、
≤5 个文件（单内容 ≤20 万字符）；待发送附件在输入栏上方以 chips 展示、可移除；
纯图片消息（空文本）也可发送。协议细节见 [docs/architecture.md](docs/architecture.md) 「消息附件」小节。

## 左栏模型面板（切换 / 添加 / 修改 / 删除）

左栏「模型」面板列表可滚动、点非当前项即切模型（`models.select`）；**双击**某项进入该模型的
配置编辑表单、**右键**某项项内出现删除按钮（交互对齐会话列表，详见下文）；列表末项固定为
「＋ 添加模型」（虚线边框区分）：

- 点击末项 → 以独立组件 `ModelForm.tsx` **整体替换**模型列表（与右栏 `SettingsPanel` 替换
  信息面板同一模式，瞬态不持久化），顶部 ← 或「取消」回列表；
- 六个字段与 REPL `/models` → 添加其他模型完全同口径：模型厂商（11 项）、模型名（必填）、
  API Key（password，留空=用全局 Key）、接口类型（openai/anthropic/dashscope/zai）、
  Base URL（留空按厂商推断）、模型类型（text/multimodal）；
- 三个下拉（模型厂商 / 接口类型 / 模型类型）走**自绘组件** `ThemedSelect.tsx`：原生 `<select>`
  展开后的列表由系统绘制（固定深灰底 + 系统蓝高亮 + 系统圆角，CSS 管不到、不随皮肤，
  还会盖住表单标签），自绘后浮层挂到 body、随三主题配色（荧光绿亮绿 / 电光蓝亮青 /
  金属银灰底黑字反相高亮，硬边方角与皮肤同族），支持 ↑↓ / Home / End / Enter / Esc
  与点击触发器或浮层之外关闭；
- 提交走 `models.add` 指令：serve 侧二次校验（模型名必填、接口类型/模型类型白名单）→ 写用户级
  `~/.jarvis/models.toml` 的 `[llm.custom_models."<name>"]`（API Key 同步系统 keyring）→ 成功后
  壳自动刷 `models.list` 并提示「模型「X」已添加」，表单关闭回列表；失败（校验/落盘）保持表单
  打开可修正，错误文案走聊天流统一出口。
- 模型项交互对齐会话列表（2026-09）：**双击**某模型 → 进入同一 `ModelForm` 的**编辑模式**
  （预填 `models.list` 该项 `config`：厂商/接口类型/Base URL/模型类型，模型名可改、API Key 恒空），
  提交走 `models.edit`；**右键**某模型 → 项内出现删除按钮，**再点才真删**（`models.remove`，
  二次确认），右键空白处或切换面板收起。删除按钮只对自定义模型渲染（内置模型后端拒绝删除）；
- 编辑模式的三个口径（与添加模式刻意不同）：**内置模型名锁定**（它来自项目级 `[llm.models]`，
  改名只会产生「幽灵模型」，输入框禁用）；**API Key 留空 = 保持原 Key**（桌面壳不回显密钥，
  不能把「未填」当清空 —— REPL 是预填明文、留空即清空）；**改的是当前运行模型时强制重建
  provider**（回执 `hot_switched`，提示「配置已更新，当前会话已按新配置重连」），端点/接口
  类型改动立即生效，其余情况只提示「配置已更新」；
- 删除语义：仅用户级 `~/.jarvis/models.toml` 的 `[llm.custom_models."<name>"]` 段真的存在时才删
  （内置模型、磁盘无该段均回 `ok=false`，防「删掉又复活」）；删的是当前模型时**不动运行中的
  provider**（不打断正在跑的回复）并提示「当前会话仍在用它，建议另选一个模型」。
- 切模型/切音色为**幂等点选**：`models.select` 写用户级配置（`last_model`，重启仍恢复）**并**在引擎线程里热切换运行中的 provider / QueryLoop（2026-09 起，见 jarvis `docs/fixlogs/model-hot-switch.md`）——落地后引擎推 `model_switched`，壳据此刷 `models.list` / 成本 / 状态，「· 当前」**立刻**移到新模型；写盘回执后到事件到达前，壳在 `leftStore` 记 `pendingModel` / `pendingVoice`：已点选项副行显「· 待生效」（虚线框）并禁用点选与悬停（`.noop`），
  再点同一项**不发指令、不弹提示**（否则看不出选中状态就会反复点、每点一次弹一条「已切换」）；
  成功提示由引擎的 `info` 事件上屏（壳不再本地弹，避免双气泡）。
  `set_model` 返回 false（写盘失败）时不记待生效，改提示「✗ 模型切换失败（未能写入用户级配置）：X」，
  不报假成功；引擎构造 provider 失败时只推 `warn`、不推 `model_switched`，壳保留「待生效」标记供重试。
- 切**音色**仍是「下次语音会话生效」（实时/半双工语音在会话内绑定音色）：壳照旧记
  `pendingVoice`，`voices.list` 的 `current` 不随点选移动。

协议细节与字段口径见 [docs/architecture.md](docs/architecture.md) 「左栏模型面板（切换 / 添加 / 修改 / 删除）」小节。

## 全双工语音通路（/talk，2026-09-28）

🎙 实时语音模式为**真全双工**（可对着 AI 说话打断），音频 I/O 不在 Python 侧，而在渲染进程：

- **上行** `src/renderer/src/audio/talkCapture.ts`：`getUserMedia({echoCancellation:true})` 浏览器系统级
  AEC（消除 AI 外放回采，服务端不再被回声误触发）+ AudioWorklet（Blob URL 注册）整数比抽取重采样到
  16kHz PCM16，~100ms/帧经 `talk.audio` 指令（fire-and-forget 无回执）直喂服务端 `RealtimeEngine`（`BridgeMic`）。
- **下行** `src/renderer/src/audio/talkPlayback.ts`：订阅 `talk_audio` 事件（24kHz PCM 帧 base64），
  AudioContext `nextTime` 顺序排播免咔哒；空串 payload = 打断 flush（立即清空待播帧）。
- **开关**：`backendStore.toggleTalk` 先乐观置模式→启动采集（失败回退并报错）→`talk.start {duplex:true}`；
  服务端据此以全双工桥接模式启动（音频走 WS 帧而非本机 pyaudio，关闭半双工静音与软件回声抑制）。
- 未授权/无麦克风时采集启动失败，模式自动回退文本态并上屏报错。

## 右栏面板（四区块）与设置面板

右栏信息面板自上而下四个区块，任务/用量/健康数据经 `schedule.list` / `cost.get` / `state.get`
指令与 `proactive_notify` 事件从 serve 侧拉取：

- **任务中心**：待触发提醒（⏰ + 时间 + 重复标签）与活跃截止日期（倒计时，临期标黄、
  逾期标红），以及最近一条每日简报（折叠块）；
- **会话与用量**：当前模型、token 累计（输入/输出/缓存）与对话轮数/消息条数，口径同
  REPL `/cost`；
- **系统状态**：CPU / 内存 / 磁盘三指标卡（每 2 秒推送，CPU>85% 进度条变红）；
- **运行健康**：MCP 连接快照（成功/失败名单 + 工具数）与运行日志流（滚动 30 条）。

**设置面板（独立组件）**：点标题栏齿轮 ⚙ 进入，`SettingsPanel` 整体替换右栏信息面板
（再点齿轮或面板内 ← 返回）：

- **外观**：主题切换（荧光绿/电光蓝/金属银，三主题同风格（Y2K 像素复古）仅配色不同，
  **荧光绿排第一且首启默认**；`<html data-theme>` + 三张皮肤覆盖块：
  theme-retro.css / theme-dark-y2k.css / theme-light-y2k.css；荧光绿=CRT 荧光绿终端、
  电光蓝=深蓝底电光蓝霓虹、金属银=铬银金属亮色，三者均配 glyph ASCII 括号牌符号与反应炉像素化）与界面语言
  （中文/English，轻量 i18n 字典），localStorage 持久化、重启保持（用户显式选择优先，无持久化/非法值时回退默认荧光绿）；
  文本选中高亮（含改名输入框全选）同样随主题：荧光绿亮绿反相 / 电光蓝亮青反相 / 金属银黑底白字，不再出现浏览器默认蓝底；
- **语音播报**：主动播报待机 TTS 朗读开关 + 播报音量（0-100）/语速（0.5-2.0×）滑杆；
- **每日简报**：启用开关 + 简报时间（HH:MM，自绘时间选择器：小时/分钟两个下拉点选）；
- **截止日期追踪**：启用开关 + 每日检查时间（同自绘时间选择器）。

  以上三组与 serve 后端联动（真源在 jarvis settings.toml 白名单，`settings.get` 回填、
  `settings.set` 写回：外科式落盘 + 运行时生效，简报/截止日期改动额外触发调度热重注册；
  乐观更新 + 失败回滚，未连接时对应行显离线态）。

原「快捷操作」区块已拆解：📸 截屏入口迁入输入栏（📎 旁，截图入附件区随消息走 vision）；
📋 复制改为 AI 气泡右下角的消息级「复制」按钮（流式结束后出现）；＋新会话沿用左栏
「新建会话」，■停止回复沿用输入栏发送/停止双态按钮。语言切换 v1 覆盖静态界面文案，
运行时状态文本与后端事件消息保持中文。

架构与刷新时机见 [docs/architecture.md](docs/architecture.md) 「右栏四区块」与「设置面板」小节。

## 目录结构

```
jarvis-desktop/
├── src/
│   ├── main/          # Electron 主进程（TS）
│   │   ├── index.ts    # 应用生命周期、单实例、窗口、IPC
│   │   ├── backend.ts  # BackendManager：spawn/握手/回收 serve 子进程
│   │   ├── appIcon.ts  # 图标解析单一来源（窗口/托盘同源，防分叉）
│   │   ├── notify.ts   # 系统通知（主动播报经主进程弹原生通知 + 任务栏闪烁）
│   │   ├── tray.ts     # 系统托盘
│   │   └── logging.ts  # 写 userData/logs/desktop.log
│   ├── preload/       # contextBridge 最小暴露面（token 不落盘）
│   ├── renderer/src/  # React 渲染进程
│   │   ├── api/        # ws.ts（WS 客户端）/ dispatcher.ts（事件→store）
│   │   ├── stores/     # Zustand：chat/left/metrics/backend/right/attach/settings/ui/reactorRef
│   │   ├── i18n.ts     # 轻量中英文案字典（useT/translate，静态界面文案双语）
│   │   ├── glyphs.ts   # Glyph 符号系统（荧光绿方括号牌 / 电光蓝尖括号牌 / 金属银花括号牌，随主题切换）
│   │   ├── components/ # 三栏组件 + 自绘标题栏 + 反应炉 canvas + ModelForm（模型添加/修改表单）+ ThemedSelect（自绘下拉）+ ThemedTimePicker（自绘时间选择器）
│   │   ├── reactor.ts  # 反应炉动画（移植自 workbench reactor.js）
│   │   └── styles/     # main.css（基础）+ controls.css（表单控件层：输入框/自绘下拉/自绘时间选择器/改名输入框）+ theme-retro.css（荧光绿 CRT 皮肤）+ theme-dark-y2k.css（电光蓝 Y2K 像素皮肤）+ theme-light-y2k.css（金属银 Y2K 像素皮肤）
│   └── shared/        # contracts.ts：主/preload/渲染共享契约（镜像 protocol.py）
├── test/
│   ├── main/          # 主进程逻辑单测（node 环境）
│   ├── preload/       # preload 暴露面契约单测（notify 通道）
│   └── renderer/      # 渲染层单测 + React 组件测试（jsdom）
├── build/             # 打包资源（icon.ico 复古荧光绿像素反应炉图标，scripts/gen_icon.py 自绘生成）
├── scripts/           # gen_icon.py：自绘复古像素反应炉生成多尺寸 ico
└── docs/              # architecture.md / development.md
```

## 文档

- [docs/architecture.md](docs/architecture.md)：运行时拓扑、启动流程、持久化数据、安全边界、协议契约。
- [docs/development.md](docs/development.md)：本地环境、env 变量、测试、人工走查清单、二期路线图。

## 一期边界

- dev 模式依赖本机 jarvis 源码仓库，**不捆绑 Python 运行时**（PyInstaller 打包为二期目标）。
- 现有 pywebview 工作台（`jarvis --gui`）保留不动，与桌面壳并存：`--gui` 走工作台，`--serve` 走桌面壳。
- 本仓库已推送 GitHub（`origin/main`，https://github.com/aceFelix/jarvis-desktop ），CI 随 push/PR 自动运行。

## License

MIT © aceFelix
