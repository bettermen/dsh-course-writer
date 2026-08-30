import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHASE_ORDER,
  canEnter,
  createLedger,
  enter,
  nextPhaseOf,
  prevPhaseOf,
  rollback,
  submit,
  terminalPhaseOf,
} from '../src/core/workflow/index.ts'
import { phaseOrderOf } from '../src/core/workflow/schema.ts'
import { OFFICIAL_TEMPLATE, THESIS_TEMPLATE, builtinTemplateOf } from '../src/core/workflow/templates.ts'
import type { PhaseLedger, PhaseRecord } from '../src/core/workflow/index.ts'

const NOW = '2026-08-30T00:00:00.000Z'

/** 取阶段记录（noUncheckedIndexedAccess 下集中判空）。 */
function at(ledger: PhaseLedger, id: string): PhaseRecord {
  const record = ledger.phases[id]
  if (!record) throw new Error(`阶段记录缺失: ${id}`)
  return record
}

/** 公文流程（7 阶段，无 revision）。 */
const OFFICIAL = phaseOrderOf(OFFICIAL_TEMPLATE)
/** 论文流程（8 阶段，含 revision）。 */
const THESIS = phaseOrderOf(THESIS_TEMPLATE)

/** 按给定顺序一路批准到 targetIndex（含）。 */
function approveThrough(ledger: PhaseLedger, order: readonly string[], targetIndex: number): PhaseLedger {
  let current = ledger
  for (let i = 0; i <= targetIndex; i += 1) {
    const phaseId = order[i]!
    const entered = enter(current, phaseId, NOW, 'agent', { order })
    if (!entered.ok) throw new Error(`enter ${phaseId} 失败: ${entered.error.message}`)
    const submitted = submit(entered.value.ledger, phaseId, { passed: true, errorCount: 0, warningCount: 0 }, NOW)
    if (!submitted.ok) throw new Error(`submit ${phaseId} 失败: ${submitted.error.message}`)
    current = submitted.value.ledger
  }
  return current
}

describe('workflow — 动态阶段顺序', () => {
  it('createLedger 按传入顺序建立记录，首阶段为 currentPhase', () => {
    const ledger = createLedger('bk_1', NOW, { order: OFFICIAL })
    expect(Object.keys(ledger.phases)).toEqual(OFFICIAL)
    expect(ledger.currentPhase).toBe('brief')
    expect(Object.values(ledger.phases).every((p) => p.state === 'locked')).toBe(true)
  })

  it('省略 order 时回退旧九阶段（向后兼容）', () => {
    const ledger = createLedger('bk_1', NOW)
    expect(Object.keys(ledger.phases)).toEqual([...DEFAULT_PHASE_ORDER])
    expect(ledger.currentPhase).toBe('topic')
  })

  it('order 为空数组时同样回退默认顺序', () => {
    expect(Object.keys(createLedger('bk_1', NOW, { order: [] }).phases)).toEqual([...DEFAULT_PHASE_ORDER])
  })

  it('相邻查询按动态顺序判定', () => {
    expect(nextPhaseOf('brief', { order: OFFICIAL })).toBe('research')
    expect(nextPhaseOf('done', { order: OFFICIAL })).toBeNull()
    expect(prevPhaseOf('research', { order: OFFICIAL })).toBe('brief')
    expect(prevPhaseOf('brief', { order: OFFICIAL })).toBeNull()
    // 不在流程内的阶段一律 null
    expect(nextPhaseOf('writing', { order: OFFICIAL })).toBeNull()
  })

  it('terminalPhaseOf 取流程末阶段', () => {
    expect(terminalPhaseOf({ order: OFFICIAL })).toBe('done')
    expect(terminalPhaseOf({ order: THESIS })).toBe('done')
    expect(terminalPhaseOf()).toBe('done')
  })

  it('canEnter 拒绝不在流程内的阶段', () => {
    const ledger = createLedger('bk_1', NOW, { order: OFFICIAL })
    const gate = canEnter(ledger, 'writing', { order: OFFICIAL })
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.reason).toContain('未知阶段')
  })

  it('门禁按动态前置判定：跳过前置后可进入', () => {
    const ledger = createLedger('bk_1', NOW, { order: OFFICIAL })
    expect(canEnter(ledger, 'research', { order: OFFICIAL }).ok).toBe(false)
    const entered = enter(ledger, 'brief', NOW, 'agent', { order: OFFICIAL })
    if (!entered.ok) throw new Error('enter brief')
    const submitted = submit(entered.value.ledger, 'brief', { passed: true, errorCount: 0, warningCount: 0 }, NOW)
    if (!submitted.ok) throw new Error('submit brief')
    expect(canEnter(submitted.value.ledger, 'research', { order: OFFICIAL }).ok).toBe(true)
  })

  it('流程新增阶段后首次进入时惰性建立记录', () => {
    // 模拟老项目：建项目时只有 7 阶段，走完后用户往流程里新增了 publish
    const ledger = approveThrough(createLedger('bk_1', NOW, { order: OFFICIAL }), OFFICIAL, OFFICIAL.length - 1)
    expect(ledger.phases['publish']).toBeUndefined()
    const order = [...OFFICIAL, 'publish']
    const entered = enter(ledger, 'publish', NOW, 'agent', { order })
    expect(entered.ok).toBe(true)
    if (entered.ok) {
      expect(at(entered.value.ledger, 'publish').state).toBe('in_progress')
      expect(at(entered.value.ledger, 'publish').version).toBe(0)
    }
  })
})

describe('workflow — 回退规则动态化', () => {
  it('无 revision 的流程：仅末阶段可发起回退', () => {
    const done = approveThrough(createLedger('bk_1', NOW, { order: OFFICIAL }), OFFICIAL, OFFICIAL.length - 1)
    // 中途阶段发起 → 拒绝
    const midway = approveThrough(createLedger('bk_2', NOW, { order: OFFICIAL }), OFFICIAL, 3)
    const refused = rollback(midway, 'outline', NOW, 'user', { order: OFFICIAL })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.message).toContain('仅 done 阶段可回退')
    // 末阶段发起 → 允许
    const rolled = rollback(done, 'outline', NOW, 'user', { order: OFFICIAL })
    expect(rolled.ok).toBe(true)
    if (rolled.ok) {
      expect(rolled.value.ledger.currentPhase).toBe('outline')
      expect(at(rolled.value.ledger, 'outline').state).toBe('in_progress')
      // outline 之后的阶段解锁
      expect(at(rolled.value.ledger, 'draft').state).toBe('locked')
      expect(at(rolled.value.ledger, 'done').state).toBe('locked')
      // 之前的保持 approved
      expect(at(rolled.value.ledger, 'brief').state).toBe('approved')
    }
  })

  it('含 revision 的流程：revision 与末阶段均可发起回退', () => {
    const order = THESIS
    const revisionIndex = order.indexOf('revision')
    const atRevision = approveThrough(createLedger('bk_1', NOW, { order }), order, revisionIndex)
    const rolled = rollback(atRevision, 'method', NOW, 'user', { order })
    expect(rolled.ok).toBe(true)
    if (rolled.ok) expect(rolled.value.ledger.currentPhase).toBe('method')
  })

  it('不能回退到终态阶段或 revision', () => {
    const done = approveThrough(createLedger('bk_1', NOW, { order: THESIS }), THESIS, THESIS.length - 1)
    const toTerminal = rollback(done, 'done', NOW, 'user', { order: THESIS })
    expect(toTerminal.ok).toBe(false)
    if (!toTerminal.ok) expect(toTerminal.error.message).toContain('终态阶段')
    const toRevision = rollback(done, 'revision', NOW, 'user', { order: THESIS })
    expect(toRevision.ok).toBe(false)
    if (!toRevision.ok) expect(toRevision.error.message).toContain('revision')
  })

  it('拒绝不在流程内的回退目标', () => {
    const done = approveThrough(createLedger('bk_1', NOW, { order: OFFICIAL }), OFFICIAL, OFFICIAL.length - 1)
    const result = rollback(done, 'writing', NOW, 'user', { order: OFFICIAL })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('不在当前流程中')
  })

  it('用户自定义流程（两阶段）也能正常回退', () => {
    const order = ['plan', 'ship']
    const done = approveThrough(createLedger('bk_1', NOW, { order }), order, 1)
    const rolled = rollback(done, 'plan', NOW, 'user', { order })
    expect(rolled.ok).toBe(true)
    if (rolled.ok) {
      expect(rolled.value.ledger.currentPhase).toBe('plan')
      expect(at(rolled.value.ledger, 'ship').state).toBe('locked')
    }
  })
})

describe('workflow — 克隆保留遗留记录', () => {
  it('流程删除阶段后，其历史记录仍在 ledger 中（由上层决定是否清理）', () => {
    const full = approveThrough(createLedger('bk_1', NOW, { order: OFFICIAL }), OFFICIAL, 2)
    const trimmed = OFFICIAL.filter((id) => id !== 'outline')
    const entered = enter(full, 'draft', NOW, 'agent', { order: trimmed })
    expect(entered.ok).toBe(true)
    if (entered.ok) {
      // 被移除的 outline 记录仍在（未被静默丢弃）
      expect(at(entered.value.ledger, 'outline').state).toBe('approved')
      expect(at(entered.value.ledger, 'draft').state).toBe('in_progress')
    }
  })

  it('内置模板的阶段顺序与类型匹配', () => {
    expect(OFFICIAL).toEqual(['brief', 'research', 'outline', 'draft', 'review', 'approve', 'done'])
    expect(THESIS).toEqual(['topic', 'literature', 'method', 'outline', 'draft', 'analysis', 'revision', 'done'])
    expect(phaseOrderOf(builtinTemplateOf('course'))).toEqual([...DEFAULT_PHASE_ORDER])
    // 未知类型回退通用模板
    expect(builtinTemplateOf('nope').id).toBe('builtin-generic')
  })
})
