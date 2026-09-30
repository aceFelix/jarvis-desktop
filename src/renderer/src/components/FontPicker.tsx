/**
 * 字体选择器：设置面板「英文字体 / 中文字体」两行的可搜索下拉。
 *
 * 数据源：Chromium Local Font Access API（window.queryLocalFonts）枚举本机已装字体。
 * 该 API 需在用户手势调用栈内调用且要 local-fonts 权限（主进程已放行），故延后到
 * 首次点开下拉时经 ThemedSelect 的 onOpen 懒加载；API 不可用/被拒/枚举为空时回落到
 * 一份常见字体预设（FALLBACK_FONTS），下拉始终可选，绝不留空。
 *
 * 预览与分组：每个选项用其自身字体渲染字体名；cjkFirst=true（中文选择器）时中文字体
 * 置顶并打「含中文」标签（fontUtils.isLikelyCjkFont 启发式），拉丁选择器按字母序。
 * 选中值经 onChange 上抛（'' 归一为 null=未选），由 settingsStore 拼 --app-font 落地。
 *
 * @author aceFelix
 */

import { useMemo, useRef, useState } from 'react'
import ThemedSelect, { type SelectOption } from './ThemedSelect'
import { useT } from '../i18n'
import { isLikelyCjkFont, normalizeFontList } from '../lib/fontUtils'

/** queryLocalFonts 单项（仅需 family；其余字段按规范存在但此处不用）。 */
type LocalFontData = { family: string }
type QueryLocalFonts = () => Promise<LocalFontData[]>

/** API 不可用/被拒时的常见字体预设（Windows 一般自带；缺项由 CSS 字体栈兜底回落）。 */
const FALLBACK_FONTS = [
  'Segoe UI',
  'Microsoft YaHei',
  'SimSun',
  'NSimSun',
  'SimHei',
  'KaiTi',
  'FangSong',
  'LiSu',
  'YouYuan',
  'Microsoft JhengHei',
  'Consolas',
  'Cascadia Code',
  'Arial',
  'Tahoma',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Courier New'
]

/** 取渲染层可能存在的 queryLocalFonts（沙箱渲染进程里是标准 DOM API，非 Node 能力）。 */
function getQueryLocalFonts(): QueryLocalFonts | undefined {
  const w = window as unknown as { queryLocalFonts?: QueryLocalFonts }
  return typeof w.queryLocalFonts === 'function' ? w.queryLocalFonts : undefined
}

export default function FontPicker(props: {
  /** 当前字体族名（null/''=未选，回落主题默认）。 */
  value: string | null
  /** 选中回调（'' 归一为 null 上抛）。 */
  onChange: (font: string | null) => void
  /** true=中文字体置顶并打「含中文」标签（中文选择器）；false=字母序（拉丁选择器）。 */
  cjkFirst: boolean
  /** 触发器与选项的 data-testid 前缀。 */
  testid: string
  /** 无障碍名（行标签）。 */
  ariaLabel: string
}): JSX.Element {
  const t = useT()
  // null=尚未加载；[] 理论上不出现（空结果回落预设）；非空=枚举/预设结果
  const [families, setFamilies] = useState<string[] | null>(null)
  const loadingRef = useRef(false)

  /** 首次展开时懒加载枚举（在用户手势调用栈内触发，满足 queryLocalFonts 激活要求）。 */
  const load = (): void => {
    if (families || loadingRef.current) return
    const q = getQueryLocalFonts()
    if (!q) {
      setFamilies(FALLBACK_FONTS)
      return
    }
    loadingRef.current = true
    q()
      .then((list) => {
        const fs = Array.from(new Set(list.map((d) => d.family).filter(Boolean)))
        // 枚举成功但为空（极少数）也回落预设，保证可选
        setFamilies(fs.length ? fs : FALLBACK_FONTS)
      })
      .catch(() => setFamilies(FALLBACK_FONTS))
      .finally(() => {
        loadingRef.current = false
      })
  }

  // 选项：默认项置顶，其后为规范化/分组的字体族；中文字体在 cjkFirst 列表里加标签
  const options = useMemo<SelectOption[]>(() => {
    const list = families ? normalizeFontList(families, props.cjkFirst) : []
    const opts: SelectOption[] = [{ value: '', label: t('settings.font.default') }]
    for (const f of list) {
      opts.push({
        value: f,
        label: f,
        fontFamily: f,
        hint: props.cjkFirst && isLikelyCjkFont(f) ? t('settings.font.cjkTag') : undefined
      })
    }
    return opts
  }, [families, props.cjkFirst, t])

  return (
    <ThemedSelect
      testid={props.testid}
      ariaLabel={props.ariaLabel}
      value={props.value ?? ''}
      options={options}
      searchable
      searchPlaceholder={t('settings.font.search')}
      emptyText={t('settings.font.empty')}
      onOpen={load}
      onChange={(v) => props.onChange(v || null)}
    />
  )
}
