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

`electron-builder.yml` 的 `win.icon` 与 `tray.ts` 的兜底图标路径都指向 `build/icon.ico`（多尺寸 16~256，**复古荧光绿像素反应炉**：32×32 像素网格程序化绘制——同心环带 + 八扇区线圈 + 高光内核，NEAREST 放大保持像素颗粒；配色与 theme-retro.css 同源；**圆外区域全透明**——此前黑绿实底 `#020602` 铺满方形画布，导致 Windows 任务栏图标外出现黑色正方形边框，2026-09-26 改为圆形透明轮廓）。该文件由脚本自包含生成并入库（仅依赖 Pillow，不再复用 jarvis 仓库绘制逻辑——jarvis --gui 窗口仍用深蓝版，两者身份有意分叉），重生成方式：

```powershell
python scripts/gen_icon.py   # 任一装了 Pillow 的环境（如 jarvis 的 venv）
```

**窗口与托盘同源**：任务栏/Alt-Tab 图标（`BrowserWindow.icon`）与托盘图标都经 `src/main/appIcon.ts` 解析（候选顺序：`build/icon.ico` 仓库复古版 → `~/.jarvis/jarvis_window.ico` 深蓝旧版兜底；2026-09-25 起仓库版优先，与默认复古主题同一视觉身份），杜绝「任务栏 Electron 原子 logo、托盘反应炉」的分叉（2026-09-10 实机反馈修复）。

## 4. 测试

vitest 分两个环境：`test/main/**` 与 `test/preload/**`（node 环境，主进程 / preload 逻辑）与 `test/renderer/**`（默认 node，组件测试文件头用 `// @vitest-environment jsdom` 单独声明）。共 **227 用例**：

| 测试文件 | 覆盖 |
|---|---|
| `test/main/backend.test.ts` | `parseHandshakeLine`（正常/残缺/超时行）、`resolvePythonEnv`、`BackendManager` 状态机（spawn→ready、stderr 噪声、仓库缺失、spawn 抛错、提前退出、握手超时、stop 杀进程树、意外退出、重复 start 复用） |
| `test/main/appIcon.test.ts` | 图标候选优先级（仓库复古像素版 → 用户目录深蓝旧版兜底）、全缺失降级 null、build/icon.ico 入库守卫、加载失败降级 |
| `test/main/notify.test.ts` | `showSystemNotification`（主动播报系统通知）：isSupported 弹窗、title 空回退 J.A.R.V.I.S、title+body 全空不弹、构造异常吞掉、窗口未聚焦 flashFrame / 已聚焦不闪 / 无窗口降级 |
| `test/preload/index.test.ts` | preload 暴露面契约：`jarvisDesktop` 键、notify 通道存在、notify 走 SystemNotify 通道原样 send、通道名稳定契约、既有能力（log/windowControl/onBackendStatus）未被挤掉 |
| `test/renderer/ws.test.ts` | `JarvisWsClient`：URL 构造与 token 编码、handleRaw 事件分发、sendCommand 回执兑现、同类型 FIFO 匹配、send 只发不等、断线拒绝 pending + 退避重连、close 不重连 |
| `test/renderer/chatStore.test.ts` | 消息流 store 全部 action：流式增量、thinking/text 分累、finishAssistant、工具卡建卡与按 id 回填、乱序补卡、ask_user、replayHistory、clear、addUser 缩略图 images 字段 |
| `test/renderer/dispatcher.test.ts` | `dispatchServerEvent` 全事件路由 → chat/left/metrics/right store 与状态栏回调（含 `assistant_done` 撤销 busy + 刷 `cost.get`，init 七路刷新（右栏三指令 + 设置回填）、会话管理事件（`session_new` 清屏+提示、`session_ready`/`session_renamed`/`session_deleted` 只刷列表不清屏））；列表类型守卫；`proactive_notify` 主动播报（briefing/reminder/deadline 上屏、reminder 带 task_id 回 ack、系统通知调用、window 缺失降级、briefing 进右栏最近简报 + 刷 `schedule.list`）；半双工语音 `voice_*` 事件（started/stopped/state 迁移/user_transcript/ai_text_delta→ai_text 全量替换、talk_started 权威复位 talk 模式） |
| `test/renderer/components.test.tsx` | React 组件（@testing-library/react）：ChatArea 气泡流式渲染 + 光标 + 工具卡 + ask_user + 发送/附件/截屏禁用 + 发送/停止双态按钮（busy 时变“■ 停止”、点击发 `reply.abort`、busy 中 Enter 不叠发）+ 📎 附件链路（file input 变更 → chips → 发送 payload 带 files）+ 用户气泡缩略图 + AI 气泡复制按钮（流式结束后出现、写剪贴板变「已复制」）+ 📸 截屏入附件 chips + 语音状态条（voiceActive 显示阶段文案 + 打断/退出按钮）+ 降噪折叠（思考块流式中展开、回复结束后自动收起成一行「思考过程 · N 字」；连续工具调用聚合成一条「工具调用 ×N」框：执行中展开且标题显示在跑的工具、全部完成后自动收起、有失败标红计数且仍收起；单条工具不包组；中间夹系统提示切组；历史汇总卡不并组；手点展开后不被自动态抢回）；LeftSidebar 面板切换 + 列表渲染 + 模式高亮（文本/实时/语音三按钮）+ 语音中 footer 标记 + 会话项交互（单击 220ms 延时发 `sessions.open`、当前会话不发；右键显删除按钮点击发 `sessions.delete`；双击进内联改名、回车发 `sessions.rename` 且不误触 open、Esc 取消不发）+ 左栏「＋ 添加模型」流（末项渲「＋ 添加模型」且点击进 ModelForm、字段默认值口径（deepseek/openai/text，下拉断言走 `data-value`）、空名本地校验提示且不发指令、提交发 `models.add` 带裁剪字段并刷列表关表单、自绘下拉改选厂商/接口类型后提交带所选值、回执失败保持表单打开、取消与顶部返回箭头均回列表不发指令）+ 模型配置修改/删除（双击模型项进编辑表单且预填 `config`（标题「修改模型配置」+ 目标提示行）、内置模型名输入框禁用、Key 框恒空且 hint 提示「留空保持原 Key」、改名+改 Base URL 提交发 `models.edit` 带裁剪字段并回列表提示「配置已更新」、回执 `hot_switched` 时提示「已按新配置重连」、右键自定义模型显删除按钮点击发 `models.remove` 并刷新列表、内置模型右键不出按钮、双击不误触发 `models.select`（单击定时器被清）、当前项（noop）双击仍可进编辑）；RightSidebar 指标 + 任务中心（提醒/截止日期/简报折叠块）+ 用量卡 + 运行健康（MCP 快照、日志流倒序）；SettingsPanel 独立设置面板（外观主题/语言分段控件、切浅色/复古写 `<html data-theme>`、切英文文案联动、后端联动四组未拉取时全显离线态、回填后渲染开关/时间/滑杆、TTS 开关乐观翻转发 `settings.set`、自绘时间选择器点选拼回 HH:MM 提交（重选当前值不发）、音量滑杆拖动写回、← 返回）；LeftSidebar retro 主题模式按钮显 `[TXT]`、切回 dark 恢复 Y2K 尖括号牌 `<TXT>`；TitleBar 窗口控制 IPC + 齿轮切换设置面板（激活态高亮） |
| `test/renderer/themedSelect.test.tsx` | 自绘主题化下拉 `ThemedSelect`：收起态只渲触发器（当前值文案 + `data-value` + `aria-expanded=false`）、展开渲染全部选项并标记当前项 `aria-selected`、点选回调新值并关闭（重复选当前值不回调）、键盘（↑↓ 移动高亮 + Enter 选中 + Esc 只关不选 + Tab 离开收起）、点击触发器/浮层之外关闭、滚动（浮层内滚动保持打开、页面滚动收起） |
| `test/renderer/themedTimePicker.test.tsx` | 自绘时间选择器 `ThemedTimePicker`（小时/分钟两个 `ThemedSelect` 拼装）：HH:MM 显示（根节点 `data-value` + 时/分触发器分列文本）、改小时/改分钟各自保持另一侧并回调完整 HH:MM、分钟列表 00-59 全量（60 个 `role=option`）、非法值只影响显示（回退 00:00 且不触发回调）、无障碍名拼出行标签 + 时/分 |
| `test/renderer/settingsStore.test.ts` | settingsStore（首启默认复古/中文——无持久化/非法值均回退 retro、setTheme 写 `<html data-theme>` + localStorage 持久化（含 retro）、setLanguage 持久化并驱动 translate、backendSettings 局部合并不进 localStorage + clearBackendSetting 单键回未拉取态、parseBackendSettings 宽容解析（全键回填/脏数据置 null/旧版后端兼容））+ i18n 查键（模板插值、缺参留占位、缺键回退键名/中文） |
| `test/renderer/glyphs.test.ts` | Glyph 符号系统：`glyphsFor` 三主题映射（retro→RETRO、dark→Y2K、light→SILVER）、RETRO/Y2K/SILVER 三表全为纯 ASCII 括号牌、三表键集合一致 |
| `test/renderer/backendStore.test.ts` | 半双工语音指令路由：`toggleVoice`（未激活→置 voice 模式 + `voice.start`；已激活→`voice.stop`）、`interruptVoice`（`voice.interrupt`）；停止回复：`abortReply`（发 `reply.abort`、状态栏“正在停止...”、不改 busy）；sendMessage 附件（payload 带 images/files、气泡缩略图 data URL、纯图片可发、全空不发）；右栏刷新动作（`refreshSchedule`/`refreshCost`/`refreshState` 发 `schedule.list`/`cost.get`/`state.get` 并映射进 rightStore）；设置面板（`refreshSettings` 发 `settings.get` 全量回填 backendSettings（脏数据置 null）、`setBackendSetting` 乐观更新发 `settings.set`（布尔/数值/时间键通用）、值未变不发指令、回执失败回滚原值、未连接回滚到 null）；未连接（client 为 null）降级不抛异常；会话改名/删除指令（`renameSession` 发 `sessions.rename` 带 name/new_name、`deleteSession` 发 `sessions.delete` 带 name；未连接/回错 ok=false 落系统错误提示）；模型配置修改/删除（`editModel` 发 `models.edit` 并刷 `models.list`、未热切换提示不带重连文案、`hot_switched` 时提示「已按新配置重连」；`removeModel` 发 `models.remove`、`was_current` 决定是否提示「建议另选」；后端拒绝回 false 且不刷列表、未连接回 false 不抛异常） |

> 组件测试不渲染 `App` / `ReactorCanvas`（会挂载 canvas 动画，jsdom 无 2D 上下文），逐个渲染纯展示组件；后端 client 默认 null，组件不会真正发起 WS 连接。

### 测试实现要点（避免踩坑）

- **假子进程**：`backend.test.ts` 用 `EventEmitter` 冒充 `stdout/stderr/exit`，经 `spawnFn` 注入；`child_process.spawn` 被 mock 以拦截 Windows 下 `killChild` 的 `taskkill` 调用，测试不会真去杀进程。
- **假 WebSocket**：`ws.test.ts` 把 `globalThis.WebSocket` 换成假类（带 `OPEN`/`CONNECTING` 静态值），手动触发 `onopen/onmessage/onclose`。
- **超时用例**：先挂上 `expect(p).rejects` 断言（同步注册 handler）再 `advanceTimersByTimeAsync`，否则 reject 会被 Node 记为瞬时未处理拒绝。
- **假 Electron 通知**：`notify.test.ts` 用 `vi.hoisted` 造可变 `Notification` 假类 + `isSupported`，再 `vi.mock('electron')`，避免「初始化前访问」；dispatcher 测试在 node 环境用 `globalThis.window` 桩注入 `jarvisDesktop.notify` spy（afterEach 删除）。

## 5. 人工走查清单（实机验收）

自动化测试覆盖纯逻辑，以下端到端链路需在实机 `npm run dev` 后人工走查：
清单中的括号牌为界面符号示意，实机显示随主题变化（荧光绿方括号牌 / 电光蓝尖括号牌 / 金属银花括号牌，见 `glyphs.ts`）。

- [ ] **启动**：`npm run dev` 弹出无边框黑绿窗口，任务栏/托盘图标为 J.A.R.V.I.S 反应炉图案。
- [ ] **握手**：启动遮罩短暂显示「正在拉起 jarvis 后端...」后消失（说明 stdout 握手 JSON 解析成功、WS 已连）；`desktop.log` 有「后端就绪: ws_port=... pid=...」。
- [ ] **发消息**：输入框敲字 → Enter 发送 → 用户气泡立即上屏 → AI 气泡流式增量渲染（带闪烁光标）→ 结束后光标消失。
- [ ] **消息附件**：📎 选图片 → 输入栏上方出缩略图 chip（可 ✕ 移除）→ 发送后用户气泡带缩略图 → 模型能描述图片内容（vision 生效）；截图 Ctrl+V 直接入 chips；📎 选 .md 文件 → chip 显文件名 → 发送后模型能引用文件内容；历史会话重开后图片以「[图片×N]」标记展示。
- [ ] **停止回复**：发送后按钮变“■ 停止”→ 回复进行中点击 → 流式中断、系统提示“已停止回复”、按钮恢复“发送”且可继续发新消息；回复中 Enter 不叠发。
- [ ] **思考与工具折叠（降噪）**：问一个需要思考 + 多步工具的问题（如「明天早上 9 点提醒我看视频」）→ **思考流式期间**思考块自动展开、正文实时增长（标题「思考过程 · N 字」）→ 回复结束后**自动收起成一行**（不再占满一屏），点开仍可回看全文（超长时正文限高内部滚动）→ 连续工具调用只出现**一条**「⛭ 工具调用 ×N」框（不再一个工具一个框），执行中自动展开、标题显示在跑的工具（「执行中：Bash」）→ 全部执行完**自动收起成一行 ✓**，点开见组内每条工具卡（每条可再单独展开看入参/输出）→ 中间若插入 AI 文字或系统提示则自动切成两组 → 只有一条工具时不套组（直接一行卡片）→ 让某条工具失败（如执行不存在的命令）→ 组仍收起，但标题标红「✗N 失败」、边框变红 → 手动点开已收起的块后，后续不会被自动收起打断。
- [ ] **切模型（幂等点选 + 热切换）**：左栏切到「模型」面板 → 列表可滚动 → 点非当前模型 → 该项副行立即变「· 待生效」（各皮肤虚线框、亮字，去手型与悬停高亮）→ 引擎热切换落地后推 `model_switched`：提示「模型已切换为 X（<描述>）」（由引擎 `info` 上屏，**只此一条**）、「· 当前」标记**立刻移到新项**（旧项恢复普通样式，列表刷新）、右栏用量卡的模型名与厂商同步变化 → **再点同一项或点运行中的「当前」项不再发指令、聊天流不新增任何提示** → 直接接着对话即是新模型在回答（无需重启）→ 重启桌面壳后该模型仍为「当前」（`last_model` 已写盘）。若正有一轮回复在跑时点选：切换在该轮结束后落地（气泡不被打断）。
- [ ] **添加模型**：模型面板列表末项「＋ 添加模型」（虚线框）→ 点击后列表整体换成添加表单（模型厂商/模型名/API Key/接口类型/Base URL/模型类型）→ 名称留空点「保存」→ 本地提示「模型名不能为空」且不发指令 → 填名保存 → 提示「模型「X」已添加」、表单关闭回列表且新模型出现在列表（点击可切换生效）→ 重启后端/桌面壳后该模型仍在（已写入用户级 `~/.jarvis/models.toml` 的 `[llm.custom_models."<name>"]`，API Key 入系统 keyring）；顶部 ← 与面板内「取消」均可回列表；三个下拉展开后应为**与皮肤同色的硬边浮层**（荧光绿亮绿反相 / 电光蓝亮青反相 / 金属银灰底黑字，方角无系统蓝高亮），支持 ↑↓/Home/End/Enter 选中与 Esc、点击外部关闭。
- [ ] **修改 / 删除模型配置**：模型面板**双击**任一模型 → 列表整体换成编辑表单（标题「修改模型配置」，上方一行「正在修改「X」的配置」）→ 字段预填该模型现值（厂商/接口类型/Base URL/模型类型；**API Key 框为空**、hint 为「留空保持原 Key 不变（已存密钥不回显）」）→ 改 Base URL（或接口类型）后点「保存修改」→ 提示「配置已更新」；若改的正是运行中的「当前」模型，提示为「配置已更新，当前会话已按新配置重连」且随后对话按新端点生效（无需重启）；改名 + 留空 Key 保存 → 列表出现新名且旧 Key 仍有效（验证「留空=保持原 Key」，不是清空）；双击**内置模型** → 「模型名」输入框**禁用**、hint 提示「内置模型名不可修改（需要新名字请用「＋ 添加模型」）」；**右键自定义模型** → 项右侧出现删除按钮（荧光绿 `[DEL]` / 电光蓝 `<DEL>` / 金属银 `{DEL}`）→ 点击后该项从列表消失并提示「已删除」（删的是当前模型时提示「仍在用它，建议另选一个模型」）→ 右键**内置模型**不出现删除按钮 → 列表空白处右键收起按钮；面板底部有一行提示「双击模型改配置 · 右键自定义模型可删除」。
- [ ] **切音色**：音色面板列出**全量音色目录**（内置+自定义，当前音色置顶），副行透出「适配 X」/「联动 X」预告；点非当前音色 → 该项副行变「· 待生效」且聊天流提示「音色已切换为 X（下次语音生效）」，若发生了 tts_model 联动提示会带「联动 TTS 模型 Y」→ **再点同一项不发指令、不弹提示**（重复点选去重）；重启后端/桌面壳后该音色仍为「当前」（已写盘 settings.toml）。
- [ ] **音色管理（添加 / 编辑 / 删除）**：音色面板末项「＋ 添加音色」（虚线框）→ 点击后列表整体换成 `VoiceForm` 表单（音色名/DashScope 音色 ID/适配模型下拉/描述）→ 名称留空点「保存」→ 本地提示「音色名不能为空」且不发指令；补名缺 ID → 换报「音色 ID 不能为空」→ 填全保存 → 提示「音色「X」已保存，点击列表项可切换」、回列表且新音色在列（custom，可点选切换）→ 重启后端/桌面壳后仍在（已写 `~/.jarvis/settings.toml` 的 `[tts.custom_voices]`）；**双击自定义项** → 进表单预填、音色名**锁定不可改**、顶部显「正在修改「X」」，改 voice_id 后点「保存修改」，保存后列表现新值；**右键自定义项** → 项右侧出现删除按钮 → 点击后该项消失并提示「已删除」；右键**内置音色**不出现删除按钮；面板底部有一行提示「点击切换音色 · 双击自定义音色编辑 · 右键可删除」。
- [ ] **历史会话**：历史面板点会话 → 回放历史消息 + 「已恢复会话「X」」→ 该会话项在左栏高亮选中（`sessions.list` 的 `current` 标记，与模型/音色选中态同口径；选中项再点不重复恢复，新建/标题改名后选中态随列表刷新自愈）。
- [ ] **会话删除 / 改名**：右键会话项 → 项右侧出现删除按钮（荧光绿 `[DEL]` / 电光蓝 `<DEL>` / 金属银 `{DEL}`）→ 点击后会话从列表消失（删当前会话时中栏一并清空开新会话）；列表空白处右键 → 删除按钮收起；双击会话项 → 标题变为可编辑输入框（光标选中）→ 改名后 Enter 或点击别处提交（列表刷新为新名、不再被自动标题覆盖），Esc 或改回原名则取消；单击与双击不相互误触（想改名不会先加载一次）；改名输入框配色随主题（荧光绿/电光蓝/金属银，不再固定蓝边圆角），全选时文字高亮也随主题（荧光绿亮绿反相 / 电光蓝亮青反相 / 金属银黑底白字），无系统蓝底。
- [ ] **右栏指标**：CPU/内存/磁盘每 ~2 秒刷新，CPU>85% 进度条变红。
- [ ] **设置面板**：点标题栏齿轮 ⚙ → 右栏整体切为设置面板（齿轮高亮，再点或面板内 ← 返回信息面板）；点「金属银」→ 界面立即换金属银主题（荧光绿/电光蓝/金属银分段高亮跟随，荧光绿排第一）→ 重启 `npm run dev` 仍保持；点「English」→ 栏标题/按钮/空态等静态文案切英文（状态栏与事件消息仍中文），重启保持；简报时间/检查时间为自绘时间选择器（小时/分钟两个下拉，展开浮层为与皮肤同色的硬边方角、无系统白底蓝高亮），点选即写回、重选当前值不发指令。
- [ ] **荧光绿主题（默认）**：全新启动（无 localStorage 持久化）默认即荧光绿——CRT 荧光绿终端风（黑底绿字、扫描线叠层、点阵抖动背景、硬边无圆角、等宽字辉光、方块滚动条）+ ASCII 方括号牌（左栏 `[TXT]/[LIV]/[VOX]`、面板 `[HIS]/[MOD]/[VOC]`、输入栏 `[ATT]/[CAP]` 等）+ 反应炉绿系像素颗粒（低分辨率放大）；设置面板切「电光蓝/金属银」→ 重启后仍保持所选（用户显式选择优先）→ 切「电光蓝」为 Y2K 像素复古电光蓝皮肤（电光蓝霓虹 + 铬金属渐变标题/选中态/主按钮 + 赛博网格底 + 像素切角 + 扫描线，尖括号牌 `<TXT>/<LIV>/<VOX>` 等，反应炉蓝系像素颗粒），切「金属银」为 Y2K 像素复古铬银亮色皮肤（铬银金属渐变 + 黑色描边/文字（无蓝相、与电光蓝区分）+ 亮底网格/点阵/扫描线，花括号牌 `{TXT}/{LIV}/{VOX}` 等）；三主题同风格仅配色不同，互切无残留。
- [ ] **语音播报与后端联动设置**：连接后端后进设置面板 → 四组控件在线可改：「主动播报语音」拨动开关（立即生效，关闭后到期提醒不再 TTS 朗读，事件气泡/通知不受影响）、播报音量/语速滑杆（下一次播报即按新值）、每日简报开关 + 简报时间、截止日期开关 + 检查时间（改时间/开关后调度热重注册，无需重启）→ 重启后全部保持（已外科式落盘 settings.toml 对应节，注释与其他字段不丢）；未连接时对应行显离线态文案；后端拒绝（超范围/非法值）时控件回滚原值且聊天流出现错误文案。
- [ ] **复制与截屏**：AI 回复结束后气泡右下出现「📋 复制」→ 点击剪贴板可取（按钮短暂变“✓已复制”）；点输入栏 📸 → 附件 chips 出现截图缩略图 → 发送后模型能描述截图内容。
- [ ] **右栏任务中心**：对话「10 分钟后提醒我喝水」→ 提醒出现在任务中心列表（时间升序）；到点触发后条目消失、⏰ 气泡上屏；对话设截止日期后可见倒计时（临期黄/逾期红）；每日简报触发后「最近简报」折叠块可展开。
- [ ] **右栏用量与健康**：发几轮对话后用量卡 token/轮数增长（口径同 REPL `/cost`）；运行健康显示 MCP 连接数与工具数（未启用显示“MCP 未启用”）；日志流随对话/工具调用滚动追加。
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
