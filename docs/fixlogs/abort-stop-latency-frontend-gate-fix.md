# 点「停止」后思考流仍在输出：前端停止闸门（aborted）修复

- 日期：2026-10-03
- 仓库：jarvis-desktop（诊断涉及 jarvis 后端复现测试）
- 作者：aceFelix

## 一、问题现象

桌面工作台中，AI 正在流式输出思考块（"思考过程 · 3705 字"持续涨字）时点击
停止按钮（■），状态栏变为"正在停止..."，但**思考文本仍继续往外吐若干秒**，
视觉上就是"停不下来"。

## 二、排查过程

1. **后端取消链路核查**（jarvis 仓库，只读诊断）：
   `abortReply()` → `reply.abort` 指令（serve RPC 直调、不入队）→
   `api.abort_reply()` → `engine.abort_current_reply()` →
   `loop.call_soon_threadsafe(task.cancel)` 取消 `_send_task`；
   `query_loop.run()` 捕获 `CancelledError` 后收尾并发 `assistant_done`。
   各层（orchestrator / error_recovery / mcp / anthropic_provider）均正确
   向上传播取消。
2. **anthropic SDK 流关闭确认**：`messages.stream()` 的 `__aexit__` 走
   `stream.close()` → httpx `response.aclose()`，非阻塞，不会拖住事件循环。
3. **复现测试实测**：新增
   [`jarvis/tests/ui/test_abort_latency.py`](../../jarvis/tests/ui/test_abort_latency.py)，
   用真实引擎 + 真实 `AnthropicProvider` + 本地 fake SSE（每 30ms 一条
   thinking_delta 共 300 条）测得：从调用 `abort_current_reply()` 到
   `assistant_done` 到达事件队列，**取消延迟约 0.001s**（纯 asyncio 对照组
   0.006s）。后端取消是即时的，排除引擎 / provider / query_loop 因素。
4. **前端消费侧定位**：WS 事件由 `_pump_loop` 每 50ms 轮询、FIFO 逐条转发；
   点停止的瞬间，取消前已发出、正在途中或已在渲染队列里的
   `assistant_thinking` / `assistant_text` 增量仍会被 dispatcher 无条件
   `appendThinking` / `appendAssistantText` 逐条渲染——缺一道"停止后丢弃
   在途增量"的闸门。

## 三、根因

后端取消即时，但**前端 dispatcher 对停止后残留的在途增量事件没有过滤**，
逐条继续渲染，造成"点了停止还在输出思考"的观感。

## 四、修复方案：chatStore 增加 aborted 停止闸门

| 文件 | 改动 |
|---|---|
| `src/renderer/src/stores/chatStore.ts` | 新增 `aborted: boolean` 状态 + `setAborted` action；`clear()` 一并重置 |
| `src/renderer/src/stores/backendStore.ts` | `abortReply()` 本地立即 `setAborted(true)`；后端回执 `false`（已无在跑轮次可取消的竞态）时本地兜底收尾；`sendMessage()` 开头 `setAborted(false)` |
| `src/renderer/src/api/dispatcher.ts` | `assistant_text` / `assistant_thinking` / `tool_use` / `tool_result` 四个增量事件在 `chat.aborted` 时直接丢弃；`assistant_done` 到达时解除闸门 |

闸门生命周期：`abortReply` 置 true → 增量事件全部丢弃（视觉"点了就停"）→
`assistant_done`（引擎 finally 必发，含取消路径）置 false 收尾。

## 五、验证

- `npx vitest run`：18 文件 / 345 用例全过（含新增 2 个闸门用例：
  丢弃在途增量、`assistant_done` 解除闸门恢复渲染）
- `npm run typecheck`：node / web 双工程通过
- `npm run build`：构建通过
- `jarvis` 侧 `test_abort_latency.py`：2 用例通过（取消延迟 < 1s 断言）

## 六、已知遗留（非本次路径，未修）

dashscope / zai 的线程桥接 provider（`agent/llm/zai_provider.py` 等）取消时
消费侧 `finally: thread.join(timeout=5)` 会同步冻结引擎 loop 最多 5s，且
worker 线程无停止标志会跑完剩余流。用户当前模型走 anthropic 原生 asyncio
流式路径不触发此问题；若后续在这两个 provider 上复现"停止慢"，需给桥接
worker 加停止标志并改用非阻塞等待。
