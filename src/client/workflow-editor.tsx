/**
 * xiashuo — 流程编辑器（P5）。
 *
 * 工作台左栏「流程」页：阶段列表（拖拽排序 / 增删 / 点击编辑）+ 属性面板弹窗
 * （门禁 / 说明 / 必交产物 / AI 提示词 / 评审标准 / 可跳过）+ 恢复默认 + 另存为模板 + 模板库。
 *
 * 数据面走 `createXiashuoApi`（`/api/xiashuo`），与 P4 首页共用同一客户端 API 层。
 * 所有写操作后端返回「保存后的完整 Workflow」，本组件用它替换本地状态，天然保持与服务端一致。
 */
import React, { useEffect, useRef, useState } from 'react'
import { t, tf } from './i18n.ts'
import { injectAppleStyles } from './apple-ui.ts'
import { createXiashuoApi, type XiashuoApi, type PhasePatch, type WorkflowTemplate } from './api.ts'
import type { Workflow, WorkflowPhase, WorkflowArtifact, PhaseGate, ArtifactKind } from '../core/workflow/schema.ts'
import { ContextMenu, type MenuItem } from './context-menu.tsx'

const GATE_OPTIONS: Array<{ value: PhaseGate; label: string; color: string }> = [
  { value: 'none', label: t('gateNone'), color: 'var(--cw-tertiaryLabel)' },
  { value: 'manual', label: t('gateManual'), color: 'var(--cw-blue)' },
  { value: 'checklist', label: t('gateChecklist'), color: 'var(--cw-orange)' },
  { value: 'ai', label: t('gateAi'), color: 'var(--cw-green)' },
]

const ARTIFACT_KINDS: Array<{ value: ArtifactKind; label: string }> = [
  { value: 'doc', label: t('artifactDoc') },
  { value: 'chapter', label: t('artifactChapter') },
  { value: 'lorebook', label: t('artifactLorebook') },
  { value: 'wordcount', label: t('artifactWordcount') },
  { value: 'custom', label: t('artifactCustom') },
]

function gateColor(gate: PhaseGate): string {
  return GATE_OPTIONS.find((g) => g.value === gate)?.color ?? 'var(--cw-tertiaryLabel)'
}
function gateLabel(gate: PhaseGate): string {
  return GATE_OPTIONS.find((g) => g.value === gate)?.label ?? gate
}
function artifactLabel(kind: ArtifactKind): string {
  return ARTIFACT_KINDS.find((k) => k.value === kind)?.label ?? kind
}

/* ------------------------------------------------------------------ */
/* 阶段属性面板弹窗                                                      */
/* ------------------------------------------------------------------ */
function PhaseEditModal({ phase, onCancel, onSave }: {
  phase: WorkflowPhase
  onCancel: () => void
  onSave: (patch: PhasePatch) => void
}): React.ReactElement {
  const [name, setName] = useState(phase.name)
  const [description, setDescription] = useState(phase.description ?? '')
  const [gate, setGate] = useState<PhaseGate>(phase.gate)
  const [prompt, setPrompt] = useState(phase.prompt ?? '')
  const [rubric, setRubric] = useState(phase.rubric ?? '')
  const [optional, setOptional] = useState(phase.optional ?? false)
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>(phase.artifacts.map((a) => ({ ...a })))

  const setArtifact = (i: number, patch: Partial<WorkflowArtifact>): void => {
    setArtifacts((list) => list.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }
  const removeArtifact = (i: number): void => setArtifacts((list) => list.filter((_, idx) => idx !== i))
  const addArtifact = (): void => setArtifacts((list) => [...list, { kind: 'doc', label: '', min: 1 }])

  return (
    <div className="cw-modal-backdrop" style={{ borderRadius: 12 }}>
      <div className="cw-modal" style={{ width: 460, maxHeight: '86%', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t('editPhase')}</div>

        <div className="cw-field">
          <label className="cw-field-label">{t('phaseName')}</label>
          <input className="cw-input" style={{ width: '100%', boxSizing: 'border-box' }} value={name}
            onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldGate')}</label>
          <select className="cw-home-select" style={{ width: '100%' }} value={gate}
            onChange={(e) => setGate(e.target.value as PhaseGate)}>
            {GATE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <div style={{ fontSize: 11, color: 'var(--cw-tertiaryLabel)', marginTop: 4 }}>{t('gateHint')}</div>
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldPhaseDesc')}</label>
          <input className="cw-input" style={{ width: '100%', boxSizing: 'border-box' }} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder={t('descPlaceholder')} />
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldArtifacts')}</label>
          {artifacts.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <select className="cw-home-select" style={{ flex: '0 0 auto', width: 96 }} value={a.kind}
                onChange={(e) => setArtifact(i, { kind: e.target.value as ArtifactKind })}>
                {ARTIFACT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <input className="cw-input" style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }} value={a.label}
                onChange={(e) => setArtifact(i, { label: e.target.value })} placeholder={t('artifactLabel')} />
              <input className="cw-input" type="number" min={0} style={{ width: 52, boxSizing: 'border-box' }} value={a.min ?? ''}
                onChange={(e) => setArtifact(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })}
                title={t('artifactMin')} />
              <button type="button" className="cw-btn cw-btn-sm cw-btn-danger" onClick={() => removeArtifact(i)} aria-label={t('delete')}>×</button>
            </div>
          ))}
          <button type="button" className="cw-btn cw-btn-sm cw-btn-tertiary" onClick={addArtifact}>{t('addArtifact')}</button>
        </div>

        <div className="cw-field">
          <label className="cw-field-label">{t('fieldPrompt')}</label>
          <textarea className="cw-textarea" style={{ width: '100%', boxSizing: 'border-box', minHeight: 60 }} value={prompt}
            onChange={(e) => setPrompt(e.target.value)} placeholder={t('descPlaceholder')} />
        </div>

        {gate === 'ai' && (
          <div className="cw-field">
            <label className="cw-field-label">{t('fieldRubric')}</label>
            <textarea className="cw-textarea" style={{ width: '100%', boxSizing: 'border-box', minHeight: 60 }} value={rubric}
              onChange={(e) => setRubric(e.target.value)} placeholder={t('descPlaceholder')} />
          </div>
        )}

        <div className="cw-field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} />
            {t('fieldOptional')}
          </label>
        </div>

        <div className="cw-modal-actions">
          <button className="cw-btn cw-btn-sm" onClick={onCancel}>{t('cancel')}</button>
          <button className="cw-btn cw-btn-sm cw-btn-primary" disabled={!name.trim()}
            onClick={() => onSave({
              name: name.trim() || undefined,
              description: description.trim() || undefined,
              gate,
              prompt: prompt.trim() || undefined,
              rubric: rubric.trim() || undefined,
              optional,
              artifacts: artifacts.filter((a) => a.label.trim() !== ''),
            })}>
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 模板库弹窗                                                           */
/* ------------------------------------------------------------------ */
function TemplatesModal({ templates, onClose, onApply, onDelete }: {
  templates: WorkflowTemplate[]
  onClose: () => void
  onApply: (id: string) => void
  onDelete: (id: string) => void
}): React.ReactElement {
  const builtins = templates.filter((tp) => tp.scope === 'builtin')
  const users = templates.filter((tp) => tp.scope === 'user')
  const render = (tp: WorkflowTemplate): React.ReactElement => (
    <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '0.5px solid var(--cw-separator)', borderRadius: 8, marginBottom: 6 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tp.name}</span>
      <span className="cw-badge is-kind">{tp.phases?.length ?? 0} {t('phasesUnit')}</span>
      {tp.scope === 'builtin'
        ? <span className="cw-badge is-neutral">{t('builtinTemplate')}</span>
        : <span className="cw-badge is-blue">{t('userTemplate')}</span>}
      <button className="cw-btn cw-btn-sm cw-btn-tertiary" onClick={() => onApply(tp.id)}>{t('applyTemplate')}</button>
      {tp.scope === 'user' && (
        <button className="cw-btn cw-btn-sm cw-btn-danger" onClick={() => onDelete(tp.id)} aria-label={t('delete')}>×</button>
      )}
    </div>
  )
  return (
    <div className="cw-modal-backdrop" style={{ borderRadius: 12 }}>
      <div className="cw-modal" style={{ width: 440, maxHeight: '84%', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>{t('templateLib')}</div>
        {users.length > 0 && <div style={{ fontSize: 12, color: 'var(--cw-secondaryLabel)', marginBottom: 6 }}>{t('userTemplate')}</div>}
        {users.map(render)}
        {builtins.length > 0 && <div style={{ fontSize: 12, color: 'var(--cw-secondaryLabel)', margin: '10px 0 6px' }}>{t('builtinTemplate')}</div>}
        {builtins.map(render)}
        {templates.length === 0 && <div style={{ fontSize: 12, color: 'var(--cw-tertiaryLabel)', padding: 12 }}>{t('noTemplates')}</div>}
        <div className="cw-modal-actions">
          <button className="cw-btn cw-btn-sm" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 流程编辑器主体                                                        */
/* ------------------------------------------------------------------ */
export interface WorkflowEditorProps {
  base: string
  fenceHeader: string
  projectId: string
  /** 流程变更后回调（供上层刷新阶段总览等）。 */
  onChanged?: (workflow: Workflow) => void
}

export function WorkflowEditor({ base, fenceHeader, projectId, onChanged }: WorkflowEditorProps): React.ReactElement {
  const [api] = useState(() => createXiashuoApi(base, fenceHeader))
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [modal, setModal] = useState<null | { type: 'edit'; phase: WorkflowPhase } | { type: 'saveAs' } | { type: 'templates' }>(null)
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const toastTimer = useRef<number | null>(null)

  useEffect(() => { injectAppleStyles() }, [])

  const load = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setWorkflow(await api.getWorkflow(projectId))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFail'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (msg: string): void => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2500)
  }

  /** 包裹写操作：统一 busy + 错误提示 + 用返回的 workflow 覆盖本地状态。 */
  const mutate = async (fn: () => Promise<Workflow>, okMsg?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const wf = await fn()
      setWorkflow(wf)
      onChanged?.(wf)
      if (okMsg) showToast(okMsg)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      showToast(`${t('opFail')}${msg ? `：${msg}` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const phases = workflow?.phases ?? []

  const addPhase = (): void => {
    void (async () => {
      if (busy) return
      setBusy(true)
      try {
        const wf = await api.addPhase(projectId, { name: '新阶段' })
        setWorkflow(wf)
        onChanged?.(wf)
        showToast(t('phaseAdded'))
        const last = wf.phases[wf.phases.length - 1]
        if (last) setModal({ type: 'edit', phase: last }) // 新增后直接打开属性面板改名
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        showToast(`${t('opFail')}${msg ? `：${msg}` : ''}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  const deletePhase = (phase: WorkflowPhase): void => {
    if (!window.confirm(tf('deletePhaseConfirm', phase.name))) return
    void mutate(() => api.deletePhase(projectId, phase.id), t('phaseDeleted'))
  }

  const commitReorder = (from: number, to: number): void => {
    void mutate(() => api.reorderPhases(projectId, from, to))
  }

  const resetWorkflow = (): void => {
    if (!window.confirm(t('resetWorkflowConfirm'))) return
    void mutate(() => api.resetWorkflow(projectId), t('resetDone'))
  }

  const savePhase = (patch: PhasePatch): void => {
    const phase = modal?.type === 'edit' ? modal.phase : null
    if (!phase) return
    void mutate(() => api.updatePhase(projectId, phase.id, patch), t('workflowSaved')).then(() => setModal(null))
  }

  const openTemplates = async (): Promise<void> => {
    try {
      setTemplates(await api.listTemplates(workflow?.kind))
      setModal({ type: 'templates' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      showToast(`${t('opFail')}${msg ? `：${msg}` : ''}`)
    }
  }

  const applyTemplate = (id: string): void => {
    const tp = templates.find((x) => x.id === id)
    if (!tp) return
    if (!window.confirm(tf('applyTemplateConfirm', tp.name))) return
    void (async () => {
      try {
        const tpl = await api.getTemplate(id)
        await mutate(() => api.saveWorkflow(projectId, tpl), t('workflowSaved'))
        setModal(null)
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        showToast(`${t('opFail')}${msg ? `：${msg}` : ''}`)
      }
    })()
  }

  const deleteTemplate = (id: string): void => {
    const tp = templates.find((x) => x.id === id)
    if (!tp || !window.confirm(tf('deletePhaseConfirm', tp.name))) return
    void (async () => {
      try {
        await api.deleteTemplate(id)
        setTemplates(await api.listTemplates(workflow?.kind))
        showToast(t('templateDeleted'))
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        showToast(`${t('opFail')}${msg ? `：${msg}` : ''}`)
      }
    })()
  }

  const saveAsTemplate = (): void => setModal({ type: 'saveAs' })

  const openMenu = (e: React.MouseEvent, phase: WorkflowPhase): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('editPhase'), onSelect: () => setModal({ type: 'edit', phase }) },
        { separator: true, label: '' },
        { label: t('delete'), danger: true, onSelect: () => deletePhase(phase) },
      ],
    })
  }

  const renderPhase = (phase: WorkflowPhase, index: number): React.ReactElement => {
    const gate = gateLabel(phase.gate)
    return (
      <div
        key={phase.id}
        onClick={() => setModal({ type: 'edit', phase })}
        onContextMenu={(e) => openMenu(e, phase)}
        draggable={!busy}
        onDragStart={(e) => {
          setDragging(phase.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', phase.id)
        }}
        onDragEnd={() => { setDragging(null); setOver(null) }}
        onDragOver={(e) => {
          if (dragging === null || dragging === phase.id) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setOver(phase.id)
        }}
        onDragLeave={() => { if (over === phase.id) setOver(null) }}
        onDrop={(e) => {
          e.preventDefault()
          const fromId = dragging ?? e.dataTransfer.getData('text/plain')
          setDragging(null)
          setOver(null)
          const from = phases.findIndex((p) => p.id === fromId)
          const to = phases.findIndex((p) => p.id === phase.id)
          if (from < 0 || to < 0 || from === to) return
          commitReorder(from, to)
        }}
        className={[
          'cw-list-item',
          dragging === phase.id ? 'is-dragging' : '',
          over === phase.id && dragging !== null && dragging !== phase.id ? 'is-drop-target' : '',
        ].filter(Boolean).join(' ')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', fontSize: 13, cursor: 'pointer' }}
      >
        <span className="cw-drag-handle" title={t('dragToSort')} aria-hidden="true">
          <svg width="9" height="12" viewBox="0 0 9 12" fill="currentColor"><circle cx="1.8" cy="1.6" r="1" /><circle cx="7.2" cy="1.6" r="1" /><circle cx="1.8" cy="6" r="1" /><circle cx="7.2" cy="6" r="1" /><circle cx="1.8" cy="10.4" r="1" /><circle cx="7.2" cy="10.4" r="1" /></svg>
        </span>
        <span style={{ fontSize: 11, color: 'var(--cw-secondaryLabel)', flexShrink: 0 }}>{index + 1}</span>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: gateColor(phase.gate), flexShrink: 0 }} title={gate} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{phase.name}</span>
        {phase.optional && <span style={{ fontSize: 10, flexShrink: 0 }} title={t('fieldOptional')}>⏭</span>}
      </div>
    )
  }

  if (loading) {
    return <div style={{ padding: 12, color: 'var(--cw-secondaryLabel)', fontSize: 12 }}>{t('loading')}</div>
  }
  if (error) {
    return (
      <div style={{ padding: 12, fontSize: 12 }}>
        <div style={{ color: 'var(--cw-red)', marginBottom: 8 }}>{error}</div>
        <button className="cw-btn cw-btn-sm" onClick={() => void load()}>{t('retry')}</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--cw-secondaryLabel)', fontWeight: 500 }}>{workflow?.name ?? ''}</div>
      <div style={{ fontSize: 11, color: 'var(--cw-tertiaryLabel)' }}>{t('phaseHint')}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {phases.map(renderPhase)}
        {phases.length === 0 && <div style={{ fontSize: 12, color: 'var(--cw-tertiaryLabel)', padding: 8 }}>{t('noPhases')}</div>}
      </div>

      <button className="cw-btn cw-btn-sm" disabled={busy} onClick={addPhase}>{t('addPhase')}</button>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="cw-btn cw-btn-sm" onClick={resetWorkflow}>{t('resetWorkflow')}</button>
        <button className="cw-btn cw-btn-sm" onClick={() => void openTemplates()}>{t('templateLib')}</button>
        <button className="cw-btn cw-btn-sm cw-btn-tertiary" onClick={saveAsTemplate}>{t('saveAsTemplate')}</button>
      </div>

      {toast && <div className="cw-toast">{toast}</div>}

      {modal?.type === 'edit' && (
        <PhaseEditModal phase={modal.phase} onCancel={() => setModal(null)} onSave={savePhase} />
      )}
      {modal?.type === 'saveAs' && (
        <SaveAsModal kind={workflow?.kind} api={api} projectId={projectId}
          onCancel={() => setModal(null)}
          onSaved={(name) => showToast(`${t('templateSaved')}：${name}`)} />
      )}
      {modal?.type === 'templates' && (
        <TemplatesModal templates={templates} onClose={() => setModal(null)}
          onApply={applyTemplate} onDelete={deleteTemplate} />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 另存为模板弹窗                                                       */
/* ------------------------------------------------------------------ */
function SaveAsModal({ kind, api, projectId, onCancel, onSaved }: {
  kind: string | undefined
  api: XiashuoApi
  projectId: string
  onCancel: () => void
  onSaved: (name: string) => void
}): React.ReactElement {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    setError('')
    try {
      await api.saveAsTemplate({ name: n, projectId, ...(kind ? { kind } : {}) })
      onSaved(n)
      onCancel()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(msg || t('opFail'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="cw-modal-backdrop" style={{ borderRadius: 12 }}>
      <div className="cw-modal" style={{ width: 360 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>{t('saveAsTemplate')}</div>
        <div className="cw-field">
          <label className="cw-field-label">{t('templateName')}</label>
          <input className="cw-input" style={{ width: '100%', boxSizing: 'border-box' }} value={name}
            onChange={(e) => setName(e.target.value)} placeholder={t('templateName')} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
        </div>
        {error && <div style={{ fontSize: 12, color: 'var(--cw-red)', marginBottom: 8 }}>{error}</div>}
        <div className="cw-modal-actions">
          <button className="cw-btn cw-btn-sm" onClick={onCancel}>{t('cancel')}</button>
          <button className="cw-btn cw-btn-sm cw-btn-primary" disabled={!name.trim() || busy} onClick={() => void submit()}>{t('saveTemplate')}</button>
        </div>
      </div>
    </div>
  )
}
