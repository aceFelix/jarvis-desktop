// @vitest-environment jsdom
/**
 * 渲染层组件测试（@testing-library/react）—— 覆盖计划 B5 要求的
 * "消息气泡流式渲染" 与 "面板切换"，另加标题栏窗口控制与右栏指标。
 *
 * 说明：不渲染 App / ReactorCanvas（会挂载 canvas 动画，jsdom 无 2D 上下文），
 * 逐个渲染纯展示组件；后端 client 默认 null，组件不会真正发起 WS 连接。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
    voiceState: ''
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

  it('📸 截屏按钮：主进程返回 base64 后入附件区 chips', async () => {
    // 截屏入口自右栏快捷操作迁入输入栏：captureScreen → attachStore.addImage
    // → chips 渲染，随下一条消息走 vision 上送。@author aceFelix
    ;(window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop = {
      captureScreen: vi.fn().mockResolvedValue({ data: 'QUJD', media_type: 'image/png' })
    }
    useBackendStore.setState({ client: null, wsConnected: true })
    render(<ChatArea />)
    fireEvent.click(screen.getByTestId('btn-capture'))
    await vi.waitFor(() => expect(screen.getByTestId('attach-chips')).toBeInTheDocument())
    const pending = useAttachStore.getState().pending
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ kind: 'image', b64: 'QUJD', mediaType: 'image/png' })
    useBackendStore.setState({ wsConnected: false })
  })

  it('渲染工具卡片与系统提示', () => {
    useChatStore.getState().addToolCard('read_file', 'c1', '{"p":1}')
    useChatStore.getState().addSystem('已就绪')
    render(<ChatArea />)
    expect(screen.getByTestId('tool-card')).toBeInTheDocument()
    expect(screen.getByTestId('msg-system')).toHaveTextContent('已就绪')
  })

  it('ask_user 出现时渲染回答条', () => {
    useChatStore.getState().showAskUser('是否继续？')
    render(<ChatArea />)
    expect(screen.getByTestId('ask-user-bar')).toBeInTheDocument()
    expect(screen.getByText('是否继续？')).toBeInTheDocument()
  })

  it('未连接时发送/附件/截屏按钮禁用', () => {
    render(<ChatArea />)
    expect(screen.getByTestId('btn-send')).toBeDisabled()
    expect(screen.getByTestId('btn-attach')).toBeDisabled()
    expect(screen.getByTestId('btn-capture')).toBeDisabled()
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
      voices: [{ name: '晓晓', current: false }],
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
    expect(screen.getByTestId('time-briefing-time')).toHaveValue('07:15')
    expect(screen.getByTestId('time-deadline-check-time')).toHaveValue('21:00')
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

  it('改简报时间：HH:MM 提交发 settings.set，非法值不发', () => {
    const client = { sendCommand: vi.fn().mockResolvedValue({ ok: true, result: {} }) }
    useBackendStore.setState({ client: client as unknown as JarvisWsClient })
    useSettingsStore
      .getState()
      .applyBackendSettings({ ...EMPTY_BACKEND_SETTINGS, briefing_time: '08:30' })
    render(<SettingsPanel />)
    const input = screen.getByTestId('time-briefing-time')
    fireEvent.change(input, { target: { value: '06:45' } })
    expect(client.sendCommand).toHaveBeenCalledWith(Cmd.SettingsSet, { briefing_time: '06:45' })
    // 清空/半填不是合法 HH:MM → 不发指令（后端不被脏值敲）
    fireEvent.change(input, { target: { value: '' } })
    expect(client.sendCommand).toHaveBeenCalledTimes(1)
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

  it('用量卡渲染 token 统计（千分位分组）', () => {
    useRightStore.setState({
      cost: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        input_tokens: 12345,
        output_tokens: 678,
        cache_read_tokens: 50,
        cache_creation_tokens: 10,
        dialogs: 3,
        messages: 8
      }
    })
    render(<RightSidebar />)
    const card = screen.getByTestId('usage-card')
    expect(card).toHaveTextContent('deepseek-chat')
    expect(card).toHaveTextContent('12,345')
    expect(card).toHaveTextContent('3 轮 / 8 条')
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
