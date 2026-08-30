import { describe, expect, it } from 'vitest'
import {
  cloneWorkflow,
  createPhase,
  insertPhase,
  isPhaseId,
  nextPhaseIn,
  phaseOrderOf,
  prevPhaseIn,
  removePhase,
  renamePhase,
  reorderPhase,
  uniquePhaseId,
  updatePhase,
  validateWorkflow,
} from '../src/core/workflow/schema.ts'
import {
  BUILTIN_TEMPLATES,
  builtinTemplateById,
  builtinTemplateOf,
  COURSE_TEMPLATE,
  GENERIC_TEMPLATE,
  isBuiltinTemplateId,
} from '../src/core/workflow/templates.ts'

describe('workflow/schema — 校验', () => {
  it('内置模板全部通过校验', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      const result = validateWorkflow(tpl)
      expect(result.ok, `${tpl.id}: ${result.ok ? '' : result.error.message}`).toBe(true)
    }
  })

  it('拒绝空阶段列表 / 非对象 / 缺字段', () => {
    expect(validateWorkflow(null).ok).toBe(false)
    expect(validateWorkflow([]).ok).toBe(false)
    expect(validateWorkflow({ ...COURSE_TEMPLATE, phases: [] }).ok).toBe(false)
    expect(validateWorkflow({ ...COURSE_TEMPLATE, id: '' }).ok).toBe(false)
    expect(validateWorkflow({ ...COURSE_TEMPLATE, kind: '  ' }).ok).toBe(false)
    expect(validateWorkflow({ ...COURSE_TEMPLATE, scope: 'nope' }).ok).toBe(false)
  })

  it('拒绝非法阶段 id、重复 id、空名称、非法门禁', () => {
    const base = GENERIC_TEMPLATE
    const badId = cloneWorkflow(base)
    badId.phases[0]!.id = 'Bad Id'
    expect(validateWorkflow(badId).ok).toBe(false)

    const dupId = cloneWorkflow(base)
    dupId.phases[1]!.id = dupId.phases[0]!.id
    expect(validateWorkflow(dupId).ok).toBe(false)

    const emptyName = cloneWorkflow(base)
    emptyName.phases[0]!.name = '  '
    expect(validateWorkflow(emptyName).ok).toBe(false)

    const badGate = cloneWorkflow(base)
    badGate.phases[0]!.gate = 'magic' as never
    expect(validateWorkflow(badGate).ok).toBe(false)
  })

  it('拒绝非法产物类型 / 缺 label / 负 min', () => {
    const wf = cloneWorkflow(GENERIC_TEMPLATE)
    wf.phases[0]!.artifacts = [{ kind: 'nope' as never, label: 'x' }]
    expect(validateWorkflow(wf).ok).toBe(false)

    const noLabel = cloneWorkflow(GENERIC_TEMPLATE)
    noLabel.phases[0]!.artifacts = [{ kind: 'doc', label: '  ' }]
    expect(validateWorkflow(noLabel).ok).toBe(false)

    const badMin = cloneWorkflow(GENERIC_TEMPLATE)
    badMin.phases[0]!.artifacts = [{ kind: 'wordcount', label: '字数', min: -1 }]
    expect(validateWorkflow(badMin).ok).toBe(false)
  })

  it('isPhaseId 形状判定', () => {
    expect(isPhaseId('topic')).toBe(true)
    expect(isPhaseId('phase-2')).toBe(true)
    expect(isPhaseId('my_phase')).toBe(true)
    expect(isPhaseId('2phase')).toBe(false)
    expect(isPhaseId('中文')).toBe(false)
    expect(isPhaseId('')).toBe(false)
  })
})

describe('workflow/schema — 增删改序', () => {
  it('insertPhase 按位置插入且不改原对象', () => {
    const before = phaseOrderOf(GENERIC_TEMPLATE)
    const result = insertPhase(GENERIC_TEMPLATE, { id: 'extra', name: '附加', gate: 'manual', artifacts: [] }, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(phaseOrderOf(result.value)).toEqual([before[0]!, 'extra', ...before.slice(1)])
    expect(phaseOrderOf(GENERIC_TEMPLATE)).toEqual(before)
  })

  it('insertPhase 越界下标追加到末尾，重复 id 拒绝', () => {
    const ok = insertPhase(GENERIC_TEMPLATE, { id: 'last', name: '末尾', gate: 'manual', artifacts: [] }, 99)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(phaseOrderOf(ok.value).at(-1)).toBe('last')

    const dup = insertPhase(GENERIC_TEMPLATE, { id: 'topic', name: '重复', gate: 'manual', artifacts: [] }, 0)
    expect(dup.ok).toBe(false)
  })

  it('removePhase 删除指定阶段，最后一个阶段拒绝删除', () => {
    const result = removePhase(GENERIC_TEMPLATE, 'outline')
    expect(result.ok).toBe(true)
    if (result.ok) expect(phaseOrderOf(result.value)).not.toContain('outline')

    expect(removePhase(GENERIC_TEMPLATE, 'nope').ok).toBe(false)

    const single: typeof GENERIC_TEMPLATE = { ...GENERIC_TEMPLATE, phases: [GENERIC_TEMPLATE.phases[0]!] }
    expect(removePhase(single, single.phases[0]!.id).ok).toBe(false)
  })

  it('renamePhase 与 updatePhase 局部更新', () => {
    const renamed = renamePhase(GENERIC_TEMPLATE, 'draft', '写作')
    expect(renamed.ok).toBe(true)
    if (renamed.ok) expect(renamed.value.phases.find((p) => p.id === 'draft')?.name).toBe('写作')
    expect(renamePhase(GENERIC_TEMPLATE, 'draft', '   ').ok).toBe(false)

    const updated = updatePhase(GENERIC_TEMPLATE, 'draft', { gate: 'ai', rubric: '无 AI 味' })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      const phase = updated.value.phases.find((p) => p.id === 'draft')
      expect(phase?.gate).toBe('ai')
      expect(phase?.rubric).toBe('无 AI 味')
    }
    expect(updatePhase(GENERIC_TEMPLATE, 'nope', { gate: 'none' }).ok).toBe(false)
  })

  it('reorderPhase 拖拽排序（前移 / 后移 / 越界拒绝）', () => {
    const before = phaseOrderOf(GENERIC_TEMPLATE)
    const moved = reorderPhase(GENERIC_TEMPLATE, 0, 2)
    expect(moved.ok).toBe(true)
    if (moved.ok) {
      expect(phaseOrderOf(moved.value)).toEqual([before[1]!, before[2]!, before[0]!, ...before.slice(3)])
    }
    expect(reorderPhase(GENERIC_TEMPLATE, 0, 99).ok).toBe(false)
    expect(reorderPhase(GENERIC_TEMPLATE, -1, 1).ok).toBe(false)
  })

  it('createPhase / uniquePhaseId 生成唯一合法 id', () => {
    const phase = createPhase(GENERIC_TEMPLATE, '同行评议', '同行评议')
    expect(isPhaseId(phase.id)).toBe(true)
    expect(phase.gate).toBe('manual')

    const inserted = insertPhase(GENERIC_TEMPLATE, phase, 0)
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    const second = createPhase(inserted.value, '同行评议', '同行评议')
    expect(second.id).not.toBe(phase.id)
  })

  it('nextPhaseIn / prevPhaseIn 相邻阶段', () => {
    expect(nextPhaseIn(GENERIC_TEMPLATE, 'topic')).toBe('outline')
    expect(nextPhaseIn(GENERIC_TEMPLATE, 'done')).toBeNull()
    expect(nextPhaseIn(GENERIC_TEMPLATE, 'nope')).toBeNull()
    expect(prevPhaseIn(GENERIC_TEMPLATE, 'topic')).toBeNull()
    expect(prevPhaseIn(GENERIC_TEMPLATE, 'outline')).toBe('topic')
  })

  it('cloneWorkflow 深拷贝（改副本不影响原对象）', () => {
    const copy = cloneWorkflow(GENERIC_TEMPLATE)
    copy.phases[0]!.name = '改过'
    copy.phases[0]!.artifacts.push({ kind: 'doc', label: 'x' })
    expect(GENERIC_TEMPLATE.phases[0]!.name).not.toBe('改过')
    expect(GENERIC_TEMPLATE.phases[0]!.artifacts.length).toBe(1)
  })
})

describe('workflow/templates — 内置模板', () => {
  it('四套类型模板阶段数符合设计', () => {
    expect(COURSE_TEMPLATE.phases.length).toBe(9)
    expect(builtinTemplateOf('official').phases.length).toBe(7)
    expect(builtinTemplateOf('novel').phases.length).toBe(9)
    expect(builtinTemplateOf('thesis').phases.length).toBe(8)
  })

  it('课程模板阶段 id 沿用旧九阶段（老项目零迁移）', () => {
    expect(phaseOrderOf(COURSE_TEMPLATE)).toEqual([
      'topic', 'setting', 'character', 'outline', 'volume', 'chapter', 'writing', 'revision', 'done',
    ])
  })

  it('每个阶段都有中文名与英文名（i18n 就绪）', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      expect(tpl.nameEn?.length ?? 0).toBeGreaterThan(0)
      for (const phase of tpl.phases) {
        expect(phase.name.length, `${tpl.id}/${phase.id} 缺中文名`).toBeGreaterThan(0)
        expect(phase.nameEn?.length ?? 0, `${tpl.id}/${phase.id} 缺英文名`).toBeGreaterThan(0)
        expect(phase.description?.length ?? 0, `${tpl.id}/${phase.id} 缺说明`).toBeGreaterThan(0)
      }
    }
  })

  it('gate=ai 的阶段必须带 rubric（评审有据可依）', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      for (const phase of tpl.phases) {
        if (phase.gate === 'ai') {
          expect(phase.rubric?.length ?? 0, `${tpl.id}/${phase.id} gate=ai 缺少 rubric`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('内置模板只读判定与按 id 查询', () => {
    expect(isBuiltinTemplateId('builtin-course')).toBe(true)
    expect(isBuiltinTemplateId('user-xxx')).toBe(false)
    expect(builtinTemplateById('builtin-novel')?.kind).toBe('novel')
    expect(builtinTemplateById('nope')).toBeUndefined()
    // 未知类型回退通用模板
    expect(builtinTemplateOf('unknown-kind').id).toBe(GENERIC_TEMPLATE.id)
  })
})
