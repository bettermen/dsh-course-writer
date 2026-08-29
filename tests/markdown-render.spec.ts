import { describe, expect, it } from 'vitest'
import {
  escapeHtml, renderInline, renderMarkdown, safeImageUrl, safeLinkUrl, sanitizeInlineStyle,
} from '../src/client/markdown-render.ts'

describe('块级语法', () => {
  it('标题 1~6', () => {
    expect(renderMarkdown('# 一级')).toBe('<h1>一级</h1>')
    expect(renderMarkdown('#### 四级')).toBe('<h4>四级</h4>')
  })

  it('围栏代码块保留语言标记，内容整体转义', () => {
    expect(renderMarkdown('```js\nconst a = 1 < 2\n```')).toBe(
      '<pre><code class="language-js">const a = 1 &lt; 2</code></pre>',
    )
  })

  it('分割线', () => {
    expect(renderMarkdown('---')).toBe('<hr>')
    expect(renderMarkdown('***')).toBe('<hr>')
  })

  it('引用块内继续解析块级语法', () => {
    expect(renderMarkdown('> 引用\n> 第二行')).toBe('<blockquote><p>引用<br>第二行</p></blockquote>')
  })

  it('无序 / 有序 / 任务列表', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('3. c\n4. d')).toBe('<ol start="3"><li>c</li><li>d</li></ol>')
    expect(renderMarkdown('- [x] 已完成')).toContain('<input type="checkbox" disabled checked>')
    expect(renderMarkdown('- [ ] 待办')).toContain('<input type="checkbox" disabled>')
  })

  it('表格含对齐信息', () => {
    const html = renderMarkdown('| 名称 | 课时 |\n| :--- | ---: |\n| 导入 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th style="text-align:left">名称</th>')
    expect(html).toContain('<th style="text-align:right">课时</th>')
    expect(html).toContain('<td style="text-align:right">2</td>')
  })

  it('表格紧跟段落时段落不被吞掉', () => {
    const html = renderMarkdown('上文\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<p>上文</p>')
    expect(html).toContain('<table>')
  })

  it('含竖线但不是表格的普通行照常渲染', () => {
    expect(renderMarkdown('速度 = 路程 | 时间')).toBe('<p>速度 = 路程 | 时间</p>')
  })
})

describe('行内语法', () => {
  it('粗体 / 斜体 / 删除线 / 行内代码', () => {
    expect(renderInline('**粗**')).toBe('<strong>粗</strong>')
    expect(renderInline('*斜*')).toBe('<em>斜</em>')
    expect(renderInline('_斜_')).toBe('<em>斜</em>')
    expect(renderInline('~~删~~')).toBe('<del>删</del>')
    expect(renderInline('`code`')).toBe('<code>code</code>')
  })

  it('_ 需要词边界，snake_case 不被拆', () => {
    expect(renderInline('user_name_here')).toBe('user_name_here')
    expect(renderInline('a _b_ c')).toBe('a <em>b</em> c')
  })

  it('行内代码里的 * 不会再被当成强调', () => {
    expect(renderInline('`a * b * c`')).toBe('<code>a * b * c</code>')
  })

  it('链接与图片', () => {
    expect(renderInline('[站点](https://a.b)')).toBe(
      '<a href="https://a.b" target="_blank" rel="noopener noreferrer">站点</a>',
    )
    expect(renderInline('![图](https://a.b/p.png)')).toBe('<img src="https://a.b/p.png" alt="图">')
  })

  it('高亮 ==文本==', () => {
    expect(renderInline('==重点==')).toBe('<mark>重点</mark>')
  })
})

describe('安全：不可信内容一律挡下', () => {
  it('HTML 标签整体转义', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;')
  })

  it('javascript: 伪协议链接降级为纯文字，页面上不留可疑地址', () => {
    const html = renderInline('[点我](javascript:alert(1))')
    expect(html).toBe('点我')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('javascript')
  })

  it('src 不合法的图片只留 alt 文字', () => {
    expect(renderInline('![图](javascript:alert(1))')).toBe('图')
  })

  it('链接 URL 白名单', () => {
    expect(safeLinkUrl('https://a.b/c')).toBe('https://a.b/c')
    expect(safeLinkUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeLinkUrl('#锚点')).toBe('#锚点')
    expect(safeLinkUrl('/相对/路径')).toBe('/相对/路径')
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(safeLinkUrl('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeLinkUrl('data:text/html,<script>')).toBeNull()
  })

  it('图片 URL 额外放行 base64 位图，但拒绝 svg（能带脚本）', () => {
    expect(safeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(safeImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(safeImageUrl('javascript:alert(1)')).toBeNull()
  })

  it('内联样式只放行白名单属性', () => {
    expect(sanitizeInlineStyle('color: #FF3B30')).toBe('color: #FF3B30')
    expect(sanitizeInlineStyle("font-family: 'Kaiti SC', serif")).toBe("font-family: 'Kaiti SC', serif")
    expect(sanitizeInlineStyle('color: url(javascript:alert(1))')).toBeNull()
    expect(sanitizeInlineStyle('color: red; position: fixed')).toBeNull()
    expect(sanitizeInlineStyle('background: url(http://evil/x)')).toBeNull()
    expect(sanitizeInlineStyle('')).toBeNull()
  })

  it('工具栏生成的 span 会被还原，属性里的危险写法保持转义', () => {
    expect(renderInline('<span style="color: #FF3B30">红</span>')).toBe('<span style="color: #FF3B30">红</span>')
    const bad = renderInline('<span style="color: url(x)">红</span>')
    expect(bad).not.toContain('<span')
    expect(bad).toContain('&lt;span')
  })
})
