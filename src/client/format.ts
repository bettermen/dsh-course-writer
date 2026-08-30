/**
 * xiashuo — 首页展示用的纯格式化函数（P4）。
 *
 * 全部为零依赖纯函数、时间可注入，便于在 node 环境下单测（本项目 vitest 用
 * `environment: 'node'`，没有 jsdom，React 组件本身不做单测，但展示逻辑必须可测）。
 */
import { STATUS_META } from '../core/novel/status.ts'
import type { ProjectStatus } from '../core/novel/status.ts'

export type Lang = 'zh' | 'en'

/**
 * 字数格式化：中文按「万」进位，英文按 k。
 * 例：12345 → 「1.2 万」/「12.3k」；不足进位单位时原样输出。
 */
export function formatWords(words: number, lang: Lang = 'zh'): string {
  const n = Number.isFinite(words) ? Math.max(0, Math.floor(words)) : 0
  if (lang === 'en') {
    if (n < 1000) return String(n)
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  }
  if (n < 10_000) return String(n)
  return `${(n / 10_000).toFixed(n < 1_000_000 ? 1 : 0)} 万`
}

/** 进度百分比（0–100）；总阶段数为 0 时返回 0（避免 NaN）。 */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}

/** ISO 时间 → 本地日期 `YYYY-MM-DD`（用于「太久以前」的兜底显示）。 */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前；超过 7 天回退到日期。
 * `now` 可注入（默认 Date.now()），便于测试。
 */
export function relativeTime(iso: string, lang: Lang = 'zh', now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const seconds = Math.floor((now - t) / 1000)
  if (seconds < 0) return formatDate(iso) // 未来时间（时钟不同步）→ 直接给日期
  if (seconds < 60) return lang === 'en' ? 'just now' : '刚刚'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return lang === 'en' ? `${minutes}m ago` : `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return lang === 'en' ? `${hours}h ago` : `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days < 7) return lang === 'en' ? `${days}d ago` : `${days} 天前`

  return formatDate(iso)
}

/** 状态显示名（优先 i18n 字典，未命中回退核心字典的中文名）。 */
export function statusLabel(status: ProjectStatus, lang: Lang = 'zh'): string {
  const meta = STATUS_META[status]
  if (!meta) return String(status)
  return lang === 'en' ? meta.labelEn : meta.label
}

/** 状态徽章色调（对齐 Apple 系统色：进行中=蓝、完成=绿、暂停=橙、其余=灰）。 */
export function statusTone(status: ProjectStatus): 'neutral' | 'blue' | 'orange' | 'green' {
  return STATUS_META[status]?.tone ?? 'neutral'
}

/** 类型显示名（按语言取 label / labelEn；英文缺失回退中文）。 */
export function kindLabelOf(kind: { label: string; labelEn?: string } | undefined, lang: Lang = 'zh', fallback = ''): string {
  if (!kind) return fallback
  if (lang === 'en') return kind.labelEn || kind.label
  return kind.label || fallback
}
