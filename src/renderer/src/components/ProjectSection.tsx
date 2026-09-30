/**
 * 左栏底部「项目」区（2026-08 桌面项目工作区）。
 *
 * 职责：
 * - 展示当前项目名 + 路径 tooltip；已点选、待引擎落地时右侧显「待生效」徽标；
 * - 「＋ 打开文件夹」按钮：调用主进程 dialog.showOpenDirectory 拿绝对路径，
 *   成功后 backendStore.setProject(path) 上送 WS `project.set` 指令；
 * - 最近项目列表：点击项 = 切换项目；右键项 = 显示「从列表移除」按钮
 *   （对齐会话/模型/音色的右键交互）；exists=false 项置灰仍可移除（清理残留）。
 *
 * 数据源全部来自 leftStore（后端 project.get / projects.list 结果 + 引擎
 * project_switched 事件），本组件不直接持 WS 客户端。
 *
 * 挂载位置：左栏面板区之后、状态栏之前（底部常驻），切换
 * history/model/voice 面板时始终可见。
 *
 * 安全边界：
 * - 渲染进程不接触 fs/path，一切目录访问通过主进程 dialog 单点弹框；
 * - 后端对路径二次校验（存在 + 绝对），拒绝空/相对/自动建目录。
 *
 * @author aceFelix
 */

import { useEffect, useRef, useState } from 'react'
import { useBackendStore } from '../stores/backendStore'
import { useLeftStore } from '../stores/leftStore'
import { useT } from '../i18n'

/**
 * 项目区主组件。
 *
 * 挂载即拉取当前项目 + 最近项目（backendStore.refreshProjects），后端未连接
 * 或旧版 API 未提供时降级为空态、不 crash。
 */
export default function ProjectSection(): JSX.Element {
  const t = useT()
  const currentProject = useLeftStore((s) => s.currentProject)
  const recentProjects = useLeftStore((s) => s.recentProjects)
  const pendingProjectPath = useLeftStore((s) => s.pendingProjectPath)
  const setProject = useBackendStore((s) => s.setProject)
  const forgetProject = useBackendStore((s) => s.forgetProject)
  const refreshProjects = useBackendStore((s) => s.refreshProjects)

  // 右键唤起的「从列表移除」目标 path（同时只能有一项显示按钮，口径同会话面板）
  const [forgetTarget, setForgetTarget] = useState<string>('')
  // 上一次已拉取过的 wsConnected 值，避免重复请求；连接建立后再拉一次
  const lastFetched = useRef<boolean>(false)
  const wsConnected = useBackendStore((s) => s.wsConnected)

  // WS 首次 ready 时拉项目区数据；之后 project_switched 事件驱动重拉
  useEffect(() => {
    if (wsConnected && !lastFetched.current) {
      lastFetched.current = true
      void refreshProjects()
    }
    if (!wsConnected) lastFetched.current = false
  }, [wsConnected, refreshProjects])

  /** 「打开文件夹」：调主进程 dialog；返回非 null 才发指令。 */
  const openFolder = async (): Promise<void> => {
    const pick = await window.jarvisDesktop?.selectDirectory?.()
    if (!pick) return // 用户取消
    await setProject(pick)
  }

  /** 点击最近项目项：切项目；pending / current 项在 backendStore.setProject 里做去重。 */
  const onSelectRecent = (path: string): void => {
    setForgetTarget('')
    void setProject(path)
  }

  /** 右键最近项目项：显示「从列表移除」按钮（不自动删，避免误触）。 */
  const onContextRecent = (e: React.MouseEvent, path: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setForgetTarget(path)
  }

  /** 点击「从列表移除」：调 projects.forget；成功由后端写库后返回。 */
  const onForget = async (path: string): Promise<void> => {
    setForgetTarget('')
    await forgetProject(path)
  }

  const pending = !!pendingProjectPath && pendingProjectPath !== currentProject?.workdir
  const currentPath = currentProject?.workdir ?? ''
  const currentName = currentProject?.name ?? ''

  return (
    <div className="project-section" role="region" aria-label={t('left.projectTitle')}>
      {/* 头部：标题 + 打开文件夹按钮（当前项目路径过长时 ellipsis，完整路径 tooltip） */}
      <div className="project-header">
        <span className="project-title">{t('left.projectTitle')}</span>
        <button
          type="button"
          className="project-open-btn"
          title={t('left.projectOpenFolderTip')}
          onClick={() => void openFolder()}
        >
          {t('left.projectOpenFolder')}
        </button>
      </div>

      {/* 当前项目行：名字 + 待生效徽标；无 currentProject 时显空态 */}
      <div
        className={`project-current${currentPath ? '' : ' empty'}`}
        title={currentPath ? t('left.projectCurrentTip', { path: currentPath }) : undefined}
      >
        <span className="project-current-name">
          {currentPath ? currentName : t('left.projectCurrentEmpty')}
        </span>
        {pending && <span className="project-badge pending">{t('left.pending')}</span>}
      </div>

      {/* 最近项目：点击切换 / 右键显示"从列表移除" */}
      <div className="project-recent">
        <div className="project-recent-label">{t('left.projectRecent')}</div>
        {recentProjects.length === 0 ? (
          <div className="project-recent-empty">{t('left.projectRecentEmpty')}</div>
        ) : (
          <ul className="project-recent-list">
            {recentProjects.map((p) => {
              const isCurrent = currentPath === p.path
              const isPendingSame = pendingProjectPath === p.path
              const missing = !p.exists
              const classes = [
                'project-recent-item',
                isCurrent ? 'current' : '',
                isPendingSame ? 'pending' : '',
                missing ? 'missing' : '',
                isCurrent ? 'noop' : ''
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <li key={p.path} className={classes}>
                  <div
                    role="button"
                    tabIndex={0}
                    className="project-recent-main"
                    title={t('left.projectRecentItemTip') + '\n' + p.path}
                    onClick={() => !isCurrent && onSelectRecent(p.path)}
                    onContextMenu={(e) => onContextRecent(e, p.path)}
                    onKeyDown={(e) => {
                      if (!isCurrent && (e.key === 'Enter' || e.key === ' ')) onSelectRecent(p.path)
                    }}
                  >
                    <span className="project-recent-name">{p.name}</span>
                    <span className="project-recent-path">{p.path}</span>
                    {missing && (
                      <span className="project-badge missing">{t('left.projectMissing')}</span>
                    )}
                  </div>
                  {forgetTarget === p.path && (
                    <button
                      type="button"
                      className="project-forget-btn"
                      title={t('left.projectForget')}
                      onClick={() => void onForget(p.path)}
                    >
                      {t('left.projectForget')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
