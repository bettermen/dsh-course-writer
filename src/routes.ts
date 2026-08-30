/**
 * xiashuo — host HTTP 路由（P1-I 建基，P2 扩展项目管理与工作流编辑）。
 * 单 prefix 路由 /api/xiashuo（WebRoute.path 无尾斜杠），handler 内按路径分派：
 *
 *   ── 项目类型 ──
 *   GET    /kinds                      类型清单（内置 4 种 + 自定义）
 *   POST   /kinds                      新建自定义类型（fence）
 *   PATCH  /kinds/<id>                 编辑自定义类型（内置只读）
 *   DELETE /kinds/<id>                 删除自定义类型（内置只读）
 *
 *   ── 项目管理 ──
 *   GET    /projects?kind=&status=&q=&sort=&order=   项目列表（筛选 + 排序 + 进度）
 *   POST   /projects                   新建（title / kind / genre? / description?）
 *   GET    /projects/<id>              项目详情（与列表同构，供编辑弹窗回填）
 *   PATCH  /projects/<id>              编辑元信息
 *   DELETE /projects/<id>?keepFiles=1  删除
 *   POST   /projects/<id>/duplicate    复制项目
 *   POST   /projects/<id>/archive      归档 / 取消归档
 *   POST   /import                     导入 txt/md（body.kind 决定题材口径与初始流程）
 *
 *   ── 工作流 ──
 *   GET    /projects/<id>/workflow               读项目流程
 *   PUT    /projects/<id>/workflow               整体保存
 *   POST   /projects/<id>/workflow/reset         恢复类型默认
 *   POST   /projects/<id>/workflow/phases                    新增阶段
 *   POST   /projects/<id>/workflow/phases/reorder            拖拽排序
 *   POST   /projects/<id>/workflow/phases/<pid>/rename|update|delete
 *   GET    /workflows?kind=&scope=               模板清单（内置只读 + 用户）
 *   POST   /workflows                            另存为模板
 *   GET / PATCH / DELETE  /workflows/<id>        模板读/改/删（内置只读）
 *
 * 安全：CSRF/dns-rebinding fence（自定义头校验，仿 dsh-plugin-publisher）。
 * 门禁联动：assembly 未启用时返回 503（路由固定注册、handler 检查）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NovelAssembly, NovelServices } from './assembly.ts'
import { readOptional } from './core/atomic-file.ts'
import { asResult } from './core/lorebook/service.ts'
import { buildWritePrompt } from './core/write-prompt.ts'
import { genreLabel } from './core/genres.ts'
import { BUILTIN_KINDS, DEFAULT_KIND_ID, kindById } from './core/kinds.ts'
import { decorateProject, parseProjectQuery, queryProjects } from './core/project/query.ts'
import type { ProjectListItem } from './core/project/query.ts'
import { toSummary } from './core/novel/store.ts'
import type { ProjectPatch } from './core/novel/service.ts'
import type { BookSummary } from './core/novel/types.ts'
import { isProjectStatus } from './core/novel/status.ts'
import { createPhase, insertPhase, isPhaseGate, removePhase, renamePhase, reorderPhase, updatePhase, validateWorkflow } from './core/workflow/schema.ts'
import type { Workflow, WorkflowArtifact, WorkflowPhase } from './core/workflow/schema.ts'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const PREFIX = '/api/xiashuo'
const FENCE_HEADER = 'x-xiashuo'

/** 分享查看/协作页（自包含：内联 CSS+JS，fetch /share/<token>/data 渲染；write 模式可编辑保存）。 */
function sharePageHtml(title: string, mode: 'read' | 'write', token: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const badge = mode === 'write' ? '可编辑协作' : '只读'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 虾说</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#222;background:#f5f7fa}
header{background:#243A61;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:10px}
header h1{margin:0;font-size:18px;font-weight:600}
.badge{font-size:12px;padding:2px 10px;border-radius:20px;background:rgba(255,255,255,.18)}
.spacer{flex:1}
.hbtn{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:5px 12px;cursor:pointer;font-size:13px}
.hbtn:hover{background:rgba(255,255,255,.24)}
.layout{display:flex;height:calc(100vh - 56px)}
nav{width:240px;border-right:1px solid #e5e5e5;overflow:auto;background:#fff;padding:10px}
nav .item{padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;color:#444}
nav .item:hover{background:#f0f4fb}
nav .item.on{background:#eef3fe;color:#185fa5;font-weight:600}
main{flex:1;overflow:auto;padding:24px 32px;background:#fff}
main h2{margin:0 0 16px;font-size:20px;color:#243A61}
main .body{font-size:15px;line-height:1.9;white-space:pre-wrap}
textarea{width:100%;min-height:60vh;padding:12px;border:1px solid #ddd;border-radius:8px;font-family:ui-monospace,Menlo,monospace;font-size:14px;line-height:1.7}
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px}
button{padding:6px 14px;border-radius:6px;border:1px solid #ccc;background:#f6f6f6;cursor:pointer;font-size:13px}
button.primary{background:#378add;border-color:#378add;color:#fff}
.msg{font-size:12px;color:#2f9e5b;margin-left:8px}
.empty{color:#999;font-size:13px;padding:20px}
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><span class="badge">${badge}</span><span class="spacer"></span><button class="hbtn" onclick="copyAll()">复制全文</button><button class="hbtn" onclick="exp('txt')">导出 TXT</button><button class="hbtn" onclick="exp('word')">导出 Word</button></header>
<div class="layout">
<nav id="toc"></nav>
<main id="viewer"></main>
</div>
<script>
var TOKEN=${JSON.stringify(token)}, MODE=${JSON.stringify(mode)};
var data=null, cur=0, editing=null;
function mdInline(s){s=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');s=s.replace(/\\\`([^\\\`]+)\\\`/g,'<code>$1</code>');s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');s=s.replace(/\\*([^*]+)\\*/g,'<em>$1</em>');return s}
function mdText(t){var out='',inCode=false;t.split('\\n').forEach(function(line){if(line.trim().slice(0,3)==='\\\`\\\`\\\`'){inCode=!inCode;return}if(inCode){out+='<div style=\\\"font-family:monospace;background:#f6f8fa;padding:10px;border-radius:6px;margin:8px 0\\\">'+line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';return}var h=line.match(/^(#{1,4})\\s+(.*)/);if(h){out+='<'+('h'+(h[1].length+1))+'>'+mdInline(h[2])+'</'+('h'+(h[1].length+1))+'>';return}if(/^\\s*[-*+]\\s+/.test(line)){out+='<div style=\\\"padding-left:16px\\\">· '+mdInline(line.replace(/^\\s*[-*+]\\s+/,''))+'</div>';return}if(line.trim()===''){out+='<div style=\\\"height:8px\\\"></div>';return}out+='<div>'+mdInline(line)+'</div>'});return out}
function render(){var c=data.chapters[cur];if(!c){document.getElementById('viewer').innerHTML='<div class=\\\"empty\\\">暂无章节</div>';return}
var toc=document.getElementById('toc');toc.innerHTML='';data.chapters.forEach(function(ch,i){var d=document.createElement('div');d.className='item'+(i===cur?' on':'');d.textContent=ch.no+'. '+(ch.title||('第 '+ch.no+' 课'));d.onclick=function(){cur=i;editing=null;render()};toc.appendChild(d)});
var v=document.getElementById('viewer');
if(MODE==='write'){v.innerHTML='<h2>'+mdInline(c.title||('第 '+c.no+' 课'))+' <span style=\\\"font-size:12px;color:#999;font-weight:400\\\">v'+c.version+'</span></h2><div class=\\\"toolbar\\\"><button class=\\\"primary\\\" onclick=\\\"save()\\\">保存</button><button onclick=\\\"cancelEdit()\\\">取消</button><span class=\\\"msg\\\" id=\\\"msg\\\"></span></div><textarea id=\\\"ed\\\">'+c.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</textarea>'}
else{v.innerHTML='<h2>'+mdInline(c.title||('第 '+c.no+' 课'))+'</h2><div class=\\\"body\\\">'+mdText(c.content)+'</div>'}}
function save(){var c=data.chapters[cur];var ed=document.getElementById('ed');var send=function(base){return fetch('/share/'+TOKEN+'/chapters/'+c.no,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:c.title,text:ed.value,baseVersion:base})}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})})};send(c.version).then(function(res){if(res.status===409){var p=JSON.parse(res.body.error.message);if(confirm('⚠️ 此章节已被他人修改（对方版本 v'+p.version+'）。\\n点「确定」覆盖对方修改，点「取消」加载最新版本。')){send(null).then(function(r2){c.version=r2.body.value.chapter.version;c.content=ed.value;document.getElementById('msg').textContent='已保存（覆盖）'})}else{c.version=p.version;c.content=p.content;ed.value=p.content;document.getElementById('msg').textContent='已加载最新版本'}}else if(res.status===200){c.version=res.body.value.chapter.version;c.content=ed.value;document.getElementById('msg').textContent='已保存'}else{document.getElementById('msg').textContent='保存失败'}}).catch(function(){document.getElementById('msg').textContent='保存失败'})}
function copyAll(){var t=data.chapters.map(function(c){return c.title+'\\n\\n'+c.content}).join('\\n\\n\\n');if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){alert('已复制全文到剪贴板')}).catch(function(){window.prompt('请手动复制',t)})}else{window.prompt('请手动复制',t)}}
function exp(f){window.location.href='/share/'+TOKEN+'/export?format='+f}
function cancelEdit(){render()}
fetch('/share/'+TOKEN+'/data').then(function(r){return r.json()}).then(function(j){data=j.value||j;cur=0;render()}).catch(function(){document.getElementById('viewer').innerHTML='<div class=\\\"empty\\\">加载失败，分享可能已撤销</div>'});
</script>
</body>
</html>`
}

/** 路由路径解析（纯函数，可单测）。返回 segments 与具名参数。 */
export function parseNovelPath(url: string | undefined): { segments: string[]; projectId?: string; section?: string; noText?: string } {
  const path = new URL(url ?? '/', 'http://localhost').pathname
  const rest = path.slice(PREFIX.length)
  const segments = rest.split('/').filter(Boolean)
  const [, projectId, section, noText] = segments
  return { segments, projectId, section, noText }
}

export function registerNovelRoutes(ctx: Context, assembly: NovelAssembly): void {
  ctx.inject(['webServer'], (wctx) => {
    const writeJson = (res: ServerResponse, status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    const readJsonBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk: Buffer | string) => { data += String(chunk) })
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) as Record<string, unknown> : {}) } catch { reject(new Error('invalid JSON body')) }
      })
      req.on('error', reject)
    })
    const trusted = (req: IncomingMessage): boolean => req.headers[FENCE_HEADER] === '1'
    const novelOf = (res: ServerResponse): NovelServices | null => {
      const services = assembly.services
      if (!services) writeJson(res, 503, { ok: false, error: { code: 'INVALID_STATE', message: '插件未启用' } })
      return services
    }
    const fail = (res: ServerResponse, status: number, code: string, message: string): void => {
      writeJson(res, status, { ok: false, error: { code, message } })
    }
    /** 错误文案提取：兼容 `throw { code, message }` 形式的领域错误。 */
    const errText = (error: unknown): string => {
      if (error instanceof Error) return error.message
      if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message
      }
      return String(error)
    }
    /** 领域错误的状态码映射（校验类 400，缺失类 404，状态冲突 409）。 */
    const statusOfError = (error: unknown): number => {
      const code = (error as { code?: unknown })?.code
      if (code === 'ENTRY_NOT_FOUND' || code === 'SHARE_NOT_FOUND') return 404
      if (code === 'INVALID_STATE') return 409
      return 400
    }
    /** 统一失败出口：领域错误按 code 映射状态码，未知错误按调用方给的兜底码。 */
    const failDomain = (res: ServerResponse, error: unknown, fallback: 'INVALID_FIELD_TYPE' | 'IO_FAILURE'): void => {
      const code = (error as { code?: unknown })?.code
      if (typeof code === 'string') fail(res, statusOfError(error), code, errText(error))
      else fail(res, 400, fallback, errText(error))
    }
    /** 类型 id → 中文名（未知类型回退 id；类型表读取失败时回退内置表）。 */
    const kindLabelOf = async (svc: NovelServices, kindId: string): Promise<string> => {
      const kinds = await svc.kinds.list().catch(() => [...BUILTIN_KINDS])
      return kindById(kinds, kindId)?.label ?? kindId
    }
    /** 单个项目 → 首页卡片（补类型名与流程进度）。 */
    const itemOf = async (svc: NovelServices, summary: BookSummary): Promise<ProjectListItem> => {
      const progress = await svc.novel.progressOf(summary.id).catch(() => ({ done: 0, total: 0 }))
      return decorateProject(summary, { kindLabel: await kindLabelOf(svc, summary.kind), progress })
    }
    /** 一批项目 → 首页卡片列表（单个项目出错不影响其余）。 */
    const itemsOf = async (svc: NovelServices, summaries: readonly BookSummary[]): Promise<ProjectListItem[]> => {
      const kinds = await svc.kinds.list().catch(() => [...BUILTIN_KINDS])
      const items: ProjectListItem[] = []
      for (const summary of summaries) {
        const progress = await svc.novel.progressOf(summary.id).catch(() => ({ done: 0, total: 0 }))
        items.push(decorateProject(summary, { kindLabel: kindById(kinds, summary.kind)?.label ?? summary.kind, progress }))
      }
      return items
    }
    /** 请求 URL 的查询参数（列表筛选用）。 */
    const searchParamsOf = (req: IncomingMessage): URLSearchParams => new URL(req.url ?? '/', 'http://localhost').searchParams

    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const { segments, projectId, section, noText } = parseNovelPath(req.url)

        // ── 项目类型（/kinds） ──
        // GET /kinds：类型清单（内置 4 种 + 用户自定义）
        if (req.method === 'GET' && segments.length === 1 && segments[0] === 'kinds') {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.kinds.list() })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', errText(error))
          }
          return
        }
        // POST /kinds：新建自定义类型
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'kinds') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const kind = await svc.kinds.create({
              label: String(body.label ?? ''),
              ...(body.id !== undefined ? { id: String(body.id) } : {}),
              ...(body.labelEn !== undefined ? { labelEn: String(body.labelEn) } : {}),
              ...(body.icon !== undefined ? { icon: String(body.icon) } : {}),
              ...(body.description !== undefined ? { description: String(body.description) } : {}),
              ...(body.templateId !== undefined ? { templateId: String(body.templateId) } : {}),
              genres: Array.isArray(body.genres)
                ? body.genres.map((genre) => ({ id: typeof (genre as { id?: unknown })?.id === 'string' ? (genre as { id: string }).id : undefined, label: String((genre as { label?: unknown })?.label ?? '') }))
                : [],
            })
            writeJson(res, 200, { ok: true, value: kind })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // PATCH /kinds/<id>：编辑自定义类型（内置只读）
        if (req.method === 'PATCH' && segments.length === 2 && segments[0] === 'kinds' && segments[1]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const kind = await svc.kinds.update(segments[1]!, {
              ...(body.label !== undefined ? { label: String(body.label) } : {}),
              ...(body.labelEn !== undefined ? { labelEn: String(body.labelEn) } : {}),
              ...(body.icon !== undefined ? { icon: String(body.icon) } : {}),
              ...(body.description !== undefined ? { description: String(body.description) } : {}),
              ...(body.templateId !== undefined ? { templateId: String(body.templateId) } : {}),
              ...(Array.isArray(body.genres)
                ? { genres: body.genres.map((genre) => ({ id: typeof (genre as { id?: unknown })?.id === 'string' ? (genre as { id: string }).id : undefined, label: String((genre as { label?: unknown })?.label ?? '') })) }
                : {}),
            })
            writeJson(res, 200, { ok: true, value: kind })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // DELETE /kinds/<id>：删除自定义类型（内置只读）
        if (req.method === 'DELETE' && segments.length === 2 && segments[0] === 'kinds' && segments[1]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const removed = await svc.kinds.remove(segments[1]!)
            if (!removed) return fail(res, 404, 'ENTRY_NOT_FOUND', `类型不存在: ${segments[1]!}`)
            writeJson(res, 200, { ok: true, value: { deleted: true, id: segments[1]! } })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }

        // ── 项目列表与新建 ──
        // GET /projects?kind=&status=&q=&sort=&order=：首页卡片列表
        if (req.method === 'GET' && segments.length === 1 && segments[0] === 'projects') {
          const svc = novelOf(res)
          if (!svc) return
          try {
            const query = parseProjectQuery(searchParamsOf(req))
            const all = await svc.novel.listProjects()
            writeJson(res, 200, { ok: true, value: await itemsOf(svc, queryProjects(all, query)) })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', errText(error))
          }
          return
        }
        // POST /projects：新建（title 必填；kind 缺省 course；genre 缺省取该类型首个题材）
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'projects') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const title = String(body.title ?? '').trim()
            if (!title) return fail(res, 400, 'INVALID_FIELD_TYPE', '项目名称不能为空')
            if (title.length > 60) return fail(res, 400, 'INVALID_FIELD_TYPE', '项目名称不能超过 60 字符')
            const kinds = await svc.kinds.list().catch(() => [...BUILTIN_KINDS])
            const kind = String(body.kind ?? '').trim() || 'course'
            const genre = String(body.genre ?? '').trim() || (kindById(kinds, kind)?.genres[0]?.id ?? 'general')
            const book = await svc.novel.createProject(title, genre, kind)
            if (body.description !== undefined) {
              await svc.novel.updateProject(book.id, { description: String(body.description) })
            }
            writeJson(res, 200, { ok: true, value: await itemOf(svc, toSummary(await svc.novel.load(book.id))) })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // GET /projects/<id>：单个项目详情（首页「编辑项目」弹窗回填用，与列表同构）
        if (req.method === 'GET' && segments.length === 2 && segments[0] === 'projects' && projectId) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            const summary = toSummary(await svc.novel.load(projectId))
            writeJson(res, 200, { ok: true, value: await itemOf(svc, summary) })
          } catch (error) {
            failDomain(res, error, 'IO_FAILURE')
          }
          return
        }
        // PATCH /projects/<id>：编辑项目元信息（title/description/status/kind/genre）
        if (req.method === 'PATCH' && segments.length === 2 && segments[0] === 'projects' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const patch: ProjectPatch = {}
            for (const field of ['title', 'description', 'genre', 'kind'] as const) {
              if (body[field] !== undefined) patch[field] = String(body[field])
            }
            if (body.status !== undefined) {
              if (!isProjectStatus(body.status)) return fail(res, 400, 'INVALID_FIELD_TYPE', `非法项目状态: ${String(body.status)}`)
              patch.status = body.status
            }
            if (Object.keys(patch).length === 0) return fail(res, 400, 'INVALID_FIELD_TYPE', '没有需要更新的字段')
            const book = await svc.novel.updateProject(projectId, patch)
            writeJson(res, 200, { ok: true, value: await itemOf(svc, toSummary(book)) })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // DELETE /projects/<id>?keepFiles=1：删除项目（REST 风格，与 POST /delete 等价）
        if (req.method === 'DELETE' && segments.length === 2 && segments[0] === 'projects' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const keepFiles = searchParamsOf(req).get('keepFiles') === '1'
            const result = await svc.novel.deleteProject(projectId, keepFiles)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            failDomain(res, error, 'IO_FAILURE')
          }
          return
        }

        // ── 工作流模板库（/workflows） ──
        // GET /workflows?kind=&scope=：模板清单（内置只读 + 用户自定义）
        if (req.method === 'GET' && segments.length === 1 && segments[0] === 'workflows') {
          const svc = novelOf(res)
          if (!svc) return
          try {
            const params = searchParamsOf(req)
            const kind = params.get('kind')?.trim() || undefined
            const scope = params.get('scope')?.trim()
            const list = await svc.workflows.listAll({
              ...(kind !== undefined ? { kind } : {}),
              scope: scope === 'builtin' || scope === 'user' ? scope : 'all',
            })
            writeJson(res, 200, { ok: true, value: list })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', errText(error))
          }
          return
        }
        // POST /workflows：另存为模板（body: { projectId, name } 或 { workflow, name }）
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'workflows') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const name = String(body.name ?? '').trim()
            if (!name) return fail(res, 400, 'INVALID_FIELD_TYPE', '模板名称不能为空')
            const sourceId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
            let source: Workflow | undefined
            if (sourceId) source = await svc.novel.workflowOf(sourceId)
            else if (body.workflow !== undefined) {
              const parsed = validateWorkflow(body.workflow)
              if (!parsed.ok) return fail(res, 400, parsed.error.code, parsed.error.message)
              source = parsed.value
            }
            if (!source) return fail(res, 400, 'INVALID_FIELD_TYPE', '缺少模板来源（projectId 或 workflow）')
            const template = await svc.workflows.createFrom(source, {
              name,
              ...(body.nameEn !== undefined ? { nameEn: String(body.nameEn) } : {}),
              ...(body.kind !== undefined ? { kind: String(body.kind) } : {}),
            })
            writeJson(res, 200, { ok: true, value: template })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // GET /workflows/<id>：读模板（内置模板也可读）
        if (req.method === 'GET' && segments.length === 2 && segments[0] === 'workflows' && segments[1]) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            const template = await svc.workflows.read(segments[1]!)
            if (!template) return fail(res, 404, 'ENTRY_NOT_FOUND', `模板不存在: ${segments[1]!}`)
            writeJson(res, 200, { ok: true, value: template })
          } catch (error) {
            failDomain(res, error, 'IO_FAILURE')
          }
          return
        }
        // PATCH /workflows/<id>：改模板（内置只读）
        if (req.method === 'PATCH' && segments.length === 2 && segments[0] === 'workflows' && segments[1]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const template = await svc.workflows.update(segments[1]!, {
              ...(body.name !== undefined ? { name: String(body.name) } : {}),
              ...(body.nameEn !== undefined ? { nameEn: String(body.nameEn) } : {}),
              ...(body.kind !== undefined ? { kind: String(body.kind) } : {}),
              ...(Array.isArray(body.phases) ? { phases: body.phases as WorkflowPhase[] } : {}),
            })
            writeJson(res, 200, { ok: true, value: template })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // DELETE /workflows/<id>：删模板（内置只读）
        if (req.method === 'DELETE' && segments.length === 2 && segments[0] === 'workflows' && segments[1]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const removed = await svc.workflows.remove(segments[1]!)
            if (!removed) return fail(res, 404, 'ENTRY_NOT_FOUND', `模板不存在: ${segments[1]!}`)
            writeJson(res, 200, { ok: true, value: { deleted: true, id: segments[1]! } })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // POST /demo：一键导入示例项目（《青云问道》+ 10 条资料库条目）
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'demo') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const book = await svc.novel.createProject('青云问道', 'general')
            const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'samples', 'demo-book', 'lorebook')
            const entries = JSON.parse(await readOptional(join(dir, 'entries.json')) ?? '{"data":[]}')
            const list = Array.isArray(entries) ? entries : (entries as { data: unknown[] }).data ?? []
            const result = await asResult(() => svc.lore.importEntries({ content: JSON.stringify(list), book_id: book.id }))
            if (!result.ok) throw new Error(result.error.message)
            writeJson(res, 200, { ok: true, value: { book, imported: result.value.imported_count } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /import：导入本地课程文件（txt/md → 解析 → 建书 → 逐章写入，全自动）
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'import') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const fileName = String(body.fileName ?? '').trim()
            const content = String(body.content ?? '')
            // P2：导入也带项目类型（决定题材映射口径与初始工作流模板）
            const importKind = String(body.kind ?? '').trim() || DEFAULT_KIND_ID
            if (!content.trim()) return fail(res, 400, 'IMPORT_FILE_EMPTY', '文件内容为空')
            if (content.length > 8_000_000) return fail(res, 400, 'INVALID_FIELD_TYPE', '文件过大（超过 8MB），请拆分后导入')
            const { parseBookFile, BookImporter } = await import('./core/importer/index.js')
            const parsed = parseBookFile(fileName || '未命名课程', content, { kind: importKind })
            const importer = new BookImporter({
              createProject: (title, genre, kind) => svc.novel.createProject(title, genre, kind),
              saveChapter: (id, no, title, text) => svc.novel.saveChapter(id, no, title, text),
              deleteProject: (id) => svc.novel.deleteProject(id, false),
            })
            const result = await importer.importParsed(parsed)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            const code = (error as { code?: string }).code
            if (code === 'IMPORT_FILE_EMPTY' || code === 'NO_IMPORTABLE_ENTRIES') {
              return fail(res, 400, code, (error as { message?: string }).message ?? String(error))
            }
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // ── 资料库（lorebook）GUI 数据面 ──
        // GET /lorebook/entries：条目列表
        if (req.method === 'GET' && segments[0] === 'lorebook' && segments[1] === 'entries' && segments.length === 2) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.lore.listEntries() })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /lorebook/entries：创建条目
        if (req.method === 'POST' && segments[0] === 'lorebook' && segments[1] === 'entries' && segments.length === 2) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const entry = await svc.lore.createEntry({
              name: String(body.name ?? '').trim(),
              content: String(body.content ?? ''),
              keywords: typeof body.keywords === 'string' ? body.keywords : '',
              always_active: body.always_active === true,
              enabled: body.enabled !== false,
              priority: typeof body.priority === 'number' ? body.priority : 50,
              book_id: typeof body.book_id === 'string' ? body.book_id : '',
              inject_target: typeof body.inject_target === 'string' ? body.inject_target as never : 'system',
              inject_position: typeof body.inject_position === 'string' ? body.inject_position as never : 'append',
            })
            writeJson(res, 200, { ok: true, value: entry })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /lorebook/entries/<id>/<action>：update | delete | toggle
        if (req.method === 'POST' && segments[0] === 'lorebook' && segments[1] === 'entries' && segments.length === 4 && segments[3]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          const id = segments[2]!
          const action = segments[3]!
          try {
            if (action === 'toggle') {
              writeJson(res, 200, { ok: true, value: await svc.lore.toggleEntry(id) })
              return
            }
            if (action === 'delete') {
              writeJson(res, 200, { ok: true, value: await svc.lore.deleteEntry(id) })
              return
            }
            if (action === 'update') {
              const body = await readJsonBody(req)
              const updated = await svc.lore.updateEntry(id, {
                ...(body.name !== undefined ? { name: String(body.name) } : {}),
                ...(body.content !== undefined ? { content: String(body.content) } : {}),
                ...(body.keywords !== undefined ? { keywords: String(body.keywords) } : {}),
                ...(body.always_active !== undefined ? { always_active: body.always_active === true } : {}),
                ...(body.enabled !== undefined ? { enabled: body.enabled !== false } : {}),
                ...(body.priority !== undefined ? { priority: Number(body.priority) } : {}),
                ...(body.inject_target !== undefined ? { inject_target: String(body.inject_target) as never } : {}),
                ...(body.inject_position !== undefined ? { inject_position: String(body.inject_position) as never } : {}),
              })
              writeJson(res, 200, { ok: true, value: updated })
              return
            }
            fail(res, 400, 'INVALID_FIELD_TYPE', 'unknown action')
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /lorebook/generate：AI 一键生成该书核心资料库设定（需要模型）
        if (req.method === 'POST' && segments[0] === 'lorebook' && segments[1] === 'generate' && segments.length === 3 && segments[2]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          if (!svc.llm || !svc.llm.available()) return fail(res, 503, 'INVALID_STATE', '模型未就绪（请先在会话中发起一次对话）')
          const bookId = segments[2]!
          try {
            const { loadPromptLibrary, renderPromptTemplate } = await import('./core/prompts/index.js')
            const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')
            const library = await loadPromptLibrary(promptsDir)
            const template = library.find((t) => t.id === 'lorebook-autogen')
            if (!template) return fail(res, 500, 'IO_FAILURE', '缺少生成提示词模板')
            const book = await svc.novel.load(bookId)
            const prompt = renderPromptTemplate(template, { title: book.title, genre: genreLabel(book.genre) })
            const raw = await svc.llm.complete('你是课程设定师，只输出 JSON 数组。', prompt, 3000)
            // 解析 JSON（容错：剥离 ```json 围栏）
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
            const parsed = JSON.parse(cleaned) as Array<{ name?: string; content?: string; keywords?: string[]; always_active?: boolean }>
            const created = []
            for (const item of Array.isArray(parsed) ? parsed : []) {
              if (!item?.name || !item?.content) continue
              const entry = await svc.lore.createEntry({
                name: item.name.trim(),
                content: item.content.trim(),
                keywords: (item.keywords ?? []).join(','),
                always_active: item.always_active === true,
                book_id: bookId,
              })
              created.push(entry)
            }
            writeJson(res, 200, { ok: true, value: { created: created.length, entries: created } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // GET /lorebook/groups：分组列表
        if (req.method === 'GET' && segments[0] === 'lorebook' && segments[1] === 'groups' && segments.length === 2) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.lore.listGroups() })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // ── 项目工作流（必须在「GET /projects/<id>/<任意 section>」兜底分支之前） ──
        // GET /projects/<id>/workflow
        if (req.method === 'GET' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'workflow' && projectId) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.novel.workflowOf(projectId) })
          } catch (error) {
            failDomain(res, error, 'IO_FAILURE')
          }
          return
        }
        // PUT /projects/<id>/workflow：整体保存（流程编辑器"保存"按钮）
        if (req.method === 'PUT' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'workflow' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const parsed = validateWorkflow(body)
            if (!parsed.ok) return fail(res, 400, parsed.error.code, parsed.error.message)
            // id/scope 以服务端为准，防止客户端把项目工作流伪造成内置模板
            const workflow = await svc.novel.saveWorkflow(projectId, { ...parsed.value, id: `wf_${projectId}`, scope: 'project' })
            writeJson(res, 200, { ok: true, value: workflow })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // POST /projects/<id>/workflow/reset：恢复类型默认流程
        if (req.method === 'POST' && segments.length === 4 && segments[0] === 'projects' && segments[2] === 'workflow' && segments[3] === 'reset' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.novel.resetWorkflow(projectId) })
          } catch (error) {
            failDomain(res, error, 'IO_FAILURE')
          }
          return
        }
        // POST /projects/<id>/workflow/phases：新增阶段（body: { name, index?, id?, gate? }）
        if (req.method === 'POST' && segments.length === 4 && segments[0] === 'projects' && segments[2] === 'workflow' && segments[3] === 'phases' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const current = await svc.novel.workflowOf(projectId)
            const index = typeof body.index === 'number' && Number.isFinite(body.index) ? body.index : current.phases.length
            const phase = { ...createPhase(current, String(body.name ?? ''), String(body.id ?? body.name ?? 'phase')), ...(typeof body.gate === 'string' ? { gate: body.gate as never } : {}) }
            const next = insertPhase(current, phase, index)
            if (!next.ok) return fail(res, 400, next.error.code, next.error.message)
            writeJson(res, 200, { ok: true, value: await svc.novel.saveWorkflow(projectId, next.value) })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // POST /projects/<id>/workflow/phases/reorder：拖拽排序（body: { from, to }）
        if (req.method === 'POST' && segments.length === 5 && segments[0] === 'projects' && segments[2] === 'workflow' && segments[3] === 'phases' && segments[4] === 'reorder' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const current = await svc.novel.workflowOf(projectId)
            const next = reorderPhase(current, Number(body.from), Number(body.to))
            if (!next.ok) return fail(res, 400, next.error.code, next.error.message)
            writeJson(res, 200, { ok: true, value: await svc.novel.saveWorkflow(projectId, next.value) })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // POST /projects/<id>/workflow/phases/<phaseId>/<rename|update|delete>
        if (req.method === 'POST' && segments.length === 6 && segments[0] === 'projects' && segments[2] === 'workflow' && segments[3] === 'phases' && segments[4] && segments[5] && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          const phaseId = segments[4]!
          const action = segments[5]!
          try {
            const current = await svc.novel.workflowOf(projectId)
            if (action === 'rename') {
              const body = await readJsonBody(req)
              const next = renamePhase(current, phaseId, String(body.name ?? ''))
              if (!next.ok) return fail(res, 400, next.error.code, next.error.message)
              writeJson(res, 200, { ok: true, value: await svc.novel.saveWorkflow(projectId, next.value) })
              return
            }
            if (action === 'delete') {
              const next = removePhase(current, phaseId)
              if (!next.ok) return fail(res, 400, next.error.code, next.error.message)
              writeJson(res, 200, { ok: true, value: await svc.novel.saveWorkflow(projectId, next.value) })
              return
            }
            if (action === 'update') {
              const body = await readJsonBody(req)
              const patch: Partial<Omit<WorkflowPhase, 'id'>> = {}
              for (const field of ['name', 'description', 'prompt', 'rubric'] as const) {
                if (body[field] !== undefined) patch[field] = String(body[field])
              }
              if (body.gate !== undefined && isPhaseGate(body.gate)) patch.gate = body.gate
              if (body.optional !== undefined) patch.optional = body.optional === true
              if (Array.isArray(body.artifacts)) patch.artifacts = body.artifacts as WorkflowArtifact[]
              const next = updatePhase(current, phaseId, patch)
              if (!next.ok) return fail(res, 400, next.error.code, next.error.message)
              writeJson(res, 200, { ok: true, value: await svc.novel.saveWorkflow(projectId, next.value) })
              return
            }
            fail(res, 400, 'INVALID_FIELD_TYPE', 'unknown action')
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // GET /projects/<id> 或 /projects/<id>/chapters/<no> 或 /projects/<id>/context/<no>
        if (req.method === 'GET' && segments.length >= 2 && segments[0] === 'projects' && projectId) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            if (section === 'chapters' && !noText) {
              // 章节/课时列表（含名称，供左栏导航）
              const chapters = await svc.novel.allChapters(projectId)
              writeJson(res, 200, { ok: true, value: chapters.map(({ chapter }) => ({ no: chapter.no, title: chapter.title, words: chapter.words })) })
              return
            }
            if (section === 'chapters' && noText) {
              // 返回剥离 frontmatter 的纯讲义（不向用户显示课时元数据注释）
              const content = await svc.novel.chapterText(projectId, Number(noText))
              writeJson(res, 200, { ok: true, value: content })
              return
            }
            // 写教案上下文包（一键写教案数据源）
            if (section === 'context' && noText) {
              const packet = await svc.novel.assemble(projectId, Number(noText))
              writeJson(res, 200, { ok: true, value: packet })
              return
            }
            // 规则层诊断（黄金三讲/单章，从 noText 起最多 3 章）
            if (section === 'diagnose' && noText) {
              const { diagnoseFirstChapters } = await import('./core/diagnose/index.js')
              const book = await svc.novel.load(projectId)
              const start = Number(noText)
              const chapters = []
              for (let no = start; no <= Math.min(start + 2, book.stats.chapterCount + 1); no += 1) {
                const chapter = await svc.novel.chapterWithText(projectId, no)
                if (chapter) chapters.push({ no, title: chapter.chapter.title, text: chapter.content })
              }
              const report = diagnoseFirstChapters(chapters, { wordTargets: book.config.wordTargets })
              writeJson(res, 200, { ok: true, value: report })
              return
            }
            if (section === 'shares') {
              const list = await svc.novel.listShares(projectId)
              writeJson(res, 200, { ok: true, value: list })
              return
            }
            if (section === undefined) {
              const book = await svc.novel.load(projectId)
              const audit = await svc.novel.audit(projectId)
              writeJson(res, 200, { ok: true, value: { book, auditTail: audit.slice(-20) } })
              return
            }
            // GET /projects/<id>/knowledge-graph：返回已生成的知识图谱（nodes/edges）
            if (section === 'knowledge-graph') {
              try {
                const raw = await readFile(join(svc.bookDirOf(projectId), 'knowledge-graph.json'), 'utf8')
                writeJson(res, 200, { ok: true, value: JSON.parse(raw) })
              } catch {
                fail(res, 404, 'ENTRY_NOT_FOUND', '尚未生成知识图谱（先用 course_gen_knowledge_graph 生成）')
              }
              return
            }
            fail(res, 404, 'ENTRY_NOT_FOUND', 'unknown resource')
          } catch (error) {
            fail(res, 404, 'ENTRY_NOT_FOUND', String(error))
          }
          return
        }
        // POST /projects/<id>/chapters/reorder：拖拽排序（order=课时号新顺序，落盘后重编号 1..N）
        // 注意：必须排在「保存课时」路由之前——两者同为 segments.length===4，靠 segments[3] 区分。
        if (req.method === 'POST' && segments.length === 4 && segments[0] === 'projects' && segments[2] === 'chapters' && segments[3] === 'reorder' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const raw = Array.isArray(body.order) ? body.order : []
            const order = raw.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1)
            if (!order.length) return fail(res, 400, 'INVALID_FIELD_TYPE', 'order 必须是非空的课时号数组')
            const chapters = await svc.novel.reorderChapters(projectId, order)
            writeJson(res, 200, { ok: true, value: chapters })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', errText(error))
          }
          return
        }
        // POST /projects/<id>/chapters/<no>/delete：删除课时
        if (req.method === 'POST' && segments.length === 5 && segments[0] === 'projects' && segments[2] === 'chapters' && segments[4] === 'delete' && noText && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          const chapterNo = Number(noText)
          if (!Number.isInteger(chapterNo) || chapterNo < 1) {
            return fail(res, 400, 'INVALID_FIELD_TYPE', `非法课时号: ${noText}`)
          }
          try {
            const result = await svc.novel.deleteChapter(projectId, chapterNo)
            if (!result.deleted) return fail(res, 404, 'ENTRY_NOT_FOUND', `课时不存在: ${chapterNo}`)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', errText(error))
          }
          return
        }
        // POST /projects/<id>/chapters/<no>：保存课时（一键写教案回写）
        if (req.method === 'POST' && segments.length === 4 && segments[0] === 'projects' && segments[2] === 'chapters' && noText && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const chapter = await svc.novel.saveChapter(
              projectId,
              Number(noText),
              String(body.title ?? `第 ${noText} 章`),
              String(body.text ?? ''),
              typeof body.brief === 'string' ? body.brief : undefined,
            )
            writeJson(res, 200, { ok: true, value: chapter })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /projects/<id>/chapters/<no>/write：一键写教案（host LLM 直写 + 自动保存）
        if (req.method === 'POST' && segments.length === 5 && segments[0] === 'projects' && segments[2] === 'chapters' && segments[4] === 'write' && noText && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          if (!svc.llm || !svc.llm.available()) return fail(res, 503, 'INVALID_STATE', '模型未就绪（请先在会话中发起一次对话）')
          try {
            const book = await svc.novel.load(projectId)
            const packet = await svc.novel.assemble(projectId, Number(noText))
            const text = await svc.llm.complete('你是课程作者，直接输出讲义。', buildWritePrompt(book, packet), 6000)
            if (!text) return fail(res, 500, 'IO_FAILURE', '模型未返回讲义')
            const chapter = await svc.novel.saveChapter(projectId, Number(noText), `第 ${noText} 章`, text)
            writeJson(res, 200, { ok: true, value: { chapter, text } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /projects/<id>/chapters/<no>/polish：AI 文笔润色（返回原文+润色文，不落盘，确认后走保存路由）
        if (req.method === 'POST' && segments.length === 5 && segments[0] === 'projects' && segments[2] === 'chapters' && segments[4] === 'polish' && noText && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          if (!svc.llm || !svc.llm.available()) return fail(res, 503, 'INVALID_STATE', '模型未就绪（请先在会话中发起一次对话）')
          try {
            const body = await readJsonBody(req)
            let text = typeof body.text === 'string' ? body.text.trim() : ''
            if (!text) {
              // 编辑区为空 → 回退到已保存课时讲义
              text = (await svc.novel.chapterText(projectId, Number(noText)).catch(() => '')).trim()
            }
            if (!text) return fail(res, 400, 'INVALID_FIELD_TYPE', '没有可润色的讲义内容')
            const { loadPromptLibrary, renderPromptTemplate } = await import('./core/prompts/index.js')
            const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')
            const library = await loadPromptLibrary(promptsDir)
            const template = library.find((t) => t.id === 'polish-literary')
            if (!template) return fail(res, 500, 'IO_FAILURE', '缺少润色提示词模板')
            const prompt = renderPromptTemplate(template, { text })
            // 润色需输出与原文等长的全篇讲义：输出预算按原文长度动态放大，
            // 防止长课时被 maxTokens 截断（截断会导致"只改了开头几段"）。
            const maxTokens = Math.min(12000, Math.max(6000, Math.ceil(text.length * 1.6) + 2500))
            let polished = await svc.llm.complete('你是资深课程编辑，只输出润色后的完整讲义，不要任何解释或前缀。', prompt, maxTokens)

            // 模型原样返回（无任何实质改动）→ 自动用更强的"强制重写"指令重试一次，
            // 保证用户至少得到有实质内容的润色建议。
            if (polished) {
              const { splitPolishSuggestions } = await import('./core/polish/diff.js')
              if (splitPolishSuggestions(text, polished).length === 0) {
                const retryPrompt = '你上一版把原文原样返回了，这不可接受！请按以下要求重新润色：' +
                  '\n- 对全章几乎每一段都必须做明显的文笔重写（换词、改句、调序、扩写、压缩都行）' +
                  '\n- 底线只是不改情节/设定/学员行为逻辑，表达层面要大改特改' +
                  '\n- 输出与原文的差异必须遍布全章，禁止与原文相同或近似相同\n\n' + prompt
                polished = await svc.llm.complete('你是资深课程编辑。上一次你原样返回了原文，这次必须充分重写并输出润色后的完整讲义。', retryPrompt, maxTokens)
              }
            }
            if (!polished) return fail(res, 500, 'IO_FAILURE', '模型未返回润色结果')
            writeJson(res, 200, { ok: true, value: { original: text, polished } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /projects/<id>/duplicate：复制项目（含 config 与阶段设定，讲义不复制）
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'duplicate' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const book = await svc.novel.cloneProject(projectId, {
              ...(body.title !== undefined ? { title: String(body.title) } : {}),
              ...(body.genre !== undefined ? { genre: String(body.genre) } : {}),
              ...(body.kind !== undefined ? { kind: String(body.kind) } : {}),
            })
            writeJson(res, 200, { ok: true, value: await itemOf(svc, toSummary(book)) })
          } catch (error) {
            failDomain(res, error, 'IO_FAILURE')
          }
          return
        }
        // POST /projects/<id>/archive：归档 / 取消归档（body: { archived: boolean }）
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'archive' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const book = await svc.novel.archiveProject(projectId, body.archived !== false)
            writeJson(res, 200, { ok: true, value: await itemOf(svc, toSummary(book)) })
          } catch (error) {
            failDomain(res, error, 'INVALID_FIELD_TYPE')
          }
          return
        }
        // POST /projects/<id>/rename：重命名课程
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'rename' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const book = await svc.novel.renameProject(projectId, String(body.title ?? ''))
            writeJson(res, 200, { ok: true, value: book })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /projects/<id>/delete：删除课程（keepChapters 决定是否保留讲义）
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'delete' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const result = await svc.novel.deleteProject(projectId, body.keepChapters === true)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            fail(res, 404, 'ENTRY_NOT_FOUND', String(error))
          }
          return
        }
        // POST /projects/<id>/export：导出成稿（返回文件名+内容，GUI 下载）
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'export' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const format = body.format === 'markdown' || body.format === 'platform' || body.format === 'word' ? body.format : 'txt'
            const result = await svc.novel.exportProject(projectId, format)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            fail(res, 404, 'ENTRY_NOT_FOUND', String(error))
          }
          return
        }
        // POST /projects/<id>/share：生成分享（mode=read 只读 / write 可编辑）
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'share' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const mode = body.mode === 'write' ? 'write' : 'read'
            const entry = await svc.novel.createShare(projectId, mode)
            writeJson(res, 200, { ok: true, value: entry })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /projects/<id>/unshare：撤销分享
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'unshare' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const revoked = await svc.novel.revokeShare(String(body.token ?? ''))
            writeJson(res, 200, { ok: true, value: { revoked } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        fail(res, 404, 'ENTRY_NOT_FOUND', 'unknown resource')
      },
    }), 'xiashuo: routes')

    // 分享协作公开前缀（免 fence 头 / 免 Basic Auth，token 鉴权）。
    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: '/share',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const svc = assembly.services
        if (!svc) { writeJson(res, 503, { ok: false, error: { code: 'INVALID_STATE', message: '插件未启用' } }); return }
        const path = new URL(req.url ?? '/', 'http://localhost').pathname
        const seg = path.slice('/share'.length).split('/').filter(Boolean)
        const token = seg[0] ?? ''
        if (!token) return fail(res, 400, 'INVALID_TOKEN', 'missing token')
        const share = await svc.novel.getShare(token)
        if (!share) return fail(res, 404, 'SHARE_NOT_FOUND', '分享不存在或已撤销')

        // GET /share/<token> → 分享查看/协作页
        if (seg.length === 1) {
          if (req.method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed')
          const book = await svc.novel.load(share.projectId)
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(sharePageHtml(book.title, share.mode, token))
          return
        }
        // GET /share/<token>/data → 项目数据（标题 + 章节 + 正文 + 版本 + 权限）
        if (seg.length === 2 && seg[1] === 'data') {
          if (req.method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed')
          const book = await svc.novel.load(share.projectId)
          const chapters = await svc.novel.allChapters(share.projectId)
          writeJson(res, 200, {
            ok: true,
            value: {
              title: book.title,
              mode: share.mode,
              chapters: chapters.map((c) => ({ no: c.chapter.no, title: c.chapter.title, content: c.content, version: c.chapter.version })),
            },
          })
          return
        }
        // GET /share/<token>/export?format=txt|word → 导出全文（复用后端 docx）
        if (seg.length === 2 && seg[1] === 'export') {
          if (req.method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed')
          const fmt = new URL(req.url ?? '/', 'http://localhost').searchParams.get('format') === 'word' ? 'word' : 'txt'
          const result = await svc.novel.exportProject(share.projectId, fmt)
          const disp = `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
          if (fmt === 'word') {
            res.writeHead(200, { 'content-type': result.mime ?? 'application/octet-stream', 'content-disposition': disp, 'cache-control': 'no-store' })
            res.end(Buffer.from(result.content, 'base64'))
          } else {
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': disp, 'cache-control': 'no-store' })
            res.end(result.content)
          }
          return
        }
        // POST /share/<token>/chapters/<no> → 协作写回（仅 write 模式；带 baseVersion 检测冲突）
        if (seg.length === 3 && seg[1] === 'chapters') {
          if (share.mode !== 'write') return fail(res, 403, 'READ_ONLY', '此分享为只读，不可编辑')
          if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed')
          const no = Number(seg[2])
          if (!Number.isFinite(no) || no < 1) return fail(res, 400, 'INVALID_FIELD_TYPE', '非法章节号')
          const body = await readJsonBody(req)
          const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : null
          const current = await svc.novel.chapterWithText(share.projectId, no)
          if (baseVersion !== null && current && current.chapter.version > baseVersion) {
            return fail(res, 409, 'CONFLICT', JSON.stringify({ version: current.chapter.version, content: current.content }))
          }
          const chapter = await svc.novel.saveChapter(share.projectId, no, String(body.title ?? ''), String(body.text ?? ''))
          await svc.novel.recordCollaboration(share.projectId, { token: share.token, chapterNo: no, baseVersion, newVersion: chapter.version })
          writeJson(res, 200, { ok: true, value: { chapter } })
          return
        }
        fail(res, 404, 'ENTRY_NOT_FOUND', 'unknown resource')
      },
    }), 'xiashuo: share routes')
  })
}
