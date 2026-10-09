# 桌面实时语音用户气泡排在 AI 回复之后修复复盘

> 桌面壳实时语音里，用户说的话上屏在 AI 回复气泡**之后**（问在下、答在上）。
> 根因：DashScope 输入转写（`input_audio_transcription.completed`）异步滞后，
> 常晚于 AI 回复转写到达，桌面按事件到达顺序追加气泡。作者 aceFelix。

## 问题现象

- 场景：jarvis-desktop 桌面壳「[LIV] 实时」语音对话，语音说「你好，贾维斯在吗？」。
- 表现：AI 回复气泡（「你好呀～我在呢～…」）先上屏，**用户气泡「你好，贾维斯在吗？」
  排在它后面**——阅读顺序颠倒，像 AI 抢答。
- 复现路径：桌面实时语音任意说一句话，概率性复现（转写滞后越大越明显）。
- 影响范围：实时双工（`/talk` 桌面全双工桥）；半双工 `/voice` 为 STT 完成后才调 LLM，
  时序天然正确，不受影响。

## 排查过程

1. 截图确认顺序颠倒后，先查会话存储是否乱序——`Hello-jarvis.json` 消息顺序正常
   （该文件同时用于排查同轮的「小云」人设问题，见 jarvis 侧
   `docs/fixlogs/realtime-talk-xiaoyun-persona-fix.md`），排除存储层。
2. 查引擎事件顺序（`agent/voice/realtime_engine.py`）：用户转写走
   `conversation.item.input_audio_transcription.completed`（L636），AI 回复转写走
   `response.audio_transcript.delta`（L674），**两条独立服务端通道，到达顺序无保证**；
   DashScope 输入转写为异步转写，实测常滞后于响应流。
3. 查桌面渲染链（`src/renderer/src/api/dispatcher.ts` L332）：`user_transcript` →
   `chat.addUser` **纯尾部追加**；`ai_transcript_delta` 先到即先建 AI 气泡 →
   用户气泡落其后。根因确认：**按到达顺序渲染 + 服务端顺序无保证**。

## 根因分析

实时协议里「用户说什么」和「AI 回复什么」是两条异步转写通道，到达顺序不等于
对话顺序；渲染层把「到达顺序」当「对话顺序」用。属**展示层排序缺位**——引擎层
修（在 RealtimeEngine 里缓冲 AI 转写等用户转写）会碰这套精密的回声保护/救援
状态机，风险高收益低；presentation 层修复即可。

## 修复方案

桌面渲染层插入式排序（jarvis-desktop）：

- `src/renderer/src/stores/chatStore.ts`：新增 `addUserTranscript(text)` 动作——
  从列表尾部向前越过 ai/tool 项，**遇到流式中的 AI 气泡（本轮回复起点）即停**，
  把用户气泡插到它前面；沿途无流式气泡（无在途回复，如开场问候已说完）则保持
  追加语义，不扰动历史（避免把新问题插到已说完的开场问候之前）。
- `src/renderer/src/api/dispatcher.ts`：`user_transcript` 事件改走
  `addUserTranscript`（`voice_user_transcript` 半双工路径时序天然正确，不动）。

渲染层纯排序，不碰协议与引擎；工具卡场景下转写实际先于工具序列到达，现有
「停在本轮流式气泡」边界已覆盖。

## 验证结果

- `npm run typecheck`（node + web 两套 tsc 程序）通过；
- `npx vitest run test/renderer/chatStore.test.ts test/renderer/dispatcher.test.ts`
  → **94 passed**（含 4 个新增顺序用例：无在途回复追加 / 滞后插前 / 问候不越界 /
  dispatcher 层时序复现）；
- 人工验证（待用户复测）：实时语音说话后，用户气泡应在 AI 回复气泡上方。

## 涉及文件

| 文件 | 改动说明 |
|---|---|
| `src/renderer/src/stores/chatStore.ts` | 新增 `addUserTranscript`（尾部流式气泡前插入） |
| `src/renderer/src/api/dispatcher.ts` | `user_transcript` 改走 `addUserTranscript` |
| `test/renderer/chatStore.test.ts` | +3 顺序用例 |
| `test/renderer/dispatcher.test.ts` | +1 转写滞时时序用例 |

## 经验总结

- **事件流渲染别把「到达顺序」当「业务顺序」**：多通道异步事件（转写/响应/工具）
  上屏前先按轮次归位；「插到本轮流式起点前」是低风险的通用手法。
- 排序边界要防「插过头」：以流式气泡为界可天然避开已完结的历史气泡
  （开场问候、上一轮回复），无需引入时间戳。
- 实时语音的时序类 bug 需要在测试里**显式复现事件乱序**（先 AI 增量后用户转写），
  正序用例永远测不出来。
