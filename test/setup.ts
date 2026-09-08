/**
 * vitest 全局初始化 —— 注册 @testing-library/jest-dom 断言扩展。
 *
 * 该入口仅调用 expect.extend 注册匹配器（导入期不触碰 DOM），
 * 故 node 与 jsdom 两种环境的测试文件均可安全加载。
 *
 * @author aceFelix
 */
import '@testing-library/jest-dom/vitest'
