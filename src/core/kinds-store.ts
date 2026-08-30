/**
 * xiashuo — 自定义项目类型持久化（P2）。
 *
 * 与 `core/kinds.ts` 的分工：
 *  - `kinds.ts`：**纯数据 + 纯函数**（内置类型常量、合并、校验、slug 生成），零 IO；
 *  - 本文件：**只做 IO** —— 把用户自定义类型读写到 `kinds.json`，增删改写
 *    的合法性判定委托给 `createCustomKind`。
 *
 * 内置 4 种类型**只读**：不可删、不可改（避免老项目的 kind 指向失效）。
 * 需要"改头换面"时请新建一个自定义类型。
 *
 * 文件格式（VersionedFile 外壳，与 book.json 一致）：
 *   { "schemaVersion": 1, "data": [ ProjectKind, ... ] }
 */
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWriteFile, readOptional } from './atomic-file.ts'
import type { PluginError, Result } from './types.ts'
import type { CreateKindInput, KindGenre, ProjectKind } from './kinds.ts'
import { BUILTIN_KIND_IDS, createCustomKind, kindSlug, resolveKinds } from './kinds.ts'

export const KINDS_SCHEMA_VERSION = 1

/** 题材 id 形状（同类型 id）。 */
const GENRE_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/

/** 局部更新自定义类型的入参。 */
export interface UpdateKindInput {
  label?: string
  labelEn?: string
  icon?: string
  description?: string
  /** 全量替换题材列表（前端一次性提交排序后的完整列表）。 */
  genres?: Array<{ id?: string; label: string }>
  templateId?: string
}

function invalid(message: string): PluginError {
  return { code: 'INVALID_FIELD_TYPE', message }
}

function domainError(code: string, message: string): never {
  throw { code, message } as never
}

/** 归一化题材列表（缺 id 时按名称生成 slug，重复时追加序号）。 */
function normalizeGenres(input: Array<{ id?: string; label: string }>): Result<KindGenre[]> {
  const genres: KindGenre[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    const label = String(raw?.label ?? '').trim()
    if (!label) continue
    const rawId = String(raw?.id ?? '').trim().toLowerCase()
    let id = rawId
    if (!id) {
      id = kindSlug(label) || `genre-${seen.size + 1}`
    } else if (!GENRE_ID_RE.test(id)) {
      return { ok: false, error: invalid(`题材 id 非法: ${rawId}`) }
    }
    if (seen.has(id)) {
      let n = 2
      while (seen.has(`${id}-${n}`)) n += 1
      id = `${id}-${n}`
    }
    seen.add(id)
    genres.push({ id, label: label.slice(0, 20) })
  }
  if (genres.length > 50) return { ok: false, error: invalid('题材数量不能超过 50 个') }
  return { ok: true, value: genres }
}

export class KindStore {
  readonly filePath: string

  /** @param filePath kinds.json 绝对路径（通常 `<dataDir>/kinds.json`）。 */
  constructor(filePath: string) {
    this.filePath = filePath
  }

  // ── 读 ──

  /**
   * 用户自定义类型清单。
   * 文件缺失/损坏 → 返回空数组（不阻断插件启动，损坏项在 GUI 上表现为"回到内置态"）。
   */
  async listCustom(): Promise<ProjectKind[]> {
    const text = await readOptional(this.filePath)
    if (text === undefined) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return []
    }
    const raw = (parsed as { data?: unknown })?.data
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is ProjectKind => Boolean(item) && typeof item === 'object' && typeof (item as ProjectKind).id === 'string')
      .map((item) => ({ ...item, builtin: false }))
  }

  /** 全部可用类型（内置 4 种 + 自定义，内置在前）。 */
  async list(): Promise<ProjectKind[]> {
    return resolveKinds(await this.listCustom())
  }

  // ── 写 ──

  private async write(custom: readonly ProjectKind[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    await atomicWriteFile(this.filePath, `${JSON.stringify({ schemaVersion: KINDS_SCHEMA_VERSION, data: custom }, null, 2)}\n`)
  }

  /** 新建自定义类型（内置 id 与 'custom' 为保留字，拒绝占用）。 */
  async create(input: CreateKindInput): Promise<ProjectKind> {
    const custom = await this.listCustom()
    const result = createCustomKind(input, await this.list())
    if (!result.ok) domainError(result.error.code, result.error.message)
    await this.write([...custom, result.value])
    return result.value
  }

  /** 编辑自定义类型（内置类型只读，拒绝修改）。 */
  async update(id: string, patch: UpdateKindInput): Promise<ProjectKind> {
    if (BUILTIN_KIND_IDS.includes(id)) domainError('INVALID_FIELD_TYPE', `内置类型不可修改: ${id}`)
    const custom = await this.listCustom()
    const index = custom.findIndex((kind) => kind.id === id)
    const base = custom[index]
    if (!base) domainError('ENTRY_NOT_FOUND', `类型不存在: ${id}`)

    const next: ProjectKind = { ...base, builtin: false }
    if (patch.label !== undefined) {
      const label = String(patch.label).trim()
      if (!label) domainError('INVALID_FIELD_TYPE', '类型名称不能为空')
      if (label.length > 20) domainError('INVALID_FIELD_TYPE', '类型名称不能超过 20 字符')
      next.label = label
    }
    if (patch.labelEn !== undefined) next.labelEn = String(patch.labelEn).trim() || base.id
    if (patch.icon !== undefined) next.icon = String(patch.icon).trim().slice(0, 4) || '✨'
    if (patch.description !== undefined) next.description = String(patch.description).trim().slice(0, 60)
    if (patch.genres !== undefined) {
      if (!Array.isArray(patch.genres)) domainError('INVALID_FIELD_TYPE', 'genres 必须为数组')
      const normalized = normalizeGenres(patch.genres)
      if (!normalized.ok) domainError(normalized.error.code, normalized.error.message)
      next.genres = normalized.value
    }
    if (patch.templateId !== undefined) {
      const templateId = String(patch.templateId).trim()
      if (!templateId) domainError('INVALID_FIELD_TYPE', '工作流模板不能为空')
      next.templateId = templateId
    }

    custom[index] = next
    await this.write(custom)
    return next
  }

  /** 删除自定义类型（内置类型只读，拒绝删除）。 */
  async remove(id: string): Promise<boolean> {
    if (BUILTIN_KIND_IDS.includes(id)) domainError('INVALID_FIELD_TYPE', `内置类型不可删除: ${id}`)
    const custom = await this.listCustom()
    const next = custom.filter((kind) => kind.id !== id)
    if (next.length === custom.length) return false
    await this.write(next)
    return true
  }
}
