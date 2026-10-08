# 输入栏粘贴图片撑满窗口且无法删除：attach-chip 基础样式缺失修复

- 日期：2026-10-03
- 仓库：jarvis-desktop
- 作者：aceFelix

## 一、问题现象

桌面工作台向输入框 Ctrl+V 粘贴截图后，图片按**原始分辨率**渲染，直接把中栏
（甚至整个窗口）占满；chip 上的 ✕ 移除按钮被巨图挤出可视区，用户感知为
"图片无法删除"。文本文件 chip（短文件名）与小图粘贴不明显，全屏截图必现。

## 二、排查过程

1. 确认交互链路正常：`ChatArea.tsx` 输入框 `onPaste` → `attachStore.addFiles`
   → `#attach-chips` 区渲染 `<span class="attach-chip"><img/><button class="chip-remove">✕</button></span>`
   → 发送时转 base64 随 `message` 指令上送。逻辑与状态管理无误；
2. 检查样式：全项目 CSS 中 `attach-chip` 只有三处主题色覆盖
   （`theme-*.css` 的背景/边框/文字色）和一条 `.chip-remove:hover` 变色，
   **没有任何基础规则**——`.attach-chip` 本体的 padding/display、
   `.attach-chip img` 的尺寸约束全部缺失；
3. 对照同类场景：消息气泡里已发送的图片缩略图 `.msg-thumbs img` 有
   `max-width/max-height: 180px`，所以发送后显示正常——唯独待发 chip 漏了。

## 三、根因

`.attach-chip` 基础样式在样式文件拆分演进中从未落地（composer.css 从
main.css 拆出时只带走了容器 `#attach-chips` 与 hover 规则）。`<img>` 无
尺寸约束时按 intrinsic size 渲染，大图把 flex 容器与 ✕ 按钮一起撑爆；
按钮 DOM 存在但被推出可视区，表现为"无法删除"。

## 四、修复方案

`src/renderer/src/styles/composer.css` 补齐 chip 基础样式组：

| 规则 | 作用 |
|---|---|
| `.attach-chip` | `inline-flex` + padding/圆角/边框/底色（默认值，主题覆盖仍生效） |
| `.attach-chip img` | **锁死 56×56 方块 + `object-fit: cover`**，任意尺寸截图只缩略展示 |
| `.attach-chip .chip-name` | 文件名超 160px 省略号，不撑宽 chip |
| `.attach-chip .chip-remove` | 重置原生 button，`flex-shrink: 0` 常驻可见 |

不改 TSX/状态逻辑——链路本身是对的，纯样式缺陷。

## 五、验证结果

- `npm run typecheck` → 0 错误
- `npx vitest run` → 327 passed（18 文件），无回归
- `npm run build` → 构建通过
- 自动化测试说明：本次为纯 CSS 缺陷修复，无逻辑改动，jsdom 单测不验证
  布局样式（testing.md 例外条款：纯样式调整），以构建产物与人工走查为准
- 人工走查（待用户确认）：重启桌面壳 → 全屏截图 Ctrl+V → chip 显示 56px
  缩略图 + 可见 ✕，点 ✕ 可移除；📎 选多张大图同样不撑布局

## 六、涉及文件

| 文件 | 改动说明 |
|---|---|
| `src/renderer/src/styles/composer.css` | 补 `.attach-chip` 基础样式组（img 缩略约束/文件名省略/按钮重置） |
| `docs/fixlogs/attach-chip-image-overflow-fix.md` | 本复盘 |

## 七、经验总结

- **主题文件里的覆盖样式不能代替基础样式**：三主题都只写背景色，说明基础
  规则缺失时靠主题"看起来有边框"掩盖了问题，布局属性（尺寸约束）必须放
  在非主题的基础样式里；
- **任何用户可控来源的图片渲染（粘贴/附件/消息）都必须有显式尺寸上限**：
  `img` 不限尺寸 = 按原图撑布局，这是通用陷阱，新增图片展示位时优先复用
  `.msg-thumbs img` / `.attach-chip img` 的约束写法；
- "无法删除"类反馈先查按钮是否**存在但不可见**（被挤出可视区），往往不是
  事件问题而是布局问题。
