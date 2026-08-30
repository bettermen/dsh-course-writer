/**
 * xiashuo — 课程项目域类型（P1-B）。
 */
import type { PhaseId, PhaseRecord } from '../workflow/types.ts'
import type { ProjectStatus } from './status.ts'

/** P2 之前的历史状态取值（磁盘上仍可能存在）。 */
export type LegacyBookStatus = 'drafting' | 'finished' | 'abandoned'

/**
 * 项目状态（**磁盘态**，详见 core/novel/status.ts）。
 *
 * P2 起为五态：草稿 / 进行中 / 暂停 / 已完成 / 已归档；
 * 历史三态 `drafting / finished / abandoned` 仍在类型内，代表"从旧 book.json
 * 读到的原始值"——存储层在读取时归一到五态（惰性迁移，不批量重写）。
 *
 * 对外契约（BookSummary / API）一律是归一后的 `ProjectStatus`。
 */
export type BookStatus = ProjectStatus | LegacyBookStatus

/**
 * 项目类型 id（见 core/kinds.ts：course/official/novel/thesis + 用户自定义）。
 *
 * 可选字段：旧项目（P1 之前创建）没有此字段，加载时惰性补 `DEFAULT_KIND_ID`
 * （'course'），保证零迁移。新项目一律显式写入。
 */
export type KindId = string

/** 项目级配置（P1 基础字段；P2 起扩展 style/校验等）。 */
export interface BookConfig {
  title: string
  author?: string
  /** 类型模板 id（P2 模板库接入）。 */
  genre: string
  /** 每章目标字数区间（主口径 totalChars）。 */
  wordTargets: {
    perChapterMin: number
    perChapterMax: number
  }
  /** 风格约束（P2 样式表扩展）。 */
  style: {
    pov: 'first' | 'third'
    forbiddenWords: string[]
    aiTasteWords: string[]
  }
  /** 阶段门禁开关（false = 允许口头跳阶段，默认 true 强制）。 */
  phaseGating: boolean
}

/** 课时元数据（讲义存 chapters/ch<no>.md，frontmatter 内嵌本结构）。 */
export interface Chapter {
  no: number
  title: string
  status: 'draft' | 'revised' | 'approved'
  /** 修订次数。 */
  version: number
  /** 主口径字数（totalChars，P1-F 统计接线后写入）。 */
  words: number
  /** 一句话梗概（教案对照用）。 */
  brief?: string
  createdAt: string
  updatedAt: string
}

/** 课程项目核心状态（book.json，VersionedFile 外壳）。 */
export interface Book {
  id: string
  title: string
  genre: string
  /** 项目类型（决定默认工作流模板）。旧项目缺失时按 DEFAULT_KIND_ID 处理。 */
  kind?: KindId
  /** 一句话简介（首页卡片展示；P2 新增，旧项目缺省）。 */
  description?: string
  status: BookStatus
  config: BookConfig
  /** 流程状态机面（workflow 引擎直接操作）。 */
  phases: Record<PhaseId, PhaseRecord>
  currentPhase: PhaseId
  stats: {
    totalWords: number
    chapterCount: number
    lastWriteAt?: string
  }
  createdAt: string
  updatedAt: string
  schemaVersion: number
}

/** 列表摘要（避免整本加载）。 */
export interface BookSummary {
  id: string
  title: string
  genre: string
  /** 项目类型（恒有值：缺失时由存储层补 DEFAULT_KIND_ID）。 */
  kind: KindId
  /** 一句话简介（缺省为空串，便于首页直接渲染）。 */
  description: string
  /** 归一后的项目状态（恒为五态之一）。 */
  status: ProjectStatus
  /** 类型名（首页卡片免查类型表；由路由层填充，存储层给 id 兜底）。 */
  kindLabel?: string
  /** 流程进度：已完成阶段数 / 总阶段数（首页进度条；缺省 0/0）。 */
  phaseDone?: number
  phaseTotal?: number
  currentPhase: PhaseId
  chapterCount: number
  totalWords: number
  createdAt: string
  updatedAt: string
}
