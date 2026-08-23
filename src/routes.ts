/**
 * dsh-course-writer — host HTTP 路由（P1-I，GUI 数据面）。
 * 单 prefix 路由 /api/course-writer（WebRoute.path 无尾斜杠），handler 内按路径分派：
 *   GET  /projects                项目列表
 *   POST /projects                创建项目（fence 头校验）
 *   GET  /projects/<id>           项目详情 + 审计尾部
 *   GET  /projects/<id>/chapters/<no>  课时原文
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
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const PREFIX = '/api/course-writer'
const FENCE_HEADER = 'x-dsh-course-writer'

/** 分享查看/协作页（自包含：内联 CSS+JS，fetch /share/<token>/data 渲染；write 模式可编辑保存）。 */
function sharePageHtml(title: string, mode: 'read' | 'write', token: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const badge = mode === 'write' ? '可编辑协作' : '只读'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 虾说教材写作</title>
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

    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const { segments, projectId, section, noText } = parseNovelPath(req.url)

        // GET /projects
        if (req.method === 'GET' && segments.length === 1 && segments[0] === 'projects') {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.novel.listProjects() })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /projects
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'projects') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const book = await svc.novel.createProject(String(body.title ?? ''), String(body.genre ?? 'fantasy'))
            writeJson(res, 200, { ok: true, value: book })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /demo：一键导入示例项目（《青云问道》+ 10 条资料库条目）
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'demo') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const book = await svc.novel.createProject('青云问道', 'fantasy')
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
            if (!content.trim()) return fail(res, 400, 'IMPORT_FILE_EMPTY', '文件内容为空')
            if (content.length > 8_000_000) return fail(res, 400, 'INVALID_FIELD_TYPE', '文件过大（超过 8MB），请拆分后导入')
            const { parseBookFile, BookImporter } = await import('./core/importer/index.js')
            const parsed = parseBookFile(fileName || '未命名课程', content)
            const importer = new BookImporter({
              createProject: (title, genre) => svc.novel.createProject(title, genre),
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
    }), 'dsh-course-writer: routes')

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
    }), 'dsh-course-writer: share routes')
  })
}
