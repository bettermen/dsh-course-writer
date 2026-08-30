/**
 * xiashuo — 项目状态字典（P2）。
 *
 * P2 之前项目只有 `drafting / finished / abandoned` 三态，无法表达首页需要的
 * 「草稿 / 进行中 / 暂停 / 已完成 / 已归档」。本模块定义新的五态取值，并给出
 * 旧取值 → 新取值的归一映射。
 *
 * 归一**只发生在读取时**（惰性迁移，与 `kind` 字段同一策略）：book.json
 * 不做批量重写，旧项目原样保留历史值，下次保存时才写成新值。
 *
 * 纯数据 + 纯函数：零 IO、零 cordis 依赖（AGENTS.md 架构分层要求）。
 */

/** 项目状态取值（顺序即首页筛选器的展示顺序）。 */
export const PROJECT_STATUSES = ['draft', 'in_progress', 'paused', 'done', 'archived'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** P2 之前的历史取值 → 新取值（仅用于读取旧数据）。 */
export const LEGACY_STATUS_MAP: Readonly<Record<string, ProjectStatus>> = Object.freeze({
  drafting: 'in_progress',
  finished: 'done',
  abandoned: 'archived',
})

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value)
}

/**
 * 归一为项目状态。
 * - 已是新取值 → 原样返回；
 * - 是历史取值 → 按 LEGACY_STATUS_MAP 映射；
 * - 其余（缺失/未知字符串/null）→ 回落 `draft`。
 */
export function normalizeStatus(value: unknown): ProjectStatus {
  if (isProjectStatus(value)) return value
  if (typeof value === 'string') {
    const mapped = LEGACY_STATUS_MAP[value.trim().toLowerCase()]
    if (mapped) return mapped
  }
  return 'draft'
}

/** 状态是否属于「已结束」（归档/完成）——首页默认折叠与统计口径用。 */
export function isClosedStatus(status: ProjectStatus): boolean {
  return status === 'done' || status === 'archived'
}

/** 状态展示元数据（首页徽章用；tone 对应 Apple HIG 系统色）。 */
export interface StatusMeta {
  label: string
  labelEn: string
  /** 语义色：neutral 灰 / blue 蓝 / orange 橙 / green 绿。 */
  tone: 'neutral' | 'blue' | 'orange' | 'green'
}

export const STATUS_META: Readonly<Record<ProjectStatus, StatusMeta>> = Object.freeze({
  draft: { label: '草稿', labelEn: 'Draft', tone: 'neutral' },
  in_progress: { label: '进行中', labelEn: 'In progress', tone: 'blue' },
  paused: { label: '暂停', labelEn: 'Paused', tone: 'orange' },
  done: { label: '已完成', labelEn: 'Done', tone: 'green' },
  archived: { label: '已归档', labelEn: 'Archived', tone: 'neutral' },
})

/** 状态中文/英文标签（未知取值回退原值）。 */
export function statusLabel(status: ProjectStatus, lang: 'zh' | 'en' = 'zh'): string {
  const meta = STATUS_META[status]
  if (!meta) return String(status ?? '')
  return lang === 'en' ? meta.labelEn : meta.label
}
