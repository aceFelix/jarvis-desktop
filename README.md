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

分两种形态：

- **dev 模式（开发者本机跑）**：桌面壳依赖本机 `jarvis` 源码仓库与 Python 环境（不捆绑 Python），跑 `python -m agent.serve`。
- **打包态（发给终端用户）**：后端经 PyInstaller 冻结成 `jarvis-serve.exe` 随安装包分发，用户**无需安装 Python**，下载双击即用。见下文「打包发布」。

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

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `JARVIS_PYTHON` | `python` | 拉起 `agent.serve` 用的 Python 解释器（dev 态） |
| `JARVIS_REPO` | `../jarvis`（相对本仓库） | jarvis 源码仓库路径（dev 态） |
| `JARVIS_SERVE_EXE` | （未设） | 显式指定冻结后端 exe；优先级高于打包内置 exe，供自测/特殊部署 |

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | electron-vite 开发模式（热重载 + 拉起后端） |
| `npm run build` | 打包主进程 / preload / 渲染进程到 `out/` |
| `npm run serve:build` | 调 jarvis 仓 `packaging/build_serve.ps1`，用 PyInstaller 冻结后端到 `../jarvis/dist/jarvis-serve/` |
| `npm run dist` | 一键发布：`build` → `serve:build`（重冻结）→ `electron-builder --win` 出 NSIS 安装包到 `dist/` |
| `npm run dist:fast` | 同上但跳过重冻结，复用已有 `jarvis-serve/`（只改壳时快很多） |
| `npm run typecheck` | tsc 类型检查（node + web 两套程序） |
| `npm run test` | vitest 单测（227 用例：握手解析、生命周期状态机、图标解析、系统通知、WS 客户端、事件分发（含主动播报、半双工语音 `voice_*`、`assistant_done` 撤销 busy、init 七路刷新、briefing 任务中心联动）、store（含 `toggleVoice`/`interruptVoice`/`abortReply` 指令路由、`sendMessage` 附件 payload、右栏 schedule/cost/state 刷新映射、settings.get/set 接线（白名单全键回填/乐观更新/失败回滚/值未变不发指令）、`addModel` 添加模型（`models.add` 带表单参数、成功刷模型列表、回执失败回 false）、`editModel`/`removeModel` 模型改配与删除、settingsStore 主题（含复古、首启默认与非法值回退）/语言持久化与 backendSettings 镜像（含 parseBackendSettings 宽容解析）、i18n 查键）、glyphs 符号系统三主题映射、preload 契约、React 组件（含语音模式 UI、发送/停止双态按钮、📎 附件 chips 与气泡缩略图、AI 气泡复制按钮、输入栏 📸 截屏、中栏降噪折叠（思考块流式中展开/结束后自动收起、连续工具调用聚合成一条框（执行中展开显在跑的工具、全部完成后自动收起、失败标红计数）、单条工具不包组、中间夹提示切组、历史汇总卡不并组、手点展开不被抢回）、右栏四区块、独立设置面板（含复古主题切换、glyph 联动与简报/截止日期/TTS 音量语速四组后端联动控件）、左栏「＋ 添加模型」表单流（字段默认值 / 空名本地校验 / 自绘主题化下拉 ThemedSelect 的展开-选值-键盘-外点关闭 / models.add 提交后刷列表并回列表 / 回执失败保持表单打开）、左栏模型配置修改与删除（双击预填 / 内置名锁定 / Key 留空保持 / 右键删除）与标题栏齿轮切换）） |

### CI

- **验证流水线**（[.github/workflows/ci.yml](.github/workflows/ci.yml)）：push / PR 到 `main` 时在 Node 20/22 双版本执行 `npm ci`（跳过 Electron 二进制下载）→ `typecheck` → `test` → `build`，不依赖 Python 后端与真实 Electron 运行时。
- **发布流水线**（[.github/workflows/release.yml](.github/workflows/release.yml)）：见下文「打包发布 → CI 自动发布」，在 `windows-latest` 上出 NSIS 安装包并挂到 GitHub Releases。

## 打包发布（Windows NSIS 安装包）

目标：产出一个**下载双击即装、无需 Python** 的安装包。核心难点是把 Python 后端
（`jarvis serve`）随包分发——采用 **PyInstaller 将 `agent.serve` 冻结成独立
`jarvis-serve.exe`**，经 electron-builder 的 `extraResources` 放入安装包。

### 流程

```powershell
# 在 jarvis-desktop 目录，一键出安装包（先冻结后端再打包）
# 国内网络需先设 Electron / electron-builder 二进制镜像：
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

串联三步：`npm run build`（electron-vite → `out/`）→ `npm run serve:build`（调
`../jarvis/packaging/build_serve.ps1` 用 PyInstaller 冻结到 `../jarvis/dist/jarvis-serve/`）
→ `electron-builder --win`（NSIS，产物在 `jarvis-desktop/dist/`）。

### 前置

- jarvis 的 `.venv` 已 `pip install -e .`（`websockets` 为核心依赖，自动就绪）；
- 构建机装 `PyInstaller`（`build_serve.ps1` 未装时会即时 `pip install`；它是构建期工具，**不进运行时依赖**）。

### 产物

- `dist/JARVIS Desktop-Setup-<version>.exe`：NSIS 安装程序（用户用）。
- `dist/win-unpacked/`：免安装绿色目录（含 `resources/jarvis-serve/jarvis-serve.exe`，调试集成用）。

### CI 自动发布（GitHub Releases）

本机出包会受 `winCodeSign` 符号链接权限限制（见下「已知环境注意事项」），**发布统一交给 GitHub
Actions**（[.github/workflows/release.yml](.github/workflows/release.yml)）在 `windows-latest`
上完成——该 runner 自带所需权限，且顺带解决「上传」诉求。

工作流会**并列检出** `jarvis-desktop`（本仓库）与 `jarvis`（后端仓库，默认 `master`），装好
Node 20 与 Python 3.12（`pip install -e .` + `pyinstaller`），执行 `npm run dist` 产出安装包，
再用 `softprops/action-gh-release` 把 `*-Setup-*.exe` 挂到对应 tag 的 Release。

触发方式（二选一）：

```powershell
# ① 推荐：打 tag 推送即自动出包并发布（版本号取自 tag）
git tag v0.1.0 ; git push origin v0.1.0
```

② 或在 Actions 页手动 **Run workflow**（`workflow_dispatch`），可临时指定发布 tag 名与 `jarvis`
检出的分支/tag。

> 若 `jarvis` 后端仓库为**私有**：跨仓库检出需要一个能读 `aceFelix/jarvis` 的 PAT，存为仓库 Secret
> `JARVIS_REPO_TOKEN`，并把 workflow 中 jarvis checkout 步骤的 `token` 指向它（文件内已注明）。

### 运行时分发机制

- 打包态（`app.isPackaged`）：`backend.ts::resolveLaunchPlan` 选择 `resources/jarvis-serve/jarvis-serve.exe`作为后端；
- dev 态：回退本机 `python -m agent.serve`（`JARVIS_REPO`/`JARVIS_PYTHON`）。
- 基础包不含重型可选 extras（playwright/cv2/mediapipe/paddleocr），对应截屏/浏览器/视觉工具运行时
  懒加载失败即优雅降级；文本对话、文件、命令、MCP 等核心能力不受影响。

### 已知环境注意事项

- **未签名 SmartScreen**：安装包无代码签名，首次运行会弹「未知发布者」，点「更多信息→仍要运行」即可。
- **winCodeSign 符号链接权限**：electron-builder 在 Windows 上拉取 `winCodeSign` 依赖包时需解压
  包内的 macOS `.dylib` 符号链接，普通账户缺 `SeCreateSymbolicLinkPrivilege`会报
  「客户端没有所需的特权」。解决任选其一：① 开启 **Windows 开发者模式**（设置→隐私和安全性→开发者
  其他选项→开发人员模式）；② **以管理员身份**运行构建；③ 在 **CI（GitHub Actions windows-latest）**
  上构建（自带所需权限，适合发布）。（`win-unpacked/` 不依赖 winCodeSign，可在普通账户下产出。）
- **杀毒/Defender 误报**：未签名且新建的大体积 exe 易被实时扫描短暂锁定；若打包在 `addWinAsarIntegrity`
  报 `UNKNOWN`，已将 `asar: false` 避开该回写（详见 development.md）。

## 对话区降噪（思考 / 工具 / 系统提示折叠）

思考模型（qwen3.x 等）的思考常有上千字，一轮任务又常连跑十几个工具，全部展开会把一屏撑满。
2026-09 起中栏按「**进行中可见、完成后收起**」口径渲染（纯渲染层，不动协议与后端）：

- **思考块**：思考流式期间自动展开实时可见，本轮回复结束（`assistant_done` →
  `finishAssistant`）自动收起成一行「思考过程 · N 字」；点开看全文，正文限高 240px
  内部滚动，超长思考不再撑爆气泡；
- **工具组**：连续的 `tool_use` 聚合为一条 `⛭ 工具调用 ×N` 框（不再「一个工具一个框」）。
  执行中自动展开、标题实时显示在跑的工具（「执行中：Bash」）；全部完成后自动收起成一行 ✓；
  有失败时**仍收起**但标题标红「✗N 失败」、边框同步变红（扫一眼即知，点开可见是哪条）；
  展开后仍是组内每条原工具卡（可再单独展开看入参/输出，两级折叠）；
- **系统提示折叠**（2026-10）：**多行**的系统 / 警告 / 错误提示（如工具失败重试的长 dump、
  「拒绝执行 Bash…」块）折叠为 `<details>`——首行做标题、点开看全文（正文限高 240px 内部
  滚动），不再一大块铺满聊天区；**单行**短提示（如「微信已断开」）保持原样直接渲染，避免
  小题大做多加一层点击；错误语气（`tone==='error'`）折叠后仍标红边框；
- **分组边界**：只在**连续**工具项之间聚合——中间夹了 AI 文本或系统提示就切组；单条工具不包组
  （直接渲染原卡片，少一层点击）；历史回放的「历史工具调用 ×N」汇总卡（`toolId` 为空）不并入组；
- **手点优先**：受控 `<details>` + `onToggle` 把用户操作同步回 state——自动收起只在「本轮结束 /
  全部完成」那一刻发生一次，不会把你手动展开的块抢回去。

实现在 [src/renderer/src/components/ChatArea.tsx](src/renderer/src/components/ChatArea.tsx) 的
`ThinkingBlock` / `ToolGroup` / `groupMessages` / `MessageView`（`system` 分支）（样式在 chat.css + 三张皮肤同口径，2026-10 由 main.css 拆出）。

## 消息附件（📎 / 粘贴）

输入栏 📎 按钮（多选）与输入框粘贴事件支持两类附件：

- **图片**（png/jpeg/webp/gif）：base64 后随 `message` 指令 `images` 字段上送，后端转
  `ImageContent` 走 vision 链路；用户气泡显缩略图；
- **文本文件**（.md/.txt/.py/.json 等）：读内容随 `files` 字段上送，后端拼进消息正文的
  「附带文件」代码块（超 2 万字符截断）。

上限（serve 入队校验快速失败，前端同口径提示）：单条 ≤8 张图片（base64 ≤10M 字符）、
≤5 个文件（单内容 ≤20 万字符）；待发送附件在输入栏上方以 chips 展示、可移除；
纯图片消息（空文本）也可发送。协议细节见 [docs/architecture.md](docs/architecture.md) 「消息附件」小节。

## 消息撤回（对话 + 文件回滚，2026-10）

发错一条消息？悬停用户气泡点「撤回」：

- 确认弹窗先展示该轮**工作区改动文件清单**（`checkpoint.preview` 预览，M/A/D + 新增未跟踪）；
- 勾选「同时回滚工作区文件」（默认勾）后确认，工作区恢复到该消息**发出前**的
  shadow git 检查点，对话同步截断（`checkpoint.rewind` → `rewound` 事件裁气泡）；
- 降级：后端未装 git / `[checkpoint] enabled=false` / 检查点被配额修剪时，复选框
  禁用、仅回退对话；文件回滚失败则整次撤回放弃（消息不丢，原子性由后端保证）。

机制与协议细节见 jarvis 侧 [docs/architecture/15-消息回溯与检查点.md](../jarvis/docs/architecture/15-消息回溯与检查点.md)。

## 斜杠命令透传与补全（`/` 前缀，2026-10）

输入框直接敲 `/` 开头的命令（无待发送附件时）不再当普通文本发给 LLM，而是走 `slash.exec`
指令透传引擎执行，结果以 `slash_result` 事件回推，渲染成命令输出卡片（summary=命令原文、
正文=终端捕获输出，可折叠展开）：

- **白名单放行**：`/context` `/compact` `/cost` `/c` `/diff` `/doctor` `/tools` `/mcp`
  `/skills` `/memory` `/plugin(s)` —— 一次改动把一大批终端能力带进桌面；桌面已有原生控件的
  （mode/think/model/sessions/rewind 等）不透传，防双入口口径漂移；
- **交互禁令**：命令试图弹交互选择器/询问时干净失败提示「请在终端 jarvis 中使用」（serve 的
  stdin 是协议管道，不能抢）；
- **技能动态放行**：白名单外命中已安装技能（`/<skill-name>`）照常执行，与对话轮次共用 query
  锁串行，busy 时可在输入栏点「■ 停止」中断。

输入框 `/` 前缀弹层补全（手感对齐终端 jarvis）：命令目录来自只读指令 `slash.commands`
（init 时拉取，口径与后端执行护栏对齐——补出来的每条命令必然可执行）：

- **前缀匹配**：输 `/c` 匹配所有 c 开头命令、输 `/` 展示全部；打空格即收起；
- **键盘手感**：↑↓ 循环高亮、Tab/Enter 选中回填「命令名 + 空格」（再按 Enter 发送；
  前缀已是完整命令名时 Enter 直通发送）、Esc 收起（重新编辑即恢复）；
- **实现**：`SlashAutocomplete.tsx`（弹层 + hook）+ `slashStore.ts`（目录缓存），复用
  ThemedSelect 皮肤类保持视觉一致。

护栏与补全实现见本仓 [docs/architecture.md](docs/architecture.md) 「斜杠命令透传与补全」小节与
 jarvis 侧 [docs/architecture/07-UI层.md](../jarvis/docs/architecture/07-UI层.md)。

## 输入栏（工作模式 + 思考强度）

输入栏分为**左侧 2×2 控制区（📎 附件 / 🗜 手动压缩上下文 + 工作模式 / 思考强度）、中间加高输入框、
右侧竖排按钮（发送 / 实时语音）**三段（不再把所有控件挤在一横排），输入框默认约三行高、
自增高上限 240px：

- **工作模式**：`default`（写需确认、危险拒绝）/ `plan`（只读规划）/ `accept_edits`（文件编辑
  自动放行）/ `yolo`（全自动，危险除外），切换发 `mode.set`；
- **思考强度**：统一四档 **关闭 / 低 / 中 / 高**（后端按厂商 `THINKING_CONFIGS` 翻译成
  `thinking_budget` / `reasoning_effort`）；当前厂商无干净思考开关时（如 MiniMax）选择器置灰；切换发 `think.set`；
- **生效时机**：两项均与模型热切换同口径（引擎队列串行，正回复时于该轮结束后落地），
  即**下一条消息生效**；busy/未连接时仍可切换。初值来自 `state.get`，存于单一职责的
  `runtimeStore`。设计与协议链路详见 jarvis 侧
  [docs/fixlogs/desktop-mode-thinking-controls.md](../jarvis/docs/fixlogs/desktop-mode-thinking-controls.md)。

## 左栏模型面板（切换 / 添加 / 修改 / 删除）

左栏「模型」面板列表可滚动、点非当前项即切模型（`models.select`）；**双击**某项进入该模型的
配置编辑表单、**右键**某项项内出现删除按钮（交互对齐会话列表，详见下文）；列表末项固定为
「＋ 添加模型」（虚线边框区分）：

- 点击末项 → 以独立组件 `ModelForm.tsx` **整体替换**模型列表（与右栏 `SettingsPanel` 替换
  信息面板同一模式，瞬态不持久化），顶部 ← 或「取消」回列表；
- 六个字段与 REPL `/models` → 添加其他模型完全同口径：模型厂商（11 项）、模型名（必填）、
  API Key（password，留空=用全局 Key）、接口类型（openai/anthropic/dashscope/zai）、
  Base URL（留空按厂商推断）、模型类型（text/multimodal）；
- **字段区可滚动**（`ModelForm` / `VoiceForm` 共用 `.form-scroll`）：窗口不高或字段较多时
  字段区自身出滚动条（往下滑即可填完），不会溢出面板与左栏底部的「项目」区叠在一起；
  报错行与「保存 / 取消」常驻在滚动区之外，滚到任意位置都能直接提交；
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
- 切**音色**为「立即写盘 + 下次语音会话生效」（实时/半双工语音在会话内绑定音色，不热切换运行中的
  语音会话）：`voices.select` 回执为 dict `{ok, name, voice_id, linked_model, old_model}`，与终端
  `/tts-voice` 同口径——音色-模型不兼容时后端自动联动 `tts_model`，壳按 `result.ok` 判定并把
  `linked_model` 进提示（「联动 TTS 模型 X，下次语音生效」）；壳照旧记 `pendingVoice`，
  `voices.list` 的 `current` 不随点选移动。
- 音色面板（2026-09-28，音色-模型适配接入）：`voices.list` 返回**全量音色目录**（内置+自定义，
  当前置顶），副行透出「适配 X」/「联动 X」预告；交互范式对齐模型面板 —— 末项「＋ 添加音色」
  进 `VoiceForm` 表单（音色名/DashScope 音色 ID/适配模型下拉/描述，提交 `voices.add`）、**双击**自定义项
  进表单预填编辑（音色名锁定，同名 upsert 覆盖）、**右键**自定义项 → 项内删除按钮再点真删
  （`voices.delete`，内置音色不渲染删除、后端也会拒绝）；本地校验（音色名/voice_id 必填）错误
  就地显红字，后端拒绝走聊天流统一出口。

协议细节与字段口径见 [docs/architecture.md](docs/architecture.md) 「左栏模型面板（切换 / 添加 / 修改 / 删除）」小节。

## 项目 ↔ 会话关联（左栏历史会话高亮）

左栏底部选定当前项目（工作区）后，**历史会话列表按项目归属区分标记**（2026-10，纯渲染层）：

- **当前聊天**：仍为 `.current` 填充态（半透背景 + 描边），优先级最高；
- **属于当前项目的其它会话**：标 `.in-project`——只亮**描边框**、不填充（各皮肤用自身高亮色，
  复古 CRT 皮肤下即绿色方框），一眼看出哪些会话在当前项目下；
- **其它项目的会话**：普通态，两者皆无。

判定口径：会话项 `workdir`（后端 `sessions.list` 已逐条回填）与当前项目 `currentProject.workdir`
经 `normWorkdir`（去尾部路径分隔符 + 小写，Windows 路径大小写不敏感）比较相等即为同项目；
`current` 优先于 `in-project`（当前聊天不重复标框）。无后端改动，实现在
[src/renderer/src/components/LeftSidebar.tsx](src/renderer/src/components/LeftSidebar.tsx) 的
`SessionItem`（`inProject` prop）+ `normWorkdir`（样式在 main.css + 三张皮肤同口径）。

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

## 跨设备协同（手机 / 微信，2026-10）

把终端 jarvis 的 `/connect-phone`（手机 PWA）与 `/connect-wechat`（微信 ClawBot）接入桌面：

- **入口**：输入栏原 `[LIV]` 实时语音按钮（左栏已有 `[LIV]`，此处冗余）换成**跨设备协同
  下拉按钮**（`RemoteConnectMenu`，glyph `[LNK]`）——点开选「手机 / 微信」发起连接，已连接则显
  「断开」，按钮右上角徽标计已连接通道数。
- **二维码内联**：连接后 `qrcode` 事件（`{channel,url,fresh?}`）驱动在**中间聊天区**内联一条
  `QrcodeCard`（`qrcode` npm 把 url 画成图，非浮层）。手机 / 微信两通道一致——**扫上即连**
  （微信配对码为服务端偶发兜底，桌面不再内联输入）。二维码前景/背景色读皮肤 `--qr-code-*`
  变量**随主题联动**（黑底荧光绿主题下为深绿模块 + 浅绿底，高对比仍可扫）。连接成功
  （`remote_state`：手机 WS 客户端真正接入 / 微信登录成功）后卡片收起二维码改显「✓ 已连接」。
  **重连二维码总在底部**：一次新连接（`fresh:true`）会清理该通道旧未连接卡片并在聊天区
  **底部新建**一张，配合新消息自动滚底，无需往上翻找；`fresh:false` 为同一连接内二维码
  过期刷新的就地更新（不堆叠）。
- **下拉硬边**：`RemoteConnectMenu` 弹层与内部按钮 `border-radius:0`，与复古 CRT 方角质感一致。
- **入站消息带来源标记**：手机 / 微信发来的消息经 `remote_user_message` 事件（`{channel,text}`）
  上屏，按**普通用户气泡（右对齐）**渲染，仅标签改显「微信 / 手机」（不再是居中系统提示）；
  微信每条回复在 query 结束时推 `assistant_done` 定稿，**下一条提问各自成独立气泡**（不再续写旧气泡）。
- **远端对话即时存盘**：手机 / 微信每一轮对话结束后，后端回调引擎 `_after_turn` 增量存盘，
  与桌面本地对话同规则写入会话历史（左栏列表可回看/恢复），纯手机 / 纯微信聊天也不会丢。
- **任意来源都能停止**：发送/停止双态按钮的 `busy` 不再只由桌面本地 `sendMessage` 驱动——
  只要桌面收到引擎活动事件（`assistant_text` / `assistant_thinking` / `tool_use`）就置忙、
  按钮变“■ 停止”（手机 / 微信 / 主动任务发起的轮次也能停）；点停止发 `reply.abort`，后端
  桥接在开跑前经 `on_query_begin`（引擎 `_remote_query_begin`）把当前任务登记为 `_send_task`，
  使取消对任意来源的在跑轮次都生效；手机轮次收尾经 `BridgeUI.finish` 补发 `assistant_done`
  撤销 `busy`（与微信 `end_turn` 对称，不留停止态卡死）。
- **共享会话、串行发送**：桌面文本 / 手机 / 微信三端共用同一会话，抢**引擎唯一 query 锁**
  串行化（都能发消息但绝不同时发），照终端 `_query_lock` 范式。
- **重连回填**：`init` 事件调 `refreshRemote`（`phone.status`+`wechat.status`）同步按钮连接态；
  二维码不回放（每次连接现生成）。协议与事件细节见 jarvis
  `docs/architecture/14-跨设备与微信接入.md` 第六节与 `docs/fixlogs/desktop-cross-device-sync.md`。

## 右栏面板（四区块）与设置面板

右栏信息面板自上而下四个区块，任务/用量/健康数据经 `schedule.list` / `cost.get` / `state.get`
指令与 `proactive_notify` 事件从 serve 侧拉取：

- **任务中心**：待触发提醒（⏰ + 时间 + 重复标签）与活跃截止日期（倒计时，临期标黄、
  逾期标红），以及最近一条每日简报（折叠块）；
- **会话与用量**：当前模型、token 累计（输入/输出/缓存）、**缓存命中率**（百分比，
  悬停看「命中 / 输入」明细）、**上下文窗口占比**（百分比 + 进度条，>85% 标红，悬停看
  「窗口/假设窗口 + 已用 token」，口径同 REPL `/context`）与对话轮数/消息条数，命中率与
  token 口径同 REPL `/cost`（均由后端算好后经 `cost.get` 下发，前端不重算；旧后端无上下文字段时隐藏该行）；
- **系统状态**：CPU / 内存 / 磁盘三指标卡（每 2 秒推送，CPU>85% 进度条变红）；
- **运行健康**：MCP 连接快照（成功/失败名单 + 工具数）与运行日志流（滚动 30 条）。MCP 为
  后台预热（约 9s），`init` 时快照常为 null（显“MCP 未启用”），连接落定后后端推 `mcp_ready`
  事件驱动本卡片自动刷新为真实连接态（无需重启）。

**设置面板（独立组件）**：点标题栏齿轮 ⚙ 进入，`SettingsPanel` 整体替换右栏信息面板
（再点齿轮或面板内 ← 返回）：

- **外观**：主题切换（荧光绿/电光蓝/金属银，三主题同风格（Y2K 像素复古）仅配色不同，
  **荧光绿排第一且首启默认**；`<html data-theme>` + 三张皮肤覆盖块：
  theme-retro.css / theme-dark-y2k.css / theme-light-y2k.css；荧光绿=CRT 荧光绿终端、
  电光蓝=深蓝底电光蓝霓虹、金属银=铬银金属亮色，三者均配 glyph ASCII 括号牌符号与反应炉像素化）与界面语言
  （中文/English，轻量 i18n 字典）与字体（英文字体 / 中文字体各自单设，可搜索下拉枚举本机字体（Chromium Local Font Access API `queryLocalFonts`，主进程放行 `local-fonts` 权限；不可用/被拒时回落到常见字体预设），选项以自身字体预览、中文字体打「含中文」标签；未选回落主题默认等宽终端栈，代码块/工具输出始终等宽不受影响），localStorage 持久化、重启保持（用户显式选择优先，无持久化/非法值时回退默认荧光绿）；
  文本选中高亮（含改名输入框全选）同样随主题：荧光绿亮绿反相 / 电光蓝亮青反相 / 金属银黑底白字，不再出现浏览器默认蓝底；
- **语音播报**：主动播报待机 TTS 朗读开关 + 播报音量（0-100）/语速（0.5-2.0×）滑杆；
- **每日简报**：启用开关 + 简报时间（HH:MM，自绘时间选择器：小时/分钟两个下拉点选）；
- **截止日期追踪**：启用开关 + 每日检查时间（同自绘时间选择器）。

  以上三组与 serve 后端联动（真源在 jarvis settings.toml 白名单，`settings.get` 回填、
  `settings.set` 写回：外科式落盘 + 运行时生效，简报/截止日期改动额外触发调度热重注册；
  乐观更新 + 失败回滚，未连接时对应行显离线态）。

原「快捷操作」区块已拆解：🗜 手动压缩上下文按钮迁入输入栏（📎 旁，点击透传 `/compact`、结果走命令输出卡片）；曾有的 📸 主屏截屏入口因实用性低已于 2026-10 整体删除（需截图时用户自行截取后经 📎/粘贴入附件）；
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
│   │   └── styles/     # main.css（全局底妆/标题栏/三栏/左栏）+ chat.css（中栏对话展示）+ composer.css（输入栏）+ right-column.css（右栏指标与五区块）+ boot.css（启动遮罩）+ controls.css（表单控件层：输入框/自绘下拉/自绘时间选择器/改名输入框）+ theme-retro.css（荧光绿 CRT 皮肤）+ theme-dark-y2k.css（电光蓝 Y2K 像素皮肤）+ theme-light-y2k.css（金属银 Y2K 像素皮肤）——2026-10 按单文件 800 行规范由 main.css 拆分
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

## 一期边界与打包态

- **dev 态**依赖本机 jarvis 源码仓库，**不捆绑 Python**（跑 `python -m agent.serve`）。
- **打包态**已由 `npm run dist` 实现：PyInstaller 将后端冻结成 `jarvis-serve.exe` 经 `extraResources`
  随 NSIS 安装包分发（见「打包发布」）。目前首发仅 Windows、未签名。
- 现有 pywebview 工作台（`jarvis --gui`）保留不动，与桌面壳并存：`--gui` 走工作台，`--serve` 走桌面壳。
- 本仓库已推送 GitHub（`origin/main`，https://github.com/aceFelix/jarvis-desktop ），CI 随 push/PR 自动运行。

## License

MIT © aceFelix
