/**
 * 渲染进程入口：挂载 React 根组件。
 *
 * @author aceFelix
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/main.css'
// 表单控件层（输入框 / 自绘下拉 / 改名输入框）：按职责从 main.css 拆出，需早于三张皮肤引入
import './styles/controls.css'
import './styles/theme-dark-y2k.css'
import './styles/theme-light-y2k.css'
import './styles/theme-retro.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
