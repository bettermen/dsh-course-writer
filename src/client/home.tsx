/**
 * xiashuo — 首页：项目管理（P4）。
 *
 * 项目列表（卡片/列表双视图）+ 筛选（类型/状态/关键词）+ 排序 + 空态引导 +
 * 新建/编辑/删除弹窗 + 点击卡片进入工作台。
 *
 * 数据面全部走 `createXiashuoApi`（`/api/xiashuo`），筛选/排序直接交给后端
 * （`GET /projects?kind=&status=&q=&sort=&order=`），搜索关键词做 200ms 防抖。
 * 本组件只负责展示与交互；格式化/状态映射抽到 `format.ts` 纯函数（可单测）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { injectAppleStyles, useAppleScheme } from './apple-ui.ts'
import { t, tf, currentLang } from './i18n.ts'
import {
  createXiashuoApi,
  type XiashuoApi,
  type ProjectItem,
  type ProjectKind,
  type ProjectQuery,
  type WorkflowTemplate,
  type CreateProjectInput,
  type UpdateProjectInput,
} from './api.ts'
import type { ProjectStatus } from '../core/novel/status.ts'
import { formatWords, progressPercent, relativeTime, statusLabel, statusTone, kindLabelOf } from './format.ts'
import { ContextMenu, type MenuItem } from './context-menu.tsx'

/** 状态筛选选项（`''` 全部 / `active` 未归档 / 五态）。 */
const STATUS_VALUES = ['', 'active', 'draft', 'in_progress', 'paused', 'done', 'archived'] as const

/** 排序选项（不暴露 `status`，对用户无意义）。 */
const SORT_OPTIONS = [
  { value: 'updated', label: t('sortUpdated') },
  { value: 'created', label: t('sortCreated') },
  { value: 'title', label: t('sortTitle') },
  { value: 'words', label: t('sortWords') },
  { value: 'progress', label: t('sortProgress') },
] as const
type SortValue = (typeof SORT_OPTIONS)[number]['value']

/** 弹窗状态联合。 */
type ModalState =
  | { type: 'create' }
  | { type: 'edit'; project: ProjectItem }
  | { type: 'delete'; project: ProjectItem }
  | null

export interface HomeOptions {
  api: string
  fenceHeader: string
  /** 打开项目（进入工作台），由入口层负责关闭首页并拉起工作台。 */
  onOpenProject: (id: string) => void
}

function statusOptionLabel(value: (typeof STATUS_VALUES)[number], lang: 'zh' | 'en'): string {
  if (value === '') return t('allStatus')
  if (value === 'active') return t('activeOnly')
  return statusLabel(value, lang)
}

/* ------------------------------------------------------------------ */
/* 新建项目弹窗                                                          */
/* ------------------------------------------------------------------ */
function CreateModal({ kinds, api, onCancel, onSubmit }: {
  kinds: ProjectKind[]
  api: XiashuoApi
  onCancel: () => void
  onSubmit: (input: CreateProjectInput) => Promise<void>
}): React.ReactElement {
  const lang = currentLang()
  const [title, setTitle] = useState('')
  const [kindId, setKindId] = useState(kinds[0]?.id ?? '')
  const [genre, setGenre] = useState('')
  const [description, setDescription] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [busy, setBusy] = useState(false)

  const kind = kinds.find((k) => k.id === kindId)
  const genres = kind?.genres ?? []

  // 类型切换：题材回落首项 + 模板列表重载 + 模板重置为默认
  useEffect(() => {
    if (!kind) return
    setGenre(genres[0]?.id ?? 'general')
    setTemplateId('')
    let cancelled = false
    api.listTemplates(kind.id).then((ts) => { if (!cancelled) setTemplates(ts) }).catch(() => { /* 模板加载失败不阻塞创建 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindId])

  const submit = async (): Promise<void> => {
    const name = title.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await onSubmit({
        title: name,
        kind: kindId || undefined,
        genre: genre || undefined,
        description: description.trim() || undefined,
        templateId: templateId || undefined,
      })
    } catch {
      // 父级已提示错误，保持弹窗打开
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cw-modal-backdrop" style={{ borderRadius: 12 }}>
      <div className="cw-modal" style={{ width: 460, maxHeight: '84%', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t('newProjectBtn')}</div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldName')}</label>
          <input className="cw-input" style={{ width: '100%', boxSizing: 'border-box' }} value={title}
            onChange={(e) => setTitle(e.target.value)} placeholder={t('descPlaceholder')} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldKind')}</label>
          <div className="cw-kind-grid">
            {kinds.map((k) => (
              <button key={k.id} type="button"
                className={kindId === k.id ? 'cw-kind-card is-active' : 'cw-kind-card'}
                onClick={() => setKindId(k.id)}>
                <span className="cw-kind-card-icon">{k.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="cw-kind-card-name" style={{ display: 'block' }}>{kindLabelOf(k, lang)}</span>
                  <span className="cw-kind-card-desc" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {genres.length > 0 && (
          <div className="cw-field">
            <label className="cw-field-label">{t('fieldGenre')}</label>
            <select className="cw-home-select" style={{ width: '100%' }} value={genre} onChange={(e) => setGenre(e.target.value)}>
              {genres.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>
        )}

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldDesc')}</label>
          <input className="cw-input" style={{ width: '100%', boxSizing: 'border-box' }} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder={t('descPlaceholder')} />
        </div>

        {templates.length > 0 && (
          <div className="cw-field">
            <label className="cw-field-label">{t('fieldTemplate')}</label>
            <select className="cw-home-select" style={{ width: '100%' }} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{t('defaultTemplate')}</option>
              {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
          </div>
        )}

        <div className="cw-modal-actions">
          <button className="cw-btn cw-btn-sm" onClick={onCancel}>{t('cancel')}</button>
          <button className="cw-btn cw-btn-sm cw-btn-primary" disabled={!title.trim() || busy} onClick={() => void submit()}>{t('create')}</button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 编辑项目弹窗                                                          */
/* ------------------------------------------------------------------ */
function EditModal({ project, kinds, onCancel, onSubmit }: {
  project: ProjectItem
  kinds: ProjectKind[]
  onCancel: () => void
  onSubmit: (id: string, patch: UpdateProjectInput) => Promise<void>
}): React.ReactElement {
  const lang = currentLang()
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  const [kindId, setKindId] = useState(project.kind)
  const [genre, setGenre] = useState(project.genre)
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)

  const kind = kinds.find((k) => k.id === kindId)
  const genres = kind?.genres ?? []
  const kindChanged = kindId !== project.kind
  const canChangeKind = project.chapterCount === 0

  // 类型切换：题材若不在新类型口径内则回落首项
  useEffect(() => {
    if (genres.length && !genres.some((g) => g.id === genre)) setGenre(genres[0]!.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindId])

  const submit = async (): Promise<void> => {
    const name = title.trim()
    if (!name || busy) return
    if (kindChanged && !confirmReset) return
    setBusy(true)
    try {
      await onSubmit(project.id, {
        title: name,
        description: description.trim() || undefined,
        status,
        genre,
        kind: kindChanged ? kindId : undefined,
      })
    } catch {
      // 父级已提示
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cw-modal-backdrop" style={{ borderRadius: 12 }}>
      <div className="cw-modal" style={{ width: 440, maxHeight: '84%', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t('editProject')}</div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldName')}</label>
          <input className="cw-input" style={{ width: '100%', boxSizing: 'border-box' }} value={title}
            onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldDesc')}</label>
          <input className="cw-input" style={{ width: '100%', boxSizing: 'border-box' }} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder={t('descPlaceholder')} />
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldStatus')}</label>
          <select className="cw-home-select" style={{ width: '100%' }} value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {(['draft', 'in_progress', 'paused', 'done', 'archived'] as const).map((s) => (
              <option key={s} value={s}>{statusLabel(s, lang)}</option>
            ))}
          </select>
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldKind')}</label>
          <select className="cw-home-select" style={{ width: '100%' }} value={kindId}
            disabled={!canChangeKind} onChange={(e) => setKindId(e.target.value)}>
            {kinds.map((k) => <option key={k.id} value={k.id}>{kindLabelOf(k, lang)}</option>)}
          </select>
          {!canChangeKind && (
            <div className="cw-danger-note" style={{ marginTop: 8 }}>⚠️ {t('changeKindBlocked')}</div>
          )}
        </div>

        {genres.length > 0 && (
          <div className="cw-field">
            <label className="cw-field-label">{t('fieldGenre')}</label>
            <select className="cw-home-select" style={{ width: '100%' }} value={genre} onChange={(e) => setGenre(e.target.value)}>
              {genres.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>
        )}

        {kindChanged && canChangeKind && (
          <div className="cw-danger-note" style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginTop: 2 }} checked={confirmReset} onChange={(e) => setConfirmReset(e.target.checked)} />
              <span>⚠️ {t('changeKindWarn')} {t('confirmResetLabel')}</span>
            </label>
          </div>
        )}

        <div className="cw-modal-actions">
          <button className="cw-btn cw-btn-sm" onClick={onCancel}>{t('cancel')}</button>
          <button className="cw-btn cw-btn-sm cw-btn-primary"
            disabled={!title.trim() || busy || (kindChanged && !confirmReset)}
            onClick={() => void submit()}>{t('save')}</button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 删除项目弹窗                                                          */
/* ------------------------------------------------------------------ */
function DeleteModal({ project, onCancel, onSubmit }: {
  project: ProjectItem
  onCancel: () => void
  onSubmit: (id: string, keepFiles: boolean) => Promise<void>
}): React.ReactElement {
  const [keepFiles, setKeepFiles] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onSubmit(project.id, keepFiles)
    } catch {
      // 父级已提示
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cw-modal-backdrop" style={{ borderRadius: 12 }}>
      <div className="cw-modal" style={{ width: 400 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{t('confirmDeleteTitle')}</div>
        <div style={{ fontSize: 12, color: 'var(--cw-secondaryLabel)', marginBottom: 14 }}>{tf('confirmDeleteBody', project.title)}</div>

        <div className="cw-field">
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
            <input type="radio" style={{ marginTop: 2 }} checked={keepFiles} onChange={() => setKeepFiles(true)} />
            <span>
              <span style={{ fontSize: 13, fontWeight: 500, display: 'block' }}>{t('keepFiles')}</span>
              <span style={{ fontSize: 11, color: 'var(--cw-tertiaryLabel)' }}>{t('keepFilesHint')}</span>
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="radio" style={{ marginTop: 2 }} checked={!keepFiles} onChange={() => setKeepFiles(false)} />
            <span>
              <span style={{ fontSize: 13, fontWeight: 500, display: 'block', color: 'var(--cw-red)' }}>{t('deleteFiles')}</span>
              <span style={{ fontSize: 11, color: 'var(--cw-tertiaryLabel)' }}>{t('deleteFilesHint')}</span>
            </span>
          </label>
        </div>

        <div className="cw-modal-actions">
          <button className="cw-btn cw-btn-sm" onClick={onCancel}>{t('cancel')}</button>
          <button className="cw-btn cw-btn-sm cw-btn-danger" disabled={busy} onClick={() => void submit()}>{t('delete')}</button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 首页主体                                                              */
/* ------------------------------------------------------------------ */
export function Home({ api: base, fenceHeader, onOpenProject, onClose }: HomeOptions & { onClose: () => void }): React.ReactElement {
  const lang = currentLang()
  const scheme = useAppleScheme()
  const [api] = useState(() => createXiashuoApi(base, fenceHeader))

  const [kinds, setKinds] = useState<ProjectKind[]>([])
  const [items, setItems] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [kindFilter, setKindFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortValue>('updated')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [view, setView] = useState<'card' | 'list'>('card')

  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [modal, setModal] = useState<ModalState>(null)

  // 窗口控制（与工作台一致：全屏 / 缩小 50% / 关闭）
  const [win, setWin] = useState<'full' | 'half'>('full')
  const [halfSize, setHalfSize] = useState(() => ({ w: Math.round(window.innerWidth * 0.46), h: Math.round(window.innerHeight * 0.58) }))

  useEffect(() => { injectAppleStyles() }, [])

  const kindIcon = useMemo(() => new Map(kinds.map((k) => [k.id, k.icon])), [kinds])

  const buildQuery = (): ProjectQuery => ({
    kind: kindFilter || undefined,
    status: statusFilter || undefined,
    q: q.trim() || undefined,
    sort,
    order,
  })

  const fetchList = async (): Promise<void> => {
    try {
      setItems(await api.listProjects(buildQuery()))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFail'))
    }
  }

  const loadAll = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [k, list] = await Promise.all([api.listKinds(), api.listProjects(buildQuery())])
      setKinds(k)
      setItems(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFail'))
    } finally {
      setLoading(false)
    }
  }

  // 首载立即加载；筛选/排序/搜索变化走 200ms 防抖（搜索即时手感）
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      void loadAll()
      return
    }
    const timer = window.setTimeout(() => { void fetchList() }, 200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindFilter, statusFilter, sort, order, q])

  const showToast = (msg: string): void => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2500)
  }

  /** 包裹会抛错的异步操作：失败时提示、不中断交互。 */
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      showToast(`${t('opFail')}${msg ? `：${msg}` : ''}`)
    }
  }

  const openProject = (id: string): void => onOpenProject(id)

  const createSample = (): void => {
    void guard(async () => {
      await api.createProject({ title: t('sampleTitle'), kind: 'course', genre: 'general', description: t('sampleDesc') })
      await fetchList()
      showToast(t('toastSample'))
    })
  }

  const handleCreate = (input: CreateProjectInput): Promise<void> => guard(async () => {
    await api.createProject(input)
    await fetchList()
    showToast(t('toastCreated'))
    setModal(null)
  })

  const handleEdit = (id: string, patch: UpdateProjectInput): Promise<void> => guard(async () => {
    await api.updateProject(id, patch)
    await fetchList()
    showToast(t('toastSaved'))
    setModal(null)
  })

  const handleDelete = (id: string, keepFiles: boolean): Promise<void> => guard(async () => {
    await api.deleteProject(id, keepFiles)
    await fetchList()
    showToast(t('toastDeleted'))
    setModal(null)
  })

  const handleDuplicate = (p: ProjectItem): Promise<void> => guard(async () => {
    await api.duplicateProject(p.id)
    await fetchList()
    showToast(t('toastDuplicated'))
  })

  const handleArchive = (p: ProjectItem): Promise<void> => guard(async () => {
    const archived = p.status !== 'archived'
    await api.archiveProject(p.id, archived)
    await fetchList()
    showToast(archived ? t('toastArchived') : t('toastUnarchived'))
  })

  const openCardMenu = (e: React.MouseEvent, p: ProjectItem): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('openProject'), onSelect: () => openProject(p.id) },
        { label: t('editProject'), onSelect: () => setModal({ type: 'edit', project: p }) },
        { label: t('duplicateProject'), onSelect: () => void handleDuplicate(p) },
        { separator: true, label: '' },
        { label: p.status === 'archived' ? t('unarchiveProject') : t('archiveProject'), onSelect: () => void handleArchive(p) },
        { separator: true, label: '' },
        { label: t('deleteProject'), danger: true, onSelect: () => setModal({ type: 'delete', project: p }) },
      ],
    })
  }

  const onKeyOpen = (id: string) => (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openProject(id)
    }
  }

  const statusOptions = useMemo(() =>
    STATUS_VALUES.map((v) => ({ value: v, label: statusOptionLabel(v, lang) })), [lang])

  const renderCard = (p: ProjectItem): React.ReactElement => {
    const pct = progressPercent(p.phaseDone, p.phaseTotal)
    const done = pct >= 100
    return (
      <div key={p.id} className="cw-pcard" role="button" tabIndex={0}
        onClick={() => openProject(p.id)} onKeyDown={onKeyOpen(p.id)} onContextMenu={(e) => openCardMenu(e, p)}>
        <div className="cw-pcard-head">
          <span className="cw-pcard-icon">{kindIcon.get(p.kind) ?? '✨'}</span>
          <div className="cw-pcard-titles">
            <div className="cw-pcard-name">{p.title}</div>
            <div className="cw-pcard-desc">{p.description || '—'}</div>
          </div>
          <button type="button" className="cw-pcard-more" aria-label={t('editProject')}
            onClick={(e) => openCardMenu(e, p)}>⋯</button>
        </div>
        <div className="cw-pcard-badges">
          <span className="cw-badge is-kind">{p.kindLabel}</span>
          <span className={`cw-badge is-${statusTone(p.status)}`}>{statusLabel(p.status, lang)}</span>
        </div>
        <div className="cw-prog-row">
          <div className="cw-prog"><div className={done ? 'cw-prog-fill is-done' : 'cw-prog-fill'} style={{ width: `${pct}%` }} /></div>
          <span className="cw-prog-text">{tf('phaseProgress', p.phaseDone, p.phaseTotal)}</span>
        </div>
        <div className="cw-pcard-foot">
          <span>{p.chapterCount} {t('lessonSuffix2')}</span>
          <span>·</span>
          <span>{formatWords(p.totalWords, lang)}{t('wordsSuffix')}</span>
          <span style={{ flex: 1 }} />
          <span>{t('updatedPrefix')}{relativeTime(p.updatedAt, lang)}</span>
        </div>
      </div>
    )
  }

  const renderRow = (p: ProjectItem): React.ReactElement => {
    const pct = progressPercent(p.phaseDone, p.phaseTotal)
    return (
      <div key={p.id} className="cw-prow" role="button" tabIndex={0}
        onClick={() => openProject(p.id)} onKeyDown={onKeyOpen(p.id)} onContextMenu={(e) => openCardMenu(e, p)}>
        <span style={{ fontSize: 16, flex: '0 0 auto' }}>{kindIcon.get(p.kind) ?? '✨'}</span>
        <span className="cw-prow-name">{p.title}</span>
        <span className="cw-badge is-kind">{p.kindLabel}</span>
        <span className={`cw-badge is-${statusTone(p.status)}`}>{statusLabel(p.status, lang)}</span>
        <div className="cw-prog" style={{ width: 72, flex: '0 0 auto' }}>
          <div className="cw-prog-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="cw-prow-meta">{p.chapterCount} {t('lessonSuffix2')} · {formatWords(p.totalWords, lang)}{t('wordsSuffix')}</span>
        <span className="cw-prow-meta">{relativeTime(p.updatedAt, lang)}</span>
        <button type="button" className="cw-pcard-more" style={{ opacity: 1 }} aria-label={t('editProject')}
          onClick={(e) => openCardMenu(e, p)}>⋯</button>
      </div>
    )
  }

  // 缩小窗口的左下角拖拽缩放：右上角固定，向左拖变宽、向下拖变高（与工作台一致）。
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

  const shrinkToHalf = (): void => {
    setHalfSize({ w: Math.round(window.innerWidth * 0.46), h: Math.round(window.innerHeight * 0.58) })
    setWin('half')
  }

  const handleClose = (): void => {
    onClose()
  }

  const rootStyle: React.CSSProperties = win === 'full'
    ? { position: 'fixed', inset: 0, zIndex: 99999, background: 'var(--cw-secondaryBg)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--cw-font)', color: 'var(--cw-label)', overflow: 'hidden', pointerEvents: 'auto' }
    : { position: 'fixed', width: halfSize.w, height: halfSize.h, right: 16, top: 16, zIndex: 99999, background: 'var(--cw-secondaryBg)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--cw-font)', color: 'var(--cw-label)', overflow: 'hidden', borderRadius: 12, border: '0.5px solid var(--cw-separator)', boxShadow: '0 12px 48px rgba(0,0,0,0.25)', pointerEvents: 'auto' }

  return (
    <div className="cw-root" data-theme={scheme} style={rootStyle}>
      <div className="cw-home">
        {/* 顶栏 */}
        <div className="cw-home-bar">
          <span className="cw-home-title">{t('appName')}</span>
          <span className="cw-home-sub">{t('homeSub')}</span>
          <span className="cw-home-bar-spacer" />
          <span className="cw-home-sub" style={{ fontSize: 12 }}>{tf('projectCount', items.length)}</span>
          <button className="cw-btn cw-btn-primary cw-btn-sm" onClick={() => setModal({ type: 'create' })}>{t('newProjectBtn')}</button>
          <button className="cw-btn cw-btn-sm" onClick={shrinkToHalf} disabled={win === 'half'}>{t('shrinkHalf')}</button>
          <button className="cw-btn cw-btn-sm" onClick={() => setWin('full')} disabled={win === 'full'}>{t('fullscreen')}</button>
          <button className="cw-btn cw-btn-sm" onClick={handleClose}>{t('close')}</button>
        </div>

        {/* 工具条 */}
        <div className="cw-home-tools">
          <div className="cw-home-search">
            <span className="cw-home-search-icon">⌕</span>
            <input className="cw-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchProject')} />
          </div>

          <button className={kindFilter === '' ? 'cw-home-chip is-active' : 'cw-home-chip'} onClick={() => setKindFilter('')}>{t('allKinds')}</button>
          {kinds.map((k) => (
            <button key={k.id} className={kindFilter === k.id ? 'cw-home-chip is-active' : 'cw-home-chip'}
              onClick={() => setKindFilter(kindFilter === k.id ? '' : k.id)}>
              {k.icon} {kindLabelOf(k, lang)}
            </button>
          ))}

          <span style={{ width: 1, height: 16, background: 'var(--cw-separator)', alignSelf: 'center' }} />

          {statusOptions.map((o) => (
            <button key={o.value} className={statusFilter === o.value ? 'cw-home-chip is-active' : 'cw-home-chip'}
              onClick={() => setStatusFilter(statusFilter === o.value ? '' : o.value)}>
              {o.label}
            </button>
          ))}

          <span className="cw-home-bar-spacer" />

          <select className="cw-home-select" value={sort} onChange={(e) => setSort(e.target.value as SortValue)} aria-label={t('sortLabel')}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="cw-home-chip" title={order === 'asc' ? '↑' : '↓'}
            onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}>{order === 'asc' ? '↑' : '↓'}</button>

          <div className="cw-segmented">
            <button onClick={() => setView('card')} className={view === 'card' ? 'cw-seg-item is-active' : 'cw-seg-item'}>{t('viewCard')}</button>
            <button onClick={() => setView('list')} className={view === 'list' ? 'cw-seg-item is-active' : 'cw-seg-item'}>{t('viewList')}</button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="cw-home-body">
          {loading ? (
            <div className="cw-empty">
              <div className="cw-empty-title">{t('loading')}</div>
            </div>
          ) : error ? (
            <div className="cw-empty">
              <div className="cw-empty-icon">⚠️</div>
              <div className="cw-empty-title">{error}</div>
              <button className="cw-btn cw-btn-sm" onClick={() => void loadAll()}>{t('retry')}</button>
            </div>
          ) : items.length === 0 ? (
            <div className="cw-empty">
              <div className="cw-empty-icon">🗂️</div>
              <div className="cw-empty-title">{t('emptyTitle')}</div>
              <div className="cw-empty-desc">{t('emptyDesc')}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="cw-btn cw-btn-primary" onClick={() => setModal({ type: 'create' })}>{t('createFirst')}</button>
                <button className="cw-btn" onClick={createSample}>{t('createSample')}</button>
              </div>
            </div>
          ) : view === 'card' ? (
            <div className="cw-home-grid">{items.map(renderCard)}</div>
          ) : (
            <div className="cw-home-list">{items.map(renderRow)}</div>
          )}
        </div>

        {toast && <div className="cw-toast">{toast}</div>}

        {modal?.type === 'create' && (
          <CreateModal kinds={kinds} api={api} onCancel={() => setModal(null)} onSubmit={handleCreate} />
        )}
        {modal?.type === 'edit' && (
          <EditModal project={modal.project} kinds={kinds} onCancel={() => setModal(null)} onSubmit={handleEdit} />
        )}
        {modal?.type === 'delete' && (
          <DeleteModal project={modal.project} onCancel={() => setModal(null)} onSubmit={handleDelete} />
        )}

        {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
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
    </div>
  )
}

/**
 * 挂载首页（自包含全屏层）。
 * 返回 `toggle`（切换显隐）、`open`（显式打开）、`close`（关闭，供进入工作台时调用）、`dispose`（销毁）。
 */
export function mountHome(options: HomeOptions): { toggle: () => void; open: () => void; close: () => void; dispose: () => void } {
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
    root.render(<Home {...options} onClose={close} />)
    open = true
  }

  return { toggle: () => (open ? close() : openPanel()), open: openPanel, close, dispose: close }
}
