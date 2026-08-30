/**
 * xiashuo — Markdown 编辑命令（纯函数层）。
 *
 * 设计要点：所有命令都是 `(DocState) => DocState` 的纯函数，只做
 * 「原文 + 选区 → 新文 + 新选区」的变换，不 import 任何 CodeMirror / DOM。
 * 好处有二：
 *   1. 可以直接在 node 环境跑单元测试（tests/md-commands.spec.ts），
 *      不必 simulated DOM —— 编辑器里那些「选区边界」的 bug 八成出在这里；
 *   2. 编辑器只负责把结果 dispatch 进 EditorView，职责干净。
 *
 * Markdown 不支持字体与颜色，这里沿用 Typora 的做法：用内联 HTML
 * `<span style="…">` 承载；预览渲染器会对这类标签做严格白名单放行（见 markdown-render.ts）。
 */

/** 文档 + 选区（from 可等于 to，表示光标）。 */
export interface DocState {
  text: string
  from: number
  to: number
}

/** 命令签名：所有对外命令都长这个样。 */
export type DocCommand = (s: DocState) => DocState

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.round(clamp(Number.isFinite(n) ? n : lo, lo, hi))
}

/** 光标所在行的行首偏移。 */
export function lineStartOf(text: string, pos: number): number {
  const i = text.lastIndexOf('\n', clamp(pos, 0, text.length) - 1)
  return i + 1
}

/** 光标所在行的行尾偏移（不含换行符）。 */
export function lineEndOf(text: string, pos: number): number {
  const p = clamp(pos, 0, text.length)
  const i = text.indexOf('\n', p)
  return i === -1 ? text.length : i
}

/** 光标下的词（中英文都按字母/数字/下划线算；用于「给这个词上色」）。 */
export function wordAt(text: string, pos: number): { from: number; to: number } | null {
  const p = clamp(pos, 0, text.length)
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)
  let from = p
  let to = p
  while (from > 0 && isWord(text[from - 1])) from -= 1
  while (to < text.length && isWord(text[to])) to += 1
  return from === to ? null : { from, to }
}

// ───────────────────────── 行内样式（粗体 / 斜体 / 删除线 / 行内代码）─────────────────────────

/**
 * 行内标记。斜体刻意用 `_` 而不是 `*`：
 * `*text*` 与 `**text**` 前缀互相包含，判断「是否已加斜体」时会误判成粗体；
 * `_` 与 `**` 无歧义，且 CommonMark 同样支持。
 */
export const INLINE_MARK = {
  bold: '**',
  italic: '_',
  strike: '~~',
  code: '`',
} as const

/**
 * 切换行内标记：已包裹 → 脱掉；未包裹 → 包上；空选区 → 插入一对标记并把光标放中间。
 */
export function toggleInlineWrap(s: DocState, mark: string): DocState {
  const { text } = s
  if (!mark) return s
  const from = clamp(s.from, 0, text.length)
  const to = clamp(s.to, from, text.length)
  const sel = text.slice(from, to)
  const before = text.slice(0, from)
  const after = text.slice(to)

  // 空选区：插入一对标记，光标停在中间，直接接着打字
  if (from === to) {
    const insert = mark + mark
    const mid = from + mark.length
    return { text: before + insert + after, from: mid, to: mid }
  }

  // 1) 选区外侧已经包裹 → 连同标记一起删掉
  if (before.endsWith(mark) && after.startsWith(mark)) {
    const nf = from - mark.length
    return { text: before.slice(0, before.length - mark.length) + sel + after.slice(mark.length), from: nf, to: nf + sel.length }
  }
  // 2) 选区自身带标记（用户把 **粗体** 整个选中）→ 去掉内层标记
  if (sel.length > mark.length * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(mark.length, sel.length - mark.length)
    return { text: before + inner + after, from, to: from + inner.length }
  }
  // 3) 普通包裹
  return {
    text: before + mark + sel + mark + after,
    from: from + mark.length,
    to: from + mark.length + sel.length,
  }
}

export const toggleBold: DocCommand = (s) => toggleInlineWrap(s, INLINE_MARK.bold)
export const toggleItalic: DocCommand = (s) => toggleInlineWrap(s, INLINE_MARK.italic)
export const toggleStrike: DocCommand = (s) => toggleInlineWrap(s, INLINE_MARK.strike)
export const toggleInlineCode: DocCommand = (s) => toggleInlineWrap(s, INLINE_MARK.code)

// ───────────────────────── 块级样式（标题 / 引用 / 列表 / 代码块）─────────────────────────

export type BlockStyle = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol' | 'task' | 'code'

const BLOCK_PREFIX: Record<Exclude<BlockStyle, 'ol' | 'code'>, string> = {
  p: '',
  h1: '# ',
  h2: '## ',
  h3: '### ',
  quote: '> ',
  ul: '- ',
  task: '- [ ] ',
}

/** 行首已有的块标记（缩进保留，标记剥掉）：# / > / - [ ] / - * + / 1. 1) */
const LEADING = /^([ \t]*)(?:(#{1,6})[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)?/

/**
 * 设置块级样式。若选区内所有非空行**已经**是该样式 → 反向清回正文（二段式开关）。
 * 有序列表会重新编号 1..n；缩进保留。
 */
export function setBlockStyle(s: DocState, style: BlockStyle): DocState {
  if (style === 'code') return toggleFence(s)
  const { text } = s
  const a = lineStartOf(text, clamp(s.from, 0, text.length))
  const b = lineEndOf(text, clamp(s.to, a, text.length))
  const prefix = style === 'ol' ? '' : BLOCK_PREFIX[style]

  const parsed = text.slice(a, b).split('\n').map((line) => {
    const m = LEADING.exec(line)
    const indent = (m ? m[1] : '') ?? ''
    return { line, indent, rest: line.slice(m ? m[0].length : 0), blank: line.trim() === '' }
  })

  const isOn = (p: { line: string; indent: string; rest: string; blank: boolean }): boolean => {
    if (p.blank) return true
    if (style === 'ol') return /^\d{1,9}[.)][ \t]/.test(p.rest) || /^\d{1,9}[.)][ \t]/.test(p.line.slice(p.indent.length))
    return prefix !== '' && p.line.slice(p.indent.length).startsWith(prefix)
  }
  // 正文（prefix 为空）永远走「剥掉标记」这条路，不参与开关判定
  const allOn = prefix !== '' && parsed.every(isOn) && parsed.some((p) => !p.blank)

  let n = 0
  const out = parsed
    .map((p) => {
      if (p.blank) return p.line
      if (allOn) return p.indent + p.rest
      n += 1
      return p.indent + (style === 'ol' ? `${n}. ` : prefix) + p.rest
    })
    .join('\n')

  return { text: text.slice(0, a) + out + text.slice(b), from: a, to: a + out.length }
}

/** 围栏代码块的开关（``` 包住选中的若干行）。 */
export function toggleFence(s: DocState): DocState {
  const { text } = s
  const a = lineStartOf(text, clamp(s.from, 0, text.length))
  const b = lineEndOf(text, clamp(s.to, a, text.length))
  const block = text.slice(a, b)
  const lines = block.split('\n')
  const isFence = (l: string | undefined): boolean => l !== undefined && /^[ \t]*```/.test(l)

  // 选区首行与末行都是围栏 → 视为「整块被围栏包住」，脱掉
  if (lines.length >= 2 && isFence(lines[0]) && isFence(lines[lines.length - 1])) {
    const inner = lines.slice(1, -1).join('\n')
    return { text: text.slice(0, a) + inner + text.slice(b), from: a, to: a + inner.length }
  }
  const body = block
  const out = '```\n' + body + '\n```'
  // 光标落在正文首位，方便直接敲代码
  return { text: text.slice(0, a) + out + text.slice(b), from: a + 4, to: a + 4 + body.length }
}

// ───────────────────────── 插入：链接 / 图片 / 表格 / 分割线 ─────────────────────────

/** 在光标处插入一个独占若干行的块，前后自动补空行。 */
function insertBlock(s: DocState, body: string): DocState {
  const { text } = s
  const a = lineStartOf(text, clamp(s.from, 0, text.length))
  const b = lineEndOf(text, clamp(s.to, a, text.length))
  const head = text.slice(0, a)
  const tail = text.slice(b)
  const pre = text.slice(a, clamp(s.from, 0, text.length))
  const post = text.slice(clamp(s.to, a, text.length), b)

  let out = head
  if (pre.trim()) out += pre + '\n\n'
  const start = out.length
  out += body
  // 本行剩余内容与后续文本接回去，中间统一空一行（不再额外补尾换行）
  const rest: string[] = []
  if (post.trim()) rest.push(post)
  const tailRest = tail.replace(/^\n+/, '')
  if (tailRest) rest.push(tailRest)
  if (rest.length) out += '\n\n' + rest.join('\n')
  return { text: out, from: start, to: start + body.length }
}

/** 插入链接 `[文字](url)`；url 为空则原样返回（避免误删选区）。 */
export function insertLink(s: DocState, url: string, label?: string): DocState {
  const { text } = s
  const href = url.trim()
  if (!href) return s
  const from = clamp(s.from, 0, text.length)
  const to = clamp(s.to, from, text.length)
  const sel = text.slice(from, to)
  const text0 = (label ?? sel) || href
  const insert = `[${text0}](${href})`
  const out = text.slice(0, from) + insert + text.slice(to)
  // 有选区 → 整块选中；没有 → 只选中「文字」部分，用户可直接改写
  return sel
    ? { text: out, from, to: from + insert.length }
    : { text: out, from: from + 1, to: from + 1 + text0.length }
}

/** 插入图片 `![说明](url)`；url 为空则原样返回。 */
export function insertImage(s: DocState, url: string, alt?: string): DocState {
  const { text } = s
  const src = url.trim()
  if (!src) return s
  const from = clamp(s.from, 0, text.length)
  const to = clamp(s.to, from, text.length)
  const alt0 = (alt ?? text.slice(from, to)) || ''
  const insert = `![${alt0}](${src})`
  return { text: text.slice(0, from) + insert + text.slice(to), from, to: from + insert.length }
}

/**
 * 插入表格。rows = 数据行数（不含表头），cols = 列数。
 * headerPrefix 用于生成表头占位文字（中文传「列」，英文传「Col」）。
 */
export function insertTable(s: DocState, rows: number, cols: number, headerPrefix = ''): DocState {
  const r = clampInt(rows, 1, 30)
  const c = clampInt(cols, 1, 12)
  const head = Array.from({ length: c }, (_, i) => `${headerPrefix}${i + 1}`)
  const sep = Array.from({ length: c }, () => '---')
  const body = Array.from({ length: r }, () => Array.from({ length: c }, () => ' '))
  const lines = [
    '| ' + head.join(' | ') + ' |',
    '| ' + sep.join(' | ') + ' |',
    ...body.map((row) => '|' + row.map((cell) => ` ${cell} `).join('|') + '|'),
  ]
  return insertBlock(s, lines.join('\n'))
}

/** 插入水平分割线。 */
export function insertHr(s: DocState): DocState {
  return insertBlock(s, '---')
}

// ───────────────────────── 内联 HTML 样式（颜色 / 字体 / 高亮）─────────────────────────

/**
 * CSS 声明的键值列表。注意：字体族里一律用单引号，
 * 双引号会破坏 `<span style="…">` 的 HTML 结构。
 */
function parseDecls(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const raw of css.split(';')) {
    const decl = raw.trim()
    if (!decl) continue
    const i = decl.indexOf(':')
    if (i <= 0) continue
    const prop = decl.slice(0, i).trim()
    const value = decl.slice(i + 1).trim()
    if (prop && value) out.push([prop, value])
  }
  return out
}

/** 合并两段 CSS，后者覆盖同名属性（先设颜色再设字体，两种应共存而非嵌套）。 */
export function mergeStyle(existing: string, next: string): string {
  const map = new Map<string, string>()
  for (const [k, v] of parseDecls(existing)) map.set(k, v)
  for (const [k, v] of parseDecls(next)) map.set(k, v)
  return [...map].map(([k, v]) => `${k}: ${v}`).join('; ')
}

/** 从已有 CSS 中剔除指定属性；剔空了返回 ''（调用方据此把 span 整个删掉）。 */
export function removeStyle(existing: string, css: string): string {
  const drop = new Set(parseDecls(css).map(([k]) => k))
  const kept = parseDecls(existing).filter(([k]) => !drop.has(k))
  return kept.map(([k, v]) => `${k}: ${v}`).join('; ')
}

const SPAN_OPEN = /<span style="([^"]*)">$/
const SPAN_CLOSE = '</span>'

/**
 * 给选区套内联样式（`<span style="…">`）。
 * 空选区 → 自动扩展到光标下的词，方便「点一下就给这个词上色」。
 * 已有 span 且属性重叠 → 合并进同一个 span，不层层嵌套。
 */
export function applyInlineStyle(s: DocState, css: string): DocState {
  const { text } = s
  if (!parseDecls(css).length) return s
  let from = clamp(s.from, 0, text.length)
  let to = clamp(s.to, from, text.length)
  if (from === to) {
    const w = wordAt(text, from)
    if (w) { from = w.from; to = w.to }
  }
  const sel = text.slice(from, to)

  // 仍然空（光标在空白/标点上）→ 插一对标签，光标放中间
  if (from === to) {
    const open = `<span style="${css}">`
    const mid = from + open.length
    return { text: text.slice(0, from) + open + SPAN_CLOSE + text.slice(from), from: mid, to: mid }
  }

  const bm = SPAN_OPEN.exec(text.slice(0, from))
  if (bm && text.slice(to, to + SPAN_CLOSE.length) === SPAN_CLOSE) {
    const nf = from - bm[0].length
    const existing = bm[1] ?? ''
    const merged = mergeStyle(existing, css)
    // 请求的属性已全部存在 → 视为「再点一次取消」，把目标属性剔掉
    if (merged === existing) {
      const left = removeStyle(existing, css)
      if (!left) {
        return { text: text.slice(0, nf) + sel + text.slice(to + SPAN_CLOSE.length), from: nf, to: nf + sel.length }
      }
      const open = `<span style="${left}">`
      return {
        text: text.slice(0, nf) + open + sel + SPAN_CLOSE + text.slice(to + SPAN_CLOSE.length),
        from: nf + open.length,
        to: nf + open.length + sel.length,
      }
    }
    const open = `<span style="${merged}">`
    return {
      text: text.slice(0, nf) + open + sel + SPAN_CLOSE + text.slice(to + SPAN_CLOSE.length),
      from: nf + open.length,
      to: nf + open.length + sel.length,
    }
  }

  const open = `<span style="${css}">`
  return {
    text: text.slice(0, from) + open + sel + SPAN_CLOSE + text.slice(to),
    from: from + open.length,
    to: from + open.length + sel.length,
  }
}

/**
 * 清除选区的指定内联属性（`clearInlineStyle(s, 'color')` 去掉颜色，字体保留）。
 * 属性被剔空 → 整个 span 删掉。
 */
export function clearInlineStyle(s: DocState, props: string | string[]): DocState {
  const { text } = s
  const list = Array.isArray(props) ? props : [props]
  if (!list.length) return s
  const css = list.map((p) => `${p}: x`).join('; ')
  let from = clamp(s.from, 0, text.length)
  let to = clamp(s.to, from, text.length)
  if (from === to) {
    const w = wordAt(text, from)
    if (w) { from = w.from; to = w.to }
  }
  if (from === to) return s

  const bm = SPAN_OPEN.exec(text.slice(0, from))
  if (!bm || text.slice(to, to + SPAN_CLOSE.length) !== SPAN_CLOSE) return s
  const nf = from - bm[0].length
  const sel = text.slice(from, to)
  const left = removeStyle(bm[1] ?? '', css)
  // 还有别的属性 → 保留 span，只删目标属性
  if (left) {
    const open = `<span style="${left}">`
    return {
      text: text.slice(0, nf) + open + sel + SPAN_CLOSE + text.slice(to + SPAN_CLOSE.length),
      from: nf + open.length,
      to: nf + open.length + sel.length,
    }
  }
  return { text: text.slice(0, nf) + sel + text.slice(to + SPAN_CLOSE.length), from: nf, to: nf + sel.length }
}
