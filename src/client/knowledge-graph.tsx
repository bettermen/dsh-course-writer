/**
 * dsh-course-writer — 知识图谱可视化（客户端，自包含）。
 * 注入侧边栏入口「知识图谱」→ 弹层选择项目 → 读取 /projects/<id>/knowledge-graph → SVG 渲染。
 */
import React, { useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

interface GraphNode { id: string; label: string; type: string }
interface GraphEdge { source: string; target: string; label?: string }
interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }
interface Project { id: string; title: string }

const ENTRY_SELECTOR = '[data-dsh-course-writer-graph-entry]'

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

function injectEntry(onClick: () => void): void {
  if (document.querySelector(ENTRY_SELECTOR)) return
  const root = sidebarRoot()
  if (!root) return
  let anchor: HTMLElement | undefined
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested) anchor = nested
  else for (const c of root.children) if (c.tagName === 'BUTTON') { anchor = c as HTMLElement; break }
  if (!anchor) return
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.dataset.dshCourseWriterGraphEntry = ''
  btn.title = '知识图谱'
  btn.setAttribute('aria-label', '知识图谱')
  btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:13px;color:inherit;'
  btn.innerHTML = '<span style="display:flex"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4" cy="4" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="8" cy="12" r="2"/><path d="M6 5l4 0M5.5 12L4 6M10.5 12L12 7"/></svg></span><span>知识图谱</span>'
  btn.addEventListener('click', onClick)
  anchor.insertAdjacentElement('afterend', btn)
}

function GraphPanel(opts: { api: string; fenceHeader: string; onClose: () => void }): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [graph, setGraph] = useState<Graph | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${opts.api}/projects`, { headers: { [opts.fenceHeader]: '1' } })
      .then((r) => r.json())
      .then((j) => {
        const list = (j?.value ?? j?.projects ?? []) as Project[]
        setProjects(list)
        if (list.length > 0) setProjectId(list[0]!.id)
      })
      .catch(() => setError('项目列表加载失败'))
  }, [])

  const loadGraph = (): void => {
    if (!projectId) return
    setError('')
    setGraph(null)
    fetch(`${opts.api}/projects/${projectId}/knowledge-graph`, { headers: { [opts.fenceHeader]: '1' } })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok === false) { setError(j.error?.message ?? '加载失败'); return }
        setGraph((j?.value ?? j) as Graph)
      })
      .catch(() => setError('知识图谱加载失败（可能尚未生成，先用 course_gen_knowledge_graph 生成）'))
  }

  const panelStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const boxStyle: React.CSSProperties = {
    background: '#fff', color: '#222', borderRadius: 12, width: '90vw', maxWidth: 900,
    height: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
  }

  return React.createElement('div', { style: panelStyle, onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) opts.onClose() } },
    React.createElement('div', { style: boxStyle },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #eee' } },
        React.createElement('span', { style: { fontWeight: 700, fontSize: 15 } }, '课程知识图谱'),
        React.createElement('select', {
          value: projectId, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setProjectId(e.target.value),
          style: { padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 },
        }, projects.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.title))),
        React.createElement('button', { onClick: loadGraph, style: { padding: '5px 12px', borderRadius: 6, border: '1px solid #999', background: '#f4f4f4', cursor: 'pointer', fontSize: 13 } }, '加载图谱'),
        React.createElement('span', { style: { flex: 1 } }),
        React.createElement('button', { onClick: opts.onClose, style: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18 } }, '×'),
      ),
      error ? React.createElement('div', { style: { padding: 12, color: '#c33', fontSize: 12 } }, error)
        : graph && graph.nodes.length > 0
          ? React.createElement(GraphSvg, { graph })
          : React.createElement('div', { style: { padding: 24, color: '#888', fontSize: 13, flex: 1 } }, '选择项目后点击「加载图谱」。若尚未生成，请先在对话中调用 course_gen_knowledge_graph。'),
    ),
  )
}

function GraphSvg({ graph }: { graph: Graph }): React.ReactElement {
  const nodes = graph.nodes
  const edges = graph.edges ?? []
  const W = 860
  const H = 620
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 60
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    const angle = (Math.PI * 2 * i) / nodes.length - Math.PI / 2
    pos.set(n.id, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) })
  })
  return React.createElement('svg', { viewBox: `0 0 ${W} ${H}`, style: { flex: 1, width: '100%', height: '100%' } },
    edges.map((e, i) => {
      const a = pos.get(e.source)
      const b = pos.get(e.target)
      if (!a || !b) return null
      return React.createElement('line', { key: `e${i}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#c8c8c8', strokeWidth: 1.2 })
    }),
    nodes.map((n) => {
      const p = pos.get(n.id)!
      const color = n.type === 'skill' ? '#4a90d9' : n.type === 'case' ? '#e0904a' : '#4a9a5b'
      return React.createElement('g', { key: n.id },
        React.createElement('circle', { cx: p.x, cy: p.y, r: 16, fill: color, stroke: '#fff', strokeWidth: 2 }),
        React.createElement('text', { x: p.x, y: p.y - 24, textAnchor: 'middle', fontSize: 12, fill: '#333', fontWeight: 600 }, n.label),
      )
    }),
  )
}

export function mountKnowledgeGraph(opts: { api: string; fenceHeader: string }): () => void {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  const close = (): void => {
    if (root) { root.unmount(); root = null }
    if (host) { host.remove(); host = null }
  }

  // 打开时才创建全屏弹层；关闭即彻底移除，避免透明全屏层挡住页面点击。
  const openPanel = (): void => {
    close()
    host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(React.createElement(GraphPanel, { ...opts, onClose: close }))
  }

  injectEntry(openPanel)
  return () => {
    document.querySelector(ENTRY_SELECTOR)?.remove()
    close()
  }
}
