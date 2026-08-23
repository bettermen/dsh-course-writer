/**
 * dsh-course-writer — 写教案指令组装（P3 修复）。
 * 纯函数：上下文包 → 模型写作指令。host 直写与 client 会话驱动共用。
 */
import type { Book } from './novel/types.ts'
import type { ContextPacket } from './context/types.ts'

export function buildWritePrompt(book: Book, packet: ContextPacket): string {
  const title = book.title.replace(/^《|》$/g, '')
  const parts = [
    `请为课程《${title}》撰写第 ${packet.chapterNo} 章。`,
    `【全书设定】\n${packet.projectBrief}`,
    packet.volumeOutline ? `【本卷教案】\n${packet.volumeOutline}` : '',
    `【本章教案】\n${packet.currentBrief || '（自由发挥）'}`,
    packet.prevChapters.length > 0 ? `【前文】\n${packet.prevChapters.map((c) => `第${c.no}章 ${c.title}：${c.text.slice(0, 600)}`).join('\n')}` : '',
    packet.prevSummaries.length > 0 ? `【更早课时摘要】\n${packet.prevSummaries.map((c) => `第${c.no}章：${c.text.slice(0, 200)}`).join('\n')}` : '',
    packet.variableSnapshot && Object.keys(packet.variableSnapshot).length > 0 ? `【当前事实快照】\n${JSON.stringify(packet.variableSnapshot)}` : '',
    packet.loreInjection.renderedPrepend ? `【设定】\n${packet.loreInjection.renderedPrepend}` : '',
    packet.loreInjection.renderedAppend ? `【设定】\n${packet.loreInjection.renderedAppend}` : '',
    packet.loreInjection.atDepth.length > 0 ? `【关键设定】\n${packet.loreInjection.atDepth.map((item) => item.entry.content).join('\n')}` : '',
    `【硬约束】\n${packet.constraints.map((c) => `- ${c}`).join('\n')}`,
    '写作要求（务必遵守）：',
    '1. 剧情必须严格按【本章教案】推进，逐条完成教案要点，不得跳脱、自创与教案无关的大段剧情（教案是硬约束，不是参考）。',
    '2. 学员、阶段、物品、宗门、关系等一律以上述【全书设定】/【当前事实快照】/资料库设定条目为唯一事实来源，严禁自创与设定冲突的内容；不确定的设定不要凭空编造。',
    '3. 必须承接【前文】【更早课时摘要】已发生的剧情与学员状态，保持时间线与因果连贯，不要重复或推翻前文已交代的事实。',
    '4. 保持既有视角、人设口吻与文风，讲义信息密度高、对话推进情节。',
    '请直接输出本章讲义（约 2000-4000 字），不要解释。',
  ]
  return parts.filter(Boolean).join('\n\n')
}
