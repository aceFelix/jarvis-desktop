// @vitest-environment jsdom
/**
 * 渲染层组件测试（@testing-library/react）—— 覆盖计划 B5 要求的
 * "消息气泡流式渲染" 与 "面板切换"，另加标题栏窗口控制、右栏指标
 * 与左栏模型面板流（添加 models.add / 双击改配置 models.edit /
 * 右键删除 models.remove）。
 *
 * 说明：不渲染 App / ReactorCanvas（会挂载 canvas 动画，jsdom 无 2D 上下文），
 * 逐个渲染纯展示组件；后端 client 默认 null，组件不会真正发起 WS 连接。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import ChatArea from '@renderer/components/ChatArea'
import LeftSidebar from '@renderer/components/LeftSidebar'
import RightSidebar from '@renderer/components/RightSidebar'
import SettingsPanel from '@renderer/components/SettingsPanel'
import TitleBar from '@renderer/components/TitleBar'
import { useChatStore } from '@renderer/stores/chatStore'
import { useLeftStore } from '@renderer/stores/leftStore'
import { useMetricsStore } from '@renderer/stores/metricsStore'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useRightStore } from '@renderer/stores/rightStore'
import { useAttachStore } from '@renderer/stores/attachStore'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import { EMPTY_BACKEND_SETTINGS, useSettingsStore } from '@renderer/stores/settingsStore'
import { useUiStore } from '@renderer/stores/uiStore'
import { Cmd } from '../../src/shared/contracts'
import type { JarvisWsClient } from '@renderer/api/ws'

beforeEach(() => {
  useChatStore.getState().clear()
  useLeftStore.setState({
    sessions: [],
    models: [],
    voices: [],
    activePanel: 'history',
    mode: 'text',
    talkActive: false,
    voiceActive: false,
    voiceState: '',
    // 模型表单开关与编辑目标均为瞬态：复位避免「开着表单」的用例把状态串给下一个用例。
    // 音色表单开关同口径（2026-09-28 音色-模型适配）。@author aceFelix
    modelFormOpen: false,
    modelFormTarget: '',
    voiceFormOpen: false,
    voiceFormTarget: '',
    // 待生效选择（模型/音色）同为瞬态：复位避免串场。@author aceFelix
    pendingModel: '',
    pendingVoice: ''
  })
  useMetricsStore.setState({ cpu: 0, memory: null, disk: null })
  useRightStore.setState({ reminders: [], deadlines: [], latestBriefing: '', cost: null, mcp: null, logs: [] })
  useAttachStore.setState({ pending: [] })
  // 设置面板改动会持久化到 localStorage：每个用例复位默认，避免语言/主题串场
  useSettingsStore.getState().setTheme('dark')
  useSettingsStore.getState().setLanguage('zh')
  // 后端联动设置镜像与右栏视图为瞬态：复位避免用例间串场。@author aceFelix
  useSettingsStore.setState({ backendSettings: { ...EMPTY_BACKEND_SETTINGS } })
  useUiStore.setState({ rightView: 'dashboard' })
  useBackendStore.setState({ client: null })
  // 输入区运行时选择态（工作模式/思考）为瞬态：复位避免串场。@author aceFelix
  useRuntimeStore.setState({ permissionMode: 'default', thinkingEffort: 'off', thinkingSupported: [] })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop
})

describe('ChatArea', () => {
  it('渲染用户气泡与流式 AI 气泡（含光标）', () => {
    useChatStore.getState().addUser('你好')
    useChatStore.getState().appendAssistantText('正在回复')
    render(<ChatArea />)
    expect(screen.getByTestId('msg-user')).toHaveTextContent('你好')
    const ai = screen.getByTestId('msg-ai')
    expect(ai).toHaveTextContent('正在回复')
    // streaming 气泡带闪烁光标
    expect(ai.querySelector('.cursor-blink')).not.toBeNull()
  })

  it('远端来源用户气泡：标签显「微信」而非「你」（样式仍为普通用户气泡）', () => {
    useChatStore.getState().addUser('后天天气如何', undefined, 'wechat')
    render(<ChatArea />)
    const u = screen.getByTestId('msg-user')
    expect(u).toHaveTextContent('后天天气如何')
    expect(u).toHaveTextContent('微信')
  })

  it('finishAssistant 后不再有流式光标', () => {
    useChatStore.getState().appendAssistantText('完成')
    useChatStore.getState().finishAssistant()
    render(<ChatArea />)
    expect(screen.getByTestId('msg-ai').querySelector('.cursor-blink')).toBeNull()
  })

  it('AI 气泡流式结束后渲染复制按钮，点击写入剪贴板并变「已复制」', async () => {
    // 消息级复制（替代原右栏「复制回复」）：气泡右下操作行。@author aceFelix
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    useChatStore.getState().appendAssistantText('回复内容')
    useChatStore.getState().finishAssistant()
    render(<ChatArea />)
    const btn = screen.getByTestId('btn-copy-msg')
    expect(btn).toHaveTextContent('复制')
    fireEvent.click(btn)
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('回复内容'))
    await vi.waitFor(() => expect(btn).toHaveTextContent('已复制'))
  })

  it('流式中的 AI 气泡不渲染复制按钮', () => {
    useChatStore.getState().appendAssistantText('回复中')
    render(<ChatArea />)
    expect(screen.queryByTestId('btn-copy-msg')).toBeNull()
  })

  it('🗜 压缩按钮：点击透传 /compact（替掉原截屏）', () => {
    // 手动压缩上下文按钮：点击经 backendStore.execSlash 透传 /compact，
    // 结果走 slash_result 命令输出卡片。@author aceFelix
    const prevExec = useBackendStore.getState().execSlash
    const execSlash = vi.fn().mockResolvedValue(undefined)
    useBackendStore.setState({ client: null, wsConnected: true, execSlash })
    render(<ChatArea />)
    fireEvent.click(screen.getByTestId('btn-compact'))
    expect(execSlash).toHaveBeenCalledWith('/compact')
    useBackendStore.setState({ execSlash: prevExec, wsConnected: false })
  })

  it('渲染工具卡片与系统提示', () => {
    useChatStore.getState().addToolCard('read_file', 'c1', '{"p":1}')
    useChatStore.getState().addSystem('已就绪')
    render(<ChatArea />)
    expect(screen.getByTestId('tool-card')).toBeInTheDocument()
    expect(screen.getByTestId('msg-system')).toHaveTextContent('已就绪')
  })

  it('多行系统提示折叠为 details（首行标题 + 正文），单行保持原样', () => {
    // 降噪：长 dump（工具失败重试等）折叠，避免铺满聊天区；短提示不折叠。
    // @author aceFelix
    useChatStore.getState().addSystem('单行提示，无需折叠')
    useChatStore.getState().addSystem('Bash 执行失败：配置错误\n第二行详情\n第三行', 'error')
    render(<ChatArea />)
    const systems = screen.getAllByTestId('msg-system')
    // 单行：普通 div，无 collapsible 类
    const single = systems.find((el) => el.textContent?.includes('单行提示'))
    expect(single?.tagName).toBe('DIV')
    expect(single?.className).not.toContain('collapsible')
    // 多行：details.collapsible，summary 为首行、正文为其余行
    const multi = systems.find((el) => el.tagName === 'DETAILS')
    expect(multi).toBeTruthy()
    expect(multi?.className).toContain('collapsible')
    expect(multi?.querySelector('summary')?.textContent).toBe('Bash 执行失败：配置错误')
    expect(multi?.querySelector('.system-body')?.textContent).toContain('第二行详情')
  })

  // ---- 降噪折叠（2026-09）：思考块与工具组在「本轮结束」自动收起 ----
  // @author aceFelix

  it('思考块：流式中展开、回复结束后自动收起成一行标题', () => {
    useChatStore.getState().appendAssistantText('好的先生')
    useChatStore.getState().appendThinking('用户要一个提醒')
    render(<ChatArea />)
    const block = screen.getByTestId('thinking-block')
    // 流式中：展开实时可见，标题带字数
    expect(block).toHaveAttribute('open')
    expect(block).toHaveTextContent('思考过程 · 7 字')
    // assistant_done → finishAssistant：自动收起（正文仍留在 DOM，点开可看）
    act(() => useChatStore.getState().finishAssistant())
    const done = screen.getByTestId('thinking-block')
    expect(done).not.toHaveAttribute('open')
    expect(done).toHaveTextContent('用户要一个提醒')
  })

  it('工具组：连续工具调用聚合成一条框，全部完成后自动收起', () => {
    const s = useChatStore.getState()
    s.addToolCard('Bash', 'c1', 'echo 1')
    s.addToolCard('Bash', 'c2', 'echo 2')
    s.addToolCard('Grep', 'c3', 'foo')
    render(<ChatArea />)
    // 执行中：只有一条组框（不再是三个独立框）、自动展开、标题显示在跑的工具
    const group = screen.getByTestId('tool-group')
    expect(screen.getAllByTestId('tool-group')).toHaveLength(1)
    expect(group).toHaveAttribute('open')
    expect(group).toHaveTextContent('工具调用 ×3')
    expect(group).toHaveTextContent('执行中：Bash')
    // 全部完成：自动收起成一行 ✓
    act(() => {
      useChatStore.getState().fillToolResult('c1', 'Bash', 'ok', false)
      useChatStore.getState().fillToolResult('c2', 'Bash', 'ok', false)
      useChatStore.getState().fillToolResult('c3', 'Grep', 'ok', false)
    })
    const done = screen.getByTestId('tool-group')
    expect(done).not.toHaveAttribute('open')
    expect(done).toHaveTextContent('✓')
  })

  it('工具组：有失败时仍收起，但标题标红计数', () => {
    const s = useChatStore.getState()
    s.addToolCard('Bash', 'c1', 'x')
    s.addToolCard('Bash', 'c2', 'y')
    render(<ChatArea />)
    act(() => {
      useChatStore.getState().fillToolResult('c1', 'Bash', 'boom', true)
      useChatStore.getState().fillToolResult('c2', 'Bash', 'ok', false)
    })
    const group = screen.getByTestId('tool-group')
    expect(group).not.toHaveAttribute('open')
    expect(group).toHaveClass('error')
    expect(group).toHaveTextContent('✗1 失败')
  })

  it('用户手动展开已收起的工具组：折叠态交给用户，不再被自动态抢回', () => {
    const s = useChatStore.getState()
    s.addToolCard('Bash', 'c1', 'x')
    s.addToolCard('Bash', 'c2', 'y')
    render(<ChatArea />)
    act(() => {
      useChatStore.getState().fillToolResult('c1', 'Bash', 'ok', false)
      useChatStore.getState().fillToolResult('c2', 'Bash', 'ok', false)
    })
    expect(screen.getByTestId('tool-group')).not.toHaveAttribute('open')
    const group = screen.getByTestId('tool-group')
    act(() => {
      group.setAttribute('open', '')
      // jsdom 不会因属性变化自行派发 toggle，手动模拟浏览器的手点链路
      fireEvent(group, new Event('toggle'))
    })
    expect(screen.getByTestId('tool-group')).toHaveAttribute('open')
  })

  it('单条工具不包组（直接渲染原卡片，少一层点击）', () => {
    useChatStore.getState().addToolCard('read_file', 'c1', '{"p":1}')
    render(<ChatArea />)
    expect(screen.queryByTestId('tool-group')).toBeNull()
    expect(screen.getByTestId('tool-card')).toBeInTheDocument()
  })

  it('工具组只吸收连续项：中间夹系统提示则切成两组', () => {
    const s = useChatStore.getState()
    s.addToolCard('Bash', 'c1', 'a')
    s.addToolCard('Bash', 'c2', 'b')
    s.addSystem('打个岔')
    s.addToolCard('Bash', 'c3', 'c')
    s.addToolCard('Bash', 'c4', 'd')
    render(<ChatArea />)
    expect(screen.getAllByTestId('tool-group')).toHaveLength(2)
  })

  it('历史回放的「历史工具调用 ×N」汇总卡不并入工具组（toolId 为空）', () => {
    useChatStore.getState().replayHistory([
      { role: 'assistant', tool_count: 3 },
      { role: 'assistant', tool_count: 5 }
    ])
    render(<ChatArea />)
    expect(screen.queryByTestId('tool-group')).toBeNull()
    expect(screen.getAllByTestId('tool-card')).toHaveLength(2)
  })

  it('ask_user 出现时渲染回答条', () => {
    useChatStore.getState().showAskUser('是否继续？')
    render(<ChatArea />)
    expect(screen.getByTestId('ask-user-bar')).toBeInTheDocument()
    expect(screen.getByText('是否继续？')).toBeInTheDocument()
  })

  it('未连接时发送/附件/压缩按钮禁用', () => {
    render(<ChatArea />)
    expect(screen.getByTestId('btn-send')).toBeDisabled()
    expect(screen.getByTestId('btn-attach')).toBeDisabled()
    expect(screen.getByTestId('btn-compact')).toBeDisabled()
  })

  it('busy 时发送按钮切换为“■ 停止”，点击发 reply.abort', async () => {
    // 回复进行中双态按钮：停止态不受 wsConnected 以外限制，点击后
    // 经 backendStore.abortReply 发 Cmd.ReplyAbort。@author aceFelix
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, result: true })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: true
    })
    useChatStore.getState().setBusy(true)
    render(<ChatArea />)

    expect(screen.queryByTestId('btn-send')).toBeNull()
    const stop = screen.getByTestId('btn-stop')
    expect(stop).toHaveTextContent('停止')
    fireEvent.click(stop)
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(Cmd.ReplyAbort, {}))

    useBackendStore.setState({ client: null, wsConnected: false })
  })

  it('busy 时 Enter 不叠发消息（引擎指令串行）', () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, result: null })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: true
    })
    useChatStore.getState().setBusy(true)
    render(<ChatArea />)
    const ta = screen.getByPlaceholderText(/和贾维斯说点什么/) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '叠发' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(sendCommand).not.toHaveBeenCalled()
    useBackendStore.setState({ client: null, wsConnected: false })
  })

  it('📎 选文本文件 → chips 显示 → 发送 payload 带 files', async () => {
    // 附件链路组件层验证：file input 变更 → 待发送 chips → 随 message 上送。
    // @author aceFelix
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, result: null })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: true
    })
    render(<ChatArea />)
    const input = screen.getByTestId('attach-input') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['# 你好'], 'note.md', { type: 'text/markdown' })] }
    })
    await vi.waitFor(() => expect(screen.getByTestId('attach-chips')).toHaveTextContent('note.md'))
    const ta = screen.getByPlaceholderText(/和贾维斯说点什么/) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '看文件' } })
    fireEvent.click(screen.getByTestId('btn-send'))
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalled())
    const [, payload] = sendCommand.mock.calls[0]
    expect(payload.files).toEqual([{ name: 'note.md', content: '# 你好' }])
    expect(payload.images).toBeUndefined()
    useBackendStore.setState({ client: null, wsConnected: false })
  })

  it('用户气泡渲染附件图片缩略图', () => {
    useChatStore.getState().addUser('看图', ['data:image/png;base64,QUJD'])
    render(<ChatArea />)
    const thumbs = screen.getByTestId('msg-thumbs')
    expect(thumbs.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,QUJD')
  })

  it('输入框可编辑（受控）', () => {
    render(<ChatArea />)
    const ta = screen.getByPlaceholderText(/和贾维斯说点什么/) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '测试文本' } })
    expect(ta.value).toBe('测试文本')
  })

  it('voiceActive 时渲染语音状态条（阶段文案 + 打断/退出按钮）', () => {
    useLeftStore.setState({ voiceActive: true, voiceState: 'listening' })
    render(<ChatArea />)
    expect(screen.getByTestId('voice-bar')).toBeInTheDocument()
    expect(screen.getByTestId('voice-state')).toHaveTextContent('聆听中')
    expect(screen.getByTestId('voice-interrupt')).toBeInTheDocument()
    expect(screen.getByTestId('voice-exit')).toBeInTheDocument()
  })

  it('非语音态不渲染语音状态条', () => {
    render(<ChatArea />)
    expect(screen.queryByTestId('voice-bar')).toBeNull()
  })
})

describe('LeftSidebar 面板切换', () => {
  it('默认显示历史面板', () => {
    render(<LeftSidebar />)
    expect(screen.getByTestId('panel-history')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-model')).toBeNull()
  })

  it('点击切换到模型 / 音色面板', () => {
    render(<LeftSidebar />)
    fireEvent.click(screen.getByText('<MOD> 模型'))
    expect(screen.getByTestId('panel-model')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-history')).toBeNull()
    fireEvent.click(screen.getByText('<VOC> 音色'))
    expect(screen.getByTestId('panel-voice')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-model')).toBeNull()
  })

  it('渲染会话 / 模型 / 音色列表项', async () => {
    useLeftStore.setState({
      sessions: [
        { name: '会话A', updated_at: 1_700_000_000, message_count: 3, model: 'gpt', current: true },
        { name: '会话B', updated_at: 1_700_000_100, message_count: 1, model: 'gpt' }
      ],
      models: [{ name: 'gpt-4', current: true }],
      voices: [
        { name: '晓晓', voice_id: 'xiao', description: '', vendor: 'dashscope', model: '', linked: null, current: false, custom: false },
      ],
      activePanel: 'history',
      mode: 'text',
      talkActive: false
    })
    render(<LeftSidebar />)
    // 当前会话带选中态（与模型/音色 current 口径一致，sessions.list 后端现比标记）
    expect(screen.getByText('会话A').closest('.list-item')).toHaveClass('current')
    expect(screen.getByText('会话B').closest('.list-item')).not.toHaveClass('current')
    // 选中项点击不发 sessions.open（重复恢复无意义）；非选中项延时到点后发指令
    const openSpy = vi.spyOn(useBackendStore.getState(), 'openSession')
    fireEvent.click(screen.getByText('会话A'))
    fireEvent.click(screen.getByText('会话B'))
    // 单击 220ms 延时让位双击：到点后仅非选中的 会话B 发 open，当前 会话A 不发
    await vi.waitFor(() => expect(openSpy).toHaveBeenCalledWith('会话B'))
    expect(openSpy).toHaveBeenCalledTimes(1)
    openSpy.mockRestore()
    fireEvent.click(screen.getByText('<MOD> 模型'))
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
    fireEvent.click(screen.getByText('<VOC> 音色'))
    expect(screen.getByText('晓晓')).toBeInTheDocument()
  })

  it('属于当前项目的会话标 in-project（描边框），当前聊天仍为 current（填充）', () => {
    // 项目↔会话关联：同 workdir 的非当前会话 = in-project；当前会话 = current（优先）；
    // 其它项目会话两者皆无。@author aceFelix
    useLeftStore.setState({
      sessions: [
        { name: '当前聊天', updated_at: 1, message_count: 2, model: 'gpt', current: true, workdir: 'C:/projA' },
        { name: '同项目历史', updated_at: 2, message_count: 5, model: 'gpt', workdir: 'C:/projA' },
        { name: '别的项目', updated_at: 3, message_count: 1, model: 'gpt', workdir: 'C:/projB' }
      ],
      currentProject: { workdir: 'C:/projA', name: 'projA', persisted: true },
      activePanel: 'history',
      mode: 'text',
      talkActive: false
    })
    render(<LeftSidebar />)
    const cur = screen.getByText('当前聊天').closest('.list-item')
    expect(cur).toHaveClass('current')
    expect(cur).not.toHaveClass('in-project')
    const sib = screen.getByText('同项目历史').closest('.list-item')
    expect(sib).toHaveClass('in-project')
    expect(sib).not.toHaveClass('current')
    const other = screen.getByText('别的项目').closest('.list-item')
    expect(other).not.toHaveClass('in-project')
    expect(other).not.toHaveClass('current')
  })

  it('重复点选同一模型：只发一次指令、不本地弹提示，列表标「待生效」', async () => {
    // 后端 models.select 写盘后由引擎热切换运行中的模型（落地推 model_switched
    // 清标记 + 刷列表）；没有本地「待生效」标记就会出现「看不出选没选中 →
    // 反复点 → 反复写盘」。成功气泡由引擎的 info 事件上屏，本地不再弹。
    // @author aceFelix
    const modelsPayload = [
      { name: 'qwen-flash', vendor: 'dashscope', current: true },
      { name: 'my-model', vendor: 'dashscope', current: false }
    ]
    const sendCommand = vi.fn().mockImplementation((type: string) => {
      if (type === Cmd.ModelsSelect) return Promise.resolve({ ok: true, result: true })
      if (type === Cmd.ModelsList) return Promise.resolve({ ok: true, result: modelsPayload })
      return Promise.resolve({ ok: true, result: null })
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({
      activePanel: 'model',
      modelFormOpen: false,
      pendingModel: '',
      models: modelsPayload
    })
    const selectCalls = (): number =>
      sendCommand.mock.calls.filter(([t]) => t === Cmd.ModelsSelect).length
    const switchedTips = (): number =>
      useChatStore
        .getState()
        .messages.filter((m) => m.kind === 'system' && m.text.includes('模型已切换为')).length

    render(<LeftSidebar />)
    fireEvent.click(screen.getByText('my-model'))
    await vi.waitFor(() => expect(selectCalls()).toBe(1))
    expect(sendCommand).toHaveBeenCalledWith(Cmd.ModelsSelect, { name: 'my-model' })
    // 已点选项标「待生效」；运行中项仍标「当前」（二选一，不叠加）
    await vi.waitFor(() =>
      expect(screen.getByText('my-model').closest('.list-item')).toHaveTextContent('待生效')
    )
    const currentItem = screen.getByText('qwen-flash').closest('.list-item')
    expect(currentItem).toHaveTextContent('当前')
    // 两类项都带 noop（去手型/悬停 = 不可再点），待生效项另带 pending（虚线框区分）
    expect(currentItem).toHaveClass('noop')
    expect(screen.getByText('my-model').closest('.list-item')).toHaveClass('pending', 'noop')
    // 不本地弹气泡：切换成功提示由引擎 info 事件上屏（避免双气泡）
    expect(switchedTips()).toBe(0)

    // 重复点选：不再发指令；点运行中（current）项同样无动作
    fireEvent.click(screen.getByText('my-model'))
    fireEvent.click(screen.getByText('my-model'))
    fireEvent.click(screen.getByText('qwen-flash'))
    await Promise.resolve()
    expect(selectCalls()).toBe(1)
    expect(switchedTips()).toBe(0)
    useBackendStore.setState({ client: null, wsConnected: false })
  })

  it('右键会话项显示删除按钮，点击发 sessions.delete', () => {
    useLeftStore.setState({
      sessions: [{ name: '待删会话', updated_at: 1_700_000_000, message_count: 2, model: 'gpt' }],
      activePanel: 'history',
      mode: 'text',
      talkActive: false
    })
    render(<LeftSidebar />)
    const delSpy = vi.spyOn(useBackendStore.getState(), 'deleteSession')
    // 右键前无删除按钮（二次确认：右键才显、再点才删）
    expect(screen.queryByTestId('session-del-btn')).toBeNull()
    fireEvent.contextMenu(screen.getByText('待删会话'))
    const btn = screen.getByTestId('session-del-btn')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(delSpy).toHaveBeenCalledWith('待删会话')
    delSpy.mockRestore()
  })

  it('双击会话项进入内联改名，回车发 sessions.rename 且不误触发 open', () => {
    useLeftStore.setState({
      sessions: [{ name: '旧标题', updated_at: 1_700_000_000, message_count: 2, model: 'gpt' }],
      activePanel: 'history',
      mode: 'text',
      talkActive: false
    })
    render(<LeftSidebar />)
    const renameSpy = vi.spyOn(useBackendStore.getState(), 'renameSession')
    const openSpy = vi.spyOn(useBackendStore.getState(), 'openSession')
    // 真实双击序列：先单击（起 220ms open 定时器）再双击（清定时器 + 进编辑）
    fireEvent.click(screen.getByText('旧标题'))
    fireEvent.doubleClick(screen.getByText('旧标题'))
    const input = screen.getByTestId('session-rename-input')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('旧标题')
    fireEvent.change(input, { target: { value: '新标题' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameSpy).toHaveBeenCalledWith('旧标题', '新标题')
    // 双击已清掉单击定时器：不应误发 open
    expect(openSpy).not.toHaveBeenCalled()
    renameSpy.mockRestore()
    openSpy.mockRestore()
  })

  it('改名输入框 Esc 取消，不发 sessions.rename', () => {
    useLeftStore.setState({
      sessions: [{ name: '保持原名', updated_at: 1_700_000_000, message_count: 2, model: 'gpt' }],
      activePanel: 'history',
      mode: 'text',
      talkActive: false
    })
    render(<LeftSidebar />)
    const renameSpy = vi.spyOn(useBackendStore.getState(), 'renameSession')
    fireEvent.doubleClick(screen.getByText('保持原名'))
    const input = screen.getByTestId('session-rename-input')
    fireEvent.change(input, { target: { value: '改了又反悔' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(renameSpy).not.toHaveBeenCalled()
    // 退出编辑态：输入框消失、标题恢复
    expect(screen.queryByTestId('session-rename-input')).toBeNull()
    expect(screen.getByText('保持原名')).toBeInTheDocument()
    renameSpy.mockRestore()
  })

  it('切换到实时模式后按钮高亮', () => {
    render(<LeftSidebar />)
    fireEvent.click(screen.getByText('<LIV> 实时'))
    expect(screen.getByText('<LIV> 实时').className).toContain('active')
  })

  it('切换到语音模式后按钮高亮', () => {
    render(<LeftSidebar />)
    fireEvent.click(screen.getByText('<VOX> 语音'))
    expect(screen.getByText('<VOX> 语音').className).toContain('active')
  })

  it('voiceActive 时 footer 显示语音中标记', () => {
    useLeftStore.setState({ voiceActive: true, mode: 'voice' })
    render(<LeftSidebar />)
    expect(screen.getByText('<VOX> 语音中')).toBeInTheDocument()
  })

  it('retro 主题下模式按钮显 [TXT]，切 dark 显电光蓝尖括号牌 <TXT>，切 light 显金属银花括号牌 {TXT}', () => {
    useSettingsStore.getState().setTheme('retro')
    render(<LeftSidebar />)
    expect(screen.getByText('[TXT] 文本')).toBeInTheDocument()
    cleanup()
    useSettingsStore.getState().setTheme('dark')
    render(<LeftSidebar />)
    expect(screen.getByText('<TXT> 文本')).toBeInTheDocument()
    cleanup()
    useSettingsStore.getState().setTheme('light')
    render(<LeftSidebar />)
    expect(screen.getByText('{TXT} 文本')).toBeInTheDocument()
  })

  it('项目区底部常驻：位于面板区之后、状态栏之前（2026-08 位置调整）', () => {
    render(<LeftSidebar />)
    const listArea = document.querySelector('.list-area') as Node
    const section = document.querySelector('.project-section') as Node
    const footer = document.getElementById('left-footer') as Node
    expect(listArea).not.toBeNull()
    expect(section).not.toBeNull()
    expect(footer).not.toBeNull()
    // 文档顺序「面板区 → 项目区 → 状态栏」：项目区不占顶部，也不会被面板挤出
    // 可视区（compareDocumentPosition 命中 FOLLOWING 位 = 4）。@author aceFelix
    expect(listArea.compareDocumentPosition(section) & 4).toBe(4)
    expect(section.compareDocumentPosition(footer) & 4).toBe(4)
  })
})

describe('LeftSidebar 添加模型', () => {
  // 列表末项「＋ 添加模型」→ ModelForm 独立组件整体替换模型列表（与右栏
  // SettingsPanel 替换 RightSidebar 同模式），提交走 models.add 指令。
  // 后端非真机：假 client 只回执指令，不发 WS。@author aceFelix

  it('模型列表末项渲染「＋ 添加模型」，点击进入表单（列表整体替换）', () => {
    useLeftStore.setState({
      models: [{ name: 'gpt-4', current: true }],
      activePanel: 'model',
      modelFormOpen: false
    })
    render(<LeftSidebar />)
    const addItem = screen.getByTestId('model-add-item')
    expect(addItem).toHaveTextContent('＋ 添加模型')
    // 虚线样式类区别于普通模型项
    expect(addItem.className).toContain('add-model')
    fireEvent.click(addItem)
    expect(useLeftStore.getState().modelFormOpen).toBe(true)
    expect(screen.getByTestId('panel-model-form')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-model')).toBeNull()
    // 字段区带 form-scroll：面板高度不够时自身滚动，不溢出压到底部项目区块；
    // 保存/取消与报错行在滚动区之外（.panel 直接子项），常驻可见
    const form = screen.getByTestId('model-form')
    expect(form.className).toContain('form-scroll')
    expect(form.contains(screen.getByTestId('model-form-submit'))).toBe(false)
    // 默认值与 REPL 添加流程口径一致：厂商 deepseek / 接口 openai / 类型 text
    // 下拉为自绘 ThemedSelect（button 触发器）：值走 data-value，显示文案走文本内容
    expect(screen.getByTestId('model-form-vendor')).toHaveAttribute('data-value', 'deepseek')
    expect(screen.getByTestId('model-form-vendor')).toHaveTextContent('DeepSeek')
    expect(screen.getByTestId('model-form-api-format')).toHaveAttribute('data-value', 'openai')
    expect(screen.getByTestId('model-form-model-type')).toHaveAttribute('data-value', 'text')
    expect(screen.getByTestId('model-form-name')).toHaveValue('')
  })

  it('模型名为空提交：本地校验提示且不发 models.add', () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, result: null })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', modelFormOpen: true })
    render(<LeftSidebar />)
    fireEvent.click(screen.getByTestId('model-form-submit'))
    expect(screen.getByTestId('model-form-error')).toHaveTextContent('模型名不能为空')
    expect(sendCommand).not.toHaveBeenCalled()
    // 开始输入即清掉提示（用户正在修正）
    fireEvent.change(screen.getByTestId('model-form-name'), { target: { value: 'x' } })
    expect(screen.queryByTestId('model-form-error')).toBeNull()
  })

  it('填写提交：models.add 带裁剪后字段 → 刷模型列表 → 关表单并提示', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.ModelsAdd) {
        return { ok: true, result: { name: 'my-model', vendor: 'deepseek' } }
      }
      // addModel 成功后内部再拉一次 models.list（刷新列表）
      if (type === Cmd.ModelsList) return { ok: true, result: [{ name: 'my-model', current: true }] }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', modelFormOpen: true })
    render(<LeftSidebar />)
    fireEvent.change(screen.getByTestId('model-form-name'), { target: { value: '  my-model  ' } })
    fireEvent.change(screen.getByTestId('model-form-api-key'), { target: { value: ' sk-test ' } })
    fireEvent.change(screen.getByTestId('model-form-base-url'), {
      target: { value: ' https://api.example.com ' }
    })
    fireEvent.click(screen.getByTestId('model-form-submit'))

    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(Cmd.ModelsAdd, {
        name: 'my-model',
        vendor: 'deepseek',
        api_format: 'openai',
        base_url: 'https://api.example.com',
        api_key: 'sk-test',
        model_type: 'text'
      })
    )
    // 成功：表单关闭回列表、列表已刷新出新模型、聊天流有系统提示
    await vi.waitFor(() => expect(screen.getByTestId('panel-model')).toBeInTheDocument())
    expect(screen.queryByTestId('panel-model-form')).toBeNull()
    expect(useLeftStore.getState().modelFormOpen).toBe(false)
    expect(screen.getByText('my-model')).toBeInTheDocument()
    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.kind === 'system' && m.text.includes('已添加'))
    ).toBe(true)
  })

  it('下拉改选：自绘 ThemedSelect 选厂商/接口类型 → 提交使用所选值', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.ModelsAdd) return { ok: true, result: { name: 'kimi-k2', vendor: 'moonshot' } }
      if (type === Cmd.ModelsList) return { ok: true, result: [] }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', modelFormOpen: true })
    render(<LeftSidebar />)

    // 展开厂商下拉（浮层 portal 到 body）→ 选 Moonshot AI，选中后浮层关闭
    fireEvent.click(screen.getByTestId('model-form-vendor'))
    fireEvent.click(screen.getByTestId('model-form-vendor-option-moonshot'))
    expect(screen.getByTestId('model-form-vendor')).toHaveAttribute('data-value', 'moonshot')
    expect(screen.getByTestId('model-form-vendor')).toHaveTextContent('Moonshot AI')
    expect(screen.queryByTestId('model-form-vendor-menu')).toBeNull()

    // 接口类型改选 Anthropic 原生
    fireEvent.click(screen.getByTestId('model-form-api-format'))
    fireEvent.click(screen.getByTestId('model-form-api-format-option-anthropic'))
    expect(screen.getByTestId('model-form-api-format')).toHaveAttribute('data-value', 'anthropic')

    fireEvent.change(screen.getByTestId('model-form-name'), { target: { value: 'kimi-k2' } })
    fireEvent.click(screen.getByTestId('model-form-submit'))

    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(Cmd.ModelsAdd, {
        name: 'kimi-k2',
        vendor: 'moonshot',
        api_format: 'anthropic',
        base_url: '',
        api_key: '',
        model_type: 'text'
      })
    )
  })

  it('后端回执失败：表单保持打开可修正，错误走聊天流出口', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValue({ ok: false, error: '缺少模型名 name' })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', modelFormOpen: true })
    render(<LeftSidebar />)
    fireEvent.change(screen.getByTestId('model-form-name'), { target: { value: 'bad-model' } })
    fireEvent.click(screen.getByTestId('model-form-submit'))
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(Cmd.ModelsAdd, expect.anything()))
    expect(useLeftStore.getState().modelFormOpen).toBe(true)
    expect(screen.getByTestId('panel-model-form')).toBeInTheDocument()
    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.kind === 'system' && m.text.includes('缺少模型名'))
    ).toBe(true)
  })

  it('取消与顶部返回箭头均回模型列表，不发 models.add', () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, result: null })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', modelFormOpen: true })
    render(<LeftSidebar />)
    fireEvent.click(screen.getByTestId('model-form-cancel'))
    expect(useLeftStore.getState().modelFormOpen).toBe(false)
    expect(screen.getByTestId('panel-model')).toBeInTheDocument()
    // 再进表单，用顶部返回箭头退出
    fireEvent.click(screen.getByTestId('model-add-item'))
    expect(screen.getByTestId('panel-model-form')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('btn-model-form-back'))
    expect(useLeftStore.getState().modelFormOpen).toBe(false)
    expect(screen.getByTestId('panel-model')).toBeInTheDocument()
    expect(sendCommand).not.toHaveBeenCalled()
  })
})

describe('LeftSidebar 模型配置修改与删除', () => {
  // 交互范式对齐会话列表：双击模型项 → ModelForm 编辑该模型（models.edit），
  // 右键 → 项内出现删除按钮、再点才真删（models.remove，仅自定义模型）。
  // 后端非真机：假 client 只回执指令，不发 WS。@author aceFelix

  /** 模型列表夹具：一个内置（运行中）/ 一个自定义（可改名可删），均带 config 现值。 */
  const modelsFixture = [
    {
      name: 'qwen-flash',
      vendor: 'dashscope',
      current: true,
      source: 'builtin',
      editable: true,
      removable: false,
      config: {
        vendor: 'dashscope',
        api_format: 'dashscope',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model_type: 'text',
        has_key: true
      }
    },
    {
      name: 'my-model',
      vendor: 'deepseek',
      current: false,
      source: 'custom',
      editable: true,
      removable: true,
      config: {
        vendor: 'deepseek',
        api_format: 'openai',
        base_url: 'https://api.deepseek.com',
        model_type: 'text',
        has_key: true
      }
    }
  ]

  it('双击模型项进编辑表单：标题切「修改模型配置」、字段预填现值、Key 不回显', () => {
    useLeftStore.setState({ activePanel: 'model', models: modelsFixture })
    render(<LeftSidebar />)
    fireEvent.doubleClick(screen.getByText('my-model'))

    expect(screen.getByTestId('panel-model-form')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-model')).toBeNull()
    expect(useLeftStore.getState().modelFormOpen).toBe(true)
    expect(useLeftStore.getState().modelFormTarget).toBe('my-model')
    expect(screen.getByText('修改模型配置')).toBeInTheDocument()
    expect(screen.getByTestId('model-form-target')).toHaveTextContent('正在修改「my-model」的配置')
    // 字段预填该模型现值（models.list 每项的 config）
    const nameInput = screen.getByTestId('model-form-name')
    expect(nameInput).toHaveValue('my-model')
    expect(nameInput).not.toBeDisabled()
    expect(screen.getByTestId('model-form-vendor')).toHaveAttribute('data-value', 'deepseek')
    expect(screen.getByTestId('model-form-api-format')).toHaveAttribute('data-value', 'openai')
    expect(screen.getByTestId('model-form-base-url')).toHaveValue('https://api.deepseek.com')
    expect(screen.getByTestId('model-form-model-type')).toHaveAttribute('data-value', 'text')
    // 密钥不回显：框恒空 + hint 说明「留空 = 保持原 Key」（未填不能当清空）
    expect(screen.getByTestId('model-form-api-key')).toHaveValue('')
    expect(screen.getByTestId('model-form')).toHaveTextContent('留空保持原 Key 不变')
    expect(screen.getByTestId('model-form-submit')).toHaveTextContent('保存修改')
  })

  it('双击内置模型：模型名输入框锁定（改名只会造幽灵模型）', () => {
    useLeftStore.setState({ activePanel: 'model', models: modelsFixture })
    render(<LeftSidebar />)
    fireEvent.doubleClick(screen.getByText('qwen-flash'))

    expect(useLeftStore.getState().modelFormTarget).toBe('qwen-flash')
    expect(screen.getByTestId('model-form-name')).toHaveValue('qwen-flash')
    expect(screen.getByTestId('model-form-name')).toBeDisabled()
    expect(screen.getByTestId('model-form')).toHaveTextContent('内置模型名不可修改')
  })

  it('改配置提交：models.edit 携原名与裁剪后字段（Key 留空）→ 回列表并提示', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.ModelsEdit) {
        return { ok: true, result: { name: 'my-model-v2', hot_switched: false } }
      }
      if (type === Cmd.ModelsList) return { ok: true, result: modelsFixture }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', models: modelsFixture })
    render(<LeftSidebar />)
    fireEvent.doubleClick(screen.getByText('my-model'))
    fireEvent.change(screen.getByTestId('model-form-name'), { target: { value: '  my-model-v2  ' } })
    fireEvent.change(screen.getByTestId('model-form-base-url'), {
      target: { value: ' https://api.example.com/v1 ' }
    })
    fireEvent.click(screen.getByTestId('model-form-submit'))

    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(Cmd.ModelsEdit, {
        name: 'my-model',
        new_name: 'my-model-v2',
        vendor: 'deepseek',
        api_format: 'openai',
        base_url: 'https://api.example.com/v1',
        api_key: '',
        model_type: 'text'
      })
    )
    // 成功：表单关闭回列表（编辑目标一并清空）、列表已刷新、聊天流有系统提示
    await vi.waitFor(() => expect(screen.getByTestId('panel-model')).toBeInTheDocument())
    expect(screen.queryByTestId('panel-model-form')).toBeNull()
    expect(useLeftStore.getState().modelFormOpen).toBe(false)
    expect(useLeftStore.getState().modelFormTarget).toBe('')
    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.kind === 'system' && m.text.includes('配置已更新'))
    ).toBe(true)
  })

  it('改的是当前运行模型（回执 hot_switched）：提示说明已按新配置重连', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.ModelsEdit) {
        return { ok: true, result: { name: 'qwen-flash', hot_switched: true } }
      }
      if (type === Cmd.ModelsList) return { ok: true, result: modelsFixture }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', models: modelsFixture })
    render(<LeftSidebar />)
    fireEvent.doubleClick(screen.getByText('qwen-flash'))
    fireEvent.change(screen.getByTestId('model-form-base-url'), {
      target: { value: 'https://proxy.example.com' }
    })
    fireEvent.click(screen.getByTestId('model-form-submit'))

    await vi.waitFor(() =>
      expect(
        useChatStore
          .getState()
          .messages.some((m) => m.kind === 'system' && m.text.includes('已按新配置重连'))
      ).toBe(true)
    )
  })

  it('右键自定义模型显删除按钮、再点发 models.remove；内置模型右键不出按钮', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.ModelsRemove) {
        return { ok: true, result: { name: 'my-model', was_current: false } }
      }
      // 删除成功后刷列表：夹具里只剩内置模型
      if (type === Cmd.ModelsList) return { ok: true, result: [modelsFixture[0]] }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', models: modelsFixture })
    render(<LeftSidebar />)
    // 右键前无删除按钮（二次确认：右键才显、再点才删）
    expect(screen.queryByTestId('model-del-btn')).toBeNull()
    // 内置模型不可删：右键不显示删除按钮（后端也会拒绝）
    fireEvent.contextMenu(screen.getByText('qwen-flash'))
    expect(screen.queryByTestId('model-del-btn')).toBeNull()

    fireEvent.contextMenu(screen.getByText('my-model'))
    fireEvent.click(screen.getByTestId('model-del-btn'))

    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(Cmd.ModelsRemove, { name: 'my-model' })
    )
    // 成功：按钮收起 + 列表刷新（my-model 已不在）+ 聊天流提示
    await vi.waitFor(() => expect(screen.queryByText('my-model')).toBeNull())
    expect(screen.queryByTestId('model-del-btn')).toBeNull()
    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.kind === 'system' && m.text.includes('已删除'))
    ).toBe(true)
  })

  it('双击不误触发点选（单击 220ms 定时器被清）；当前项（noop）也进得了编辑表单', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, result: null })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'model', models: modelsFixture })
    render(<LeftSidebar />)
    // 真实双击序列：先单击（起 220ms 点选定时器）再双击（清定时器 + 进编辑）
    fireEvent.click(screen.getByText('my-model'))
    fireEvent.doubleClick(screen.getByText('my-model'))
    await new Promise((r) => setTimeout(r, 280))
    expect(sendCommand).not.toHaveBeenCalledWith(Cmd.ModelsSelect, expect.anything())
    expect(useLeftStore.getState().modelFormTarget).toBe('my-model')

    // 回列表（顶部返回箭头）再双击运行中的当前模型：noop 只去手型/悬停，不屏蔽指针事件
    fireEvent.click(screen.getByTestId('btn-model-form-back'))
    expect(screen.getByTestId('panel-model')).toBeInTheDocument()
    fireEvent.doubleClick(screen.getByText('qwen-flash'))
    expect(useLeftStore.getState().modelFormTarget).toBe('qwen-flash')
    expect(screen.getByTestId('model-form-name')).toHaveValue('qwen-flash')
  })
})

describe('LeftSidebar 音色面板与音色表单', () => {
  // 2026-09-28 音色-模型适配接入桌面壳：交互范式对齐模型面板（末项添加/
  // 双击自定义项编辑/右键删），副行透出 voices.list 全量目录的适配/联动预告。
  // 后端非真机：假 client 只回执指令，不发 WS。@author aceFelix

  /** 全量目录夹具：当前项（内置兼容）/ 待联动项（linked 非空）/ 自定义项。 */
  const voicesFixture = [
    { name: 'longanlang_v3', voice_id: 'longanlang_v3', description: '龙安朗', vendor: 'dashscope', model: 'cosyvoice-v3', linked: null, current: true, custom: false },
    { name: 'longxiaochun_v3', voice_id: 'longxiaochun_v3', description: '龙小淳', vendor: 'dashscope', model: 'cosyvoice-v3', linked: 'cosyvoice-v3-flash', current: false, custom: false },
    { name: '我的声音', voice_id: 'my-clone', description: '复刻', vendor: 'dashscope', model: 'cosyvoice-v3-plus', linked: null, current: false, custom: true }
  ]

  it('副行透出适配/联动预告；末项「＋ 添加音色」进表单（列表整体替换）', () => {
    useLeftStore.setState({ activePanel: 'voice', voices: voicesFixture, voiceFormOpen: false })
    render(<LeftSidebar />)
    // 待联动项显「联动 X」（不兼容预告），兼容项显「适配 X」
    expect(screen.getByText('longxiaochun_v3').closest('.list-item')).toHaveTextContent('联动 cosyvoice-v3-flash')
    expect(screen.getByText('我的声音').closest('.list-item')).toHaveTextContent('适配 cosyvoice-v3-plus')
    const addItem = screen.getByTestId('voice-add-item')
    expect(addItem).toHaveTextContent('＋ 添加音色')
    fireEvent.click(addItem)
    expect(useLeftStore.getState().voiceFormOpen).toBe(true)
    expect(screen.getByTestId('panel-voice-form')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-voice')).toBeNull()
    // 字段区滚动 + 操作按钮常驻（口径同模型表单）
    const voiceForm = screen.getByTestId('voice-form')
    expect(voiceForm.className).toContain('form-scroll')
    expect(voiceForm.contains(screen.getByTestId('voice-form-submit'))).toBe(false)
    // 默认值与终端 /tts-voice 表单同口径：适配模型缺省家族 cosyvoice-v3
    expect(screen.getByTestId('voice-form-model')).toHaveAttribute('data-value', 'cosyvoice-v3')
    expect(screen.getByTestId('voice-form-name')).toHaveValue('')
  })

  it('音色名/voice_id 为空提交：本地校验提示且不发 voices.add', () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, result: null })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'voice', voiceFormOpen: true })
    render(<LeftSidebar />)
    fireEvent.click(screen.getByTestId('voice-form-submit'))
    expect(screen.getByTestId('voice-form-error')).toHaveTextContent('音色名不能为空')
    // 补名缺 voice_id：换报 voice_id；开始修正时清提示
    fireEvent.change(screen.getByTestId('voice-form-name'), { target: { value: 'x' } })
    expect(screen.queryByTestId('voice-form-error')).toBeNull()
    fireEvent.click(screen.getByTestId('voice-form-submit'))
    expect(screen.getByTestId('voice-form-error')).toHaveTextContent('音色 ID 不能为空')
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('填写提交：voices.add 带裁剪后字段 → 刷音色列表 → 关表单并提示', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.VoicesAdd) return { ok: true, result: { ok: true, name: '我的声音' } }
      if (type === Cmd.VoicesList) return { ok: true, result: voicesFixture }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'voice', voiceFormOpen: true })
    render(<LeftSidebar />)
    fireEvent.change(screen.getByTestId('voice-form-name'), { target: { value: ' 我的声音 ' } })
    fireEvent.change(screen.getByTestId('voice-form-voice-id'), { target: { value: ' my-clone ' } })
    fireEvent.click(screen.getByTestId('voice-form-submit'))

    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(Cmd.VoicesAdd, {
        name: '我的声音',
        voice_id: 'my-clone',
        model: 'cosyvoice-v3',
        description: ''
      })
    )
    await vi.waitFor(() => expect(screen.getByTestId('panel-voice')).toBeInTheDocument())
    expect(screen.queryByTestId('panel-voice-form')).toBeNull()
    expect(useLeftStore.getState().voiceFormOpen).toBe(false)
    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.kind === 'system' && m.text.includes('已保存'))
    ).toBe(true)
  })

  it('双击自定义音色进编辑表单（音色名锁定+预填）；双击内置音色不进', () => {
    useLeftStore.setState({ activePanel: 'voice', voices: voicesFixture })
    render(<LeftSidebar />)
    fireEvent.doubleClick(screen.getByText('我的声音'))
    expect(screen.getByTestId('panel-voice-form')).toBeInTheDocument()
    expect(useLeftStore.getState().voiceFormTarget).toBe('我的声音')
    expect(screen.getByText('修改音色')).toBeInTheDocument()
    // 同名 upsert=编辑：音色名锁定预填，voice_id/适配模型预填现值
    expect(screen.getByTestId('voice-form-name')).toHaveValue('我的声音')
    expect(screen.getByTestId('voice-form-name')).toBeDisabled()
    expect(screen.getByTestId('voice-form-voice-id')).toHaveValue('my-clone')
    expect(screen.getByTestId('voice-form-model')).toHaveAttribute('data-value', 'cosyvoice-v3-plus')
    expect(screen.getByTestId('voice-form-submit')).toHaveTextContent('保存修改')
    // 内置音色不可编辑：双击不切表单
    fireEvent.click(screen.getByTestId('btn-voice-form-back'))
    fireEvent.doubleClick(screen.getByText('longanlang_v3'))
    expect(useLeftStore.getState().voiceFormOpen).toBe(false)
    expect(screen.getByTestId('panel-voice')).toBeInTheDocument()
  })

  it('右键自定义音色显删除按钮、再点发 voices.delete；内置音色右键不出按钮', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.VoicesDelete) return { ok: true, result: { ok: true, name: '我的声音' } }
      // 删除成功后刷列表：夹具里只剩内置音色
      if (type === Cmd.VoicesList) return { ok: true, result: voicesFixture.slice(0, 2) }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'voice', voices: voicesFixture })
    render(<LeftSidebar />)
    expect(screen.queryByTestId('voice-del-btn')).toBeNull()
    // 内置音色不可删：右键不显示删除按钮（后端也会拒绝）
    fireEvent.contextMenu(screen.getByText('longxiaochun_v3'))
    expect(screen.queryByTestId('voice-del-btn')).toBeNull()

    fireEvent.contextMenu(screen.getByText('我的声音'))
    fireEvent.click(screen.getByTestId('voice-del-btn'))

    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(Cmd.VoicesDelete, { name: '我的声音' })
    )
    await vi.waitFor(() => expect(screen.queryByText('我的声音')).toBeNull())
    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.kind === 'system' && m.text.includes('已删除'))
    ).toBe(true)
  })

  it('点击切换音色：dict 回执 linked_model 非空 → 提示联动口径并标待生效', async () => {
    const sendCommand = vi.fn(async (type: string) => {
      if (type === Cmd.VoicesSelect) {
        return {
          ok: true,
          result: { ok: true, name: 'longxiaochun_v3', voice_id: 'longxiaochun_v3', linked_model: 'cosyvoice-v3-flash', old_model: 'cosyvoice-v2' }
        }
      }
      if (type === Cmd.VoicesList) return { ok: true, result: voicesFixture }
      return { ok: true, result: null }
    })
    useBackendStore.setState({
      client: { sendCommand } as unknown as JarvisWsClient,
      wsConnected: false
    })
    useLeftStore.setState({ activePanel: 'voice', voices: voicesFixture, pendingVoice: '' })
    render(<LeftSidebar />)
    fireEvent.click(screen.getByText('longxiaochun_v3'))
    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(Cmd.VoicesSelect, { name: 'longxiaochun_v3' })
    )
    await vi.waitFor(() =>
      expect(
        useChatStore
          .getState()
          .messages.some((m) => m.kind === 'system' && m.text.includes('联动 TTS 模型 cosyvoice-v3-flash'))
      ).toBe(true)
    )
    expect(useLeftStore.getState().pendingVoice).toBe('longxiaochun_v3')
    // 当前音色（noop）点击不发指令：去重口径同模型项
    fireEvent.click(screen.getByText('longanlang_v3'))
    await new Promise((r) => setTimeout(r, 280))
    expect(sendCommand).not.toHaveBeenCalledWith(Cmd.VoicesSelect, { name: 'longanlang_v3' })
  })
})

describe('RightSidebar 指标', () => {
  it('渲染 CPU / 内存 / 磁盘，CPU 过热标记 hot', () => {
    useMetricsStore.setState({
      cpu: 90,
      memory: { percent: 60, used_gb: 6, total_gb: 10 },
      disk: { percent: 20 }
    })
    render(<RightSidebar />)
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('6 / 10 GB')).toBeInTheDocument()
    expect(document.querySelector('.gauge-fill.hot')).not.toBeNull()
  })
})

describe('SettingsPanel 设置面板', () => {
  // 设置独立成面板：标题栏齿轮进入，整体替换右栏信息面板。@author aceFelix
  it('渲染主题与语言分段控件（深色/中文高亮）', () => {
    render(<SettingsPanel />)
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    expect(screen.getByTestId('btn-theme-dark').className).toContain('active')
    expect(screen.getByTestId('btn-lang-zh').className).toContain('active')
  })

  it('点击浅色：settingsStore 切 light 且 <html data-theme> 生效', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('btn-theme-light'))
    expect(useSettingsStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByTestId('btn-theme-light').className).toContain('active')
  })

  it('点击复古：settingsStore 切 retro、<html data-theme=retro> 且分段高亮', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('btn-theme-retro'))
    expect(useSettingsStore.getState().theme).toBe('retro')
    expect(document.documentElement.dataset.theme).toBe('retro')
    expect(screen.getByTestId('btn-theme-retro').className).toContain('active')
  })

  it('点击 English：静态界面文案切换为英文', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('btn-lang-en'))
    expect(useSettingsStore.getState().language).toBe('en')
    expect(screen.getByText('Voice Broadcast')).toBeInTheDocument()
  })

  it('后端设置未拉取时四组均显离线态；回填后渲染开关/时间/滑杆', () => {
    render(<SettingsPanel />)
    expect(screen.getByTestId('proactive-tts-offline')).toBeInTheDocument()
    expect(screen.getByTestId('briefing-offline')).toBeInTheDocument()
    expect(screen.getByTestId('briefing-time-offline')).toBeInTheDocument()
    expect(screen.getByTestId('deadline-offline')).toBeInTheDocument()
    expect(screen.getByTestId('deadline-check-time-offline')).toBeInTheDocument()
    expect(screen.getByTestId('tts-volume-offline')).toBeInTheDocument()
    expect(screen.getByTestId('tts-speech-rate-offline')).toBeInTheDocument()
    cleanup()
    useSettingsStore.getState().applyBackendSettings({
      proactive_tts_enabled: true,
      briefing_enabled: false,
      briefing_time: '07:15',
      deadline_enabled: true,
      deadline_check_time: '21:00',
      tts_volume: 60,
      tts_speech_rate: 1.25
    })
    render(<SettingsPanel />)
    const toggle = screen.getByTestId('toggle-proactive-tts')
    expect(toggle.className).toContain('on')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('toggle-briefing').className).not.toContain('on')
    expect(screen.getByTestId('time-briefing-time')).toHaveAttribute('data-value', '07:15')
    expect(screen.getByTestId('time-briefing-time-hour')).toHaveTextContent('07')
    expect(screen.getByTestId('time-briefing-time-minute')).toHaveTextContent('15')
    expect(screen.getByTestId('time-deadline-check-time')).toHaveAttribute('data-value', '21:00')
    expect(screen.getByTestId('range-tts-volume')).toHaveValue('60')
    expect(screen.getByTestId('tts-volume-value')).toHaveTextContent('60')
    expect(screen.getByTestId('range-tts-speech-rate')).toHaveValue('1.25')
    expect(screen.getByTestId('tts-speech-rate-value')).toHaveTextContent('1.25×')
  })

  it('点击开关乐观翻转并发 settings.set', () => {
    const client = {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, result: { proactive_tts_enabled: false } })
    }
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useSettingsStore
      .getState()
      .applyBackendSettings({ ...EMPTY_BACKEND_SETTINGS, proactive_tts_enabled: true })
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('toggle-proactive-tts'))
    expect(useSettingsStore.getState().backendSettings.proactive_tts_enabled).toBe(false)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, {
      proactive_tts_enabled: false
    })
  })

  it('改简报时间：自绘时间选择器点选即拼回 HH:MM 发 settings.set，重选当前值不发', () => {
    const client = { sendCommand: vi.fn().mockResolvedValue({ ok: true, result: {} }) }
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useSettingsStore
      .getState()
      .applyBackendSettings({ ...EMPTY_BACKEND_SETTINGS, briefing_time: '08:30' })
    render(<SettingsPanel />)
    // 改小时 08 → 06：分钟侧保持 30，拼回完整 HH:MM
    fireEvent.click(screen.getByTestId('time-briefing-time-hour'))
    fireEvent.click(screen.getByTestId('time-briefing-time-hour-option-06'))
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, { briefing_time: '06:30' })
    // 改分钟 30 → 45：小时侧保持 06
    fireEvent.click(screen.getByTestId('time-briefing-time-minute'))
    fireEvent.click(screen.getByTestId('time-briefing-time-minute-option-45'))
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, { briefing_time: '06:45' })
    expect(client.sendCommand).toHaveBeenCalledTimes(2)
    // 重选当前值不发指令（避免重复落盘/调度重注册）
    fireEvent.click(screen.getByTestId('time-briefing-time-minute'))
    fireEvent.click(screen.getByTestId('time-briefing-time-minute-option-45'))
    expect(client.sendCommand).toHaveBeenCalledTimes(2)
  })

  it('拖音量滑杆乐观写回并发 settings.set', () => {
    const client = { sendCommand: vi.fn().mockResolvedValue({ ok: true, result: {} }) }
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useSettingsStore
      .getState()
      .applyBackendSettings({ ...EMPTY_BACKEND_SETTINGS, tts_volume: 50 })
    render(<SettingsPanel />)
    fireEvent.change(screen.getByTestId('range-tts-volume'), { target: { value: '75' } })
    expect(useSettingsStore.getState().backendSettings.tts_volume).toBe(75)
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, { tts_volume: 75 })
    expect(screen.getByTestId('tts-volume-value')).toHaveTextContent('75')
  })

  it('返回按钮回信息面板（uiStore.rightView 回 dashboard）', () => {
    useUiStore.getState().openSettings()
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('btn-settings-back'))
    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

describe('RightSidebar 任务中心与用量', () => {
  it('渲染提醒与截止日期（逾期标红文案）', () => {
    useRightStore.setState({
      reminders: [{ id: 't1', content: '开会', trigger_at: '2026-09-23T09:00:00', repeat: 'daily' }],
      deadlines: [
        { id: 'd1', title: 'Q3 交付', due_date: '2026-09-20', days_left: -2, status: 'overdue' }
      ]
    })
    render(<RightSidebar />)
    const center = screen.getByTestId('task-center')
    expect(center).toHaveTextContent('<REM> 开会')
    expect(center).toHaveTextContent('每日')
    expect(center).toHaveTextContent('已逾期 2 天')
    expect(center).toHaveTextContent('<DUE> Q3 交付')
  })

  it('无任务时空态提示；有简报时渲染折叠块', () => {
    render(<RightSidebar />)
    expect(screen.getByTestId('task-center')).toHaveTextContent('暂无待办提醒')
    cleanup()
    useRightStore.setState({ latestBriefing: '早上好，先生' })
    render(<RightSidebar />)
    expect(screen.getByTestId('latest-briefing')).toHaveTextContent('早上好，先生')
  })

  it('用量卡渲染 token 统计（千分位分组）与缓存命中率', () => {
    useRightStore.setState({
      cost: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        input_tokens: 12345,
        output_tokens: 678,
        cache_read_tokens: 50,
        cache_creation_tokens: 10,
        // 命中率由后端 cost.get 算好（Usage.cache_hit_rate），前端原样展示
        cache_hit_rate: 78.5,
        dialogs: 3,
        messages: 8
      }
    })
    render(<RightSidebar />)
    const card = screen.getByTestId('usage-card')
    expect(card).toHaveTextContent('deepseek-chat')
    expect(card).toHaveTextContent('12,345')
    expect(card).toHaveTextContent('3 轮 / 8 条')
    // 一位小数 + 百分号；title 透出命中/输入明细
    const hit = screen.getByTestId('usage-cache-hit-rate')
    expect(hit).toHaveTextContent('缓存命中率')
    expect(hit).toHaveTextContent('78.5%')
  })

  it('旧后端无 cache_hit_rate 字段时隐藏命中率行（不留空白指标）', () => {
    useRightStore.setState({
      cost: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        dialogs: 1,
        messages: 2
      }
    })
    render(<RightSidebar />)
    expect(screen.getByTestId('usage-card')).toHaveTextContent('deepseek-chat')
    expect(screen.queryByTestId('usage-cache-hit-rate')).toBeNull()
  })

  it('用量卡渲染上下文窗口占比（context_*）与进度条', () => {
    // 上下文窗口占用（口径同 /context）：一行百分比 + 下方 gauge；
    // title 透出已用/窗口 token 与窗口来源。@author aceFelix
    useRightStore.setState({
      cost: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        context_used: 40000,
        context_window: 200000,
        context_percent: 20.0,
        context_configured: true,
        dialogs: 1,
        messages: 2
      }
    })
    render(<RightSidebar />)
    const ctx = screen.getByTestId('usage-context')
    expect(ctx).toHaveTextContent('上下文窗口')
    expect(ctx).toHaveTextContent('20.0%')
    expect(document.querySelector('.usage-context-gauge .gauge-fill')).not.toBeNull()
  })

  it('旧后端无 context_* 字段时隐藏上下文行', () => {
    useRightStore.setState({
      cost: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        dialogs: 1,
        messages: 2
      }
    })
    render(<RightSidebar />)
    expect(screen.queryByTestId('usage-context')).toBeNull()
  })
})

describe('RightSidebar 运行健康', () => {
  it('MCP 未启用时提示；有快照时显示连接/工具数', () => {
    render(<RightSidebar />)
    expect(screen.getByTestId('mcp-status')).toHaveTextContent('MCP 未启用')
    cleanup()
    useRightStore.setState({ mcp: { connected: ['amap'], failed: ['x'], tools: 5 } })
    render(<RightSidebar />)
    const status = screen.getByTestId('mcp-status')
    expect(status).toHaveTextContent('MCP 1 连 / 1 败 · 5 工具')
    expect(status).toHaveTextContent('失败：x')
  })

  it('日志流渲染最近事件（最新在前）', () => {
    useRightStore.getState().pushLog('第一条')
    useRightStore.getState().pushLog('第二条')
    render(<RightSidebar />)
    const feed = screen.getByTestId('log-feed')
    const lines = feed.querySelectorAll('.log-line')
    expect(lines).toHaveLength(2)
    // 渲染倒序：最新一条在最前
    expect(lines[0]).toHaveTextContent('第二条')
    expect(lines[1]).toHaveTextContent('第一条')
  })
})

describe('TitleBar 窗口控制', () => {
  it('最小化 / 关闭按钮经 preload IPC 转发', () => {
    const windowControl = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop = {
      windowControl,
      getBackendInfo: vi.fn().mockResolvedValue(null),
      onBackendStatus: vi.fn(() => () => {})
    }
    render(<TitleBar />)
    fireEvent.click(screen.getByTitle('最小化'))
    fireEvent.click(screen.getByTitle('关闭（隐藏到托盘）'))
    expect(windowControl).toHaveBeenCalledWith('minimize')
    expect(windowControl).toHaveBeenCalledWith('close')
  })

  it('齿轮按钮进入设置面板，再点一次回信息面板（toggle）', () => {
    render(<TitleBar />)
    fireEvent.click(screen.getByTestId('btn-open-settings'))
    expect(useUiStore.getState().rightView).toBe('settings')
    expect(screen.getByTestId('btn-open-settings').className).toContain('active')
    fireEvent.click(screen.getByTestId('btn-open-settings'))
    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

// 输入区工具条：工作模式 + 思考强度两个选择器（2026-09 桌面模式与思考强度）。
// @author aceFelix
describe('ChatArea · 输入区工具条（工作模式 / 思考强度）', () => {
  it('渲染两个选择器，初值取 runtimeStore', () => {
    useRuntimeStore.setState({ permissionMode: 'plan', thinkingEffort: 'low', thinkingSupported: ['off', 'low', 'medium', 'high'] })
    render(<ChatArea />)
    expect(screen.getByTestId('composer-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('select-mode')).toHaveAttribute('data-value', 'plan')
    expect(screen.getByTestId('select-think')).toHaveAttribute('data-value', 'low')
  })

  it('选择工作模式 → 调 setMode(值)', () => {
    const setMode = vi.fn()
    useBackendStore.setState({ setMode } as never)
    render(<ChatArea />)
    fireEvent.click(screen.getByTestId('select-mode'))
    fireEvent.click(screen.getByTestId('select-mode-option-accept_edits'))
    expect(setMode).toHaveBeenCalledWith('accept_edits')
  })

  it('选择思考档位 → 调 setThinking(值)', () => {
    const setThinking = vi.fn()
    useRuntimeStore.setState({ thinkingSupported: ['off', 'low', 'medium', 'high'] })
    useBackendStore.setState({ setThinking } as never)
    render(<ChatArea />)
    fireEvent.click(screen.getByTestId('select-think'))
    fireEvent.click(screen.getByTestId('select-think-option-high'))
    expect(setThinking).toHaveBeenCalledWith('high')
  })

  it('厂商不支持思考（supported 空）→ 思考选择器 disabled', () => {
    useRuntimeStore.setState({ thinkingSupported: [] })
    render(<ChatArea />)
    expect(screen.getByTestId('select-think')).toBeDisabled()
    // 工作模式选择器始终可用
    expect(screen.getByTestId('select-mode')).toBeEnabled()
  })
})
