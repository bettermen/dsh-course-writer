import { describe, expect, it } from 'vitest'
import {
  buildQuery,
  pathOf,
  unwrap,
  ApiRequestError,
  createXiashuoApi,
  type FetchLike,
} from '../src/client/api.ts'
import {
  formatWords,
  progressPercent,
  formatDate,
  relativeTime,
  statusLabel,
  statusTone,
  kindLabelOf,
} from '../src/client/format.ts'

describe('client/format — 展示格式化', () => {
  it('formatWords 中文按万进位', () => {
    expect(formatWords(0)).toBe('0')
    expect(formatWords(999)).toBe('999')
    expect(formatWords(1000)).toBe('1000')
    expect(formatWords(12_345)).toBe('1.2 万')
    expect(formatWords(123_456)).toBe('12.3 万')
    expect(formatWords(1_234_567)).toBe('123 万')
  })

  it('formatWords 英文按 k 进位', () => {
    expect(formatWords(500, 'en')).toBe('500')
    expect(formatWords(1_234, 'en')).toBe('1.2k')
    expect(formatWords(12_345, 'en')).toBe('12k')
  })

  it('formatWords 对非法值回落 0', () => {
    expect(formatWords(Number.NaN)).toBe('0')
    expect(formatWords(-5)).toBe('0')
  })

  it('progressPercent 计算并夹取 0-100', () => {
    expect(progressPercent(3, 10)).toBe(30)
    expect(progressPercent(2, 4)).toBe(50)
    expect(progressPercent(0, 0)).toBe(0)
    expect(progressPercent(15, 10)).toBe(100)
  })

  it('formatDate 非法输入返回空串', () => {
    expect(formatDate('not-a-date')).toBe('')
  })

  it('formatDate 输出 YYYY-MM-DD', () => {
    expect(formatDate('2026-08-30T12:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('relativeTime 分档', () => {
    const now = new Date('2026-08-30T12:00:00Z').getTime()
    const iso = (ms: number): string => new Date(now - ms).toISOString()
    expect(relativeTime(iso(30_000), 'zh', now)).toBe('刚刚')
    expect(relativeTime(iso(5 * 60_000), 'zh', now)).toBe('5 分钟前')
    expect(relativeTime(iso(3 * 3_600_000), 'zh', now)).toBe('3 小时前')
    expect(relativeTime(iso(2 * 86_400_000), 'zh', now)).toBe('2 天前')
    expect(relativeTime(iso(30_000), 'en', now)).toBe('just now')
    // 超过 7 天回退日期
    const old = iso(10 * 86_400_000)
    expect(relativeTime(old, 'zh', now)).toBe(formatDate(old))
    // 未来时间回退日期
    const future = new Date(now + 60_000).toISOString()
    expect(relativeTime(future, 'zh', now)).toBe(formatDate(future))
  })

  it('statusLabel 中英映射', () => {
    expect(statusLabel('draft')).toBe('草稿')
    expect(statusLabel('in_progress', 'en')).toBe('In progress')
    expect(statusLabel('archived', 'en')).toBe('Archived')
  })

  it('statusTone 映射', () => {
    expect(statusTone('in_progress')).toBe('blue')
    expect(statusTone('done')).toBe('green')
    expect(statusTone('paused')).toBe('orange')
    expect(statusTone('draft')).toBe('neutral')
    expect(statusTone('archived')).toBe('neutral')
  })

  it('kindLabelOf 语言与回退', () => {
    expect(kindLabelOf({ label: '课程', labelEn: 'Course' }, 'zh')).toBe('课程')
    expect(kindLabelOf({ label: '课程', labelEn: 'Course' }, 'en')).toBe('Course')
    expect(kindLabelOf({ label: '小说' }, 'en')).toBe('小说') // 无英文回退中文
    expect(kindLabelOf(undefined, 'zh', '兜底')).toBe('兜底')
  })
})

describe('client/api — 查询串与解包', () => {
  it('buildQuery 跳过空值', () => {
    expect(buildQuery()).toBe('')
    expect(buildQuery({ kind: 'novel', q: '', status: undefined })).toBe('?kind=novel')
    expect(buildQuery({ order: 'asc' })).toBe('?order=asc')
  })

  it('pathOf 拼装', () => {
    expect(pathOf('/projects')).toBe('/projects')
    expect(pathOf('/projects', { kind: 'novel' })).toBe('/projects?kind=novel')
  })

  it('unwrap 成功返回 value', () => {
    expect(unwrap({ ok: true, value: 42 }, 200)).toBe(42)
  })

  it('unwrap 失败抛 ApiRequestError（带 code/status/message）', () => {
    try {
      unwrap({ ok: false, error: { code: 'INVALID_STATE', message: '冲突' } }, 409)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiRequestError)
      const err = e as ApiRequestError
      expect(err.code).toBe('INVALID_STATE')
      expect(err.status).toBe(409)
      expect(err.message).toBe('冲突')
    }
  })
})

describe('client/api — createXiashuoApi', () => {
  const okFetch = (value: unknown): FetchLike => async () => ({
    ok: true, status: 200, json: async () => ({ ok: true, value }),
  })

  it('listProjects 拼 URL 并带围栏头', async () => {
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = []
    const api = createXiashuoApi('/api/xiashuo', 'x-xiashuo', async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => ({ ok: true, value: [] }) }
    })
    await api.listProjects({ kind: 'novel', status: 'active', q: '星', sort: 'title', order: 'asc' })
    const u = new URL(calls[0]!.url, 'http://x')
    expect(u.pathname).toBe('/api/xiashuo/projects')
    expect(u.searchParams.get('kind')).toBe('novel')
    expect(u.searchParams.get('status')).toBe('active')
    expect(u.searchParams.get('q')).toBe('星')
    expect(u.searchParams.get('sort')).toBe('title')
    expect(u.searchParams.get('order')).toBe('asc')
    expect(calls[0]!.init?.headers?.['x-xiashuo']).toBe('1')
    expect(calls[0]!.init?.headers?.['content-type']).toBe('application/json')
  })

  it('createProject POST JSON 体', async () => {
    const calls: Array<{ init?: { method?: string; body?: string } }> = []
    const api = createXiashuoApi('/api/xiashuo', 'x-xiashuo', async (_url, init) => {
      calls.push({ init })
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { id: 'p1' } }) }
    })
    await api.createProject({ title: '新课', kind: 'novel', genre: 'kehuan' })
    expect(calls[0]!.init?.method).toBe('POST')
    expect(JSON.parse(calls[0]!.init?.body ?? '{}')).toEqual({ title: '新课', kind: 'novel', genre: 'kehuan' })
  })

  it('deleteProject keepFiles 追加查询参数', async () => {
    const calls: string[] = []
    const api = createXiashuoApi('/api/xiashuo', 'x-xiashuo', async (url) => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { deleted: true } }) }
    })
    await api.deleteProject('abc', true)
    expect(calls[0]).toContain('/projects/abc?keepFiles=1')
  })

  it('后端 ok:false 抛 ApiRequestError', async () => {
    const api = createXiashuoApi('/api/xiashuo', 'x-xiashuo', async () => ({
      ok: false, status: 400, json: async () => ({ ok: false, error: { code: 'INVALID_FIELD_TYPE', message: '类型非法' } }),
    }))
    await expect(api.createProject({ title: 'x' })).rejects.toMatchObject({ code: 'INVALID_FIELD_TYPE', status: 400 })
  })

  it('非 JSON 响应按 HTTP 状态兜底 IO_FAILURE', async () => {
    const api = createXiashuoApi('/api/xiashuo', 'x-xiashuo', async () => ({
      ok: false, status: 502, json: async () => { throw new Error('not json') },
    }))
    await expect(api.listKinds()).rejects.toMatchObject({ code: 'IO_FAILURE', status: 502 })
  })

  it('listKinds 返回类型数组', async () => {
    const api = createXiashuoApi('/api/xiashuo', 'x-xiashuo', okFetch([{ id: 'course', label: '课程', labelEn: 'Course', icon: '📘', description: '', genres: [], builtin: true, templateId: 'builtin-course' }]))
    const kinds = await api.listKinds()
    expect(kinds).toHaveLength(1)
    expect(kinds[0]!.id).toBe('course')
  })
})
