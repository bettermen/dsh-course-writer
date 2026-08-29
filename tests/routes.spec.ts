import { describe, expect, it } from 'vitest'
import { parseNovelPath } from '../src/routes.ts'

describe('routes — path parsing', () => {
  it('parses the projects list', () => {
    const parsed = parseNovelPath('/api/course-writer/projects')
    expect(parsed.segments).toEqual(['projects'])
    expect(parsed.projectId).toBeUndefined()
  })

  it('parses project detail', () => {
    const parsed = parseNovelPath('/api/course-writer/projects/bk_abc123')
    expect(parsed.projectId).toBe('bk_abc123')
    expect(parsed.section).toBeUndefined()
  })

  it('parses chapter read/write', () => {
    const parsed = parseNovelPath('/api/course-writer/projects/bk_abc123/chapters/3')
    expect(parsed.projectId).toBe('bk_abc123')
    expect(parsed.section).toBe('chapters')
    expect(parsed.noText).toBe('3')
  })

  it('parses diagnose and context (regression: destructuring offset)', () => {
    const diagnose = parseNovelPath('/api/course-writer/projects/bk_abc123/diagnose/1')
    expect(diagnose.projectId).toBe('bk_abc123')
    expect(diagnose.section).toBe('diagnose')
    expect(diagnose.noText).toBe('1')

    const context = parseNovelPath('/api/course-writer/projects/bk_abc123/context/2')
    expect(context.projectId).toBe('bk_abc123')
    expect(context.section).toBe('context')
    expect(context.noText).toBe('2')
  })

  it('parses the demo import route', () => {
    const parsed = parseNovelPath('/api/course-writer/demo')
    expect(parsed.segments).toEqual(['demo'])
  })

  it('parses chapter delete and reorder', () => {
    // 删除：segments.length === 5，末段为字面量 delete
    const del = parseNovelPath('/api/course-writer/projects/bk_abc123/chapters/3/delete')
    expect(del.segments).toEqual(['projects', 'bk_abc123', 'chapters', '3', 'delete'])
    expect(del.projectId).toBe('bk_abc123')
    expect(del.section).toBe('chapters')
    expect(del.noText).toBe('3')

    // 重排：同为 4 段，靠第 4 段字面量 reorder 与「保存课时」区分
    const reorder = parseNovelPath('/api/course-writer/projects/bk_abc123/chapters/reorder')
    expect(reorder.segments).toEqual(['projects', 'bk_abc123', 'chapters', 'reorder'])
    expect(reorder.projectId).toBe('bk_abc123')
    expect(reorder.section).toBe('chapters')
    expect(reorder.noText).toBe('reorder')
  })

  it('handles undefined and foreign paths', () => {
    expect(parseNovelPath(undefined).segments).toEqual([])
    expect(parseNovelPath('/api/other/x').segments).toEqual([])
  })
})
