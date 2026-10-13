// @vitest-environment jsdom
/**
 * 扩展服务组件测试（2026-10）：标题栏「扩展服务」按钮 → 右栏扩展服务面板，
 * 两级视图（五类分类清单 → 分类子面板），集中管理 MCP / 内置工具 / 技能 /
 * 插件 / harness。
 *
 * 覆盖：
 * - uiStore：openExtension / closeExtension 切换 rightView；
 * - extensionStore：openCategory / closeCategory（面板内分类视图）；
 * - TitleBar 扩展服务按钮：未连后端置灰；点击进面板、再点退出（toggle）；
 * - ExtensionPanel：默认渲染分类清单（五类入口）；点某类进子面板；挂载重置回
 *   清单；← 返回回信息面板；
 * - ExtensionMcpPanel：mcp.list 渲染清单；启停/删除（两步确认）调 mcp.disable /
 *   mcp.remove；新增表单提交调 mcp.add；编辑表单名只读；
 * - ExtensionToolsPanel / ExtensionSkillsPanel：清单渲染 + 关键字本地过滤；
 * - ExtensionPluginsPanel：已装清单 + 启停/卸载；市场搜索 plugins.search；安装
 *   调 plugins.install；
 * - ExtensionHarnessPanel：已装清单 + 启停/卸载；浏览市场 harness.market；安装调
 *   harness.install。
 *
 * 指令层用注入的假 runExtension 断言「UI 事件 → 动作调用」；真实的
 * extensions.exec 收发格式与后端实现在 jarvis 侧 tests/ui/test_workbench_extensions.py
 * 覆盖。
 *
 * @author aceFelix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import TitleBar from '@renderer/components/TitleBar'
import ExtensionPanel from '@renderer/components/ExtensionPanel'
import { useBackendStore } from '@renderer/stores/backendStore'
import { useExtensionStore } from '@renderer/stores/extensionStore'
import { useUiStore } from '@renderer/stores/uiStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

/** 假 runExtension 的处理函数：按 category/action 返回统一信封。 */
type Handler = (
  category: string,
  action: string,
  params: Record<string, unknown>
) => unknown

/** 注入假 runExtension（默认返回 ok=true），避免真连后端。 */
function injectRunExtension(handler: Handler): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (category: string, action: string, params = {}) =>
    handler(category, action, params as Record<string, unknown>)
  )
  useBackendStore.setState({ runExtension: fn } as never)
  return fn
}

/** MCP 清单快照（一件已连接、一件已禁用）。 */
function mcpList(): unknown {
  return {
    ok: true,
    data: {
      config_path: 'C:/Users/me/.jarvis/mcp.json',
      enabled: true,
      servers: [
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', 'server-filesystem'],
          env: {},
          disabled: false,
          connected: true,
          tools: ['read_file', 'write_file']
        },
        {
          name: 'git',
          command: 'uvx',
          args: [],
          env: { TOKEN: '${T}' },
          disabled: true,
          connected: false,
          tools: []
        }
      ]
    }
  }
}

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh')
  useUiStore.setState({ rightView: 'dashboard' })
  useExtensionStore.setState({ activeCategory: '' })
  useBackendStore.setState({ client: null, wsConnected: true })
})

afterEach(() => {
  cleanup()
})

describe('uiStore / extensionStore · 视图状态', () => {
  it('openExtension 进扩展面板；closeExtension 回信息面板', () => {
    useUiStore.getState().openExtension()
    expect(useUiStore.getState().rightView).toBe('extension')
    useUiStore.getState().closeExtension()
    expect(useUiStore.getState().rightView).toBe('dashboard')
  })

  it('openCategory 打开分类视图；closeCategory 回分类清单', () => {
    useExtensionStore.getState().openCategory('mcp')
    expect(useExtensionStore.getState().activeCategory).toBe('mcp')
    useExtensionStore.getState().closeCategory()
    expect(useExtensionStore.getState().activeCategory).toBe('')
  })
})

describe('TitleBar 扩展服务按钮', () => {
  it('未连后端时置灰', () => {
    useBackendStore.setState({ wsConnected: false })
    render(<TitleBar />)
    expect(screen.getByTestId('btn-open-extension')).toBeDisabled()
  })

  it('点击进扩展面板（按钮高亮）；再点退出回信息面板', () => {
    render(<TitleBar />)
    const btn = screen.getByTestId('btn-open-extension')
    fireEvent.click(btn)
    expect(useUiStore.getState().rightView).toBe('extension')
    expect(btn.className).toContain('active')
    fireEvent.click(btn)
    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

describe('ExtensionPanel · 两级视图', () => {
  it('默认渲染分类清单（五类入口）', () => {
    injectRunExtension(() => ({ ok: true, data: [] }))
    render(<ExtensionPanel />)
    expect(screen.getByTestId('extension-view')).toBeInTheDocument()
    expect(screen.getByTestId('extension-category-list')).toBeInTheDocument()
    for (const id of ['mcp', 'tools', 'skills', 'plugins', 'harness']) {
      expect(screen.getByTestId(`btn-extension-${id}`)).toBeInTheDocument()
    }
  })

  it('挂载时重置回分类清单（不残留上次打开的分类）', () => {
    useExtensionStore.setState({ activeCategory: 'mcp' })
    injectRunExtension(() => ({ ok: true, data: [] }))
    render(<ExtensionPanel />)
    expect(screen.getByTestId('extension-category-list')).toBeInTheDocument()
    expect(screen.queryByTestId('extension-mcp')).not.toBeInTheDocument()
  })

  it('点「MCP 服务」进子面板；← 返回回分类清单', async () => {
    injectRunExtension(() => mcpList())
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-mcp'))
    expect(await screen.findByTestId('extension-mcp')).toBeInTheDocument()
    expect(screen.queryByTestId('extension-category-list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('btn-extension-back'))
    expect(screen.getByTestId('extension-category-list')).toBeInTheDocument()
  })

  it('外层 ← 回信息面板（设置面板同机制的返回头）', () => {
    injectRunExtension(() => ({ ok: true, data: [] }))
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-close'))
    expect(useUiStore.getState().rightView).toBe('dashboard')
  })
})

describe('ExtensionMcpPanel · 清单与增删改启停', () => {
  /**
   * 渲染 MCP 子面板：handler 处理全部动作，写操作同步更新内存清单。
   * 返回假 runExtension 供断言。
   */
  function renderMcp(): ReturnType<typeof vi.fn> {
    const fn = injectRunExtension((_category, action) => {
      if (action === 'list') return mcpList()
      return { ok: true, message: `${action} 成功` }
    })
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-mcp'))
    return fn
  }

  it('mcp.list 渲染 server 清单（含连接态与工具数）', async () => {
    const fn = renderMcp()
    expect(await screen.findByTestId('mcp-item-filesystem')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-item-filesystem')).toHaveTextContent('已连接 · 2 个工具')
    expect(screen.getByTestId('mcp-item-git')).toHaveTextContent('未连接')
    expect(fn).toHaveBeenCalledWith('mcp', 'list', {})
  })

  it('启停按钮按当前禁用态发 enable / disable', async () => {
    const fn = renderMcp()
    await screen.findByTestId('mcp-item-git')
    // git 已禁用 → 按钮为「启用」→ 发 enable
    fireEvent.click(screen.getByTestId('mcp-toggle-git'))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('mcp', 'enable', { name: 'git' }))
    // filesystem 已启用 → 发 disable
    fireEvent.click(screen.getByTestId('mcp-toggle-filesystem'))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('mcp', 'disable', { name: 'filesystem' }))
  })

  it('删除走两步确认：首点只变文案，再点才发 remove', async () => {
    const fn = renderMcp()
    await screen.findByTestId('mcp-item-git')
    const del = screen.getByTestId('mcp-delete-git')
    fireEvent.click(del)
    expect(del).toHaveTextContent('确认删除')
    expect(fn).not.toHaveBeenCalledWith('mcp', 'remove', expect.anything())
    fireEvent.click(del)
    await waitFor(() => expect(fn).toHaveBeenCalledWith('mcp', 'remove', { name: 'git' }))
  })

  it('新增表单：服务名/命令必填拦截；提交发 mcp.add', async () => {
    const fn = renderMcp()
    await screen.findByTestId('mcp-item-git')
    fireEvent.click(screen.getByTestId('mcp-add'))
    expect(screen.getByTestId('mcp-form')).toBeInTheDocument()
    // 空表单提交 → 本地必填报错，不调后端
    fireEvent.click(screen.getByTestId('mcp-form-submit'))
    expect(screen.getByTestId('mcp-form-error')).toHaveTextContent('服务名与启动命令不能为空')
    expect(fn).not.toHaveBeenCalledWith('mcp', 'add', expect.anything())
    // 填写后提交 → mcp.add
    fireEvent.change(screen.getByTestId('mcp-form-name'), { target: { value: 'fetch' } })
    fireEvent.change(screen.getByTestId('mcp-form-command'), { target: { value: 'uvx' } })
    fireEvent.change(screen.getByTestId('mcp-form-args'), { target: { value: 'mcp-server-fetch' } })
    fireEvent.click(screen.getByTestId('mcp-form-submit'))
    await waitFor(() =>
      expect(fn).toHaveBeenCalledWith('mcp', 'add', {
        name: 'fetch',
        command: 'uvx',
        args: 'mcp-server-fetch',
        env: ''
      })
    )
  })

  it('编辑表单：服务名只读（名字是 mcp.json 的键），提交发 mcp.update', async () => {
    const fn = renderMcp()
    await screen.findByTestId('mcp-item-git')
    fireEvent.click(screen.getByTestId('mcp-edit-git'))
    const nameInput = screen.getByTestId('mcp-form-name') as HTMLInputElement
    expect(nameInput.value).toBe('git')
    expect(nameInput.readOnly).toBe(true)
    // 已有 env 回填为 K=V 行文本
    expect((screen.getByTestId('mcp-form-env') as HTMLTextAreaElement).value).toBe('TOKEN=${T}')
    fireEvent.click(screen.getByTestId('mcp-form-submit'))
    await waitFor(() =>
      expect(fn).toHaveBeenCalledWith('mcp', 'update', {
        name: 'git',
        command: 'uvx',
        args: '',
        env: 'TOKEN=${T}'
      })
    )
  })
})

describe('ExtensionToolsPanel / ExtensionSkillsPanel · 只读清单', () => {
  it('内置工具清单渲染 + 关键字本地过滤', async () => {
    injectRunExtension((category, action) => {
      if (category === 'tools' && action === 'list') {
        return {
          ok: true,
          data: [
            { name: 'bash', description: '执行 shell 命令' },
            { name: 'read_file', description: '读取文件' }
          ]
        }
      }
      return { ok: true, data: [] }
    })
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-tools'))
    expect(await screen.findByTestId('tool-item-bash')).toBeInTheDocument()
    expect(screen.getByTestId('tool-item-read_file')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('tools-search'), { target: { value: 'bash' } })
    expect(screen.getByTestId('tool-item-bash')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-item-read_file')).not.toBeInTheDocument()
  })

  it('技能清单渲染 + 目录列出', async () => {
    injectRunExtension((category, action) => {
      if (category === 'skills' && action === 'list') {
        return {
          ok: true,
          data: {
            dirs: [{ label: '项目', path: 'E:/proj/.jarvis/skills', exists: false }],
            skills: [
              { name: 'demo', source: '内置', description: '演示技能', when_to_use: '写网站' }
            ]
          }
        }
      }
      return { ok: true, data: [] }
    })
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-skills'))
    expect(await screen.findByTestId('skill-item-demo')).toBeInTheDocument()
    const dirs = screen.getByTestId('skills-dirs')
    expect(dirs).toHaveTextContent('E:/proj/.jarvis/skills')
    expect(dirs).toHaveTextContent('目录不存在')
  })

  it('拉取失败时显错误态', async () => {
    injectRunExtension(() => ({ ok: false, message: '未连接到后端' }))
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-tools'))
    expect(await screen.findByTestId('tools-error')).toHaveTextContent('未连接到后端')
  })
})

describe('ExtensionPluginsPanel · 已装清单与市场', () => {
  /** 渲染插件子面板（已装一件、市场两件）。 */
  function renderPlugins(): ReturnType<typeof vi.fn> {
    const fn = injectRunExtension((_category, action) => {
      if (action === 'list') {
        return {
          ok: true,
          data: [
            { name: 'demo-plugin', version: '1.0.0', source: '本地', installed_at: '', disabled: false }
          ]
        }
      }
      if (action === 'search') {
        return {
          ok: true,
          data: [
            { name: 'demo-plugin', version: '1.0.0', description: '已装', source: '本地', installed: true },
            { name: 'new-plugin', version: '0.2.0', description: '新插件', source: '远程', installed: false }
          ]
        }
      }
      return { ok: true, message: `${action} 成功` }
    })
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-plugins'))
    return fn
  }

  it('已装清单渲染；启停发 enable / disable', async () => {
    const fn = renderPlugins()
    expect(await screen.findByTestId('plugin-item-demo-plugin')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('plugin-toggle-demo-plugin'))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('plugins', 'disable', { name: 'demo-plugin' }))
  })

  it('卸载两步确认后发 uninstall', async () => {
    const fn = renderPlugins()
    await screen.findByTestId('plugin-item-demo-plugin')
    const del = screen.getByTestId('plugin-delete-demo-plugin')
    fireEvent.click(del)
    expect(del).toHaveTextContent('确认卸载')
    expect(fn).not.toHaveBeenCalledWith('plugins', 'uninstall', expect.anything())
    fireEvent.click(del)
    await waitFor(() =>
      expect(fn).toHaveBeenCalledWith('plugins', 'uninstall', { name: 'demo-plugin' })
    )
  })

  it('市场搜索：发 plugins.search；已装项不可再装，未装项可 install', async () => {
    const fn = renderPlugins()
    await screen.findByTestId('plugin-item-demo-plugin')
    fireEvent.change(screen.getByTestId('plugins-search-input'), { target: { value: 'plugin' } })
    fireEvent.click(screen.getByTestId('plugins-search-btn'))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('plugins', 'search', { keyword: 'plugin' }))
    expect(await screen.findByTestId('plugin-market-new-plugin')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-install-demo-plugin')).toBeDisabled()
    fireEvent.click(screen.getByTestId('plugin-install-new-plugin'))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('plugins', 'install', { name: 'new-plugin' }))
  })
})

describe('ExtensionHarnessPanel · 已装清单与市场', () => {
  /** 渲染 harness 子面板（已装一件、市场一件）。 */
  function renderHarness(): ReturnType<typeof vi.fn> {
    const fn = injectRunExtension((_category, action) => {
      if (action === 'list') {
        return {
          ok: true,
          data: [{ id: 'demo-h', name: 'Demo Harness', description: '示例', disabled: false }]
        }
      }
      if (action === 'market') {
        return {
          ok: true,
          data: [
            {
              id: 'new-h',
              name: 'New Harness',
              description: '新 harness',
              requires: 'gh',
              installed: false,
              source: '远程'
            }
          ]
        }
      }
      return { ok: true, message: `${action} 成功` }
    })
    render(<ExtensionPanel />)
    fireEvent.click(screen.getByTestId('btn-extension-harness'))
    return fn
  }

  it('已装清单渲染；启停发 enable / disable（参数用 id）', async () => {
    const fn = renderHarness()
    expect(await screen.findByTestId('harness-item-demo-h')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('harness-toggle-demo-h'))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('harness', 'disable', { id: 'demo-h' }))
  })

  it('浏览市场：发 harness.market，展示依赖；安装发 harness.install', async () => {
    const fn = renderHarness()
    await screen.findByTestId('harness-item-demo-h')
    fireEvent.click(screen.getByTestId('harness-market-toggle'))
    // 市场动作无参数（只传 category/action 两个实参）
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => c[0] === 'harness' && c[1] === 'market')).toBe(true)
    )
    const row = await screen.findByTestId('harness-market-new-h')
    expect(within(row).getByText(/依赖: gh/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('harness-install-new-h'))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('harness', 'install', { id: 'new-h' }))
  })

  it('卸载两步确认后发 uninstall', async () => {
    const fn = renderHarness()
    await screen.findByTestId('harness-item-demo-h')
    const del = screen.getByTestId('harness-delete-demo-h')
    fireEvent.click(del)
    expect(del).toHaveTextContent('确认卸载')
    fireEvent.click(del)
    await waitFor(() => expect(fn).toHaveBeenCalledWith('harness', 'uninstall', { id: 'demo-h' }))
  })
})
