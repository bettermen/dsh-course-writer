/**
 * xiashuo — 客户端 API 层（P4 首页）。
 *
 * 把 /api/xiashuo 的调用集中到一处，首页与后续模块共用，避免每个组件各写一遍
 * fetch + 围栏头 + 错误解包。
 *
 * 可测性：`fetchImpl` 可注入，因此本文件在 node 环境（无 jsdom）下也能单测 ——
 * 只需伪造 fetch 返回 `{ ok, status, json() }`。URL 拼装与查询串序列化抽成纯函数
 * （buildQuery / pathOf）单独断言。
 *
 * 契约：所有接口返回 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`；
 * 本层把后者统一转成 ApiRequestError（带 code 与 HTTP status），调用方无需重复判断。
 */
import type { ProjectStatus } from '../core/novel/status.ts'

/** 首页列表项（= 后端 ProjectListItem）。 */
export interface ProjectItem {
  id: string
  title: string
  genre: string
  kind: string
  description: string
  status: ProjectStatus
  kindLabel: string
  phaseDone: number
  phaseTotal: number
  currentPhase: string
  chapterCount: number
  totalWords: number
  createdAt: string
  updatedAt: string
}

/** 类型下的题材选项。 */
export interface KindGenre {
  id: string
  label: string
}

/** 项目类型（内置 4 种 + 用户自定义）。 */
export interface ProjectKind {
  id: string
  label: string
  labelEn: string
  icon: string
  description: string
  genres: KindGenre[]
  builtin: boolean
  templateId?: string
}

/** 工作流模板摘要（模板库下拉用）。 */
export interface WorkflowTemplate {
  id: string
  name: string
  nameEn?: string
  kind: string
  scope: 'builtin' | 'user'
  templateId?: string
  phases: Array<{ id: string; name: string }>
}

/** 列表查询参数（对应后端 parseProjectQuery 接受的键）。 */
export interface ProjectQuery {
  kind?: string
  status?: string
  q?: string
  sort?: 'updated' | 'created' | 'title' | 'words' | 'progress' | 'status'
  order?: 'asc' | 'desc'
}

/** 新建项目入参。 */
export interface CreateProjectInput {
  title: string
  kind?: string
  genre?: string
  description?: string
  templateId?: string
}

/** 编辑项目入参（字段与后端 ProjectPatch 对齐）。 */
export interface UpdateProjectInput {
  title?: string
  description?: string
  genre?: string
  status?: ProjectStatus
  kind?: string
}

/** 导入结果。 */
export interface ImportResult {
  bookId: string
  title: string
  genre: string
  kind: string
  chapterCount: number
  totalWords: number
  emptyChapters: number
}

/** 请求失败（后端返回 ok:false，或 HTTP 非 2xx）。 */
export class ApiRequestError extends Error {
  /** 后端领域错误码（如 INVALID_FIELD_TYPE / INVALID_STATE）。 */
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

/** 查询参数 → 查询串（空值跳过；返回带前导 `?` 的字符串，无参数时为空串）。 */
export function buildQuery(query: ProjectQuery = {}): string {
  const params = new URLSearchParams()
  for (const key of ['kind', 'status', 'q', 'sort', 'order'] as const) {
    const value = query[key]
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** 资源路径拼装（path 已含前导斜杠）。 */
export function pathOf(path: string, query?: ProjectQuery): string {
  return `${path}${query ? buildQuery(query) : ''}`
}

/** 解包响应：ok → value；否则抛 ApiRequestError。 */
export function unwrap<T>(json: unknown, status: number): T {
  const body = (json ?? {}) as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } }
  if (body.ok === true) return body.value as T
  const code = typeof body.error?.code === 'string' ? body.error.code : 'UNKNOWN'
  const message = typeof body.error?.message === 'string' ? body.error.message : '请求失败'
  throw new ApiRequestError(code, message, status)
}

/** 最小 fetch 形状（便于测试注入；与 DOM 的 fetch 签名兼容）。 */
export type FetchLike = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface XiashuoApi {
  listKinds(): Promise<ProjectKind[]>
  listProjects(query?: ProjectQuery): Promise<ProjectItem[]>
  getProject(id: string): Promise<ProjectItem>
  createProject(input: CreateProjectInput): Promise<ProjectItem>
  updateProject(id: string, input: UpdateProjectInput): Promise<ProjectItem>
  deleteProject(id: string, keepFiles: boolean): Promise<{ deleted: boolean }>
  duplicateProject(id: string): Promise<ProjectItem>
  archiveProject(id: string, archived: boolean): Promise<ProjectItem>
  listTemplates(kind?: string): Promise<WorkflowTemplate[]>
  importFile(fileName: string, content: string, kind?: string): Promise<ImportResult>
}

/**
 * 创建 API 客户端。
 * @param base 前缀，如 `/api/xiashuo`
 * @param fenceHeader 围栏头名，如 `x-xiashuo`
 * @param fetchImpl 可注入，默认用全局 fetch
 */
export function createXiashuoApi(
  base: string,
  fenceHeader: string,
  fetchImpl?: FetchLike,
): XiashuoApi {
  const doFetch: FetchLike = fetchImpl ?? (globalThis.fetch as unknown as FetchLike)

  /** 统一请求：加围栏头与 content-type，解包 Result 契约。 */
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { [fenceHeader]: '1', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      // 非 JSON 响应（宿主拦截 / 502 页面）：用 HTTP 状态兜底，避免二次抛错掩盖真因
      throw new ApiRequestError('IO_FAILURE', `HTTP ${res.status}`, res.status)
    }
    return unwrap<T>(json, res.status)
  }

  return {
    listKinds: () => request<ProjectKind[]>('GET', '/kinds'),
    listProjects: (query) => request<ProjectItem[]>('GET', pathOf('/projects', query)),
    getProject: (id) => request<ProjectItem>('GET', `/projects/${encodeURIComponent(id)}`),
    createProject: (input) => request<ProjectItem>('POST', '/projects', input),
    updateProject: (id, input) => request<ProjectItem>('PATCH', `/projects/${encodeURIComponent(id)}`, input),
    deleteProject: (id, keepFiles) =>
      request<{ deleted: boolean }>('DELETE', `/projects/${encodeURIComponent(id)}${keepFiles ? '?keepFiles=1' : ''}`),
    duplicateProject: (id) => request<ProjectItem>('POST', `/projects/${encodeURIComponent(id)}/duplicate`),
    archiveProject: (id, archived) =>
      request<ProjectItem>('POST', `/projects/${encodeURIComponent(id)}/archive`, { archived }),
    listTemplates: (kind) => request<WorkflowTemplate[]>('GET', pathOf('/workflows', { kind })),
    importFile: (fileName, content, kind) =>
      request<ImportResult>('POST', '/import', { fileName, content, kind }),
  }
}
