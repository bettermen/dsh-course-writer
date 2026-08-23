/**
 * dsh-course-writer — 三栏式工作台布局（左：阶段导航 / 中：Markdown 编辑+分屏预览 / 右：资料库·知识图谱·预览）。
 * 自包含：复用 /api/course-writer 数据面；打开时创建全屏层，关闭即销毁。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GENRES } from '../core/genres.ts'
import { t } from './i18n.ts'

const GENRE_GROUPS = [...new Set(GENRES.map((g) => g.group))]

function kwText(kw: string | string[] | undefined): string {
  if (Array.isArray(kw)) return kw.join(', ')
  return typeof kw === 'string' ? kw : ''
}

interface ProjectSummary { id: string; title: string; genre: string; currentPhase: string; chapterCount: number; totalWords: number }
interface BookDetail { book: { id: string; title: string; genre: string; currentPhase: string; stats: { totalWords: number; chapterCount: number }; phases: Record<string, { state: string }> } }
interface LoreEntryView { id: string; name: string; content: string; keywords?: string | string[]; always_active: boolean; enabled: boolean; priority: number; book_id: string }
interface GraphNode { id: string; label: string; type: string }
interface GraphEdge { source: string; target: string; label?: string }
interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

const PHASES: Array<{ id: string; label: string }> = [
  { id: 'topic', label: t('phaseTopic') },
  { id: 'setting', label: t('phaseSetting') },
  { id: 'character', label: t('phaseCharacter') },
  { id: 'outline', label: t('phaseOutline') },
  { id: 'volume', label: t('phaseVolume') },
  { id: 'chapter', label: t('phaseChapter') },
  { id: 'writing', label: t('phaseWriting') },
  { id: 'revision', label: t('phaseRevision') },
  { id: 'done', label: t('phaseDone') },
]

const PHASE_STATE: Record<string, { label: string; color: string }> = {
  locked: { label: t('phaseLocked'), color: '#9a9a9a' },
  in_progress: { label: t('phaseInProgress'), color: '#378add' },
  review: { label: t('phaseReview'), color: '#ef9f27' },
  approved: { label: t('phaseApproved'), color: '#2f9e5b' },
  skipped: { label: t('phaseSkipped'), color: '#9a9a9a' },
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 极简 Markdown → HTML（标题/粗斜体/行内代码/代码块/列表/段落），先转义再渲染，防 XSS。 */
function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  let html = ''
  let inCode = false
  const codeBuf: string[] = []
  const listBuf: string[] = []
  const flushList = (): void => {
    if (listBuf.length) { html += '<ul>' + listBuf.map((li) => `<li>${li}</li>`).join('') + '</ul>'; listBuf.length = 0 }
  }
  const inline = (s: string): string => {
    let t = escapeHtml(s)
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
    return t
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { html += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'; codeBuf.length = 0; inCode = false }
      else { flushList(); inCode = true }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) { flushList(); const lvl = h[1]!.length; html += `<h${lvl}>${inline(h[2]!)}</h${lvl}>`; continue }
    if (/^\s*[-*+]\s+/.test(line)) { listBuf.push(inline(line.replace(/^\s*[-*+]\s+/, ''))); continue }
    if (line.trim() === '') { flushList(); continue }
    flushList(); html += '<p>' + inline(line) + '</p>'
  }
  flushList()
  if (inCode) html += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'
  return html
}

function GraphSvg({ graph }: { graph: Graph }): React.ReactElement {
  const nodes = graph.nodes
  const edges = graph.edges ?? []
  const W = 340
  const H = 460
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 52
  const pos = new Map<string, { x: number; y: number; angle: number }>()
  nodes.forEach((n, i) => {
    const angle = (Math.PI * 2 * i) / nodes.length - Math.PI / 2
    pos.set(n.id, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), angle })
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      {edges.map((e, i) => {
        const a = pos.get(e.source); const b = pos.get(e.target)
        if (!a || !b) return null
        return <line key={`e${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c8c8c8" strokeWidth={1.2} />
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!
        const color = n.type === 'skill' ? '#378add' : n.type === 'case' ? '#ef9f27' : '#2f9e5b'
        const cos = Math.cos(p.angle)
        const sin = Math.sin(p.angle)
        // 标签沿节点外侧径向延伸（而非统一置顶），按角度选择锚点，避免相邻标签重叠
        const lx = p.x + cos * 24
        const ly = p.y + sin * 24 + 4
        const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
        const short = n.label.length > 8 ? `${n.label.slice(0, 8)}…` : n.label
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={14} fill={color} stroke="#fff" strokeWidth={2} />
            <text x={lx} y={ly} textAnchor={anchor} fontSize={11} fill="#666" fontWeight={500}>
              {short}
              <title>{n.label}</title>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

interface Options { api: string; fenceHeader: string }

export function WorkshopLayout({ api: base, fenceHeader, onClose }: Options & { onClose: () => void }): React.ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selected, setSelected] = useState('')
  const [book, setBook] = useState<BookDetail | null>(null)
  const [chapterNo, setChapterNo] = useState(1)
  const [chapterTitle, setChapterTitle] = useState('')
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loreEntries, setLoreEntries] = useState<LoreEntryView[]>([])
  const [tab, setTab] = useState<'lore' | 'graph'>('lore')
  const [graph, setGraph] = useState<Graph | null>(null)
  const [chapters, setChapters] = useState<Array<{ no: number; title: string; words: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  const [win, setWin] = useState<'full' | 'half'>('full')
  const [halfSize, setHalfSize] = useState(() => ({ w: Math.round(window.innerWidth * 0.46), h: Math.round(window.innerHeight * 0.58) }))
  const [leftTab, setLeftTab] = useState<'chapters' | 'phases'>('chapters')
  const [leftW, setLeftW] = useState(220)
  const [rightW, setRightW] = useState(300)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newGenre, setNewGenre] = useState('general')
  const [showExport, setShowExport] = useState(false)
  const [exportFormat, setExportFormat] = useState<'txt' | 'word'>('txt')
  const [showShare, setShowShare] = useState(false)
  const [shareMode, setShareMode] = useState<'read' | 'write'>('read')
  const [shareLink, setShareLink] = useState('')
  const [shares, setShares] = useState<Array<{ token: string; mode: string; createdAt: string }>>([])
  const [showLoreModal, setShowLoreModal] = useState(false)
  const [loreMode, setLoreMode] = useState<'add' | 'edit'>('add')
  const [loreEditId, setLoreEditId] = useState('')
  const [loreName, setLoreName] = useState('')
  const [loreContent, setLoreContent] = useState('')
  const [loreKeywords, setLoreKeywords] = useState('')
  const [lorePreview, setLorePreview] = useState<LoreEntryView | null>(null)

  const api = async (path: string, init?: RequestInit): Promise<any> => {
    const r = await fetch(`${base}${path}`, { ...init, headers: { ...(init?.headers ?? {}), [fenceHeader]: '1', 'content-type': 'application/json' } })
    return r.json()
  }

  useEffect(() => {
    api('/projects').then((j) => {
      const list = (j?.value ?? j ?? []) as ProjectSummary[]
      setProjects(list)
      setLoading(false)
      if (list.length > 0) void select(list[0]!.id)
    }).catch(() => { setError(t('loadFail')); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 章节切换时，从章节列表回填标题到编辑框（用户可自定义覆盖）
  useEffect(() => {
    const c = chapters.find((x) => x.no === chapterNo)
    setChapterTitle(c?.title || `${t('lessonPrefix')}${chapterNo}${t('lessonSuffix')}`)
  }, [chapterNo, chapters])

  const loadChapter = async (id: string, no: number): Promise<void> => {
    if (dirty && no !== chapterNo && !window.confirm(t('confirmSwitchChapter'))) return
    setChapterNo(no)
    const j = await api(`/projects/${id}/chapters/${no}`)
    setDraft(typeof (j?.value ?? j) === 'string' ? (j?.value ?? j) : '')
    setDirty(false)
  }

  const select = async (id: string): Promise<void> => {
    if (id === selected) return
    if (dirty && !window.confirm(t('confirmSwitchProject'))) return
    setSelected(id)
    setNotice('')
    setDirty(false)
    const [bd, le] = await Promise.all([api(`/projects/${id}`), api('/lorebook/entries')])
    const bookDetail = (bd?.value ?? bd) as BookDetail
    setBook(bookDetail ?? null)
    setLoreEntries(Array.isArray(le) ? (le as LoreEntryView[]) : ((le?.value ?? []) as LoreEntryView[]))
    await loadChapter(id, 1)
    const ch = await api(`/projects/${id}/chapters`)
    setChapters((ch?.value ?? ch ?? []) as Array<{ no: number; title: string; words: number }>)
  }

  const saveInternal = async (silent: boolean): Promise<void> => {
    if (!selected) return
    const title = chapterTitle.trim() || `${t('lessonPrefix')}${chapterNo}${t('lessonSuffix')}`
    await api(`/projects/${selected}/chapters/${chapterNo}`, { method: 'POST', body: JSON.stringify({ title, text: draft }) })
    if (!silent) setNotice(t('savedNotice'))
    setDirty(false)
    // 仅刷新章节列表（不切换章节，避免跳回第 1 课）
    const ch = await api(`/projects/${selected}/chapters`)
    setChapters((ch?.value ?? ch ?? []) as Array<{ no: number; title: string; words: number }>)
  }

  const save = (): Promise<void> => saveInternal(false)

  // 自动保存：编辑停止 2 秒后自动落盘（静默，不弹提示）
  useEffect(() => {
    if (!dirty || !selected) return
    const t = setTimeout(() => { void saveInternal(true) }, 2000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, chapterTitle, dirty])

  const reloadProjects = async (): Promise<ProjectSummary[]> => {
    const j = await api('/projects')
    const list = (j?.value ?? j ?? []) as ProjectSummary[]
    setProjects(list)
    return list
  }

  const openCreate = (): void => {
    setNewTitle('')
    setNewGenre('general')
    setShowCreate(true)
  }

  const confirmCreate = async (): Promise<void> => {
    const title = newTitle.trim()
    if (!title) return
    const j = await api('/projects', { method: 'POST', body: JSON.stringify({ title, genre: newGenre }) })
    const created = (j?.value ?? j) as ProjectSummary
    await reloadProjects()
    if (created?.id) await select(created.id)
    setShowCreate(false)
    setNotice(t('createdNotice'))
  }

  const triggerDownload = (blob: Blob, fileName: string): void => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const doExport = async (): Promise<void> => {
    if (!selected) return
    const j = await api(`/projects/${selected}/export`, { method: 'POST', body: JSON.stringify({ format: exportFormat }) })
    const v = j?.value ?? j
    if (v.base64) {
      const bin = atob(v.content)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      triggerDownload(new Blob([bytes], { type: v.mime || 'application/octet-stream' }), v.fileName)
    } else {
      triggerDownload(new Blob([v.content], { type: 'text/plain;charset=utf-8' }), v.fileName)
    }
    setShowExport(false)
    setNotice(t('exportedNotice'))
  }

  const parseShares = (j: any): Array<{ token: string; mode: string; createdAt: string }> => {
    const v = j?.value
    return Array.isArray(v) ? v : []
  }

  const openShare = async (): Promise<void> => {
    setShowShare(true)
    setShareLink('')
    if (selected) {
      setShares(parseShares(await api(`/projects/${selected}/shares`)))
    }
  }

  const createShare = async (): Promise<void> => {
    if (!selected) return
    const j = await api(`/projects/${selected}/share`, { method: 'POST', body: JSON.stringify({ mode: shareMode }) })
    const v = j?.value ?? j
    if (v?.token) setShareLink(`${location.origin}/share/${v.token}`)
    setShares(parseShares(await api(`/projects/${selected}/shares`)))
  }

  const copyShare = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(shareLink); setNotice(t('copiedNotice')) } catch { window.prompt(t('copyLinkPrompt'), shareLink) }
  }

  const revokeShare = async (token: string): Promise<void> => {
    if (!selected) return
    await api(`/projects/${selected}/unshare`, { method: 'POST', body: JSON.stringify({ token }) })
    setShares(parseShares(await api(`/projects/${selected}/shares`)))
    if (shareLink.endsWith(token)) setShareLink('')
  }

  const renameProject = async (): Promise<void> => {
    if (!selected) return
    const cur = projects.find((p) => p.id === selected)
    const title = window.prompt(t('renamePrompt'), cur?.title ?? '')
    if (!title || !title.trim()) return
    await api(`/projects/${selected}/rename`, { method: 'POST', body: JSON.stringify({ title: title.trim() }) })
    await reloadProjects()
    if (book) setBook({ ...book, book: { ...book.book, title: title.trim() } })
    setNotice(t('renamedNotice'))
  }

  const deleteProject = async (): Promise<void> => {
    if (!selected) return
    const cur = projects.find((p) => p.id === selected)
    const ok = window.confirm(`${t('delProjectPrefix')}${cur?.title ?? selected}${t('delProjectSuffix')}`)
    if (!ok) return
    await api(`/projects/${selected}/delete`, { method: 'POST', body: JSON.stringify({ keepChapters: false }) })
    const list = await reloadProjects()
    if (list.length > 0) await select(list[0]!.id)
    else {
      setSelected('')
      setBook(null)
      setDraft('')
      setChapters([])
      setChapterTitle('')
    }
    setNotice(t('deletedNotice'))
  }

  const reloadLore = async (): Promise<void> => {
    const j = await api('/lorebook/entries')
    setLoreEntries(Array.isArray(j) ? j : (j?.value ?? []))
  }

  const openLoreAdd = (): void => {
    setLoreMode('add')
    setLoreEditId('')
    setLoreName('')
    setLoreContent('')
    setLoreKeywords('')
    setShowLoreModal(true)
  }

  const openLoreEdit = (e: LoreEntryView): void => {
    setLoreMode('edit')
    setLoreEditId(e.id)
    setLoreName(e.name)
    setLoreContent(e.content)
    setLoreKeywords(kwText(e.keywords))
    setShowLoreModal(true)
  }

  const submitLore = async (): Promise<void> => {
    if (!selected) return
    const name = loreName.trim()
    if (!name) return
    const keywords = loreKeywords.trim()
    if (loreMode === 'add') {
      await api('/lorebook/entries', { method: 'POST', body: JSON.stringify({ name, content: loreContent, keywords, book_id: selected }) })
    } else {
      await api(`/lorebook/entries/${loreEditId}/update`, { method: 'POST', body: JSON.stringify({ name, content: loreContent, keywords }) })
    }
    setShowLoreModal(false)
    await reloadLore()
  }

  const toggleEntry = async (id: string): Promise<void> => {
    await api(`/lorebook/entries/${id}/toggle`, { method: 'POST', body: '{}' })
    await reloadLore()
  }

  const deleteEntry = async (id: string): Promise<void> => {
    if (!window.confirm(t('confirmDeleteLore'))) return
    await api(`/lorebook/entries/${id}/delete`, { method: 'POST', body: '{}' })
    await reloadLore()
  }

  const loadGraph = async (): Promise<void> => {
    if (!selected) return
    const j = await api(`/projects/${selected}/knowledge-graph`)
    setGraph(j?.value ?? j)
    setTab('graph')
  }

  const phases = book?.book.phases ?? {}
  const doneCount = PHASES.filter((p) => phases[p.id]?.state === 'approved' || phases[p.id]?.state === 'skipped').length

  const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '0.5px solid #e5e5e5', borderRadius: 12, overflow: 'auto' }
  const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '0.5px solid #d0d0d0', background: '#f6f6f6', cursor: 'pointer', fontSize: 12 }
  const activeBtn: React.CSSProperties = { ...btn, background: '#eef3fe', borderColor: '#378add', color: '#185fa5' }

  const previewHtml = useMemo(() => renderMarkdown(draft), [draft])

  // 缩小窗口的左下角拖拽缩放：右上角固定，向左拖变宽、向下拖变高。
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startW = halfSize.w
    const startH = halfSize.h
    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(320, startW - (ev.clientX - startX))
      const h = Math.max(240, startH + (ev.clientY - startY))
      setHalfSize({ w, h })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 三栏之间的栏宽拖拽（仅全屏模式）：left 分隔线拖右=左栏变宽；right 分隔线拖左=右栏变宽。
  const startColResize = (side: 'left' | 'right', e: React.MouseEvent): void => {
    if (win !== 'full') return
    e.preventDefault()
    const startX = e.clientX
    const startW = side === 'left' ? leftW : rightW
    const onMove = (ev: MouseEvent): void => {
      const delta = ev.clientX - startX
      const w = Math.max(160, Math.min(520, side === 'left' ? startW + delta : startW - delta))
      if (side === 'left') setLeftW(w); else setRightW(w)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const shrinkToHalf = (): void => {
    setHalfSize({ w: Math.round(window.innerWidth * 0.46), h: Math.round(window.innerHeight * 0.58) })
    setWin('half')
  }

  const handleClose = (): void => {
    if (dirty && !window.confirm(t('confirmClose'))) return
    onClose()
  }

  const rootStyle: React.CSSProperties = win === 'full'
    ? { position: 'fixed', inset: 0, zIndex: 99999, background: '#fff', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#222', pointerEvents: 'auto' }
    : { position: 'fixed', width: halfSize.w, height: halfSize.h, right: 16, top: 16, zIndex: 99999, background: '#fff', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#222', borderRadius: 12, border: '0.5px solid #ccc', boxShadow: '0 12px 48px rgba(0,0,0,0.25)', pointerEvents: 'auto' }

  return (
    <div style={rootStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '0.5px solid #e5e5e5' }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{t('appName')}</span>
        <select value={selected} onChange={(e) => void select(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13 }}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <button onClick={openCreate} style={btn}>{t('newProject')}</button>
        <button onClick={() => void renameProject()} disabled={!selected} style={btn}>{t('rename')}</button>
        <button onClick={() => void deleteProject()} disabled={!selected} style={{ ...btn, color: '#c0392b', borderColor: '#e6b3ad' }}>{t('delete')}</button>
        <button onClick={() => setShowExport(true)} disabled={!selected} style={btn}>{t('export')}</button>
        <button onClick={() => void openShare()} disabled={!selected} style={btn}>{t('share')}</button>
        <span style={{ flex: 1 }} />
        {notice && <span style={{ fontSize: 12, color: '#2f9e5b' }}>{notice}</span>}
        <button onClick={shrinkToHalf} disabled={win === 'half'} style={btn}>{t('shrinkHalf')}</button>
        <button onClick={() => setWin('full')} disabled={win === 'full'} style={btn}>{t('fullscreen')}</button>
        <button onClick={handleClose} style={btn}>{t('close')}</button>
      </div>

      {win === 'half' && (
        <div
          onMouseDown={startResize}
          title={t('resizeTitle')}
          style={{ position: 'absolute', left: 0, bottom: 0, width: 24, height: 24, cursor: 'nesw-resize', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start' }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" style={{ margin: 4 }}>
            <path d="M11 2 L2 11 M11 6 L6 11 M11 10 L10 11" stroke="#999" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
        </div>
      )}

      {loading ? <div style={{ padding: 24, color: '#888', fontSize: 13 }}>{t('loading')}</div> : error ? <div style={{ padding: 24, color: '#c33', fontSize: 13 }}>{error}</div> : (
        <div style={{ flex: 1, display: 'flex', gap: 0, minHeight: 0 }}>
          {/* 左栏：章节 / 阶段 双视图 */}
          <div style={{ width: win === 'full' ? leftW : '20%', flexShrink: 0, ...col, borderRight: 'none' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setLeftTab('chapters')} style={leftTab === 'chapters' ? activeBtn : btn}>{t('chapters')}</button>
              <button onClick={() => setLeftTab('phases')} style={leftTab === 'phases' ? activeBtn : btn}>{t('phases')}</button>
            </div>
            {leftTab === 'chapters' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#888', fontWeight: 500 }}>{t('chapters')}</span>
                  <button onClick={() => void loadChapter(selected, chapters.length + 1)} style={btn}>{t('newLesson')}</button>
                </div>
                {chapters.map((c) => (
                  <div key={c.no} onClick={() => void loadChapter(selected, c.no)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 6, background: chapterNo === c.no ? '#f2f6ff' : 'transparent', fontSize: 13, cursor: 'pointer' }}>
                    <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{c.no}</span>
                    <span style={{ flex: 1, fontWeight: chapterNo === c.no ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || `第 ${c.no} 课`}</span>
                  </div>
                ))}
                {chapters.length === 0 && <div style={{ fontSize: 12, color: '#999', padding: 8 }}>{t('noChapters')}</div>}
              </>
            ) : (
              <>
                {PHASES.map((p) => {
                  const st = phases[p.id]?.state ?? 'locked'
                  const info = PHASE_STATE[st] ?? PHASE_STATE.locked!
                  const current = book?.book.currentPhase === p.id
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, background: current ? '#f2f6ff' : 'transparent', fontSize: 13 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: info.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: current ? 600 : 400 }}>{p.label}</span>
                      <span style={{ fontSize: 11, color: info.color }}>{info.label}</span>
                    </div>
                  )
                })}
                <div style={{ marginTop: 'auto', fontSize: 12, color: '#888' }}>{t('progress')} {doneCount}/9 {t('phasesUnit')}</div>
              </>
            )}
          </div>

          {win === 'full' && <div onMouseDown={(e) => startColResize('left', e)} style={{ width: 6, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid #e5e5e5', borderRight: '1px solid #e5e5e5' }} title={t('resizeLeft')} />}

          {/* 中栏：编辑区 */}
          <div style={{ flex: win === 'full' ? 1 : '0 0 60%', ...col, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>{book?.book.title ?? ''}</span>
              <input
                value={chapterTitle}
                onChange={(e) => setChapterTitle(e.target.value)}
                placeholder={`${t('lessonPrefix')}${chapterNo}${t('lessonSuffix')}`}
                style={{ width: '100%', minWidth: 60, maxWidth: 260, padding: '5px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13 }}
              />
              <span style={{ flex: 1 }} />
              <button onClick={() => setViewMode('edit')} style={viewMode === 'edit' ? activeBtn : btn}>{t('edit')}</button>
              <button onClick={() => setViewMode('preview')} style={viewMode === 'preview' ? activeBtn : btn}>{t('preview')}</button>
              <button onClick={() => void save()} style={{ ...btn, borderColor: '#378add', color: '#185fa5', background: '#eef3fe' }}>{t('save')}</button>
            </div>
            <div style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
              {viewMode !== 'preview' && (
                <textarea
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setDirty(true) }}
                  style={{ flex: 1, width: '100%', minHeight: 0, padding: 12, border: '0.5px solid #e5e5e5', borderRadius: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.7, resize: 'none', boxSizing: 'border-box' }}
                  placeholder={t('editorPlaceholder')}
                />
              )}
              {viewMode !== 'edit' && (
                <div style={{ flex: 1, width: '100%', padding: 12, border: '0.5px solid #e5e5e5', borderRadius: 8, overflow: 'auto', fontSize: 13, lineHeight: 1.7, background: '#fafafa' }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#888' }}>
              <span>{t('wordCount')} {draft.length}</span>
              <span>{book?.book.stats.totalWords ?? 0} {t('totalWords')}</span>
              <span style={{ color: dirty ? '#ef9f27' : '#2f9e5b' }}>{dirty ? t('unsaved') : t('saved')}</span>
            </div>
          </div>

          {win === 'full' && <div onMouseDown={(e) => startColResize('right', e)} style={{ width: 6, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid #e5e5e5', borderRight: '1px solid #e5e5e5' }} title={t('resizeRight')} />}

          {/* 右栏：资料库 / 知识图谱 / 预览 */}
          <div style={{ width: win === 'full' ? rightW : '20%', flexShrink: 0, ...col, borderLeft: 'none' }}>
            <div style={{ display: 'flex', gap: 6, fontSize: 12 }}>
              <button onClick={() => setTab('lore')} style={tab === 'lore' ? activeBtn : btn}>{t('lore')}</button>
              <button onClick={() => void loadGraph()} style={tab === 'graph' ? activeBtn : btn}>{t('graph')}</button>
            </div>
            {tab === 'lore' && (
              <>
                <button onClick={openLoreAdd} style={btn}>{t('newLore')}</button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {loreEntries.filter((e) => !e.book_id || e.book_id === selected).map((e) => (
                    <div key={e.id} style={{ border: '0.5px solid #e5e5e5', borderRadius: 8, padding: 8, fontSize: 13, opacity: e.enabled ? 1 : 0.55, background: e.enabled ? '#fff' : '#f7f7f7' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                        <span style={{ fontSize: 11, color: e.enabled ? '#2f9e5b' : '#999', flexShrink: 0 }}>{e.enabled ? t('enable') : t('disable')}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }} title={e.content}>{e.content}</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => setLorePreview(e)} style={btn}>{t('preview')}</button>
                        <button onClick={() => openLoreEdit(e)} style={btn}>{t('edit')}</button>
                        <button onClick={() => void toggleEntry(e.id)} style={btn}>{e.enabled ? t('disable') : t('enable')}</button>
                        <button onClick={() => void deleteEntry(e.id)} style={{ ...btn, color: '#c0392b', borderColor: '#e6b3ad' }}>{t('delete')}</button>
                      </div>
                    </div>
                  ))}
                  {loreEntries.filter((e) => !e.book_id || e.book_id === selected).length === 0 && <div style={{ fontSize: 12, color: '#999', padding: 8 }}>{t('noLore')}</div>}
                </div>
              </>
            )}
            {tab === 'graph' && (graph && graph.nodes?.length ? <GraphSvg graph={graph} /> : <div style={{ fontSize: 12, color: '#999', padding: 8 }}>{t('noGraph')}</div>)}
          </div>
        </div>
      )}

      {showCreate && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 360, boxShadow: '0 12px 48px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t('createCourse')}</div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{t('courseName')}</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('courseNamePlaceholder')}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13, marginBottom: 12 }}
            />
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{t('courseType')}</label>
            <select value={newGenre} onChange={(e) => setNewGenre(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13, marginBottom: 16 }}>
              {GENRE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {GENRES.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </optgroup>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={btn}>{t('cancel')}</button>
              <button onClick={() => void confirmCreate()} disabled={!newTitle.trim()} style={{ ...btn, background: '#378add', borderColor: '#378add', color: '#fff' }}>{t('create')}</button>
            </div>
          </div>
        </div>
      )}

      {showExport && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 320, boxShadow: '0 12px 48px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t('exportCourse')}</div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>{t('format')}</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <button onClick={() => setExportFormat('txt')} style={exportFormat === 'txt' ? activeBtn : btn}>{t('txtFormat')}</button>
              <button onClick={() => setExportFormat('word')} style={exportFormat === 'word' ? activeBtn : btn}>{t('wordFormat')}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowExport(false)} style={btn}>{t('cancel')}</button>
              <button onClick={() => void doExport()} style={{ ...btn, background: '#378add', borderColor: '#378add', color: '#fff' }}>{t('export')}</button>
            </div>
          </div>
        </div>
      )}

      {showShare && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 400, boxShadow: '0 12px 48px rgba(0,0,0,0.3)', maxHeight: '82%', overflow: 'auto' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t('shareCourse')}</div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>{t('permission')}</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => setShareMode('read')} style={shareMode === 'read' ? activeBtn : btn}>{t('readOnly')}</button>
              <button onClick={() => setShareMode('write')} style={shareMode === 'write' ? activeBtn : btn}>{t('editable')}</button>
            </div>
            <button onClick={() => void createShare()} style={{ ...btn, background: '#378add', borderColor: '#378add', color: '#fff', width: '100%', marginBottom: 14 }}>{t('generateLink')}</button>
            {shareLink && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('newLink')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={shareLink} readOnly style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 12 }} />
                  <button onClick={() => void copyShare()} style={btn}>{t('copy')}</button>
                </div>
              </div>
            )}
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('existingShares')}</div>
            {shares.length === 0 && <div style={{ fontSize: 12, color: '#999' }}>{t('noShares')}</div>}
            {shares.map((s) => (
              <div key={s.token} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid #f0f0f0', fontSize: 12 }}>
                <a href={`${location.origin}/share/${s.token}`} target="_blank" rel="noreferrer" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#185fa5' }}>/share/{s.token}</a>
                <span style={{ color: s.mode === 'write' ? '#ef9f27' : '#888', flexShrink: 0 }}>{s.mode === 'write' ? t('editableShort') : t('readOnlyShort')}</span>
                <button onClick={() => void revokeShare(s.token)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#c33', fontSize: 12, flexShrink: 0 }}>{t('revoke')}</button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setShowShare(false)} style={btn}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}

      {showLoreModal && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 400, boxShadow: '0 12px 48px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{loreMode === 'add' ? t('newLoreTitle') : t('editLoreTitle')}</div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{t('name')}</label>
            <input value={loreName} onChange={(e) => setLoreName(e.target.value)} placeholder={t('loreNamePlaceholder')} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13, marginBottom: 12 }} />
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{t('contentDef')}</label>
            <textarea value={loreContent} onChange={(e) => setLoreContent(e.target.value)} placeholder={t('loreContentPlaceholder')} rows={6} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13, marginBottom: 12, resize: 'vertical' }} />
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{t('keywords')}</label>
            <input value={loreKeywords} onChange={(e) => setLoreKeywords(e.target.value)} placeholder={t('keywordsPlaceholder')} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13, marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowLoreModal(false)} style={btn}>{t('cancel')}</button>
              <button onClick={() => void submitLore()} disabled={!loreName.trim()} style={{ ...btn, background: '#378add', borderColor: '#378add', color: '#fff' }}>{loreMode === 'add' ? t('create') : t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {lorePreview && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 440, maxHeight: '80%', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{lorePreview.name}</div>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>{lorePreview.enabled ? t('enabledState') : t('disabledState')} · {t('keywordLabel')}：{kwText(lorePreview.keywords) || t('none')}</div>
            <div style={{ flex: 1, overflow: 'auto', fontSize: 13, lineHeight: 1.8, color: '#333', whiteSpace: 'pre-wrap', border: '0.5px solid #eee', borderRadius: 8, padding: 12 }}>{lorePreview.content}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setLorePreview(null)} style={btn}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function mountWorkshopLayout(options: Options): { toggle: () => void; dispose: () => void } {
  let host: HTMLDivElement | null = null
  let root: Root | null = null
  let open = false
  const close = (): void => {
    if (root) { root.unmount(); root = null }
    if (host) { host.remove(); host = null }
    open = false
  }
  const openPanel = (): void => {
    close()
    host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99998;pointer-events:none;'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<WorkshopLayout {...options} onClose={close} />)
    open = true
  }
  return { toggle: () => (open ? close() : openPanel()), dispose: close }
}
