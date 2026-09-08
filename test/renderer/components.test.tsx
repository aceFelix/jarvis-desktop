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
import TitleBar from '@renderer/components/TitleBar'
import { useChatStore } from '@renderer/stores/chatStore'
import { useLeftStore } from '@renderer/stores/leftStore'
import { useMetricsStore } from '@renderer/stores/metricsStore'

beforeEach(() => {
  useChatStore.getState().clear()
  useLeftStore.setState({
    sessions: [],
    models: [],
    voices: [],
    activePanel: 'history',
    mode: 'text',
    talkActive: false
  })
  useMetricsStore.setState({ cpu: 0, memory: null, disk: null })
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

  it('未连接时发送按钮禁用', () => {
    render(<ChatArea />)
    expect(screen.getByText('发送')).toBeDisabled()
  })

  it('输入框可编辑（受控）', () => {
    render(<ChatArea />)
    const ta = screen.getByPlaceholderText(/和贾维斯说点什么/) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '测试文本' } })
    expect(ta.value).toBe('测试文本')
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
    fireEvent.click(screen.getByText('🤖 模型'))
    expect(screen.getByTestId('panel-model')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-history')).toBeNull()
    fireEvent.click(screen.getByText('🎵 音色'))
    expect(screen.getByTestId('panel-voice')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-model')).toBeNull()
  })

  it('渲染会话 / 模型 / 音色列表项', () => {
    useLeftStore.setState({
      sessions: [{ name: '会话A', updated_at: 1_700_000_000, message_count: 3, model: 'gpt' }],
      models: [{ name: 'gpt-4', current: true }],
      voices: [{ name: '晓晓', current: false }],
      activePanel: 'history',
      mode: 'text',
      talkActive: false
    })
    render(<LeftSidebar />)
    expect(screen.getByText('会话A')).toBeInTheDocument()
    fireEvent.click(screen.getByText('🤖 模型'))
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
    fireEvent.click(screen.getByText('🎵 音色'))
    expect(screen.getByText('晓晓')).toBeInTheDocument()
  })

  it('切换到实时模式后按钮高亮', () => {
    render(<LeftSidebar />)
    fireEvent.click(screen.getByText('🎙️ 实时'))
    expect(screen.getByText('🎙️ 实时').className).toContain('active')
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
})
