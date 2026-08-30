/**
 * xiashuo — 流程状态机引擎（P1 动态化）。
 *
 * 纯函数设计：所有操作接收 PhaseLedger 返回新 ledger + 审计事件，
 * 无 IO 无 cordis 依赖（持久化在 novel 存储模块）。
 *
 * ## 动态顺序
 *
 * 阶段顺序不再由编译期常量固定，而是由调用方通过 `EngineContext.order`
 * 传入（取自 `Workflow.phases` 数组）。缺省时回退 `DEFAULT_PHASE_ORDER`
 * （旧九阶段），仅供无 workflow.json 的旧项目与既有调用路径兼容。
 *
 * 门禁规则：
 *  1. 前一阶段必须 approved 或 skipped，当前阶段才能 in_progress；
 *  2. submit 时 report.errorCount>0 → review 挂起（不自动推进）；
 *  3. 校验通过 → approved；
 *  4. 用户可 force（强制放行）或 reopen（驳回回 in_progress）；
 *  5. 终态阶段（末阶段）与 revision 允许 rollback 到任意已 approved/skipped 阶段；
 *  6. 末阶段为终态。
 */
import type { PluginError, Result } from '../types.ts'
import { LEGACY_PHASE_IDS } from './types.ts'
import type { AuditEvent, PhaseId, PhaseLedger, PhaseMap, PhaseRecord, PhaseReport, PhaseState } from './types.ts'

/**
 * 默认阶段顺序（旧九阶段主链）。
 *
 * 仅在未传入 `EngineContext.order` 时使用 —— 用于旧项目惰性迁移与向后兼容。
 * 新代码请显式传入项目工作流的阶段顺序。
 */
export const DEFAULT_PHASE_ORDER: readonly PhaseId[] = LEGACY_PHASE_IDS

/**
 * 引擎上下文：动态流程下由调用方注入阶段顺序。
 */
export interface EngineContext {
  /**
   * 阶段 id 顺序，取自 `phaseOrderOf(workflow)`。
   * 传空数组或省略时回退 `DEFAULT_PHASE_ORDER`。
   */
  order?: readonly PhaseId[]
}

function invalid(message: string): PluginError {
  return { code: 'INVALID_STATE', message }
}

/** 解析生效的阶段顺序（空数组 → 默认九阶段）。 */
function orderOf(ctx: EngineContext): readonly PhaseId[] {
  const order = ctx.order?.filter((id) => typeof id === 'string' && id.length > 0) ?? []
  return order.length > 0 ? order : DEFAULT_PHASE_ORDER
}

/** 阶段在流程中的下标（-1 = 不在流程内）。 */
export function indexOfPhase(order: readonly PhaseId[], id: PhaseId): number {
  return order.indexOf(id)
}

/** 取阶段记录（noUncheckedIndexedAccess 下统一在此判空）。 */
export function recordOf(ledger: PhaseLedger, phaseId: PhaseId): PhaseRecord | undefined {
  return ledger.phases[phaseId]
}

/** 缺失阶段记录的兜底值（引擎在阶段被新增到流程后首次访问时惰性建立）。 */
function blankRecord(phaseId: PhaseId): PhaseRecord {
  return { id: phaseId, state: 'locked', version: 0 }
}

/** 相邻下一阶段（末阶段之后为 null）。 */
export function nextPhaseOf(id: PhaseId, ctx: EngineContext = {}): PhaseId | null {
  const order = orderOf(ctx)
  const index = indexOfPhase(order, id)
  return index < 0 ? null : (order[index + 1] ?? null)
}

/** 相邻上一阶段（首阶段之前为 null）。 */
export function prevPhaseOf(id: PhaseId, ctx: EngineContext = {}): PhaseId | null {
  const order = orderOf(ctx)
  const index = indexOfPhase(order, id)
  return index <= 0 ? null : (order[index - 1] ?? null)
}

/** 流程末阶段（终态）。 */
export function terminalPhaseOf(ctx: EngineContext = {}): PhaseId {
  const order = orderOf(ctx)
  return order[order.length - 1] ?? DEFAULT_PHASE_ORDER[DEFAULT_PHASE_ORDER.length - 1]!
}

/**
 * 阶段推进许可判定：前一阶段必须 approved/skipped（首阶段恒可进）。
 * 未知阶段（不在 order 内）一律拒绝。
 */
export function canEnter(ledger: PhaseLedger, phaseId: PhaseId, ctx: EngineContext = {}): { ok: true } | { ok: false; reason: string } {
  const order = orderOf(ctx)
  const index = indexOfPhase(order, phaseId)
  if (index < 0) return { ok: false, reason: `未知阶段: ${phaseId}` }
  const previous = order[index - 1]
  if (previous === undefined) return { ok: true }
  const record = recordOf(ledger, previous)
  if (!record) return { ok: false, reason: `前置阶段 ${previous} 尚未建立` }
  if (record.state === 'approved' || record.state === 'skipped') return { ok: true }
  return { ok: false, reason: `前置阶段 ${previous} 处于 ${record.state}，需 approved/skipped 后才能进入 ${phaseId}` }
}

/** 新建 ledger（项目创建时调用；首阶段直接可进入）。 */
export function createLedger(id: string, now: string, ctx: EngineContext = {}): PhaseLedger {
  const order = orderOf(ctx)
  const phases: PhaseMap = {}
  for (const phaseId of order) {
    phases[phaseId] = { id: phaseId, state: 'locked' as PhaseState, version: 0 }
  }
  const first = order[0] ?? DEFAULT_PHASE_ORDER[0]!
  return { id, phases, currentPhase: first }
}

/** 进入阶段（门禁未过返回 INVALID_STATE）。已 approved/skipped 的阶段不可重入（须先驳回）。 */
export function enter(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'agent',
  ctx: EngineContext = {},
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const gate = canEnter(ledger, phaseId, ctx)
  if (!gate.ok) return { ok: false, error: invalid(gate.reason) }
  const existing = recordOf(ledger, phaseId)
  if (existing && (existing.state === 'approved' || existing.state === 'skipped')) {
    return { ok: false, error: invalid(`阶段 ${phaseId} 已 ${existing.state}，不能重复进入（需先驳回）`) }
  }
  const next = clone(ledger, ctx)
  next.currentPhase = phaseId
  next.phases[phaseId] = { ...(existing ?? blankRecord(phaseId)), state: 'in_progress', startedAt: now }
  const event: AuditEvent = { seq: 0, at: now, action: 'enter', phase: phaseId, actor, detail: 'in_progress' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/**
 * 提交阶段产物（唯一推进入口语义）：
 * report.passed → approved；errorCount>0 → review 挂起；其余按 passed 判定。
 */
export function submit(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  report: PhaseReport,
  now: string,
  actor: AuditEvent['actor'] = 'agent',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = recordOf(ledger, phaseId)
  if (!record || record.state !== 'in_progress' && record.state !== 'review') {
    return { ok: false, error: invalid(`阶段 ${phaseId} 当前状态 ${record?.state ?? '缺失'}，不能提交`) }
  }
  const next = clone(ledger)
  const base = recordOf(next, phaseId) ?? blankRecord(phaseId)
  const target: PhaseState = report.errorCount > 0 ? 'review' : report.passed ? 'approved' : 'review'
  next.phases[phaseId] = {
    ...base,
    state: target,
    version: base.version + 1,
    lastReport: report,
    ...(target === 'approved' ? { approvedAt: now } : {}),
  }
  const detail = target === 'approved' ? 'approved' : `review(${report.errorCount} errors, ${report.warningCount} warnings)`
  const event: AuditEvent = { seq: 0, at: now, action: 'submit', phase: phaseId, actor, detail }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/** 用户强制放行（review → approved；记录审计，不校验报告）。 */
export function forceApprove(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = recordOf(ledger, phaseId)
  if (!record || (record.state !== 'review' && record.state !== 'in_progress')) {
    return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能强制放行`) }
  }
  const next = clone(ledger)
  next.phases[phaseId] = { ...(recordOf(next, phaseId) ?? blankRecord(phaseId)), state: 'approved', approvedAt: now }
  const event: AuditEvent = { seq: 0, at: now, action: 'force', phase: phaseId, actor, detail: 'force approved' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/** 驳回（review/in_progress → 回 in_progress 继续修改）。 */
export function reopen(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = recordOf(ledger, phaseId)
  if (!record || record.state === 'locked' || record.state === 'approved' || record.state === 'skipped') {
    return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能驳回`) }
  }
  const next = clone(ledger)
  next.phases[phaseId] = { ...(recordOf(next, phaseId) ?? blankRecord(phaseId)), state: 'in_progress' }
  const event: AuditEvent = { seq: 0, at: now, action: 'reopen', phase: phaseId, actor, detail: 'reopened' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/** 用户跳过阶段（approved 替代语义；不改变 currentPhase 之外的推进）。 */
export function skip(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = recordOf(ledger, phaseId)
  if (!record || (record.state !== 'locked' && record.state !== 'in_progress')) {
    return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能跳过`) }
  }
  const next = clone(ledger)
  next.phases[phaseId] = { ...(recordOf(next, phaseId) ?? blankRecord(phaseId)), state: 'skipped' }
  const event: AuditEvent = { seq: 0, at: now, action: 'skip', phase: phaseId, actor, detail: 'skipped' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/**
 * 回退（修订回环）：把 currentPhase 置回目标阶段并置 in_progress。
 *
 * 规则：
 *  - 仅终态阶段（order 末位）或 revision 阶段可发起回退；
 *  - 目标必须已 approved/skipped，且不能是终态阶段或 revision；
 *  - 回退会清除目标之后阶段的 approved/skipped 状态（置 locked），保证重新走。
 */
export function rollback(
  ledger: PhaseLedger,
  target: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
  ctx: EngineContext = {},
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const order = orderOf(ctx)
  const terminal = order[order.length - 1] ?? ''
  const hasRevision = order.includes('revision')
  const allowed = Array.from(new Set(hasRevision ? ['revision', terminal] : [terminal]))
  const current = recordOf(ledger, ledger.currentPhase)
  if (!current) return { ok: false, error: invalid('当前阶段缺失') }
  if (!allowed.includes(ledger.currentPhase)) {
    return { ok: false, error: invalid(`仅 ${allowed.join('/')} 阶段可回退，当前是 ${ledger.currentPhase}`) }
  }
  if (target === terminal) return { ok: false, error: invalid(`不能回退到终态阶段 ${terminal}`) }
  if (hasRevision && target === 'revision') return { ok: false, error: invalid('不能回退到 revision 阶段') }
  const targetIndex = indexOfPhase(order, target)
  if (targetIndex < 0) return { ok: false, error: invalid(`目标阶段 ${target} 不在当前流程中`) }
  const targetRecord = recordOf(ledger, target)
  if (!targetRecord || (targetRecord.state !== 'approved' && targetRecord.state !== 'skipped')) {
    return { ok: false, error: invalid(`目标阶段 ${target} 状态 ${targetRecord?.state ?? '缺失'}，需 approved/skipped`) }
  }
  const next = clone(ledger, ctx)
  // 目标之后的已批准阶段全部解锁（重新走），并清除 approved 残留元数据
  order.forEach((phaseId, index) => {
    const record = recordOf(next, phaseId)
    if (index > targetIndex && record && (record.state === 'approved' || record.state === 'skipped')) {
      const { approvedAt: _dropped, ...rest } = record
      void _dropped
      next.phases[phaseId] = { ...rest, state: 'locked' }
    }
  })
  next.currentPhase = target
  const base = recordOf(next, target) ?? blankRecord(target)
  const { approvedAt: _targetApprovedAt, ...targetRest } = base
  void _targetApprovedAt
  next.phases[target] = { ...targetRest, state: 'in_progress', startedAt: now }
  const event: AuditEvent = { seq: 0, at: now, action: 'rollback', phase: target, actor, detail: `rolled back from ${ledger.currentPhase}` }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/**
 * 深拷贝 ledger。
 *
 * 键集合 = order ∪ 已有记录键：既覆盖流程新增的阶段，也保留流程删除后遗留的
 * 历史记录（避免旧产物记录被静默丢弃，由上层决定是否清理）。
 */
function clone(ledger: PhaseLedger, ctx: EngineContext = {}): PhaseLedger {
  const keys = new Set<PhaseId>([...orderOf(ctx), ...Object.keys(ledger.phases)])
  const phases: PhaseMap = {}
  for (const phaseId of keys) {
    const record = recordOf(ledger, phaseId)
    if (record) phases[phaseId] = { ...record }
  }
  return { id: ledger.id, currentPhase: ledger.currentPhase, phases }
}
