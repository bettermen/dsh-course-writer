/**
 * xiashuo — 创作流程 agent 工具注册（P1-F3）。
 *
 * 工具集：course_projects / course_phase / course_commit / course_override /
 * course_write_chapter / course_commit_chapter / course_audit / course_stats。
 * 写教案采用两段式（工具返回上下文包 → 模型在对话流输出讲义 →
 * course_commit_chapter 落盘校验），不依赖独立会话驱动
 * （client 侧「一键写教案」会话驱动在 P1-I 与 GUI 一起落地）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { asResult } from '../core/lorebook/service.ts'
import type { NovelService } from '../core/novel/service.ts'
import type { PhaseId } from '../core/workflow/index.ts'
import type { PhaseGate } from '../core/workflow/schema.ts'
import { jsonOutput } from './json.ts'

export interface NovelToolDeps {
  novel: NovelService
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function registerNovelDomainTools(ctx: Context, deps: NovelToolDeps): Array<() => void> {
  const { novel } = deps
  return [
    ctx.tools.register(defineTool({
      name: 'course_create_project',
      description: '创建项目（进入选题阶段）。支持四种内置类型与用户自定义类型，类型决定其工作流与题材口径。触发：创建项目/新课程/开新课程/新建课程/写一篇公文/写小说/写论文。',
      parameters: {
        title: { type: 'string', required: true, description: '项目名称' },
        genre: { type: 'string', description: '题材 id（按类型取值；课程缺省 general）' },
        kind: { type: 'string', description: '项目类型 id：course 课程 / official 公文 / novel 小说 / thesis 论文，或用户自定义类型；缺省 course' },
        description: { type: 'string', description: '一句话简介（选填）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { title: string; genre?: string; kind?: string; description?: string }
        const kind = String(args.kind ?? '').trim() || undefined
        return asJson(await asResult(async () => {
          const book = await novel.createProject(
            String(args.title ?? '').trim(),
            String(args.genre ?? 'general').trim() || 'general',
            kind,
          )
          if (args.description !== undefined) {
            await novel.updateProject(book.id, { description: String(args.description).trim() })
          }
          return await novel.load(book.id)
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_clone_project',
      description: '以一本已有项目为模板克隆新项目（模板复制）：复制字数目标/风格/禁用词 + 已完成的阶段设定文档，讲义不复制，状态机重置。触发：克隆/复制/套用模板/参照这本写一本新的。',
      parameters: {
        sourceId: { type: 'string', required: true, description: '源项目 ID（作为模板的书）' },
        title: { type: 'string', description: '新项目名（缺省为「源项目名（模板）」）' },
        genre: { type: 'string', description: '新题材 id（缺省沿用源题材）' },
        kind: { type: 'string', description: '新类型 id（缺省沿用源类型）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { sourceId: string; title?: string; genre?: string; kind?: string }
        return asJson(await asResult(() => novel.cloneProject(args.sourceId, { title: args.title, genre: args.genre, kind: args.kind })))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_projects',
      description: '列出全部课程项目（含当前阶段/课时数/总字数）。触发：项目/课程/我的书。',
      parameters: {},
      output: jsonOutput(),
      execute: async () => asJson(await asResult(() => novel.listProjects())),
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_phase',
      description: '查看项目当前阶段与门禁状态；带 phase 参数时进入该阶段（前置阶段需 approved/skipped）。' +
        '阶段：topic课程选题/setting学情设定/character教学目标/outline课程大纲/volume单元设计/chapter课时教案/writing课件与练习/revision评估修订/done结课。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        phase: { type: 'string', description: '要进入的阶段（省略=仅查看）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; phase?: string }
        return asJson(await asResult(async () => {
          if (args.phase) {
            const book = await novel.enterPhase(args.projectId, args.phase as PhaseId)
            return { book, entered: args.phase }
          }
          const book = await novel.load(args.projectId)
          return { book }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_commit',
      description: '提交阶段产物（唯一推进入口）：写入 docs/<phase>.md + 版本快照，按校验报告推进状态机。' +
        'passed=true 且 errorCount=0 → approved 解锁下一阶段；errorCount>0 → review 挂起。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        phase: { type: 'string', required: true, description: '阶段 id' },
        artifact: { type: 'string', required: true, description: '产物全文（markdown）' },
        errorCount: { type: 'number', description: 'error 级校验问题数（默认 0）' },
        warningCount: { type: 'number', description: 'warning 级问题数（默认 0）' },
        passed: { type: 'boolean', description: '是否通过校验（默认按 errorCount=0 判定）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; phase: string; artifact: string; errorCount?: number; warningCount?: number; passed?: boolean }
        const errorCount = args.errorCount ?? 0
        return asJson(await asResult(() => novel.commitPhase(
          args.projectId,
          args.phase as PhaseId,
          args.artifact,
          { passed: args.passed ?? errorCount === 0, errorCount, warningCount: args.warningCount ?? 0 },
        )))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_override',
      description: '用户级阶段覆盖：force（review 强制放行）/ reopen（驳回回修改）/ skip（跳过）/ rollback（revision/done 回退到已批准阶段）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        phase: { type: 'string', required: true, description: '目标阶段 id' },
        action: { type: 'string', required: true, description: 'force|reopen|skip|rollback' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; phase: string; action: 'force' | 'reopen' | 'skip' | 'rollback' }
        return asJson(await asResult(() => novel.overridePhase(args.projectId, args.phase as PhaseId, args.action)))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_write_chapter',
      description: '组装写教案上下文包（L1 全书设定 + L2 卷章教案与邻近课时 + L3 摘要/变量/资料库命中 + 硬约束），' +
        '模型据此在回复中直接输出本章讲义，随后调用 course_commit_chapter 落盘。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', required: true, description: '课时号' },
        brief: { type: 'string', description: '本章教案（缺省用 chapter 阶段产物）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo: number; brief?: string }
        return asJson(await asResult(() => novel.assemble(args.projectId, args.chapterNo, args.brief)))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_commit_chapter',
      description: '提交课时讲义：自动统计字数/对话占比/达标判定，落盘 chapters/ch<no>.md，更新项目统计，' +
        '提取讲义中的 <JSONPatch> 更新变量。返回课时元数据与达标状态。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', required: true, description: '课时号' },
        title: { type: 'string', required: true, description: '课时标题' },
        text: { type: 'string', required: true, description: '课时讲义' },
        brief: { type: 'string', description: '一句话梗概（教案对照用）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo: number; title: string; text: string; brief?: string }
        return asJson(await asResult(async () => {
          const chapter = await novel.saveChapter(args.projectId, args.chapterNo, args.title, args.text, args.brief)
          const stats = await novel.chapterStats(args.projectId, args.chapterNo)
          return { chapter, stats }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_audit',
      description: '查看项目审计日志（阶段流转/提交/覆盖/写教案事件）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => asJson(await asResult(() => novel.audit((rawArgs as { projectId: string }).projectId))),
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_stats',
      description: '查看项目统计：总字数/课时数/最近写入/各阶段状态。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const projectId = (rawArgs as { projectId: string }).projectId
        return asJson(await asResult(async () => {
          const book = await novel.load(projectId)
          return {
            id: book.id,
            title: book.title,
            genre: book.genre,
            status: book.status,
            currentPhase: book.currentPhase,
            stats: book.stats,
            phases: book.phases,
          }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_workflow',
      description: '查看或编辑项目工作流（阶段的有序列表 + 每阶段门禁/产物/提示词/评审标准）。' +
        'action=list 查看（默认）；action=add 新增阶段；action=rename 重命名；action=update 编辑阶段属性；' +
        'action=delete 删除阶段（最后一个拒绝删）；action=reorder 拖拽排序（from/to 为 0 起下标）；' +
        'action=reset 恢复为该类型默认流程。触发：加一个阶段/删掉某阶段/调整流程/看流程/重排阶段/恢复默认流程。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        action: { type: 'string', description: 'list | add | rename | update | delete | reorder | reset（默认 list）' },
        name: { type: 'string', description: '阶段名（add/rename/update）' },
        index: { type: 'number', description: '插入位置下标（add，缺省追加末尾）' },
        gate: { type: 'string', description: '门禁类型（add/update）：none 无 / manual 手动 / checklist 清单 / ai 评审' },
        phaseId: { type: 'string', description: '目标阶段 id（rename/update/delete）' },
        description: { type: 'string', description: '阶段说明（update）' },
        prompt: { type: 'string', description: '该阶段 AI 执行提示词（update）' },
        rubric: { type: 'string', description: '评审标准（update，gate=ai 时生效）' },
        optional: { type: 'boolean', description: '可跳过（update）' },
        from: { type: 'number', description: '拖拽起点下标（reorder）' },
        to: { type: 'number', description: '拖拽终点下标（reorder）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as {
          projectId: string; action?: string; name?: string; index?: number; gate?: string
          phaseId?: string; description?: string; prompt?: string; rubric?: string
          optional?: boolean; from?: number; to?: number
        }
        const action = args.action ?? 'list'
        return asJson(await asResult(async () => {
          switch (action) {
            case 'list':
              return { workflow: await novel.workflowOf(args.projectId) }
            case 'add':
              return {
                workflow: await novel.addWorkflowPhase(args.projectId, {
                  name: args.name ?? '',
                  ...(typeof args.index === 'number' ? { index: args.index } : {}),
                  ...(args.gate ? { gate: args.gate as PhaseGate } : {}),
                }),
              }
            case 'rename':
              return { workflow: await novel.renameWorkflowPhase(args.projectId, args.phaseId ?? '', args.name ?? '') }
            case 'delete':
              return { workflow: await novel.removeWorkflowPhase(args.projectId, args.phaseId ?? '') }
            case 'reorder':
              return { workflow: await novel.reorderWorkflowPhases(args.projectId, args.from ?? 0, args.to ?? 0) }
            case 'reset':
              return { workflow: await novel.resetWorkflow(args.projectId) }
            case 'update': {
              const patch: Record<string, unknown> = {}
              if (args.name !== undefined) patch.name = args.name
              if (args.description !== undefined) patch.description = args.description
              if (args.prompt !== undefined) patch.prompt = args.prompt
              if (args.rubric !== undefined) patch.rubric = args.rubric
              if (args.gate !== undefined) patch.gate = args.gate
              if (args.optional !== undefined) patch.optional = args.optional === true
              return { workflow: await novel.updateWorkflowPhase(args.projectId, args.phaseId ?? '', patch as never) }
            }
            default:
              throw { code: 'INVALID_FIELD_TYPE', message: `未知 action: ${action}` } as never
          }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_project_update',
      description: '更新项目元信息：名称/简介/题材/状态/类型。注意：改类型（kind）会连带把工作流重置为该类型的默认流程。' +
        '状态取值：draft 草稿 / in_progress 进行中 / paused 暂停 / done 已完成 / archived 已归档。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        title: { type: 'string', description: '新名称' },
        description: { type: 'string', description: '一句话简介' },
        genre: { type: 'string', description: '题材 id' },
        status: { type: 'string', description: 'draft | in_progress | paused | done | archived' },
        kind: { type: 'string', description: '类型 id（course/official/novel/thesis 或自定义；改类型会重置工作流）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; title?: string; description?: string; genre?: string; status?: string; kind?: string }
        const patch: Record<string, unknown> = {}
        if (args.title !== undefined) patch.title = args.title
        if (args.description !== undefined) patch.description = args.description
        if (args.genre !== undefined) patch.genre = args.genre
        if (args.status !== undefined) patch.status = args.status
        if (args.kind !== undefined) patch.kind = args.kind
        return asJson(await asResult(() => novel.updateProject(args.projectId, patch as never)))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'course_project_delete',
      description: '删除项目。keepChapters=true 仅删项目记录、讲义文件保留在磁盘上；缺省 false 连讲义一并删除（不可恢复）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        keepChapters: { type: 'boolean', description: '是否保留讲义文件（默认 false）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; keepChapters?: boolean }
        return asJson(await asResult(() => novel.deleteProject(args.projectId, args.keepChapters === true)))
      },
      isConcurrencySafe: () => true,
    })),
  ]
}
