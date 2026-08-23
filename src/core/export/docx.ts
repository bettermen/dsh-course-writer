/**
 * dsh-course-writer — Word(.docx) 导出生成器。
 * 零依赖：手写 OOXML（document.xml）+ 极简 ZIP 容器（store + deflate）。
 * 产物为标准 .docx，Word / WPS / Google Docs 均可打开，保留标题与章节层级。
 */
import { deflateRawSync } from 'node:zlib'

/** CRC32（查表法，兼容所有 Node 版本，不依赖 zlib.crc32）。 */
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry { name: string; data: Buffer }

/** 构建最小 ZIP（local header + central directory + EOCD）。 */
function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const comp = deflateRawSync(e.data)
    const crc = crc32(e.data)
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4)
    lfh.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    lfh.writeUInt16LE(8, 8) // deflate
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(comp.length, 18)
    lfh.writeUInt32LE(e.data.length, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    chunks.push(lfh, nameBuf, comp)

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(20, 4)
    cdh.writeUInt16LE(20, 6)
    cdh.writeUInt16LE(0x0800, 8)
    cdh.writeUInt16LE(8, 10)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(comp.length, 20)
    cdh.writeUInt32LE(e.data.length, 24)
    cdh.writeUInt16LE(nameBuf.length, 28)
    cdh.writeUInt32LE(offset, 42)
    central.push(cdh, nameBuf)
    offset += lfh.length + nameBuf.length + comp.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBuf, eocd])
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface ParaOpts { bold?: boolean; size?: number; center?: boolean; spaceBefore?: number }

function xmlPara(text: string, opts: ParaOpts = {}): string {
  const rPr = opts.bold || opts.size
    ? `<w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ''}</w:rPr>`
    : ''
  const pPr = opts.center || opts.spaceBefore
    ? `<w:pPr>${opts.center ? '<w:jc w:val="center"/>' : ''}${opts.spaceBefore ? `<w:spacing w:before="${opts.spaceBefore}"/>` : ''}</w:pPr>`
    : ''
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
}

export interface DocxChapter { no: number; title: string; content: string }

/** 生成 docx 二进制。标题用居中大字号，章节用加粗 Heading，正文按空行分段落。 */
export function buildDocx(title: string, chapters: DocxChapter[]): Buffer {
  const paras: string[] = [xmlPara(title, { bold: true, size: 48, center: true, spaceBefore: 0 })]
  for (const ch of chapters) {
    paras.push(xmlPara(`第 ${ch.no} 课 · ${ch.title}`, { bold: true, size: 32, spaceBefore: 360 }))
    for (const line of ch.content.split('\n')) {
      const t = line.trimEnd()
      if (t === '') continue
      paras.push(xmlPara(t))
    }
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ])
}
