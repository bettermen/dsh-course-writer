import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NovelService, NovelStore } from '../src/core/novel/index.ts'
import { LoreStore } from '../src/core/lorebook/index.ts'
import { VariableStoreFile, variablesFilePath } from '../src/core/variables/index.ts'
import type { PluginError } from '../src/core/index.ts'
import type { PhaseRecord } from '../src/core/workflow/index.ts'

/** 取阶段记录：noUncheckedIndexedAccess 下 phases[id] 可能为 undefined，判空集中在此。 */
function at(owner: { phases: Record<string, PhaseRecord | undefined> }, id: string): PhaseRecord {
  const record = owner.phases[id]
  if (!record) throw new Error(`阶段记录缺失: ${id}`)
  return record
}


const roots: string[] = []
async function freshService(): Promise<{ service: NovelService; store: NovelStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'novelsvc-'))
  roots.push(dir)
  const store = new NovelStore(join(dir, 'projects'))
  const loreStore = new LoreStore(join(dir, 'lorebook'))
  const variables = new VariableStoreFile(variablesFilePath(join(dir, 'vars')))
  const service = new NovelService({ store, loreStore, variables })
  return { service, store }
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

describe('NovelService — project and phases', () => {
  it('creates a project and walks the phase gate', async () => {
    const { service } = await freshService()
    const book = await service.createProject('青云问道', 'fantasy')
    // 未批准 topic 不能进 setting
    expect((await catchError(service.enterPhase(book.id, 'setting'))).code).toBe('INVALID_STATE')
    await service.enterPhase(book.id, 'topic')
    const after = await service.commitPhase(book.id, 'topic', '选题报告', { passed: true, errorCount: 0, warningCount: 0 })
    expect(at(after, 'topic').state).toBe('approved')
    // 回归（C1）：阶段流转不得丢 book 字段（曾把 PhaseLedger 残缺对象整存覆盖 book.json）
    expect(after.title).toBe('青云问道')
    expect(after.genre).toBe('fantasy')
    expect(after.config.wordTargets.perChapterMin).toBe(2000)
    expect(after.stats).toMatchObject({ totalWords: 0, chapterCount: 0 })
    expect(after.schemaVersion).toBeDefined()
    const reloaded = await service.load(book.id)
    expect(reloaded.title).toBe('青云问道')
    expect(reloaded.config.title).toBe('青云问道')
    expect(at(reloaded, 'topic').state).toBe('approved')
    // 现在可以进 setting
    await service.enterPhase(book.id, 'setting')
    const setting = await service.commitPhase(book.id, 'setting', '设定文档', { passed: true, errorCount: 0, warningCount: 0 })
    expect(at(setting, 'setting').state).toBe('approved')
    expect(setting.currentPhase).toBe('setting')
    expect(setting.title).toBe('青云问道')
    expect(setting.config.title).toBe('青云问道')
  })

  it('parks in review when the report has errors, then force-approves', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.enterPhase(book.id, 'topic')
    const review = await service.commitPhase(book.id, 'topic', '有问题的产物', { passed: false, errorCount: 2, warningCount: 1 })
    expect(at(review, 'topic').state).toBe('review')
    const forced = await service.overridePhase(book.id, 'topic', 'force')
    expect(at(forced, 'topic').state).toBe('approved')
  })

  it('records audit events for every operation', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.enterPhase(book.id, 'topic')
    await service.commitPhase(book.id, 'topic', 'x', { passed: true, errorCount: 0, warningCount: 0 })
    const audit = await service.audit(book.id)
    expect(audit.map((e) => e.action)).toEqual(['create', 'enter', 'submit'])
    expect(audit[2]?.phase).toBe('topic')
    expect(audit[2]?.seq).toBe(3)
  })

  it('writes artifact versions on commit', async () => {
    const { service, store } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.enterPhase(book.id, 'topic')
    await service.commitPhase(book.id, 'topic', 'v1 选题', { passed: true, errorCount: 0, warningCount: 0 })
    expect(await store.readArtifact(book.id, 'topic')).toBe('v1 选题')
  })
})

describe('NovelService — chapters', () => {
  it('saves a chapter with stats, updates book stats and audit', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    const chapter = await service.saveChapter(book.id, 1, '第一章', '一二三四五')
    expect(chapter.words).toBe(5)
    expect(chapter.version).toBe(1)
    const reloaded = await service.load(book.id)
    expect(reloaded.stats.totalWords).toBe(5)
    expect(reloaded.stats.chapterCount).toBe(1)
    expect(reloaded.stats.lastWriteAt).toBeDefined()
    // 覆盖写入：字数增量正确
    await service.saveChapter(book.id, 1, '第一章', '一二三四五六七八九十')
    const reloaded2 = await service.load(book.id)
    expect(reloaded2.stats.totalWords).toBe(10)
    expect(reloaded2.stats.chapterCount).toBe(1)
  })

  it('reports chapter stats with target compliance', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一章', '字'.repeat(2500))
    const stats = await service.chapterStats(book.id, 1)
    expect(stats?.words).toBe(2500)
    expect(stats?.meetsTarget).toBe(true)
    const short = await service.saveChapter(book.id, 2, '第二章', '短')
    expect(short.words).toBe(1)
    const stats2 = await service.chapterStats(book.id, 2)
    expect(stats2?.meetsTarget).toBe(false)
  })

  it('applies variable JSON patches from chapter text', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    const text = '讲义……<JSONPatch>[{"op":"replace","path":"/stat_data/境界","value":"筑基"}]</JSONPatch>'
    await service.saveChapter(book.id, 1, '第一章', text)
    const stats = await service.chapterStats(book.id, 1)
    expect(stats).toBeDefined()
  })

  it('assembles a context packet for the next chapter', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一章', '林远修行。')
    const packet = await service.assemble(book.id, 2, '第二章教案')
    expect(packet.chapterNo).toBe(2)
    expect(packet.currentBrief).toBe('第二章教案')
    expect(packet.prevChapters.map((c) => c.no)).toEqual([1])
    expect(packet.constraints.length).toBeGreaterThan(0)
  })
})

describe('NovelService — 课时删除与重排', () => {
  it('deleteChapter 回退统计、清理账本事实并写审计', async () => {
    const { service, store } = await freshService()
    const book = await service.createProject('A', 'x')
    const text = '讲义……<JSONPatch>[{"op":"replace","path":"/stat_data/学员/阶段","value":"入门"}]</JSONPatch>'
    await service.saveChapter(book.id, 1, '第一课', '字'.repeat(100))
    await service.saveChapter(book.id, 2, '第二课', text)
    const before = await service.load(book.id)
    expect(before.stats.chapterCount).toBe(2)

    const result = await service.deleteChapter(book.id, 2)
    expect(result.deleted).toBe(true)
    expect(result.words).toBeGreaterThan(0)

    const after = await service.load(book.id)
    expect(after.stats.chapterCount).toBe(1)
    expect(after.stats.totalWords).toBe(100)

    // 课时文件已移除，剩余课时保持原编号（稀疏）
    expect(await store.listChapterNumbers(book.id)).toEqual([1])

    // 账本：第 2 课产生的事实条目已清除
    const { LedgerStore, ledgerFilePath } = await import('../src/core/consistency/store.ts')
    const ledger = new LedgerStore(ledgerFilePath(store.getBookDir(book.id)))
    expect((await ledger.all()).some((e) => e.chapterNo === 2)).toBe(false)

    // 审计：新增 delete 事件
    const audit = await store.readAudit(book.id)
    const deleted = audit.filter((e) => e.action === 'delete')
    expect(deleted.length).toBe(1)
    expect(deleted[0]?.detail).toContain('chapter 2 deleted')
  })

  it('deleteChapter 对不存在的课时返回 deleted=false', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一课', '内容')
    const result = await service.deleteChapter(book.id, 9)
    expect(result).toEqual({ deleted: false, words: 0 })
    // 统计不受影响
    expect((await service.load(book.id)).stats.chapterCount).toBe(1)
  })

  it('deleteChapter 后新建课时不会撞号（编号稀疏 → 取 max+1）', async () => {
    const { service, store } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一课', '一')
    await service.saveChapter(book.id, 2, '第二课', '二')
    await service.saveChapter(book.id, 3, '第三课', '三')
    await service.deleteChapter(book.id, 2)
    // 剩余 1、3 → 下一课必须是 4，不能用 length+1（=3，会覆盖第三课）
    const next = (await store.listChapterNumbers(book.id)).reduce((m, n) => Math.max(m, n), 0) + 1
    expect(next).toBe(4)
    await service.saveChapter(book.id, next, '第四课', '四')
    expect((await store.readChapter(book.id, 3))?.content).toBe('三')
  })

  it('reorderChapters 重排内容并同步账本课时号', async () => {
    const { service, store } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一课', 'A'.repeat(30))
    await service.saveChapter(book.id, 2, '第二课', 'B'.repeat(30))
    await service.saveChapter(book.id, 3, '第三课', '正文<JSONPatch>[{"op":"replace","path":"/stat_data/学员/阶段","value":"进阶"}]</JSONPatch>')

    const list = await service.reorderChapters(book.id, [3, 1, 2])
    expect(list.map((c) => c.no)).toEqual([1, 2, 3])
    expect(list.map((c) => c.title)).toEqual(['第三课', '第一课', '第二课'])

    // 内容随课时搬家
    expect((await service.chapterText(book.id, 1)).startsWith('正文')).toBe(true)
    expect((await service.chapterText(book.id, 2)).startsWith('AAAA')).toBe(true)
    expect((await service.chapterText(book.id, 3)).startsWith('BBBB')).toBe(true)

    // 账本：事实条目跟着第 3 课一起搬到第 1 课
    const { LedgerStore, ledgerFilePath } = await import('../src/core/consistency/store.ts')
    const entries = await new LedgerStore(ledgerFilePath(store.getBookDir(book.id))).all()
    expect(entries.length).toBe(1)
    expect(entries[0]?.chapterNo).toBe(1)
    expect(entries[0]?.source).toBe('ch1')

    // 审计：新增 reorder 事件
    const audit = await store.readAudit(book.id)
    expect(audit.filter((e) => e.action === 'reorder').length).toBe(1)
  })

  it('reorderChapters 顺序未变时不写审计、不破坏数据', async () => {
    const { service, store } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一课', '一')
    await service.saveChapter(book.id, 2, '第二课', '二')
    const before = (await store.readAudit(book.id)).length
    const list = await service.reorderChapters(book.id, [1, 2])
    expect(list.map((c) => c.title)).toEqual(['第一课', '第二课'])
    expect(await service.chapterText(book.id, 1)).toBe('一')
    expect(await service.chapterText(book.id, 2)).toBe('二')
    // 无位移 → 不追加 reorder 审计
    expect((await store.readAudit(book.id)).filter((e) => e.action === 'reorder').length).toBe(0)
    expect((await store.readAudit(book.id)).length).toBe(before)
  })

  it('reorderChapters 拒绝非法顺序', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一课', '一')
    await service.saveChapter(book.id, 2, '第二课', '二')
    const error = await catchError(service.reorderChapters(book.id, [2]))
    expect(error.code).toBe('INVALID_FIELD_TYPE')
    // 原始顺序保持不变
    expect(await service.chapterText(book.id, 1)).toBe('一')
    expect(await service.chapterText(book.id, 2)).toBe('二')
  })
})

describe('NovelService — 模板复制（§3.5-11 cloneProject）', () => {
  it('clones config + stage artifacts, not chapters; resets state machine', async () => {
    const { service } = await freshService()
    const source = await service.createProject('青云问道', 'xianxia')
    // 提交设定阶段产物 → 产生 docs/setting.md
    await service.enterPhase(source.id, 'topic')
    await service.commitPhase(source.id, 'topic', '玄幻题材调研', { passed: true, errorCount: 0, warningCount: 0 })
    await service.enterPhase(source.id, 'setting')
    await service.commitPhase(source.id, 'setting', '世界观：九州；力量体系：炼气→筑基→金丹；地图：玄天大陆。', { passed: true, errorCount: 0, warningCount: 0 })
    // 源书写了几章讲义
    await service.saveChapter(source.id, 1, '第一章', '林远修行。')

    const clone = await service.cloneProject(source.id)
    // 新项目独立 id / 重置状态机
    expect(clone.id).not.toBe(source.id)
    expect(clone.title).toBe('青云问道（模板）')
    expect(clone.genre).toBe('xianxia')
    expect(at(clone, 'topic').state).toBe('locked')
    expect(clone.stats).toMatchObject({ chapterCount: 0, totalWords: 0 })
    // config 复制（字数目标/风格保留）
    expect(clone.config.genre).toBe('xianxia')
    expect(clone.config.wordTargets).toEqual(source.config.wordTargets)
    // 设定文档复制
    expect(await service.artifactOf(clone.id, 'topic')).toBe('玄幻题材调研')
    expect(await service.artifactOf(clone.id, 'setting')).toContain('九州')
    // 讲义不复制
    expect(await service.chapterText(clone.id, 1)).toBe('')
  })

  it('honors explicit title/genre override', async () => {
    const { service } = await freshService()
    const source = await service.createProject('原书', 'fantasy')
    const clone = await service.cloneProject(source.id, { title: '新课程', genre: 'urban' })
    expect(clone.title).toBe('新课程')
    expect(clone.genre).toBe('urban')
  })

  it('throws for unknown source', async () => {
    const { service } = await freshService()
    let code: string | undefined
    try {
      await service.cloneProject('bk_nonexistent_000000')
    } catch (cause) {
      code = (cause as { code?: string }).code
    }
    expect(code).toBe('ENTRY_NOT_FOUND')
  })
})
