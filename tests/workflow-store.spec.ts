import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NovelStore } from '../src/core/novel/index.ts'
import { instantiateWorkflow, phaseOrderOf, removePhase } from '../src/core/workflow/schema.ts'
import { OFFICIAL_TEMPLATE, THESIS_TEMPLATE, builtinTemplateOf } from '../src/core/workflow/templates.ts'
import type { Workflow } from '../src/core/workflow/index.ts'
import type { PluginError } from '../src/core/index.ts'

const roots: string[] = []

async function freshStore(): Promise<{ store: NovelStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'wfstore-'))
  roots.push(dir)
  return { store: new NovelStore(dir), dir }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function catchError<T>(body: Promise<T>): Promise<PluginError> {
  try {
    await body
  } catch (cause) {
    return cause as PluginError
  }
  throw new Error('expected rejection')
}

/** 手工造一个「旧项目」目录：只有 book.json，没有 workflow.json。 */
async function seedLegacyProject(store: NovelStore, id: string, kind?: string): Promise<void> {
  const dir = join((store as unknown as { baseDir: string }).baseDir, id)
  await mkdir(dir, { recursive: true })
  const book = {
    id,
    title: '旧项目',
    genre: 'general',
    ...(kind !== undefined ? { kind } : {}),
    status: 'drafting',
    config: { title: '旧项目', genre: 'general', wordTargets: { perChapterMin: 2000, perChapterMax: 4000 }, style: { pov: 'third', forbiddenWords: [], aiTasteWords: [] }, phaseGating: true },
    phases: { topic: { id: 'topic', state: 'approved', version: 1 } },
    currentPhase: 'topic',
    stats: { totalWords: 0, chapterCount: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
  }
  await writeFile(join(dir, 'book.json'), `${JSON.stringify({ schemaVersion: 1, data: book }, null, 2)}\n`, 'utf8')
}

describe('NovelStore — workflow.json 生命周期', () => {
  it('新建课程项目：写出项目私有工作流副本 + book.kind', async () => {
    const { store, dir } = await freshStore()
    const book = await store.createBook({ title: '数据结构', genre: 'programming' })
    expect(book.kind).toBe('course')
    const raw = JSON.parse(await readFile(join(dir, book.id, 'workflow.json'), 'utf8')) as Workflow
    expect(raw.id).toBe(`wf_${book.id}`)
    expect(raw.scope).toBe('project')
    expect(raw.templateId).toBe('builtin-course')
    expect(raw.kind).toBe('course')
    // 阶段顺序与内置课程模板一致
    expect(phaseOrderOf(raw)).toEqual(phaseOrderOf(builtinTemplateOf('course')))
    // ledger 按工作流顺序初始化
    expect(Object.keys(book.phases)).toEqual(phaseOrderOf(raw))
    expect(book.currentPhase).toBe('topic')
  })

  it('新建小说项目：用小说模板（9 阶段）而非课程模板', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: '长夜', genre: 'xuanyi', kind: 'novel' })
    const wf = await store.readWorkflow(book.id)
    expect(wf.templateId).toBe('builtin-novel')
    expect(phaseOrderOf(wf)).toEqual(phaseOrderOf(builtinTemplateOf('novel')))
    expect(book.kind).toBe('novel')
  })

  it('新建公文项目：阶段集合与课程完全不同', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: '通知', genre: 'notice', kind: 'official' })
    const order = await store.phaseOrder(book.id)
    expect(order).toEqual(phaseOrderOf(OFFICIAL_TEMPLATE))
    expect(order).not.toContain('topic')
    expect(order).not.toContain('chapter')
  })

  it('phaseOrder 返回项目工作流顺序', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: '论文', genre: 'engineering', kind: 'thesis' })
    expect(await store.phaseOrder(book.id)).toEqual(phaseOrderOf(THESIS_TEMPLATE))
  })

  it('未知类型回退通用模板（不抛错）', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: '自定义', genre: 'x', kind: 'my-kind' })
    const wf = await store.readWorkflow(book.id)
    expect(wf.templateId).toBe('builtin-generic')
    expect(wf.kind).toBe('my-kind')
  })
})

describe('NovelStore — 惰性迁移（旧项目无 workflow.json）', () => {
  it('无 kind 字段的旧项目 → 按 course 模板生成并落盘', async () => {
    const { store, dir } = await freshStore()
    await seedLegacyProject(store, 'bk_legacy')
    const wf = await store.readWorkflow('bk_legacy')
    expect(wf.templateId).toBe('builtin-course')
    expect(wf.kind).toBe('course')
    // 已落盘：二次读取不会重新生成
    const again = await store.readWorkflow('bk_legacy')
    expect(again).toEqual(wf)
    expect(await readFile(join(dir, 'bk_legacy', 'workflow.json'), 'utf8')).toContain('builtin-course')
  })

  it('有 kind 字段的旧项目 → 按该类型模板生成', async () => {
    const { store } = await freshStore()
    await seedLegacyProject(store, 'bk_official', 'official')
    const wf = await store.readWorkflow('bk_official')
    expect(wf.templateId).toBe('builtin-official')
    expect(phaseOrderOf(wf)).toEqual(phaseOrderOf(OFFICIAL_TEMPLATE))
  })

  it('loadBook 为旧项目补 kind=course，并补全缺失阶段', async () => {
    const { store } = await freshStore()
    await seedLegacyProject(store, 'bk_legacy')
    const loaded = await store.loadBook('bk_legacy')
    expect(loaded.kind).toBe('course')
    expect(loaded.phases['setting']?.state).toBe('locked')
    // 已有的 approved 记录不被覆盖
    expect(loaded.phases['topic']?.state).toBe('approved')
  })

  it('列表摘要带 kind（旧项目补 course）', async () => {
    const { store } = await freshStore()
    await seedLegacyProject(store, 'bk_legacy')
    const [summary] = await store.listBooks()
    expect(summary?.kind).toBe('course')
  })

  it('loadBook 按 workflow.json 的顺序补全阶段（含自定义阶段）', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x', kind: 'official' })
    const wf = await store.readWorkflow(book.id)
    const inserted = { ...wf, phases: [...wf.phases, { id: 'publish', name: '印发', gate: 'manual' as const, artifacts: [] }] }
    await store.writeWorkflow(book.id, inserted)
    const loaded = await store.loadBook(book.id)
    expect(loaded.phases['publish']?.state).toBe('locked')
    expect(Object.keys(loaded.phases)).toContain('publish')
  })
})

describe('NovelStore — 工作流写入校验', () => {
  it('保存后可读回相同内容', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x', kind: 'official' })
    const wf = await store.readWorkflow(book.id)
    const trimmed = removePhase(wf, 'review')
    if (!trimmed.ok) throw new Error('removePhase 失败')
    const saved = await store.writeWorkflow(book.id, trimmed.value)
    expect(phaseOrderOf(saved)).not.toContain('review')
    expect(phaseOrderOf(await store.readWorkflow(book.id))).toEqual(phaseOrderOf(trimmed.value))
  })

  it('拒绝结构非法的工作流（空阶段列表 / 非法门禁）', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    const empty = await catchError(store.writeWorkflow(book.id, { ...instantiateWorkflow(builtinTemplateOf('course'), { id: 'wf_x' }), phases: [] }))
    expect(empty.code).toBe('INVALID_FIELD_TYPE')
    expect(empty.message).toContain('至少需要一个阶段')

    const badGate = await catchError(store.writeWorkflow(book.id, {
      ...instantiateWorkflow(builtinTemplateOf('course'), { id: 'wf_x' }),
      phases: [{ id: 'a', name: 'A', gate: 'nope', artifacts: [] }],
    } as unknown as Workflow))
    expect(badGate.code).toBe('INVALID_FIELD_TYPE')
    expect(badGate.message).toContain('门禁类型非法')
  })

  it('重复阶段 id 拒绝落盘', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    const error = await catchError(store.writeWorkflow(book.id, {
      ...instantiateWorkflow(builtinTemplateOf('course'), { id: 'wf_x' }),
      phases: [
        { id: 'a', name: 'A', gate: 'manual', artifacts: [] },
        { id: 'a', name: 'A2', gate: 'manual', artifacts: [] },
      ],
    }))
    expect(error.code).toBe('INVALID_FIELD_TYPE')
    expect(error.message).toContain('阶段 id 重复')
  })

  it('workflow.json 损坏时 readWorkflow 报错，但 loadBook 仍可列出（宽容/严格分工）', async () => {
    const { store, dir } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await writeFile(join(dir, book.id, 'workflow.json'), '{ broken', 'utf8')
    const strict = await catchError(store.readWorkflow(book.id))
    expect(strict.code).toBe('INVALID_FIELD_TYPE')
    expect(strict.message).toContain('非法 JSON')
    // 宽容路径：项目仍可从列表加载（回退默认九阶段补全）
    const loaded = await store.loadBook(book.id)
    expect(loaded.phases['topic']).toBeDefined()
    const [summary] = await store.listBooks()
    expect(summary?.id).toBe(book.id)
  })

  it('删除项目（保留讲义）时 workflow.json 一并移除', async () => {
    const { store, dir } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await store.readWorkflow(book.id)
    await store.deleteProject(book.id, true)
    const gone = await readFile(join(dir, book.id, 'workflow.json'), 'utf8').catch(() => undefined)
    expect(gone).toBeUndefined()
  })
})
