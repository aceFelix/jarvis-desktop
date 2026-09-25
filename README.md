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
| `npm run test` | vitest 单测（170 用例：握手解析、生命周期状态机、图标解析、系统通知、WS 客户端、事件分发（含主动播报、半双工语音 `voice_*`、`assistant_done` 撤销 busy、init 七路刷新、briefing 任务中心联动）、store（含 `toggleVoice`/`interruptVoice`/`abortReply` 指令路由、`sendMessage` 附件 payload、右栏 schedule/cost/state 刷新映射、settings.get/set 接线（白名单全键回填/乐观更新/失败回滚/值未变不发指令）、settingsStore 主题（含复古、首启默认与非法值回退）/语言持久化与 backendSettings 镜像（含 parseBackendSettings 宽容解析）、i18n 查键）、glyphs 符号系统三主题映射、preload 契约、React 组件（含语音模式 UI、发送/停止双态按钮、📎 附件 chips 与气泡缩略图、AI 气泡复制按钮、输入栏 📸 截屏、右栏四区块、独立设置面板（含复古主题切换、glyph 联动与简报/截止日期/TTS 音量语速四组后端联动控件）与标题栏齿轮切换）） |

### CI

push / PR 到 `main` 时 GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）自动在 Node 20/22 双版本上执行：`npm ci`（跳过 Electron 二进制下载）→ `typecheck` → `test` → `build`，不依赖 Python 后端与真实 Electron 运行时。

## 消息附件（📎 / 粘贴）

输入栏 📎 按钮（多选）与输入框粘贴事件支持两类附件：

- **图片**（png/jpeg/webp/gif）：base64 后随 `message` 指令 `images` 字段上送，后端转
  `ImageContent` 走 vision 链路；用户气泡显缩略图；
- **文本文件**（.md/.txt/.py/.json 等）：读内容随 `files` 字段上送，后端拼进消息正文的
  「附带文件」代码块（超 2 万字符截断）。

上限（serve 入队校验快速失败，前端同口径提示）：单条 ≤8 张图片（base64 ≤10M 字符）、
≤5 个文件（单内容 ≤20 万字符）；待发送附件在输入栏上方以 chips 展示、可移除；
纯图片消息（空文本）也可发送。协议细节见 [docs/architecture.md](docs/architecture.md) 「消息附件」小节。

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

- **外观**：主题切换（深色/浅色/复古，**首启默认复古**；`<html data-theme>` + main.css 浅色覆盖块 + theme-retro.css 复古覆盖块；复古为 CRT 荧光绿终端像素风，配 glyph ASCII 符号与反应炉像素化）与界面语言
  （中文/English，轻量 i18n 字典），localStorage 持久化、重启保持（用户显式选择优先，无持久化/非法值时回退默认复古）；
- **语音播报**：主动播报待机 TTS 朗读开关 + 播报音量（0-100）/语速（0.5-2.0×）滑杆；
- **每日简报**：启用开关 + 简报时间（HH:MM）；
- **截止日期追踪**：启用开关 + 每日检查时间。

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
│   │   ├── glyphs.ts   # Glyph 符号系统（emoji ↔ 复古 ASCII 括号牌，随主题切换）
│   │   ├── components/ # 三栏组件 + 自绘标题栏 + 反应炉 canvas
│   │   ├── reactor.ts  # 反应炉动画（移植自 workbench reactor.js）
│   │   └── styles/     # main.css（深蓝玻璃拟态）+ theme-retro.css（复古 CRT 荧光绿皮肤）
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
