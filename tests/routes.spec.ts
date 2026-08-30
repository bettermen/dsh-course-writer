import { describe, expect, it } from 'vitest'
import { parseNovelPath } from '../src/routes.ts'

describe('routes — path parsing', () => {
  it('parses the projects list', () => {
    const parsed = parseNovelPath('/api/xiashuo/projects')
    expect(parsed.segments).toEqual(['projects'])
    expect(parsed.projectId).toBeUndefined()
  })

  it('parses project detail', () => {
    const parsed = parseNovelPath('/api/xiashuo/projects/bk_abc123')
    expect(parsed.projectId).toBe('bk_abc123')
    expect(parsed.section).toBeUndefined()
  })

  it('parses chapter read/write', () => {
    const parsed = parseNovelPath('/api/xiashuo/projects/bk_abc123/chapters/3')
    expect(parsed.projectId).toBe('bk_abc123')
    expect(parsed.section).toBe('chapters')
    expect(parsed.noText).toBe('3')
  })

  it('parses diagnose and context (regression: destructuring offset)', () => {
    const diagnose = parseNovelPath('/api/xiashuo/projects/bk_abc123/diagnose/1')
    expect(diagnose.projectId).toBe('bk_abc123')
    expect(diagnose.section).toBe('diagnose')
    expect(diagnose.noText).toBe('1')

    const context = parseNovelPath('/api/xiashuo/projects/bk_abc123/context/2')
    expect(context.projectId).toBe('bk_abc123')
    expect(context.section).toBe('context')
    expect(context.noText).toBe('2')
  })

  it('parses the demo import route', () => {
    const parsed = parseNovelPath('/api/xiashuo/demo')
    expect(parsed.segments).toEqual(['demo'])
  })

  it('parses chapter delete and reorder', () => {
    // 删除：segments.length === 5，末段为字面量 delete
    const del = parseNovelPath('/api/xiashuo/projects/bk_abc123/chapters/3/delete')
    expect(del.segments).toEqual(['projects', 'bk_abc123', 'chapters', '3', 'delete'])
    expect(del.projectId).toBe('bk_abc123')
    expect(del.section).toBe('chapters')
    expect(del.noText).toBe('3')

    // 重排：同为 4 段，靠第 4 段字面量 reorder 与「保存课时」区分
    const reorder = parseNovelPath('/api/xiashuo/projects/bk_abc123/chapters/reorder')
    expect(reorder.segments).toEqual(['projects', 'bk_abc123', 'chapters', 'reorder'])
    expect(reorder.projectId).toBe('bk_abc123')
    expect(reorder.section).toBe('chapters')
    expect(reorder.noText).toBe('reorder')
  })

  it('handles undefined and foreign paths', () => {
    expect(parseNovelPath(undefined).segments).toEqual([])
    expect(parseNovelPath('/api/other/x').segments).toEqual([])
  })

  it('parses the kinds routes (P2)', () => {
    expect(parseNovelPath('/api/xiashuo/kinds').segments).toEqual(['kinds'])
    const one = parseNovelPath('/api/xiashuo/kinds/copywriting')
    expect(one.segments).toEqual(['kinds', 'copywriting'])
    expect(one.projectId).toBe('copywriting')
  })

  it('parses the template library routes (P2)', () => {
    expect(parseNovelPath('/api/xiashuo/workflows').segments).toEqual(['workflows'])
    const one = parseNovelPath('/api/xiashuo/workflows/wftpl-abc')
    expect(one.segments).toEqual(['workflows', 'wftpl-abc'])
    // 查询串不参与路径分派
    expect(parseNovelPath('/api/xiashuo/workflows?kind=novel').segments).toEqual(['workflows'])
  })

  it('parses the project workflow routes (P2)', () => {
    const read = parseNovelPath('/api/xiashuo/projects/bk_abc123/workflow')
    expect(read.segments).toEqual(['projects', 'bk_abc123', 'workflow'])
    expect(read.projectId).toBe('bk_abc123')
    expect(read.section).toBe('workflow')

    const reset = parseNovelPath('/api/xiashuo/projects/bk_abc123/workflow/reset')
    expect(reset.segments).toEqual(['projects', 'bk_abc123', 'workflow', 'reset'])

    const phases = parseNovelPath('/api/xiashuo/projects/bk_abc123/workflow/phases')
    expect(phases.segments).toEqual(['projects', 'bk_abc123', 'workflow', 'phases'])
    expect(phases.section).toBe('workflow')

    const reorder = parseNovelPath('/api/xiashuo/projects/bk_abc123/workflow/phases/reorder')
    expect(reorder.segments).toEqual(['projects', 'bk_abc123', 'workflow', 'phases', 'reorder'])

    // 阶段级操作 6 段：靠末段字面量区分 rename / update / delete
    const rename = parseNovelPath('/api/xiashuo/projects/bk_abc123/workflow/phases/topic/rename')
    expect(rename.segments).toEqual(['projects', 'bk_abc123', 'workflow', 'phases', 'topic', 'rename'])
    expect(rename.projectId).toBe('bk_abc123')
  })

  it('parses the project duplicate and archive routes (P2)', () => {
    for (const action of ['duplicate', 'archive'] as const) {
      const parsed = parseNovelPath(`/api/xiashuo/projects/bk_abc123/${action}`)
      expect(parsed.segments).toEqual(['projects', 'bk_abc123', action])
      expect(parsed.projectId).toBe('bk_abc123')
      expect(parsed.section).toBe(action)
    }
  })

  it('strips the query string from the projects list (P2 筛选参数)', () => {
    const parsed = parseNovelPath('/api/xiashuo/projects?kind=novel&status=active&sort=title&order=asc')
    expect(parsed.segments).toEqual(['projects'])
  })
})
