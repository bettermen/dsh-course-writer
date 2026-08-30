/**
 * xiashuo — 项目类型（Kind）注册表（P0）。
 *
 * 类型分两层：
 *  - 内置 4 种：课程 / 公文 / 小说 / 论文（不可删，可隐藏由上层决定）；
 *  - 用户自定义：存 kinds.json，可增删改（由 store 层负责 IO，本模块只处理纯数据）。
 *
 * 每种类型自带题材（genre）列表与默认工作流模板 id，供首页新建项目联动选择。
 * 纯数据 + 纯函数：零 IO、零 cordis 依赖（AGENTS.md 架构分层要求）。
 */

import type { PluginError, Result } from './types.ts'
import { GENRES, genreLabel as courseGenreLabel } from './genres.ts'
import { builtinTemplateById, GENERIC_TEMPLATE } from './workflow/templates.ts'

/** 题材选项（类型下的子类）。 */
export interface KindGenre {
  id: string
  label: string
}

/** 项目类型定义。 */
export interface ProjectKind {
  /** 稳定 id（持久化值；内置 4 种 + 用户自定义）。 */
  id: string
  /** 类型名称。 */
  label: string
  /** 类型英文名。 */
  labelEn: string
  /** 图标（emoji，零资源成本）。 */
  icon: string
  /** 一句话说明（新建项目弹窗展示）。 */
  description: string
  /** 该类型下的题材列表（新建项目时联动）。 */
  genres: KindGenre[]
  /** 是否内置（内置类型不可删除/重命名）。 */
  builtin: boolean
  /** 默认工作流模板 id（见 core/workflow/templates.ts）。 */
  templateId: string
}

/** 内置类型 id（保留字，用户自定义不得占用）。 */
export const BUILTIN_KIND_IDS: readonly string[] = ['course', 'official', 'novel', 'thesis']

/** 通用兜底类型 id（旧项目无 kind 字段时的迁移归属）。 */
export const DEFAULT_KIND_ID = 'course'

const COURSE_KIND: ProjectKind = {
  id: 'course',
  label: '课程',
  labelEn: 'Course',
  icon: '📘',
  description: '教案、课件、练习与考核设计',
  genres: GENRES.map((genre) => ({ id: genre.id, label: genre.label })),
  builtin: true,
  templateId: 'builtin-course',
}

const OFFICIAL_KIND: ProjectKind = {
  id: 'official',
  label: '公文',
  labelEn: 'Official',
  icon: '📄',
  description: '通知、请示、报告、函、讲话稿',
  genres: [
    { id: 'notice', label: '通知' },
    { id: 'request', label: '请示' },
    { id: 'report', label: '报告' },
    { id: 'letter', label: '函' },
    { id: 'minutes', label: '纪要' },
    { id: 'speech', label: '讲话稿' },
    { id: 'summary', label: '工作总结' },
  ],
  builtin: true,
  templateId: 'builtin-official',
}

const NOVEL_KIND: ProjectKind = {
  id: 'novel',
  label: '小说',
  labelEn: 'Novel',
  icon: '📖',
  description: '长篇连载、短篇与网文创作',
  genres: [
    { id: 'xuanhuan', label: '玄幻' },
    { id: 'dushi', label: '都市' },
    { id: 'xuanyi', label: '悬疑' },
    { id: 'kehuan', label: '科幻' },
    { id: 'lishi', label: '历史' },
    { id: 'yanqing', label: '言情' },
    { id: 'youxi', label: '游戏' },
    { id: 'qingxiaoshuo', label: '轻小说' },
  ],
  builtin: true,
  templateId: 'builtin-novel',
}

const THESIS_KIND: ProjectKind = {
  id: 'thesis',
  label: '论文',
  labelEn: 'Thesis',
  icon: '🎓',
  description: '学位论文、期刊投稿与开题结题',
  genres: [
    { id: 'engineering', label: '工学' },
    { id: 'science', label: '理学' },
    { id: 'social', label: '社科' },
    { id: 'medicine', label: '医学' },
    { id: 'economics', label: '经管' },
    { id: 'literature', label: '文学' },
  ],
  builtin: true,
  templateId: 'builtin-thesis',
}

/** 内置类型清单（顺序即首页展示顺序）。 */
export const BUILTIN_KINDS: readonly ProjectKind[] = [COURSE_KIND, OFFICIAL_KIND, NOVEL_KIND, THESIS_KIND]

/** 类型 id 形状：小写字母开头，仅含小写字母/数字/下划线/连字符，1-32 字符。 */
const KIND_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/
/** 题材 id 形状（同类型 id）。 */
const GENRE_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/

function invalid(message: string): PluginError {
  return { code: 'INVALID_FIELD_TYPE', message }
}

/** 合法类型 id 判定。 */
export function isKindId(value: unknown): value is string {
  return typeof value === 'string' && KIND_ID_RE.test(value)
}

/** 合并内置类型与用户自定义类型（自定义在后；同 id 时用户项覆盖内置项，用于改名/换图标）。 */
export function resolveKinds(customKinds: readonly ProjectKind[] = []): ProjectKind[] {
  const merged = new Map<string, ProjectKind>()
  for (const kind of BUILTIN_KINDS) merged.set(kind.id, kind)
  for (const kind of customKinds) {
    if (!kind || typeof kind.id !== 'string') continue
    merged.set(kind.id, { ...kind, builtin: false })
  }
  return [...merged.values()]
}

/** 按 id 取类型（未命中返回 undefined）。 */
export function kindById(kinds: readonly ProjectKind[], id: string): ProjectKind | undefined {
  return kinds.find((kind) => kind.id === id)
}

/** 兜底取类型：未知 id 回落到默认类型（course），再回落第一个可用类型。 */
export function kindOrDefault(kinds: readonly ProjectKind[], id: string | undefined): ProjectKind {
  const hit = id ? kindById(kinds, id) : undefined
  if (hit) return hit
  const fallback = kindById(kinds, DEFAULT_KIND_ID) ?? kinds[0]
  return fallback ?? COURSE_KIND
}

/** 某类型下的题材列表（未知类型返回空数组）。 */
export function genresOf(kinds: readonly ProjectKind[], kindId: string): KindGenre[] {
  return kindById(kinds, kindId)?.genres ?? []
}

/** 某类型的默认题材 id（取首项；无题材时返回 'general'）。 */
export function defaultGenreOf(kinds: readonly ProjectKind[], kindId: string): string {
  return genresOf(kinds, kindId)[0]?.id ?? 'general'
}

/** 题材 id → 中文标签：优先查目标类型，未命中回退课程题材表，再回退原值。 */
export function genreLabelOf(kinds: readonly ProjectKind[], kindId: string, genreId: string): string {
  const hit = genresOf(kinds, kindId).find((genre) => genre.id === genreId)
  if (hit) return hit.label
  const legacy = courseGenreLabel(genreId)
  return legacy || String(genreId ?? '')
}

/** 取某类型的默认工作流模板（模板 id 非法时回退通用模板）。 */
export function templateOfKind(kinds: readonly ProjectKind[], kindId: string) {
  const kind = kindById(kinds, kindId)
  if (!kind) return GENERIC_TEMPLATE
  return builtinTemplateById(kind.templateId) ?? GENERIC_TEMPLATE
}

/** 新建自定义类型的入参。 */
export interface CreateKindInput {
  id?: string
  label: string
  labelEn?: string
  icon?: string
  description?: string
  genres?: Array<{ id?: string; label: string }>
  /** 以哪个内置模板作为起步流程（默认通用模板）。 */
  templateId?: string
}

/**
 * 构造自定义类型（纯函数，校验 + 规范化；不落盘）。
 * - id 缺省时由 label 生成 slug，与已有类型冲突则追加序号；
 * - 题材 id 缺省时由题材名生成 slug；
 * - 内置 id 与 'custom' 为保留字，拒绝占用。
 */
export function createCustomKind(input: CreateKindInput, existing: readonly ProjectKind[] = []): Result<ProjectKind> {
  const label = String(input.label ?? '').trim()
  if (label.length === 0) return { ok: false, error: invalid('类型名称不能为空') }
  if (label.length > 20) return { ok: false, error: invalid('类型名称不能超过 20 字符') }

  const taken = new Set(existing.map((kind) => kind.id))
  const rawId = String(input.id ?? '').trim().toLowerCase()
  if (rawId.length > 0) {
    if (!isKindId(rawId)) return { ok: false, error: invalid(`类型 id 非法（需匹配 ${KIND_ID_RE.source}）: ${rawId}`) }
    if (BUILTIN_KIND_IDS.includes(rawId) || rawId === 'custom') {
      return { ok: false, error: invalid(`类型 id 为保留字: ${rawId}`) }
    }
    if (taken.has(rawId)) return { ok: false, error: invalid(`类型 id 已存在: ${rawId}`) }
  }

  const baseId = rawId || kindSlug(label) || 'kind'
  let id = baseId
  let seq = 2
  while (taken.has(id) || BUILTIN_KIND_IDS.includes(id) || id === 'custom') {
    id = `${baseId}-${seq}`
    seq += 1
  }

  const genres: KindGenre[] = []
  const seenGenre = new Set<string>()
  for (const raw of input.genres ?? []) {
    const genreLabel = String(raw?.label ?? '').trim()
    if (!genreLabel) continue
    const rawGenreId = String(raw?.id ?? '').trim().toLowerCase()
    let genreId = rawGenreId
    if (!genreId) {
      genreId = kindSlug(genreLabel) || `genre-${seenGenre.size + 1}`
    } else if (!GENRE_ID_RE.test(genreId)) {
      return { ok: false, error: invalid(`题材 id 非法: ${rawGenreId}`) }
    }
    if (seenGenre.has(genreId)) {
      let n = 2
      while (seenGenre.has(`${genreId}-${n}`)) n += 1
      genreId = `${genreId}-${n}`
    }
    seenGenre.add(genreId)
    genres.push({ id: genreId, label: genreLabel.slice(0, 20) })
  }
  if (genres.length > 50) return { ok: false, error: invalid('题材数量不能超过 50 个') }

  const templateId = String(input.templateId ?? '').trim() || GENERIC_TEMPLATE.id
  if (!builtinTemplateById(templateId)) return { ok: false, error: invalid(`未知工作流模板: ${templateId}`) }

  return {
    ok: true,
    value: {
      id,
      label,
      labelEn: String(input.labelEn ?? '').trim() || id,
      icon: String(input.icon ?? '').trim().slice(0, 4) || '✨',
      description: String(input.description ?? '').trim().slice(0, 60),
      genres,
      builtin: false,
      templateId,
    },
  }
}

/** 中文/英文标签 → 小写 slug（非 ASCII 时回退空串，由调用方兜底）。 */
export function kindSlug(text: string): string {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}
