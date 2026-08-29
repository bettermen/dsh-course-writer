/**
 * dsh-course-writer — 变量存储与课时同步（P1-C）。
 * variables.json 位于项目目录（VersionedFile 外壳）；课时提交时调用
 * applyChapterPatch 提取 <JSONPatch> 增量更新课程级/局部变量。
 */
import { join } from 'node:path'
import { atomicWriteFile, readOptional } from '../atomic-file.ts'
import { emptyVariableStore, type BookVariableState, type VariableStore, type VariableStoreData } from './types.ts'
import { applyPatchOperations, extractJsonPatchOperations } from './engine.ts'

export const VARIABLES_SCHEMA_VERSION = 1

function freshBookState(): BookVariableState {
  return { local_variables: {}, processed_chapter_numbers: [], last_scanned_chapter: 0 }
}

export class VariableStoreFile {
  constructor(private readonly filePath: string) {}

  async load(): Promise<VariableStoreData> {
    const text = await readOptional(this.filePath)
    if (text === undefined) return emptyVariableStore()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // 损坏 → 抛可报告错误（防止下次保存用空数据覆盖损坏文件）
      throw { code: 'INVALID_FIELD_TYPE', message: `variables.json 损坏（非法 JSON）: ${this.filePath}` } as never
    }
    if (parsed && typeof parsed === 'object' && (parsed as { schemaVersion?: number }).schemaVersion === VARIABLES_SCHEMA_VERSION
      && (parsed as { data?: unknown }).data && typeof (parsed as { data: unknown }).data === 'object') {
      return (parsed as { data: VariableStoreData }).data
    }
    // 旧格式（无外壳）兼容
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !('schemaVersion' in parsed)) {
      return parsed as VariableStoreData
    }
    throw { code: 'INVALID_FIELD_TYPE', message: `variables.json 形状非法: ${this.filePath}` } as never
  }

  async save(data: VariableStoreData): Promise<void> {
    const versioned: VariableStore = { schemaVersion: VARIABLES_SCHEMA_VERSION, data }
    await atomicWriteFile(this.filePath, `${JSON.stringify(versioned, null, 2)}\n`)
  }

  /**
   * 课时增量同步：从课时文本提取 JSON Patch 应用到书级局部变量，
   * 并记录扫描进度。幂等语义：同一章可反复提交（重写教案节会重新应用该章
   * patch，覆盖同路径旧值）——processed_chapter_numbers 仅作进度记录，
   * 不再短路跳过（此前"按章号短路"导致补写 patch 的课时静默丢失）。
   */
  async applyChapterPatch(bookId: string, chapterNo: number, chapterText: string): Promise<boolean> {
    const data = await this.load()
    const state = data.books[bookId] ?? freshBookState()
    const operations = extractJsonPatchOperations(chapterText)
    const changed = operations.length > 0
      ? applyPatchOperations(state.local_variables, operations)
      : false
    if (!state.processed_chapter_numbers.includes(chapterNo)) {
      state.processed_chapter_numbers = [...state.processed_chapter_numbers, chapterNo].sort((a, b) => a - b)
    }
    state.last_scanned_chapter = chapterNo
    data.books[bookId] = state
    await this.save(data)
    return changed
  }

  /**
   * 删除课时后清理扫描游标。
   * 已累积的变量值不做回滚（事实清除走账本 dropChapter），仅让游标不再指向已删除课时。
   */
  async dropChapter(bookId: string, chapterNo: number): Promise<void> {
    const data = await this.load()
    const state = data.books[bookId]
    if (!state) return
    state.processed_chapter_numbers = state.processed_chapter_numbers.filter((no) => no !== chapterNo)
    if (state.last_scanned_chapter === chapterNo) {
      state.last_scanned_chapter = state.processed_chapter_numbers.at(-1) ?? 0
    }
    data.books[bookId] = state
    await this.save(data)
  }

  /**
   * 按给定课时顺序重建书级局部变量。
   * 局部变量是按课时顺序累积的（后者覆盖前者），重排后必须重放，
   * 否则「第 3 课」的取值会留在被它顶替的位置上。
   */
  async rebuildBook(bookId: string, chapters: Array<{ no: number; text: string }>): Promise<void> {
    const data = await this.load()
    const state = freshBookState()
    // 以书级持久变量为初始状态（InitVar 模板镜像），再按新顺序重放 patch
    if (data.book_variables[bookId]) {
      state.local_variables = { [DEFAULT_KEY]: JSON.parse(JSON.stringify(data.book_variables[bookId])) }
    }
    for (const chapter of chapters) {
      applyPatchOperations(state.local_variables, extractJsonPatchOperations(chapter.text))
      state.processed_chapter_numbers.push(chapter.no)
      state.last_scanned_chapter = chapter.no
    }
    data.books[bookId] = state
    await this.save(data)
  }

  /** 初始化书级变量（InitVar 模板缺失时填充）。返回是否写入。 */
  async ensureBookVariables(bookId: string, initTemplate: Record<string, unknown> | null): Promise<boolean> {
    const data = await this.load()
    let dirty = false
    const state = data.books[bookId] ?? freshBookState()
    if (!state.local_variables[DEFAULT_KEY] && initTemplate) {
      state.local_variables[DEFAULT_KEY] = JSON.parse(JSON.stringify(initTemplate))
      dirty = true
    }
    if (!data.book_variables[bookId] && initTemplate) {
      data.book_variables[bookId] = JSON.parse(JSON.stringify(initTemplate))
      dirty = true
    }
    if (dirty) {
      data.books[bookId] = state
      await this.save(data)
    }
    return dirty
  }
}

/** 局部变量根键（对齐引擎 DEFAULT_VARIABLE_NAME）。 */
const DEFAULT_KEY = 'stat_data'

/** 项目目录内的变量文件路径辅助。 */
export function variablesFilePath(bookDir: string): string {
  return join(bookDir, 'variables.json')
}
