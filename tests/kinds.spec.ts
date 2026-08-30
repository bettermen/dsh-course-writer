import { describe, expect, it } from 'vitest'
import {
  BUILTIN_KIND_IDS,
  BUILTIN_KINDS,
  createCustomKind,
  DEFAULT_KIND_ID,
  defaultGenreOf,
  genreLabelOf,
  genresOf,
  isKindId,
  kindById,
  kindOrDefault,
  resolveKinds,
  templateOfKind,
  type ProjectKind,
} from '../src/core/kinds.ts'

describe('kinds — 内置注册表', () => {
  it('四个内置类型齐全且 id 唯一', () => {
    expect(BUILTIN_KINDS.map((k) => k.id)).toEqual(['course', 'official', 'novel', 'thesis'])
    expect(new Set(BUILTIN_KINDS.map((k) => k.id)).size).toBe(BUILTIN_KINDS.length)
    expect(new Set(BUILTIN_KINDS.map((k) => k.label)).size).toBe(BUILTIN_KINDS.length)
    expect(BUILTIN_KIND_IDS).toEqual(['course', 'official', 'novel', 'thesis'])
  })

  it('每个内置类型都有图标、英文名、说明与模板', () => {
    for (const kind of BUILTIN_KINDS) {
      expect(kind.icon.length, `${kind.id} 缺图标`).toBeGreaterThan(0)
      expect(kind.labelEn.length, `${kind.id} 缺英文名`).toBeGreaterThan(0)
      expect(kind.description.length, `${kind.id} 缺说明`).toBeGreaterThan(0)
      expect(kind.builtin).toBe(true)
      expect(templateOfKind(BUILTIN_KINDS, kind.id).kind).toBe(kind.id)
    }
  })

  it('课程类型沿用现有 23 个学科', () => {
    expect(genresOf(BUILTIN_KINDS, 'course').length).toBeGreaterThanOrEqual(23)
    expect(genresOf(BUILTIN_KINDS, 'course').map((g) => g.id)).toContain('math')
  })
})

describe('kinds — 查询与兜底', () => {
  it('kindById / kindOrDefault', () => {
    expect(kindById(BUILTIN_KINDS, 'novel')?.label).toBe('小说')
    expect(kindById(BUILTIN_KINDS, 'nope')).toBeUndefined()
    expect(kindOrDefault(BUILTIN_KINDS, 'nope').id).toBe(DEFAULT_KIND_ID)
    expect(kindOrDefault(BUILTIN_KINDS, undefined).id).toBe(DEFAULT_KIND_ID)
    expect(kindOrDefault([], undefined).id).toBe(DEFAULT_KIND_ID)
  })

  it('defaultGenreOf 取首项，未知类型回退 general', () => {
    expect(defaultGenreOf(BUILTIN_KINDS, 'course')).toBe('general')
    expect(defaultGenreOf(BUILTIN_KINDS, 'novel')).toBe('xuanhuan')
    expect(defaultGenreOf(BUILTIN_KINDS, 'nope')).toBe('general')
  })

  it('genreLabelOf 三级回退', () => {
    expect(genreLabelOf(BUILTIN_KINDS, 'official', 'notice')).toBe('通知')
    expect(genreLabelOf(BUILTIN_KINDS, 'official', 'math')).toBe('数学')
    expect(genreLabelOf(BUILTIN_KINDS, 'course', 'ghost')).toBe('ghost')
  })

  it('templateOfKind 未知类型回退通用模板', () => {
    expect(templateOfKind(BUILTIN_KINDS, 'nope').id).toBe('builtin-generic')
  })
})

describe('kinds — 自定义类型', () => {
  it('resolveKinds：内置在前、自定义在后', () => {
    const custom: ProjectKind = {
      id: 'copywriting', label: '文案', labelEn: 'Copywriting', icon: '✍️',
      description: '新媒体文案', genres: [{ id: 'wechat', label: '公众号' }],
      builtin: false, templateId: 'builtin-generic',
    }
    const merged = resolveKinds([custom])
    expect(merged.length).toBe(5)
    expect(merged.at(-1)?.id).toBe('copywriting')
    expect(merged.filter((k) => k.builtin).length).toBe(4)
  })

  it('resolveKinds：同 id 时自定义项覆盖内置项，但 builtin 标记为 false', () => {
    const override: ProjectKind = { ...BUILTIN_KINDS[0]!, label: '课程（改）', builtin: true }
    const merged = resolveKinds([override])
    expect(merged.length).toBe(4)
    expect(kindById(merged, 'course')?.label).toBe('课程（改）')
    expect(kindById(merged, 'course')?.builtin).toBe(false)
  })

  it('createCustomKind：缺省 id 由名称生成 slug，题材自动生成 id', () => {
    const result = createCustomKind({
      label: '新媒体文案',
      genres: [{ label: '公众号' }, { label: '小红书' }],
    }, BUILTIN_KINDS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('kind')
    expect(result.value.builtin).toBe(false)
    expect(result.value.icon).toBe('✨')
    expect(result.value.templateId).toBe('builtin-generic')
    // 中文题材名无法生成 ASCII slug → 回退 genre-N
    expect(result.value.genres.map((g) => g.id)).toEqual(['genre-1', 'genre-2'])
    expect(result.value.genres.map((g) => g.label)).toEqual(['公众号', '小红书'])
  })

  it('createCustomKind：显式合法 id 与保留字、重复、非法形状', () => {
    const ok = createCustomKind({ id: 'copywriting', label: '文案' }, BUILTIN_KINDS)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.id).toBe('copywriting')

    for (const reserved of ['course', 'official', 'novel', 'thesis', 'custom']) {
      const bad = createCustomKind({ id: reserved, label: 'x' }, BUILTIN_KINDS)
      expect(bad.ok, `保留字 ${reserved} 应被拒绝`).toBe(false)
    }
    // 大小写自动归一化为规范 id
    const mixed = createCustomKind({ id: 'MyKind', label: 'x' }, BUILTIN_KINDS)
    expect(mixed.ok).toBe(true)
    if (mixed.ok) expect(mixed.value.id).toBe('mykind')
    // 非 ASCII 无法归一化 → 拒绝
    expect(createCustomKind({ id: '中文id', label: 'x' }, BUILTIN_KINDS).ok).toBe(false)

    const existing: ProjectKind[] = [
      { id: 'copywriting', label: '文案', labelEn: 'Copy', icon: '✍️', description: '', genres: [], builtin: false, templateId: 'builtin-generic' },
    ]
    expect(createCustomKind({ id: 'copywriting', label: '文案2' }, existing).ok).toBe(false)
  })

  it('createCustomKind：空名称 / 超长名称 / 未知模板被拒', () => {
    expect(createCustomKind({ label: '   ' }, BUILTIN_KINDS).ok).toBe(false)
    expect(createCustomKind({ label: 'x'.repeat(21) }, BUILTIN_KINDS).ok).toBe(false)
    expect(createCustomKind({ label: 'x', templateId: 'builtin-nope' }, BUILTIN_KINDS).ok).toBe(false)
  })

  it('createCustomKind：题材 id 重复自动加序号，超过 50 项被拒', () => {
    const result = createCustomKind({
      id: 'dup', label: '重复题材',
      genres: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }],
    }, BUILTIN_KINDS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.genres.map((g) => g.id)).toEqual(['a', 'a-2'])

    const tooMany = createCustomKind({
      id: 'many', label: '过多', genres: Array.from({ length: 51 }, (_, i) => ({ label: `G${i}` })),
    }, BUILTIN_KINDS)
    expect(tooMany.ok).toBe(false)
  })

  it('isKindId 形状判定', () => {
    expect(isKindId('course')).toBe(true)
    expect(isKindId('my-kind_2')).toBe(true)
    expect(isKindId('Course')).toBe(false)
    expect(isKindId('1kind')).toBe(false)
    expect(isKindId('中文')).toBe(false)
    expect(isKindId('')).toBe(false)
  })
})
