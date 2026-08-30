/**
 * xiashuo — Markdown 编辑器工具栏（Apple 观感）。
 *
 * 分五组，覆盖讲义编写最常用的手动排版动作：
 *   历史：撤销 / 重做
 *   块级：段落样式（正文 / 标题 / 引用 / 列表 / 任务 / 代码块）
 *   行内：加粗 / 斜体 / 删除线 / 行内代码
 *   外观：字体颜色 / 高亮 / 字体
 *   插入：链接 / 图片 / 表格 / 分割线 · 视图：查找 / 行号
 *
 * 组件本身不含任何文本变换逻辑：所有编辑动作都交给 md-commands 的纯函数，
 * 再通过 api.run(cmd) 打进 CodeMirror —— 逻辑可测、UI 可换。
 */
import React, { useEffect, useRef, useState } from 'react'
import { currentLang, t } from './i18n.ts'
import { darkTokens, lightTokens } from './apple-ui.ts'
import type { MarkdownEditorApi } from './markdown-editor.tsx'
import {
  INLINE_MARK, applyInlineStyle, clearInlineStyle, insertHr, insertImage, insertLink,
  insertTable, setBlockStyle, toggleInlineWrap, type BlockStyle,
} from './md-commands.ts'

/** 工具栏装饰色：记录最近一次选中的文字色 / 高亮色，显示在「A」图标下方。 */
const DEFAULT_INK = '#FF3B30'
const DEFAULT_MARK = '#FFE9A8'

type PopKey = 'style' | 'color' | 'mark' | 'font' | 'link' | 'image' | 'table' | null

/** 字体族一律用单引号：双引号会截断 `<span style="…">` 这个 HTML 属性。 */
const FONTS: Array<{ id: string; zh: string; en: string; css: string | null }> = [
  { id: 'default', zh: '默认', en: 'Default', css: null },
  { id: 'serif', zh: '衬线体', en: 'Serif', css: "font-family: Georgia, 'Times New Roman', 'Songti SC', serif" },
  { id: 'sans', zh: '无衬线体', en: 'Sans', css: "font-family: 'Helvetica Neue', Arial, 'PingFang SC', sans-serif" },
  { id: 'mono', zh: '等宽体', en: 'Mono', css: 'font-family: ui-monospace, Menlo, Consolas, monospace' },
  { id: 'kai', zh: '楷体', en: 'Kai', css: "font-family: 'Kaiti SC', STKaiti, KaiTi, serif" },
  { id: 'hei', zh: '黑体', en: 'Hei', css: "font-family: 'Heiti SC', SimHei, 'Microsoft YaHei', sans-serif" },
]

/** 文字色板：Apple System Colors（浅深色通用），外加「自动」用于清除。 */
const INK_SWATCH: Array<{ hex: string; zh: string; en: string }> = [
  { hex: '', zh: '自动', en: 'Auto' },
  { hex: '#000000', zh: '黑色', en: 'Black' },
  { hex: '#8E8E93', zh: '灰色', en: 'Gray' },
  { hex: '#A2845E', zh: '棕色', en: 'Brown' },
  { hex: '#FF3B30', zh: '红色', en: 'Red' },
  { hex: '#FF9500', zh: '橙色', en: 'Orange' },
  { hex: '#FFCC00', zh: '黄色', en: 'Yellow' },
  { hex: '#34C759', zh: '绿色', en: 'Green' },
  { hex: '#00C7BE', zh: '青绿', en: 'Mint' },
  { hex: '#30B0C7', zh: '青蓝', en: 'Teal' },
  { hex: '#007AFF', zh: '蓝色', en: 'Blue' },
  { hex: '#5856D6', zh: '靛蓝', en: 'Indigo' },
  { hex: '#AF52DE', zh: '紫色', en: 'Purple' },
  { hex: '#FF2D55', zh: '粉色', en: 'Pink' },
]

/** 高亮色板：低饱和度，避免盖住正文。 */
const MARK_SWATCH: Array<{ hex: string; zh: string; en: string }> = [
  { hex: '', zh: '无', en: 'None' },
  { hex: '#FFE9A8', zh: '黄', en: 'Yellow' },
  { hex: '#C8F0C0', zh: '绿', en: 'Green' },
  { hex: '#BFE3FF', zh: '蓝', en: 'Blue' },
  { hex: '#FFCFE0', zh: '粉', en: 'Pink' },
  { hex: '#E2D4FF', zh: '紫', en: 'Purple' },
  { hex: '#FFD9B0', zh: '橙', en: 'Orange' },
  { hex: '#DEDEDE', zh: '灰', en: 'Gray' },
]

const STYLES: Array<{ id: BlockStyle; zh: string; en: string }> = [
  { id: 'p', zh: '正文', en: 'Body' },
  { id: 'h1', zh: '标题 1', en: 'Heading 1' },
  { id: 'h2', zh: '标题 2', en: 'Heading 2' },
  { id: 'h3', zh: '标题 3', en: 'Heading 3' },
  { id: 'quote', zh: '引用', en: 'Quote' },
  { id: 'ul', zh: '无序列表', en: 'Bulleted' },
  { id: 'ol', zh: '有序列表', en: 'Numbered' },
  { id: 'task', zh: '任务列表', en: 'Checklist' },
  { id: 'code', zh: '代码块', en: 'Code block' },
]

function bi(v: { zh: string; en: string }): string {
  return currentLang() === 'en' ? v.en : v.zh
}

// ───────────────────────── 图标 ─────────────────────────

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function Ico({ d, size = 13 }: { d: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" {...S}>
      <path d={d} />
    </svg>
  )
}

const I = {
  undo: 'M3.4 5.2 H8.6 A3.4 3.4 0 0 1 8.6 12 H5.8 M5.6 2.4 L3.4 5.2 L5.6 8',
  redo: 'M10.6 5.2 H5.4 A3.4 3.4 0 0 0 5.4 12 H8.2 M8.4 2.4 L10.6 5.2 L8.4 8',
  find: 'M6.2 1.8 a4.4 4.4 0 1 1 0 8.8 a4.4 4.4 0 0 1 0 -8.8 M9.6 9.6 L12.4 12.4',
  lines: 'M4.4 3 H12.6 M4.4 7 H12.6 M4.4 11 H12.6 M1.7 3 H1.8 M1.7 7 H1.8 M1.7 11 H1.8',
  link: 'M5.8 8.2 a2.6 2.6 0 0 0 3.7 0 l2 -2 a2.6 2.6 0 0 0 -3.7 -3.7 l-1 1 M8.2 5.8 a2.6 2.6 0 0 0 -3.7 0 l-2 2 a2.6 2.6 0 0 0 3.7 3.7 l1 -1',
  image: 'M1.8 2.6 h10.4 v8.8 h-10.4 z M1.8 9.4 l3 -3 l2.6 2.6 l2.2 -2.2 l2.6 2.6 M9.4 5.3 h0.01',
  table: 'M1.8 2.8 h10.4 v8.4 h-10.4 z M1.8 5.6 h10.4 M1.8 8.4 h10.4 M5.9 2.8 v8.4 M9.4 2.8 v8.4',
  hr: 'M1.8 7 h10.4 M3.4 3.4 h7.2 M3.4 10.6 h7.2',
  chevron: 'M4.2 5.8 L7 8.6 L9.8 5.8',
  font: 'M2.4 11 L5 2.8 H9 L11.6 11 M3.6 8 H10.4',
}

// ───────────────────────── 基础控件 ─────────────────────────

function Btn({
  title, onClick, children, active, disabled, wide,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  wide?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      className={active ? 'cw-tb-btn is-on' : 'cw-tb-btn'}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={wide ? { padding: '0 6px', gap: 2 } : undefined}
    >
      {children}
    </button>
  )
}

function Pop({ open, align = 'left', children }: { open: boolean; align?: 'left' | 'right'; children: React.ReactNode }): React.ReactElement | null {
  if (!open) return null
  return (
    <div className="cw-pop" style={align === 'right' ? { right: 0 } : { left: 0 }}>
      {children}
    </div>
  )
}

function PopItem({ onClick, children, active }: { onClick: () => void; children: React.ReactNode; active?: boolean }): React.ReactElement {
  return (
    <button type="button" className={active ? 'cw-pop-item is-on' : 'cw-pop-item'} onClick={onClick}>
      {children}
    </button>
  )
}

// ───────────────────────── 工具栏 ─────────────────────────

export interface MdToolbarProps {
  /** 编辑器命令入口；编辑器未就绪或已卸载时为 null，此时按钮全部禁用。 */
  api: MarkdownEditorApi | null
  scheme: 'light' | 'dark'
  showLineNumbers: boolean
  onToggleLineNumbers: () => void
}

export function MdToolbar({ api, scheme, showLineNumbers, onToggleLineNumbers }: MdToolbarProps): React.ReactElement {
  const c = scheme === 'dark' ? darkTokens : lightTokens
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState<PopKey>(null)
  const [url, setUrl] = useState('https://')
  const [label, setLabel] = useState('')
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [lastInk, setLastInk] = useState(DEFAULT_INK)
  const [lastMark, setLastMark] = useState(DEFAULT_MARK)

  // 点击外部 / Esc 关闭浮层
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const el = rootRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (k: Exclude<PopKey, null>) => (): void => setOpen((v) => (v === k ? null : k))
  const close = (): void => setOpen(null)

  const disabled = !api
  const run = (cmd: Parameters<NonNullable<MarkdownEditorApi['run']>>[0]): void => {
    api?.run(cmd)
    close()
  }

  const submitLink = (): void => {
    if (!url.trim()) return
    run((s) => insertLink(s, url, label))
    setUrl('https://')
    setLabel('')
  }

  const submitImage = (): void => {
    if (!url.trim()) return
    run((s) => insertImage(s, url, label))
    setUrl('https://')
    setLabel('')
  }

  return (
    <div className="cw-md-toolbar" ref={rootRef}>
      {/* 历史 */}
      <div className="cw-tb-group">
        <Btn title={t('undo')} disabled={disabled} onClick={() => api?.undo()}>
          <Ico d={I.undo} />
        </Btn>
        <Btn title={t('redo')} disabled={disabled} onClick={() => api?.redo()}>
          <Ico d={I.redo} />
        </Btn>
      </div>

      <span className="cw-tb-sep" />

      {/* 段落样式 */}
      <div className="cw-tb-group">
        <Btn title={t('style')} disabled={disabled} wide active={open === 'style'} onClick={toggle('style')}>
          <span style={{ fontSize: 12, maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t('style')}
          </span>
          <Ico d={I.chevron} size={10} />
        </Btn>
        <Pop open={open === 'style'}>
          {STYLES.map((s) => (
            <PopItem
              key={s.id}
              active={false}
              onClick={() => run((st) => setBlockStyle(st, s.id))}
            >
              {s.id === 'h1' && <span style={{ fontWeight: 700, fontSize: 14 }}>{bi(s)}</span>}
              {s.id === 'h2' && <span style={{ fontWeight: 700, fontSize: 13 }}>{bi(s)}</span>}
              {s.id === 'h3' && <span style={{ fontWeight: 600, fontSize: 12.5 }}>{bi(s)}</span>}
              {s.id === 'quote' && <span style={{ borderLeft: `2px solid ${c.separator}`, paddingLeft: 6, color: c.secondaryLabel }}>{bi(s)}</span>}
              {s.id === 'ul' && <span>• {bi(s)}</span>}
              {s.id === 'ol' && <span>1. {bi(s)}</span>}
              {s.id === 'task' && <span>☑ {bi(s)}</span>}
              {s.id === 'code' && <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5 }}>{'{} '}{bi(s)}</span>}
              {s.id === 'p' && <span>{bi(s)}</span>}
            </PopItem>
          ))}
        </Pop>
      </div>

      <span className="cw-tb-sep" />

      {/* 行内 */}
      <div className="cw-tb-group">
        <Btn title={t('bold')} disabled={disabled} onClick={() => run((s) => toggleInlineWrap(s, INLINE_MARK.bold))}>
          <b style={{ fontSize: 13 }}>B</b>
        </Btn>
        <Btn title={t('italic')} disabled={disabled} onClick={() => run((s) => toggleInlineWrap(s, INLINE_MARK.italic))}>
          <i style={{ fontFamily: 'Georgia, serif', fontSize: 13 }}>I</i>
        </Btn>
        <Btn title={t('strike')} disabled={disabled} onClick={() => run((s) => toggleInlineWrap(s, INLINE_MARK.strike))}>
          <s style={{ fontSize: 12.5 }}>S</s>
        </Btn>
        <Btn title={t('inlineCode')} disabled={disabled} onClick={() => run((s) => toggleInlineWrap(s, INLINE_MARK.code))}>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5 }}>{'</>'}</span>
        </Btn>
      </div>

      <span className="cw-tb-sep" />

      {/* 外观：颜色 / 高亮 / 字体 */}
      <div className="cw-tb-group">
        <Btn title={t('fontColor')} disabled={disabled} active={open === 'color'} onClick={toggle('color')}>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>A</span>
            <span style={{ width: 11, height: 2.5, borderRadius: 2, background: lastInk, marginTop: 0.5 }} />
          </span>
        </Btn>
        <Pop open={open === 'color'}>
          <div className="cw-swatches">
            {INK_SWATCH.map((s) => (
              <button
                key={s.hex || 'auto'}
                type="button"
                className="cw-swatch"
                title={bi(s)}
                style={s.hex ? { background: s.hex } : { background: 'transparent', borderColor: c.separator }}
                onClick={() => {
                  if (!s.hex) { setLastInk(DEFAULT_INK); run((st) => clearInlineStyle(st, 'color')) }
                  else { setLastInk(s.hex); run((st) => applyInlineStyle(st, `color: ${s.hex}`)) }
                }}
              >
                {!s.hex && <span style={{ fontSize: 9, color: c.secondaryLabel }}>∅</span>}
              </button>
            ))}
          </div>
        </Pop>
      </div>

      <div className="cw-tb-group">
        <Btn title={t('highlight')} disabled={disabled} active={open === 'mark'} onClick={toggle('mark')}>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>A</span>
            <span style={{ width: 11, height: 6, marginTop: -5.5, background: lastMark, borderRadius: 1, opacity: 0.9 }} />
          </span>
        </Btn>
        <Pop open={open === 'mark'}>
          <div className="cw-swatches">
            {MARK_SWATCH.map((s) => (
              <button
                key={s.hex || 'none'}
                type="button"
                className="cw-swatch"
                title={bi(s)}
                style={s.hex ? { background: s.hex } : { background: 'transparent', borderColor: c.separator }}
                onClick={() => {
                  if (!s.hex) { setLastMark(DEFAULT_MARK); run((st) => clearInlineStyle(st, 'background-color')) }
                  else { setLastMark(s.hex); run((st) => applyInlineStyle(st, `background-color: ${s.hex}`)) }
                }}
              >
                {!s.hex && <span style={{ fontSize: 9, color: c.secondaryLabel }}>∅</span>}
              </button>
            ))}
          </div>
        </Pop>
      </div>

      <div className="cw-tb-group">
        <Btn title={t('font')} disabled={disabled} active={open === 'font'} onClick={toggle('font')}>
          <Ico d={I.font} />
        </Btn>
        <Pop open={open === 'font'}>
          {FONTS.map((f) => (
            <PopItem
              key={f.id}
              onClick={() => {
                if (!f.css) run((st) => clearInlineStyle(st, 'font-family'))
                else run((st) => applyInlineStyle(st, f.css as string))
              }}
            >
              <span style={f.css ? { fontFamily: f.css.replace('font-family: ', '') } : undefined}>{bi(f)}</span>
            </PopItem>
          ))}
        </Pop>
      </div>

      <span className="cw-tb-sep" />

      {/* 插入 */}
      <div className="cw-tb-group">
        <Btn title={t('link')} disabled={disabled} active={open === 'link'} onClick={toggle('link')}>
          <Ico d={I.link} />
        </Btn>
        <Pop open={open === 'link'}>
          <div className="cw-pop-form">
            <input className="cw-input" value={url} placeholder={t('linkUrl')} autoFocus onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitLink() }} />
            <input className="cw-input" value={label} placeholder={t('linkText')} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitLink() }} />
            <button className="cw-btn cw-btn-sm cw-btn-primary" onClick={submitLink}>{t('insert')}</button>
          </div>
        </Pop>
      </div>

      <div className="cw-tb-group">
        <Btn title={t('image')} disabled={disabled} active={open === 'image'} onClick={toggle('image')}>
          <Ico d={I.image} />
        </Btn>
        <Pop open={open === 'image'}>
          <div className="cw-pop-form">
            <input className="cw-input" value={url} placeholder={t('imageUrl')} autoFocus onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitImage() }} />
            <input className="cw-input" value={label} placeholder={t('imageAlt')} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitImage() }} />
            <button className="cw-btn cw-btn-sm cw-btn-primary" onClick={submitImage}>{t('insert')}</button>
          </div>
        </Pop>
      </div>

      <div className="cw-tb-group">
        <Btn title={t('table')} disabled={disabled} active={open === 'table'} onClick={toggle('table')}>
          <Ico d={I.table} />
        </Btn>
        <Pop open={open === 'table'}>
          <div className="cw-pop-pad">
            <div
              className="cw-tbl-grid"
              onMouseLeave={() => { setRows(3); setCols(3) }}
            >
              {Array.from({ length: 6 }, (_, r) =>
                Array.from({ length: 8 }, (_, col) => (
                  <button
                    key={`${r}-${col}`}
                    type="button"
                    className={r < rows && col < cols ? 'cw-tbl-cell is-on' : 'cw-tbl-cell'}
                    onMouseEnter={() => { setRows(r + 1); setCols(col + 1) }}
                    onClick={() => run((st) => insertTable(st, rows, cols, t('colPrefix')))}
                  />
                )),
              )}
            </div>
            <div style={{ fontSize: 11, color: c.secondaryLabel, textAlign: 'center', marginTop: 4 }}>
              {rows} × {cols}
            </div>
          </div>
        </Pop>
      </div>

      <div className="cw-tb-group">
        <Btn title={t('divider')} disabled={disabled} onClick={() => run(insertHr)}>
          <Ico d={I.hr} />
        </Btn>
      </div>

      <span className="cw-tb-sep" />

      {/* 视图 */}
      <div className="cw-tb-group">
        <Btn title={t('find')} disabled={disabled} onClick={() => api?.openSearch()}>
          <Ico d={I.find} />
        </Btn>
        <Btn title={t('lineNumbers')} disabled={disabled} active={showLineNumbers} onClick={onToggleLineNumbers}>
          <Ico d={I.lines} />
        </Btn>
      </div>
    </div>
  )
}
