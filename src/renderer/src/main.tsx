/**
 * 渲染进程入口：挂载 React 根组件。
 *
 * @author aceFelix
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/main.css'
// 中栏对话展示层（#center-col / 气泡 / 思考块 / 工具卡组）：2026-10 按职责从
// main.css 拆出（单文件 800 行规范），引入顺序保持与拆分前同一文件内的级联一致
import './styles/chat.css'
// 输入栏层（.glass-bar / .composer-side / 附件 chips / ask-user / voice / .action-btn）
import './styles/composer.css'
// 右栏层（指标卡 + 五区块，含 .settings-panel(.form-scroll)）
import './styles/right-column.css'
// 启动遮罩层（后端未就绪等待卡）
import './styles/boot.css'
// 表单控件层（输入框 / 自绘下拉 / 改名输入框）：按职责从 main.css 拆出，需晚于上述
// 基础层、早于三张皮肤引入
import './styles/controls.css'
// 项目工作区（2026-08 左栏顶部项目区）：按职责拆分的模块样式，同样需早于皮肤
// 引入以允许主题层基于 `.project-*` 前缀适当覆盖色板。@author aceFelix
import './styles/project-section.css'
// 跨设备协同（2026-10 输入栏下拉 + 内联二维码卡片）：按职责拆分的模块样式，
// 同样需早于皮肤引入以允许主题层基于 --edge-* 联动。@author aceFelix
import './styles/remote.css'
import './styles/theme-dark-y2k.css'
import './styles/theme-light-y2k.css'
import './styles/theme-retro.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
