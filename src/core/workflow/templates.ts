/**
 * xiashuo — 内置工作流模板（P0）。
 *
 * 用 TS 常量而非 JSON 文件：避免打包后 assets 路径问题，且零 IO、可直接单测。
 * 四个内置类型各一套：课程 9 阶段 / 公文 7 阶段 / 小说 9 阶段 / 论文 8 阶段；
 * 另有「自定义类型」起步用的 5 阶段通用模板。
 *
 * 课程模板的阶段 id 刻意沿用旧九阶段（topic…done），保证老项目零迁移。
 */

import type { Workflow, WorkflowPhase } from './schema.ts'
import { WORKFLOW_SCHEMA_VERSION } from './schema.ts'

function phase(
  id: string,
  name: string,
  nameEn: string,
  description: string,
  gate: WorkflowPhase['gate'] = 'manual',
  extra: Partial<WorkflowPhase> = {},
): WorkflowPhase {
  return { id, name, nameEn, description, gate, artifacts: [], ...extra }
}

const doc = (label: string) => [{ kind: 'doc' as const, label }]

// ─────────────────────────── 课程 course（9 阶段） ───────────────────────────

export const COURSE_TEMPLATE: Workflow = {
  id: 'builtin-course',
  name: '课程编写标准流程',
  nameEn: 'Standard course-authoring workflow',
  kind: 'course',
  scope: 'builtin',
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  phases: [
    phase('topic', '选题', 'Topic', '确定课程主题、授课对象与课时总量，明确"为什么开这门课"。', 'manual', {
      artifacts: doc('选题说明'),
      prompt: '与用户确认：课程主题、授课对象（学段/基础）、总课时、预期产出。输出一页选题说明，含课程定位与学情假设。',
    }),
    phase('setting', '学情设定', 'Learner analysis', '分析授课对象的起点能力、常见误区与学习动机。', 'manual', {
      artifacts: doc('学情分析'),
      prompt: '基于选题输出学情分析：起点能力、已有知识、常见误区、学习动机、班级规模与教学条件约束。',
    }),
    phase('character', '教学目标', 'Objectives', '把课程目标拆解为可观测、可评量的具体条目。', 'manual', {
      artifacts: doc('教学目标清单'),
      prompt: '输出分层教学目标（知识与技能 / 过程与方法 / 情感态度价值观），每条配可观测的达成证据。',
    }),
    phase('outline', '课程大纲', 'Outline', '搭建课程整体骨架，规划单元划分与课时配比。', 'checklist', {
      artifacts: doc('课程大纲'),
      prompt: '输出课程大纲：单元划分、每单元课时数、单元目标、单元之间的递进关系、考核方式。',
      rubric: '目标可观测、单元递进合理、课时配比均衡、考核方式与目标对齐。',
    }),
    phase('volume', '单元设计', 'Unit design', '逐单元细化：核心问题、教学活动、资源与评价。', 'manual', {
      artifacts: doc('单元设计'),
      prompt: '为每个单元输出：核心问题、关键概念、教学活动序列、所需资源、形成性评价设计。',
    }),
    phase('chapter', '课时教案', 'Lesson plans', '撰写逐课时教案：目标、流程、时长、小结与练习。', 'manual', {
      artifacts: [{ kind: 'chapter', label: '课时教案', min: 1 }],
      prompt: '按课时撰写教案：本课目标、导入、讲解、活动、练习、小结、作业；标注每个环节的时长。',
    }),
    phase('writing', '课件与练习', 'Courseware', '产出配套课件、练习题与参考答案。', 'checklist', {
      artifacts: doc('课件与练习'),
      prompt: '为各课时配套课件要点、课堂练习、课后作业与参考答案；难度分层。',
      rubric: '练习覆盖全部教学目标、难度有梯度、答案完整。',
    }),
    phase('revision', '评估修订', 'Assessment', '评估课程达成度，修订不达标的单元与课时。', 'ai', {
      artifacts: doc('评估报告'),
      prompt: '对照教学目标逐条评估达成情况，列出不达标项与修订方案；检查知识点前后一致、术语统一。',
      rubric: '每条目标都有达成证据；发现的不一致项已给出具体修订动作。',
    }),
    phase('done', '结课', 'Closure', '归档成稿，输出课程总结与后续迭代建议。', 'none', {
      artifacts: doc('结课总结'),
      prompt: '汇总课程成稿，输出课程总结、资源清单与下一轮迭代建议。',
    }),
  ],
}

// ─────────────────────────── 公文 official（7 阶段） ───────────────────────────

export const OFFICIAL_TEMPLATE: Workflow = {
  id: 'builtin-official',
  name: '公文起草标准流程',
  nameEn: 'Standard official-document workflow',
  kind: 'official',
  scope: 'builtin',
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  phases: [
    phase('brief', '需求确认', 'Brief', '明确行文目的、文种、主送机关、紧急程度与保密要求。', 'manual', {
      artifacts: doc('行文要素表'),
      prompt: '与用户确认：行文目的、文种（通知/请示/报告/函/纪要等）、主送与抄送机关、紧急程度、保密要求、发文时限。',
    }),
    phase('research', '材料收集', 'Materials', '收集政策依据、数据支撑、前文惯例与相关背景材料。', 'checklist', {
      artifacts: [{ kind: 'lorebook', label: '政策依据条目', min: 1 }],
      prompt: '收集并核对：政策文件依据、数据出处、本单位既往同类文稿、相关业务背景。把关键依据沉淀为资料库条目。',
      rubric: '政策依据有明确出处；数据有来源与口径；引用不越权。',
    }),
    phase('outline', '提纲拟定', 'Outline', '拟定文稿结构与段落要点，报审结构后再动笔。', 'manual', {
      artifacts: doc('提纲'),
      prompt: '输出提纲：一文一事的结论先行、分点逻辑、每部分要点与预估篇幅。',
    }),
    phase('draft', '初稿撰写', 'Draft', '按提纲撰写初稿，遵循公文语体规范。', 'manual', {
      artifacts: doc('初稿'),
      prompt: '按提纲撰写初稿：语言庄重平实，用词准确，句式简短，避免口语化与修饰性表达。',
    }),
    phase('review', '合规校核', 'Compliance', '校核格式规范（GB/T 9704）、称谓、数字用法与标点。', 'ai', {
      artifacts: doc('校核意见'),
      prompt: '逐项校核：文种与格式是否合规、标题与正文是否一致、称谓与层级是否准确、数字与标点用法是否规范、有无错别字与病句。',
      rubric: '格式符合 GB/T 9704；称谓层级准确；数字、标点、计量单位规范；无错别字病句。',
    }),
    phase('approve', '审稿签发', 'Approval', '按权限送审，处理审核意见后定稿。', 'manual', {
      artifacts: doc('审核意见处理表'),
      prompt: '整理送审意见与处理情况，逐条说明采纳/未采纳理由，形成送审稿。',
    }),
    phase('done', '成文归档', 'Archive', '定稿归档，登记文号与分发范围。', 'none', {
      artifacts: doc('归档记录'),
      prompt: '输出最终文稿，登记文号、成文日期、分发范围与归档位置。',
    }),
  ],
}

// ─────────────────────────── 小说 novel（9 阶段） ───────────────────────────

export const NOVEL_TEMPLATE: Workflow = {
  id: 'builtin-novel',
  name: '小说创作标准流程',
  nameEn: 'Standard novel-writing workflow',
  kind: 'novel',
  scope: 'builtin',
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  phases: [
    phase('topic', '选题', 'Concept', '确定类型、卖点、篇幅与目标读者。', 'manual', {
      artifacts: doc('选题说明'),
      prompt: '与用户确认：题材类型、核心卖点、预计字数、目标读者、更新节奏。',
    }),
    phase('setting', '核心设定', 'Worldbuilding', '搭建世界观与力量/社会体系，划定"什么能写、什么不能写"。', 'checklist', {
      artifacts: [{ kind: 'lorebook', label: '世界观条目', min: 1 }],
      prompt: '输出世界观设定：时代背景、地理与势力、核心规则体系、力量/技术边界。把设定沉淀为资料库条目。',
      rubric: '规则自洽无内部矛盾；边界清晰可判定。',
    }),
    phase('character', '人设', 'Characters', '设计主要人物的欲望、缺陷、转变弧线与人物关系网。', 'checklist', {
      artifacts: [{ kind: 'lorebook', label: '人物卡', min: 1 }],
      prompt: '为每个主要人物输出：外在目标、内在欲望、致命缺陷、转变弧线、说话方式、与其他人物的关系。沉淀为人物卡条目。',
      rubric: '人物动机可信；人物之间有真实冲突；转变有铺垫。',
    }),
    phase('outline', '全书大纲', 'Outline', '规划起承转合与主线节拍。', 'manual', {
      artifacts: doc('全书大纲'),
      prompt: '输出全书大纲：开端、发展、转折、高潮、结局；关键节拍与字数配比。',
    }),
    phase('volume', '分卷', 'Volumes', '把大纲切分为卷，每卷一个完整的小高潮。', 'manual', {
      artifacts: doc('分卷规划'),
      prompt: '输出分卷规划：每卷的核心冲突、卷首钩子、卷尾高潮、卷内章节数。',
    }),
    phase('chapter', '分章细纲', 'Chapter beats', '逐章写细纲：场景、人物、冲突、转折、钩子。', 'manual', {
      artifacts: doc('分章细纲'),
      prompt: '逐章输出细纲：出场人物、场景、本章目标、冲突推进、章末钩子。',
    }),
    phase('writing', '正文写作', 'Drafting', '按细纲写正文，先完成再完美。', 'manual', {
      artifacts: [{ kind: 'chapter', label: '正文', min: 1 }, { kind: 'wordcount', label: '单章字数', min: 2000 }],
      prompt: '按细纲撰写正文。展示而非讲述，用具体动作与细节承载情绪，避免概括性叙述。',
    }),
    phase('revision', '修订润色', 'Revision', '修订结构问题，润色语言，去 AI 味。', 'ai', {
      artifacts: doc('修订记录'),
      prompt: '逐章修订：节奏拖沓处压缩、逻辑断裂处补因果、人设走形处修正；清除 AI 味高频表达（不禁/仿佛/综上所述/值得注意的是等）。',
      rubric: '无 AI 味高频词；情节因果闭合；人物言行符合设定；无重复句式。',
    }),
    phase('done', '完结', 'Complete', '收束全部伏笔，定稿归档。', 'none', {
      artifacts: doc('完结总结'),
      prompt: '检查所有伏笔是否回收，输出完结总结与后记。',
    }),
  ],
}

// ─────────────────────────── 论文 thesis（8 阶段） ───────────────────────────

export const THESIS_TEMPLATE: Workflow = {
  id: 'builtin-thesis',
  name: '论文写作标准流程',
  nameEn: 'Standard thesis-writing workflow',
  kind: 'thesis',
  scope: 'builtin',
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  phases: [
    phase('topic', '选题立项', 'Topic', '确定研究问题，论证研究意义与可行性。', 'manual', {
      artifacts: doc('选题依据'),
      prompt: '明确研究问题（一个可回答的具体问题），说明理论意义/实践价值、研究边界与可行性。',
    }),
    phase('literature', '文献综述', 'Literature review', '梳理已有研究，定位本文的贡献缺口。', 'checklist', {
      artifacts: [{ kind: 'lorebook', label: '文献条目', min: 1 }],
      prompt: '按主题脉络综述已有研究，标注争论焦点与研究空白，明确本文的增量贡献。把关键文献沉淀为资料库条目。',
      rubric: '覆盖近五年主要成果；有批判性评述而非罗列；明确指出研究空白。',
    }),
    phase('method', '研究设计', 'Method', '确定研究方法、数据来源与分析框架。', 'manual', {
      artifacts: doc('研究设计'),
      prompt: '说明研究方法选择理由、数据来源与采集方式、变量定义、分析框架、效度与局限。',
    }),
    phase('outline', '论文提纲', 'Outline', '拟定章节结构与论证链条，报导师确认。', 'manual', {
      artifacts: doc('论文提纲'),
      prompt: '输出论文提纲：章节结构、每章核心论点与支撑证据、章节之间的论证递进关系。',
    }),
    phase('draft', '正文撰写', 'Drafting', '按提纲撰写各章节初稿。', 'manual', {
      artifacts: [{ kind: 'chapter', label: '正文章节', min: 1 }],
      prompt: '逐章撰写：每章开头一句话点明论点，段段有据，先论据后结论，标注待补的引用与数据。',
    }),
    phase('analysis', '数据分析', 'Analysis', '完成实验/数据分析，产出图表与结果解读。', 'checklist', {
      artifacts: doc('分析结果'),
      prompt: '输出数据分析结果与图表，说明统计方法、显著性、稳健性检验，并对结果做实质性解读（而非复述数字）。',
      rubric: '方法与前文设计一致；结果可复现；解读与数据相符、不过度推论。',
    }),
    phase('revision', '查重与规范', 'Compliance', '查重、规范引用格式、统一术语与图表编号。', 'ai', {
      artifacts: doc('修改说明'),
      prompt: '检查：引用格式统一（GB/T 7714 或学校指定）、参考文献与正文一一对应、术语前后一致、图表编号连续、重复率达标。',
      rubric: '引用格式统一且无遗漏；术语一致；图表编号连续；无抄袭风险表述。',
    }),
    phase('done', '定稿答辩', 'Defense', '定稿、准备答辩材料与汇报提纲。', 'none', {
      artifacts: doc('答辩提纲'),
      prompt: '输出最终稿、答辩 PPT 提纲与可能被追问的问题清单及应答要点。',
    }),
  ],
}

// ─────────────────────────── 通用兜底（自定义类型起步） ───────────────────────────

export const GENERIC_TEMPLATE: Workflow = {
  id: 'builtin-generic',
  name: '通用创作流程',
  nameEn: 'Generic creative workflow',
  kind: 'custom',
  scope: 'builtin',
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  phases: [
    phase('topic', '选题', 'Concept', '确定主题与目标读者。', 'manual', { artifacts: doc('选题说明') }),
    phase('outline', '大纲', 'Outline', '拟定结构与要点。', 'manual', { artifacts: doc('大纲') }),
    phase('draft', '初稿', 'Draft', '撰写初稿。', 'manual', { artifacts: doc('初稿') }),
    phase('revision', '修订', 'Revision', '修订结构与语言。', 'ai', {
      artifacts: doc('修订记录'),
      rubric: '结构完整、逻辑通顺、无 AI 味高频表达。',
    }),
    phase('done', '完成', 'Done', '定稿归档。', 'none', { artifacts: doc('成稿') }),
  ],
}

/** 全部内置模板（顺序即类型展示顺序）。 */
export const BUILTIN_TEMPLATES: readonly Workflow[] = [
  COURSE_TEMPLATE,
  OFFICIAL_TEMPLATE,
  NOVEL_TEMPLATE,
  THESIS_TEMPLATE,
  GENERIC_TEMPLATE,
]

const TEMPLATE_BY_KIND = new Map(BUILTIN_TEMPLATES.map((tpl) => [tpl.kind, tpl]))
const TEMPLATE_BY_ID = new Map(BUILTIN_TEMPLATES.map((tpl) => [tpl.id, tpl]))

/** 取某个类型的内置默认模板（未知类型回退通用模板）。 */
export function builtinTemplateOf(kind: string): Workflow {
  return TEMPLATE_BY_KIND.get(kind) ?? GENERIC_TEMPLATE
}

/** 按 id 取内置模板（未命中返回 undefined）。 */
export function builtinTemplateById(id: string): Workflow | undefined {
  return TEMPLATE_BY_ID.get(id)
}

/** 是否为内置模板 id（内置模板只读，不可删改）。 */
export function isBuiltinTemplateId(id: string): boolean {
  return TEMPLATE_BY_ID.has(id)
}
