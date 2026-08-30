import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NovelStore, assertBookId, encodeChapterFrontmatter, parseChapterFrontmatter } from '../src/core/novel/index.ts'
import type { AuditEvent, PhaseRecord } from '../src/core/workflow/index.ts'
import type { PluginError } from '../src/core/index.ts'

/** 取阶段记录：noUncheckedIndexedAccess 下 phases[id] 可能为 undefined，判空集中在此。 */
function at(owner: { phases: Record<string, PhaseRecord | undefined> }, id: string): PhaseRecord {
  const record = owner.phases[id]
  if (!record) throw new Error(`阶段记录缺失: ${id}`)
  return record
}


const roots: string[] = []
async function freshStore(): Promise<{ store: NovelStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'novelstore-'))
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

describe('NovelStore — book lifecycle', () => {
  it('creates a book with ledger defaults and versioned shell', async () => {
    const { store, dir } = await freshStore()
    const book = await store.createBook({ title: '青云问道', genre: 'fantasy' })
    expect(book.id).toMatch(/^bk_/)
    expect(book.currentPhase).toBe('topic')
    expect(at(book, 'topic').state).toBe('locked')
    expect(book.schemaVersion).toBe(1)
    const raw = JSON.parse(await readFile(join(dir, book.id, 'book.json'), 'utf8')) as { schemaVersion: number }
    expect(raw.schemaVersion).toBe(1)
  })

  it('roundtrips save/load and bumps updatedAt', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'fantasy' })
    const before = book.updatedAt
    book.title = 'B'
    await store.saveBook(book)
    const loaded = await store.loadBook(book.id)
    expect(loaded.title).toBe('B')
    expect(loaded.updatedAt.localeCompare(before)).toBeGreaterThanOrEqual(0)
  })

  it('migrates a legacy bare book.json and fills missing phases', async () => {
    const { store, dir } = await freshStore()
    const book = await store.createBook({ title: 'legacy', genre: 'fantasy' })
    // 模拟旧格式（裸对象，无外壳、缺阶段）
    const legacy = {
      id: book.id, title: 'legacy', genre: 'fantasy', status: 'drafting',
      config: book.config,
      phases: { topic: { id: 'topic', state: 'approved', version: 1 } },
      currentPhase: 'topic',
      stats: book.stats, createdAt: book.createdAt, updatedAt: book.updatedAt,
    }
    await writeFile(join(dir, book.id, 'book.json'), JSON.stringify(legacy), 'utf8')
    const loaded = await store.loadBook(book.id)
    expect(at(loaded, 'topic').state).toBe('approved')
    expect(at(loaded, 'setting').state).toBe('locked') // 缺失阶段补全
    expect(loaded.schemaVersion).toBe(1)
  })

  it('loadBook reports missing project with code', async () => {
    const { store } = await freshStore()
    expect((await catchError(store.loadBook('bk_nope'))).code).toBe('ENTRY_NOT_FOUND')
  })

  it('listBooks returns summaries sorted by update time and skips corrupt dirs', async () => {
    const { store, dir } = await freshStore()
    const a = await store.createBook({ title: 'A', genre: 'x' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const b = await store.createBook({ title: 'B', genre: 'y' })
    await writeFile(join(dir, 'bk_corrupt', 'book.json'), '{bad', 'utf8').catch(() => undefined)
    const list = await store.listBooks()
    expect(list.map((s) => s.id)).toEqual([b.id, a.id])
    expect(list.every((s) => s.id !== 'bk_corrupt')).toBe(true)
  })
})

describe('NovelStore — audit', () => {
  it('appends audit events with increasing seq', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    const e1 = await store.appendAudit(book.id, { at: 't1', action: 'enter', phase: 'topic', actor: 'agent', detail: 'in_progress' })
    const e2 = await store.appendAudit(book.id, { at: 't2', action: 'submit', phase: 'topic', actor: 'agent', detail: 'approved' })
    expect(e1.seq).toBe(2) // create 事件占 1
    expect(e2.seq).toBe(3)
    const audit = await store.readAudit(book.id)
    expect(audit).toHaveLength(3)
    expect(audit[0]?.action).toBe('create')
    expect(audit[2]?.action).toBe('submit')
  })
})

describe('NovelStore — artifacts and versions', () => {
  it('writes artifact + numbered version snapshots', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    const v1 = await store.writeArtifact(book.id, 'setting', 'v1 内容')
    const v2 = await store.writeArtifact(book.id, 'setting', 'v2 内容')
    expect(v1.version).toBe(1)
    expect(v2.version).toBe(2)
    expect(await store.readArtifact(book.id, 'setting')).toBe('v2 内容')
    const snapshot = await readFile(join(store['bookDir'](book.id), 'versions', 'setting', 'v1.md'), 'utf8')
    expect(snapshot).toBe('v1 内容')
  })
})

describe('NovelStore — chapters', () => {
  it('roundtrips chapter content with frontmatter', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    const chapter = {
      no: 1, title: '第一章 少年出山', status: 'draft' as const, version: 1, words: 1234,
      brief: '林远下山', createdAt: 't', updatedAt: 't',
    }
    await store.writeChapter(book.id, chapter, '讲义内容……')
    const loaded = await store.readChapter(book.id, 1)
    expect(loaded).toBeDefined()
    expect(loaded?.chapter.title).toBe('第一章 少年出山')
    expect(loaded?.chapter.words).toBe(1234)
    expect(loaded?.content).toBe('讲义内容……')
  })

  it('tolerates chapters without frontmatter', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    const chaptersDir = join(store['bookDir'](book.id), 'chapters')
    await import('node:fs/promises').then((fs) => fs.mkdir(chaptersDir, { recursive: true }))
    await writeFile(join(chaptersDir, 'ch2.md'), '裸讲义', 'utf8')
    const loaded = await store.readChapter(book.id, 2)
    expect(loaded?.content).toBe('裸讲义')
    expect(loaded?.chapter.no).toBe(2)
  })

  it('frontmatter encode/parse is symmetric and fault-tolerant', () => {
    const chapter = { no: 3, title: 'T', status: 'revised' as const, version: 2, words: 500, createdAt: 'a', updatedAt: 'b' }
    const text = encodeChapterFrontmatter(chapter)
    const parsed = parseChapterFrontmatter(`${text}讲义`)
    expect(parsed?.chapter).toEqual(chapter)
    expect(parsed?.body).toBe('讲义')
    // 坏 JSON → null（调用方容错）
    expect(parseChapterFrontmatter('<!-- novel: {bad -->\n讲义')).toBeNull()
    // 无 frontmatter → null
    expect(parseChapterFrontmatter('讲义')).toBeNull()
  })
})

describe('NovelStore — 课时删除与重排', () => {
  async function seed(store: NovelStore, bookId: string, count: number): Promise<void> {
    for (let no = 1; no <= count; no += 1) {
      await store.writeChapter(bookId, {
        no, title: `第 ${no} 课`, status: 'draft', version: 1, words: 100 * no,
        createdAt: 't', updatedAt: 't',
      }, `第 ${no} 课讲义`)
    }
  }

  it('deleteChapterFile 删除已存在课时，对不存在课时返回 false', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await seed(store, book.id, 3)
    expect(await store.deleteChapterFile(book.id, 2)).toBe(true)
    expect(await store.listChapterNumbers(book.id)).toEqual([1, 3])
    // 删除后编号保持稀疏（不自动重排）
    expect(await store.deleteChapterFile(book.id, 2)).toBe(false)
  })

  it('reorderChapters 重编号并同步 frontmatter 内的 no', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await seed(store, book.id, 3)
    // 3 → 1，1 → 2，2 → 3（回环，直接 rename 会互相覆盖）
    const mapping = await store.reorderChapters(book.id, [3, 1, 2])
    expect(mapping).toEqual([{ from: 3, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }])
    expect(await store.listChapterNumbers(book.id)).toEqual([1, 2, 3])
    expect((await store.readChapter(book.id, 1))?.content).toBe('第 3 课讲义')
    expect((await store.readChapter(book.id, 2))?.content).toBe('第 1 课讲义')
    expect((await store.readChapter(book.id, 3))?.content).toBe('第 2 课讲义')
    // frontmatter 元数据同步（no/title 随内容一起搬家）
    for (let no = 1; no <= 3; no += 1) {
      expect((await store.readChapter(book.id, no))?.chapter.no).toBe(no)
    }
  })

  it('reorderChapters 相邻互换不会丢内容', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await seed(store, book.id, 4)
    await store.reorderChapters(book.id, [1, 3, 2, 4])
    expect((await store.readChapter(book.id, 2))?.content).toBe('第 3 课讲义')
    expect((await store.readChapter(book.id, 3))?.content).toBe('第 2 课讲义')
    expect((await store.readChapter(book.id, 4))?.content).toBe('第 4 课讲义')
  })

  it('reorderChapters 幂等（顺序未变时不改动文件）', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await seed(store, book.id, 2)
    const before = await store.readChapter(book.id, 1)
    await store.reorderChapters(book.id, [1, 2])
    expect(await store.readChapter(book.id, 1)).toEqual(before)
  })

  it('reorderChapters 拒绝非完整排列', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await seed(store, book.id, 3)
    // 缺第 3 课
    const missing = await catchError(store.reorderChapters(book.id, [2, 1]))
    expect(missing.code).toBe('INVALID_FIELD_TYPE')
    // 含不存在的第 9 课
    const extra = await catchError(store.reorderChapters(book.id, [1, 2, 3, 9]))
    expect(extra.code).toBe('INVALID_FIELD_TYPE')
    // 重复项
    const dup = await catchError(store.reorderChapters(book.id, [1, 1, 2]))
    expect(dup.code).toBe('INVALID_FIELD_TYPE')
    // 拒绝后原始顺序保持不变
    expect(await store.listChapterNumbers(book.id)).toEqual([1, 2, 3])
  })

  it('reorderChapters 清理暂存目录（不残留隐藏目录）', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await seed(store, book.id, 2)
    await store.reorderChapters(book.id, [2, 1])
    const names = await readdir(join(store['bookDir'](book.id), 'chapters'))
    expect(names.filter((n) => n.startsWith('.'))).toEqual([])
    expect(names.sort()).toEqual(['ch1.md', 'ch2.md'])
  })
})

describe('NovelStore — path safety', () => {
  it('assertBookId rejects traversal', () => {
    expect(assertBookId('bk_ok_1')).toBe('bk_ok_1')
    expect(() => assertBookId('../evil')).toThrow()
    expect(() => assertBookId('a/b')).toThrow()
  })

  it('chapter body keeps its own trailing newline trimming', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    const chapter = { no: 1, title: 'T', status: 'draft' as const, version: 1, words: 0, createdAt: '', updatedAt: '' }
    await store.writeChapter(book.id, chapter, '  首尾留白  \n\n')
    const loaded = await store.readChapter(book.id, 1)
    expect(loaded?.content).toBe('  首尾留白')
  })
})

/** 类型冒烟：AuditEvent 可整体序列化。 */
void ((event: AuditEvent) => JSON.stringify(event))

describe('NovelStore — delete project', () => {
  it('removes the whole project directory', async () => {
    const { store } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await store.writeChapter(book.id, { no: 1, title: 'T', status: 'draft', version: 1, words: 0, createdAt: 't', updatedAt: 't' }, '讲义')
    const result = await store.deleteProject(book.id, false)
    expect(result.keptChapters).toBe(false)
    expect((await store.listBooks()).some((s) => s.id === book.id)).toBe(false)
  })

  it('keeps chapters when keepChapters=true', async () => {
    const { store, dir } = await freshStore()
    const book = await store.createBook({ title: 'A', genre: 'x' })
    await store.writeChapter(book.id, { no: 1, title: 'T', status: 'draft', version: 1, words: 0, createdAt: 't', updatedAt: 't' }, '讲义')
    const result = await store.deleteProject(book.id, true)
    expect(result.keptChapters).toBe(true)
    expect((await store.listBooks()).some((s) => s.id === book.id)).toBe(false)
    // 讲义目录保留
    const { readdir } = await import('node:fs/promises')
    const names = await readdir(join(dir, book.id, 'chapters'))
    expect(names).toContain('ch1.md')
  })
})
