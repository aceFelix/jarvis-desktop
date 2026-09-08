/**
 * 渲染进程入口：挂载 React 根组件。
 *
 * @author aceFelix
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
