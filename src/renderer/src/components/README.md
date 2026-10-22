# 组件地图（renderer/src/components）

> 本目录 31 个组件是平铺的，看文件名不一定知道它管哪块界面。想知道「屏幕上这个东西是哪个文件」，查这张表，别挨个打开。
>
> 每个文件头都有职责与设计动机的注释块，表里「要点」是从那里摘的 —— **改了行为要两处同步**。
>
> @author aceFelix

## 一、按「你在界面上看到了什么」查

| 界面上的东西 | 找这个文件 |
|---|---|
| 顶栏：拖动区、窗口最小/最大化/关闭、齿轮、管家服务、扩展服务、更新按钮 | `TitleBar.tsx` |
| 左栏：模式切换（文本/实时/语音）+ 历史会话/模型/音色三面板 + 状态 footer | `LeftSidebar.tsx` |
| 左栏「＋ 添加模型」或双击模型项弹出的表单 | `ModelForm.tsx` |
| 左栏「＋ 添加音色」或双击音色项弹出的表单 | `VoiceForm.tsx` |
| 左栏底部「项目」区（当前项目名 + 打开文件夹） | `ProjectSection.tsx` |
| 中栏：消息流 + ask_user 条 + 输入框 | `ChatArea.tsx` |
| 中栏里**单条气泡长什么样**（用户/AI/思考块/工具组/系统提示/斜杠输出） | `ChatMessageViews.tsx`（从 ChatArea 拆出的纯渲染） |
| 输入框敲 `/` 弹出的命令补全层 | `SlashAutocomplete.tsx` |
| 输入栏「跨设备协同」下拉按钮（📱 手机 / 💬 微信） | `RemoteConnectMenu.tsx` |
| 聊天流里内联出现的那张二维码卡片 | `QrcodeCard.tsx` |
| 右栏：任务中心 / 跨会话目标 / 副作用账本 / 会话与用量 / 系统状态 / 运行健康 | `RightSidebar.tsx` |
| 右栏「跨会话目标」台账（驱动器状态 + 目标行 + 批准/暂停/删除/批量撤销） | `SpineTaskPanel.tsx` |
| 右栏「副作用账本」清单（扣住的预约 + 最近记录 + 整轮回退两拍确认） | `EffectJournalPanel.tsx` |
| 齿轮进来的**设置**面板（四个分组：外观 / 语音播报 / 每日简报 / 截止日期追踪） | `SettingsPanel.tsx` |
| 设置里「英文字体 / 中文字体」两行 | `FontPicker.tsx` |
| 标题栏「管家服务」进来的面板（服务清单） | `ButlerPanel.tsx` |
| └ 邮箱服务：当前邮箱概览 + 标签页容器 | `EmailServicePanel.tsx` |
| └ 邮箱服务 →「邮箱配置」表单（写 settings.toml `[email]`） | `EmailConfigForm.tsx` |
| └ 邮箱服务 →「发送邮件」表单（直连后端工具，不经模型） | `EmailForm.tsx` |
| 标题栏「感知源」面板（阶段 9 W2，管家服务内嵌） | `PerceptSourcePanel.tsx` |
| └ 子标签「感知源」：逐源开关 + 运行账本 | `PerceptSourceList.tsx` |
| └ 子标签「采集名单」：白名单目录/仓库/发件人 + 排除应用 | `PerceptScopeForm.tsx` |
| └ 子标签「最近事件」：隐私自查，原样渲染后端 summary | `PerceptEventList.tsx` |
| 标题栏「扩展服务」面板（五类入口清单） | `ExtensionPanel.tsx` |
| └ MCP 服务：增删改 + 启停（写 mcp.json / mcp_disabled.json） | `ExtensionMcpPanel.tsx` |
| └ 内置工具、技能（两份只读清单同文件） | `ExtensionListPanels.tsx` |
| └ 插件、harness（两份可安装市场同文件） | `ExtensionMarketPanels.tsx` |
| 五个扩展子面板共用的返回头 + 取数 hook | `extensionShared.tsx` |
| 背景那个方舟反应炉动画（canvas） | `ReactorCanvas.tsx`（绘制逻辑在 `../reactor.ts`） |
| 任何自绘下拉框（替代原生 `<select>`） | `ThemedSelect.tsx` |
| 自绘时间选择（时/分两个下拉，复用 ThemedSelect） | `ThemedTimePicker.tsx` |

## 二、按簇看（行数是本机实测，用于估改动量）

| 簇 | 文件 | 行数 | 边界特征 |
|---|---|---|---|
| **ui 原语** | ThemedSelect (295) · ThemedTimePicker (71) · FontPicker (120) | 486 | 只 import `react` / `../i18n` / `../lib/fontUtils`，**零 store 依赖**，被四处跨组复用 |
| **chat 对话区** | ChatArea (546) · ChatMessageViews (284) · SlashAutocomplete (225) · QrcodeCard (86) · RemoteConnectMenu (105) | 1246 | 都读 `chatStore` / `remoteStore` / `backendStore`，围绕中栏与输入栏 |
| **butler 管家服务** | ButlerPanel (96) · EmailServicePanel (136) · EmailConfigForm (242) · EmailForm (152) · PerceptSourcePanel (293) · PerceptSourceList (160) · PerceptScopeForm (199) · PerceptEventList (78) | 1356 | 一棵闭合的树：`ButlerPanel → EmailServicePanel → Email*` 与 `→ PerceptSourcePanel → Percept*`，外部只有 `App.tsx` 引它 |
| **extension 扩展服务** | ExtensionPanel (107) · ExtensionMcpPanel (313) · ExtensionListPanels (164) · ExtensionMarketPanels (359) · extensionShared (94) | 1037 | 五文件只互引 + 共用 `extensionShared`，**对外零引用**，最干净的一簇 |
| **task 任务中心**（2026-10 阶段 10 W3） | SpineTaskPanel (395) · EffectJournalPanel (352) | 747 | 两文件只读 `tasksStore` 快照与 `backendStore` 注入的动作，数据契约在 `shared/tasks-contracts.ts`；两个区块共用一份 `notice`/`confirm` 态（靠 `panel` 与 `kind` 分流） |
| **布局骨架**（留在本目录） | LeftSidebar (607) · RightSidebar (299) · SettingsPanel (309) · TitleBar (150) · ModelForm (241) · VoiceForm (201) · ProjectSection (173) · ReactorCanvas (44) | 2024 | 被 `App.tsx` 直接组装的壳层，以及挂在左栏下的资源表单 |

## 三、为什么不先分目录

`components/` 是本仓库唯一没按层分组的目录（同级已有 `api/` `stores/` `audio/` `lib/` `styles/`），分目录是对的，但收益只有「发现性」和「边界可执行」，而代价是实测的 **27 处目录内同级 import + 32 处外部按路径引用**（`App.tsx` 8 处 + 10 个测试文件）、15 处文档路径与 `.aoci/baseline.json` 25 条索引全要跟着动，**换回零行为变更**。所以：

- 现在：先用这张地图解决「不知道哪个文件管啥」，成本一份文档；
- 下次开发窗口：连同 `stores/backendStore.ts`（719 行，邮箱与任务中心两组动作已于 2026-10 拆出
  `butlerActions.ts` / `taskActions.ts`，余下的是连接生命周期与会话/模型类动作）一起按上面的簇
  切目录，并定死边界规则（`ui/` 不得 import `stores/`；簇与簇之间只走 props / 事件，不许跨簇
  import 内部子组件）。排期见 [开发指南 · 二期路线图](../../../../docs/development.md#6-二期路线图)。

切目录时用两个独立提交：先纯 `git mv`（一行内容不改，`git log --follow` 能续上 blame），再改 import 与文档。
