/**
 * xiashuo — 课程创作组合服务（P1-F1）。
 *
 * 职责：把 workflow 引擎 + NovelStore + 字数统计 + 变量引擎 + 上下文组装
 * 组合为面向工具层/会话驱动的统一服务面。所有操作写审计日志。
 * 不包含会话驱动（P1-F2 ChapterWriter 单独实现）。
 */
import type { AuditEvent, PhaseId, PhaseLedger } from '../workflow/types.ts'
import type { EngineContext } from '../workflow/engine.ts'
import { enter, forceApprove, reopen, rollback, skip, submit } from '../workflow/engine.ts'
import type { PhaseReport } from '../workflow/types.ts'
import {
  instantiateWorkflow, phaseOrderOf, createPhase, insertPhase,
  removePhase, renamePhase, updatePhase, reorderPhase,
} from '../workflow/schema.ts'
import { builtinTemplateOf } from '../workflow/templates.ts'
import type { Workflow, WorkflowPhase, PhaseGate } from '../workflow/schema.ts'
import { progressOf as progressOfPhases } from '../project/query.ts'
import type { Book, BookConfig, BookSummary, Chapter, KindId } from './types.ts'
import type { NovelStore } from './store.ts'
import { DEFAULT_KIND_ID } from '../kinds.ts'
import { isProjectStatus } from './status.ts'
import type { ProjectStatus } from './status.ts'
import { checkWordTarget, countChapter } from '../stats/wordcount.ts'
import type { VariableStoreFile } from '../variables/store.ts'
import type { ContextPacket } from '../context/types.ts'
import { ContextAssembler } from '../context/assembler.ts'
import type { LoreStore } from '../lorebook/store.ts'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { appendLine, atomicWriteFile, readOptional } from '../atomic-file.ts'

export interface NovelServiceDeps {
  store: NovelStore
  loreStore: LoreStore
  variables: VariableStoreFile
  assembler?: ContextAssembler
}

/** 项目元信息局部更新入参（首页"编辑项目"弹窗）。 */
export interface ProjectPatch {
  title?: string
  description?: string
  genre?: string
  status?: ProjectStatus
  /** 改类型会连带把工作流重置为新类型的内置模板（见 updateProject 注释）。 */
  kind?: string
}

/** 阶段局部更新入参（流程编辑器 / course_workflow 工具的 update 动作）。 */
export type WorkflowPhasePatch = Partial<Omit<WorkflowPhase, 'id'>>

export class NovelService {
  private readonly store: NovelStore
  private readonly variables: VariableStoreFile
  private readonly assembler: ContextAssembler

  constructor(deps: NovelServiceDeps) {
    this.store = deps.store
    this.variables = deps.variables
    this.assembler = deps.assembler ?? new ContextAssembler({ store: deps.store, loreStore: deps.loreStore, variables: deps.variables })
  }

  // ── 项目 ──

  /** 新建项目。kind 缺省时按默认类型（course）处理。 */
  async createProject(title: string, genre: string, kind?: KindId): Promise<Book> {
    return await this.store.createBook({ title, genre, kind })
  }

  // ── 工作流（P1 动态化） ──

  /** 项目工作流（无 workflow.json 时按类型惰性生成并落盘）。 */
  workflowOf(bookId: string): Promise<Workflow> {
    return this.store.readWorkflow(bookId)
  }

  /** 项目阶段 id 顺序（引擎判定前后关系的唯一依据）。 */
  async phaseOrder(bookId: string): Promise<string[]> {
    return phaseOrderOf(await this.store.readWorkflow(bookId))
  }

  /** 保存工作流（结构非法时抛错，不落盘）。供流程编辑器调用。 */
  saveWorkflow(bookId: string, workflow: Workflow): Promise<Workflow> {
    return this.store.writeWorkflow(bookId, workflow)
  }

  /** 引擎上下文：把项目阶段顺序注入引擎（缺省回退旧九阶段）。 */
  async engineContext(bookId: string): Promise<EngineContext> {
    return { order: await this.phaseOrder(bookId) }
  }

  /** 读阶段产物（docs/<phase>.md）；无产物返回 undefined。 */
  async artifactOf(bookId: string, phase: PhaseId): Promise<string | undefined> {
    return await this.store.readArtifact(bookId, phase)
  }

  /**
   * 以「已结课项目」为模板克隆新项目（§3.5-11 模板复制）：
   *  复制 config（字数目标/风格视角/禁用词/AI味词）+ 已完成的阶段设定文档
   *  （选题/设定/人设/大纲/单元/教案）；**讲义不复制**（chapters/）。状态机重置。
   */
  async cloneProject(sourceId: string, options: { title?: string; genre?: string; kind?: KindId } = {}): Promise<Book> {
    const source = await this.store.loadBook(sourceId)
    const title = String(options.title ?? '').trim() || `${source.title}（模板）`
    const genre = String(options.genre ?? '').trim() || source.genre
    const kind = String(options.kind ?? '').trim() || source.kind
    const book = await this.store.createBook({ title, genre, kind })
    // 保留源的字数目标/风格/禁用词/AI味词；title/genre 更新为新项目
    const config: BookConfig = { ...source.config, title, genre, phaseGating: true }
    await this.store.saveBook({ ...book, config })
    // 保留源项目定制过的工作流（改为新项目的私有副本），而不是类型的默认模板
    const sourceWorkflow = await this.store.readWorkflow(sourceId)
    await this.store.writeWorkflow(book.id, instantiateWorkflow(sourceWorkflow, { id: `wf_${book.id}`, kind }))
    // 复制已完成阶段的设定文档（讲义、结课、修订阶段不复制）
    const order = phaseOrderOf(sourceWorkflow)
    const terminal = order[order.length - 1]
    for (const phase of order) {
      if (phase === 'writing' || phase === 'revision' || phase === terminal) continue
      const artifact = await this.store.readArtifact(sourceId, phase)
      if (artifact) await this.store.writeArtifact(book.id, phase, artifact)
    }
    return await this.store.loadBook(book.id)
  }

  listProjects(): Promise<BookSummary[]> {
    return this.store.listBooks()
  }

  // ── 项目元信息（P2 首页） ──

  /**
   * 局部更新项目元信息（首页"编辑项目"弹窗）。
   *
   * 只落 `book.json`，不触碰阶段产物与讲义。变更写审计。
   *
   * **改类型（kind）会连带重置工作流**：类型决定流程，换类型即换流程 ——
   * 工作流回落到新类型的内置模板。已有阶段记录**保留**（同 id 的阶段进度
   * 不丢，被移除的阶段记录留在 map 里但不再计入进度）。
   */
  async updateProject(bookId: string, patch: ProjectPatch): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    const changes: string[] = []
    let next: Book = book

    if (patch.title !== undefined) {
      const title = String(patch.title).trim()
      if (!title) throw { code: 'INVALID_FIELD_TYPE', message: '项目名称不能为空' } as never
      if (title.length > 60) throw { code: 'INVALID_FIELD_TYPE', message: '项目名称不能超过 60 字符' } as never
      if (title !== book.title) {
        next = { ...next, title, config: { ...next.config, title } }
        changes.push(`title → ${title}`)
      }
    }
    if (patch.description !== undefined) {
      const description = String(patch.description).trim().slice(0, 200)
      if (description !== (book.description ?? '')) {
        next = { ...next, description }
        changes.push('description updated')
      }
    }
    if (patch.genre !== undefined) {
      const genre = String(patch.genre).trim()
      if (!genre) throw { code: 'INVALID_FIELD_TYPE', message: '题材不能为空' } as never
      if (genre !== book.genre) {
        next = { ...next, genre, config: { ...next.config, genre } }
        changes.push(`genre → ${genre}`)
      }
    }
    if (patch.status !== undefined) {
      if (!isProjectStatus(patch.status)) {
        throw { code: 'INVALID_FIELD_TYPE', message: `非法项目状态: ${String(patch.status)}` } as never
      }
      if (patch.status !== book.status) {
        next = { ...next, status: patch.status }
        changes.push(`status → ${patch.status}`)
      }
    }
    if (patch.kind !== undefined) {
      const kind = String(patch.kind).trim()
      if (!kind) throw { code: 'INVALID_FIELD_TYPE', message: '项目类型不能为空' } as never
      if (kind !== book.kind) {
        next = { ...next, kind }
        await this.store.writeWorkflow(bookId, instantiateWorkflow(builtinTemplateOf(kind), { id: `wf_${bookId}`, kind }))
        changes.push(`kind → ${kind}（工作流已重置为该类型默认）`)
      }
    }
    if (changes.length === 0) return book

    await this.store.saveBook(next)
    await this.store.appendAudit(bookId, {
      at: new Date().toISOString(),
      action: 'update',
      phase: next.currentPhase,
      actor: 'user',
      detail: `project updated: ${changes.join('; ')}`,
    })
    return await this.store.loadBook(bookId)
  }

  /**
   * 归档 / 取消归档。
   * - 归档 → `archived`；
   * - 取消归档 → 已开工（任一阶段非 locked）回 `in_progress`，否则回 `draft`。
   */
  async archiveProject(bookId: string, archived: boolean): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    if (archived) return await this.updateProject(bookId, { status: 'archived' })
    const started = Object.values(book.phases).some((record) => record.state !== 'locked')
    return await this.updateProject(bookId, { status: started ? 'in_progress' : 'draft' })
  }

  /**
   * 恢复项目类型的默认工作流（丢弃项目内的全部定制）。
   * 阶段产物文件（docs/<phase>.md）**不删除** —— 用户改回流程后还能找回。
   */
  async resetWorkflow(bookId: string): Promise<Workflow> {
    const book = await this.store.loadBook(bookId)
    const kind = book.kind ?? DEFAULT_KIND_ID
    const workflow = await this.store.writeWorkflow(bookId, instantiateWorkflow(builtinTemplateOf(kind), {
      id: `wf_${bookId}`,
      kind,
    }))
    await this.store.appendAudit(bookId, {
      at: new Date().toISOString(),
      action: 'update',
      phase: book.currentPhase,
      actor: 'user',
      detail: `workflow reset to builtin template (kind=${kind})`,
    })
    return workflow
  }

  /** 流程进度（首页卡片进度条）：已完成阶段数 / 总阶段数。 */
  async progressOf(bookId: string): Promise<{ done: number; total: number }> {
    const book = await this.store.loadBook(bookId)
    const order = await this.phaseOrder(bookId)
    return progressOfPhases(book.phases, order)
  }

  /** 项目类型（缺省 course；供路由层回填类型名）。 */
  async kindOf(bookId: string): Promise<string> {
    return (await this.store.loadBook(bookId)).kind ?? DEFAULT_KIND_ID
  }

  // ── 工作流阶段编辑（P6 Agent 侧；纯函数见 workflow/schema.ts） ──

  /** 新增阶段（index 缺省追加末尾；gate 缺省 manual）。返回保存后的工作流。 */
  async addWorkflowPhase(bookId: string, input: { name: string; index?: number; id?: string; gate?: PhaseGate }): Promise<Workflow> {
    const current = await this.workflowOf(bookId)
    const index = typeof input.index === 'number' && Number.isFinite(input.index) ? input.index : current.phases.length
    const phase: WorkflowPhase = {
      ...createPhase(current, String(input.name ?? ''), String(input.id ?? input.name ?? 'phase')),
      ...(input.gate !== undefined ? { gate: input.gate } : {}),
    }
    const next = insertPhase(current, phase, index)
    if (!next.ok) throw next.error
    return await this.saveWorkflow(bookId, next.value)
  }

  /** 拖拽排序：把 from 位置的阶段移动到 to 位置。 */
  async reorderWorkflowPhases(bookId: string, from: number, to: number): Promise<Workflow> {
    const current = await this.workflowOf(bookId)
    const next = reorderPhase(current, from, to)
    if (!next.ok) throw next.error
    return await this.saveWorkflow(bookId, next.value)
  }

  /** 重命名阶段。 */
  async renameWorkflowPhase(bookId: string, phaseId: string, name: string): Promise<Workflow> {
    const current = await this.workflowOf(bookId)
    const next = renamePhase(current, phaseId, name)
    if (!next.ok) throw next.error
    return await this.saveWorkflow(bookId, next.value)
  }

  /** 局部更新阶段（门禁/描述/产物/提示词/评审标准/可跳过/名称）。 */
  async updateWorkflowPhase(bookId: string, phaseId: string, patch: WorkflowPhasePatch): Promise<Workflow> {
    const current = await this.workflowOf(bookId)
    const next = updatePhase(current, phaseId, patch)
    if (!next.ok) throw next.error
    return await this.saveWorkflow(bookId, next.value)
  }

  /** 删除阶段（最后一个阶段拒绝删除）。 */
  async removeWorkflowPhase(bookId: string, phaseId: string): Promise<Workflow> {
    const current = await this.workflowOf(bookId)
    const next = removePhase(current, phaseId)
    if (!next.ok) throw next.error
    return await this.saveWorkflow(bookId, next.value)
  }

  /** 项目目录（向导状态等辅助文件落点）。 */
  projectDir(bookId: string): string {
    return this.store.getBookDir(bookId)
  }

  async load(bookId: string): Promise<Book> {
    return await this.store.loadBook(bookId)
  }

  // ── 流程 ──

  /** 合并 workflow 返回的 PhaseLedger 到完整 Book（防止 ledger 残缺对象覆写 book.json）。 */
  private mergeLedger(book: Book, ledger: PhaseLedger, now: string): Book {
    return {
      ...book,
      phases: ledger.phases,
      currentPhase: ledger.currentPhase,
      updatedAt: now,
    }
  }

  /** 进入阶段（按项目工作流顺序做门禁检查；审计 enter）。 */
  async enterPhase(bookId: string, phaseId: PhaseId, actor: AuditEvent['actor'] = 'agent'): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    const ctx = await this.engineContext(bookId)
    const now = new Date().toISOString()
    const result = enter(book, phaseId, now, actor, ctx)
    if (!result.ok) throw result.error
    await this.store.appendAudit(bookId, result.value.event)
    await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now))
    return await this.store.loadBook(bookId)
  }

  /** 提交阶段产物：写 docs/<phase>.md + 版本快照 → 状态机 submit → 审计。 */
  async commitPhase(bookId: string, phaseId: PhaseId, artifact: string, report: PhaseReport, actor: AuditEvent['actor'] = 'agent'): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    const now = new Date().toISOString()
    const result = submit(book, phaseId, report, now, actor)
    if (!result.ok) throw result.error
    await this.store.writeArtifact(bookId, phaseId, artifact)
    await this.store.appendAudit(bookId, result.value.event)
    await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now))
    return await this.store.loadBook(bookId)
  }

  /** 用户覆盖：force（放行）/ reopen（驳回）/ skip（跳过）/ rollback（回退）。 */
  async overridePhase(bookId: string, phaseId: PhaseId, action: 'force' | 'reopen' | 'skip' | 'rollback', actor: AuditEvent['actor'] = 'user'): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    const ctx = await this.engineContext(bookId)
    const now = new Date().toISOString()
    const result = action === 'force'
      ? forceApprove(book, phaseId, now, actor)
      : action === 'reopen'
        ? reopen(book, phaseId, now, actor)
        : action === 'skip'
          ? skip(book, phaseId, now, actor)
          : rollback(book, phaseId, now, actor, ctx)
    if (!result.ok) throw result.error
    await this.store.appendAudit(bookId, result.value.event)
    await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now))
    return await this.store.loadBook(bookId)
  }

  audit(bookId: string): Promise<AuditEvent[]> {
    return this.store.readAudit(bookId)
  }

  // ── 课时 ──

  /** 上下文包组装（写教案指令数据源）。 */
  async assemble(bookId: string, chapterNo: number, chapterBrief?: string): Promise<ContextPacket> {
    const book = await this.store.loadBook(bookId)
    return await this.assembler.assemble({ book, chapterNo, chapterBrief })
  }

  /**
   * 保存课时讲义：字数统计 → 落盘（frontmatter 带统计）→ Book.stats 增量 →
   * 变量 JSONPatch 提取应用 → 审计。返回落盘课时。
   */
  async saveChapter(bookId: string, chapterNo: number, title: string, text: string, brief?: string): Promise<Chapter> {
    const book = await this.store.loadBook(bookId)
    const now = new Date().toISOString()
    const raw = countChapter(text, chapterNo)
    const stats = checkWordTarget(raw, book.config.wordTargets.perChapterMin, book.config.wordTargets.perChapterMax)
    const previous = await this.store.readChapter(bookId, chapterNo)
    const previousWords = previous?.chapter.words ?? 0
    const chapter: Chapter = {
      no: chapterNo,
      title,
      status: 'draft',
      version: (previous?.chapter.version ?? 0) + 1,
      words: stats.totalChars,
      ...(brief !== undefined ? { brief } : {}),
      createdAt: previous?.chapter.createdAt ?? now,
      updatedAt: now,
    }
    await this.store.writeChapter(bookId, chapter, text)
    // Book.stats 增量（覆盖写入场景：减去旧字数再加新字数）
    const nextBook: Book = {
      ...book,
      stats: {
        totalWords: Math.max(0, book.stats.totalWords - previousWords + stats.totalChars),
        chapterCount: Math.max(book.stats.chapterCount, previous ? book.stats.chapterCount : book.stats.chapterCount + 1),
        lastWriteAt: now,
      },
      updatedAt: now,
    }
    await this.store.saveBook(nextBook)
    // 变量 JSONPatch 增量
    await this.variables.applyChapterPatch(bookId, chapterNo, text)
    // 账本增量（一致性引擎数据源；按项目目录）
    const { LedgerStore, ledgerFilePath } = await import('../consistency/store.ts')
    await new LedgerStore(ledgerFilePath(this.store.getBookDir(bookId))).applyChapterPatch(bookId, chapterNo, text)
    await this.store.appendAudit(bookId, {
      at: now,
      action: 'submit',
      phase: 'writing',
      actor: 'agent',
      detail: `chapter ${chapterNo} saved (${stats.totalChars} chars, ${stats.meetsTarget ? 'meets' : 'below'} target)`,
    })
    return chapter
  }

  /** 课时统计（含达标判定）。 */
  async chapterStats(bookId: string, chapterNo: number): Promise<{ words: number; meetsTarget: boolean } | undefined> {
    const book = await this.store.loadBook(bookId)
    const chapter = await this.store.readChapter(bookId, chapterNo)
    if (!chapter) return undefined
    const stats = checkWordTarget(countChapter(chapter.content, chapterNo), book.config.wordTargets.perChapterMin, book.config.wordTargets.perChapterMax)
    return { words: stats.totalChars, meetsTarget: stats.meetsTarget }
  }

  /** 课时讲义（质量/校验工具用）。 */
  async chapterText(bookId: string, chapterNo: number): Promise<string> {
    return await this.store.readChapterContent(bookId, chapterNo)
  }

  /** 课时元数据 + 讲义。 */
  async chapterWithText(bookId: string, chapterNo: number): Promise<{ chapter: Chapter; content: string } | undefined> {
    return await this.store.readChapter(bookId, chapterNo)
  }

  /** 全部课时（导出用，按序；稀疏编号也正确）。 */
  async allChapters(bookId: string): Promise<Array<{ chapter: Chapter; content: string }>> {
    const numbers = await this.store.listChapterNumbers(bookId)
    const items: Array<{ chapter: Chapter; content: string }> = []
    for (const no of numbers) {
      const chapter = await this.store.readChapter(bookId, no)
      if (chapter) items.push(chapter)
    }
    return items
  }

  /**
   * 删除课时：移除讲义文件 → 修正 Book 统计 → 清除该课时账本事实与变量游标 → 审计。
   * 删除后**不做重编号**（保留稀疏编号），避免外部引用（分享链接、账本、AI 上下文）失效。
   */
  async deleteChapter(bookId: string, chapterNo: number): Promise<{ deleted: boolean; words: number }> {
    const book = await this.store.loadBook(bookId)
    const removed = await this.store.readChapter(bookId, chapterNo)
    const deleted = await this.store.deleteChapterFile(bookId, chapterNo)
    if (!deleted) return { deleted: false, words: 0 }
    const words = removed?.chapter.words ?? 0
    const now = new Date().toISOString()
    await this.store.saveBook({
      ...book,
      stats: {
        totalWords: Math.max(0, book.stats.totalWords - words),
        chapterCount: Math.max(0, book.stats.chapterCount - 1),
        lastWriteAt: now,
      },
      updatedAt: now,
    })
    // 账本：清除该课时产生的事实条目（否则一致性巡检会读到幽灵数据）
    const { LedgerStore, ledgerFilePath } = await import('../consistency/store.ts')
    await new LedgerStore(ledgerFilePath(this.store.getBookDir(bookId))).dropChapter(chapterNo)
    // 变量：清理扫描游标
    await this.variables.dropChapter(bookId, chapterNo)
    await this.store.appendAudit(bookId, {
      at: now,
      action: 'delete',
      phase: 'writing',
      actor: 'user',
      detail: `chapter ${chapterNo} deleted (${words} chars)`,
    })
    return { deleted: true, words }
  }

  /**
   * 拖拽排序：order 为当前课时号按新顺序的排列，落盘后统一重编号为 1..N。
   * 同步修正账本课时号、按新顺序重建局部变量、写审计。
   * @returns 重排后的课时清单（no/title/words）。
   */
  async reorderChapters(bookId: string, order: number[]): Promise<Array<{ no: number; title: string; words: number }>> {
    const mapping = await this.store.reorderChapters(bookId, order)
    const chapters = await this.allChapters(bookId)
    if (mapping.some(({ from, to }) => from !== to)) {
      const book = await this.store.loadBook(bookId)
      const now = new Date().toISOString()
      await this.store.saveBook({ ...book, stats: { ...book.stats, lastWriteAt: now }, updatedAt: now })
      // 账本：课时号随重排重映射（ch3 → ch1），保持事实归属正确
      const { LedgerStore, ledgerFilePath } = await import('../consistency/store.ts')
      const remap = new Map(mapping.map(({ from, to }) => [from, to]))
      await new LedgerStore(ledgerFilePath(this.store.getBookDir(bookId))).remapChapterNumbers(remap)
      // 变量：局部变量按课时顺序累积，重排后必须按新顺序重放
      await this.variables.rebuildBook(bookId, chapters.map(({ chapter, content }) => ({ no: chapter.no, text: content })))
      await this.store.appendAudit(bookId, {
        at: now,
        action: 'reorder',
        phase: 'writing',
        actor: 'user',
        detail: `chapters reordered (${mapping.filter(({ from, to }) => from !== to).length}/${mapping.length} moved)`,
      })
    }
    return chapters.map(({ chapter }) => ({ no: chapter.no, title: chapter.title, words: chapter.words }))
  }

  /** 重命名课程（同步更新 book.title 与 config.title）。 */
  async renameProject(bookId: string, title: string): Promise<Book> {
    const trimmed = String(title).trim()
    if (!trimmed) throw new Error('课程名不能为空')
    const book = await this.store.loadBook(bookId)
    book.title = trimmed
    book.config = { ...book.config, title: trimmed }
    await this.store.saveBook(book)
    return book
  }

  /** 删除项目（keepChapters=true 保留讲义目录）。 */
  async deleteProject(bookId: string, keepChapters: boolean): Promise<{ deleted: boolean; keptChapters: boolean }> {
    return await this.store.deleteProject(bookId, keepChapters)
  }

  /** 导出成稿（txt/markdown/platform/word），返回文件名与内容（GUI 直接下载）。 */
  async exportProject(bookId: string, format: 'txt' | 'markdown' | 'platform' | 'word'): Promise<{ fileName: string; content: string; base64?: boolean; mime?: string }> {
    const book = await this.store.loadBook(bookId)
    const chapters = await this.allChapters(bookId)
    const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, '_')
    if (format === 'word') {
      const { buildDocx } = await import('../export/docx.ts')
      const buf = buildDocx(book.title, chapters.map((c) => ({ no: c.chapter.no, title: c.chapter.title, content: c.content })))
      return { fileName: `${safeTitle}.docx`, content: buf.toString('base64'), base64: true, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    }
    const { exportBook } = await import('../export/engine.ts')
    const content = exportBook(chapters, {
      format,
      title: book.title,
      author: book.config.author,
      splitVolumes: format === 'platform',
    })
    const ext = format === 'markdown' ? 'md' : 'txt'
    return { fileName: `${safeTitle}.${ext}`, content }
  }

  // ── 分享协作 ──

  private shareFilePath(): string {
    return join(dirname(this.store.baseDir), 'shares.json')
  }

  private async readShares(): Promise<Record<string, ShareEntry>> {
    const raw = await readOptional(this.shareFilePath())
    if (!raw) return {}
    try { return JSON.parse(raw) as Record<string, ShareEntry> } catch { return {} }
  }

  /** 生成分享（read=只读查看 / write=可编辑协作），token 持久化到 shares.json。 */
  async createShare(bookId: string, mode: 'read' | 'write'): Promise<ShareEntry> {
    const shares = await this.readShares()
    const token = randomBytes(18).toString('base64url')
    const entry: ShareEntry = { token, projectId: bookId, mode, createdAt: new Date().toISOString() }
    shares[token] = entry
    await atomicWriteFile(this.shareFilePath(), JSON.stringify(shares, null, 2))
    return entry
  }

  /** 撤销单个分享。 */
  async revokeShare(token: string): Promise<boolean> {
    const shares = await this.readShares()
    if (!shares[token]) return false
    delete shares[token]
    await atomicWriteFile(this.shareFilePath(), JSON.stringify(shares, null, 2))
    return true
  }

  /** 某课程的全部分享。 */
  async listShares(bookId: string): Promise<ShareEntry[]> {
    const shares = await this.readShares()
    return Object.values(shares).filter((s) => s.projectId === bookId)
  }

  /** 按 token 取分享（不存在返回 null）。 */
  async getShare(token: string): Promise<ShareEntry | null> {
    const shares = await this.readShares()
    return shares[token] ?? null
  }

  // ── 协作版本记录 ──

  /** 追加一条协作写回历史（jsonl，按项目目录）。 */
  async recordCollaboration(bookId: string, entry: { token: string; chapterNo: number; baseVersion: number | null; newVersion: number }): Promise<void> {
    await appendLine(join(this.store.getBookDir(bookId), 'collab-history.jsonl'), JSON.stringify({ ...entry, at: new Date().toISOString() }))
  }

  /** 读取某课程的协作历史（新→旧）。 */
  async listCollaboration(bookId: string): Promise<Array<{ token: string; chapterNo: number; baseVersion: number | null; newVersion: number; at: string }>> {
    const raw = await readOptional(join(this.store.getBookDir(bookId), 'collab-history.jsonl'))
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as { token: string; chapterNo: number; baseVersion: number | null; newVersion: number; at: string } } catch { return null } }).filter((x): x is { token: string; chapterNo: number; baseVersion: number | null; newVersion: number; at: string } => x !== null).reverse()
  }
}

export interface ShareEntry {
  token: string
  projectId: string
  mode: 'read' | 'write'
  createdAt: string
}
