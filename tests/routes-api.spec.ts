/**
 * routes — P2 新接口集成测试（项目 CRUD + 工作流编辑 + 模板库）。
 *
 * 用假的 cordis Context / webServer 挂载真实 handler，再用假的
 * IncomingMessage / ServerResponse 驱动，从而在不启动 HTTP 服务的前提下
 * 覆盖「路径分派 + fence 校验 + 领域调用 + 响应包装」整条链路。
 *
 * 注意：全量 vitest 在本机会 OOM（exit 137），跑单文件即可。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NovelAssembly, NovelServices } from '../src/assembly.ts'
import { registerNovelRoutes } from '../src/routes.ts'
import { LoreService, LoreStore } from '../src/core/lorebook/index.ts'
import { NovelService, NovelStore } from '../src/core/novel/index.ts'
import { VariableStoreFile, variablesFilePath } from '../src/core/variables/index.ts'
import { KindStore } from '../src/core/kinds-store.ts'
import { WorkflowStore } from '../src/core/workflow/store.ts'
import type { Workflow } from '../src/core/workflow/index.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
type Json = Record<string, unknown>

/** 取错误响应的 message（`Json` 取值类型为 unknown，这里收窄成字符串）。 */
function messageOf(json: Json): string {
  const error = json.error
  if (error && typeof error === 'object') return String((error as Json).message ?? '')
  return String(error ?? '')
}

/** 路由前缀：宿主 webServer 把**完整 URL**（含前缀）交给 handler（见 parseNovelPath）。 */
const P = '/api/xiashuo'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** 假 webServer：只收集 prefix 路由的 handler。 */
function fakeWebServer(): { handlers: Map<string, Handler>; register: (route: { path: string; handler: Handler }) => () => void } {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    register: (route) => {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  }
}

/** 假 cordis Context：只实现 registerNovelRoutes 用到的 inject / effect。 */
function fakeCtx(webServer: ReturnType<typeof fakeWebServer>): never {
  return {
    inject: (_deps: string[], cb: (wctx: unknown) => void): void => {
      const wctx = {
        webServer,
        effect: (fn: () => unknown): (() => void) => { fn(); return () => {} },
      }
      cb(wctx)
    },
  } as never
}

/** 假 ServerResponse：记录状态码与 JSON 响应体。 */
function mockRes(): ServerResponse & { status: number; json: Json } {
  const res = {
    status: 0,
    json: {} as Json,
    writeHead(status: number): ServerResponse { res.status = status; return res as unknown as ServerResponse },
    end(chunk?: unknown): ServerResponse {
      if (typeof chunk === 'string' && chunk.length > 0) res.json = JSON.parse(chunk) as Json
      return res as unknown as ServerResponse
    },
  }
  return res as unknown as ServerResponse & { status: number; json: Json }
}

/** 假 IncomingMessage：同步推送 body 后触发 end（readJsonBody 依赖此顺序）。 */
function mockReq(method: string, url: string, body?: unknown, fence = true): IncomingMessage {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    headers: fence ? { 'x-xiashuo': '1' } : {},
    on(event: string, cb: (chunk?: unknown) => void): IncomingMessage {
      if (event === 'data' && payload) cb(payload)
      if (event === 'end') cb()
      return this as unknown as IncomingMessage
    },
  } as unknown as IncomingMessage
}

interface Mounted {
  call(method: string, path: string, body?: unknown, fence?: boolean): Promise<{ status: number; json: Json }>
  /** 直接取响应体（约定：ok 时返回 value）。 */
  value(method: string, path: string, body?: unknown): Promise<any>
  services: NovelServices
}

async function mount(enabled = true): Promise<Mounted> {
  const dir = await mkdtemp(join(tmpdir(), 'xsapi-'))
  roots.push(dir)
  const novelStore = new NovelStore(join(dir, 'projects'))
  const loreStore = new LoreStore(join(dir, 'lorebook'))
  const variables = new VariableStoreFile(variablesFilePath(join(dir, 'vars')))
  const services: NovelServices = {
    lore: new LoreService(loreStore),
    novel: new NovelService({ store: novelStore, loreStore, variables }),
    llm: null,
    bookDirOf: (id) => novelStore.getBookDir(id),
    kinds: new KindStore(join(dir, 'kinds.json')),
    workflows: new WorkflowStore(join(dir, 'templates', 'workflows', 'user')),
  }
  const assembly = { services: enabled ? services : null } as unknown as NovelAssembly
  const webServer = fakeWebServer()
  registerNovelRoutes(fakeCtx(webServer), assembly)
  const handler = webServer.handlers.get('/api/xiashuo')
  if (!handler) throw new Error('路由未注册')
  const call = async (method: string, path: string, body?: unknown, fence = true): Promise<{ status: number; json: Json }> => {
    const res = mockRes()
    await handler(mockReq(method, `${P}${path}`, body, fence), res)
    return { status: res.status, json: res.json }
  }
  return {
    call,
    value: async (method, path, body) => (await call(method, path, body)).json.value,
    services,
  }
}

/** 新建项目的便捷封装（返回项目 id）。 */
async function newProject(api: Mounted, title: string, kind = 'course'): Promise<string> {
  const created = await api.value('POST', '/projects', { title, kind })
  return String(created.id)
}

describe('routes — 门禁与错误面', () => {
  it('插件未启用时返回 503', async () => {
    const api = await mount(false)
    const res = await api.call('GET', '/projects')
    expect(res.status).toBe(503)
    expect(res.json.error).toMatchObject({ code: 'INVALID_STATE' })
  })

  it('缺 fence 头的写操作返回 403', async () => {
    const api = await mount()
    for (const [method, path] of [['POST', '/projects'], ['POST', '/kinds'], ['DELETE', '/projects/bk_x']] as const) {
      const res = await api.call(method, path, {}, false)
      expect(res.status).toBe(403)
    }
  })

  it('未知路径返回 404', async () => {
    const api = await mount()
    expect((await api.call('GET', '/nope')).status).toBe(404)
  })
})

describe('routes — /kinds 类型管理', () => {
  it('GET /kinds 返回内置 4 种', async () => {
    const api = await mount()
    const kinds = await api.value('GET', '/kinds')
    expect(kinds.map((k: { id: string }) => k.id)).toEqual(['course', 'official', 'novel', 'thesis'])
    expect(kinds.every((k: { builtin: boolean }) => k.builtin)).toBe(true)
  })

  it('POST /kinds 新建自定义类型并出现在列表中', async () => {
    const api = await mount()
    const created = await api.value('POST', '/kinds', { label: '新媒体文案', genres: [{ label: '公众号' }] })
    expect(created).toMatchObject({ id: 'kind', label: '新媒体文案', builtin: false, templateId: 'builtin-generic' })
    const kinds = await api.value('GET', '/kinds')
    expect(kinds).toHaveLength(5)
    expect(kinds.at(-1).genres).toEqual([{ id: 'genre-1', label: '公众号' }])
  })

  it('PATCH /kinds/<id> 改名；内置类型只读', async () => {
    const api = await mount()
    await api.value('POST', '/kinds', { id: 'copywriting', label: '文案' })
    const updated = await api.value('PATCH', '/kinds/copywriting', { label: '文案改', icon: '✍️' })
    expect(updated).toMatchObject({ id: 'copywriting', label: '文案改', icon: '✍️' })
    const builtin = await api.call('PATCH', '/kinds/course', { label: '课程改名' })
    expect(builtin.status).toBe(400)
    expect(messageOf(builtin.json)).toContain('内置类型不可修改')
  })

  it('DELETE /kinds/<id> 删除；内置类型与不存在项分别 400 / 404', async () => {
    const api = await mount()
    await api.value('POST', '/kinds', { id: 'copywriting', label: '文案' })
    expect((await api.call('DELETE', '/kinds/copywriting')).json.value).toMatchObject({ deleted: true })
    expect((await api.value('GET', '/kinds')).length).toBe(4)
    expect((await api.call('DELETE', '/kinds/course')).status).toBe(400)
    expect((await api.call('DELETE', '/kinds/nope')).status).toBe(404)
  })

  it('保留字 id 被拒绝', async () => {
    const api = await mount()
    const res = await api.call('POST', '/kinds', { id: 'course', label: '抢占内置' })
    expect(res.status).toBe(400)
    expect(messageOf(res.json)).toContain('保留字')
  })
})

describe('routes — /projects 增删改查', () => {
  it('POST /projects 按类型建项目（论文 → 8 阶段流程）', async () => {
    const api = await mount()
    const created = await api.value('POST', '/projects', { title: '深度学习综述', kind: 'thesis', description: '一篇综述' })
    expect(created).toMatchObject({ title: '深度学习综述', kind: 'thesis', kindLabel: '论文', status: 'draft', description: '一篇综述' })
    expect(created.phaseTotal).toBe(8)
    expect(created.phaseDone).toBe(0)
    // 题材缺省取该类型首个题材（工学）
    expect(created.genre).toBe('engineering')
    const workflow = await api.value('GET', `/projects/${created.id}/workflow`)
    expect(workflow.phases.map((p: { id: string }) => p.id)[0]).toBe('topic')
    expect(workflow.scope).toBe('project')
    expect(workflow.templateId).toBe('builtin-thesis')
  })

  it('POST /projects 缺标题返回 400', async () => {
    const api = await mount()
    expect((await api.call('POST', '/projects', { title: '   ' })).status).toBe(400)
  })

  it('GET /projects 支持筛选与排序并回传进度', async () => {
    const api = await mount()
    const novelId = await newProject(api, '青云问道', 'novel')
    await newProject(api, '阿甘正传读后感', 'course')
    await newProject(api, '关于加强通知', 'official')
    // 推进一个阶段，进度变化
    await api.services.novel.enterPhase(novelId, 'topic')
    await api.services.novel.commitPhase(novelId, 'topic', '选题', { passed: true, errorCount: 0, warningCount: 0 })

    const all = await api.value('GET', '/projects')
    expect(all).toHaveLength(3)
    expect(all.map((p: { kindLabel: string }) => p.kindLabel).sort()).toEqual(['公文', '小说', '课程'])

    const onlyNovel = await api.value('GET', '/projects?kind=novel')
    expect(onlyNovel).toHaveLength(1)
    expect(onlyNovel[0].phaseDone).toBe(1)
    expect(onlyNovel[0].phaseTotal).toBe(9)

    const byTitle = await api.value('GET', '/projects?sort=title&order=asc')
    expect(byTitle[0].title.localeCompare(byTitle[1].title, 'zh-CN')).toBeLessThanOrEqual(0)

    const keyword = await api.value('GET', '/projects?q=青云')
    expect(keyword.map((p: { id: string }) => p.id)).toEqual([novelId])

    const active = await api.value('GET', '/projects?status=draft')
    expect(active).toHaveLength(3)
  })

  it('PATCH /projects/<id> 改标题/简介/状态', async () => {
    const api = await mount()
    const id = await newProject(api, '初稿')
    const updated = await api.value('PATCH', `/projects/${id}`, { title: '定稿', description: 'v2', status: 'paused' })
    expect(updated).toMatchObject({ title: '定稿', description: 'v2', status: 'paused' })
    expect((await api.services.novel.load(id)).config.title).toBe('定稿')
  })

  it('PATCH 非法状态 / 空 patch 返回 400', async () => {
    const api = await mount()
    const id = await newProject(api, '初稿')
    expect((await api.call('PATCH', `/projects/${id}`, { status: 'sleeping' })).status).toBe(400)
    expect((await api.call('PATCH', `/projects/${id}`, {})).status).toBe(400)
  })

  it('PATCH 改类型会连带重置工作流', async () => {
    const api = await mount()
    const id = await newProject(api, '跨类型', 'course')
    expect((await api.value('GET', `/projects/${id}/workflow`)).phases).toHaveLength(9)
    const updated = await api.value('PATCH', `/projects/${id}`, { kind: 'official' })
    expect(updated).toMatchObject({ kind: 'official', kindLabel: '公文' })
    const workflow = await api.value('GET', `/projects/${id}/workflow`)
    expect(workflow.phases).toHaveLength(7)
    expect(workflow.templateId).toBe('builtin-official')
  })

  it('DELETE /projects/<id> 删除项目（keepFiles 可选）', async () => {
    const api = await mount()
    const id = await newProject(api, '待删')
    expect((await api.call('DELETE', `/projects/${id}`)).json.value).toMatchObject({ deleted: true, keptChapters: false })
    expect(await api.value('GET', '/projects')).toHaveLength(0)
    // 保留讲义
    const keepId = await newProject(api, '保留讲义')
    expect((await api.call('DELETE', `/projects/${keepId}?keepFiles=1`)).json.value).toMatchObject({ keptChapters: true })
  })

  it('POST /projects/<id>/duplicate 复制项目（讲义不复制，流程沿用）', async () => {
    const api = await mount()
    const id = await newProject(api, '母项目', 'thesis')
    await api.services.novel.saveChapter(id, 1, '第一章', '正文内容')
    await api.services.novel.enterPhase(id, 'topic')
    await api.services.novel.commitPhase(id, 'topic', '选题', { passed: true, errorCount: 0, warningCount: 0 })
    const copy = await api.value('POST', `/projects/${id}/duplicate`, { title: '副本' })
    expect(copy).toMatchObject({ title: '副本', kind: 'thesis', chapterCount: 0 })
    expect(copy.id).not.toBe(id)
    // 流程被复制（阶段顺序一致），但进度重置
    expect(copy.phaseTotal).toBe(8)
    expect(copy.phaseDone).toBe(0)
  })

  it('POST /projects/<id>/archive 归档与取消归档', async () => {
    const api = await mount()
    const id = await newProject(api, '待归档')
    expect((await api.value('POST', `/projects/${id}/archive`, { archived: true })).status).toBe('archived')
    // 未开工的项目取消归档回到 draft
    expect((await api.value('POST', `/projects/${id}/archive`, { archived: false })).status).toBe('draft')
  })
})

describe('routes — /projects/<id>/workflow 流程编辑', () => {
  async function withProject(): Promise<{ api: Mounted; id: string }> {
    const api = await mount()
    return { api, id: await newProject(api, '流程实验', 'course') }
  }

  it('GET 返回项目私有工作流', async () => {
    const { api, id } = await withProject()
    const workflow = await api.value('GET', `/projects/${id}/workflow`)
    expect(workflow).toMatchObject({ id: `wf_${id}`, kind: 'course', scope: 'project', schemaVersion: 1 })
    expect(workflow.phases).toHaveLength(9)
  })

  it('PUT 整体保存（id / scope 以服务端为准）', async () => {
    const { api, id } = await withProject()
    const original: Workflow = await api.value('GET', `/projects/${id}/workflow`)
    const trimmed: Workflow = { ...original, id: 'builtin-course', scope: 'builtin', phases: original.phases.slice(0, 3) }
    const saved = await api.value('PUT', `/projects/${id}/workflow`, trimmed)
    expect(saved).toMatchObject({ id: `wf_${id}`, scope: 'project' })
    expect(saved.phases).toHaveLength(3)
    // 引擎侧顺序同步生效
    expect(await api.services.novel.phaseOrder(id)).toEqual(original.phases.slice(0, 3).map((p) => p.id))
  })

  it('PUT 结构非法返回 400（不落盘）', async () => {
    const { api, id } = await withProject()
    const res = await api.call('PUT', `/projects/${id}/workflow`, { id: 'x', name: 'x', kind: 'course', scope: 'project', phases: [], schemaVersion: 1 })
    expect(res.status).toBe(400)
    expect((await api.value('GET', `/projects/${id}/workflow`)).phases).toHaveLength(9)
  })

  it('POST phases 新增阶段（可指定位置与门禁）', async () => {
    const { api, id } = await withProject()
    const added = await api.value('POST', `/projects/${id}/workflow/phases`, { name: '同行评议', index: 2, gate: 'ai' })
    expect(added.phases).toHaveLength(10)
    expect(added.phases[2]).toMatchObject({ id: 'phase', name: '同行评议', gate: 'ai' })
  })

  it('POST phases/reorder 拖拽排序', async () => {
    const { api, id } = await withProject()
    const before: Workflow = await api.value('GET', `/projects/${id}/workflow`)
    const moved = await api.value('POST', `/projects/${id}/workflow/phases/reorder`, { from: 0, to: 3 })
    const ids = moved.phases.map((p: { id: string }) => p.id)
    expect(ids.slice(0, 4)).toEqual([before.phases[1]!.id, before.phases[2]!.id, before.phases[3]!.id, before.phases[0]!.id])
    // 越界下标返回 400
    expect((await api.call('POST', `/projects/${id}/workflow/phases/reorder`, { from: 0, to: 99 })).status).toBe(400)
  })

  it('POST phases/<id>/rename 与 update', async () => {
    const { api, id } = await withProject()
    const renamed = await api.value('POST', `/projects/${id}/workflow/phases/topic/rename`, { name: '课程选题' })
    expect(renamed.phases[0]).toMatchObject({ id: 'topic', name: '课程选题' })
    const updated = await api.value('POST', `/projects/${id}/workflow/phases/topic/update`, { gate: 'checklist', description: '先想清楚' })
    expect(updated.phases[0]).toMatchObject({ gate: 'checklist', description: '先想清楚' })
  })

  it('POST phases/<id>/delete 删除阶段（最后一个拒绝）', async () => {
    const { api, id } = await withProject()
    const after = await api.value('POST', `/projects/${id}/workflow/phases/topic/delete`)
    expect(after.phases).toHaveLength(8)
    const res = await api.call('POST', `/projects/${id}/workflow/phases/nope/delete`)
    expect(res.status).toBe(400)
  })

  it('POST workflow/reset 恢复类型默认流程', async () => {
    const { api, id } = await withProject()
    await api.value('POST', `/projects/${id}/workflow/phases/topic/delete`)
    await api.value('POST', `/projects/${id}/workflow/phases/setting/delete`)
    expect((await api.value('GET', `/projects/${id}/workflow`)).phases).toHaveLength(7)
    const reset = await api.value('POST', `/projects/${id}/workflow/reset`)
    expect(reset.phases).toHaveLength(9)
    expect(reset.templateId).toBe('builtin-course')
  })
})

describe('routes — /workflows 模板库', () => {
  it('GET /workflows 返回内置模板（可按 kind / scope 过滤）', async () => {
    const api = await mount()
    const all = await api.value('GET', '/workflows')
    expect(all.map((t: { id: string }) => t.id)).toContain('builtin-course')
    expect(all.every((t: { scope: string }) => t.scope === 'builtin')).toBe(true)
    expect((await api.value('GET', '/workflows?kind=thesis')).map((t: { id: string }) => t.id)).toEqual(['builtin-thesis'])
  })

  it('POST /workflows 把项目流程另存为模板', async () => {
    const api = await mount()
    const id = await newProject(api, '模板来源', 'official')
    const template = await api.value('POST', '/workflows', { projectId: id, name: '我司公文流程' })
    expect(template).toMatchObject({ name: '我司公文流程', kind: 'official', scope: 'user' })
    expect(template.id).toMatch(/^wftpl-/)
    expect(template.templateId).toBe(`wf_${id}`)
    // 出现在列表里（内置在前，用户模板在后）
    const list = await api.value('GET', '/workflows?kind=official')
    expect(list.map((t: { id: string }) => t.id)).toEqual(['builtin-official', template.id])
    expect((await api.value('GET', `/workflows/${template.id}`)).name).toBe('我司公文流程')
  })

  it('PATCH /workflows/<id> 改模板；内置模板只读', async () => {
    const api = await mount()
    const id = await newProject(api, '模板来源')
    const template = await api.value('POST', '/workflows', { projectId: id, name: '草稿模板' })
    const updated = await api.value('PATCH', `/workflows/${template.id}`, { name: '正式模板', nameEn: 'Official' })
    expect(updated).toMatchObject({ name: '正式模板', nameEn: 'Official' })
    const builtin = await api.call('PATCH', '/workflows/builtin-course', { name: '改内置' })
    expect(builtin.status).toBe(409)
  })

  it('DELETE /workflows/<id> 删模板；内置模板只读', async () => {
    const api = await mount()
    const id = await newProject(api, '模板来源')
    const template = await api.value('POST', '/workflows', { projectId: id, name: '待删模板' })
    expect((await api.call('DELETE', `/workflows/${template.id}`)).json.value).toMatchObject({ deleted: true })
    expect((await api.call('GET', `/workflows/${template.id}`)).status).toBe(404)
    expect((await api.call('DELETE', '/workflows/builtin-course')).status).toBe(409)
  })

  it('POST /workflows 缺来源返回 400', async () => {
    const api = await mount()
    expect((await api.call('POST', '/workflows', { name: '无来源' })).status).toBe(400)
  })
})

describe('routes — POST /import 类型感知', () => {
  const doc = '---\ntitle: 星海征途\ngenre: 科幻\n---\n\n第一章 启航\n讲义一。\n\n第二章 跃迁\n讲义二。'

  it('按 kind 解析题材并建对应类型的项目', async () => {
    const api = await mount()
    const result = await api.value('POST', '/import', { fileName: 'x.md', content: doc, kind: 'novel' })
    expect(result).toMatchObject({ title: '星海征途', genre: 'kehuan', kind: 'novel', chapterCount: 2 })

    // 建出来的项目确实是小说类型，且走小说工作流模板（不是课程的）
    const item = await api.value('GET', `/projects/${result.bookId}`)
    expect(item.kind).toBe('novel')
    expect(item.kindLabel).toBe('小说')
    expect(item.chapterCount).toBe(2)
  })

  it('未传 kind 时按课程口径兜底（科幻 → general）', async () => {
    const api = await mount()
    const result = await api.value('POST', '/import', { fileName: 'x.md', content: doc })
    expect(result).toMatchObject({ genre: 'general', kind: 'course', chapterCount: 2 })
  })

  it('空内容返回 400 IMPORT_FILE_EMPTY', async () => {
    const api = await mount()
    const res = await api.call('POST', '/import', { fileName: 'x.md', content: '   ' })
    expect(res.status).toBe(400)
    expect(messageOf(res.json)).toContain('文件内容为空')
  })
})
