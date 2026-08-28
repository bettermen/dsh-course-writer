/**
 * dsh-course-writer — Apple HIG 设计系统。
 *
 * 设计令牌（浅色/深色双模式）+ 控件样式表 + 系统外观订阅。
 * 用注入样式表而非内联 style：内联无法表达 :hover / :active / :focus-visible /
 * backdrop-filter 与 keyframes，而这些都是 Apple 观感的核心。
 */
import React from 'react'

/** 浅色令牌（Apple System Colors · Light）。 */
export const lightTokens = {
  blue: '#007AFF',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  gray: '#8E8E93',
  label: '#1D1D1F',
  secondaryLabel: '#6E6E73',
  tertiaryLabel: '#86868B',
  quaternaryLabel: '#A1A1A6',
  bg: '#FFFFFF',
  secondaryBg: '#F5F5F7',
  tertiaryBg: '#FAFAFA',
  separator: 'rgba(60, 60, 67, 0.13)',
  fill: 'rgba(120, 120, 128, 0.08)',
  secondaryFill: 'rgba(120, 120, 128, 0.16)',
  glass: 'rgba(255, 255, 255, 0.72)',
  glassStrong: 'rgba(255, 255, 255, 0.86)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)',
  shadowMd: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
  shadowLg: '0 20px 60px rgba(0, 0, 0, 0.18), 0 8px 24px rgba(0, 0, 0, 0.10)',
  // 分段控件轨道
  trackBg: 'rgba(118, 118, 128, 0.12)',
} as const

/** 深色令牌（Apple System Colors · Dark）。 */
export const darkTokens = {
  blue: '#0A84FF',
  green: '#30D158',
  orange: '#FF9F0A',
  red: '#FF453A',
  gray: '#8E8E93',
  label: '#F5F5F7',
  secondaryLabel: '#98989F',
  tertiaryLabel: '#8E8E93',
  quaternaryLabel: '#636366',
  bg: '#1C1C1E',
  secondaryBg: '#000000',
  tertiaryBg: '#2C2C2E',
  separator: 'rgba(84, 84, 88, 0.65)',
  fill: 'rgba(120, 120, 128, 0.24)',
  secondaryFill: 'rgba(120, 120, 128, 0.32)',
  glass: 'rgba(30, 30, 32, 0.72)',
  glassStrong: 'rgba(30, 30, 32, 0.86)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.40), 0 1px 3px rgba(0, 0, 0, 0.30)',
  shadowMd: '0 4px 12px rgba(0, 0, 0, 0.40), 0 2px 4px rgba(0, 0, 0, 0.24)',
  shadowLg: '0 20px 60px rgba(0, 0, 0, 0.60), 0 8px 24px rgba(0, 0, 0, 0.40)',
  trackBg: 'rgba(118, 118, 128, 0.24)',
} as const

/** 形态令牌（两模式共用）。 */
export const shape = {
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
  radiusSm: '6px',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusXl: '14px',
  radiusPill: '999px',
  ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeSpring: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const

/** 生成两模式的 CSS 变量块。 */
function vars(t: Record<string, string>, selector: string): string {
  const rows = Object.entries(t).map(([k, v]) => `    --cw-${k}: ${v};`).join('\n')
  return `${selector} {\n${rows}\n  }`
}

const CSS = `
.cw-root {
${Object.keys(lightTokens).map((k) => `  --cw-${k}: ${(lightTokens as Record<string, string>)[k]};`).join('\n')}
  --cw-font: ${shape.font};
  --cw-r-sm: ${shape.radiusSm};
  --cw-r-md: ${shape.radiusMd};
  --cw-r-lg: ${shape.radiusLg};
  --cw-r-xl: ${shape.radiusXl};
  --cw-r-pill: ${shape.radiusPill};
  --cw-ease: ${shape.ease};
  --cw-spring: ${shape.easeSpring};
}
.cw-root[data-theme='dark'] {
${Object.keys(darkTokens).map((k) => `  --cw-${k}: ${(darkTokens as Record<string, string>)[k]};`).join('\n')}
}

.cw-root {
  font-family: var(--cw-font);
  color: var(--cw-label);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: 13px;
}

/* ---------- 按钮 ---------- */
.cw-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: var(--cw-r-sm);
  border: 0.5px solid var(--cw-separator);
  background: var(--cw-bg);
  color: var(--cw-label);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: var(--cw-shadowSm);
  transition: background 0.15s var(--cw-ease), border-color 0.15s var(--cw-ease),
              color 0.15s var(--cw-ease), transform 0.1s var(--cw-ease),
              box-shadow 0.15s var(--cw-ease), opacity 0.15s var(--cw-ease);
}
.cw-btn:hover:not(:disabled) { background: var(--cw-fill); }
.cw-btn:active:not(:disabled) { transform: scale(0.97); background: var(--cw-secondaryFill); }
.cw-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
.cw-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cw-blue) 30%, transparent);
}

.cw-btn-primary {
  background: var(--cw-blue);
  border-color: var(--cw-blue);
  color: #fff;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--cw-blue) 40%, transparent);
}
.cw-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--cw-blue) 88%, #000); border-color: color-mix(in srgb, var(--cw-blue) 88%, #000); }
.cw-btn-primary:active:not(:disabled) { background: color-mix(in srgb, var(--cw-blue) 76%, #000); }

.cw-btn-tertiary {
  background: transparent;
  border-color: transparent;
  color: var(--cw-blue);
  box-shadow: none;
}
.cw-btn-tertiary:hover:not(:disabled) { background: var(--cw-fill); }

.cw-btn-danger {
  background: transparent;
  border-color: transparent;
  color: var(--cw-red);
  box-shadow: none;
}
.cw-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--cw-red) 12%, transparent); }

.cw-btn-sm { padding: 4px 9px; font-size: 12px; }

/* ---------- 分段控件（iOS Segmented Control）---------- */
.cw-segmented {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--cw-trackBg);
  border-radius: 8px;
}
.cw-seg-item {
  border: none;
  background: transparent;
  color: var(--cw-label);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s var(--cw-spring), box-shadow 0.2s var(--cw-spring),
              color 0.15s var(--cw-ease);
}
.cw-seg-item:hover:not(.is-active) { color: var(--cw-label); }
.cw-seg-item.is-active {
  background: var(--cw-bg);
  color: var(--cw-label);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10), 0 0.5px 1px rgba(0, 0, 0, 0.06);
  font-weight: 590;
}
.cw-root[data-theme='dark'] .cw-seg-item.is-active { background: #636366; color: #fff; }

/* ---------- 输入框 ---------- */
.cw-input, .cw-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 11px;
  border-radius: var(--cw-r-md);
  border: 0.5px solid var(--cw-separator);
  background: var(--cw-bg);
  color: var(--cw-label);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  transition: border-color 0.15s var(--cw-ease), box-shadow 0.15s var(--cw-ease);
}
.cw-input::placeholder, .cw-textarea::placeholder { color: var(--cw-tertiaryLabel); }
.cw-input:focus, .cw-textarea:focus {
  outline: none;
  border-color: var(--cw-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cw-blue) 22%, transparent);
}
.cw-textarea { resize: vertical; }

/* ---------- 卡片 / 面板 ---------- */
.cw-card {
  background: var(--cw-bg);
  border: 0.5px solid var(--cw-separator);
  border-radius: var(--cw-r-lg);
  box-shadow: var(--cw-shadowSm);
  transition: border-color 0.15s var(--cw-ease), box-shadow 0.15s var(--cw-ease),
              background 0.15s var(--cw-ease);
}
.cw-card:hover { box-shadow: var(--cw-shadowMd); }

.cw-list-item {
  border-radius: var(--cw-r-md);
  transition: background 0.12s var(--cw-ease);
}
.cw-list-item:hover { background: var(--cw-fill); }
.cw-list-item.is-selected { background: color-mix(in srgb, var(--cw-blue) 14%, transparent); }

/* ---------- 毛玻璃容器 ---------- */
.cw-glass {
  background: var(--cw-glass);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
}
.cw-glass-strong {
  background: var(--cw-glassStrong);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
}

/* ---------- 弹窗 ---------- */
.cw-modal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: inherit;
  animation: cw-fade 0.18s var(--cw-ease);
}
.cw-modal {
  background: var(--cw-glassStrong);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  border: 0.5px solid var(--cw-separator);
  border-radius: var(--cw-r-xl);
  box-shadow: var(--cw-shadowLg);
  padding: 20px;
  animation: cw-pop 0.26s var(--cw-spring);
  max-height: 84%;
  overflow: auto;
  font-size: 13px;
}
@keyframes cw-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cw-pop {
  from { opacity: 0; transform: scale(0.96) translateY(6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .cw-modal, .cw-modal-backdrop { animation: none; }
  .cw-btn { transition: none; }
}

/* ---------- 开关（iOS Switch）---------- */
.cw-switch {
  position: relative;
  width: 44px;
  height: 26px;
  border-radius: var(--cw-r-pill);
  border: none;
  background: var(--cw-fill);
  cursor: pointer;
  padding: 0;
  transition: background 0.24s var(--cw-spring);
  flex-shrink: 0;
}
.cw-switch.is-on { background: var(--cw-green); }
.cw-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.24s var(--cw-spring);
}
.cw-switch.is-on::after { transform: translateX(18px); }

/* ---------- 拖拽手柄 ---------- */
.cw-resizer { flex-shrink: 0; cursor: col-resize; background: transparent; transition: background 0.15s var(--cw-ease); }
.cw-resizer:hover, .cw-resizer.is-dragging { background: var(--cw-blue); }

/* ---------- 细滚动条 ---------- */
.cw-scroll { overflow: auto; scrollbar-width: thin; scrollbar-color: var(--cw-quaternaryLabel) transparent; }
.cw-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.cw-scroll::-webkit-scrollbar-track { background: transparent; }
.cw-scroll::-webkit-scrollbar-thumb {
  background: var(--cw-quaternaryLabel);
  border-radius: var(--cw-r-pill);
  border: 2px solid transparent;
  background-clip: content-box;
}
.cw-scroll::-webkit-scrollbar-thumb:hover { background: var(--cw-tertiaryLabel); background-clip: content-box; }

/* ---------- 文本层级 ---------- */
.cw-title { font-size: 15px; font-weight: 590; letter-spacing: -0.01em; color: var(--cw-label); }
.cw-caption { font-size: 12px; color: var(--cw-secondaryLabel); }
.cw-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: var(--cw-r-pill);
  font-size: 11px;
  font-weight: 500;
  background: var(--cw-fill);
  color: var(--cw-secondaryLabel);
}
.cw-badge.is-on { background: color-mix(in srgb, var(--cw-green) 16%, transparent); color: var(--cw-green); }
.cw-badge.is-off { background: var(--cw-fill); color: var(--cw-tertiaryLabel); }

/* ---------- 侧边栏入口（DOM 注入）---------- */
.cw-sidebar-entry {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  width: 100% !important;
  padding: 7px 12px !important;
  border: none !important;
  background: transparent !important;
  cursor: pointer !important;
  font-family: var(--cw-font, -apple-system, BlinkMacSystemFont, system-ui, sans-serif) !important;
  font-size: 13px !important;
  color: inherit !important;
  border-radius: var(--cw-r-sm, 6px) !important;
  transition: background 0.15s var(--cw-ease, ease) !important;
  margin: 2px 0 !important;
}
.cw-sidebar-entry:hover { background: rgba(120, 120, 128, 0.12) !important; }

/* ---------- 半透明侧栏（Apple Translucent Sidebar）---------- */
.cw-sidebar-pane {
  background: var(--cw-glass);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
}

/* ---------- 右键菜单（Apple Context Menu）---------- */
.cw-menu {
  position: fixed;
  z-index: 999999;
  min-width: 176px;
  padding: 5px;
  border-radius: 8px;
  background: var(--cw-glassStrong);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  border: 0.5px solid var(--cw-separator);
  box-shadow: var(--cw-shadowLg);
  font-family: var(--cw-font);
  font-size: 13px;
  color: var(--cw-label);
  animation: cw-menu-in 0.12s var(--cw-ease);
  user-select: none;
}
@keyframes cw-menu-in {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}
.cw-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--cw-label);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.08s var(--cw-ease);
}
.cw-menu-item:hover:not(:disabled) { background: var(--cw-blue); color: #fff; }
.cw-menu-item:disabled { opacity: 0.38; cursor: default; }
.cw-menu-item.is-danger { color: var(--cw-red); }
.cw-menu-item.is-danger:hover:not(:disabled) { background: var(--cw-red); color: #fff; }
.cw-menu-label { flex: 1; white-space: nowrap; }
.cw-menu-shortcut { font-size: 11px; opacity: 0.5; font-variant-numeric: tabular-nums; }
.cw-menu-item:hover .cw-menu-shortcut { opacity: 0.75; }
.cw-menu-sep { height: 1px; margin: 4px 6px; background: var(--cw-separator); }

/* ---------- 拖拽手柄（列表重排视觉暗示）---------- */
.cw-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--cw-tertiaryLabel);
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s var(--cw-ease), color 0.15s var(--cw-ease);
  flex-shrink: 0;
}
.cw-list-item:hover .cw-drag-handle { opacity: 1; }
.cw-drag-handle:hover { color: var(--cw-secondaryLabel); }
.cw-drag-handle:active { cursor: grabbing; }
.cw-list-item.is-dragging { opacity: 0.45; }

/* ---------- 知识图谱 ---------- */
.cw-graph { width: 100%; height: 100%; display: block; }
.cw-graph-node {
  cursor: pointer;
  transition: r 0.18s var(--cw-spring), opacity 0.18s var(--cw-ease);
}
.cw-graph-node:hover { filter: brightness(1.08); }
.cw-graph-label {
  font-family: var(--cw-font);
  font-size: 11px;
  font-weight: 500;
  fill: var(--cw-secondaryLabel);
  pointer-events: none;
  transition: fill 0.18s var(--cw-ease);
}
.cw-graph-label.is-active { fill: var(--cw-label); font-weight: 590; }
.cw-graph-edge {
  stroke: var(--cw-separator);
  stroke-width: 1.2;
  transition: stroke 0.18s var(--cw-ease), stroke-width 0.18s var(--cw-ease);
}
.cw-graph-edge.is-active { stroke: var(--cw-blue); stroke-width: 1.8; }
`

/** 幂等注入样式表（首次调用插入，后续跳过）。 */
export function injectAppleStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('cw-apple-ui')) return
  const style = document.createElement('style')
  style.id = 'cw-apple-ui'
  style.textContent = CSS
  document.head.appendChild(style)
}

/** 读取系统外观偏好。 */
function readScheme(): 'light' | 'dark' {
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
  } catch { /* 环境无 matchMedia */ }
  return 'light'
}

/**
 * 订阅系统深浅色，返回当前方案。
 * 系统偏好变化时自动触发重渲染（Apple 的「自动」外观行为）。
 */
export function useAppleScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = React.useState<'light' | 'dark'>(readScheme)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setScheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return scheme
}
