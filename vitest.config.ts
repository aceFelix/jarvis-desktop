import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // React 插件仅用于 .tsx 组件测试的自动 JSX 运行时（react-jsx），
  // 纯逻辑 .ts 测试无 JSX，不受影响。
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // 渲染层组件测试文件头部用 @vitest-environment jsdom 单独声明
    globals: false,
    setupFiles: ['test/setup.ts']
  }
})
