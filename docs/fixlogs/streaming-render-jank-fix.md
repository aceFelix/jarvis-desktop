# 流式输出时工作台卡死、滚轮推不上去

> 修复日期：2026-10-30
> 影响范围：桌面壳中栏对话区（所有模型的长回答 / 长思考）
> 严重程度：思考输出期间界面失去响应，无法翻阅历史，只能干等
> 作者：aceFelix

## 1. 问题现象

用户反馈：**jarvis 持续输出思考时，工作台很容易卡死，什么都干不了，滚轮也不能往上翻。**

复现条件：

- 使用思考型模型（deepseek / qwen3.x），思考内容动辄 1000~2000 字；
- 对话已有一定长度（几十条消息）；
- **思考流式输出期间**最明显，输出结束后恢复。

典型现场：屏幕上「思考过程 · 1437 字」还在往上滚，此时滚动鼠标滚轮，视口被拉回底部，无法查看前面的内容。

## 2. 排查过程

### 2.1 先看数据流

从 WS 事件入口追起：

```typescript
// api/dispatcher.ts:127
case 'assistant_thinking':
  chat.appendThinking(String(payload ?? ''))
```

每个思考增量（一次可能只有几个字）都会调用一次 store action。1437 字意味着**几百次调用**。

### 2.2 再看 store 写入

```typescript
// stores/chatStore.ts:200
appendThinking: (delta) =>
  set((s) => {
    const list = [...s.messages]                       // ① 复制全部历史消息
    list[idx] = { ...cur, thinking: cur.thinking + delta }
    return { messages: list }                          // ② 新引用 → 所有订阅者重渲染
  })
```

即使只多了一个字，`messages` 数组也是全新的引用，任何订阅 `messages` 的组件都会重渲染。

### 2.3 再看渲染层

```typescript
// components/ChatArea.tsx:150
const messages = useChatStore((s) => s.messages)
const nodes = useMemo(() => groupMessages(messages), [messages])
...
{nodes.map((n) => ... <MessageView ... />)}
```

`MessageView` / `ToolGroup` **都没有 `memo`**，且 `onRewind={(tail) => void openRewind(tail)}` **每次渲染都新建箭头函数**。结果：**每个增量 → 几十条历史消息全部重渲染**（含 Markdown 正文、工具卡、思考块）。

### 2.4 最后看滚动

```typescript
// components/ChatArea.tsx:229（修复前）
useEffect(() => {
  const el = historyRef.current
  if (el) el.scrollTop = el.scrollHeight      // 无条件吸底
}, [messages])
```

依赖 `[messages]` —— 每个增量都产生新数组 → **每个增量都强制滚到底**。所以用户往上翻的动作**在下一个字到达时就被抵消**，表现为「滚轮坏了」。此外每次读 `scrollHeight` 都会强制同步 reflow。

## 3. 根因分析

三处叠加，缺一不可：

| # | 位置 | 问题 |
|---|---|---|
| ① | `chatStore.appendThinking / appendAssistantText` | 每个增量都重建 `messages` 数组，制造新引用 |
| ② | `ChatArea` 渲染 | `MessageView` 无 `memo` + 回调每次新建 → 历史消息全量重渲染 |
| ③ | `ChatArea` 吸底 effect | 无条件 `scrollTop = scrollHeight`，抢走用户滚动 + 强制 reflow |

计算量估算：**几百个增量 × 几十条历史消息 × 每条 Markdown 渲染** —— 主线程被铺满，滚轮事件排不进队列，于是「卡死 + 滚不动」。

第三点单独看只是一句代码，但它是用户**直接感知**到的症状，容易被误判为「滚轮坏了」「前端挂了」。

## 4. 修复方案

### 4.1 `MessageView` 加 `memo`

```typescript
function MessageViewImpl({ ... }) { ... }
export const MessageView = memo(MessageViewImpl)
```

流式期间只有**正在输出的那一条**会重渲染，历史消息全部跳过。

### 4.2 回调引用稳定化

`openRewind` 改 `useCallback`（只依赖 ref 与 state setter，可空依赖），再包一层稳定的
`handleRewind` 传给 `MessageView`。**这是 memo 能生效的前提** —— 否则每次新建函数，
memo 永远判定「props 变了」。

### 4.3 吸底改为条件吸底

```typescript
const stickRef = useRef(true)

const handleHistoryScroll = useCallback(() => {
  const el = historyRef.current
  if (!el) return
  // 距底 80px 内视为「跟随中」，超出则让出滚动控制权给用户
  stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}, [])

useEffect(() => {
  const el = historyRef.current
  if (el && stickRef.current) el.scrollTop = el.scrollHeight
}, [messages])
```

- 用户主动上翻 → 不再被拽回底部；
- 用户回到底部 → 自动恢复跟随；
- `doSend()` 里强制置 `stickRef = true` —— 自己发消息时一定要看到自己和回复。

### 4.4 思考块折叠时不渲染正文

```typescript
{open ? <div className="thinking-body">{text}</div> : null}
```

上千字的思考块收起后不再占用 DOM。长对话里几十个历史思考块各上千字，常驻 DOM
会让每次回流代价成倍放大。

**口径变更（有意为之）**：旧实现是「折叠也留在 DOM，点开可看」，现在改为「折叠不渲染，
点开时渲染」。用户点开后看到的仍是全文，差别只在于折叠状态下无法用浏览器 Ctrl+F 搜到
思考内容 —— 权衡后认为完全可接受。

## 5. 验证结果

### 5.1 前端测试

- 全量：**536 passed**（原 535，新增 1 条滚动行为测试）
- 调整 1 条既有用例：`思考块：流式中展开、回复结束后自动收起` —— 后半段断言从
  「折叠后仍含正文」改为「折叠后不含正文」，并补充「流式中含正文」，锁定新口径。

### 5.2 新增测试

`聊天区：用户上翻历史后，流式增量不再把他拽回底部` —— 用 `Object.defineProperty` 灌
`scrollHeight` / `clientHeight`（jsdom 无布局引擎，与既有 `slashAutocomplete` 测试同手法），
覆盖三个场景：

1. 在底部 → 新内容跟随到底；
2. 上翻（距底 500px）→ 位置保持不动；
3. 回到底部 → 恢复跟随。

### 5.3 构建

`npm run typecheck` 双程序通过；`npm run build` 成功（187 modules，1.91s）。

## 6. 涉及文件

| 文件 | 改动说明 |
|---|---|
| `src/renderer/src/components/ChatMessageViews.tsx` | `MessageView` 包 `memo`；`ThinkingBlock` 折叠时懒渲染正文 |
| `src/renderer/src/components/ChatArea.tsx` | 条件吸底 + `handleHistoryScroll`；`openRewind` 改 `useCallback`；`doSend` 重置贴底；监听 `onScroll` |
| `test/renderer/components.test.tsx` | 调整思考块用例口径；新增滚动行为用例 |
| `docs/guide/features-chat.md` | 同步折叠口径与滚动行为说明 |
| `docs/fixlogs/streaming-render-jank-fix.md` | 本复盘 |

## 7. 经验总结

### 7.1 「滚轮坏了」往往是渲染阻塞，不是滚动逻辑

用户描述的是「滚轮推不上去」，直觉会去查滚动代码。实际两条原因同时存在：
**吸底抢滚动**（逻辑） + **主线程被重渲染占满**（性能）。只修前者，滚动仍然卡顿。

**排查顺序建议：先看渲染量（memo/节流），再看滚动逻辑。**

### 7.2 memo 的敌人是内联回调

`onRewind={(t) => void openRewind(t)}` 这类写法非常常见，但会让 `memo` 永远失效。
**加 memo 时必须同时检查所有 props 的引用稳定性**，否则改了等于没改。

### 7.3 高频流式更新的通用模式

凡是「每 N 毫秒来一小片文本」的场景，必须同时处理三件事：

1. **渲染粒度**：只有变化的那一项重渲染（`memo` + 稳定 props）；
2. **滚动策略**：不能无条件吸底，要跟随用户意图；
3. **DOM 体积**：折叠内容不该常驻，尤其是可能上千字的思考块。

本仓库的 store 仍采用「每 delta 重建数组」的简单模型（便于推理与测试），靠渲染层
兜住性能。若后续单条消息本身增长到几万字，应考虑在 store 层做逐帧合并（rAF 批量 flush）。
