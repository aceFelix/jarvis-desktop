// @vitest-environment jsdom
/**
 * ProjectSection 组件测试（2026-08 桌面项目工作区）。
 *
 * 覆盖：
 * - 当前项目展示 + 待生效徽标；
 * - 「打开文件夹」按钮调用 window.jarvisDesktop.selectDirectory，成功后 setProject；
 * - 最近项目点击 → setProject；
 * - 右键显示「从列表移除」按钮，点击后 forgetProject；
 * - exists=false 项展示"目录不存在"徽标。
 *
 * 后端 client 保持 null：本测试只验证 UI 事件路由到 backendStore 动作，不测指令
 * 收发（那部分在 backendStore.test.ts 已覆盖）。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import ProjectSection from '@renderer/components/ProjectSection'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useLeftStore } from '@renderer/stores/leftStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

beforeEach(() => {
  // 语言默认中文（与项目其它测试同口径），i18n 用例断言取默认 zh
  useSettingsStore.getState().setLanguage('zh')
  useLeftStore.setState({
    currentProject: null,
    recentProjects: [],
    pendingProjectPath: ''
  })
  // 隔离 WS 状态：组件 wsConnected=false 时不会自动刷新项目区数据
  useBackendStore.setState({ client: null, wsConnected: false })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop
})

describe('ProjectSection', () => {
  it('未选择项目时显示空态', () => {
    render(<ProjectSection />)
    expect(screen.getByText('未选择项目')).toBeInTheDocument()
  })

  it('已选择项目时显示当前项目名 + pending 时显「待生效」徽标', () => {
    useLeftStore.setState({
      currentProject: { workdir: 'D:/proj/old', name: 'old', persisted: true },
      pendingProjectPath: 'D:/proj/new'
    })
    render(<ProjectSection />)
    expect(screen.getByText('old')).toBeInTheDocument()
    expect(screen.getByText('待生效')).toBeInTheDocument()
  })

  it('「＋ 打开文件夹」调 selectDirectory，成功回选调 setProject', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:/proj/x')
    const setProject = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop = { selectDirectory }
    useBackendStore.setState({ setProject } as never)
    render(<ProjectSection />)
    fireEvent.click(screen.getByText('＋ 打开文件夹'))
    await vi.waitFor(() => expect(setProject).toHaveBeenCalledWith('D:/proj/x'))
    expect(selectDirectory).toHaveBeenCalledTimes(1)
  })

  it('「＋ 打开文件夹」用户取消 → 不调 setProject', async () => {
    const selectDirectory = vi.fn().mockResolvedValue(null)
    const setProject = vi.fn()
    ;(window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop = { selectDirectory }
    useBackendStore.setState({ setProject } as never)
    render(<ProjectSection />)
    fireEvent.click(screen.getByText('＋ 打开文件夹'))
    // 让微任务队列走一轮
    await Promise.resolve()
    expect(setProject).not.toHaveBeenCalled()
  })

  it('最近项目点击非当前项 → 调 setProject', () => {
    const setProject = vi.fn()
    useLeftStore.setState({
      currentProject: { workdir: 'D:/proj/a', name: 'a', persisted: true },
      recentProjects: [
        { path: 'D:/proj/a', name: 'a', last_opened: '', exists: true },
        { path: 'D:/proj/b', name: 'b', last_opened: '', exists: true }
      ]
    })
    useBackendStore.setState({ setProject } as never)
    render(<ProjectSection />)
    fireEvent.click(screen.getByText('b'))
    expect(setProject).toHaveBeenCalledWith('D:/proj/b')
  })

  it('最近项目当前项点击 → 不发 setProject（noop 视觉 + 事件守卫）', () => {
    const setProject = vi.fn()
    useLeftStore.setState({
      currentProject: { workdir: 'D:/proj/a', name: 'a', persisted: true },
      recentProjects: [{ path: 'D:/proj/a', name: 'a', last_opened: '', exists: true }]
    })
    useBackendStore.setState({ setProject } as never)
    render(<ProjectSection />)
    // 限定到“最近项目列表”区域，避免与“当前项目”行同名时 getByText 多命中。
    // @author aceFelix
    const recent = screen.getByText('最近项目').parentElement
    expect(recent).not.toBeNull()
    fireEvent.click(within(recent as HTMLElement).getByText('a'))
    expect(setProject).not.toHaveBeenCalled()
  })

  it('右键最近项目 → 显示「从列表移除」按钮；点击调 forgetProject', () => {
    const forgetProject = vi.fn().mockResolvedValue(true)
    const setProject = vi.fn()
    useLeftStore.setState({
      currentProject: null,
      recentProjects: [{ path: 'D:/proj/x', name: 'x', last_opened: '', exists: true }]
    })
    useBackendStore.setState({ forgetProject, setProject } as never)
    render(<ProjectSection />)
    fireEvent.contextMenu(screen.getByText('x'))
    const btn = screen.getByText('从列表移除')
    fireEvent.click(btn)
    expect(forgetProject).toHaveBeenCalledWith('D:/proj/x')
  })

  it('exists=false 显示「目录不存在」徽标', () => {
    useLeftStore.setState({
      currentProject: null,
      recentProjects: [{ path: 'D:/proj/gone', name: 'gone', last_opened: '', exists: false }]
    })
    render(<ProjectSection />)
    expect(screen.getByText('目录不存在')).toBeInTheDocument()
  })
})
