/**
 * dsh-course-writer — Apple 风格右键菜单（Context Menu）。
 *
 * 行为对齐 macOS：毛玻璃面板、点击外部/Esc/滚动/窗口变化即关闭、
 * 贴边自动翻转（不超出视口）、危险项红色、支持快捷键提示与分隔线。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { injectAppleStyles } from './apple-ui.ts'

export interface MenuItem {
  /** 文案。 */
  label: string
  /** 选中回调；缺省表示纯展示（配合 disabled 使用）。 */
  onSelect?: () => void
  /** 危险操作（删除等），渲染为红色、hover 填红。 */
  danger?: boolean
  disabled?: boolean
  /** 右侧快捷键提示，如 '⌘D'。 */
  shortcut?: string
  /** 分隔线（渲染为一条细线，忽略其他字段）。 */
  separator?: boolean
}

export interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** 右键菜单面板。定位由内部测量后修正，保证完整可见。 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })

  useEffect(() => { injectAppleStyles() }, [])

  // 先按鼠标位置渲染一帧，测得尺寸后再贴边修正（避免菜单被视口裁掉）
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + r.width > vw - 8) left = Math.max(8, x - r.width)
    if (top + r.height > vh - 8) top = Math.max(8, y - r.height)
    setPos({ left, top })
  }, [x, y, items])

  // macOS 语义：点外部、按 Esc、滚动、窗口变化都关闭
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="cw-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator
          ? <div key={`sep-${i}`} className="cw-menu-sep" />
          : (
            <button
              key={`${item.label}-${i}`}
              type="button"
              className={`cw-menu-item${item.danger ? ' is-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return
                item.onSelect?.()
                onClose()
              }}
            >
              <span className="cw-menu-label">{item.label}</span>
              {item.shortcut ? <span className="cw-menu-shortcut">{item.shortcut}</span> : null}
            </button>
          ),
      )}
    </div>
  )
}
