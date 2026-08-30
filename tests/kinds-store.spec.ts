/**
 * kinds-store — 自定义项目类型持久化。
 *
 * 全量 vitest 在本机会 OOM（exit 137），跑单文件即可。
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KindStore } from '../src/core/kinds-store.ts'
import type { PluginError } from '../src/core/types.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function freshStore(): Promise<{ store: KindStore; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'kinds-'))
  roots.push(dir)
  const file = join(dir, 'nested', 'kinds.json')
  return { store: new KindStore(file), file }
}

async function catchError<T>(body: Promise<T>): Promise<PluginError> {
  try {
    await body
  } catch (cause) {
    return cause as PluginError
  }
  throw new Error('expected rejection')
}

describe('KindStore — 读取', () => {
  it('空库只有内置 4 种', async () => {
    const { store } = await freshStore()
    expect((await store.list()).map((k) => k.id)).toEqual(['course', 'official', 'novel', 'thesis'])
    expect(await store.listCustom()).toEqual([])
  })

  it('kinds.json 损坏时回退内置类型（不阻断插件）', async () => {
    const { store, file } = await freshStore()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '{ not json', 'utf8')
    expect(await store.listCustom()).toEqual([])
    expect((await store.list()).length).toBe(4)
  })

  it('data 不是数组时回退空自定义列表', async () => {
    const { store, file } = await freshStore()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ schemaVersion: 1, data: { course: 1 } }), 'utf8')
    expect(await store.listCustom()).toEqual([])
  })

  it('自定义类型一律标记 builtin=false（防止持久化项伪装内置）', async () => {
    const { store, file } = await freshStore()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      data: [{ id: 'course', label: '课程', labelEn: 'Course', icon: '📘', description: '', genres: [], builtin: true, templateId: 'builtin-course' }],
    }), 'utf8')
    expect((await store.listCustom())[0]?.builtin).toBe(false)
  })
})

describe('KindStore — 创建', () => {
  it('新建后落盘并出现在清单末尾', async () => {
    const { store } = await freshStore()
    const kind = await store.create({ label: '新媒体文案', genres: [{ label: '公众号' }, { label: '小红书' }] })
    expect(kind).toMatchObject({ id: 'kind', label: '新媒体文案', builtin: false, templateId: 'builtin-generic' })
    expect(kind.genres.map((g) => g.id)).toEqual(['genre-1', 'genre-2'])
    expect((await store.list()).map((k) => k.id)).toEqual(['course', 'official', 'novel', 'thesis', 'kind'])
    // 重新读盘验证持久化
    const reread = await store.listCustom()
    expect(reread).toHaveLength(1)
    expect(reread[0]?.label).toBe('新媒体文案')
  })

  it('省略 id 时同名自动生成不冲突的 id', async () => {
    const { store } = await freshStore()
    const first = await store.create({ label: '文案' })
    const second = await store.create({ label: '文案' })
    expect(first.id).toBe('kind')
    expect(second.id).toBe('kind-2')
  })

  it('拒绝空名称 / 保留字 / 非法 id / 重复 id', async () => {
    const { store } = await freshStore()
    expect((await catchError(store.create({ label: '  ' }))).message).toContain('不能为空')
    expect((await catchError(store.create({ id: 'course', label: '抢占' }))).message).toContain('保留字')
    expect((await catchError(store.create({ id: 'Bad Id', label: '非法' }))).message).toContain('id 非法')
    await store.create({ id: 'copy', label: '文案' })
    expect((await catchError(store.create({ id: 'copy', label: '重复' }))).message).toContain('已存在')
  })

  it('题材数量上限 50', async () => {
    const { store } = await freshStore()
    const genres = Array.from({ length: 51 }, (_, i) => ({ label: `题材${i}` }))
    expect((await catchError(store.create({ label: '超多题材', genres }))).message).toContain('50')
  })
})

describe('KindStore — 编辑与删除', () => {
  it('局部更新：只改传入字段，其余保留', async () => {
    const { store } = await freshStore()
    await store.create({ id: 'copy', label: '文案', genres: [{ label: '公众号' }], templateId: 'builtin-generic' })
    const updated = await store.update('copy', { label: '文案改', icon: '✍️' })
    expect(updated).toMatchObject({ id: 'copy', label: '文案改', icon: '✍️', templateId: 'builtin-generic' })
    expect(updated.genres).toEqual([{ id: 'genre-1', label: '公众号' }])
  })

  it('更新题材全量替换；非法题材 id 拒绝', async () => {
    const { store } = await freshStore()
    await store.create({ id: 'copy', label: '文案', genres: [{ label: '公众号' }] })
    const updated = await store.update('copy', { genres: [{ id: 'wechat', label: '公众号' }, { label: '小红书' }] })
    expect(updated.genres.map((g) => g.id)).toEqual(['wechat', 'genre-2'])
    expect((await catchError(store.update('copy', { genres: [{ id: 'Bad Id', label: 'x' }] }))).message).toContain('题材 id 非法')
  })

  it('内置类型不可改、不可删', async () => {
    const { store } = await freshStore()
    expect((await catchError(store.update('course', { label: '改名' }))).message).toContain('内置类型不可修改')
    expect((await catchError(store.remove('thesis'))).message).toContain('内置类型不可删除')
  })

  it('删除自定义类型；不存在的 id 返回 false', async () => {
    const { store } = await freshStore()
    await store.create({ id: 'copy', label: '文案' })
    expect(await store.remove('copy')).toBe(true)
    expect(await store.remove('copy')).toBe(false)
    expect(await store.listCustom()).toEqual([])
    expect((await catchError(store.update('copy', { label: 'x' }))).code).toBe('ENTRY_NOT_FOUND')
  })
})
