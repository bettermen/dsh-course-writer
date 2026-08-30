/**
 * xiashuo — 可编辑工作流 schema（P0）。
 *
 * 与旧九阶段（workflow/types.ts 的 PhaseId 联合类型）的区别：
 *  - 阶段 id 是普通 string，不再由编译期枚举限定；
 *  - 阶段顺序来自 Workflow.phases 数组顺序，不再来自 DEFAULT_PHASE_ORDER 常量；
 *  - 每个阶段携带门禁类型、必交产物、AI 提示词与评审标准，全部可编辑。
 *
 * 纯类型 + 纯函数：零 IO、零 cordis 依赖（AGENTS.md 架构分层要求）。
 */

import type { PluginError, Result } from '../types.ts'

/** 阶段门禁类型。 */
export type PhaseGate =
  /** 无门禁：可直接推进（适用于"随手记"类阶段）。 */
  | 'none'
  /** 手动确认：用户或 AI 显式 commit 才放行（默认）。 */
  | 'manual'
  /** 清单校验：必交产物齐全才放行。 */
  | 'checklist'
  /** AI 评审：按 rubric 打分，errorCount>0 时挂起 review。 */
  | 'ai'

/** 必交产物类型。 */
export type ArtifactKind =
  /** 阶段文档（docs/<phaseId>.md）。 */
  | 'doc'
  /** 章节正文（chapters/）。 */
  | 'chapter'
  /** 资料库条目（lorebook）。 */
  | 'lorebook'
  /** 字数达标。 */
  | 'wordcount'
  /** 自定义（仅登记 label，不做自动校验）。 */
  | 'custom'

/** 工作流归属范围。 */
export type WorkflowScope =
  /** 内置模板：随包分发，只读。 */
  | 'builtin'
  /** 用户模板：用户另存或新建，可增删改。 */
  | 'user'
  /** 项目实例：项目私有副本，可自由编辑。 */
  | 'project'

/** 必交产物声明。 */
export interface WorkflowArtifact {
  kind: ArtifactKind
  label: string
  /** 数量/字数下限（wordcount 为字数，chapter 为章节数，其余为条目数；缺省 1）。 */
  min?: number
}

/** 单个阶段定义（用户可自由增删改序）。 */
export interface WorkflowPhase {
  /** 稳定 id（slug 或 newId('ph')）；删除后新增不得复用，避免产物目录串味。 */
  id: string
  /** 阶段名称（用户可改）。 */
  name: string
  /** 阶段英文名（内置模板提供；用户自定义阶段无此字段时回退 name）。 */
  nameEn?: string
  /** 阶段说明（给 AI 与未来维护者看）。 */
  description?: string
  /** 门禁类型（默认 manual）。 */
  gate: PhaseGate
  /** 必交产物清单（gate='checklist' 时作为放行依据）。 */
  artifacts: WorkflowArtifact[]
  /** 该阶段的 AI 执行提示词（Agent 进入阶段时注入）。 */
  prompt?: string
  /** AI 评审标准（gate='ai' 时使用）。 */
  rubric?: string
  /** 可跳过（course_override skip 允许）。 */
  optional?: boolean
}

/** 工作流（阶段的有序列表）。 */
export interface Workflow {
  id: string
  name: string
  /** 工作流英文名（内置模板提供；用户模板无此字段时回退 name）。 */
  nameEn?: string
  /** 归属项目类型 id（见 core/kinds.ts）。 */
  kind: string
  scope: WorkflowScope
  /** 来源模板 id（内置模板自身无此字段）。 */
  templateId?: string
  phases: WorkflowPhase[]
  schemaVersion: number
}

/** 当前 workflow.json 格式版本。 */
export const WORKFLOW_SCHEMA_VERSION = 1

const GATES: readonly PhaseGate[] = ['none', 'manual', 'checklist', 'ai']
const ARTIFACT_KINDS: readonly ArtifactKind[] = ['doc', 'chapter', 'lorebook', 'wordcount', 'custom']
const SCOPES: readonly WorkflowScope[] = ['builtin', 'user', 'project']

/** 阶段 id 形状：小写字母开头，仅含小写字母/数字/下划线/连字符，1-64 字符。 */
const PHASE_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/

function invalid(message: string): PluginError {
  return { code: 'INVALID_FIELD_TYPE', message }
}

export function isPhaseGate(value: unknown): value is PhaseGate {
  return typeof value === 'string' && (GATES as readonly string[]).includes(value)
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && (ARTIFACT_KINDS as readonly string[]).includes(value)
}

export function isWorkflowScope(value: unknown): value is WorkflowScope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value)
}

/** 合法阶段 id 判定（用于新增阶段与产物目录命名）。 */
export function isPhaseId(value: unknown): value is string {
  return typeof value === 'string' && PHASE_ID_RE.test(value)
}

/**
 * 校验工作流结构完整性。
 * 规则：至少 1 个阶段；阶段 id 合法且唯一；gate/artifact.kind/scope 取值合法；
 * 名称非空（≤40 字符）；artifacts 为数组。
 */
export function validateWorkflow(workflow: unknown): Result<Workflow> {
  if (!workflow || typeof workflow !== 'object') return { ok: false, error: invalid('workflow 必须是对象') }
  const wf = workflow as Partial<Workflow>
  if (typeof wf.id !== 'string' || wf.id.trim().length === 0) return { ok: false, error: invalid('workflow.id 必须为非空字符串') }
  if (typeof wf.name !== 'string' || wf.name.trim().length === 0) return { ok: false, error: invalid('workflow.name 必须为非空字符串') }
  if (typeof wf.kind !== 'string' || wf.kind.trim().length === 0) return { ok: false, error: invalid('workflow.kind 必须为非空字符串') }
  if (!isWorkflowScope(wf.scope)) return { ok: false, error: invalid(`workflow.scope 非法: ${String(wf.scope)}`) }
  if (!Array.isArray(wf.phases)) return { ok: false, error: invalid('workflow.phases 必须为数组') }
  if (wf.phases.length === 0) return { ok: false, error: invalid('workflow 至少需要一个阶段') }

  const seen = new Set<string>()
  for (const raw of wf.phases) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: invalid('阶段必须是对象') }
    const phase = raw as Partial<WorkflowPhase>
    if (!isPhaseId(phase.id)) {
      return { ok: false, error: invalid(`阶段 id 非法（需匹配 ${PHASE_ID_RE.source}）: ${String(phase.id)}`) }
    }
    if (seen.has(phase.id)) return { ok: false, error: invalid(`阶段 id 重复: ${phase.id}`) }
    seen.add(phase.id)
    if (typeof phase.name !== 'string' || phase.name.trim().length === 0) {
      return { ok: false, error: invalid(`阶段 ${phase.id} 名称为空`) }
    }
    if (phase.name.trim().length > 40) return { ok: false, error: invalid(`阶段 ${phase.id} 名称超过 40 字符`) }
    if (!isPhaseGate(phase.gate)) return { ok: false, error: invalid(`阶段 ${phase.id} 门禁类型非法: ${String(phase.gate)}`) }
    if (!Array.isArray(phase.artifacts)) return { ok: false, error: invalid(`阶段 ${phase.id} 的 artifacts 必须为数组`) }
    for (const rawArtifact of phase.artifacts) {
      const artifact = rawArtifact as Partial<WorkflowArtifact>
      if (!isArtifactKind(artifact?.kind)) {
        return { ok: false, error: invalid(`阶段 ${phase.id} 产物类型非法: ${String(artifact?.kind)}`) }
      }
      if (typeof artifact?.label !== 'string' || artifact.label.trim().length === 0) {
        return { ok: false, error: invalid(`阶段 ${phase.id} 产物缺少 label`) }
      }
      if (artifact.min !== undefined && (!Number.isFinite(artifact.min) || (artifact.min as number) < 0)) {
        return { ok: false, error: invalid(`阶段 ${phase.id} 产物 min 必须为非负数`) }
      }
    }
  }
  return { ok: true, value: workflow as Workflow }
}

/** 深拷贝工作流（创建项目时从模板拷贝 / 另存为模板时使用）。 */
export function cloneWorkflow(workflow: Workflow): Workflow {
  return {
    ...workflow,
    phases: workflow.phases.map((phase) => ({ ...phase, artifacts: phase.artifacts.map((a) => ({ ...a })) })),
  }
}

/** 阶段顺序（id 数组），供流程引擎按动态顺序判定前后关系。 */
export function phaseOrderOf(workflow: Workflow): string[] {
  return workflow.phases.map((phase) => phase.id)
}

/**
 * 由模板派生「项目私有工作流」副本（创建项目时调用）。
 *
 * 深拷贝阶段列表，改写 scope='project'、记录 templateId 来源 —— 之后项目内
 * 任意编辑都不会影响内置模板，也不会影响同类型的其他项目。
 */
export function instantiateWorkflow(template: Workflow, options: { id: string; kind?: string; name?: string }): Workflow {
  const next = cloneWorkflow(template)
  return {
    ...next,
    id: options.id,
    ...(options.kind !== undefined ? { kind: options.kind } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    scope: 'project',
    templateId: template.id,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
  }
}

/** 新阶段 id：优先用 base slug，冲突时追加序号，保证在项目内唯一。 */
export function uniquePhaseId(workflow: Workflow, base: string): string {
  const existing = new Set(phaseOrderOf(workflow))
  const slug = String(base ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56)
  const seed = slug && PHASE_ID_RE.test(slug) ? slug : 'phase'
  if (!existing.has(seed)) return seed
  let index = 2
  while (existing.has(`${seed}-${index}`)) index += 1
  return `${seed}-${index}`
}

/** 新建空白阶段（供编辑器「添加阶段」使用）。 */
export function createPhase(workflow: Workflow, name: string, base = 'phase'): WorkflowPhase {
  return {
    id: uniquePhaseId(workflow, base),
    name: String(name ?? '').trim() || '新阶段',
    gate: 'manual',
    artifacts: [],
  }
}

/**
 * 插入阶段（返回新 workflow，不改原对象）。
 * index 越界时追加到末尾。
 */
export function insertPhase(workflow: Workflow, phase: WorkflowPhase, index: number): Result<Workflow> {
  const next = cloneWorkflow(workflow)
  if (next.phases.some((p) => p.id === phase.id)) {
    return { ok: false, error: invalid(`阶段 id 已存在: ${phase.id}`) }
  }
  const at = Number.isFinite(index) ? Math.max(0, Math.min(Math.trunc(index), next.phases.length)) : next.phases.length
  next.phases.splice(at, 0, { ...phase, artifacts: phase.artifacts.map((a) => ({ ...a })) })
  return validateWorkflow(next)
}

/** 删除阶段（返回新 workflow；最后一个阶段拒绝删除）。 */
export function removePhase(workflow: Workflow, phaseId: string): Result<Workflow> {
  const next = cloneWorkflow(workflow)
  const index = next.phases.findIndex((p) => p.id === phaseId)
  if (index < 0) return { ok: false, error: { code: 'INVALID_FIELD_TYPE', message: `阶段不存在: ${phaseId}` } }
  if (next.phases.length <= 1) return { ok: false, error: invalid('至少保留一个阶段') }
  next.phases.splice(index, 1)
  return validateWorkflow(next)
}

/** 重命名阶段。 */
export function renamePhase(workflow: Workflow, phaseId: string, name: string): Result<Workflow> {
  const next = cloneWorkflow(workflow)
  const phase = next.phases.find((p) => p.id === phaseId)
  if (!phase) return { ok: false, error: { code: 'INVALID_FIELD_TYPE', message: `阶段不存在: ${phaseId}` } }
  phase.name = String(name ?? '').trim()
  return validateWorkflow(next)
}

/** 局部更新阶段（门禁/描述/产物/提示词/评审标准/可跳过）。 */
export function updatePhase(workflow: Workflow, phaseId: string, patch: Partial<Omit<WorkflowPhase, 'id'>>): Result<Workflow> {
  const next = cloneWorkflow(workflow)
  const phase = next.phases.find((p) => p.id === phaseId)
  if (!phase) return { ok: false, error: { code: 'INVALID_FIELD_TYPE', message: `阶段不存在: ${phaseId}` } }
  if (patch.name !== undefined) phase.name = patch.name
  if (patch.description !== undefined) phase.description = patch.description
  if (patch.gate !== undefined) phase.gate = patch.gate
  if (patch.artifacts !== undefined) phase.artifacts = patch.artifacts.map((a) => ({ ...a }))
  if (patch.prompt !== undefined) phase.prompt = patch.prompt
  if (patch.rubric !== undefined) phase.rubric = patch.rubric
  if (patch.optional !== undefined) phase.optional = patch.optional
  return validateWorkflow(next)
}

/** 拖拽排序：把 from 位置的阶段移动到 to 位置（返回新 workflow）。 */
export function reorderPhase(workflow: Workflow, from: number, to: number): Result<Workflow> {
  const next = cloneWorkflow(workflow)
  if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, error: invalid('排序下标必须为整数') }
  if (from < 0 || from >= next.phases.length || to < 0 || to >= next.phases.length) {
    return { ok: false, error: invalid('排序下标越界') }
  }
  const [moved] = next.phases.splice(from, 1)
  if (!moved) return { ok: false, error: invalid('排序目标不存在') }
  next.phases.splice(to, 0, moved)
  return validateWorkflow(next)
}

/** 相邻下一阶段 id（末阶段返回 null）。 */
export function nextPhaseIn(workflow: Workflow, phaseId: string): string | null {
  const index = workflow.phases.findIndex((p) => p.id === phaseId)
  if (index < 0) return null
  return workflow.phases[index + 1]?.id ?? null
}

/** 相邻上一阶段 id（首阶段返回 null）。 */
export function prevPhaseIn(workflow: Workflow, phaseId: string): string | null {
  const index = workflow.phases.findIndex((p) => p.id === phaseId)
  if (index <= 0) return null
  return workflow.phases[index - 1]?.id ?? null
}
