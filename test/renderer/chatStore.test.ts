/**
 * chatStore 单测 —— 消息流 store 的全部 action（流式增量、工具卡回填、历史回放）。
 *
 * 这是"消息气泡流式渲染"的数据层验证；组件层渲染在 components.test.tsx。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, type MessageItem } from '@renderer/stores/chatStore'

/** 取指定 kind 的消息（收窄类型，方便断言字段）。 */
function pick<T extends MessageItem['kind']>(
  kind: T
): Array<Extract<MessageItem, { kind: T }>> {
  return useChatStore
    .getState()
    .messages.filter((m) => m.kind === kind) as Array<Extract<MessageItem, { kind: T }>>
}

beforeEach(() => {
  useChatStore.getState().clear()
})

describe('chatStore', () => {
  it('addUser 追加用户气泡', () => {
    useChatStore.getState().addUser('你好')
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'user', text: '你好' })
  })

  it('addUser 带缩略图：images 字段存在；无附件为 undefined', () => {
    useChatStore.getState().addUser('看图', ['data:image/png;base64,QUJD'])
    useChatStore.getState().addUser('纯文本')
    const [withImg, plain] = pick('user')
    expect(withImg.images).toEqual(['data:image/png;base64,QUJD'])
    expect(plain.images).toBeUndefined()
  })

  it('addUser 带来源标记（远端微信/手机），本地输入无 source', () => {
    useChatStore.getState().addUser('后天天气', undefined, 'wechat')
    useChatStore.getState().addUser('本地输入')
    const msgs = useChatStore.getState().messages
    expect(msgs[0]).toMatchObject({ kind: 'user', text: '后天天气', source: 'wechat' })
    expect((msgs[1] as { source?: unknown }).source).toBeUndefined()
  })

  it('addUserTranscript 无在途回复：追加到末尾，不扰动历史', () => {
    useChatStore.getState().addUser('早前的问题')
    useChatStore.getState().appendAssistantText('早前的回答')
    useChatStore.getState().finishAssistant()
    useChatStore.getState().addUserTranscript('新说的这句话')
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(3)
    expect(msgs[2]).toMatchObject({ kind: 'user', text: '新说的这句话' })
  })

  it('addUserTranscript 转写滞后：插到已建的流式 AI 气泡之前（问在上答在下）', () => {
    // 复现实时语音时序：AI 回复转写增量先到（气泡已建），用户输入转写后到
    useChatStore.getState().appendAssistantText('你好呀～我在呢～')
    useChatStore.getState().addUserTranscript('你好，贾维斯在吗？')
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ kind: 'user', text: '你好，贾维斯在吗？' })
    expect(msgs[1].kind).toBe('ai')
  })

  it('addUserTranscript 只插到流式气泡前：已完结的历史 AI 气泡保持在上面', () => {
    // 开场问候已说完（非流式）→ 本轮回复流式中 → 转写后到应插在两者之间
    useChatStore.getState().appendAssistantText('晚上好，先生。')
    useChatStore.getState().finishAssistant()
    useChatStore.getState().appendAssistantText('我在呢～')
    useChatStore.getState().addUserTranscript('在吗？')
    const msgs = useChatStore.getState().messages
    expect(msgs.map((m) => m.kind)).toEqual(['ai', 'user', 'ai'])
    expect(msgs[1]).toMatchObject({ kind: 'user', text: '在吗？' })
  })

  it('流式增量累加到同一 AI 气泡', () => {
    const s = useChatStore.getState()
    s.appendAssistantText('你好')
    s.appendAssistantText('，世界')
    const ai = pick('ai')
    expect(ai).toHaveLength(1)
    expect(ai[0]).toMatchObject({ text: '你好，世界', streaming: true })
  })

  it('thinking 与 text 分别累加到同一气泡', () => {
    const s = useChatStore.getState()
    s.appendThinking('思考中')
    s.appendAssistantText('答复')
    expect(pick('ai')[0]).toMatchObject({ thinking: '思考中', text: '答复' })
  })

  it('finishAssistant 结束流式并清 busy', () => {
    const s = useChatStore.getState()
    s.setBusy(true)
    s.appendAssistantText('完成')
    s.finishAssistant()
    const st = useChatStore.getState()
    expect(st.busy).toBe(false)
    expect(pick('ai')[0].streaming).toBe(false)
  })

  it('finishAssistant 收尾未回填的工具卡（reply.abort/中途报错不留“执行中”）', () => {
    // 回归：取消回复时 Bash 子进程被 kill、不发 tool_result，旧版 finishAssistant
    // 不碰未完成的卡，导致卡片永远停在“执行中”、用户以为命令卡死。@author aceFelix
    const s = useChatStore.getState()
    s.setBusy(true)
    s.addToolCard('Bash', 'call_run', '{"command":"rmdir ./-p"}')
    expect(pick('tool')[0]).toMatchObject({ done: false })
    s.finishAssistant()
    const card = pick('tool')[0]
    expect(card.done).toBe(true)
    expect(card.isError).toBe(true)
    expect(card.output).toContain('本轮已结束')
  })

  it('finishAssistant 保留已回填工具卡的结果不变', () => {
    const s = useChatStore.getState()
    s.addToolCard('read_file', 'ok1', '{"p":1}')
    s.fillToolResult('ok1', 'read_file', '内容', false)
    s.finishAssistant()
    expect(pick('tool')[0]).toMatchObject({ done: true, isError: false, output: '内容' })
  })

  it('finishAssistant 后再 append 会新建气泡', () => {
    const s = useChatStore.getState()
    s.appendAssistantText('a')
    s.finishAssistant()
    s.appendAssistantText('b')
    const ai = pick('ai')
    expect(ai).toHaveLength(2)
    expect(ai[0].text).toBe('a')
    expect(ai[1].text).toBe('b')
  })

  it('addToolCard 建卡 + fillToolResult 按 id 回填', () => {
    const s = useChatStore.getState()
    s.addToolCard('read_file', 'call_1', '{"path":"x"}')
    expect(pick('tool')[0]).toMatchObject({ name: 'read_file', done: false })
    s.fillToolResult('call_1', 'read_file', '内容', false)
    expect(pick('tool')[0]).toMatchObject({ done: true, output: '内容', isError: false })
  })

  it('fillToolResult 无匹配卡时补一张完成卡（乱序/回放）', () => {
    useChatStore.getState().fillToolResult('ghost', '工具', '结果', true)
    expect(pick('tool')[0]).toMatchObject({
      toolId: 'ghost',
      done: true,
      isError: true,
      output: '结果'
    })
  })

  it('空输出回填为占位文案', () => {
    const s = useChatStore.getState()
    s.addToolCard('t', 'id1', 'in')
    s.fillToolResult('id1', 't', '', false)
    expect(pick('tool')[0].output).toBe('(无输出)')
  })

  it('ask_user 显示与隐藏', () => {
    const s = useChatStore.getState()
    s.showAskUser('是否继续？')
    expect(useChatStore.getState().askPrompt).toBe('是否继续？')
    s.hideAskUser()
    expect(useChatStore.getState().askPrompt).toBeNull()
  })

  it('addSystem 带 tone', () => {
    useChatStore.getState().addSystem('出错了', 'error')
    expect(pick('system')[0]).toMatchObject({ tone: 'error', text: '出错了' })
  })

  it('replayHistory 回放：用户 / AI / 工具计数，跳过空轮次', () => {
    useChatStore.getState().replayHistory([
      { role: 'user', text: '问' },
      { role: 'assistant', text: '答', tool_count: 2 },
      { role: 'assistant', text: '' }
    ])
    const kinds = useChatStore.getState().messages.map((m) => m.kind)
    expect(kinds).toEqual(['user', 'ai', 'tool'])
    expect(pick('tool')[0].name).toContain('×2')
  })

  it('clear 清空消息 / busy / askPrompt', () => {
    const s = useChatStore.getState()
    s.addUser('x')
    s.setBusy(true)
    s.showAskUser('q')
    s.clear()
    const st = useChatStore.getState()
    expect(st.messages).toEqual([])
    expect(st.busy).toBe(false)
    expect(st.askPrompt).toBeNull()
  })

  // 消息级回溯（撤回）：从尾部数第 N 条用户气泡起裁到列表末尾（与后端
  // checkpoint_ops.rewind 截断 _messages 同口径）。
  // @author aceFelix
  it('rewindTailFromUser(2)：从倒数第 2 条用户气泡起（含）全部删除', () => {
    const s = useChatStore.getState()
    s.addUser('问一')
    s.appendAssistantText('答一')
    s.finishAssistant()
    s.addUser('问二')
    s.appendAssistantText('答二')
    s.finishAssistant()
    expect(useChatStore.getState().messages).toHaveLength(4)
    expect(useChatStore.getState().rewindTailFromUser(2)).toBe(true)
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('rewindTailFromUser(1)：只删最后一条用户轮，保留更早的', () => {
    const s = useChatStore.getState()
    s.addUser('问一')
    s.appendAssistantText('答一')
    s.finishAssistant()
    s.addUser('问二')
    s.appendAssistantText('答二')
    s.finishAssistant()
    expect(useChatStore.getState().rewindTailFromUser(1)).toBe(true)
    expect(useChatStore.getState().messages.map((m) => m.kind)).toEqual(['user', 'ai'])
  })

  it('rewindTailFromUser 不足条数：返回 false、不动列表', () => {
    const s = useChatStore.getState()
    s.addUser('唯一一条')
    expect(useChatStore.getState().rewindTailFromUser(3)).toBe(false)
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('rewindTailFromUser 非法入参（<1）：返回 false', () => {
    useChatStore.getState().addUser('x')
    expect(useChatStore.getState().rewindTailFromUser(0)).toBe(false)
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('rewindTailFromUser 同时复位 busy / askPrompt', () => {
    const s = useChatStore.getState()
    s.addUser('问')
    s.setBusy(true)
    s.showAskUser('确认?')
    expect(useChatStore.getState().rewindTailFromUser(1)).toBe(true)
    const st = useChatStore.getState()
    expect(st.messages).toHaveLength(0)
    expect(st.busy).toBe(false)
    expect(st.askPrompt).toBeNull()
  })
})
