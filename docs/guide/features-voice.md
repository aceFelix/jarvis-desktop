# 语音与多端接入

> [← 返回 README](../../README.md) · [对话体验](features-chat.md) · [三栏面板与设置](features-panels.md) · [架构说明](../architecture.md)

桌面壳在语音与多端协同上把终端 jarvis 的能力完整搬进 GUI：真全双工语音（说话即打断）与手机 / 微信接入同一会话。

---

## 全双工语音通路（/talk，2026-09-28）

🎙 实时语音模式为**真全双工**（可对着 AI 说话打断），音频 I/O 不在 Python 侧，而在渲染进程：

- **上行** `src/renderer/src/audio/talkCapture.ts`：`getUserMedia({echoCancellation:true})` 浏览器系统级
  AEC（消除 AI 外放回采，服务端不再被回声误触发）+ AudioWorklet（Blob URL 注册）整数比抽取重采样到
  16kHz PCM16，~100ms/帧经 `talk.audio` 指令（fire-and-forget 无回执）直喂服务端 `RealtimeEngine`（`BridgeMic`）。
- **下行** `src/renderer/src/audio/talkPlayback.ts`：订阅 `talk_audio` 事件（24kHz PCM 帧 base64），
  AudioContext `nextTime` 顺序排播免咔哒；空串 payload = 打断 flush（立即清空待播帧）。
- **开关**：`backendStore.toggleTalk` 先乐观置模式→启动采集（失败回退并报错）→`talk.start {duplex:true}`；
  服务端据此以全双工桥接模式启动（音频走 WS 帧而非本机 pyaudio，关闭半双工静音与软件回声抑制）。
- **语音对话进会话历史**：实时语音的问/答转写由服务端按轮配对后写入当前会话
  （转写滞后自动纠序、回声轮不落库、退出时残留半轮兜底补存）；半双工语音（[VOX]）
  每轮结束同样自动存盘。左栏会话可回看/恢复，与文本对话同一套存盘规则
  （2026-10 修复：此前两类语音内容退出即丢，会话只剩文本轮）。
- **实时语音工具面（默认 builtin，勿改 all）**：默认只带 `get_current_time` /
  `end_conversation` 两个语音专用工具。`settings.toml` 的 `[realtime_talk] tools_mode = "all"`
  会把 ToolRegistry + MCP 全量（实测 294 个 schema）发给 DashScope 实时 API——探针实测
  **响应创建延迟随工具数近似线性增长**（2 个 0.67s → 294 个 3.45s → 450 个 4.89s），
  该延迟与响应救援、尾音重检叠加会造成响应被取消的死循环：说完话半天无回复
  （2026-10-09 曾误改默认值造成实时语音完全不可用，已回退），不要开启。
  **需要调用工具时走半双工语音（`/voice`）**，它走标准 LLM API 天然支持全量工具。
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
