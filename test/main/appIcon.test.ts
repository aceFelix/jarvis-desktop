/**
 * appIcon 单测：图标候选优先级、缺失降级、窗口/托盘同源逻辑。
 *
 * 背景（aceFelix）：2026-09-10 实机反馈任务栏原子 logo 与托盘反应炉不一致，
 * 图标解析收敛到 appIcon.ts 后，用本文件锁定「候选顺序 + 全缺失降级 null」
 * 两条核心语义，防止窗口/托盘取图标路径再次分叉。
 *
 * @author aceFelix
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// electron 在 vitest node 环境不可用：mock 掉运行时依赖，home 指向不存在目录
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'jarvis-desktop-nonexistent-home') },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true })
  }
}))

import { iconCandidates, loadAppIcon, pickIconPath, resolveIconPath } from '../../src/main/appIcon'

describe('pickIconPath', () => {
  it('返回第一个存在的候选路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'icon-'))
    const first = join(dir, 'a.ico')
    const second = join(dir, 'b.ico')
    writeFileSync(first, 'x')
    writeFileSync(second, 'y')

    expect(pickIconPath([join(dir, 'missing.ico'), first, second])).toBe(first)
  })

  it('候选全部缺失时返回 null（调用方降级）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'icon-'))
    expect(pickIconPath([join(dir, 'nope.ico')])).toBeNull()
  })

  it('空候选列表返回 null', () => {
    expect(pickIconPath([])).toBeNull()
  })
})

describe('resolveIconPath / loadAppIcon', () => {
  it('候选顺序：用户目录实底版优先，build/icon.ico 兜底', () => {
    const [userDir, buildDir] = iconCandidates()
    expect(userDir).toContain('.jarvis')
    expect(userDir).toContain('jarvis_window.ico')
    expect(buildDir).toContain('build')
    expect(buildDir).toContain('icon.ico')
  })

  it('build/icon.ico 已入库：home 缺失时兜底命中仓库图标', () => {
    // 守卫图标资源入库（scripts/gen_icon.py 生成）：若被误删/误 gitignore，
    // 窗口与托盘会同时退化为系统默认图标，这里提前报错
    expect(resolveIconPath()).toBe(iconCandidates()[1])
  })

  it('图标加载失败（isEmpty）时 loadAppIcon 返回 null', () => {
    // mock 的 nativeImage.createFromPath 恒返回 isEmpty=true
    expect(loadAppIcon()).toBeNull()
  })
})
