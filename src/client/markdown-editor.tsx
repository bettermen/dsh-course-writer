/**
 * dsh-course-writer — Markdown 讲义编辑器（CodeMirror 6）。
 *
 * 取代原来的裸 <textarea>，保留完全相同的受控契约（value / onChange），
 * 以获得：Markdown 语法高亮、列表自动续行、撤销栈、括号引号自动配对、
 * 选中同一词高亮、等宽排版、深浅色双主题。
 *
 * 两个关键设计（踩过的坑）：
 *
 * 1) **受控回环**。CodeMirror 是非受控的：编辑器内部持有文档，React 只持有
 *    props.value。若「外部 value 变化 → dispatch 替换全文」不加以区分，
 *    用户每敲一个字都会：编辑器 onChange → setDraft → effect 回灌 →
 *    dispatch 全文替换 → 光标跳到文首。解决办法是 lastEmitted ref：
 *    记录编辑器自己最后一次发出的文本，effect 里只同步「不是自己发出的」变化
 *    （切章节、加载讲义、AI 润色回写）。
 *
 * 2) **Compartment 热切换**。主题 / 行号 / 只读切换用 Compartment.reconfigure
 *    重配置，不重建 EditorView —— 否则切一次深色模式就丢掉撤销栈和光标位置。
 */
import React, { useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine,
  highlightSpecialChars, keymap, lineNumbers, placeholder, rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { darkTokens, lightTokens } from './apple-ui.ts'
import type { DocState } from './md-commands.ts'

/** 编辑器等宽字体栈（中文回退到苹方/雅黑，避免等宽字体缺字）。 */
const EDITOR_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace'

/**
 * Markdown 语义色（Apple System Colors 之外的补充色）。
 * 行内代码走低饱和棕（不抢正文注意力），标记符号（# - > *）弱化到三级灰。
 */
const MD_INK = {
  light: { code: '#A2845E', mark: '#8E8E93', quote: '#6E6E73', meta: '#8E8E93', rule: '#C7C7CC', sel: '#B4D7FF' },
  dark: { code: '#AC8E68', mark: '#8E8E93', quote: '#98989F', meta: '#8E8E93', rule: '#48484A', sel: '#2A5C8A' },
} as const

/** Markdown 语法高亮（浅/深色两套）。 */
function markdownHighlight(scheme: 'light' | 'dark'): HighlightStyle {
  const c = scheme === 'dark' ? darkTokens : lightTokens
  const ink = MD_INK[scheme]
  return HighlightStyle.define([
    { tag: tags.heading, color: c.label, fontWeight: '600' },
    { tag: tags.strong, color: c.label, fontWeight: '600' },
    { tag: tags.emphasis, color: c.label, fontStyle: 'italic' },
    { tag: tags.strikethrough, color: c.tertiaryLabel, textDecoration: 'line-through' },
    { tag: tags.link, color: c.blue },
    { tag: tags.url, color: c.blue, textDecoration: 'underline' },
    { tag: tags.monospace, color: ink.code },
    { tag: tags.quote, color: ink.quote, fontStyle: 'italic' },
    { tag: tags.list, color: c.label },
    // Markdown 标记本身（#、-、>、*、**）降级处理，让正文成为视觉主角
    { tag: tags.processingInstruction, color: ink.mark },
    { tag: tags.contentSeparator, color: ink.rule },
    { tag: tags.meta, color: ink.meta },
  ])
}

/** 编辑器外壳主题：贴合 Apple 观感（无边框、细滚动条、蓝色聚焦环）。 */
function editorTheme(scheme: 'light' | 'dark'): Extension {
  const c = scheme === 'dark' ? darkTokens : lightTokens
  const ink = MD_INK[scheme]
  return [
    EditorView.theme(
      {
        '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'transparent', color: c.label },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': {
          fontFamily: EDITOR_FONT,
          lineHeight: '1.75',
          overflow: 'auto',
          scrollbarWidth: 'thin',
        },
        '.cm-content': { padding: '10px 0', caretColor: c.blue },
        '.cm-line': { padding: '0 4px' },
        '&.cm-focused .cm-cursor': { borderLeftColor: c.blue, borderLeftWidth: '2px' },
        '.cm-activeLine': { backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.028)' },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          color: c.quaternaryLabel,
          border: 'none',
          paddingRight: '4px',
        },
        '.cm-activeLineGutter': { backgroundColor: 'transparent', color: c.secondaryLabel },
        '.cm-lineNumbers .cm-gutterElement': { minWidth: '30px', padding: '0 8px 0 4px' },
        '.cm-selectionBackground, ::selection': { backgroundColor: ink.sel },
        '&.cm-focused .cm-selectionBackground, &.cm-focused ::selection': { backgroundColor: ink.sel },
        '.cm-selectionMatch': { backgroundColor: scheme === 'dark' ? 'rgba(255,159,10,0.22)' : 'rgba(255,149,0,0.18)' },
        '.cm-cursor': { borderLeftColor: c.blue },
        // 占位符
        '.cm-placeholder': { color: c.tertiaryLabel, fontStyle: 'normal' },
        // 匹配括号
        '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
          backgroundColor: scheme === 'dark' ? 'rgba(10,132,255,0.28)' : 'rgba(0,122,255,0.16)',
          outline: 'none',
        },
        // 搜索面板（CodeMirror 官方组件，文案为英文；与宿主 UI 风格对齐）
        '.cm-panels': { backgroundColor: c.bg, color: c.label, border: 'none', fontFamily: 'inherit' },
        '.cm-search': { padding: '6px 8px', fontSize: '12px' },
        '.cm-search input': {
          backgroundColor: c.tertiaryBg,
          border: '0.5px solid ' + c.separator,
          borderRadius: '6px',
          color: c.label,
          padding: '3px 7px',
          fontSize: '12px',
        },
        '.cm-search button': {
          backgroundColor: c.tertiaryBg,
          border: '0.5px solid ' + c.separator,
          borderRadius: '6px',
          color: c.label,
          fontSize: '12px',
          padding: '3px 7px',
          cursor: 'pointer',
        },
        '.cm-search label': { fontSize: '12px', color: c.secondaryLabel },
      },
      { dark: scheme === 'dark' },
    ),
    syntaxHighlighting(markdownHighlight(scheme)),
  ]
}

/** 基础扩展（与主题、行号、只读状态无关，整个生命周期只建一次）。 */
function baseExtensions(onChange: (next: string) => void): Extension {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSpecialChars(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    indentUnit.of('  '),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    search(),
    markdown({ base: markdownLanguage, addKeymap: false }),
    keymap.of([
      // Markdown 专属：回车自动续列表 / 块引用，退格自动删除列表标记
      ...markdownKeymap,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString())
    }),
  ]
}

export interface MarkdownEditorApi {
  undo: () => void
  redo: () => void
  openSearch: () => void
  focus: () => void
  /**
   * 跑一个纯函数命令（见 md-commands.ts）：读出当前文档 + 选区 → 计算结果 → 写回。
   * 整篇替换而非局部插入，是为了让一次工具栏动作只占一步撤销。
   */
  run: (cmd: (s: DocState) => DocState) => void
}

export interface MarkdownEditorProps {
  value: string
  onChange: (next: string) => void
  /** 与宿主一致的浅/深色外观。 */
  scheme: 'light' | 'dark'
  placeholder?: string
  showLineNumbers?: boolean
  readOnly?: boolean
  /** 暴露命令（撤销 / 重做 / 搜索 / 聚焦）给外部工具栏；卸载时传 null。 */
  onReady?: (api: MarkdownEditorApi | null) => void
}

/** Markdown 讲义编辑器（受控：value 进，onChange 出）。 */
export function MarkdownEditor({
  value, onChange, scheme, placeholder: placeholderText = '',
  showLineNumbers = false, readOnly = false, onReady,
}: MarkdownEditorProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 回调与初值放 ref：父组件每次重渲染都产生新函数，不能进建实例的依赖数组
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  /** 编辑器自己最后一次发出的文本（用于识别「外部改动」，避免自回声回灌）。 */
  const lastEmitted = useRef(value)
  const themeComp = useRef(new Compartment())
  const gutterComp = useRef(new Compartment())
  const readOnlyComp = useRef(new Compartment())

  // 建实例：只在挂载时执行一次
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          gutterComp.current.of(showLineNumbers ? lineNumbers() : []),
          themeComp.current.of(editorTheme(scheme)),
          readOnlyComp.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          ...(placeholderText ? [placeholder(placeholderText)] : []),
          baseExtensions((next) => {
            lastEmitted.current = next
            onChangeRef.current(next)
          }),
        ],
      }),
      parent: host,
    })
    viewRef.current = view
    // 命令走静态导入：tsdown 以 codeSplitting:false 打 CJS 单文件，动态 import 会炸
    onReadyRef.current?.({
      undo: () => { undo(view); view.focus() },
      redo: () => { redo(view); view.focus() },
      openSearch: () => { openSearchPanel(view) },
      focus: () => view.focus(),
      run: (cmd) => {
        const doc = view.state.doc.toString()
        const head = view.state.selection.main
        const next = cmd({ text: doc, from: head.from, to: head.to })
        const fit = (n: number): number => Math.max(0, Math.min(n, next.text.length))
        // 命令没改动任何东西（例如 url 为空的插入）时只聚焦，不产生一次空撤销步
        if (next.text === doc && next.from === head.from && next.to === head.to) { view.focus(); return }
        view.dispatch({
          changes: { from: 0, to: doc.length, insert: next.text },
          selection: { anchor: fit(next.from), head: fit(next.to) },
          scrollIntoView: true,
        })
        view.focus()
      },
    })
    return () => {
      // 卸载时清空外部引用，避免切到预览模式后工具栏按钮仍操作已销毁实例
      onReadyRef.current?.(null)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部值变化 → 同步进编辑器（跳过自回声）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      // 保留光标位置（切换讲义时旧 anchor 可能越界 → 夹到文末）
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
    })
  }, [value])

  // 主题 / 行号 / 只读：热重配置，不重建实例（保住撤销栈与光标）
  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeComp.current.reconfigure(editorTheme(scheme)) })
  }, [scheme])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: gutterComp.current.reconfigure(showLineNumbers ? lineNumbers() : []) })
  }, [showLineNumbers])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    })
  }, [readOnly])

  return (
    <div
      ref={hostRef}
      className="cw-md-editor"
      style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    />
  )
}
