/**
 * xiashuo — 创作流程状态机类型（P1 动态化）。
 *
 * 职责：定义阶段记录、审计事件等纯类型；阶段顺序不再由此文件固定。
 * 引擎函数见 engine.ts；持久化由 novel 存储模块负责。
 *
 * ## P1 变更：PhaseId 从联合类型放宽为 string
 *
 * 旧版本把阶段限定为 9 个字面量（topic…done），顺序写在 `PHASE_ORDER` 常量里。
 * 多类型 + 可编辑流程要求阶段集合随项目变化，故：
 *  - `PhaseId` 放宽为 `string`，顺序一律来自 `Workflow.phases`；
 *  - 旧九阶段 id 保留在 `LEGACY_PHASE_IDS`，仅作「无 workflow.json 的旧项目」的默认顺序；
 *  - 编译期保护变弱，运行期由引擎入口用传入的 order 校验未知阶段。
 */

/**
 * 阶段 id。
 *
 * 稳定 slug（正则 `^[a-z][a-z0-9_-]{0,63}$`），由 `Workflow.phases[].id` 定义。
 * 顺序不由此类型的任何属性决定 —— 一律查询 `Workflow.phases` 数组顺序。
 */
export type PhaseId = string

/**
 * 旧九阶段主链（教材编写流程）。
 *
 * 仅用于：① 无 workflow.json 的旧项目惰性迁移；② 未传入 order 的向后兼容调用路径。
 * 新项目一律以 Workflow.phases 为准。
 */
export const LEGACY_PHASE_IDS: readonly PhaseId[] = Object.freeze([
  'topic',        // 选题
  'setting',      // 学情设定
  'character',    // 教学目标
  'outline',      // 课程大纲
  'volume',       // 单元设计
  'chapter',      // 课时教案
  'writing',      // 课件与练习
  'revision',     // 评估修订
  'done',         // 结课
])

/** 阶段实例状态。 */
export type PhaseState = 'locked' | 'in_progress' | 'review' | 'approved' | 'skipped'

/** 阶段产物校验报告摘要（提交门禁用；完整报告由 quality 模块产出）。 */
export interface PhaseReport {
  /** 是否通过门禁（无 error 级问题）。 */
  passed: boolean
  /** error 级问题数（>0 时进入 review 挂起）。 */
  errorCount: number
  /** warning 级问题数（仅提示不阻断）。 */
  warningCount: number
  /** 校验器集合 id（调试/审计用）。 */
  rules?: string[]
}

/** 单个阶段的持久化记录。 */
export interface PhaseRecord {
  id: PhaseId
  state: PhaseState
  /** 产物修订次数（每次 commit +1；版本快照见存储层）。 */
  version: number
  /** 最近一次提交的校验报告摘要。 */
  lastReport?: PhaseReport
  /** 进入 approved 的时间。 */
  approvedAt?: string
  /** 进入 in_progress 的时间。 */
  startedAt?: string
}

/**
 * 阶段记录表。
 *
 * 键集合随项目工作流变化（noUncheckedIndexedAccess 下取值恒为 `PhaseRecord | undefined`），
 * 引擎内部统一用 `recordOf()` 取并判空。
 */
export type PhaseMap = Record<PhaseId, PhaseRecord>

/** 审计事件（append-only；audit.jsonl 每行一条）。 */
export interface AuditEvent {
  seq: number
  at: string
  /** `update` 为 P2 新增：项目元信息改动（标题/简介/状态/类型）与工作流编辑。 */
  action: 'enter' | 'submit' | 'reopen' | 'skip' | 'force' | 'rollback' | 'create' | 'delete' | 'reorder' | 'update'
  phase: PhaseId
  /** 触发方：user | agent | system。 */
  actor: 'user' | 'agent' | 'system'
  /** 结果摘要（如 "approved" / "review(2 errors)" / "skipped"）。 */
  detail: string
}

/** 状态机操作的最小视图（Book 的 workflow 面；完整 Book 见 novel 存储模块）。 */
export interface PhaseLedger {
  id: string
  phases: PhaseMap
  currentPhase: PhaseId
}
