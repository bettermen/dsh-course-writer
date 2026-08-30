/**
 * workflow/store — 工作流模板库（内置只读 + 用户模板 CRUD）。
 *
 * 全量 vitest 在本机会 OOM（exit 137），跑单文件即可。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowStore } from '../src/core/workflow/store.ts'
import { COURSE_TEMPLATE, OFFICIAL_TEMPLATE, THESIS_TEMPLATE } from '../src/core/workflow/templates.ts'
import { cloneWorkflow } from '../src/core/workflow/schema.ts'
import type { Workflow } from '../src/core/workflow/schema.ts'
import type { PluginError } from '../src/core/types.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function freshStore(): Promise<{ store: WorkflowStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'wftpl-'))
  roots.push(dir)
  return { store: new WorkflowStore(join(dir, 'user')), dir: join(dir, 'user') }
}

async function catchError<T>(body: Promise<T>): Promise<PluginError> {
  try {
    await body
  } catch (cause) {
    return cause as PluginError
  }
  throw new Error('expected rejection')
}

describe('WorkflowStore — 列出与读取', () => {
  it('空用户目录时只有内置模板', async () => {
    const { store } = await freshStore()
    const all = await store.listAll()
    expect(all.map((t) => t.id)).toEqual([
      'builtin-course', 'builtin-official', 'builtin-novel', 'builtin-thesis', 'builtin-generic',
    ])
    expect(await store.listUser()).toEqual([])
  })

  it('按 kind 过滤；按 scope 过滤', async () => {
    const { store } = await freshStore()
    await store.createFrom(THESIS_TEMPLATE, { name: '我的论文流程' })
    expect((await store.listAll({ kind: 'thesis' })).map((t) => t.id)).toEqual(['builtin-thesis', expect.stringMatching(/^wftpl-/)])
    expect((await store.listAll({ scope: 'builtin' })).length).toBe(5)
    expect((await store.listAll({ scope: 'user' })).length).toBe(1)
  })

  it('内置模板按模板 id 可读（只读来源）', async () => {
    const { store } = await freshStore()
    const tpl = await store.read('builtin-official')
    expect(tpl?.id).toBe('builtin-official')
    expect(tpl?.scope).toBe('builtin')
  })

  it('损坏的用户模板跳过，不影响其它模板', async () => {
    const { store, dir } = await freshStore()
    await store.createFrom(THESIS_TEMPLATE, { name: '正常模板' })
    await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8')
    expect((await store.listUser()).map((t) => t.name)).toEqual(['正常模板'])
  })

  it('非法 id 读取返回 undefined 而非抛错（防路径穿越）', async () => {
    const { store } = await freshStore()
    expect(await store.read('../secret')).toBeUndefined()
    expect(await store.remove('../secret')).toBe(false)
  })
})

describe('WorkflowStore — 另存为模板', () => {
  it('从项目工作流派生用户模板并记录来源', async () => {
    const { store } = await freshStore()
    const source: Workflow = { ...cloneWorkflow(OFFICIAL_TEMPLATE), id: 'wf_bk_1', scope: 'project', templateId: 'builtin-official' }
    const saved = await store.createFrom(source, { name: '我司公文流程' })
    expect(saved).toMatchObject({ name: '我司公文流程', kind: 'official', scope: 'user', templateId: 'wf_bk_1' })
    expect(saved.id).toMatch(/^wftpl-/)
    expect(saved.phases).toHaveLength(OFFICIAL_TEMPLATE.phases.length)
    // 深拷贝：改模板不影响来源
    saved.phases[0]!.name = '改过'
    expect(source.phases[0]?.name).not.toBe('改过')
  })

  it('可覆盖 nameEn 与 kind', async () => {
    const { store } = await freshStore()
    const saved = await store.createFrom(COURSE_TEMPLATE, { name: '英语流程', nameEn: 'English flow', kind: 'novel' })
    expect(saved).toMatchObject({ nameEn: 'English flow', kind: 'novel' })
  })

  it('模板名称为空 / 超长拒绝', async () => {
    const { store } = await freshStore()
    expect((await catchError(store.createFrom(COURSE_TEMPLATE, { name: '  ' }))).message).toContain('不能为空')
    expect((await catchError(store.createFrom(COURSE_TEMPLATE, { name: 'x'.repeat(41) }))).message).toContain('40 字符')
  })

  it('落盘后可被重新读出（持久化闭环）', async () => {
    const { store } = await freshStore()
    const saved = await store.createFrom(THESIS_TEMPLATE, { name: '论文模板 A' })
    const reread = await store.read(saved.id)
    expect(reread?.name).toBe('论文模板 A')
    expect(reread?.phases).toHaveLength(8)
  })
})

describe('WorkflowStore — 改删与内置只读', () => {
  it('整体保存强制 scope=user', async () => {
    const { store } = await freshStore()
    const draft = { ...cloneWorkflow(COURSE_TEMPLATE), id: 'my-course', name: '我的课程流程', scope: 'project' as const }
    const saved = await store.save(draft)
    expect(saved.scope).toBe('user')
    expect((await store.read('my-course'))?.scope).toBe('user')
  })

  it('内置 id 不可整体覆盖（save 拒绝）', async () => {
    const { store } = await freshStore()
    expect((await catchError(store.save({ ...cloneWorkflow(COURSE_TEMPLATE), name: '覆盖内置' }))).message).toContain('内置模板只读')
  })

  it('局部更新名称 / 类型 / 阶段', async () => {
    const { store } = await freshStore()
    const tpl = await store.createFrom(COURSE_TEMPLATE, { name: '原名称' })
    const updated = await store.update(tpl.id, { name: '新名称', kind: 'official', phases: tpl.phases.slice(0, 3) })
    expect(updated).toMatchObject({ name: '新名称', kind: 'official' })
    expect(updated.phases).toHaveLength(3)
  })

  it('阶段 id 重复 / 非法时拒绝', async () => {
    const { store } = await freshStore()
    const tpl = await store.createFrom(COURSE_TEMPLATE, { name: '原名称' })
    const dup = tpl.phases.slice(0, 2).map((p, i) => ({ ...p, id: i === 0 ? 'outline' : 'outline' }))
    expect((await catchError(store.update(tpl.id, { phases: dup }))).message).toContain('重复')
  })

  it('内置模板不可改、不可删', async () => {
    const { store } = await freshStore()
    expect((await catchError(store.update('builtin-course', { name: 'x' }))).message).toContain('内置模板只读')
    expect((await catchError(store.remove('builtin-novel'))).message).toContain('内置模板只读')
  })

  it('删除用户模板；重复删除返回 false', async () => {
    const { store } = await freshStore()
    const tpl = await store.createFrom(COURSE_TEMPLATE, { name: '待删' })
    expect(await store.remove(tpl.id)).toBe(true)
    expect(await store.remove(tpl.id)).toBe(false)
    expect(await store.listUser()).toEqual([])
  })

  it('更新不存在的模板返回 ENTRY_NOT_FOUND', async () => {
    const { store } = await freshStore()
    expect((await catchError(store.update('nope', { name: 'x' }))).code).toBe('ENTRY_NOT_FOUND')
  })
})
