/**
 * dsh-course-writer — 出题/试卷/知识图谱工具。
 * 依赖 LLM 与资料库（lorebook）知识点；模型不可用时降级（知识图谱回退到启发式构建）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { asResult } from '../core/lorebook/service.ts'
import type { NovelService } from '../core/novel/service.ts'
import type { LoreService } from '../core/lorebook/service.ts'
import type { LlmClient } from '../core/llm/client.ts'
import { loadPromptLibrary, renderPromptTemplate } from '../core/prompts/index.ts'
import { jsonOutput } from './json.ts'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface QuizToolDeps {
  novel: NovelService
  lore: LoreService
  llm: LlmClient | null
  bookDirOf(bookId: string): string
  promptsDir: string
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

async function renderPrompt(promptsDir: string, id: string, vars: Record<string, string>): Promise<string | null> {
  const library = await loadPromptLibrary(promptsDir)
  const template = library.find((t) => t.id === id)
  return template ? renderPromptTemplate(template, vars) : null
}

/** 提取 JSON 对象（容忍模型输出前后的说明文字）。 */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 汇总课程知识点（资料库条目 + 大纲），用于出题与图谱。 */
async function gatherKnowledge(
  novel: NovelService,
  lore: LoreService,
  projectId: string,
  chapterNo?: number,
): Promise<{ entries: string; outline: string; chapter: string }> {
  const all = await lore.listEntries()
  const mine = all.filter((e) => e.book_id === projectId || !e.book_id)
  const entries = mine.map((e) => `- ${e.name}：${e.content}`).join('\n')
  let outline = ''
  try {
    outline = (await novel.artifactOf(projectId, 'outline')) ?? ''
  } catch {
    outline = ''
  }
  let chapter = ''
  if (chapterNo !== undefined) {
    try {
      chapter = await novel.chapterText(projectId, chapterNo)
    } catch {
      chapter = ''
    }
  }
  return { entries, outline, chapter }
}

export function registerQuizTools(ctx: Context, deps: QuizToolDeps): Array<() => void> {
  const { novel, lore, llm, bookDirOf, promptsDir } = deps

  return [
    // ── 出题 ──
    ctx.tools.register(defineTool({
      name: 'course_gen_questions',
      description: '根据课时/知识点生成题目：单选/多选/填空/简答/判断，附答案与解析。需要模型。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', description: '课时号（省略=仅基于知识点/大纲出题）' },
        count: { type: 'number', description: '题目数量（默认 5）' },
        types: { type: 'string', description: '题型（逗号分隔）：single/multiple/blank/short/judge（默认 single,multiple）' },
        difficulty: { type: 'string', description: '难度：easy/medium/hard（默认 medium）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo?: number; count?: number; types?: string; difficulty?: string }
        return asJson(await asResult(async () => {
          if (!llm) return { ok: false, reason: '模型未就绪，无法出题' }
          const k = await gatherKnowledge(novel, lore, args.projectId, args.chapterNo)
          const source = [k.chapter, k.entries, k.outline].filter(Boolean).join('\n\n')
          if (!source.trim()) return { ok: false, reason: '该项目没有可用的知识点/大纲/课时内容' }
          const topic = (await novel.load(args.projectId)).title
          const prompt = await renderPrompt(promptsDir, 'quiz-questions', {
            topic,
            knowledge: source,
            count: String(args.count ?? 5),
            types: args.types ?? 'single,multiple',
            difficulty: args.difficulty ?? 'medium',
          })
          if (!prompt) return { ok: false, reason: '内置提示词缺失' }
          const raw = await llm.complete('你是资深出题教师，只输出 JSON。', prompt, 6000)
          const parsed = extractJson(raw)
          return parsed ? { questions: parsed } : { questionsText: raw, ok: true, note: '模型输出非严格 JSON，已返回原文' }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 试卷生成 ──
    ctx.tools.register(defineTool({
      name: 'course_gen_exam',
      description: '根据课程大纲与知识点生成整份试卷（含答案与解析）。需要模型。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string }
        return asJson(await asResult(async () => {
          if (!llm) return { ok: false, reason: '模型未就绪，无法生成试卷' }
          const k = await gatherKnowledge(novel, lore, args.projectId)
          const title = (await novel.load(args.projectId)).title
          const prompt = await renderPrompt(promptsDir, 'exam-paper', {
            title,
            outline: k.outline || '（大纲暂缺）',
            knowledge: k.entries || '（知识点暂缺）',
          })
          if (!prompt) return { ok: false, reason: '内置提示词缺失' }
          const paper = await llm.complete('你是资深命题专家，输出完整试卷。', prompt, 8000)
          return { exam: paper }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 知识图谱 ──
    ctx.tools.register(defineTool({
      name: 'course_gen_knowledge_graph',
      description: '生成课程知识图谱（nodes/edges JSON），保存到项目目录并返回；无模型时用资料库启发式构建。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string }
        return asJson(await asResult(async () => {
          const k = await gatherKnowledge(novel, lore, args.projectId)
          const all = await lore.listEntries()
          const mine = all.filter((e) => e.book_id === args.projectId || !e.book_id)

          let nodes: Array<{ id: string; label: string; type: string }> = []
          let edges: Array<{ source: string; target: string; label: string }> = []
          let source = 'heuristic'

          if (llm) {
            const prompt = await renderPrompt(promptsDir, 'knowledge-graph', {
              knowledge: k.entries || '（资料库暂空）',
              outline: k.outline || '（大纲暂缺）',
            })
            if (prompt) {
              const raw = await llm.complete('你是知识图谱专家，只输出 JSON。', prompt, 5000)
              const parsed = extractJson(raw)
              if (parsed && Array.isArray((parsed as { nodes?: unknown }).nodes)) {
                nodes = (parsed as { nodes: Array<{ id: string; label: string; type: string }> }).nodes
                edges = (parsed as { edges: Array<{ source: string; target: string; label: string }> }).edges ?? []
                source = 'llm'
              }
            }
          }

          // 回退：从资料库条目启发式建图
          if (nodes.length === 0) {
            nodes = mine.map((e, i) => ({ id: `n${i}`, label: e.name, type: 'concept' }))
            const labelIndex = new Map(nodes.map((n) => [n.label, n.id]))
            edges = []
            for (let i = 0; i < mine.length; i++) {
              for (let j = 0; j < mine.length; j++) {
                if (i === j) continue
                const a = mine[i]!
                const b = mine[j]!
                const hit = (a.keywords ?? []).some((kw) => b.name.includes(kw) || b.content.includes(kw))
                if (hit) edges.push({ source: `n${i}`, target: `n${j}`, label: '相关' })
              }
            }
          }

          // 持久化供前端可视化
          try {
            const dir = bookDirOf(args.projectId)
            await mkdir(dir, { recursive: true })
            await writeFile(join(dir, 'knowledge-graph.json'), JSON.stringify({ nodes, edges }, null, 2), 'utf8')
          } catch {
            // 写盘失败不阻断返回
          }

          return { nodes, edges, nodeCount: nodes.length, edgeCount: edges.length, source }
        }))
      },
      isConcurrencySafe: () => true,
    })),
  ]
}
