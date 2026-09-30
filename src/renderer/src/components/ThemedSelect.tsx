/**
 * 主题化下拉选择（自绘，替代原生 <select>）。
 *
 * 动机（2026-09 实机反馈）：原生 select 的展开列表由系统绘制——Windows/Chromium 固定
 * 深灰底 + 系统蓝高亮、圆角与系统箭头，CSS 只能管到收起态，展开后与荧光绿/电光蓝/
 * 金属银三张皮肤都不搭；且系统浮层会盖住表单标签。改为自绘：主题化触发器 + 主题化浮层。
 *
 * 实现要点：
 * - 浮层经 createPortal 挂到 body：左栏 .glass-col 的 backdrop-filter 会创建
 *   containing block，fixed 若留在原 DOM 内会相对它错位；portal 后同时避开
 *   .list-area 的 overflow 裁剪。
 * - 视口坐标定位（getBoundingClientRect）：默认触发器下方展开，下方空间不足且上方更
 *   宽裕时向上翻；打开期间窗口 resize / 页面滚动即关闭，避免浮层悬空错位（浮层自身
 *   滚动不关，否则长选项列表没法滚）。
 * - 无障碍：触发器 role=combobox（aria-expanded / aria-haspopup），浮层 role=listbox，
 *   项 role=option + aria-selected；键盘 ↑↓ 移动高亮、Home/End 跳首尾、Enter/Space 选中、
 *   Esc 关闭，点击浮层与触发器之外关闭。
 *
 * 配色/圆角全部交给 .themed-select-* 类，由 main.css 打底、三张皮肤覆盖。
 *
 * @author aceFelix
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

/** 单个选项：value 为提交值（写入配置），label 为界面显示文案。 */
export interface SelectOption {
  value: string
  label: string
  /** 该项字体族预览（字体选择器用：选项文本以此字体渲染；缺省继承界面字体）。@author aceFelix */
  fontFamily?: string
  /** 选项右侧附注标签（如「含中文」），纯展示不参与匹配。@author aceFelix */
  hint?: string
}

/** 浮层视口坐标（portal 后 fixed 定位用）。 */
interface MenuRect {
  left: number
  top: number
  width: number
  maxHeight: number
}

/** 单项高度估值（行高 18 + 上下内边距 8）：仅用于展开方向判断与 maxHeight 估算。 */
const ITEM_H = 26

export default function ThemedSelect(props: {
  /** 当前值。 */
  value: string
  /** 选项列表。 */
  options: readonly SelectOption[]
  /** 选中回调（点击/Enter/Space 选中某项时触发，值未变时不触发）。 */
  onChange: (value: string) => void
  /** 触发器 data-testid（浮层与选项自动派生 `-menu` / `-option-<value>`）。 */
  testid?: string
  ariaLabel?: string
  /** 可搜索：浮层顶部加过滤输入，按 label/value 子串（忽略大小写）筛选。@author aceFelix */
  searchable?: boolean
  /** 过滤输入框占位文案。@author aceFelix */
  searchPlaceholder?: string
  /** 过滤后无匹配项时的提示文案。@author aceFelix */
  emptyText?: string
  /** 展开回调（在用户手势调用栈内触发，供懒加载如 queryLocalFonts）。@author aceFelix */
  onOpen?: () => void
}): JSX.Element {
  const { value, options } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<MenuRect | null>(null)
  // 过滤关键字（可搜索时由浮层顶部输入驱动；每次打开重置）
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const currentOption = options.find((o) => o.value === value)
  const currentLabel = currentOption?.label ?? value

  // 实际渲染的可见项：可搜索且有关键字时按 label/value 子串过滤（字体列表长时便于定位）
  const q = query.trim().toLowerCase()
  const visible =
    props.searchable && q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
        )
      : options

  /** 计算浮层位置与最大高度：优先下方，空间不足且上方更宽裕则向上翻。 */
  const place = (): void => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 4
    const need = visible.length * ITEM_H + 10
    const below = window.innerHeight - r.bottom - gap * 2
    const above = r.top - gap * 2
    const up = below < Math.min(need, 180) && above > below
    const maxHeight = Math.max(96, Math.min(need, up ? above : below))
    setRect({
      left: r.left,
      width: r.width,
      top: up ? r.top - gap - maxHeight : r.bottom + gap,
      maxHeight
    })
  }

  /** 展开：重置过滤、高亮定位到当前值，先算位置再打开（避免首帧错位）。 */
  const openMenu = (): void => {
    props.onOpen?.()
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    place()
    setOpen(true)
  }

  /** 选中：关闭浮层 + 回焦触发器；值未变则只关不回调。 */
  const choose = (next: string): void => {
    setOpen(false)
    if (next !== value) props.onChange(next)
    triggerRef.current?.focus()
  }

  // 打开期间：点击触发器/浮层之外、页面滚动、窗口尺寸变化 → 关闭（防悬空错位）
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    // 滚动用捕获阶段监听（内部滚动容器的 scroll 不冒泡）：浮层自身滚动是查看长列表，
    // 不关闭；其余滚动会让浮层悬空错位，直接收起
    const onScroll = (e: Event): void => {
      const target = e.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // 可搜索：关键字变化后重算浮层高度（可见项数变了）并把高亮夹回合法区间
  useEffect(() => {
    if (!open || !props.searchable) return
    setActive((i) => Math.min(Math.max(0, i), Math.max(0, visible.length - 1)))
    place()
    // 仅在 query 变化时重算；place/visible 为渲染闭包，取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, props.searchable])

  // 打开且可搜索时自动聚焦过滤输入，方便直接键盘敲字筛选
  useEffect(() => {
    if (open && props.searchable) inputRef.current?.focus()
  }, [open, props.searchable])

  // 高亮项变化时滚入视野（长列表键盘导航不至于看不见当前高亮）；jsdom 等无此方法环境安容。
  useEffect(() => {
    if (!open) return
    const el = menuRef.current?.querySelector(`[data-nav="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  /** 键盘导航：Enter/Space 开关或选中，↑↓ 移动高亮，Home/End 跳首尾，Esc 关闭。触发器与过滤输入共用。 */
  const handleNav = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
      return
    }
    if (e.key === 'Tab') {
      // 焦点即将离开下拉：收起浮层，避免留在屏上悬空
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(visible.length - 1, Math.max(0, i + dir)))
      return
    }
    if (open && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : Math.max(0, visible.length - 1))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // preventDefault：按钮默认激活行为会再合成一次 click，不拦会双触发
      e.preventDefault()
      if (open) choose(visible[active]?.value ?? value)
      else openMenu()
    }
  }

  return (
    <div className="themed-select">
      <button
        type="button"
        ref={triggerRef}
        className="themed-select-trigger"
        data-testid={props.testid}
        data-value={value}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleNav}
      >
        <span
          className="themed-select-label"
          style={currentOption?.fontFamily ? { fontFamily: currentOption.fontFamily } : undefined}
        >
          {currentLabel}
        </span>
        <span className={`themed-select-arrow${open ? ' open' : ''}`} />
      </button>

      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              className="themed-select-menu"
              data-testid={props.testid ? `${props.testid}-menu` : undefined}
              role="listbox"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                maxHeight: rect.maxHeight
              }}
            >
              {props.searchable ? (
                <input
                  ref={inputRef}
                  className="themed-select-search"
                  type="text"
                  value={query}
                  placeholder={props.searchPlaceholder}
                  data-testid={props.testid ? `${props.testid}-search` : undefined}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleNav}
                />
              ) : null}
              {visible.map((o, i) => (
                <div
                  key={o.value}
                  data-nav={i}
                  className={`themed-select-option${i === active ? ' active' : ''}${
                    o.value === value ? ' selected' : ''
                  }`}
                  data-testid={props.testid ? `${props.testid}-option-${o.value}` : undefined}
                  role="option"
                  aria-selected={o.value === value}
                  style={o.fontFamily ? { fontFamily: o.fontFamily } : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    // 仅拦焦点转移（保持触发器/输入框持焦，Esc 链路不丢）；选择交给 onClick
                    e.preventDefault()
                  }}
                  onClick={() => choose(o.value)}
                >
                  <span className="themed-select-option-label">{o.label}</span>
                  {o.hint ? <span className="themed-select-option-hint">{o.hint}</span> : null}
                </div>
              ))}
              {props.searchable && visible.length === 0 ? (
                <div className="themed-select-empty">{props.emptyText}</div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
