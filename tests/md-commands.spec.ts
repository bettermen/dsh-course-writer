import { describe, expect, it } from 'vitest'
import {
  INLINE_MARK, applyInlineStyle, clearInlineStyle, insertHr, insertImage, insertLink,
  insertTable, lineEndOf, lineStartOf, mergeStyle, removeStyle, setBlockStyle,
  toggleFence, toggleInlineWrap, wordAt, type DocState,
} from '../src/client/md-commands.ts'

/** 便捷构造：'ab|cd' 里的 | 表示光标，'[ab]' 表示选区。 */
function doc(marked: string): DocState {
  if (marked.includes('[')) {
    const from = marked.indexOf('[')
    const to = marked.indexOf(']') - 1
    return { text: marked.slice(0, from) + marked.slice(from + 1, to + 1) + marked.slice(to + 2), from, to }
  }
  const from = marked.indexOf('|')
  return { text: marked.slice(0, from) + marked.slice(from + 1), from, to: from }
}

describe('行边界辅助', () => {
  it('定位行首行尾', () => {
    const t = 'abc\ndef\nghi'
    expect(lineStartOf(t, 5)).toBe(4)
    expect(lineEndOf(t, 5)).toBe(7)
    expect(lineStartOf(t, 0)).toBe(0)
    expect(lineEndOf(t, 11)).toBe(11)
  })

  it('取光标下的词（中英文均可）', () => {
    expect(wordAt('hello world', 1)).toEqual({ from: 0, to: 5 })
    expect(wordAt('你好，世界', 1)).toEqual({ from: 0, to: 2 })
    // 光标悬在纯空白处（两侧都不是词字符）→ 不成词
    expect(wordAt('a  b', 2)).toBeNull()
  })
})

describe('行内标记', () => {
  it('空选区插入一对标记并把光标放中间', () => {
    const r = toggleInlineWrap(doc('|abc'), INLINE_MARK.bold)
    expect(r.text).toBe('****abc')
    expect([r.from, r.to]).toEqual([2, 2])
  })

  it('包裹选区', () => {
    const r = toggleInlineWrap(doc('a[bc]d'), INLINE_MARK.bold)
    expect(r.text).toBe('a**bc**d')
    expect(r.text.slice(r.from, r.to)).toBe('bc')
  })

  it('选区外侧已包裹 → 脱掉标记', () => {
    const r = toggleInlineWrap(doc('**[bold]**'), INLINE_MARK.bold)
    expect(r.text).toBe('**bold**'.slice(2, -2) === 'bold' ? 'bold' : '**bold**')
    expect(r.text).toBe('bold')
  })

  it('选区自带标记（把 **粗体** 整个选中）→ 去掉内层标记', () => {
    const r = toggleInlineWrap(doc('[**bold**]'), INLINE_MARK.bold)
    expect(r.text).toBe('bold')
  })

  it('斜体用 _ ，不与粗体的 ** 冲突', () => {
    const r = toggleInlineWrap(doc('[重点]'), INLINE_MARK.italic)
    expect(r.text).toBe('_重点_')
    expect(INLINE_MARK.italic).toBe('_')
  })

  it('删除线与行内代码', () => {
    expect(toggleInlineWrap(doc('[x]'), INLINE_MARK.strike).text).toBe('~~x~~')
    expect(toggleInlineWrap(doc('[x]'), INLINE_MARK.code).text).toBe('`x`')
  })
})

describe('块级样式', () => {
  it('正文 → 标题 2', () => {
    const r = setBlockStyle(doc('[标题]'), 'h2')
    expect(r.text).toBe('## 标题')
  })

  it('已是该样式 → 反向清回正文（二段式开关）', () => {
    expect(setBlockStyle(doc('## [标题]'), 'h2').text).toBe('标题')
    expect(setBlockStyle(doc('[- 列表]'), 'ul').text).toBe('列表')
    expect(setBlockStyle(doc('[> 引用]'), 'quote').text).toBe('引用')
  })

  it('多级标题之间直接切换而不是先清空', () => {
    expect(setBlockStyle(doc('[## 标题]'), 'h3').text).toBe('### 标题')
  })

  it('多行一起改，并保留缩进', () => {
    const r = setBlockStyle(doc('[a\nb\n  c]'), 'ul')
    expect(r.text).toBe('- a\n- b\n  - c')
  })

  it('有序列表重新编号 1..n', () => {
    expect(setBlockStyle(doc('[a\nb\nc]'), 'ol').text).toBe('1. a\n2. b\n3. c')
  })

  it('任务列表', () => {
    expect(setBlockStyle(doc('[a]'), 'task').text).toBe('- [ ] a')
  })

  it('正文样式只剥标记，不参与开关', () => {
    expect(setBlockStyle(doc('[## 标题]'), 'p').text).toBe('标题')
  })

  it('代码块：未包裹则加围栏，光标落正文首位', () => {
    const r = setBlockStyle(doc('[code]'), 'code')
    expect(r.text).toBe('```\ncode\n```')
    expect(r.text.slice(r.from, r.to)).toBe('code')
  })

  it('代码块：整块被围栏包住则脱掉', () => {
    const r = toggleFence(doc('[```\ncode\n```]'))
    expect(r.text).toBe('code')
  })
})

describe('插入：链接 / 图片 / 表格 / 分割线', () => {
  it('选区作为链接文字', () => {
    const r = insertLink(doc('[点这里]'), 'https://a.b')
    expect(r.text).toBe('[点这里](https://a.b)')
  })

  it('空选区时用 url 兜底，并选中文字部分便于改写', () => {
    const r = insertLink(doc('|'), 'https://a.b')
    expect(r.text).toBe('[https://a.b](https://a.b)')
    expect(r.text.slice(r.from, r.to)).toBe('https://a.b')
  })

  it('url 为空则原样返回，不误删选区', () => {
    const s = doc('[重要文字]')
    expect(insertLink(s, '')).toEqual(s)
    expect(insertImage(s, '   ')).toEqual(s)
  })

  it('图片用选区作 alt', () => {
    expect(insertImage(doc('[示意图]'), 'https://a.b/p.png').text).toBe('![示意图](https://a.b/p.png)')
  })

  it('表格：表头 + 分隔行 + n 行数据，列数一致', () => {
    const r = insertTable(doc('|'), 2, 3, '列')
    const lines = r.text.split('\n')
    expect(lines).toHaveLength(4) // 表头 + 分隔行 + 2 行数据
    expect(lines[0]).toBe('| 列1 | 列2 | 列3 |')
    expect(lines[1]).toBe('| --- | --- | --- |')
    expect(lines[2]).toBe('|   |   |   |')
    expect(lines[3]).toBe('|   |   |   |')
  })

  it('表格行列数越界会被夹到合法区间', () => {
    expect(insertTable(doc('|'), 0, 0, 'C').text.split('\n')).toHaveLength(3)
    expect(insertTable(doc('|'), 99, 99, 'C').text.split('\n')[0]!.split('|')).toHaveLength(14)
  })

  it('插入块会自动补空行，不粘住上下文', () => {
    expect(insertHr(doc('上文|')).text).toBe('上文\n\n---')
    expect(insertHr(doc('|下文')).text).toBe('---\n\n下文')
    expect(insertHr(doc('上|下')).text).toBe('上\n\n---\n\n下')
  })
})

describe('内联 HTML 样式（颜色 / 字体 / 高亮）', () => {
  const RED = 'color: #FF3B30'
  const KAI = "font-family: 'Kaiti SC', serif"

  it('CSS 合并：后设置的属性覆盖同名项，其余保留', () => {
    expect(mergeStyle(RED, 'color: #007AFF')).toBe('color: #007AFF')
    expect(mergeStyle(RED, KAI)).toBe(`${RED}; ${KAI}`)
  })

  it('CSS 剔除：只去掉指定属性', () => {
    expect(removeStyle(`${RED}; ${KAI}`, 'color: x')).toBe(KAI)
    expect(removeStyle(RED, 'color: x')).toBe('')
  })

  it('给选区上色', () => {
    const r = applyInlineStyle(doc('[红色]'), RED)
    expect(r.text).toBe(`<span style="${RED}">红色</span>`)
    expect(r.text.slice(r.from, r.to)).toBe('红色')
  })

  it('空选区时自动扩展到光标下的词（以空格分词）', () => {
    const r = applyInlineStyle(doc('hello |world'), RED)
    expect(r.text).toBe(`hello <span style="${RED}">world</span>`)
  })

  it('中文无空格，会一直扩到标点为止（已知取舍）', () => {
    const r = applyInlineStyle(doc('重点在|这里'), RED)
    expect(r.text).toBe(`<span style="${RED}">重点在这里</span>`)
  })

  it('颜色 + 字体合并进同一个 span，不层层嵌套', () => {
    const one = applyInlineStyle(doc('[文本]'), RED)
    const two = applyInlineStyle(one, KAI)
    expect(two.text.match(/<span/g)).toHaveLength(1)
    expect(two.text).toBe(`<span style="${RED}; ${KAI}">文本</span>`)
  })

  it('再次点同一颜色 → 取消该颜色', () => {
    const one = applyInlineStyle(doc('[文本]'), RED)
    const two = applyInlineStyle(one, RED)
    expect(two.text).toBe('文本')
  })

  it('清除颜色时保留字体（只删目标属性）', () => {
    const one = applyInlineStyle(doc('[文本]'), RED)
    const two = applyInlineStyle(one, KAI)
    const three = clearInlineStyle(two, 'color')
    expect(three.text).toBe(`<span style="${KAI}">文本</span>`)
    // 再把字体也清掉 → span 整个消失
    expect(clearInlineStyle(three, 'font-family').text).toBe('文本')
  })

  it('没有 span 时清除是安全的空操作', () => {
    const s = doc('[纯文本]')
    expect(clearInlineStyle(s, 'color')).toEqual(s)
  })

  it('空样式串不产生任何改动', () => {
    const s = doc('[文本]')
    expect(applyInlineStyle(s, '')).toEqual(s)
    expect(applyInlineStyle(s, ';;;')).toEqual(s)
  })
})
