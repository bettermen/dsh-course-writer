/**
 * xiashuo — 课程题材（genre）统一清单（P3 题材扩充）。
 *
 * 课程全类型题材枚举：id 为持久化值（英文小写），label 为中文显示名，
 * group 为客户端下拉分组。host 与 client 共用（纯常量 + 纯函数，零依赖）。
 * 已有课程的 genre 值不受影响（旧 id 全部保留在清单内）。
 */

export interface GenreOption {
  id: string
  label: string
  group: string
}

export const GENRES: GenreOption[] = [
  // 通识素养
  { id: 'general', label: '通用通识', group: '通识素养' },
  { id: 'humanities', label: '人文社科', group: '通识素养' },
  { id: 'science', label: '科普', group: '通识素养' },
  // 学科知识
  { id: 'math', label: '数学', group: '学科知识' },
  { id: 'chinese', label: '语文', group: '学科知识' },
  { id: 'english', label: '英语', group: '学科知识' },
  { id: 'physics', label: '物理', group: '学科知识' },
  { id: 'chemistry', label: '化学', group: '学科知识' },
  { id: 'biology', label: '生物', group: '学科知识' },
  { id: 'history', label: '历史', group: '学科知识' },
  { id: 'geography', label: '地理', group: '学科知识' },
  // 职业技能
  { id: 'programming', label: '编程开发', group: '职业技能' },
  { id: 'design', label: '设计', group: '职业技能' },
  { id: 'marketing', label: '市场营销', group: '职业技能' },
  { id: 'management', label: '管理', group: '职业技能' },
  { id: 'finance', label: '财务金融', group: '职业技能' },
  { id: 'law', label: '法律', group: '职业技能' },
  // 资格考试
  { id: 'certification', label: '职业考证', group: '资格考试' },
  { id: 'civil-service', label: '公考/编制', group: '资格考试' },
  // 兴趣拓展
  { id: 'art', label: '艺术', group: '兴趣拓展' },
  { id: 'music', label: '音乐', group: '兴趣拓展' },
  { id: 'health', label: '健康养生', group: '兴趣拓展' },
  { id: 'sports', label: '体育健身', group: '兴趣拓展' },
]

const GENRE_LABEL_BY_ID = new Map(GENRES.map((genre) => [genre.id, genre.label]))
const GENRE_ID_BY_LABEL = new Map(GENRES.map((genre) => [genre.label.toLowerCase(), genre.id]))

/** id → 中文标签（未知 id 原样返回，兼容旧数据）。 */
export function genreLabel(id: string): string {
  return GENRE_LABEL_BY_ID.get(String(id ?? '')) ?? String(id ?? '')
}

/** 中文标签 → id（大小写不敏感；非已知标签返回 undefined）。 */
export function genreIdFromLabel(label: string): string | undefined {
  return GENRE_ID_BY_LABEL.get(String(label ?? '').trim().toLowerCase())
}

/** 是否为合法题材 id。 */
export function isGenreId(id: string): boolean {
  return GENRE_LABEL_BY_ID.has(String(id ?? ''))
}
