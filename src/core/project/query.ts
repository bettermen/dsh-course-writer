/**
 * xiashuo — 首页项目列表查询（P2）。
 *
 * 首页需要「按类型/状态/关键词筛选 + 多字段排序 + 卡片展示进度与类型名」。
 * 这些逻辑与 IO 无关，抽成纯函数以便在无磁盘的情况下单测（AGENTS.md 分层要求）。
 *
 * 数据补齐分两步：
 *  1. `core/novel/store.ts` 给出 `BookSummary`（含 kind/description/status）；
 *  2. 路由层补 `kindLabel` 与 `phaseDone/phaseTotal`（需要类型表与工作流，
 *     属于跨模块信息）→ `decorateProject` 产出 `ProjectListItem`。
 */
import type { BookSummary } from '../novel/types.ts'
import type { ProjectStatus } from '../novel/status.ts'
import { isProjectStatus, normalizeStatus } from '../novel/status.ts'

/** 首页卡片（在 BookSummary 之上补齐展示字段）。 */
export interface ProjectListItem extends BookSummary {
  /** 类型中文名（未知类型回退类型 id）。 */
  kindLabel: string
  /** 已完成阶段数（approved/skipped 计为完成）。 */
  phaseDone: number
  /** 流程总阶段数（工作流缺失时退化为已有阶段记录数）。 */
  phaseTotal: number
}

/** 可排序字段。 */
export type ProjectSort = 'updated' | 'created' | 'title' | 'words' | 'progress' | 'status'

const SORTS: readonly ProjectSort[] = ['updated', 'created', 'title', 'words', 'progress', 'status']

/** 筛选条件（对应 `GET /projects?kind=&status=&q=&sort=&order=`）。 */
export interface ProjectQuery {
  /** 项目类型 id（course/official/novel/thesis/自定义）。 */
  kind?: string
  /** 项目状态；`active` 为虚拟值 = 非 done 且非 archived。 */
  status?: ProjectStatus | 'active'
  /** 关键词（匹配标题与简介，大小写不敏感）。 */
  q?: string
  /** 排序字段（缺省 updated）。 */
  sort?: ProjectSort
  /** 排序方向（缺省 desc；title 缺省 asc）。 */
  order?: 'asc' | 'desc'
}

/** 是否可排序字段。 */
export function isProjectSort(value: unknown): value is ProjectSort {
  return typeof value === 'string' && (SORTS as readonly string[]).includes(value)
}

/** 排序字段默认方向：标题按字典序升序更自然，其余按"最近/最多"降序。 */
export function defaultOrderOf(sort: ProjectSort): 'asc' | 'desc' {
  return sort === 'title' ? 'asc' : 'desc'
}

/**
 * 从 URL 查询串解析筛选条件。
 * 非法取值一律忽略（不报错）——首页是浏览界面，筛选参数错误不该弹红。
 */
export function parseProjectQuery(params: URLSearchParams): ProjectQuery {
  const query: ProjectQuery = {}
  const kind = params.get('kind')?.trim()
  if (kind) query.kind = kind
  const rawStatus = params.get('status')?.trim()
  if (rawStatus === 'active') query.status = 'active'
  else if (isProjectStatus(rawStatus)) query.status = rawStatus
  const q = params.get('q')?.trim()
  if (q) query.q = q
  const sort = params.get('sort')?.trim()
  if (isProjectSort(sort)) query.sort = sort
  const order = params.get('order')?.trim()
  if (order === 'asc' || order === 'desc') query.order = order
  return query
}

/** 关键词是否命中（标题或简介包含即可，大小写不敏感）。 */
function matchesKeyword(item: BookSummary, keyword: string): boolean {
  const needle = keyword.toLowerCase()
  return item.title.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle)
}

/** 按条件筛选（不改原数组）。 */
export function filterProjects(list: readonly BookSummary[], query: ProjectQuery = {}): BookSummary[] {
  return list.filter((item) => {
    if (query.kind && item.kind !== query.kind) return false
    if (query.status) {
      const status = normalizeStatus(item.status)
      if (query.status === 'active') {
        if (status === 'done' || status === 'archived') return false
      } else if (status !== query.status) {
        return false
      }
    }
    if (query.q && !matchesKeyword(item, query.q)) return false
    return true
  })
}

/** 进度比较值（0..1；无阶段时 0）。 */
function progressRatio(item: BookSummary): number {
  const total = item.phaseTotal ?? 0
  if (total <= 0) return 0
  return (item.phaseDone ?? 0) / total
}

const STATUS_RANK: Readonly<Record<ProjectStatus, number>> = {
  in_progress: 0,
  draft: 1,
  paused: 2,
  done: 3,
  archived: 4,
}

/** 排序（不改原数组；同值时用 id 兜底保证稳定）。 */
export function sortProjects(list: readonly BookSummary[], sort: ProjectSort = 'updated', order?: 'asc' | 'desc'): BookSummary[] {
  const direction = order ?? defaultOrderOf(sort)
  const sign = direction === 'asc' ? 1 : -1
  const sorted = [...list].sort((a, b) => {
    let delta = 0
    switch (sort) {
      case 'title':
        delta = a.title.localeCompare(b.title, 'zh-CN')
        break
      case 'words':
        delta = a.totalWords - b.totalWords
        break
      case 'progress':
        delta = progressRatio(a) - progressRatio(b)
        break
      case 'status':
        delta = STATUS_RANK[normalizeStatus(a.status)] - STATUS_RANK[normalizeStatus(b.status)]
        break
      case 'created':
        delta = (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
        break
      default:
        delta = a.updatedAt.localeCompare(b.updatedAt)
    }
    if (delta === 0) delta = a.title.localeCompare(b.title, 'zh-CN')
    if (delta === 0) delta = a.id.localeCompare(b.id)
    return delta
  })
  return sign === 1 ? sorted : sorted.reverse()
}

/** 筛选 + 排序一步到位。 */
export function queryProjects(list: readonly BookSummary[], query: ProjectQuery = {}): BookSummary[] {
  return sortProjects(filterProjects(list, query), query.sort ?? 'updated', query.order)
}

/**
 * 计算流程进度。
 *
 * 口径：以**工作流顺序**为准统计（工作流里已删除的历史阶段不计入分母），
 * `approved` 与 `skipped` 都算"已完成"（跳过也是一种了结）。
 */
export function progressOf(
  phases: Readonly<Record<string, { state?: string } | undefined>>,
  order: readonly string[],
): { done: number; total: number } {
  const ids = order.length > 0 ? order : Object.keys(phases)
  let done = 0
  for (const id of ids) {
    const state = phases[id]?.state
    if (state === 'approved' || state === 'skipped') done += 1
  }
  return { done, total: ids.length }
}

/** 补齐首页卡片展示字段（类型名 + 进度）。 */
export function decorateProject(
  item: BookSummary,
  context: { kindLabel?: string; progress?: { done: number; total: number } } = {},
): ProjectListItem {
  return {
    ...item,
    kindLabel: context.kindLabel ?? item.kind,
    phaseDone: context.progress?.done ?? 0,
    phaseTotal: context.progress?.total ?? 0,
  }
}
