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

主进程 `backend.ts::resolveLaunchPlan` 依次读环境变量与 `app.isPackaged` 决策后端启动方式
（优先级：`JARVIS_SERVE_EXE` 显式 exe → 打包内置 `resources/jarvis-serve/jarvis-serve.exe` → dev `python -m agent.serve`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `JARVIS_PYTHON` | `python` | 解释器命令或绝对路径（dev 态，venv 场景填 `...\Scripts\python.exe`） |
| `JARVIS_REPO` | `<本仓库>/../jarvis` | jarvis 源码仓库根目录（dev 态，须含 `agent/` 包） |
| `JARVIS_SERVE_EXE` | （未设） | 显式指定冻结后端 exe；优先级高于打包内置 exe（自测/特殊部署） |

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
npm run serve:build # PyInstaller 冻结后端到 ../jarvis/dist/jarvis-serve/
npm run dist       # build → serve:build → electron-builder --win（出 NSIS 安装包）
npm run dist:fast  # 同上但复用已冻结的 jarvis-serve/（只改壳时快）
```

### 打包发布（NSIS 安装包 + 随包冻结后端）

目标：产出下载双击即装、无需 Python 的安装包。关键是把 Python 后端随包分发：

- **后端冻结**：`jarvis/packaging/` 下 `serve_entry.py`（等价 `python -m agent.serve`）
  + `jarvis-serve.spec`（PyInstaller onedir）+ `build_serve.ps1`（一键调用，自动定位 venv
  Python、缺 PyInstaller 时即时装）。产物 `jarvis/dist/jarvis-serve/`（onedir：`jarvis-serve.exe` + `_internal/`）。
- **随包分发**：`electron-builder.yml` 的 `extraResources` 把 `../jarvis/dist/jarvis-serve/` 整目
  录拷入安装包 `resources/jarvis-serve/`；打包态 `backend.ts` 据此 spawn 内置 exe。
- **体积剪裁**：spec `excludes` 排除 playwright/cv2/mediapipe/paddleocr 等重型可选 extras（基础
  包从 ~300MB 降到 ~100MB）；这些工具运行时懒加载失败即优雅降级，不影响核心对话。
- **asar: false**：避开 Windows 上 electron-builder 向新建 electron exe 回写 asar 完整性时被 Defender
  写锁命中（`addWinAsarIntegrity` writeFile → `UNKNOWN`）。
- **镜像**：国内网络先设 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`（npmmirror），
  否则下载 Electron 运行时 / electron-builder 二进制会超时。
- **winCodeSign 符号链接权限**（重要环境卡点）：electron-builder 拉取 `winCodeSign` 依赖包时需解压包内
  macOS `.dylib` 符号链接，普通账户缺 `SeCreateSymbolicLinkPrivilege` 会报「客户端没有所需的特权」。
  任选：① 开 **Windows 开发者模式**；② **以管理员**运行构建；③ 在 **CI windows-latest** 构建。
  `win-unpacked/` 不依赖 winCodeSign，可在普通账户下产出并直接验证集成。
- **CI 自动发布**（`.github/workflows/release.yml`）：因本机出包受符号链接权限限制，发布统一交给
  GitHub Actions 在 `windows-latest` 上跑——**并列检出** `jarvis-desktop` 与 `jarvis`（默认 `master`）、
  装 Node 20 + Python 3.12（`pip install -e .` + `pyinstaller`）、`npm run dist` 出包，再用
  `softprops/action-gh-release` 把 `*-Setup-*.exe` 挂到对应 tag 的 GitHub Release。触发：推 `v*` tag
  或手动 `workflow_dispatch`。（与只做验证的 `ci.yml` 分工：ci 跑 ubuntu 快验，release 跑 windows 出包。）

### 图标资源（build/icon.ico）

`electron-builder.yml` 的 `win.icon` 与 `tray.ts` 的兜底图标路径都指向 `build/icon.ico`（多尺寸 16~256，**复古荧光绿像素反应炉**：32×32 像素网格程序化绘制——同心环带 + 八扇区线圈 + 高光内核，NEAREST 放大保持像素颗粒；配色与 theme-retro.css 同源；**圆外区域全透明**——此前黑绿实底 `#020602` 铺满方形画布，导致 Windows 任务栏图标外出现黑色正方形边框，2026-09-26 改为圆形透明轮廓）。该文件由脚本自包含生成并入库（仅依赖 Pillow，不复用 jarvis 仓库绘制逻辑——jarvis 侧深蓝版窗口图标已随 pywebview 三栏工作台窗口壳于 2026-10 退役，两者身份有意分叉），重生成方式：

```powershell
python scripts/gen_icon.py   # 任一装了 Pillow 的环境（如 jarvis 的 venv）
```

**窗口与托盘同源**：任务栏/Alt-Tab 图标（`BrowserWindow.icon`）与托盘图标都经 `src/main/appIcon.ts` 解析（候选顺序：`build/icon.ico` 仓库复古版 → `~/.jarvis/jarvis_window.ico` 深蓝旧版兜底（该旧版原由 jarvis 开机自启脚本生成，已随窗口壳退役，仅存量安装残留）；2026-09-25 起仓库版优先，与默认复古主题同一视觉身份），杜绝「任务栏 Electron 原子 logo、托盘反应炉」的分叉（2026-09-10 实机反馈修复）。

## 4. 测试

vitest 分两个环境：`test/main/**` 与 `test/preload/**`（node 环境，主进程 / preload 逻辑）与 `test/renderer/**`（默认 node，组件测试文件头用 `// @vitest-environment jsdom` 单独声明）。共 **524 用例**：

| 测试文件 | 覆盖 |
|---|---|
| `test/main/backend.test.ts` | `parseHandshakeLine`（正常/残缺/超时行）、`resolvePythonEnv`、`BackendManager` 状态机（spawn→ready、stderr 噪声、仓库缺失、spawn 抛错、提前退出、握手超时、stop 杀进程树、意外退出、重复 start 复用） |
| `test/main/appIcon.test.ts` | 图标候选优先级（仓库复古像素版 → 用户目录深蓝旧版兜底）、全缺失降级 null、build/icon.ico 入库守卫、加载失败降级 |
| `test/main/notify.test.ts` | `showSystemNotification`（主动播报系统通知）：isSupported 弹窗、title 空回退 J.A.R.V.I.S、title+body 全空不弹、构造异常吞掉、窗口未聚焦 flashFrame / 已聚焦不闪 / 无窗口降级 |
| `test/main/update.test.ts` | 自动更新 `update.ts`（vi.mock electron-updater + electron）：initUpdater 关闭自动下载/自动安装 + 五类事件映射（update-available→available+version、download-progress→downloading+取整百分比、update-downloaded→downloaded、update-not-available→idle、error→error+message）、`checkOnStartup` 的 app.isPackaged 守卫（dev 跳过 / packaged 触发 / 拒绝被吞）、`download`/`install` 转发（quitAndInstall(false,true)） |
| `test/preload/index.test.ts` | preload 暴露面契约：`jarvisDesktop` 键、notify 通道存在、notify 走 SystemNotify 通道原样 send、通道名稳定契约、既有能力（log/windowControl/onBackendStatus）未被挤掉、自动更新三通道（downloadUpdate/installUpdate 走 invoke、onUpdateStatus 订阅 + 取消订阅） |
| `test/renderer/ws.test.ts` | `JarvisWsClient`：URL 构造与 token 编码、handleRaw 事件分发、sendCommand 回执兑现、同类型 FIFO 匹配、send 只发不等、断线拒绝 pending + 退避重连、close 不重连 |
| `test/renderer/chatStore.test.ts` | 消息流 store 全部 action：流式增量、thinking/text 分累、finishAssistant、工具卡建卡与按 id 回填、乱序补卡、ask_user、replayHistory、clear、addUser 缩略图 images 字段 |
| `test/renderer/dispatcher.test.ts` + `test/renderer/dispatcherNotify.test.ts` | `dispatchServerEvent` 全事件路由 → chat/left/metrics/right/tasks store 与状态栏回调。两个文件按**事件域**拆开（2026-10 阶段 10 W3，单文件 800 行上限），假 `JarvisConnection`（十一个刷新动作全为 spy）与各 store 复位抽在 `test/renderer/dispatcherFixtures.ts` 共用。主干文件：聊天流式增量、`assistant_done` 撤销 busy + 刷 `cost.get` 与 `refreshTasks()`、init 十一路刷新（右栏三指令 + 设置回填 + 项目/协同/补全目录 + 任务中心两份快照）、会话管理事件、列表类型守卫、语音 `voice_*`；拆分文件：`proactive_notify`（briefing/reminder/deadline/percept 上屏、reminder 带 task_id 回 ack、系统通知调用、window 缺失降级、briefing 进右栏最近简报 + 刷 `schedule.list`；**kind=task 刷一次任务中心、非 task 播报不刷**）、跨设备协同 `qrcode`/`remote_state`、`rewound` 消息回溯、`slash_result` 命令输出卡片；`kind=percept_ask` 的首次引导路由见 `butler.test.tsx` |
| `test/renderer/components.test.tsx` | React 组件（@testing-library/react）：ChatArea 气泡流式渲染 + 光标 + 工具卡 + ask_user + 发送/附件/截屏禁用 + 发送/停止双态按钮（busy 时变“■ 停止”、点击发 `reply.abort`、busy 中 Enter 不叠发）+ 📎 附件链路（file input 变更 → chips → 发送 payload 带 files）+ 用户气泡缩略图 + AI 气泡复制按钮（流式结束后出现、写剪贴板变「已复制」）+ 📸 截屏入附件 chips + 语音状态条（voiceActive 显示阶段文案 + 打断/退出按钮）+ 降噪折叠（思考块流式中展开、回复结束后自动收起成一行「思考过程 · N 字」；连续工具调用聚合成一条「工具调用 ×N」框：执行中展开且标题显示在跑的工具、全部完成后自动收起、有失败标红计数且仍收起；单条工具不包组；中间夹系统提示切组；历史汇总卡不并组；手点展开后不被自动态抢回）；LeftSidebar 面板切换 + 列表渲染 + 模式高亮（文本/实时/语音三按钮）+ 语音中 footer 标记 + 会话项交互（单击 220ms 延时发 `sessions.open`、当前会话不发；右键显删除按钮点击发 `sessions.delete`；双击进内联改名、回车发 `sessions.rename` 且不误触 open、Esc 取消不发）+ 左栏「＋ 添加模型」流（末项渲「＋ 添加模型」且点击进 ModelForm、字段默认值口径（deepseek/openai/text，下拉断言走 `data-value`）、空名本地校验提示且不发指令、提交发 `models.add` 带裁剪字段并刷列表关表单、自绘下拉改选厂商/接口类型后提交带所选值、回执失败保持表单打开、取消与顶部返回箭头均回列表不发指令）+ 模型配置修改/删除（双击模型项进编辑表单且预填 `config`（标题「修改模型配置」+ 目标提示行）、内置模型名输入框禁用、Key 框恒空且 hint 提示「留空保持原 Key」、改名+改 Base URL 提交发 `models.edit` 带裁剪字段并回列表提示「配置已更新」、回执 `hot_switched` 时提示「已按新配置重连」、右键自定义模型显删除按钮点击发 `models.remove` 并刷新列表、内置模型右键不出按钮、双击不误触发 `models.select`（单击定时器被清）、当前项（noop）双击仍可进编辑）；RightSidebar 指标 + 任务中心（提醒/截止日期/简报折叠块）+ 用量卡 + 运行健康（MCP 快照、日志流倒序）；SettingsPanel 独立设置面板（外观主题/语言分段控件 + 字体英文/中文行（懒加载枚举本机字体、选项以自身字体预览、选字体上抛族名、已选时点默认上抛 null、API 不可用回落预设）、切浅色/复古写 `<html data-theme>`、切英文文案联动、后端联动四组未拉取时全显离线态、回填后渲染开关/时间/滑杆、TTS 开关乐观翻转发 `settings.set`、自绘时间选择器点选拼回 HH:MM 提交（重选当前值不发）、音量滑杆拖动写回、← 返回）；LeftSidebar retro 主题模式按钮显 `[TXT]`、切回 dark 恢复 Y2K 尖括号牌 `<TXT>`；TitleBar 窗口控制 IPC + 齿轮切换设置面板（激活态高亮） |
| `test/renderer/themedSelect.test.tsx` | 自绘主题化下拉 `ThemedSelect`：收起态只渲触发器（当前值文案 + `data-value` + `aria-expanded=false`）、展开渲染全部选项并标记当前项 `aria-selected`、点选回调新值并关闭（重复选当前值不回调）、键盘（↑↓ 移动高亮 + Enter 选中 + Esc 只关不选 + Tab 离开收起）、点击触发器/浮层之外关闭、滚动（浮层内滚动保持打开、页面滚动收起）；可搜索扩展（`searchable` 渲顶部过滤输入按 label/value 子串筛、无匹配显 `emptyText`、选项 `fontFamily` 自身字体预览 + `hint` 标签、`onOpen` 展开时在用户手势栈内回调一次） |
| `test/renderer/fontUtils.test.ts` | 字体纯函数：`buildFontStack`（两者皆空回 null、英文在前中文次之等宽尾、字体名内引号/分号清洗）、`isLikelyCjkFont`（中文字体命中/西文排除/Noto CJK 不误伤）、`normalizeFontList`（大小写去重、空串/非串过滤、cjkFirst 置顶分组、否则字母序） |
| `test/renderer/fontPicker.test.tsx` | 字体选择器 `FontPicker`：`queryLocalFonts` 懒加载枚举 + 去重、默认项置顶、cjkFirst 给中文字体打「含中文」标签、点选字体上抛族名/已选时点默认上抛 null、API 不可用回落常见字体预设 |
| `test/renderer/themedTimePicker.test.tsx` | 自绘时间选择器 `ThemedTimePicker`（小时/分钟两个 `ThemedSelect` 拼装）：HH:MM 显示（根节点 `data-value` + 时/分触发器分列文本）、改小时/改分钟各自保持另一侧并回调完整 HH:MM、分钟列表 00-59 全量（60 个 `role=option`）、非法值只影响显示（回退 00:00 且不触发回调）、无障碍名拼出行标签 + 时/分 |
| `test/renderer/settingsStore.test.ts` | settingsStore（首启默认复古/中文——无持久化/非法值均回退 retro、setTheme 写 `<html data-theme>` + localStorage 持久化（含 retro）、setLanguage 持久化并驱动 translate、字体偏好（setFontLatin/setFontCjk 拼「英文在前、中文次之」写 `--app-font` CSS 变量 + 持久化、清空归一 null 并移除变量回落、loadPersisted 非法/脏空白字体值归一 null）、backendSettings 局部合并不进 localStorage + clearBackendSetting 单键回未拉取态、parseBackendSettings 宽容解析（全键回填/脏数据置 null/旧版后端兼容））+ i18n 查键（模板插值、缺参留占位、缺键回退键名/中文） |
| `test/renderer/glyphs.test.ts` | Glyph 符号系统：`glyphsFor` 三主题映射（retro→RETRO、dark→Y2K、light→SILVER）、RETRO/Y2K/SILVER 三表全为纯 ASCII 括号牌、三表键集合一致 |
| `test/renderer/backendStore.test.ts` | 半双工语音指令路由：`toggleVoice`（未激活→置 voice 模式 + `voice.start`；已激活→`voice.stop`）、`interruptVoice`（`voice.interrupt`）；停止回复：`abortReply`（发 `reply.abort`、状态栏“正在停止...”、不改 busy）；sendMessage 附件（payload 带 images/files、气泡缩略图 data URL、纯图片可发、全空不发）；右栏刷新动作（`refreshSchedule`/`refreshCost`/`refreshState` 发 `schedule.list`/`cost.get`/`state.get` 并映射进 rightStore）；设置面板（`refreshSettings` 发 `settings.get` 全量回填 backendSettings（脏数据置 null）、`setBackendSetting` 乐观更新发 `settings.set`（布尔/数值/时间键通用）、值未变不发指令、回执失败回滚原值、未连接回滚到 null）；未连接（client 为 null）降级不抛异常；会话改名/删除指令（`renameSession` 发 `sessions.rename` 带 name/new_name、`deleteSession` 发 `sessions.delete` 带 name；未连接/回错 ok=false 落系统错误提示）；模型配置修改/删除（`editModel` 发 `models.edit` 并刷 `models.list`、未热切换提示不带重连文案、`hot_switched` 时提示「已按新配置重连」；`removeModel` 发 `models.remove`、`was_current` 决定是否提示「建议另选」；后端拒绝回 false 且不刷列表、未连接回 false 不抛异常）；工作模式/思考强度（`setMode`/`setThinking` 发 `mode.set`/`think.set`、同值短路不发、`result.ok` 为真才写 runtimeStore、失败弹错不写、未连接降级）；管家服务（`sendEmail` 发 `email.send` 携全字段并回 `{ok:true}`、后端失败回 `{ok:false,error}`、未连接回 `{ok:false}`，三者均**不写聊天流**——直连回执交表单内联显示；`fetchEmailConfig` 发 `email.config.get` 成功回解析后的 `EmailConfig`、失败/未连接回 null；`saveEmailConfig` 发 `email.config.set` 成功回 `{ok:true, config}`、后端回错 ok=false 带 error、未连接回 `{ok:false}`，均不写聊天流） |
| `test/renderer/runtimeStore.test.ts` | runtimeStore（单一职责工作模式/思考状态）：初始值（default/off/空 supported）、`applyRuntimeState` 整块快照写入、`setMode`/`setThinking` 局部更新（ChatArea 工具条两选择器渲染与切换、不支持思考时 disabled 见 `components.test.tsx`） |
| `test/renderer/butler.test.tsx` | 管家服务（标题栏「设置」旁按钮 → 右栏管家服务面板，2026-10）：`uiStore`（openButler/closeButler 切 `rightView`；showButlerHint/clearButlerHint 与进面板即清提示点）；`butlerStore`（openService/closeService 面板内服务视图）；`TitleBar` 管家按钮（未连后端置灰、点击进面板高亮、再点退出）；**感知首次引导（W2 第 7 步）**：`dispatchServerEvent` 收到 `proactive_notify(kind=percept_ask)` 上屏带 🔍 前缀并点亮提示点、普通 `kind=percept` 不点亮、点亮时渲 `.notice-dot` 且 `title` 换 `butler.hintTip`、点进面板红点消失；`ButlerPanel`（默认渲染服务清单、挂载重置回清单、点「邮箱服务」进内嵌视图、← 返回回信息面板）；`EmailServicePanel`（概览「当前邮箱」sender 优先/回退 smtp_user、子标签「邮箱配置」↔「发送邮件」切换、离线态、子返回）；`EmailConfigForm`（字段回填、授权码留空不带 `smtp_password`、填入携带、端口非法本地拦截、保存失败内联）；`EmailForm`（主题/正文留空本地拦截不调 `sendEmail`、提交成功调 `sendEmail` 携全字段并渲染成功态、提交失败内联显示错误且表单不关闭、取消调 `closeService` 回清单） |
| `test/renderer/extension.test.tsx` | 扩展服务面板（标题栏「扩展服务」→ 右栏第五个视图，2026-10）：`uiStore`（openExtension/closeExtension）、`extensionStore`（openCategory/closeCategory）、`TitleBar` 扩展按钮置灰与 toggle；`ExtensionPanel` 五类分类清单与挂载重置；`ExtensionMcpPanel`（清单/启停/两步删除/新增与编辑表单（名只读）经 `extensions.exec` 的 `mcp.*` 动作）、`ExtensionToolsPanel` / `ExtensionSkillsPanel`（只读清单 + 关键字本地过滤）、`ExtensionPluginsPanel` / `ExtensionHarnessPanel`（已装清单启停卸载 + 市场搜索/安装） |
| `test/renderer/remote.test.tsx` | 跨设备协同（2026-10）：`RemoteConnectMenu`（未连后端置灰、菜单开合、手机/微信按当前连接态路由「连接/断开」到 `backendStore` 动作、动作后自动收起）；`QrcodeCard`（已连接文案、手机/微信两通道只差二维码与提示、jsdom 无 canvas 时回落显原始 url） |
| `test/renderer/projectSection.test.tsx` | 左栏项目区（2026-08）：当前项目 + 待生效徽标、「打开文件夹」走 `window.jarvisDesktop.selectDirectory` 成功后 `setProject`、最近项目点击切项目、右键「从列表移除」走 `forgetProject`、`exists=false` 项显“目录不存在”徽标 |
| `test/renderer/slashAutocomplete.test.tsx` | 斜杠命令补全（`slash.commands`，2026-10）：`slashTriggerOf`（仅“/xxx 且无空白”触发）、`filterSlashCommands`（前缀匹配忽略大小写）、`useSlashAutocomplete` 弹层交互（候选弹出、↑↓ 高亮跟随滚动、Tab/Enter 回填、已等于完整命令名时 Enter 直通、Esc 收起、空目录不弹层） |
| `test/renderer/percept.test.tsx` | 感知源面板（管家服务第二项，2026-10 阶段 9 W2 第 5 步）：契约宽容解析 `parsePerceptStatus` / `parsePerceptConfig`（完整快照、非数组回空、脏事件丢弃、`log_events` 出厂缺省必须回 true）、`perceptEnableKey`（未装配源回空串→不给开关）、`perceptDetailEntries`（标量/字符串数组成行，嵌套对象与空值跳过）、`formatEventTime` / `perceptEventSummary` 兜底；`perceptActions`（未连 client 读回 null / 写回 ok=false，`event_limit` 透传，回执 ok=false 回 null，保存失败错误原样上交）；`ButlerPanel`（两个服务入口、点感知源进面板）；`PerceptSourcePanel`（总览逐行、后端宿主接线文案、总开关即时保存并用回执快照刷新 aria-checked、`hot_applied=false` 的降级提示、保存失败错误内联且不改本地态、离线态、三子标签切换、刷新重拉）；`PerceptSourceList`（已实现源有开关/收编位无开关、按源名推补丁键、账本徽标与末次错误、观察范围展开）；`PerceptScopeForm`（草稿回填、**只提交实际改动的键**、没改动不发补丁、分钟非法本地拦截）；`PerceptEventList`（事件行渲染、「总线未运行」与「暂无事件」两种空态区分）、留痕路径三态文案（有路径 / 真关显「已关闭」 / 开着但拿不到路径显「总线未运行」）、**打扰预算行（后端给了就显示、`notify_budget` 为 null 时整行不显示）**、反馈条在文档序上必须排在总览之前（错误不能藏在滚动区外） |
| `test/renderer/tasks.test.tsx` | 任务中心（右栏两个新区块，2026-10 阶段 10 W3）：契约宽容解析 `parseTasksSnapshot` / `parseActionsSnapshot` / `parseEffectRecord` / `parseUndoPreview`（完整快照、goals 非数组回空、布尔只认真 `true`、`denied_tools` 缺失给空表、`preview` 对象形与数组形分别收敛）、`shortId` / `fmtEpoch`；`taskActions`（未连 client 读回 null / 写回 ok=false，`create` 的 steps/wait 只在有值时进 payload，**两拍动作第一拍绝不带 confirm**、第二拍才带，`cancel_hold` 一拍不塞 confirm，`approve` 的 minutes 省略不传/传了取整，业务失败与传输失败都回 ok=false 且文案取后端原文，`refreshTasks` 成功回填两份快照/失败保留旧数据/离线不动 store）；`SpineTaskPanel`（挂载即拉一次、驱动器三态文案分别说、等授权才画批准按钮且按 goal+step id 发 approve、`denied_tools` 为空时**点了不发请求**只说明、暂停态不递批准但仍显「等你授权」、建目标表单空文本拦下、删除与批量撤销的两拍流程且确认卡内容取自第一拍、空台账空态）；`EffectJournalPanel`（未启用只说明不给撤销入口、held 行倒计时与一拍撤回预约、回退这一轮两拍（文件清单 + 整轮提醒原文都摊开）、撑不住的项只写「撤不回」+ 后端原因不给按钮、未知状态收敛成「未知状态」不外泄内部键名、反馈条按 `panel` 分流不画两遍） |

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
- [ ] **停止回复**：发送后按钮变“■ 停止”→ 回复进行中点击 → 流式中断、系统提示“已停止回复”、按钮恢复“发送”且可继续发新消息；回复中 Enter 不叠发；**若停止时正卡在某个工具（如 Bash）执行中，该工具卡应立刻变红色 ✗、附“本轮已结束”说明并随工具组收起，不得残留“… 执行中”**（中途报错结束同理）。
- [ ] **思考与工具折叠（降噪）**：问一个需要思考 + 多步工具的问题（如「明天早上 9 点提醒我看视频」）→ **思考流式期间**思考块自动展开、正文实时增长（标题「思考过程 · N 字」）→ 回复结束后**自动收起成一行**（不再占满一屏），点开仍可回看全文（超长时正文限高内部滚动）→ 连续工具调用只出现**一条**「⛭ 工具调用 ×N」框（不再一个工具一个框），执行中自动展开、标题显示在跑的工具（「执行中：Bash」）→ 全部执行完**自动收起成一行 ✓**，点开见组内每条工具卡（每条可再单独展开看入参/输出）→ 中间若插入 AI 文字或系统提示则自动切成两组 → 只有一条工具时不套组（直接一行卡片）→ 让某条工具失败（如执行不存在的命令）→ 组仍收起，但标题标红「✗N 失败」、边框变红 → 手动点开已收起的块后，后续不会被自动收起打断。
- [ ] **输入栏（工作模式 + 思考强度）**：输入栏分三段——**左侧 2×2 控区**（上排 📎/📸，下排工作模式/思考强度两个下拉）、**中间加高输入框**（默认约三行高、自增高上限 240px）、**右侧竖排按钮**（发送/停止 在上、实时语音 在下），控件不再挤在一横排——「工作模式」四项 default/plan/accept_edits/yolo，选后发 `mode.set`、“下一条消息”生效（正回复时于该轮结束后落地，不打断当前气泡）；“思考”按当前厂商可选档位渲染关闭/低/中/高，选后发 `think.set`（后端按厂商 `THINKING_CONFIGS` 翻译为 `thinking_budget`/`reasoning_effort`）；切到一个无干净思考开关的厂商（如 MiniMax）时思考下拉**置灰不可点**、无副作用；两项初值来自 `state.get`（首屏与重连都能正确回填、非法值回退 default/off）；busy/未连接时仍可切换（入队串行，下轮生效）；后端未重启时收 `mode.set`/`think.set` 秒级回 `ok=false`“请重启后端”。
- [ ] **切模型（幂等点选 + 热切换）**：左栏切到「模型」面板 → 列表可滚动 → 点非当前模型 → 该项副行立即变「· 待生效」（各皮肤虚线框、亮字，去手型与悬停高亮）→ 引擎热切换落地后推 `model_switched`：提示「模型已切换为 X（<描述>）」（由引擎 `info` 上屏，**只此一条**）、「· 当前」标记**立刻移到新项**（旧项恢复普通样式，列表刷新）、右栏用量卡的模型名与厂商同步变化 → **再点同一项或点运行中的「当前」项不再发指令、聊天流不新增任何提示** → 直接接着对话即是新模型在回答（无需重启）→ 重启桌面壳后该模型仍为「当前」（`last_model` 已写盘）。若正有一轮回复在跑时点选：切换在该轮结束后落地（气泡不被打断）。
- [ ] **添加模型**：模型面板列表末项「＋ 添加模型」（虚线框）→ 点击后列表整体换成添加表单（模型厂商/模型名/API Key/接口类型/Base URL/模型类型）→ 名称留空点「保存」→ 本地提示「模型名不能为空」且不发指令 → 填名保存 → 提示「模型「X」已添加」、表单关闭回列表且新模型出现在列表（点击可切换生效）→ 重启后端/桌面壳后该模型仍在（已写入用户级 `~/.jarvis/models.toml` 的 `[llm.custom_models."<name>"]`，API Key 入系统 keyring）；顶部 ← 与面板内「取消」均可回列表；三个下拉展开后应为**与皮肤同色的硬边浮层**（荧光绿亮绿反相 / 电光蓝亮青反相 / 金属银灰底黑字，方角无系统蓝高亮），支持 ↑↓/Home/End/Enter 选中与 Esc、点击外部关闭。
- [ ] **修改 / 删除模型配置**：模型面板**双击**任一模型 → 列表整体换成编辑表单（标题「修改模型配置」，上方一行「正在修改「X」的配置」）→ 字段预填该模型现值（厂商/接口类型/Base URL/模型类型；**API Key 框为空**、hint 为「留空保持原 Key 不变（已存密钥不回显）」）→ 改 Base URL（或接口类型）后点「保存修改」→ 提示「配置已更新」；若改的正是运行中的「当前」模型，提示为「配置已更新，当前会话已按新配置重连」且随后对话按新端点生效（无需重启）；改名 + 留空 Key 保存 → 列表出现新名且旧 Key 仍有效（验证「留空=保持原 Key」，不是清空）；双击**内置模型** → 「模型名」输入框**禁用**、hint 提示「内置模型名不可修改（需要新名字请用「＋ 添加模型」）」；**右键自定义模型** → 项右侧出现删除按钮（荧光绿 `[DEL]` / 电光蓝 `<DEL>` / 金属银 `{DEL}`）→ 点击后该项从列表消失并提示「已删除」（删的是当前模型时提示「仍在用它，建议另选一个模型」）→ 右键**内置模型**不出现删除按钮 → 列表空白处右键收起按钮；面板底部有一行提示「双击模型改配置 · 右键自定义模型可删除」。
- [ ] **切音色**：音色面板列出**全量音色目录**（内置+自定义，当前音色置顶），副行透出「适配 X」/「联动 X」预告；点非当前音色 → 该项副行变「· 待生效」且聊天流提示「音色已切换为 X（下次语音生效）」，若发生了 tts_model 联动提示会带「联动 TTS 模型 Y」→ **再点同一项不发指令、不弹提示**（重复点选去重）；重启后端/桌面壳后该音色仍为「当前」（已写盘 settings.toml）。
- [ ] **音色管理（添加 / 编辑 / 删除）**：音色面板末项「＋ 添加音色」（虚线框）→ 点击后列表整体换成 `VoiceForm` 表单（音色名/DashScope 音色 ID/适配模型下拉/描述）→ 名称留空点「保存」→ 本地提示「音色名不能为空」且不发指令；补名缺 ID → 换报「音色 ID 不能为空」→ 填全保存 → 提示「音色「X」已保存，点击列表项可切换」、回列表且新音色在列（custom，可点选切换）→ 重启后端/桌面壳后仍在（已写 `~/.jarvis/settings.toml` 的 `[tts.custom_voices]`）；**双击自定义项** → 进表单预填、音色名**锁定不可改**、顶部显「正在修改「X」」，改 voice_id 后点「保存修改」，保存后列表现新值；**右键自定义项** → 项右侧出现删除按钮 → 点击后该项消失并提示「已删除」；右键**内置音色**不出现删除按钮；面板底部有一行提示「点击切换音色 · 双击自定义音色编辑 · 右键可删除」。
- [ ] **历史会话**：历史面板点会话 → 回放历史消息 + 「已恢复会话「X」」→ 该会话项在左栏高亮选中（`sessions.list` 的 `current` 标记，与模型/音色选中态同口径；选中项再点不重复恢复，新建/标题改名后选中态随列表刷新自愈）。
- [ ] **会话删除 / 改名**：右键会话项 → 项右侧出现删除按钮（荧光绿 `[DEL]` / 电光蓝 `<DEL>` / 金属银 `{DEL}`）→ 点击后会话从列表消失（删当前会话时中栏一并清空开新会话）；列表空白处右键 → 删除按钮收起；双击会话项 → 标题变为可编辑输入框（光标选中）→ 改名后 Enter 或点击别处提交（列表刷新为新名、不再被自动标题覆盖），Esc 或改回原名则取消；单击与双击不相互误触（想改名不会先加载一次）；改名输入框配色随主题（荧光绿/电光蓝/金属银，不再固定蓝边圆角），全选时文字高亮也随主题（荧光绿亮绿反相 / 电光蓝亮青反相 / 金属银黑底白字），无系统蓝底。
- [ ] **右栏指标**：CPU/内存/磁盘每 ~2 秒刷新，CPU>85% 进度条变红。
- [ ] **设置面板**：点标题栏齿轮 ⚙ → 右栏整体切为设置面板（齿轮高亮，再点或面板内 ← 返回信息面板）；点「金属银」→ 界面立即换金属银主题（荧光绿/电光蓝/金属银分段高亮跟随，荧光绿排第一）→ 重启 `npm run dev` 仍保持；点「English」→ 栏标题/按钮/空态等静态文案切英文（状态栏与事件消息仍中文），重启保持；简报时间/检查时间为自绘时间选择器（小时/分钟两个下拉，展开浮层为与皮肤同色的硬边方角、无系统白底蓝高亮），点选即写回、重选当前值不发指令；外观组另有「英文字体 / 中文字体」两行可搜索下拉——首次点开触发本机字体枚举（`queryLocalFonts`，需主进程放行 `local-fonts`；无 API/被拒环境回落常见字体预设，仍可选）、选项以自身字体预览、中文字体行「含中文」标签置顶分组、顶部过滤输入按名筛、选中即时全壳生效（代码块/工具输出仍等宽）、点「默认（终端等宽）」回落、重启保持。
- [ ] **荧光绿主题（默认）**：全新启动（无 localStorage 持久化）默认即荧光绿——CRT 荧光绿终端风（黑底绿字、扫描线叠层、点阵抖动背景、硬边无圆角、等宽字辉光、方块滚动条）+ ASCII 方括号牌（左栏 `[TXT]/[LIV]/[VOX]`、面板 `[HIS]/[MOD]/[VOC]`、输入栏 `[ATT]/[CMP]` 等）+ 反应炉绿系像素颗粒（低分辨率放大）；设置面板切「电光蓝/金属银」→ 重启后仍保持所选（用户显式选择优先）→ 切「电光蓝」为 Y2K 像素复古电光蓝皮肤（电光蓝霓虹 + 铬金属渐变标题/选中态/主按钮 + 赛博网格底 + 像素切角 + 扫描线，尖括号牌 `<TXT>/<LIV>/<VOX>` 等，反应炉蓝系像素颗粒），切「金属银」为 Y2K 像素复古铬银亮色皮肤（铬银金属渐变 + 黑色描边/文字（无蓝相、与电光蓝区分）+ 亮底网格/点阵/扫描线，花括号牌 `{TXT}/{LIV}/{VOX}` 等）；三主题同风格仅配色不同，互切无残留。
- [ ] **语音播报与后端联动设置**：连接后端后进设置面板 → 四组控件在线可改：「主动播报语音」拨动开关（立即生效，关闭后到期提醒不再 TTS 朗读，事件气泡/通知不受影响）、播报音量/语速滑杆（下一次播报即按新值）、每日简报开关 + 简报时间、截止日期开关 + 检查时间（改时间/开关后调度热重注册，无需重启）→ 重启后全部保持（已外科式落盘 settings.toml 对应节，注释与其他字段不丢）；未连接时对应行显离线态文案；后端拒绝（超范围/非法值）时控件回滚原值且聊天流出现错误文案。
- [ ] **复制与手动压缩上下文**：AI 回复结束后气泡右下出现「📋 复制」→ 点击剪贴板可取（按钮短暂变“✓已复制”）；点输入栏 🗜（`[CMP]`）→ 经 `slash.exec` 透传 `/compact`，聊天流出现压缩命令输出卡片（原 📸 主屏截屏按钮因实用性低已于 2026-10 删除）。
- [ ] **管家服务（邮箱服务）**：确保 `~/.jarvis/settings.toml` 的 `[email]` 已启用（与终端 jarvis 共用同一份配置）→ 标题栏右上角「设置」齿轮旁出现「管家服务」按钮（未连后端时置灰不可点）→ 点击后**右栏整体切换为管家服务面板**（服务清单，与设置面板同一替换机制）→ 点「**邮箱服务**」→ 进入后顶部概览卡显示**当前邮箱**（= 发件人，未设发件人则显示 SMTP 账号）、SMTP `host:port`、启用状态、授权码是否已配置，下方「邮箱配置 / 发送邮件」两个标签：
  - **邮箱配置**：字段回填后端现值（授权码恒空、hint 提示「留空保持原授权码不变」）→ 改 SMTP 服务器/端口/发件人/默认收件人 → 点「保存」→ 面板提示已保存，概览卡「当前邮箱」随即刷新为新值；**授权码留空再保存** → 不覆盖原授权码（仍能正常发信）；端口填 `0` 或 `70000` → 本地红字提示非法、不发指令；重启桌面壳后配置仍生效（已写 `settings.toml` 的 `[email]` 表）。
  - **发送邮件**：填 **收件人/主题/正文** → 点「发送」→ 面板内提示发送成功、收件箱收到该邮件（**发送期间中栏流式对话不受影响**，二者互不阻塞）；**主题或正文留空**点「发送」→ 表单内联红字提示必填、不发指令；**收件人留空**→ 发送到 `[email].default_recipient`；**故意填错授权码**→ 表单内联显示认证失败原文（错误不落入聊天流）；「取消」/成功态「关闭」回服务清单；面板 ← 或再点标题栏按钮回信息面板；再次进入面板时应停在服务清单（不残留上次表单）。
- [ ] **管家服务（感知源，阶段 9 W2）**：确认后端以 serve 模式跑着（否则总览应直说「未接线」）→ 标题栏「管家服务」→ 服务清单应有两个入口（邮箱服务 / 感知源）→ 点「**感知源**」：
  - **默认全关**：刚进面板时总开关与逐源开关均应为关、计数区显「尚无事件」——**打开面板本身绝不开始采集**；
  - 拨**总开关** → 无需找「保存」按钮，**顶部反馈条**（粘在子返回头下方，不随面板滚出视野）提示「已保存并重装配」，总览的「运行状态」变「采集中」（此时逐源仍全关）；再拨一下总开关 → 回到未运行；
  - 开「**前台窗口**」→ 随意切换几个应用 → 子标签「最近事件」应出现 `focus_changed` 行（时间 + 源名 + 一句摘要 + 显著性），「感知源」行上徽标应变「采到 N 条」，总览的计数与留痕文件路径同步变化（可开文件对账）；
  - 子标签「采集名单」→ 往「排除应用」加一行当前正用的应用名→ 保存 → 再切到该应用**不应再产生事件**；切到「最近事件」里已采到的历史行仍在（历史不回滚）；改完重启后端后配置仍生效（已写 `settings.toml` 的 `[percept]` 表，其他节与注释不丢）；
  - 分钟阈值填 `1441` 或留空→ 本地红字提示非法、不发指令；名单里写重复行/空行 → 保存后后端去重丢空（面板回显规范化结果）；没改任何字段点「保存」→ 不发指令也不报错；
  - 「日历事件 / 系统资源 / 定时提醒」三个收编位**应只有说明没有开关**（本期未装配，给了开关就是假可用）；
  - 开「**摄像头在场**」（需本机装了 mediapipe 且有摄像头）→ 关掉时应释放摄像头（关掉后其他视觉工具能立即拿到设备）；若本轮未能重装配总线，面板应如实提示「已保存，但需重启后端后生效」而不是假装已生效。
  - 总览「**打扰预算**」行：后端启用预算时显「今日 N/M · 待补播 K 条」，与 `~/.jarvis/notify_state.json` 对得上；把 `notify_budget_enabled` 改 false 重启 → **整行消失**（而不是编一个 0/0）；
  - **口播验收**：让一条该播的事件上屏（如仓库源 `echo x >> README.md`）并开着 TTS → 念的是「切到 资源管理器，jarvis 文件夹」这类人话，**不应听到 `.exe`、反斜杠、逐字符拼读**；而 `events.jsonl` 里的 `summary` 仍是完整路径（留痕不被口播改写）。
- [ ] **感知首次引导（阶段 9 W2 第 7 步）**：先造“从未表过态”的环境（删 `~/.jarvis/percept/consent.json`、`settings.toml` 里不留 `[percept]` 表且总开关为关）→ 启动桌面壳并连上后端 → 聊天区应出现一条 **🔍 开头**的引导气泡（Windows 系统通知同样弹一次，但**不应被 TTS 朗读**），同时标题栏「管家服务」按钮右上角亮脉动提示点、悬停文案变为引导说明 → 点进面板 → 提示点与引导文案同时消失（不是未读计数）→ 重启桌面壳**不应再出现该气泡**（后端已记 `asked_at`）→ 在面板上拨一次总开关 → `consent.json` 里 `choice` 应为 `on`（只改名单不会写 `choice`）。
- [ ] **右栏任务中心**：对话「10 分钟后提醒我喝水」→ 提醒出现在任务中心列表（时间升序）；到点触发后条目消失、⏰ 气泡上屏；对话设截止日期后可见倒计时（临期黄/逾期红）；每日简报触发后「最近简报」折叠块可展开。
- [ ] **右栏跨会话目标与副作用账本（阶段 10 W3）**：先把后端 `settings.toml` 的 `[tasks] enabled=true` 且配好凭据 → 头部应显「驱动器在盯」（若配置关着则显「[tasks] 是关的」、线程未起显「驱动器未起」，**三者文案不得互混**）→ 点「建一个」填「收集纪要; 汇总成 weekly.txt」→ 新目标出现在列表且进度 `0/2` → 等它跑到一步需要写文件的步骤（或让模型自己开干）→ 目标行应出现「等你授权」chip 与被拦工具名 → 点「批准并重试」→ 面板内反馈条应原样列出**放行范围（工具名 + 目标目录 + 30 分钟）**，且那句「Bash 这类不带路径参数的调用放宽不了」不能丢 → 打开 `~/.jarvis/leases.json` 对得上刚签的那条 → 重试后该步真能推过（文件落盘）。
  副作用账本：让一轮对话改一个已存在的文件 → 「最近记录」出现 `applied` 行 → 点「回退这一轮」→ **第一拍只列影响面（哪些文件 + 几个新建文件会被删）且一字未动** → 取消→ 文件不变；再来一次→ 点「确认执行」→ 工作区回到本轮开始前，该行变「已撤销」；发一封邮件 → 该行应显「撤不回」（hover 看后端原因）而**不是**一个无效按钮；延时窗口内的预约（如定时发送）在「扣住待发」里带倒计时，点「撤回」应立即消失且不弹二次确认。
- [ ] **右栏用量与健康**：发几轮对话后用量卡 token/轮数增长（口径同 REPL `/cost`）；运行健康显示 MCP 连接数与工具数（未启用显示“MCP 未启用”）——**MCP 为后台预热（约 9s）**，若刚连上时快照未就绪先显示“未启用”，连接落定后应自动刷新为真实连接态（依 `mcp_ready` 事件，无需重启）；日志流随对话/工具调用滚动追加。
- [ ] **实时语音**（如后端支持）：切「实时」模式 → 反应炉进入聆听/说话律动 → 状态栏文案随 `status` 事件变化。
- [ ] **半双工语音**（如后端配好 STT/TTS）：切「🎤 语音」模式 → 中栏出现语音状态条「聆听中...」 → 说话自动识别上屏用户气泡 → AI 回复流式上屏 + 本机扬声器 TTS 播报 → 自动回聆听（连续循环）；播报中点「✋ 打断」或直接开口 → 立即停播回聆听（双通道）；点「⏹ 退出语音」或说退下词 → 回文本模式（**告别语气泡不应残留字面 `<standby/>` 标记**——退下信令只驱动状态机，不上屏）；语音中切「实时」→ 自动停语音（互斥）。
- [ ] **托盘**：点关闭按钮 → 窗口隐藏到托盘（进程不退）；托盘菜单「显示」→ 窗口恢复；二次运行 `npm run dev` → 聚焦已有窗口（单实例锁）。
- [ ] **退出回收**：托盘菜单「退出」→ 窗口关闭 + **Python 进程被杀**（任务管理器确认无孤儿 `python -m agent.serve`；Windows 走 `taskkill /T` 杀进程树）。
- [ ] **主动播报**：`briefing_time` 临时改为 2 分钟后重启 `npm run dev` → 到点聊天区出现简报气泡 + Windows 系统通知；对话「1 分钟后提醒我喝水」→ 到点 ⏰ 气泡 + 通知；关闭窗口只剩托盘时通知仍弹（主进程 Notification 不依赖窗口）。详见 [`jarvis/docs/plans/proactive-desktop.md`](../../jarvis/docs/plans/proactive-desktop.md)。
- [ ] **降级路径**：故意把 `JARVIS_REPO` 指向不存在目录 → 弹窗提示「找不到 jarvis 仓库」+ 日志路径，遮罩显示诊断文案（不白屏、不悬挂）。

## 6. 二期路线图

**已完成（本迭代）**：

- ✅ PyInstaller 冻结后端（`jarvis/packaging/`）+ 随包 `extraResources` 分发，脱离本机 Python 依赖。
- ✅ NSIS 安装包配置（`electron-builder.yml`）+ 打包态 `backend.ts::resolveLaunchPlan` 内置 exe 分支。
  （环境卡点：winCodeSign 解压需符号链接权限，见上「打包发布」的开发模式/管理员/CI 三选一的解法。）
- ✅ CI 自动发布（`.github/workflows/release.yml`）：`windows-latest` 并列检出双仓 → `npm run dist`
  → 产物挂 GitHub Releases，规避本机符号链接权限卡点，一条 `v*` tag 即出可下载安装包。
- ✅ `electron-updater` 自动更新（2026-10）：启动静默检查 → 有新版本时标题栏出现「更新」按钮
  → 点击下载（带百分比进度）→「重启安装」→ 退出 → NSIS 覆盖安装 → 自动重启。
  仅打包态生效（dev 模式下 `app.isPackaged=false` 直接跳过）；发布侧 `electron-builder.yml`
  配 GitHub provider 以生成 `dist/latest.yml`，`release.yml` 校验并随安装包一同上传（客户端靠它
  发现新版本）。**本期未做代码签名**，更新包运行时 Windows SmartScreen 仍会提示「未知发布者」，属预期。
- ✅ `electron-updater` 已打进主进程 bundle（`electron.vite.config.ts` 的
  `externalizeDepsPlugin({ exclude: ['electron-updater'] })`）——因 `files` 不含 `node_modules`，
  外置会导致运行时报 `Cannot find module 'electron-updater'`。

**待做**：

- 主动播报 TTS 待机语音（`proactive_notify` 事件已带全文，届时桌面侧加语音通道即可，不改协议）。
- 代码签名（Windows 证书，消除 SmartScreen「未知发布者」提示；也是自动更新体验的最后一环）。
- 故障恢复 / 安全模式（后端崩溃自动重启 + 降级 UI）。
- macOS / Linux 安装包（mac 需签名 + 公证）。
- 实时语音模式深度接入、手机 Bridge 复用。
- **渲染层组件目录分组**（与下一条同批做）：`src/renderer/src/components/` 的 31 个平铺文件按
  [组件地图](../src/renderer/src/components/README.md) 第二节的六簇切子目录（`ui/` `chat/` `butler/`
  `extension/` `task/` + 根目录留布局骨架），同时定死边界规则：`ui/` 不得 import `stores/`，簇与簇之间
  只走 props / 事件、不许跨簇 import 内部子组件。改动面实测 27 处目录内同级 import + 32 处外部
  按路径引用（`App.tsx` 8 处 + 10 个测试文件）+ 15 处文档路径 + `.aoci/baseline.json` 25 条索引，
  属零行为变更，故单独成批提交（先纯 `git mv`，再改 import 与文档），不与功能改动混提。
- **已越过 / 逼近 800 行上限的文件拆分**（2026-10 实测行数，按欠账大小排序）：先拆**已越限的
  测试文件**（拆法同 2026-10 那一次：`dispatcher.test.ts` 按事件域拆出 `dispatcherNotify.test.ts`
  与共用夹具 `dispatcherFixtures.ts`）——`test/renderer/components.test.tsx` 1505 行、
  `test/renderer/backendStore.test.ts` 1181 行；代码侧余量递减：`i18n.ts` 753 行（管家服务与
  任务中心两域已各自拆出 `i18n-butler.ts` / `i18n-tasks.ts`）、`shared/contracts.ts` 696 行
  （extension 类型已拆出 `extension-contracts.ts`）、`stores/backendStore.ts` 719 行（邮箱与任务
  中心两组动作已于 2026-10 拆出 `butlerActions.ts` / `taskActions.ts`）、`components/LeftSidebar.tsx`
  606 行、`components/ChatArea.tsx` 545 行。按 code-structure 规则，**改动这些文件前须先拆再写**。
