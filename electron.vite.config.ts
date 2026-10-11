import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // electron-updater 必须打进主进程 bundle：electron-builder 的 files 只含
    // out/** 与 package.json（不含 node_modules），外置它会运行时报
    // Cannot find module 'electron-updater'。@author aceFelix
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
