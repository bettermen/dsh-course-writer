import { describe, expect, it } from 'vitest'
import {
  GENRES,
  genreIdFromLabel,
  genreLabel,
  isGenreId,
} from '../src/core/genres.ts'
import { BUILTIN_KINDS, genreLabelOf, genresOf, kindById } from '../src/core/kinds.ts'
import { mapGenre } from '../src/core/importer/index.ts'

describe('genres — 课程学科清单完整性', () => {
  it('id 与 label 各自唯一', () => {
    const ids = GENRES.map((g) => g.id)
    const labels = GENRES.map((g) => g.label)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('覆盖课程全学科（关键学科齐全）', () => {
    const ids = new Set(GENRES.map((g) => g.id))
    for (const expected of [
      'general', 'humanities', 'science',
      'math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography',
      'programming', 'design', 'marketing', 'management', 'finance', 'law',
      'certification', 'civil-service',
      'art', 'music', 'health', 'sports',
    ]) {
      expect(ids.has(expected), `缺少学科 ${expected}`).toBe(true)
    }
    expect(GENRES.length).toBeGreaterThanOrEqual(23)
  })

  it('全部条目都有分组', () => {
    for (const g of GENRES) {
      expect(g.group.length).toBeGreaterThan(0)
    }
  })
})

describe('genres — 标签转换', () => {
  it('genreLabel：id → 中文；未知原样返回', () => {
    expect(genreLabel('math')).toBe('数学')
    expect(genreLabel('programming')).toBe('编程开发')
    expect(genreLabel('legacy-unknown')).toBe('legacy-unknown')
    expect(genreLabel('')).toBe('')
  })

  it('genreIdFromLabel：中文 → id；未知返回 undefined', () => {
    expect(genreIdFromLabel('数学')).toBe('math')
    expect(genreIdFromLabel('职业考证')).toBe('certification')
    expect(genreIdFromLabel('不存在的类型')).toBeUndefined()
    expect(genreIdFromLabel('')).toBeUndefined()
  })

  it('isGenreId：合法 id true，其他 false', () => {
    expect(isGenreId('math')).toBe(true)
    expect(isGenreId('MATH')).toBe(false)
    expect(isGenreId('课程')).toBe(false)
  })
})

describe('kinds — 类型下题材联动', () => {
  it('四个内置类型的题材表互不为空且 id 唯一', () => {
    for (const kind of BUILTIN_KINDS) {
      expect(kind.genres.length, `${kind.id} 缺少题材`).toBeGreaterThan(0)
      const ids = kind.genres.map((g) => g.id)
      expect(new Set(ids).size, `${kind.id} 题材 id 重复`).toBe(ids.length)
    }
  })

  it('小说/公文/论文题材与课程学科分离', () => {
    const courseIds = new Set(genresOf(BUILTIN_KINDS, 'course').map((g) => g.id))
    const novelIds = genresOf(BUILTIN_KINDS, 'novel').map((g) => g.id)
    expect(novelIds.includes('xuanhuan')).toBe(true)
    expect(courseIds.has('xuanhuan')).toBe(false)
    expect(genresOf(BUILTIN_KINDS, 'official').map((g) => g.id)).toContain('notice')
    expect(genresOf(BUILTIN_KINDS, 'thesis').map((g) => g.id)).toContain('engineering')
  })

  it('genreLabelOf：按类型查，未命中回退课程学科表，再回退原值', () => {
    expect(genreLabelOf(BUILTIN_KINDS, 'novel', 'xuanhuan')).toBe('玄幻')
    expect(genreLabelOf(BUILTIN_KINDS, 'novel', 'math')).toBe('数学')
    expect(genreLabelOf(BUILTIN_KINDS, 'course', 'nope')).toBe('nope')
  })

  it('未知类型 id 返回空题材表', () => {
    expect(genresOf(BUILTIN_KINDS, 'does-not-exist')).toEqual([])
    expect(kindById(BUILTIN_KINDS, 'does-not-exist')).toBeUndefined()
  })
})

describe('mapGenre — 导入题材归一化', () => {
  it('全部内置 id 直通', () => {
    for (const g of GENRES) {
      expect(mapGenre(g.id)).toBe(g.id)
    }
  })

  it('全部中文标签映射到对应 id', () => {
    for (const g of GENRES) {
      expect(mapGenre(g.label), `${g.label} 应映射到 ${g.id}`).toBe(g.id)
    }
  })

  it('课程口语别名', () => {
    expect(mapGenre('语文')).toBe('chinese')
    expect(mapGenre('计算机')).toBe('programming')
    expect(mapGenre('金融')).toBe('finance')
    expect(mapGenre('公考')).toBe('civil-service')
  })

  it('大小写不敏感 + 未知回退 general', () => {
    expect(mapGenre('MATH')).toBe('math')
    expect(mapGenre('Programming')).toBe('programming')
    expect(mapGenre('未知类型')).toBe('general')
    expect(mapGenre('')).toBe('general')
  })
})
