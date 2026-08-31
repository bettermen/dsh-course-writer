/**
 * xiashuo — 顶栏窗口控制 / 操作图标（16×16 线性图标，stroke 跟随 currentColor）。
 * 供工作台顶栏与首页窗口控制按钮复用，保持「图标 + title 提示」的一致体验。
 */
import React from 'react'

interface IconProps {
  size?: number
}

const stroke: React.SVGProps<SVGSVGElement> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/** 导出：向下箭头 + 底部托盘线。 */
export function IconExport({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M8 2v8" />
      <path d="M4.5 7.5 8 11l3.5-3.5" />
      <path d="M2.5 13.5h11" />
    </svg>
  )
}

/** 分享：盒子 + 向上箭头（iOS 分享语义）。 */
export function IconShare({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M8 11V4" />
      <path d="M5 7l3-3 3 3" />
      <path d="M3 9v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" />
    </svg>
  )
}

/** 缩小 50%：外框 + 右下实心小窗（从全屏缩到小窗）。 */
export function IconShrinkHalf({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 全屏：四角向外箭头。 */
export function IconFullscreen({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M6 2H2v4" />
      <path d="M10 2h4v4" />
      <path d="M6 14H2v-4" />
      <path d="M10 14h4v-4" />
    </svg>
  )
}

/** 关闭：叉号。 */
export function IconClose({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  )
}
