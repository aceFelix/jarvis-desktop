/**
 * 字体偏好纯函数：UI 字体栈拼装 + 中文字体粗判（供设置面板分组/标签）。
 *
 * 设计口径（2026-09 字体设置）：
 * - 桌面壳允许「英文字体」「中文字体」各自单设。落地靠 CSS font-family 的
 *   有序候选栈——浏览器对每个字符取第一个含其字形的字体，故把英文字体放前、
 *   中文字体放后，拉丁字符命中英文字体、汉字自动落到中文字体，二者互不干扰；
 * - 尾部始终追加主题原等宽栈（FALLBACK_TAIL），保证：① 只设其一时另一语种
 *   仍有兜底字形；② 所选字体万一未安装，自动回落到终端味等宽，绝不开天窗；
 * - 二者皆空返回 null：调用方据此不写 --app-font，CSS var 回退即维持现状观感。
 *
 * @author aceFelix
 */

/** 主题默认等宽栈尾（与三张 theme-*.css 的 body 字体同源）：拼在自选字体之后兜底。 */
export const FALLBACK_TAIL = "Consolas, 'Courier New', NSimSun, SimSun, monospace"

/** 去引号防注入：字体名来自系统枚举，剔除可能破坏 CSS 的引号/分字符。 */
function sanitizeFontName(name: string): string {
  return name.replace(/["';,\\]/g, '').trim()
}

/**
 * 拼 UI 字体栈。
 *
 * @param latin 英文/拉丁字体族名（空串 / null = 未选）
 * @param cjk   中文字体族名（空串 / null = 未选）
 * @returns 有序字体栈字符串；两者皆未选返回 null（调用方不写 CSS 变量，回落主题默认）
 */
export function buildFontStack(latin: string | null, cjk: string | null): string | null {
  const l = latin ? sanitizeFontName(latin) : ''
  const c = cjk ? sanitizeFontName(cjk) : ''
  if (!l && !c) return null
  const parts: string[] = []
  // 英文在前：拉丁字符优先命中英文字体；中文字体殿后承接汉字；等宽栈兜底其余
  if (l) parts.push(`"${l}"`)
  if (c) parts.push(`"${c}"`)
  return `${parts.join(', ')}, ${FALLBACK_TAIL}`
}

/**
 * 中文字体粗判关键词表（小写匹配）。
 *
 * 系统枚举不保证标注某字体是否含 CJK 字形，故按字体名常见命名做启发式判断：
 * 命中即归入「含中文」组、置顶显示并打标签，方便在长列表里快速挑中文字体。
 * 纯启发式，不作为渲染依据（渲染仍靠 CSS 逐字符字形回退，误判不影响正确性）。
 */
const CJK_HINTS = [
  'yahei', 'microsoft yahei', 'simhei', 'simsun', 'nsimsun', 'simkai', 'kaishu',
  'fangsong', 'songti', 'heitif', 'stxingka', 'stkaiti', 'sht',
  'noto sans cjk', 'noto serif cjk', 'source han', 'source han sans',
  'siyuan', '霞鹜', 'lxgw', 'wenquanyi', 'wqy', 'droid sans fallback',
  'pingfang', 'hiragino', 'yu gothic', 'meiryo', 'msgothic', 'malgun',
  'gothic', 'mincho', 'kai', 'hei', 'song', 'ming', 'jheng', 'lihei',
  '思源', '宋体', '黑体', '楷体', '仿宋', '隶书', '幼圆', '圆体', '雅黑', '微软'
]

/** 该字体族名是否大概率含中文字形（启发式，用于分组/标签，不作渲染依据）。 */
export function isLikelyCjkFont(name: string): boolean {
  const n = name.toLowerCase()
  // 纯 ASCII 且明显西文的常见字体直接排除，避免 "Kaishu" 之类误伤前先降噪
  if (/^(arial|helvetica|tahoma|verdana|georgia|times|courier|consolas|cascadia|segoe|calibri|comic|impact|lucida|monaco|menlo|roboto|open sans|inter|mono|sans|serif)/.test(n)) {
    // 仍可能带 CJK 变体（如 Noto Sans CJK），关键词命中优先
    if (CJK_HINTS.some((h) => n.includes(h))) return true
    return false
  }
  return CJK_HINTS.some((h) => n.includes(h))
}

/**
 * 规范化 + 去重 + 分组排序枚举出的系统字体。
 *
 * @param raw      fontManager.enumerateFamilies 返回的字体族名数组
 * @param cjkFirst true=中文字体置顶（中文选择器）；false=按字母序（英文选择器）
 * @returns 去重后的字体族名数组
 */
export function normalizeFontList(raw: string[], cjkFirst: boolean): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const name of raw) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(trimmed)
  }
  const alpha = [...list].sort((a, b) => a.localeCompare(b))
  if (!cjkFirst) return alpha
  const cjk = alpha.filter(isLikelyCjkFont)
  const other = alpha.filter((n) => !isLikelyCjkFont(n))
  return [...cjk, ...other]
}
