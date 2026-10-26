/**
 * dispatcher 测试的共用夹具 —— 假连接门面与各 store 的复位。
 *
 * 为什么单独成文件（aceFelix，2026-10 阶段 10 W3）：`dispatcher.test.ts` 已越过
 * 单文件 800 行上限，按**事件域**拆出 `dispatcherNotify.test.ts`（主动播报 /
 * 跨设备协同 / 消息回溯 / 斜杠命令输出）。两个文件都需要同一个假 JarvisConnection
 * （每个刷新动作都是 spy）与同一套 store 复位，复制一份就会在加动作时漏改一边，
 * 所以抽到这里共用。
 *
 * `makeConn()` 的返回类型仍是 `JarvisConnection`：门面加成员而这里没跟上时，
 * typecheck 会直接报错，不会让某个用例静默少测一次刷新。
 *
 * @author aceFelix
 */

import { vi } from 'vitest'
import { useChatStore } from '@renderer/stores/chatStore'
import { useLeftStore } from '@renderer/stores/leftStore'
import { useMetricsStore } from '@renderer/stores/metricsStore'
import { useRightStore } from '@renderer/stores/rightStore'
import { useRemoteStore } from '@renderer/stores/remoteStore'
import type { JarvisConnection } from '@renderer/stores/backendStore'

/** 假连接门面：十二个刷新动作 + 提醒已读回执均为 spy。 */
export function makeConn(): JarvisConnection {
  return {
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    refreshModels: vi.fn().mockResolvedValue(undefined),
    refreshVoices: vi.fn().mockResolvedValue(undefined),
    refreshSchedule: vi.fn().mockResolvedValue(undefined),
    refreshCost: vi.fn().mockResolvedValue(undefined),
    refreshState: vi.fn().mockResolvedValue(undefined),
    refreshSettings: vi.fn().mockResolvedValue(undefined),
    // 感知源面板重拉（2026-10 阶段 12）：模型改感知配置后 settings_changed 触发。
    // @author aceFelix
    refreshPercept: vi.fn(),
    // 项目区刷新（2026-08）：init / project_switched 都会拉取一次。
    // @author aceFelix
    refreshProjects: vi.fn().mockResolvedValue(undefined),
    // 跨设备协同连接态刷新（2026-10）：init 拉取一次回填 remoteStore。
    // @author aceFelix
    refreshRemote: vi.fn().mockResolvedValue(undefined),
    // 斜杠命令补全目录刷新（2026-10 slash.commands）：init 拉取一次回填 slashStore。
    // @author aceFelix
    refreshSlashCommands: vi.fn().mockResolvedValue(undefined),
    // 任务中心刷新（2026-10 阶段 10 W3）：init / assistant_done / kind=task 播报都会拉。
    // @author aceFelix
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    ackProactive: vi.fn()
  }
}

/** 各 store 复位：避免上一个用例的残留气泡/列表影响下一个断言。 */
export function resetDispatcherStores(): void {
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
    // 待生效模型为瞬态：复位避免串场到下一个用例。@author aceFelix
    pendingModel: '',
    // 项目区（2026-08）瞬态字段一并复位：上一用例已回填的项目信息会干扰后续项目断言。
    // @author aceFelix
    currentProject: null,
    recentProjects: [],
    pendingProjectPath: ''
  })
  useMetricsStore.setState({ cpu: 0, memory: null, disk: null })
  useRightStore.setState({ reminders: [], deadlines: [], latestBriefing: '', cost: null, mcp: null, logs: [] })
  // 跨设备协同连接态（2026-10）：复位避免串场。
  // @author aceFelix
  useRemoteStore.setState({ phoneConnected: false, wechatConnected: false })
}
