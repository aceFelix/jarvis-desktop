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
| `npm run test` | vitest 单测（122 用例：握手解析、生命周期状态机、图标解析、系统通知、WS 客户端、事件分发（含主动播报、半双工语音 `voice_*`、`assistant_done` 撤销 busy）、store（含 `toggleVoice`/`interruptVoice`/`abortReply` 指令路由）、preload 契约、React 组件（含语音模式 UI、发送/停止双态按钮）） |

### CI

push / PR 到 `main` 时 GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）自动在 Node 20/22 双版本上执行：`npm ci`（跳过 Electron 二进制下载）→ `typecheck` → `test` → `build`，不依赖 Python 后端与真实 Electron 运行时。

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
│   │   ├── stores/     # Zustand：chat/left/metrics/backend/reactorRef
│   │   ├── components/ # 三栏组件 + 自绘标题栏 + 反应炉 canvas
│   │   ├── reactor.ts  # 反应炉动画（移植自 workbench reactor.js）
│   │   └── styles/     # main.css（深蓝玻璃拟态视觉语言）
│   └── shared/        # contracts.ts：主/preload/渲染共享契约（镜像 protocol.py）
├── test/
│   ├── main/          # 主进程逻辑单测（node 环境）
│   ├── preload/       # preload 暴露面契约单测（notify 通道）
│   └── renderer/      # 渲染层单测 + React 组件测试（jsdom）
├── build/             # 打包资源（icon.ico 反应炉图标，scripts/gen_icon.py 生成）
├── scripts/           # gen_icon.py：复用 jarvis 反应炉绘制逻辑生成多尺寸 ico
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
