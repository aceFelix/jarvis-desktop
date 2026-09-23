/**
 * 轻量 i18n：zh/en 静态文案字典 + useT()/translate()。
 *
 * 覆盖口径（v1）：渲染层静态界面文案（栏标题/按钮/空态/设置项/placeholder
 * 等）；运行时状态文本（状态栏 statusLabel、语音阶段标签）与后端事件推送的
 * 系统消息/日志流暂保持中文——它们是事件快照而非静态 chrome。
 *
 * 用法：组件内 `const t = useT()` 后 `t('chat.send')`；带参文案用
 * `t('right.daysLeft', { n: 3 })` 替换模板里的 `{n}`。
 *
 * @author aceFelix
 */

import { useSettingsStore, type Language } from './stores/settingsStore'

type Dict = Record<string, string>

const zh: Dict = {
  // ---- 标题栏 / 启动遮罩 ----
  'app.subtitle': '· 桌面工作台',
  'app.minimize': '最小化',
  'app.closeTip': '关闭（隐藏到托盘）',
  'boot.error': '后端启动失败',
  'boot.exited': '后端进程已退出',
  'boot.errorHint': '请检查 Python 环境与 jarvis 仓库路径（JARVIS_PYTHON / JARVIS_REPO），详见日志 userData/logs/desktop.log',
  'boot.loading': '正在拉起 jarvis 后端（python -m agent.serve）...',

  // ---- 左栏 ----
  'left.console': '控制台',
  'left.mode.text': '💬 文本',
  'left.mode.talk': '🎙️ 实时',
  'left.mode.voice': '🎤 语音',
  'left.mode.text.tip': '文本对话',
  'left.mode.talk.tip': '实时语音（/talk）',
  'left.mode.voice.tip': '半双工语音（/voice：说话→回复→再听）',
  'left.panel.history': '📜 历史会话',
  'left.panel.model': '🤖 模型',
  'left.panel.voice': '🎵 音色',
  'left.newSession': '＋ 新建会话',
  'left.modelTitle': '对话模型',
  'left.voiceTitle': 'TTS 音色',
  'left.current': '当前',
  'left.messagesCount': '{n} 条消息',
  'left.talkActive': '🎙️ 实时中',
  'left.voiceActive': '🎤 语音中',

  // ---- 中栏对话区 ----
  'chat.you': '你',
  'chat.jarvis': '贾维斯',
  'chat.placeholder': '和贾维斯说点什么...（Enter 发送，Shift+Enter 换行，可直接粘贴图片）',
  'chat.send': '发送',
  'chat.stop': '■ 停止',
  'chat.stopTip': '停止贾维斯当前回复/思考',
  'chat.micTip': '开始/结束实时语音',
  'chat.attachTip': '附加图片或文本文件（图片走视觉，文件内容拼进消息）',
  'chat.captureTip': '截取主屏并加入附件区，随下一条消息发给贾维斯',
  'chat.chipRemoveTip': '移除附件',
  'chat.askPlaceholder': '输入回答...',
  'chat.voiceDefault': '语音中...',
  'chat.voiceOn': '语音已开启',
  'chat.interrupt': '✋ 打断',
  'chat.interruptTip': '打断当前播报/识别（不停会话）',
  'chat.exitVoice': '⏹ 退出语音',
  'chat.exitVoiceTip': '退出语音，回文本模式',
  'chat.copy': '📋 复制',
  'chat.copied': '✓ 已复制',
  'chat.copyTip': '复制这条回复',
  'chat.copyFail': '✗ 复制失败',
  'chat.captureOk': '📸 截图已加入附件区，随下一条消息发送',
  'chat.captureFailNoSource': '✗ 截屏失败：无可用屏源',
  'chat.captureFail': '✗ 截屏失败：{reason}',

  // ---- 右栏 ----
  'right.settings': '设置',
  'right.tasks': '任务中心',
  'right.usage': '会话与用量',
  'right.system': '系统状态',
  'right.health': '运行健康',
  'right.noTasks': '暂无待办提醒',
  'right.briefing': '最近简报',
  'right.noCost': '暂无用量数据',
  'right.model': '模型',
  'right.dialogs': '对话',
  'right.dialogsValue': '{d} 轮 / {m} 条',
  'right.inputTokens': '输入 token',
  'right.outputTokens': '输出 token',
  'right.cacheTokens': '缓存 token',
  'right.cacheTitle': '读 {r} / 写 {w}',
  'right.mcpOff': 'MCP 未启用',
  'right.mcpUp': 'MCP {c} 连',
  'right.mcpFailedSuffix': ' / {f} 败',
  'right.mcpTools': ' · {t} 工具',
  'right.mcpFailedLabel': '失败：',
  'right.noLogs': '暂无运行日志',
  'right.daily': '每日',
  'right.weekly': '每周',
  'right.overdue': '已逾期 {n} 天',
  'right.dueToday': '今天截止',
  'right.daysLeft': '还剩 {n} 天',
  'right.memory': '内存',
  'right.disk': '磁盘',

  // ---- 设置面板 ----
  'settings.theme': '主题',
  'settings.theme.dark': '深色',
  'settings.theme.light': '浅色',
  'settings.language': '语言'
}

const en: Dict = {
  // ---- Title bar / boot overlay ----
  'app.subtitle': '· Desktop Workbench',
  'app.minimize': 'Minimize',
  'app.closeTip': 'Close (hide to tray)',
  'boot.error': 'Backend failed to start',
  'boot.exited': 'Backend process exited',
  'boot.errorHint': 'Check the Python env and jarvis repo path (JARVIS_PYTHON / JARVIS_REPO); see userData/logs/desktop.log',
  'boot.loading': 'Launching jarvis backend (python -m agent.serve)...',

  // ---- Left sidebar ----
  'left.console': 'Console',
  'left.mode.text': '💬 Text',
  'left.mode.talk': '🎙️ Live',
  'left.mode.voice': '🎤 Voice',
  'left.mode.text.tip': 'Text chat',
  'left.mode.talk.tip': 'Real-time voice (/talk)',
  'left.mode.voice.tip': 'Half-duplex voice (/voice: speak → reply → listen)',
  'left.panel.history': '📜 History',
  'left.panel.model': '🤖 Models',
  'left.panel.voice': '🎵 Voices',
  'left.newSession': '＋ New Session',
  'left.modelTitle': 'Chat Models',
  'left.voiceTitle': 'TTS Voices',
  'left.current': 'current',
  'left.messagesCount': '{n} messages',
  'left.talkActive': '🎙️ Live',
  'left.voiceActive': '🎤 Voice',

  // ---- Chat area ----
  'chat.you': 'You',
  'chat.jarvis': 'Jarvis',
  'chat.placeholder': 'Say something to Jarvis... (Enter to send, Shift+Enter for newline, paste images directly)',
  'chat.send': 'Send',
  'chat.stop': '■ Stop',
  'chat.stopTip': "Stop Jarvis' current reply/thinking",
  'chat.micTip': 'Start/stop real-time voice',
  'chat.attachTip': 'Attach images or text files (images via vision; file contents appended to the message)',
  'chat.captureTip': 'Capture the primary screen into the attachment area; sent with your next message',
  'chat.chipRemoveTip': 'Remove attachment',
  'chat.askPlaceholder': 'Type your answer...',
  'chat.voiceDefault': 'Voice...',
  'chat.voiceOn': 'Voice on',
  'chat.interrupt': '✋ Interrupt',
  'chat.interruptTip': 'Interrupt current playback/recognition (session keeps running)',
  'chat.exitVoice': '⏹ Exit Voice',
  'chat.exitVoiceTip': 'Exit voice mode, back to text',
  'chat.copy': '📋 Copy',
  'chat.copied': '✓ Copied',
  'chat.copyTip': 'Copy this reply',
  'chat.copyFail': '✗ Copy failed',
  'chat.captureOk': '📸 Screenshot added to attachments; sent with your next message',
  'chat.captureFailNoSource': '✗ Capture failed: no screen source',
  'chat.captureFail': '✗ Capture failed: {reason}',

  // ---- Right sidebar ----
  'right.settings': 'Settings',
  'right.tasks': 'Task Center',
  'right.usage': 'Session & Usage',
  'right.system': 'System Status',
  'right.health': 'Health',
  'right.noTasks': 'No pending reminders',
  'right.briefing': 'Latest Briefing',
  'right.noCost': 'No usage data',
  'right.model': 'Model',
  'right.dialogs': 'Dialogs',
  'right.dialogsValue': '{d} rounds / {m} msgs',
  'right.inputTokens': 'Input tokens',
  'right.outputTokens': 'Output tokens',
  'right.cacheTokens': 'Cache tokens',
  'right.cacheTitle': 'read {r} / write {w}',
  'right.mcpOff': 'MCP disabled',
  'right.mcpUp': 'MCP {c} up',
  'right.mcpFailedSuffix': ' / {f} failed',
  'right.mcpTools': ' · {t} tools',
  'right.mcpFailedLabel': 'Failed: ',
  'right.noLogs': 'No runtime logs',
  'right.daily': 'daily',
  'right.weekly': 'weekly',
  'right.overdue': '{n}d overdue',
  'right.dueToday': 'Due today',
  'right.daysLeft': '{n}d left',
  'right.memory': 'Memory',
  'right.disk': 'Disk',

  // ---- Settings panel ----
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.language': 'Language'
}

const dicts: Record<Language, Dict> = { zh, en }

/** 模板插值：{name} → vars[name]（缺参保留原样占位）。 */
function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`
  )
}

/** 查键：当前语言 → 中文兜底 → 键名兜底（绝不渲染空串）。 */
function lookup(language: Language, key: string, vars?: Record<string, string | number>): string {
  return format(dicts[language][key] ?? zh[key] ?? key, vars)
}

/** 非组件环境翻译（取 settingsStore 当前语言）。 */
export function translate(key: string, vars?: Record<string, string | number>): string {
  return lookup(useSettingsStore.getState().language, key, vars)
}

/** 组件内翻译 hook：订阅语言变化，切换语言后自动重渲染。 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const language = useSettingsStore((s) => s.language)
  return (key, vars) => lookup(language, key, vars)
}
