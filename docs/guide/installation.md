# 安装与运行

> [← 返回 README](../../README.md) · [对话体验](features-chat.md) · [语音与多端](features-voice.md) · [开发指南](../development.md)

---

## 前置条件

`jarvis-desktop` 与 [`jarvis`](../..) 是**上下游分离**的两个仓库（对齐 `dsh-desktop` / `deepseek-harness` 的关系）：

- **jarvis（上游，Python）**：Agent 运行时。`--serve` 模式启动一个 headless API 服务，复用与 pywebview 工作台完全相同的引擎零件（`ChatEngine` + `WorkbenchAPI` + `MetricsCollector`），经 WebSocket 对外提供指令/事件流。
- **jarvis-desktop（下游，Electron）**：桌面宿主。**不重写 Agent 运行时**，只负责：拉起并守护 `python -m agent.serve` 子进程、解析 stdout 握手 JSON、单实例、托盘、日志、系统通知（主动播报）、退出时回收 Python 进程树；UI 用 React 全新实现，但沿用 J.A.R.V.I.S 视觉语言。

按运行形态分两种：

- **dev 模式（开发者本机跑）**：桌面壳依赖本机 `jarvis` 源码仓库与 Python 环境（不捆绑 Python），跑 `python -m agent.serve`。
- **分发形态（发给终端用户）**：随 Windows 安装包分发，用户**无需安装 Python**，下载双击即用。

dev 模式依赖：

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

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `JARVIS_PYTHON` | `python` | 拉起 `agent.serve` 用的 Python 解释器（dev 态） |
| `JARVIS_REPO` | `../jarvis`（相对本仓库） | jarvis 源码仓库路径（dev 态） |
| `JARVIS_SERVE_EXE` | （未设） | 显式指定冻结后端 exe；优先级高于打包内置 exe，供自测/特殊部署 |

主进程 `backend.ts::resolveLaunchPlan` 的决策优先级为：`JARVIS_SERVE_EXE` 显式 exe → 打包内置 `resources/jarvis-serve/jarvis-serve.exe` → dev `python -m agent.serve`。

示例（指定 venv 与非同级仓库）：

```powershell
$env:JARVIS_PYTHON="E:\2.MyProjects\MyAgentChat\J.A.R.V.I.S\jarvis\.venv\Scripts\python.exe"
$env:JARVIS_REPO="E:\2.MyProjects\MyAgentChat\J.A.R.V.I.S\jarvis"
npm run dev
```

> 后端启动失败时，主进程弹窗会给出诊断，并指向日志 `userData/logs/desktop.log`
> （Windows: `%APPDATA%/jarvis-desktop/logs/desktop.log`）。serve 子进程的 stderr 也会转储到该日志。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | electron-vite 开发模式（热重载 + 拉起后端） |
| `npm run build` | 打包主进程 / preload / 渲染进程到 `out/` |
| `npm run typecheck` | tsc 类型检查（node + web 两套程序） |
| `npm run test` | vitest 单测（227 用例，覆盖握手解析、生命周期状态机、图标解析、系统通知、WS 客户端、事件分发、各 Zustand store、ThemedSelect / ThemedTimePicker / FontPicker、React 组件等，明细见 [开发指南](../development.md)） |

## CI

- **验证流水线**（[.github/workflows/ci.yml](../../.github/workflows/ci.yml)）：push / PR 到 `main` 时在 Node 20/22 双版本执行 `npm ci`（跳过 Electron 二进制下载）→ `typecheck` → `test` → `build`，不依赖 Python 后端与真实 Electron 运行时。
