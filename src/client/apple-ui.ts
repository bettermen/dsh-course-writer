/**
 * xiashuo — Apple HIG 设计系统。
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

/* 图标按钮（顶栏窗口控制 / 操作）：方形、图标居中。 */
.cw-btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--cw-r-sm);
}
.cw-btn-icon svg { flex-shrink: 0; }

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

/* ---------- Markdown 编辑器外壳（CodeMirror 6）---------- */
/* CodeMirror 自带 .cm-editor flex 布局，需让它在 .cw-card 里撑满剩余高度 */
.cw-md-shell { padding: 0; overflow: hidden; }
.cw-md-shell .cm-editor { flex: 1; min-height: 0; }
.cw-md-shell .cm-editor.cm-focused { outline: none; }
/* 复用 .cw-scroll 的细滚动条观感（CodeMirror 的滚动容器是 .cm-scroller） */
.cw-md-shell .cm-scroller { scrollbar-width: thin; scrollbar-color: var(--cw-quaternaryLabel) transparent; }
.cw-md-shell .cm-scroller::-webkit-scrollbar { width: 8px; height: 8px; }
.cw-md-shell .cm-scroller::-webkit-scrollbar-track { background: transparent; }
.cw-md-shell .cm-scroller::-webkit-scrollbar-thumb {
  background: var(--cw-quaternaryLabel);
  border-radius: var(--cw-r-pill);
  border: 2px solid transparent;
  background-clip: content-box;
}
.cw-md-shell .cm-scroller::-webkit-scrollbar-thumb:hover { background: var(--cw-tertiaryLabel); background-clip: content-box; }
/* 切换型按钮的激活态（如「显示行号」） */
.cw-btn.is-on { background: color-mix(in srgb, var(--cw-blue) 14%, transparent); border-color: var(--cw-blue); color: var(--cw-blue); }

/* ---------- Markdown 编辑器工具栏 ---------- */
/* 单行、可横向滚动；按组分簇，组间用细分隔线，观感参照 macOS 文本编辑的格式化条 */
.cw-md-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding: 3px 6px;
  margin-bottom: 6px;
  overflow-x: auto;
  overflow-y: visible;
  background: var(--cw-bg);
  border: 0.5px solid var(--cw-separator);
  border-radius: var(--cw-r-lg);
  box-shadow: var(--cw-shadowSm);
  scrollbar-width: none;
}
.cw-md-toolbar::-webkit-scrollbar { height: 0; }
.cw-tb-group { position: relative; display: flex; align-items: center; gap: 1px; flex-shrink: 0; }
.cw-tb-sep { flex: 0 0 1px; width: 1px; height: 16px; margin: 0 4px; background: var(--cw-separator); }
.cw-tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 24px;
  height: 24px;
  padding: 0 5px;
  border: none;
  border-radius: var(--cw-r-sm);
  background: transparent;
  color: var(--cw-label);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s var(--cw-ease), color 0.12s var(--cw-ease);
}
.cw-tb-btn:hover:not(:disabled) { background: var(--cw-fill); }
.cw-tb-btn:active:not(:disabled) { background: var(--cw-secondaryFill); }
.cw-tb-btn:focus-visible { outline: 2px solid var(--cw-blue); outline-offset: -2px; }
.cw-tb-btn:disabled { opacity: 0.35; cursor: default; }
.cw-tb-btn.is-on { background: color-mix(in srgb, var(--cw-blue) 14%, transparent); color: var(--cw-blue); }

/* 浮层：菜单 / 色板 / 表单，风格与右键菜单保持一致（毛玻璃 + 大圆角 + 长阴影） */
.cw-pop {
  position: absolute;
  top: calc(100% + 5px);
  z-index: 60;
  min-width: 148px;
  padding: 4px;
  background: var(--cw-glassStrong);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  border: 0.5px solid var(--cw-separator);
  border-radius: var(--cw-r-md);
  box-shadow: var(--cw-shadowLg);
  animation: cw-pop-in 0.12s var(--cw-ease);
}
@keyframes cw-pop-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: translateY(0); }
}
.cw-pop-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 5px 9px;
  border: none;
  border-radius: var(--cw-r-sm);
  background: transparent;
  color: var(--cw-label);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.1s var(--cw-ease);
}
.cw-pop-item:hover { background: var(--cw-blue); color: #fff; }
.cw-pop-item.is-on { color: var(--cw-blue); }
.cw-pop-pad { padding: 6px; }
.cw-pop-form { display: flex; flex-direction: column; gap: 6px; width: 208px; padding: 6px; }
.cw-pop-form .cw-input { width: 100%; }

/* 色板：5 列网格，圆点带内描边（浅色下也能看清白色块） */
.cw-swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; padding: 4px; width: 168px; }
.cw-swatch {
  width: 26px;
  height: 22px;
  border: 0.5px solid rgba(0, 0, 0, 0.12);
  border-radius: var(--cw-r-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s var(--cw-ease), box-shadow 0.12s var(--cw-ease);
}
.cw-swatch:hover { transform: scale(1.12); box-shadow: var(--cw-shadowMd); }
.cw-swatch:focus-visible { outline: 2px solid var(--cw-blue); outline-offset: 1px; }

/* 表格尺寸选择器：6×8 网格，悬停即预览 */
.cw-tbl-grid { display: grid; grid-template-columns: repeat(8, 15px); gap: 2px; }
.cw-tbl-cell {
  width: 15px;
  height: 15px;
  padding: 0;
  border: 0.5px solid var(--cw-separator);
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  transition: background 0.08s var(--cw-ease), border-color 0.08s var(--cw-ease);
}
.cw-tbl-cell.is-on { background: color-mix(in srgb, var(--cw-blue) 22%, transparent); border-color: var(--cw-blue); }

/* ---------- 预览区富文本排版（工具栏插入的表格/图片等） ---------- */
.cw-preview-body { font-size: 13px; line-height: 1.7; color: var(--cw-label); }
.cw-preview-body > :first-child { margin-top: 0; }
.cw-preview-body h1, .cw-preview-body h2, .cw-preview-body h3,
.cw-preview-body h4, .cw-preview-body h5, .cw-preview-body h6 {
  margin: 1.1em 0 0.45em; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3;
}
.cw-preview-body h1 { font-size: 20px; }
.cw-preview-body h2 { font-size: 17px; }
.cw-preview-body h3 { font-size: 15px; }
.cw-preview-body h4 { font-size: 13.5px; }
.cw-preview-body h5, .cw-preview-body h6 { font-size: 12.5px; color: var(--cw-secondaryLabel); }
.cw-preview-body p { margin: 0 0 0.75em; }
.cw-preview-body ul, .cw-preview-body ol { margin: 0 0 0.75em; padding-left: 1.4em; }
.cw-preview-body li { margin: 0.15em 0; }
.cw-preview-body ul.cw-tasklist { list-style: none; padding-left: 0.1em; }
.cw-preview-body li.cw-task { display: flex; align-items: baseline; gap: 6px; }
.cw-preview-body li.cw-task input { margin: 0; }
.cw-preview-body blockquote {
  margin: 0 0 0.75em;
  padding: 2px 0 2px 11px;
  border-left: 3px solid var(--cw-separator);
  color: var(--cw-secondaryLabel);
}
.cw-preview-body code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--cw-fill);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.92em;
}
.cw-preview-body pre {
  margin: 0 0 0.75em;
  padding: 10px 12px;
  overflow: auto;
  border-radius: var(--cw-r-md);
  background: var(--cw-fill);
}
.cw-preview-body pre code { padding: 0; background: none; font-size: 12px; }
.cw-preview-body a { color: var(--cw-blue); text-decoration: none; }
.cw-preview-body a:hover { text-decoration: underline; }
.cw-preview-body img { max-width: 100%; border-radius: var(--cw-r-sm); }
.cw-preview-body hr { margin: 14px 0; border: none; border-top: 0.5px solid var(--cw-separator); }
.cw-preview-body mark { background: #FFE9A8; color: inherit; border-radius: 2px; padding: 0 1px; }
.cw-preview-body table {
  width: 100%;
  margin: 0 0 0.75em;
  border-collapse: collapse;
  font-size: 12.5px;
}
.cw-preview-body th, .cw-preview-body td {
  padding: 6px 9px;
  border: 0.5px solid var(--cw-separator);
  text-align: left;
}
.cw-preview-body th { background: var(--cw-fill); font-weight: 600; }

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
/* 落点指示（Apple 用 2pt 蓝色插入条，不用整行高亮） */
.cw-list-item.is-drop-target {
  box-shadow: inset 0 2px 0 -0.5px var(--cw-blue);
  background: color-mix(in srgb, var(--cw-blue) 8%, transparent);
}
/* 课时删除按钮：常态隐形，悬停/键盘聚焦时浮现（Apple 的反侵入式操作） */
.cw-chapter-del {
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--cw-tertiaryLabel);
  opacity: 0;
  flex-shrink: 0;
  transition: opacity 0.15s var(--cw-ease), color 0.15s var(--cw-ease);
}
.cw-list-item:hover .cw-chapter-del,
.cw-chapter-del:focus-visible { opacity: 1; }
.cw-chapter-del:hover { color: var(--cw-red); }

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

/* ---------- 首页：项目管理（P4） ---------- */
.cw-home {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--cw-secondaryBg);
  color: var(--cw-label);
  overflow: hidden;
}

/* 顶栏：毛玻璃 + 底部分隔线，滚动时内容从其下方穿过 */
.cw-home-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 22px;
  background: var(--cw-glass);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid var(--cw-separator);
  z-index: 2;
}
.cw-home-title { font-size: 19px; font-weight: 640; letter-spacing: -0.01em; }
.cw-home-sub { font-size: 12px; color: var(--cw-tertiaryLabel); }
.cw-home-bar-spacer { flex: 1; }

/* 工具条：搜索 + 类型筛选 + 状态筛选 + 排序 + 视图切换 */
.cw-home-tools {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 22px;
  border-bottom: 0.5px solid var(--cw-separator);
  background: var(--cw-bg);
  z-index: 1;
}
.cw-home-search { position: relative; width: 220px; }
.cw-home-search .cw-input { padding-left: 28px; height: 28px; font-size: 12px; }
.cw-home-search-icon {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--cw-tertiaryLabel);
  pointer-events: none;
}
.cw-home-chip {
  padding: 4px 11px;
  border: 0.5px solid var(--cw-separator);
  border-radius: var(--cw-r-pill);
  background: transparent;
  color: var(--cw-secondaryLabel);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s var(--cw-ease), color 0.15s var(--cw-ease),
              border-color 0.15s var(--cw-ease);
}
.cw-home-chip:hover { background: var(--cw-fill); color: var(--cw-label); }
.cw-home-chip.is-active {
  background: var(--cw-blue);
  border-color: var(--cw-blue);
  color: #fff;
  font-weight: 500;
}
.cw-home-select {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--cw-r-md);
  border: 0.5px solid var(--cw-separator);
  background: var(--cw-bg);
  color: var(--cw-label);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

/* 内容区 */
.cw-home-body { flex: 1; overflow-y: auto; padding: 18px 22px 40px; }
.cw-home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: 14px;
}
.cw-home-list { display: flex; flex-direction: column; gap: 6px; }

/* 项目卡片：hover 微抬升（Apple HIG 的「可点击」暗示） */
.cw-pcard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px 16px 14px;
  text-align: left;
  background: var(--cw-bg);
  border: 0.5px solid var(--cw-separator);
  border-radius: var(--cw-r-xl);
  box-shadow: var(--cw-shadowSm);
  cursor: pointer;
  font-family: inherit;
  color: inherit;
  transition: transform 0.18s var(--cw-spring), box-shadow 0.18s var(--cw-ease),
              border-color 0.18s var(--cw-ease);
}
.cw-pcard:hover { transform: translateY(-2px); box-shadow: var(--cw-shadowMd); border-color: var(--cw-quaternaryLabel); }
.cw-pcard:active { transform: translateY(0); }
.cw-pcard:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cw-blue) 30%, transparent);
}
.cw-pcard-head { display: flex; align-items: flex-start; gap: 10px; }
.cw-pcard-icon { font-size: 24px; line-height: 1; flex: 0 0 auto; }
.cw-pcard-titles { flex: 1; min-width: 0; }
.cw-pcard-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cw-pcard-desc {
  margin-top: 3px;
  font-size: 12px;
  color: var(--cw-tertiaryLabel);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cw-pcard-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cw-pcard-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--cw-tertiaryLabel);
}
.cw-pcard-more {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: var(--cw-r-sm);
  color: var(--cw-tertiaryLabel);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s var(--cw-ease), background 0.15s var(--cw-ease);
}
.cw-pcard:hover .cw-pcard-more, .cw-pcard-more:focus-visible { opacity: 1; }
.cw-pcard-more:hover { background: var(--cw-fill); color: var(--cw-label); }

/* 列表行 */
.cw-prow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: var(--cw-r-lg);
  border: 0.5px solid transparent;
  background: var(--cw-bg);
  cursor: pointer;
  font-family: inherit;
  color: inherit;
  text-align: left;
  transition: background 0.12s var(--cw-ease), border-color 0.12s var(--cw-ease);
}
.cw-prow:hover { background: var(--cw-fill); border-color: var(--cw-separator); }
.cw-prow-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-prow-meta { flex: 0 0 auto; font-size: 11px; color: var(--cw-tertiaryLabel); }

/* 徽章：类型 / 状态（五态配色） */
.cw-badge.is-kind { background: var(--cw-fill); color: var(--cw-secondaryLabel); }
.cw-badge.is-neutral { background: var(--cw-fill); color: var(--cw-secondaryLabel); }
.cw-badge.is-blue { background: color-mix(in srgb, var(--cw-blue) 14%, transparent); color: var(--cw-blue); }
.cw-badge.is-orange { background: color-mix(in srgb, var(--cw-orange) 16%, transparent); color: var(--cw-orange); }
.cw-badge.is-green { background: color-mix(in srgb, var(--cw-green) 16%, transparent); color: var(--cw-green); }

/* 进度条（iOS 进度条观感：细轨 + 圆角填充） */
.cw-prog {
  height: 4px;
  border-radius: var(--cw-r-pill);
  background: var(--cw-trackBg);
  overflow: hidden;
}
.cw-prog-fill {
  height: 100%;
  border-radius: var(--cw-r-pill);
  background: var(--cw-blue);
  transition: width 0.35s var(--cw-spring);
}
.cw-prog-fill.is-done { background: var(--cw-green); }
.cw-prog-row { display: flex; align-items: center; gap: 8px; }
.cw-prog-row .cw-prog { flex: 1; }
.cw-prog-text { flex: 0 0 auto; font-size: 11px; color: var(--cw-tertiaryLabel); font-variant-numeric: tabular-nums; }

/* 空态 */
.cw-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 64px 20px;
  text-align: center;
}
.cw-empty-icon { font-size: 44px; opacity: 0.5; }
.cw-empty-title { font-size: 15px; font-weight: 600; }
.cw-empty-desc { font-size: 12px; color: var(--cw-tertiaryLabel); max-width: 380px; line-height: 1.6; }

/* 类型选择卡（新建弹窗）：2 列网格，选中态用蓝色描边 + 淡蓝底 */
.cw-kind-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.cw-kind-card {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid var(--cw-separator);
  border-radius: var(--cw-r-lg);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  color: inherit;
  text-align: left;
  transition: border-color 0.15s var(--cw-ease), background 0.15s var(--cw-ease);
}
.cw-kind-card:hover { background: var(--cw-fill); }
.cw-kind-card.is-active {
  border-color: var(--cw-blue);
  background: color-mix(in srgb, var(--cw-blue) 8%, transparent);
}
.cw-kind-card-icon { font-size: 20px; line-height: 1; }
.cw-kind-card-name { font-size: 13px; font-weight: 500; }
.cw-kind-card-desc { font-size: 11px; color: var(--cw-tertiaryLabel); margin-top: 1px; }

/* 弹窗内的字段块 */
.cw-field { margin-bottom: 13px; }
.cw-field-label {
  display: block;
  font-size: 12px;
  color: var(--cw-secondaryLabel);
  margin-bottom: 5px;
}
.cw-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }

/* 危险确认块（删除项目）：淡红底 + 细红边 */
.cw-danger-note {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--cw-r-md);
  background: color-mix(in srgb, var(--cw-red) 8%, transparent);
  border: 0.5px solid color-mix(in srgb, var(--cw-red) 26%, transparent);
  font-size: 12px;
  color: var(--cw-label);
  line-height: 1.55;
}

/* 面包屑（工作台返回首页） */
.cw-crumb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 6px;
  border: none;
  border-radius: var(--cw-r-sm);
  background: transparent;
  color: var(--cw-blue);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s var(--cw-ease);
}
.cw-crumb:hover { background: var(--cw-fill); }

/* 提示条（操作成功/失败） */
.cw-toast {
  position: absolute;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: var(--cw-r-pill);
  background: var(--cw-glassStrong);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border: 0.5px solid var(--cw-separator);
  box-shadow: var(--cw-shadowMd);
  font-size: 12px;
  z-index: 300;
  animation: cw-toast-in 0.25s var(--cw-spring);
}
@keyframes cw-toast-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
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
