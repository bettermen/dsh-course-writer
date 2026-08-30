/**
 * xiashuo — 课程项目存储层（P1-B）。
 *
 * 目录布局（DEVELOPMENT-PLAN §6.1 对齐）：
 *   <baseDir>/<bookId>/
 *     book.json            # VersionedFile 外壳（schemaVersion + Book）
 *     workflow.json        # 项目私有工作流（P1；缺省时按 kind 惰性生成）
 *     audit.jsonl          # 审计事件（append-only，seq=行号）
 *     docs/<phase>.md      # 阶段产物（topic/setting/...）
 *     versions/<phase>/v<n>.md   # 产物版本快照（每次写 artifact +1）
 *     chapters/ch<no>.md   # 讲义（首行 HTML 注释内嵌课时元数据 JSON）
 * 设计要点：原子写（atomic-file）、bookId 路径安全校验、课时 frontmatter
 * 容错解析（缺字段默认值、未知字段保留）、旧格式自动迁移。
 *
 * P1：工作流动态化 —— 阶段顺序不再由常量固定，项目私有流程存 workflow.json；
 * 旧项目（无此文件）首次读取时按 book.kind（缺省 course）惰性生成并落盘。
 */
import { join } from 'node:path'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { appendLine, atomicWriteFile, readOptional } from '../atomic-file.ts'
import { newId, nowIso } from '../util.ts'
import { createLedger, DEFAULT_PHASE_ORDER } from '../workflow/engine.ts'
import { instantiateWorkflow, phaseOrderOf, validateWorkflow } from '../workflow/schema.ts'
import { builtinTemplateOf } from '../workflow/templates.ts'
import { DEFAULT_KIND_ID } from '../kinds.ts'
import type { Workflow } from '../workflow/schema.ts'
import type { AuditEvent, PhaseId } from '../workflow/types.ts'
import type { Book, BookConfig, BookSummary, Chapter, KindId } from './types.ts'

/** 当前 book.json 格式版本。 */
export const BOOK_SCHEMA_VERSION = 1

/** bookId 校验：单段安全标识符（防路径穿越）。 */
export function assertBookId(id: string): string {
  const normalized = String(id ?? '').trim()
  if (!/^bk_[a-z0-9._-]+$/i.test(normalized) || normalized.includes('..')) {
    throw { code: 'INVALID_ENTRY_ID', message: `非法项目 ID: ${normalized}` } as never
  }
  return normalized
}

function defaultConfig(genre: string): BookConfig {
  return {
    title: '',
    genre,
    wordTargets: { perChapterMin: 2000, perChapterMax: 4000 },
    style: { pov: 'third', forbiddenWords: [], aiTasteWords: [] },
    phaseGating: true,
  }
}

function toSummary(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    genre: book.genre,
    kind: book.kind ?? DEFAULT_KIND_ID,
    status: book.status,
    currentPhase: book.currentPhase,
    chapterCount: book.stats.chapterCount,
    totalWords: book.stats.totalWords,
    updatedAt: book.updatedAt,
  }
}

/** 课时元数据 frontmatter 编码/解析（HTML 注释内嵌 JSON，markdown 兼容）。 */
export function encodeChapterFrontmatter(chapter: Chapter): string {
  return `<!-- novel: ${JSON.stringify(chapter)} -->\n`
}

export function parseChapterFrontmatter(text: string): { chapter: Chapter; body: string } | null {
  const firstLineEnd = text.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)
  const match = /^<!--\s*novel:\s*(\{.*\})\s*-->$/.exec(firstLine.trim())
  if (!match) return null
  try {
    const raw = JSON.parse(match[1] ?? '{}') as Partial<Chapter>
    const chapter: Chapter = {
      no: typeof raw.no === 'number' ? raw.no : 0,
      title: typeof raw.title === 'string' ? raw.title : '',
      status: raw.status === 'approved' || raw.status === 'revised' ? raw.status : 'draft',
      version: typeof raw.version === 'number' ? raw.version : 1,
      words: typeof raw.words === 'number' ? raw.words : 0,
      ...(typeof raw.brief === 'string' ? { brief: raw.brief } : {}),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }
    const body = firstLineEnd === -1 ? '' : text.slice(firstLineEnd + 1)
    return { chapter, body }
  } catch {
    return null
  }
}

export class NovelStore {
  readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private bookDir(id: string): string {
    return join(this.baseDir, assertBookId(id))
  }

  /** 公共目录访问（供组装器/变量存储等模块定位项目内文件）。 */
  getBookDir(id: string): string {
    return this.bookDir(id)
  }

  private bookFile(id: string): string {
    return join(this.bookDir(id), 'book.json')
  }

  private workflowFile(id: string): string {
    return join(this.bookDir(id), 'workflow.json')
  }

  // ── 项目 ──

  /**
   * 新建项目。
   *
   * @param params.kind 项目类型 id（course/official/novel/thesis/自定义）；
   *   缺省 `DEFAULT_KIND_ID`（course）。决定初始工作流模板。
   */
  async createBook(params: { title: string; genre: string; kind?: KindId }): Promise<Book> {
    const id = newId('bk')
    const now = nowIso()
    const genre = params.genre.trim() || 'general'
    const kind = String(params.kind ?? '').trim() || DEFAULT_KIND_ID
    const config = defaultConfig(genre)
    config.title = params.title.trim()
    // 按类型取内置模板 → 派生项目私有副本 → 用其阶段顺序初始化状态机
    const workflow = instantiateWorkflow(builtinTemplateOf(kind), { id: `wf_${id}`, kind })
    const order = phaseOrderOf(workflow)
    const ledger = createLedger(id, now, { order })
    const book: Book = {
      id,
      title: params.title.trim(),
      genre,
      kind,
      status: 'drafting',
      config,
      phases: ledger.phases,
      currentPhase: ledger.currentPhase,
      stats: { totalWords: 0, chapterCount: 0 },
      createdAt: now,
      updatedAt: now,
      schemaVersion: BOOK_SCHEMA_VERSION,
    }
    await mkdir(this.bookDir(id), { recursive: true, mode: 0o700 })
    await atomicWriteFile(this.bookFile(id), `${JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, data: book }, null, 2)}\n`)
    await this.writeWorkflow(id, workflow)
    const firstPhase = order[0] ?? DEFAULT_PHASE_ORDER[0]!
    await appendLine(join(this.bookDir(id), 'audit.jsonl'), `${JSON.stringify({ seq: 1, at: now, action: 'create', phase: firstPhase, actor: 'user', detail: `project created (kind=${kind})` })}`)
    return book
  }

  // ── 工作流（workflow.json） ──

  /**
   * 读项目工作流；**文件不存在时按项目类型惰性生成并落盘**（旧项目自动迁移）。
   *
   * 文件存在但结构非法 → 抛 PluginError（不静默回退，避免掩盖数据损坏）。
   */
  async readWorkflow(bookId: string): Promise<Workflow> {
    const text = await readOptional(this.workflowFile(bookId))
    if (text !== undefined) {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw { code: 'INVALID_FIELD_TYPE', message: `workflow.json 损坏（非法 JSON）: ${bookId}` } as never
      }
      const validated = validateWorkflow(parsed)
      if (!validated.ok) {
        throw { ...validated.error, message: `workflow.json 结构非法（${bookId}）: ${validated.error.message}` } as never
      }
      return validated.value
    }
    // 惰性迁移：老项目没有 workflow.json —— 按类型模板补一份
    return await this.writeWorkflow(bookId, instantiateWorkflow(builtinTemplateOf(await this.readBookKind(bookId)), {
      id: `wf_${bookId}`,
      kind: await this.readBookKind(bookId),
    }))
  }

  /** 写项目工作流（结构非法时拒绝落盘）。 */
  async writeWorkflow(bookId: string, workflow: Workflow): Promise<Workflow> {
    const validated = validateWorkflow(workflow)
    if (!validated.ok) throw { ...validated.error, message: `工作流结构非法: ${validated.error.message}` } as never
    await mkdir(this.bookDir(bookId), { recursive: true, mode: 0o700 })
    await atomicWriteFile(this.workflowFile(bookId), `${JSON.stringify(validated.value, null, 2)}\n`)
    return validated.value
  }

  /** 项目阶段顺序（工作流优先；无工作流时回退默认九阶段）。 */
  async phaseOrder(bookId: string): Promise<string[]> {
    return phaseOrderOf(await this.readWorkflow(bookId))
  }

  /**
   * 只读取 book.json 的 kind 字段（不触发工作流迁移，避免 loadBook ↔ readWorkflow 互调）。
   * 文件缺失/损坏时回退 DEFAULT_KIND_ID。
   */
  private async readBookKind(bookId: string): Promise<KindId> {
    const text = await readOptional(this.bookFile(bookId))
    if (text === undefined) return DEFAULT_KIND_ID
    try {
      const parsed = JSON.parse(text) as { data?: { kind?: unknown }; kind?: unknown }
      const raw = parsed?.data?.kind ?? parsed?.kind
      return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_KIND_ID
    } catch {
      return DEFAULT_KIND_ID
    }
  }

  /**
   * 只读取 workflow.json 的阶段 id 列表（容错：非法时返回 undefined）。
   * 供 loadBook 补全阶段记录使用 —— 与 readWorkflow 的严格校验分工：
   * loadBook 宽容（损坏项目仍可列出），readWorkflow 严格（编辑流程前必须暴露问题）。
   */
  private async workflowPhaseIds(bookId: string): Promise<string[] | undefined> {
    const text = await readOptional(this.workflowFile(bookId))
    if (text === undefined) return undefined
    try {
      const parsed = JSON.parse(text) as { phases?: Array<{ id?: unknown }> }
      if (!Array.isArray(parsed?.phases)) return undefined
      const ids = parsed.phases.map((phase) => (phase && typeof phase.id === 'string' ? phase.id : '')).filter((id) => id.length > 0)
      return ids.length > 0 ? ids : undefined
    } catch {
      return undefined
    }
  }

  /** 加载项目；旧格式（裸 Book 对象）自动包装迁移。损坏/非法 JSON 抛 PluginError（可报告）。 */
  async loadBook(id: string): Promise<Book> {
    const text = await readOptional(this.bookFile(id))
    if (text === undefined) throw { code: 'ENTRY_NOT_FOUND', message: `项目不存在: ${id}` } as never
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw { code: 'INVALID_FIELD_TYPE', message: `book.json 损坏（非法 JSON）: ${id}` } as never
    }
    const raw = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { schemaVersion?: unknown }).schemaVersion === 'number'
      ? (parsed as { schemaVersion: number; data: Book }).data
      : (parsed as Book)
    if (!raw || typeof raw.id !== 'string' || !raw.phases || typeof raw.config !== 'object' || typeof raw.stats !== 'object') {
      throw { code: 'INVALID_FIELD_TYPE', message: `book.json 形状非法: ${id}` } as never
    }
    // 迁移 1：P1 之前的项目没有 kind 字段 —— 一律归属默认类型（course）
    const kind = typeof raw.kind === 'string' && raw.kind.trim().length > 0 ? raw.kind.trim() : DEFAULT_KIND_ID
    // 迁移 2：缺失阶段记录补全为 locked。顺序优先取项目工作流，无工作流时回退旧九阶段
    const order = (await this.workflowPhaseIds(id)) ?? DEFAULT_PHASE_ORDER
    const phases = { ...raw.phases }
    for (const phaseId of order) {
      if (!phases[phaseId]) phases[phaseId] = { id: phaseId, state: 'locked', version: 0 }
    }
    return { ...raw, kind, phases, schemaVersion: BOOK_SCHEMA_VERSION }
  }

  async saveBook(book: Book): Promise<void> {
    const saved: Book = { ...book, updatedAt: nowIso() }
    await atomicWriteFile(this.bookFile(book.id), `${JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, data: saved }, null, 2)}\n`)
  }

  async listBooks(): Promise<BookSummary[]> {
    const names = await readdir(this.baseDir).catch(() => [] as string[])
    const summaries: BookSummary[] = []
    for (const name of names) {
      if (!/^bk_[a-z0-9._-]+$/i.test(name)) continue
      try {
        summaries.push(toSummary(await this.loadBook(name)))
      } catch {
        // 损坏项目不隐藏健康项目（doctor/审计另行报告）
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * 删除项目。keepChapters=true 时保留 chapters/ 目录（讲义文件不删，
   * 仅移除 book.json/docs/audit 等元数据——项目从列表消失，讲义可手动取回）；
   * false 时删除整个项目目录。
   */
  async deleteProject(id: string, keepChapters: boolean): Promise<{ deleted: boolean; keptChapters: boolean }> {
    const dir = this.bookDir(id)
    const { rm } = await import('node:fs/promises')
    if (keepChapters) {
      // 保留 chapters/，删除其余元数据文件
      await rm(this.bookFile(id), { force: true })
      await rm(this.workflowFile(id), { force: true })
      await rm(join(dir, 'docs'), { recursive: true, force: true })
      await rm(join(dir, 'versions'), { recursive: true, force: true })
      await rm(join(dir, 'summary'), { recursive: true, force: true })
      await rm(join(dir, 'exports'), { recursive: true, force: true })
      await rm(join(dir, 'audit.jsonl'), { force: true })
      await rm(join(dir, 'ledger.json'), { force: true })
      await rm(join(dir, 'timeline.json'), { force: true })
      await rm(join(dir, 'variables.json'), { force: true })
      await rm(join(dir, 'wizard.json'), { force: true })
      await rm(join(dir, 'foreshadow.json'), { force: true })
      await rm(join(dir, 'glossary.json'), { force: true })
      await rm(join(dir, 'ideas.json'), { force: true })
      return { deleted: true, keptChapters: true }
    }
    await rm(dir, { recursive: true, force: true })
    return { deleted: true, keptChapters: false }
  }

  // ── 审计 ──

  async appendAudit(bookId: string, event: Omit<AuditEvent, 'seq'>): Promise<AuditEvent> {
    const path = join(this.bookDir(bookId), 'audit.jsonl')
    const existing = await readOptional(path).then((text) => (text ? text.trim().split('\n').filter(Boolean).length : 0))
    const seq = existing + 1
    const full: AuditEvent = { ...event, seq }
    await appendLine(path, JSON.stringify(full))
    return full
  }

  async readAudit(bookId: string): Promise<AuditEvent[]> {
    const text = await readOptional(join(this.bookDir(bookId), 'audit.jsonl'))
    if (text === undefined) return []
    return text.trim().split('\n').filter(Boolean).map((line) => {
      try {
        return JSON.parse(line) as AuditEvent
      } catch {
        return null
      }
    }).filter((event): event is AuditEvent => event !== null)
  }

  // ── 阶段产物与版本快照 ──

  /** 写阶段产物：docs/<phase>.md + versions/<phase>/v<n>.md（n = 现有快照数+1）。 */
  async writeArtifact(bookId: string, phase: PhaseId, content: string): Promise<{ file: string; version: number }> {
    const dir = this.bookDir(bookId)
    await mkdir(join(dir, 'docs'), { recursive: true, mode: 0o700 })
    await mkdir(join(dir, 'versions', phase), { recursive: true, mode: 0o700 })
    const versionsDir = join(dir, 'versions', phase)
    const existing = await readdir(versionsDir).catch(() => [] as string[])
    // 快照号 = 现有最大 vN + 1（防历史快照被覆盖）
    let maxVersion = 0
    for (const name of existing) {
      const match = /^v(\d+)\.md$/.exec(name)
      if (match) maxVersion = Math.max(maxVersion, Number(match[1]))
    }
    const version = maxVersion + 1
    const file = join(dir, 'docs', `${phase}.md`)
    await atomicWriteFile(file, content)
    await atomicWriteFile(join(versionsDir, `v${version}.md`), content)
    return { file, version }
  }

  async readArtifact(bookId: string, phase: PhaseId): Promise<string | undefined> {
    return await readOptional(join(this.bookDir(bookId), 'docs', `${phase}.md`))
  }

  // ── 课时 ──

  async writeChapter(bookId: string, chapter: Chapter, content: string): Promise<Chapter> {
    // 课时号合法性：0/负数/NaN 会写出 ch0.md / ch-1.md / chNaN.md
    if (!Number.isInteger(chapter.no) || chapter.no < 1) {
      throw { code: 'INVALID_FIELD_TYPE', message: `非法课时号: ${chapter.no}` } as never
    }
    const path = join(this.bookDir(bookId), 'chapters', `ch${chapter.no}.md`)
    await mkdir(join(this.bookDir(bookId), 'chapters'), { recursive: true, mode: 0o700 })
    await atomicWriteFile(path, `${encodeChapterFrontmatter(chapter)}${content.trimEnd()}\n`)
    return chapter
  }

  async readChapter(bookId: string, no: number): Promise<{ chapter: Chapter; content: string } | undefined> {
    const text = await readOptional(join(this.bookDir(bookId), 'chapters', `ch${no}.md`))
    if (text === undefined) return undefined
    const parsed = parseChapterFrontmatter(text)
    if (parsed) return { chapter: parsed.chapter, content: parsed.body.trimEnd() }
    // 容错：无 frontmatter 的裸讲义 → 构造默认课时元数据
    return {
      chapter: { no, title: `第 ${no} 章`, status: 'draft', version: 1, words: 0, createdAt: '', updatedAt: '' },
      content: text.trimEnd(),
    }
  }

  async readChapterContent(bookId: string, no: number): Promise<string> {
    const chapter = await this.readChapter(bookId, no)
    return chapter?.content ?? ''
  }

  /** 已存在的课时号（解析 chapters/ 下 ch<N>.md；稀疏编号也正确）。 */
  async listChapterNumbers(bookId: string): Promise<number[]> {
    const dir = join(this.bookDir(bookId), 'chapters')
    const numbers: number[] = []
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const match = /^ch(\d+)\.md$/.exec(name)
      if (match) numbers.push(Number(match[1]))
    }
    return numbers.sort((a, b) => a - b)
  }

  /** 删除课时讲义文件。返回 false 表示原本就不存在。 */
  async deleteChapterFile(bookId: string, no: number): Promise<boolean> {
    const path = join(this.bookDir(bookId), 'chapters', `ch${no}.md`)
    if ((await readOptional(path)) === undefined) return false
    await rm(path, { force: true })
    return true
  }

  /**
   * 按新顺序重排课时（统一重编号为 1..N）。
   *
   * @param order 现有课时号数组，按期望的新顺序排列（必须是完整排列，
   *   否则拒绝执行——避免部分重排造成编号冲突/覆盖）。
   * @returns 映射表 `[{ from, to }]`。
   *
   * 落盘采用三阶段：先复制到暂存目录 → 再删除旧编号 → 最后按新编号写回。
   * 直接原地 rename 在编号回环（如 1↔2 互换）时会互相覆盖，故必须先腾空。
   */
  async reorderChapters(bookId: string, order: number[]): Promise<Array<{ from: number; to: number }>> {
    const existing = await this.listChapterNumbers(bookId)
    const unique = Array.from(new Set(order))
    const sorted = [...unique].sort((a, b) => a - b)
    if (sorted.length !== existing.length || sorted.some((value, index) => value !== existing[index])) {
      throw { code: 'INVALID_FIELD_TYPE', message: '课时顺序非法：必须是当前全部课时号的一个排列' } as never
    }
    const mapping = unique.map((from, index) => ({ from, to: index + 1 }))
    if (mapping.every(({ from, to }) => from === to)) return mapping
    const chaptersDir = join(this.bookDir(bookId), 'chapters')
    // 阶段 0：原文读入内存 + 落暂存副本（中途崩溃可人工恢复）
    const staging = join(chaptersDir, `.reorder-${Date.now().toString(36)}`)
    await mkdir(staging, { recursive: true, mode: 0o700 })
    const payload: Array<{ to: number; raw: string }> = []
    for (const { from, to } of mapping) {
      const raw = await readOptional(join(chaptersDir, `ch${from}.md`))
      if (raw === undefined) continue
      await atomicWriteFile(join(staging, `s${to}.md`), raw)
      payload.push({ to, raw })
    }
    // 阶段 1：清空旧编号（暂存区已有副本，可恢复）
    for (const { from } of mapping) await rm(join(chaptersDir, `ch${from}.md`), { force: true })
    // 阶段 2：按新编号写回，frontmatter 内的 no 同步更新
    const now = nowIso()
    for (const { to, raw } of payload) {
      const parsed = parseChapterFrontmatter(raw)
      const chapter: Chapter = parsed
        ? { ...parsed.chapter, no: to, updatedAt: now }
        : { no: to, title: `第 ${to} 章`, status: 'draft', version: 1, words: 0, createdAt: now, updatedAt: now }
      const body = parsed ? parsed.body : raw
      await atomicWriteFile(join(chaptersDir, `ch${to}.md`), `${encodeChapterFrontmatter(chapter)}${body.trimEnd()}\n`)
    }
    // 阶段 3：清理暂存区
    await rm(staging, { recursive: true, force: true })
    return mapping
  }
}
