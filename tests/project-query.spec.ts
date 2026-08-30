/**
 * project/query — 首页项目列表的筛选、排序与进度计算（纯函数）。
 *
 * 全量 vitest 在本机会 OOM（exit 137），跑单文件即可。
 */
import { describe, expect, it } from 'vitest'
import {
  decorateProject,
  defaultOrderOf,
  filterProjects,
  isProjectSort,
  parseProjectQuery,
  progressOf,
  queryProjects,
  sortProjects,
} from '../src/core/project/query.ts'
import type { BookSummary } from '../src/core/novel/types.ts'

function summary(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: 'bk_1',
    title: '未命名',
    genre: 'general',
    kind: 'course',
    description: '',
    status: 'draft',
    currentPhase: 'topic',
    chapterCount: 0,
    totalWords: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('parseProjectQuery — 查询串解析', () => {
  it('解析全部字段', () => {
    const query = parseProjectQuery(new URLSearchParams('kind=novel&status=active&q=青云&sort=title&order=asc'))
    expect(query).toEqual({ kind: 'novel', status: 'active', q: '青云', sort: 'title', order: 'asc' })
  })

  it('非法取值一律忽略（首页不该因参数错误弹红）', () => {
    const query = parseProjectQuery(new URLSearchParams('kind=&status=sleeping&sort=nope&order=sideways'))
    expect(query).toEqual({})
  })

  it('status=active 是虚拟值，合法状态也接受', () => {
    expect(parseProjectQuery(new URLSearchParams('status=archived')).status).toBe('archived')
    expect(parseProjectQuery(new URLSearchParams('status=active')).status).toBe('active')
  })

  it('空查询串返回空条件', () => {
    expect(parseProjectQuery(new URLSearchParams())).toEqual({})
  })
})

describe('filterProjects — 筛选', () => {
  const list = [
    summary({ id: 'bk_1', title: '青云问道', kind: 'novel', status: 'in_progress', description: '玄幻长篇' }),
    summary({ id: 'bk_2', title: '深度学习综述', kind: 'thesis', status: 'done', description: '一篇综述' }),
    summary({ id: 'bk_3', title: '关于加强安全管理的通知', kind: 'official', status: 'archived' }),
    summary({ id: 'bk_4', title: '初中物理教案', kind: 'course', status: 'paused' }),
  ]

  it('按类型筛选', () => {
    expect(filterProjects(list, { kind: 'thesis' }).map((p) => p.id)).toEqual(['bk_2'])
  })

  it('status=active 排除 done 与 archived', () => {
    expect(filterProjects(list, { status: 'active' }).map((p) => p.id)).toEqual(['bk_1', 'bk_4'])
  })

  it('按具体状态筛选', () => {
    expect(filterProjects(list, { status: 'archived' }).map((p) => p.id)).toEqual(['bk_3'])
  })

  it('关键词同时匹配标题与简介', () => {
    expect(filterProjects(list, { q: '综述' }).map((p) => p.id)).toEqual(['bk_2'])
    expect(filterProjects(list, { q: '一篇' }).map((p) => p.id)).toEqual(['bk_2'])
    expect(filterProjects(list, { q: '青云' }).map((p) => p.id)).toEqual(['bk_1'])
    expect(filterProjects(list, { q: '不存在' })).toEqual([])
  })

  it('多条件取交集', () => {
    expect(filterProjects(list, { kind: 'novel', status: 'active' }).map((p) => p.id)).toEqual(['bk_1'])
    expect(filterProjects(list, { kind: 'novel', status: 'done' })).toEqual([])
  })

  it('空条件返回全量且不改原数组', () => {
    const result = filterProjects(list)
    expect(result).toHaveLength(4)
    expect(result).not.toBe(list)
  })
})

describe('sortProjects — 排序', () => {
  const list = [
    summary({ id: 'bk_1', title: 'B 项目', totalWords: 300, updatedAt: '2026-03-01T00:00:00.000Z', phaseDone: 3, phaseTotal: 9 }),
    summary({ id: 'bk_2', title: 'A 项目', totalWords: 100, updatedAt: '2026-01-01T00:00:00.000Z', phaseDone: 1, phaseTotal: 9 }),
    summary({ id: 'bk_3', title: 'C 项目', totalWords: 500, updatedAt: '2026-02-01T00:00:00.000Z', phaseDone: 9, phaseTotal: 9 }),
  ]

  it('updated 默认降序（最近更新在前）', () => {
    expect(sortProjects(list).map((p) => p.id)).toEqual(['bk_1', 'bk_3', 'bk_2'])
    expect(defaultOrderOf('updated')).toBe('desc')
  })

  it('title 默认升序', () => {
    expect(sortProjects(list, 'title').map((p) => p.id)).toEqual(['bk_2', 'bk_1', 'bk_3'])
    expect(defaultOrderOf('title')).toBe('asc')
  })

  it('words 与 progress 可升可降', () => {
    expect(sortProjects(list, 'words').map((p) => p.id)).toEqual(['bk_3', 'bk_1', 'bk_2'])
    expect(sortProjects(list, 'words', 'asc').map((p) => p.id)).toEqual(['bk_2', 'bk_1', 'bk_3'])
    expect(sortProjects(list, 'progress').map((p) => p.id)).toEqual(['bk_3', 'bk_1', 'bk_2'])
  })

  it('status 按进行中→草稿→暂停→完成→归档的语义顺序', () => {
    const mixed = [
      summary({ id: 'a', status: 'archived' }),
      summary({ id: 'b', status: 'draft' }),
      summary({ id: 'c', status: 'in_progress' }),
      summary({ id: 'd', status: 'done' }),
      summary({ id: 'e', status: 'paused' }),
    ]
    expect(sortProjects(mixed, 'status', 'asc').map((p) => p.id)).toEqual(['c', 'b', 'e', 'd', 'a'])
    expect(sortProjects(mixed, 'status').map((p) => p.id)).toEqual(['a', 'd', 'e', 'b', 'c'])
  })

  it('created 按创建时间排序', () => {
    const mixed = [
      summary({ id: 'a', createdAt: '2026-05-01T00:00:00.000Z' }),
      summary({ id: 'b', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]
    expect(sortProjects(mixed, 'created').map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('同值时用 id 兜底保证稳定', () => {
    const tie = [summary({ id: 'bk_b' }), summary({ id: 'bk_a' })]
    expect(sortProjects(tie, 'title').map((p) => p.id)).toEqual(['bk_a', 'bk_b'])
  })

  it('isProjectSort 校验排序字段', () => {
    expect(isProjectSort('updated')).toBe(true)
    expect(isProjectSort('nope')).toBe(false)
    expect(isProjectSort(42)).toBe(false)
  })
})

describe('queryProjects — 筛选 + 排序一步到位', () => {
  it('先筛后排', () => {
    const list = [
      summary({ id: 'bk_1', kind: 'course', totalWords: 10 }),
      summary({ id: 'bk_2', kind: 'novel', totalWords: 90 }),
      summary({ id: 'bk_3', kind: 'course', totalWords: 50 }),
    ]
    expect(queryProjects(list, { kind: 'course', sort: 'words' }).map((p) => p.id)).toEqual(['bk_3', 'bk_1'])
  })
})

describe('progressOf — 进度口径', () => {
  it('approved 与 skipped 都算完成，其余不算', () => {
    const phases = {
      topic: { state: 'approved' },
      setting: { state: 'skipped' },
      outline: { state: 'in_progress' },
      chapter: { state: 'locked' },
      revision: { state: 'review' },
    }
    expect(progressOf(phases, ['topic', 'setting', 'outline', 'chapter', 'revision'])).toEqual({ done: 2, total: 5 })
  })

  it('分母按工作流顺序（已删除的历史阶段不计入）', () => {
    const phases = {
      topic: { state: 'approved' },
      removed: { state: 'approved' },
      done: { state: 'locked' },
    }
    expect(progressOf(phases, ['topic', 'done'])).toEqual({ done: 1, total: 2 })
  })

  it('顺序为空时退化为统计全部阶段记录', () => {
    expect(progressOf({ a: { state: 'approved' }, b: {} }, [])).toEqual({ done: 1, total: 2 })
  })

  it('顺序里的阶段在记录中缺失时不计入完成', () => {
    expect(progressOf({}, ['a', 'b'])).toEqual({ done: 0, total: 2 })
  })
})

describe('decorateProject — 卡片补齐', () => {
  it('补齐类型名与进度；缺省回退类型 id 与 0', () => {
    const item = decorateProject(summary({ kind: 'thesis' }), { kindLabel: '论文', progress: { done: 2, total: 8 } })
    expect(item).toMatchObject({ kindLabel: '论文', phaseDone: 2, phaseTotal: 8 })
    const bare = decorateProject(summary({ kind: 'weird' }))
    expect(bare).toMatchObject({ kindLabel: 'weird', phaseDone: 0, phaseTotal: 0 })
  })

  it('保留原摘要的全部字段', () => {
    const base = summary({ title: '青云问道', totalWords: 1234 })
    expect(decorateProject(base)).toMatchObject({ id: base.id, title: '青云问道', totalWords: 1234 })
  })
})
