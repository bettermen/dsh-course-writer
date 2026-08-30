/**
 * xiashuo — 工作流模板库持久化（P2）。
 *
 * 模板分两类，本文件只负责后者（用户模板）的 IO：
 *  - **内置模板**（`templates.ts` 的 TS 常量）：随包分发，只读，不落盘；
 *  - **用户模板**：`<userDir>/<id>.json`，可增删改（"另存为模板" / 模板管理）。
 *
 * 项目私有工作流（`workflow.json`）不归本文件管 —— 那是 `core/novel/store.ts` 的职责。
 * 三者关系：内置模板 --派生--> 用户模板 --派生--> 项目工作流（scope 依次
 * builtin → user → project，派生时记 `templateId` 溯源）。
 *
 * 内置模板**只读**：改/删一律拒绝（`isBuiltinTemplateId` 判定）。
 */
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile, readOptional } from '../atomic-file.ts'
import { newId } from '../util.ts'
import type { Workflow, WorkflowPhase } from './schema.ts'
import { cloneWorkflow, isPhaseId, validateWorkflow } from './schema.ts'
import { BUILTIN_TEMPLATES, builtinTemplateById, isBuiltinTemplateId } from './templates.ts'

/** 模板 id（同时作为文件名）安全形状：防路径穿越。 */
const TEMPLATE_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/i

/** 模板列表过滤条件。 */
export interface ListTemplatesOptions {
  /** 只返回该类型的模板（缺省不过滤）。 */
  kind?: string
  /** 只返回该归属的模板；缺省 'all'。 */
  scope?: 'builtin' | 'user' | 'all'
}

/** 「另存为模板」入参。 */
export interface SaveTemplateOptions {
  /** 模板名称（必填）。 */
  name: string
  /** 模板英文名（可选，缺省回退 name）。 */
  nameEn?: string
  /** 归属类型（可选，缺省沿用来源模板的 kind）。 */
  kind?: string
}

function domainError(code: string, message: string): never {
  throw { code, message } as never
}

export class WorkflowStore {
  /** 用户模板目录（通常 `<dataDir>/templates/workflows/user`）。 */
  readonly userDir: string

  constructor(userDir: string) {
    this.userDir = userDir
  }

  private fileOf(id: string): string {
    if (!TEMPLATE_ID_RE.test(id)) domainError('INVALID_ENTRY_ID', `非法模板 id: ${id}`)
    return join(this.userDir, `${id}.json`)
  }

  // ── 读 ──

  /**
   * 用户模板清单（损坏文件跳过，不阻断列表）。
   * 排序：按名称升序（与内置模板"顺序即展示顺序"的约定区分开 —— 用户模板
   * 数量无上限，用字典序比用文件遍历序更稳定）。
   */
  async listUser(): Promise<Workflow[]> {
    const names = await readdir(this.userDir).catch(() => [] as string[])
    const list: Workflow[] = []
    for (const name of names) {
      if (!/^[a-z][a-z0-9_-]{0,63}\.json$/i.test(name)) continue
      const text = await readOptional(join(this.userDir, name))
      if (text === undefined) continue
      try {
        const validated = validateWorkflow(JSON.parse(text))
        if (validated.ok) list.push({ ...validated.value, scope: 'user' })
      } catch {
        // 损坏模板不阻断其它模板的读取
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  /** 内置模板清单（只读；可选按类型过滤）。 */
  listBuiltin(kind?: string): Workflow[] {
    const list = typeof kind === 'string' && kind.length > 0
      ? BUILTIN_TEMPLATES.filter((tpl) => tpl.kind === kind)
      : [...BUILTIN_TEMPLATES]
    return list
  }

  /** 全部模板（内置在前，用户模板在后）。 */
  async listAll(options: ListTemplatesOptions = {}): Promise<Workflow[]> {
    const { kind, scope = 'all' } = options
    const builtin = scope === 'user' ? [] : this.listBuiltin(kind)
    const user = scope === 'builtin' ? [] : await this.listUser()
    const filtered = typeof kind === 'string' && kind.length > 0 ? user.filter((tpl) => tpl.kind === kind) : user
    return [...builtin, ...filtered]
  }

  /** 按 id 取模板（内置或用户），未命中返回 undefined。 */
  async read(id: string): Promise<Workflow | undefined> {
    const builtin = builtinTemplateById(id)
    if (builtin) return builtin
    if (!TEMPLATE_ID_RE.test(id)) return undefined
    const text = await readOptional(this.fileOf(id))
    if (text === undefined) return undefined
    try {
      const validated = validateWorkflow(JSON.parse(text))
      return validated.ok ? { ...validated.value, scope: 'user' } : undefined
    } catch {
      return undefined
    }
  }

  // ── 写 ──

  private async write(workflow: Workflow): Promise<Workflow> {
    const validated = validateWorkflow(workflow)
    if (!validated.ok) domainError(validated.error.code, `工作流模板结构非法: ${validated.error.message}`)
    await mkdir(this.userDir, { recursive: true, mode: 0o700 })
    await atomicWriteFile(this.fileOf(validated.value.id), `${JSON.stringify(validated.value, null, 2)}\n`)
    return validated.value
  }

  /**
   * 由任意工作流派生一份用户模板（"另存为模板"）。
   * 来源可以是项目私有工作流（`workflow.json`）或另一个用户模板。
   */
  async createFrom(source: Workflow, options: SaveTemplateOptions): Promise<Workflow> {
    const name = String(options.name ?? '').trim()
    if (!name) domainError('INVALID_FIELD_TYPE', '模板名称不能为空')
    if (name.length > 40) domainError('INVALID_FIELD_TYPE', '模板名称不能超过 40 字符')
    const draft: Workflow = {
      ...cloneWorkflow(source),
      id: newId('wftpl').replace(/_/g, '-'),
      name,
      ...(options.nameEn !== undefined ? { nameEn: options.nameEn.trim() } : {}),
      ...(options.kind !== undefined && options.kind.trim() ? { kind: options.kind.trim() } : {}),
      scope: 'user',
      templateId: source.id,
    }
    return await this.write(draft)
  }

  /** 整体保存（编辑器/"模板管理"直接提交完整 workflow 时使用）。 */
  async save(workflow: Workflow): Promise<Workflow> {
    if (isBuiltinTemplateId(workflow.id)) domainError('INVALID_STATE', `内置模板只读: ${workflow.id}`)
    return await this.write({ ...workflow, scope: 'user' })
  }

  /**
   * 局部更新模板（名称 / 英文名 / 归属类型 / 阶段列表）。
   * 内置模板只读，拒绝修改。
   */
  async update(id: string, patch: Partial<Pick<Workflow, 'name' | 'nameEn' | 'kind' | 'phases'>>): Promise<Workflow> {
    if (isBuiltinTemplateId(id)) domainError('INVALID_STATE', `内置模板只读: ${id}`)
    const current = await this.read(id)
    if (!current) domainError('ENTRY_NOT_FOUND', `模板不存在: ${id}`)
    const next: Workflow = { ...current, scope: 'user' }
    if (patch.name !== undefined) {
      const name = String(patch.name).trim()
      if (!name) domainError('INVALID_FIELD_TYPE', '模板名称不能为空')
      if (name.length > 40) domainError('INVALID_FIELD_TYPE', '模板名称不能超过 40 字符')
      next.name = name
    }
    if (patch.nameEn !== undefined) next.nameEn = String(patch.nameEn).trim()
    if (patch.kind !== undefined) {
      const kind = String(patch.kind).trim()
      if (!kind) domainError('INVALID_FIELD_TYPE', '模板归属类型不能为空')
      next.kind = kind
    }
    if (patch.phases !== undefined) {
      if (!Array.isArray(patch.phases)) domainError('INVALID_FIELD_TYPE', 'phases 必须为数组')
      next.phases = patch.phases.map((phase) => ({ ...(phase as WorkflowPhase) }))
      const ids = new Set<string>()
      for (const phase of next.phases) {
        if (!isPhaseId(phase?.id)) domainError('INVALID_FIELD_TYPE', `阶段 id 非法: ${String(phase?.id)}`)
        if (ids.has(phase.id)) domainError('INVALID_FIELD_TYPE', `阶段 id 重复: ${phase.id}`)
        ids.add(phase.id)
      }
    }
    return await this.write(next)
  }

  /** 删除用户模板（内置模板只读，拒绝删除）。 */
  async remove(id: string): Promise<boolean> {
    if (isBuiltinTemplateId(id)) domainError('INVALID_STATE', `内置模板只读: ${id}`)
    if (!TEMPLATE_ID_RE.test(id)) return false
    const path = this.fileOf(id)
    if ((await readOptional(path)) === undefined) return false
    await rm(path, { force: true })
    return true
  }
}
