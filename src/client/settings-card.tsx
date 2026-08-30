/**
 * xiashuo — 设置卡（P1-I）。
 * 读写 settingsScope（host 设置：启用/数据目录）+ 浏览器端「隐藏侧边栏入口」
 * （localStorage，见 ui-hidden.ts）——该开关不依赖 host settings 是否暴露。
 */
import React, { useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { readUiHidden, writeUiHidden } from './ui-hidden.ts'
import { t } from './i18n.ts'
import { injectAppleStyles } from './apple-ui.ts'

export interface NovelSettingsCardProps {
  scope: SettingsScope<{ enabled: boolean; dataDir: string; uiHidden: boolean }>
}

/** 最小设置卡：启用开关 + 数据目录（host）+ 隐藏入口（摸鱼，localStorage）。 */
export function NovelSettingsCard({ scope }: NovelSettingsCardProps): React.ReactNode {
  const snapshot = scope.getSnapshot()
  const ready = snapshot.status === 'ready' && snapshot.value !== undefined
  const [enabled, setEnabled] = useState<boolean>(snapshot.value?.enabled ?? true)
  const [dataDir, setDataDir] = useState<string>(snapshot.value?.dataDir ?? '')
  const [uiHidden, setUiHidden] = useState<boolean>(readUiHidden())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => scope.subscribe(() => {
    const next = scope.getSnapshot()
    if (next.status === 'ready' && next.value !== undefined) {
      setEnabled(next.value.enabled)
      setDataDir(next.value.dataDir ?? '')
    }
  }), [scope])

  const onToggleHidden = (value: boolean): void => {
    setUiHidden(value)
    writeUiHidden(value) // localStorage + 派发事件 → 侧边栏入口即时增删
  }

  // 注入 Apple 样式表（幂等）—— 设置卡使用 .cw-switch / .cw-input / .cw-btn
  useEffect(() => { injectAppleStyles() }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await scope.set('enabled', enabled)
      await scope.set('dataDir', dataDir)
      await scope.set('uiHidden', uiHidden)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      setSaved(false)
    } finally {
      setSaving(false)
    }
  }

  // 一行「标签 + Apple Switch」的构造助手
  const switchRow = (checked: boolean, onChange: (next: boolean) => void, label: string) =>
    React.createElement(
      'label',
      { style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' } },
      React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        className: checked ? 'cw-switch is-on' : 'cw-switch',
        onClick: () => onChange(!checked),
      }),
      React.createElement(
        'span',
        { style: { fontSize: 13, color: 'var(--cw-label)' } },
        label,
      ),
    )

  const hiddenToggle = switchRow(uiHidden, onToggleHidden, t('hideSidebar'))
  const enabledToggle = switchRow(enabled, setEnabled, t('enableDesc'))

  const panel = (children: React.ReactNode[]) =>
    React.createElement(
      'div',
      { className: 'cw-card', style: { padding: 14, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 } },
      React.createElement(
        'div',
        { className: 'cw-title', style: { marginBottom: 2 } },
        t('appName'),
      ),
      ...children,
    )

  // host settings 不可用（命名空间未暴露 / memory 模式）：降级为纯本地开关，不让用户卡住
  if (!ready) return panel([hiddenToggle])

  const dataDirField = React.createElement(
    'label',
    { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    React.createElement(
      'span',
      { className: 'cw-caption' },
      t('dataDir'),
    ),
    React.createElement('input', {
      type: 'text',
      className: 'cw-input',
      value: dataDir,
      placeholder: '默认 ~/.dsh/xiashuo',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDataDir(e.target.value),
    }),
  )

  const saveRow = React.createElement(
    'div',
    { style: { display: 'flex', gap: 10, alignItems: 'center' } },
    React.createElement(
      'button',
      {
        className: 'cw-btn cw-btn-primary',
        onClick: () => void save(),
        disabled: saving,
      },
      saving ? t('saving') : t('save'),
    ),
    saved
      ? React.createElement(
          'span',
          { style: { fontSize: 12, color: 'var(--cw-green)' } },
          t('savedNotice'),
        )
      : null,
  )

  return panel([enabledToggle, dataDirField, hiddenToggle, saveRow])
}
