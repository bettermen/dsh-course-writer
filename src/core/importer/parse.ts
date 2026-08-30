/**
 * xiashuo — 本地课程文件导入解析器（P3 导入模块）。
 *
 * 纯函数：txt/md 文本 → 结构化课程（课程名 / 题材 / 课时数组）。零 IO、零 cordis
 * 依赖，可全量单测。配套引擎见 engine.ts（BookImporter 负责建书 + 逐章写入）。
 *
 * 课时标题识别策略（面向课程导出文件实测格式）：
 *  - 严格标题：`第X章 标题`（带分隔符）、`第X章`（裸）、`楔子/序章/番外/…`、
 *    `Chapter N`（英文）；md 的 `# 标题` 行一律算标题。
 *  - 粘连标题：`第X章标题`（无分隔符）只在全文件出现 ≥3 处时才整体提升为标题
 *    （统计确认，避免把讲义中"第二章我们终于见面了"这类句子误判）。
 *  - 无任何标题 → 数字行（`1、标题`）≥3 处则按数字行切分；否则按段落分块兜底
 *    （约 2500 字一章，保证讲义完整同步）。
 *  - 讲义行与标题行的区分：分隔符仅限 空格/全角空格/冒号/顿号/点/破折号/·，
 *    不含逗号（讲义"第三章，我们走了"不会误判）；粘连候选行须 ≤40 字且不以句末
 *    标点结尾。
 *
 * 课程名来源优先级：md frontmatter `title:` → 首行课程名启发式（首行短且下一非空行
 * 是标题）→ 文件名去扩展名。
 */
import type { PluginError } from '../types.ts'
import { genreIdFromLabel, isGenreId } from '../genres.ts'
import { BUILTIN_KINDS, DEFAULT_KIND_ID, defaultGenreOf, genresOf } from '../kinds.ts'

export interface ParsedChapter {
  title: string
  content: string
}

export interface ParsedBook {
  title: string
  genre: string
  /**
   * 项目类型 id（P2：4 种内置类型 + 自定义）。可选是因为 BookImporter 也接受
   * 外部构造的解析结果；缺省时按 course 建书（见 engine.ts）。
   */
  kind?: string
  chapters: ParsedChapter[]
}

/** parseBookFile 的可选入参。 */
export interface ParseOptions {
  /** 项目类型 id（缺省 course）。决定题材映射口径。 */
  kind?: string
}

// ── 标题正则 ──────────────────────────────────────────────────────────────

const NUM = '(?:\\d{1,4}|[零〇一二三四五六七八九十百千万两]+)'
/**
 * 课时/章节量词。用**多选一**而非字符类，让「章节」「课时」这类双字量词整体匹配
 * （字符类 `[章节]` 会把「第一章」拆成量词「章」+ 正文「节」，从而整行失配）。
 * 回归教训：曾误改为 `'[课时回卷部篇集]'`（删掉「章」），导致 `第一章` 全部识别不出、
 * 导入功能整体瘫痪 —— 改这里务必跑 tests/importer.spec.ts。
 */
const UNIT = '(?:章节|课时|章|回|卷|部|篇|集|节|课)'
const SPEC_WORDS = '(楔子|序章|序言|引子|前言|后记|尾声|番外|外传|终章|最终章|大结局)'
/** 标题与讲义的分隔符（不含逗号：讲义"第三章，…"不误判）。 */
const SEP = '[ \\u3000:：、.．·\\-—]'

const CN_SEP = new RegExp(`^第\\s*${NUM}\\s*${UNIT}${SEP}+(.+)$`)
const CN_BARE = new RegExp(`^第\\s*${NUM}\\s*${UNIT}$`)
// 粘连标题：后缀首字符不得为标点（"第三章，我们走了" 是讲义，不是标题）
const CN_GLUED = new RegExp(`^第\\s*${NUM}\\s*${UNIT}([^，,。．.！？!?；;：:\\s].*)$`)
const SPEC_SEP = new RegExp(`^${SPEC_WORDS}${SEP}+(.+)$`)
const SPEC_BARE = new RegExp(`^${SPEC_WORDS}$`)
const SPEC_GLUED = new RegExp(`^${SPEC_WORDS}([^，,。．.！？!?；;：:\\s].*)$`)
const EN_BARE = /^chapter\s+\d{1,4}[.．]?\s*$/i
const EN_SEP = /^chapter\s+\d{1,4}\s*[:：.\-—·]\s*(.+)$/i
const NUM_HEADING = new RegExp(`^(${NUM})\\s*[、.．:：]\\s*(.+)$`)
const MD_HEADING = /^#{1,6}\s+/
const SENTENCE_END = /[。！？!?；;]$/

const MAX_GLUED_LEN = 40
const MAX_SPEC_GLUED_LEN = 20
const MAX_NUMERIC_LEN = 30

/** 数字行兜底：要求 ≥3 处才启用；排除 "12.5 万" 这类（分隔符后紧跟数字）。 */
function isNumericHeading(line: string): boolean {
  if (line.length > MAX_NUMERIC_LEN) return false
  const match = NUM_HEADING.exec(line)
  if (!match) return false
  return !/^\d/.test(match[2] ?? '')
}

type Line =
  | { kind: 'heading'; title: string; raw: string }
  | { kind: 'glued'; title: string; raw: string }
  | { kind: 'numeric'; title: string; raw: string }
  | { kind: 'body'; text: string }

/** md 行：去 # 前缀与可选加粗记号后提取内嵌标题。 */
function mdInnerTitle(trimmed: string): string {
  return trimmed
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*\*?/, '')
    .replace(/\*\*?$/, '')
    .trim()
}

/** 从已去 # 的文本提取干净的课时标题（用于 md 标题行）。 */
function extractInnerTitle(text: string): string {
  const value = text.trim()
  const cnSep = CN_SEP.exec(value)
  if (cnSep) return cnSep[1]!.trim()
  if (CN_BARE.test(value)) return value
  const specSep = SPEC_SEP.exec(value)
  if (specSep) return specSep[2]!.trim()
  if (SPEC_BARE.test(value)) return value
  const enSep = EN_SEP.exec(value)
  if (enSep) return enSep[1]!.trim()
  if (EN_BARE.test(value)) return value
  return value
}

/** 分类一行（trimmed）。glued/numeric 是否最终提升由 parseBookFile 统计决定。 */
function classify(trimmed: string): Line {
  if (trimmed.length === 0) return { kind: 'body', text: '' }
  if (MD_HEADING.test(trimmed)) {
    const inner = mdInnerTitle(trimmed)
    return { kind: 'heading', title: extractInnerTitle(inner), raw: trimmed }
  }
  const cnSep = CN_SEP.exec(trimmed)
  if (cnSep) return { kind: 'heading', title: cnSep[1]!.trim(), raw: trimmed }
  if (CN_BARE.test(trimmed)) return { kind: 'heading', title: trimmed, raw: trimmed }
  const specSep = SPEC_SEP.exec(trimmed)
  if (specSep) return { kind: 'heading', title: specSep[2]!.trim(), raw: trimmed }
  if (SPEC_BARE.test(trimmed)) return { kind: 'heading', title: trimmed, raw: trimmed }
  const enSep = EN_SEP.exec(trimmed)
  if (enSep && trimmed.length <= 60) return { kind: 'heading', title: enSep[1]!.trim(), raw: trimmed }
  if (EN_BARE.test(trimmed)) return { kind: 'heading', title: trimmed, raw: trimmed }
  const cnGlued = CN_GLUED.exec(trimmed)
  if (cnGlued && trimmed.length <= MAX_GLUED_LEN && !SENTENCE_END.test(trimmed)) {
    return { kind: 'glued', title: cnGlued[1]!.trim(), raw: trimmed }
  }
  const specGlued = SPEC_GLUED.exec(trimmed)
  if (specGlued && trimmed.length <= MAX_SPEC_GLUED_LEN && !SENTENCE_END.test(trimmed)) {
    return { kind: 'glued', title: specGlued[1]!.trim(), raw: trimmed }
  }
  if (isNumericHeading(trimmed)) return { kind: 'numeric', title: NUM_HEADING.exec(trimmed)![2]!.trim(), raw: trimmed }
  return { kind: 'body', text: trimmed }
}

/** 是否"明显是标题行"（严格模式，用于首行课程名启发式）。 */
function looksLikeHeading(trimmed: string): boolean {
  if (trimmed.length === 0) return false
  return MD_HEADING.test(trimmed)
    || CN_SEP.test(trimmed) || CN_BARE.test(trimmed)
    || SPEC_SEP.test(trimmed) || SPEC_BARE.test(trimmed)
    || EN_SEP.test(trimmed) || EN_BARE.test(trimmed)
    || isNumericHeading(trimmed)
}

/** 课时讲义装配：去首尾空行、压缩 3+ 连续空行为 1 个空行。 */
function assemble(lines: string[]): string {
  return lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n{3,}/g, '\n\n')
}

/** 无标题文件的段落分块兜底：单段超长先按句号切，再按 ~targetChars 聚块。 */
export function chunkParagraphs(text: string, targetChars = 2500): ParsedChapter[] {
  const pieces: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue
    if (trimmed.length > targetChars * 2) {
      // 长段落按句号切（保留标点），避免单章过大
      let current = ''
      for (const sentence of trimmed.split(/(?<=[。！？!?])/)) {
        if (!sentence) continue
        if (current && current.length + sentence.length > targetChars) {
          pieces.push(current)
          current = sentence
        } else {
          current += sentence
        }
      }
      if (current) pieces.push(current)
    } else {
      pieces.push(trimmed)
    }
  }
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > targetChars) {
      chunks.push(current)
      current = piece
    } else {
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  if (current) chunks.push(current)
  return chunks.map((content, index) => ({ title: `第 ${index + 1} 节`, content }))
}

/** md frontmatter（`---` 块：title / genre）。非 frontmatter 开头返回 null。 */
function tryParseFrontmatter(text: string): { title?: string; genre?: string; body: string } | null {
  if (!text.startsWith('---\n')) return null
  const rest = text.slice(4)
  const close = /^---[ \t]*$/m.exec(rest)
  if (!close) return null
  const block = rest.slice(0, close.index)
  const body = rest.slice(close.index + close[0].length).replace(/^\n/, '')
  const pick = (key: string): string | undefined => {
    const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(block)
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, '')
    return value || undefined
  }
  return { title: pick('title'), genre: pick('genre'), body }
}

/** 文件名 → 课程名（去目录、去扩展名）。 */
function stem(fileName: string): string {
  const base = String(fileName ?? '').split(/[\\/]/).at(-1) ?? ''
  const cleaned = base.replace(/\.[^.]+$/, '').trim()
  return cleaned || '未命名课程'
}

/** 常见口语变体 → 课程学科 id（仅课程口径使用）。 */
const COURSE_GENRE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  '通识': 'general', '通用': 'general', '素养': 'general',
  '人文': 'humanities', '社科': 'humanities',
  '科普': 'science', '科学': 'science',
  '数学': 'math', '高数': 'math', '奥数': 'math',
  '语文': 'chinese', '国文': 'chinese', '写作': 'chinese',
  '英语': 'english', '外文': 'english', '外语': 'english',
  '物理': 'physics', '化学': 'chemistry', '生物': 'biology',
  '地理': 'geography',
  '编程': 'programming', '计算机': 'programming', '代码': 'programming', '前端': 'programming',
  '营销': 'marketing', '市场': 'marketing',
  '管理': 'management', '财务': 'finance', '会计': 'finance', '金融': 'finance',
  '法律': 'law', '法务': 'law',
  '考证': 'certification', '职业资格': 'certification',
  '公考': 'civil-service', '公务员': 'civil-service', '编制': 'civil-service', '事业单位': 'civil-service',
  '美术': 'art', '音乐': 'music',
  '健康': 'health', '养生': 'health', '体育': 'sports', '健身': 'sports',
})

/**
 * 题材归一化（**类型感知**）：frontmatter `genre` / 中文标签 / 常见口语变体 → 题材 id。
 *
 * 解析口径按 `kindId` 切换，因为同一个词在不同类型下含义不同（例：`science`
 * 在课程口径是「科普」，在论文口径是「理学」）。
 *
 * 1. 目标类型自带题材表内命中（id 或中文标签，大小写不敏感）→ 直接采用；
 * 2. 课程口径额外沿用历史别名表（保证旧导入结果不变）；
 * 3. 都未命中 → 该类型的默认题材（课程 `general`、小说 `xuanhuan`…），
 *    而不是硬写 `general` —— 否则导入小说会落到课程题材表里一个不存在的 id。
 */
export function mapGenre(raw: string, kindId: string = DEFAULT_KIND_ID): string {
  const value = String(raw ?? '').trim()
  const lower = value.toLowerCase()
  const fallback = defaultGenreOf(BUILTIN_KINDS, kindId)
  if (!value) return fallback

  // 1) 目标类型自带题材
  const hit = genresOf(BUILTIN_KINDS, kindId).find(
    (genre) => genre.id === lower || genre.label.toLowerCase() === lower,
  )
  if (hit) return hit.id

  // 2) 课程口径的历史别名表
  if (kindId === DEFAULT_KIND_ID) {
    if (isGenreId(lower)) return lower
    const fromLabel = genreIdFromLabel(lower)
    if (fromLabel) return fromLabel
    const aliased = COURSE_GENRE_ALIASES[value] ?? COURSE_GENRE_ALIASES[lower]
    if (aliased) return aliased
  }

  // 3) 未命中 → 该类型默认题材
  return fallback
}

/** 解析课程文件（txt / md）。失败抛 PluginError（IMPORT_FILE_EMPTY / NO_IMPORTABLE_ENTRIES）。 */
export function parseBookFile(fileName: string, content: string, options: ParseOptions = {}): ParsedBook {
  const kind = String(options.kind ?? '').trim() || DEFAULT_KIND_ID
  let text = String(content ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) {
    throw { code: 'IMPORT_FILE_EMPTY', message: '文件内容为空' } as PluginError
  }

  // md frontmatter
  let metaTitle: string | undefined
  let metaGenre: string | undefined
  const fm = tryParseFrontmatter(text)
  if (fm) {
    metaTitle = fm.title
    metaGenre = fm.genre
    text = fm.body
  }

  // 分类所有行
  const lines: Line[] = text.split('\n').map((line) => classify(line.trim()))

  // 统计与提升：粘连标题 ≥3 处才提升；无严格标题时数字行 ≥3 处才启用
  const strictCount = lines.filter((line) => line.kind === 'heading').length
  const gluedCount = lines.filter((line) => line.kind === 'glued').length
  const gluePromoted = gluedCount >= 3
  const numericCount = lines.filter((line) => line.kind === 'numeric').length
  const numericPromoted = strictCount === 0 && !gluePromoted && numericCount >= 3
  const isHeading = (line: Line): line is Extract<Line, { kind: 'heading' } | { kind: 'glued' } | { kind: 'numeric' }> =>
    line.kind === 'heading'
    || (line.kind === 'glued' && gluePromoted)
    || (line.kind === 'numeric' && numericPromoted)

  // 切分课时
  const chapters: Array<{ title: string; lines: string[] }> = []
  const preamble: string[] = []
  for (const line of lines) {
    if (isHeading(line)) {
      chapters.push({ title: line.title, lines: [] })
    } else {
      // 未提升的 glued/numeric 候选行必须保留原始文本（否则讲义数据丢失）
      const text = line.kind === 'body' ? line.text : String((line as Extract<Line, { kind: 'glued' | 'numeric' }>).raw ?? '')
      if (chapters.length === 0) {
        preamble.push(text)
      } else {
        const last = chapters[chapters.length - 1]!
        last.lines.push(text)
      }
    }
  }

  // 无任何标题 → 段落分块兜底（完整保留讲义）
  if (chapters.length === 0) {
    const chunks = chunkParagraphs(text)
    if (chunks.length === 0) {
      throw { code: 'NO_IMPORTABLE_ENTRIES', message: '未能识别到课时内容' } as PluginError
    }
    return {
      title: metaTitle ?? '未命名课程',
      genre: mapGenre(metaGenre ?? '', kind),
      kind,
      chapters: chunks,
    }
  }

  // 前置内容（首个标题前）：≥100 字 → 楔子章；否则并入第一章（保留内容）
  const built: ParsedChapter[] = []
  const preambleText = assemble(preamble)
  if (preambleText.trim()) {
    if (preambleText.length >= 100) {
      built.push({ title: '楔子', content: preambleText })
    } else {
      chapters[0]!.lines.unshift(preambleText)
    }
  }
  for (const chapter of chapters) {
    built.push({ title: chapter.title, content: assemble(chapter.lines) })
  }
  // 末尾空课时（文件尾部悬空的"第N章"行）剔除
  while (built.length > 0 && !built[built.length - 1]!.content.trim()) {
    built.pop()
  }
  if (built.length === 0) {
    throw { code: 'NO_IMPORTABLE_ENTRIES', message: '未能识别到课时内容' } as PluginError
  }

  // 课程名：frontmatter → 首行启发式 → 文件名
  let title = metaTitle ?? ''
  if (!title) {
    const rawLines = text.split('\n')
    const first = rawLines.find((line) => line.trim().length > 0)?.trim()
    const second = rawLines.filter((line) => line.trim().length > 0)[1]?.trim() ?? ''
    if (first && first.length <= 40 && !SENTENCE_END.test(first) && !looksLikeHeading(first) && looksLikeHeading(second)) {
      title = first
    }
  }
  title = title || stem(fileName)

  return { title, genre: mapGenre(metaGenre ?? '', kind), kind, chapters: built }
}
