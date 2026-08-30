# 虾说 · 项目管理 + 可编辑工作流 PRD（v0.8.0 规划稿）

> 状态：**待确认**（确认后才进入开发）
> 目标版本：v0.8.0
> 定位变更：虾说 = **创作者的 AI 辅助工具**，通过 AI 对话管理自己的全部创作（不只是课程）

---

## 一、产品定位

**一句话**：虾说是面向创作者（教师、公务员、网文作者、研究生、自媒体）的 AI 辅助创作工作台 —— 用对话驱动，用流程约束，用项目组织。

- **入口形态不变**：仍是 DSH 插件（侧边栏入口 → 全屏/半屏工作台）。
- **心智模型改变**：从「一个课程编写器」变成「我的创作项目仓库」。
- **AI 对话是主驱动**：GUI 负责"看得见、管得住"（项目、流程、正文），AI 负责"写得出"（各阶段产物）。二者通过同一套工作流状态机对齐。

---

## 二、核心概念模型

```
项目类型 Kind（课程 / 公文 / 小说 / 论文 / 自定义）
   └─ 默认工作流模板 WorkflowTemplate（随类型内置，只读，可"另存为"）
项目 Project（用户创建的具体作品）
   ├─ kind            → 归属类型
   ├─ status          → 项目状态
   ├─ workflow        → 项目私有工作流副本（创建时从模板拷贝，之后自由编辑）
   └─ content         → chapters/ + docs/（沿用现有存储）
工作流 Workflow = 有序阶段列表
   └─ 阶段 Phase：名称 / 描述 / 门禁类型 / 必交产物 / AI 提示词 / 状态
```

**关键决策：工作流采用「项目私有副本」而非「引用模板」**
- 创建项目时把模板深拷贝一份进项目 → 改 A 项目的流程不影响 B 项目，也不需要"模板改了要不要同步"的复杂语义。
- 项目保留 `templateId` 字段记录来源，支持「恢复默认」。
- 用户可把任意项目流程「另存为模板」，供后续新建项目复用。

---

## 三、需求 1：首页 = 项目管理

### 3.1 页面结构

```
┌──────────────────────────────────────────────────────────┐
│ 虾说   [🔍 搜索]  [类型▾] [状态▾] [排序▾]   [＋ 新建项目] │
├──────────────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │
│  │ 📘     │ │ 📄     │ │ 📖     │ │ 🎓     │            │
│  │ 初中物理│ │ 关于XX │ │ 青云   │ │ 边缘计算│            │
│  │ 课型   │ │ 的通知 │ │ 问道   │ │ 研究    │            │
│  │ 进行中 │ │ 草稿   │ │ 已暂停 │ │ 已完成 │            │
│  │ ▓▓▓░ 4/9│ │ ▓░░ 1/7│ │ ▓▓▓▓ 5/9││ ▓▓▓▓▓▓ 8/8│         │
│  │ 2.1万字 │ │ 860字  │ │ 12万字 │ │ 3.4万字 │            │
│  │ 2小时前 │ │ 昨天   │ │ 上周   │ │ 8月20日 │            │
│  └────────┘ └────────┘ └────────┘ └────────┘            │
└──────────────────────────────────────────────────────────┘
```

### 3.2 功能清单

| # | 功能 | 说明 |
|---|---|---|
| F1 | 项目列表 | 卡片视图 / 列表视图切换；卡片含：类型图标、标题、类型徽章、状态徽章、进度条（已完成阶段/总阶段）、字数、更新时间 |
| F2 | 新建项目 | 弹窗：名称、类型（图标选择卡）、题材/子类（按类型联动）、简介（可选）、工作流模板（默认该类型内置模板，可下拉换成自定义模板） |
| F3 | 编辑项目 | 重命名、改简介、改类型**（仅草稿期允许，已有内容时二次确认）**、改题材、改状态 |
| F4 | 删除项目 | 二次确认弹窗，提供「同时删除稿件 / 保留稿件」二选一（沿用现有 `keepChapters` 语义） |
| F5 | 项目状态 | `draft` 草稿 / `in_progress` 进行中 / `paused` 已暂停 / `done` 已完成 / `archived` 已归档。状态与流程进度**解耦**：状态手动或由阶段推进联动（首个阶段 committed → 自动 in_progress；终态阶段 approved → 自动 done） |
| F6 | 筛选 | 按类型、按状态、关键词搜索（标题+简介） |
| F7 | 排序 | 更新时间 / 创建时间 / 名称 / 进度 |
| F8 | 更多操作 | 复制项目（含流程与内容）、导出、分享（沿用现有能力）、打开工作台 |
| F9 | 空态引导 | 无项目时展示引导卡 + 「一键创建示例项目」（现有 `/demo` 路由扩展为按类型给示例） |
| F10 | 进入工作台 | 点击卡片 → 三栏工作台，顶部面包屑可返回首页 |

### 3.3 内置项目类型（Kind）

| id | 名称 | 英文 | 图标 | 默认题材（genre） |
|---|---|---|---|---|
| `course` | 课程 | Course | 📘 | 沿用现有 23 个学科（数学/语文/编程…） |
| `official` | 公文 | Official | 📄 | 通知 / 请示 / 报告 / 函 / 纪要 / 讲话稿 / 工作总结 |
| `novel` | 小说 | Novel | 📖 | 玄幻 / 都市 / 悬疑 / 科幻 / 历史 / 言情 / 游戏 / 轻小说 |
| `thesis` | 论文 | Thesis | 🎓 | 工学 / 理学 / 社科 / 医学 / 经管 / 文学 |
| `custom` | 自定义 | Custom | ✨ | 用户自建类型（存 `kinds.json`） |

> 设计说明：现有 `genre` 字段是"学科/题材"，本方案**新增 `kind` 作为顶层类型**，`genre` 降级为类型下的子类。旧项目 `genre` 值全部保留，迁移时统一置 `kind='course'`。
> **类型可增删**：内置 4 种不可删但可隐藏；用户可新建自定义类型（名称 + 图标 + 题材列表 + 初始流程）。

---

## 四、需求 2：每个类型有自己的工作流，且可自由编辑

### 4.1 数据模型

```ts
/** 阶段门禁类型 */
type PhaseGate =
  | 'none'        // 无门禁，可直接推进
  | 'manual'      // 手动确认（用户/AI 显式 commit）—— 默认
  | 'checklist'   // 清单校验：必交产物齐全才放行
  | 'ai'          // AI 评审：按 rubric 打分，errorCount>0 挂起 review

/** 必交产物类型 */
type ArtifactKind = 'doc' | 'chapter' | 'lorebook' | 'wordcount' | 'custom'

interface WorkflowPhase {
  id: string              // 稳定 id（slug 或 nanoid），不再用联合类型枚举
  name: string            // 阶段名（用户可改）
  description?: string    // 阶段说明（给 AI 看）
  gate: PhaseGate
  artifacts: Array<{ kind: ArtifactKind; label: string; min?: number }>
  prompt?: string         // 该阶段的 AI 执行提示词（给 Agent 用）
  rubric?: string         // AI 评审标准（gate='ai' 时用）
  optional?: boolean      // 可跳过
}

interface Workflow {
  id: string
  name: string
  kind: string            // 归属类型
  scope: 'builtin' | 'user' | 'project'   // 内置模板 / 用户模板 / 项目实例
  templateId?: string     // 来源模板
  phases: WorkflowPhase[]
  schemaVersion: number
}
```

### 4.2 内置流程模板

| 类型 | 阶段数 | 流程 |
|---|---|---|
| **课程 course** | 9 | 选题 → 学情设定 → 教学目标 → 课程大纲 → 单元设计 → 课时教案 → 课件与练习 → 评估修订 → 结课<br>（= 现有九阶段，`topic…done` 的 id 原样保留，保证老项目零迁移） |
| **公文 official** | 7 | 需求确认 → 材料收集 → 提纲拟定 → 初稿撰写 → 合规校核 → 审稿签发 → 成文归档 |
| **小说 novel** | 9 | 选题 → 核心设定 → 人设 → 全书大纲 → 分卷 → 分章细纲 → 正文写作 → 修订润色 → 完结 |
| **论文 thesis** | 8 | 选题立项 → 文献综述 → 研究设计 → 论文提纲 → 正文撰写 → 数据分析 → 查重与规范 → 定稿答辩 |

### 4.3 流程编辑器（Workflow Editor）

**入口**：工作台左栏「流程」标签页右上角「编辑」按钮 → 进入编辑态（也可在项目卡片的更多菜单里进）。

**编辑能力（自由修改）**：

| 操作 | 交互 |
|---|---|
| 新增阶段 | 底部「＋ 添加阶段」，或阶段卡片上的 `+` 插入到指定位置 |
| 删除阶段 | 卡片右键 / 悬停删除按钮 → 二次确认（若该阶段已有产物，提示"产物将保留在 docs/ 中"） |
| 重命名 | 双击名称 inline 编辑 |
| 排序 | 拖拽（沿用现有章节拖拽的实现与视觉反馈） |
| 配置 | 点击卡片 → 右侧属性面板：名称 / 描述 / 门禁类型 / 必交产物清单 / AI 提示词 / 评审标准 / 可跳过 |
| 恢复默认 | 「恢复为类型默认流程」（对比确认：将丢失 N 项自定义） |
| 另存为模板 | 输入模板名 → 存入用户模板库，之后新建项目可选 |
| 模板管理 | 独立弹窗：列出内置 + 用户模板，用户模板可重命名/删除/编辑 |

**约束（防呆）**：
1. 至少保留 1 个阶段。
2. 已有 `approved` 产物的阶段删除时强提示。
3. 当前所处阶段被删除 → 自动落到相邻阶段。
4. 阶段 id 一旦生成不再复用（删除后新增用新 id），避免产物目录串味。

### 4.4 AI 侧如何消费动态流程

- 现有技能 `course-writing-workflow` 里写死的九阶段描述 → **改为"先调用 `course_workflow` 读取当前项目的真实流程，再按其推进"**。
- 技能正文保留"通用创作纪律"（资料库沉淀、禁止口头跳阶段、提交前自检、去 AI 味），流程部分动态注入。
- 各类型独有纪律（公文格式 GB/T 9704、论文引用规范、小说人设一致性）作为**模板的 phase prompt / rubric** 内置在模板 JSON 里，随流程一起下发。

---

## 五、数据模型与迁移

### 5.1 项目实体（book.json，schemaVersion 1 → 2）

```ts
interface Project {
  id: string
  title: string
  kind: string                 // 【新增】默认 'course'
  genre: string                // 【保留】学科/题材
  description?: string         // 【新增】
  status: ProjectStatus        // 【扩展】draft | in_progress | paused | done | archived
  config: BookConfig           // 【保留】
  workflowId: string           // 【新增】指向 <id>/workflow.json
  templateId?: string          // 【新增】来源模板
  phases: Record<string, PhaseRecord>   // 【变更】key 从 PhaseId 联合类型放宽为 string
  currentPhase: string                  // 【变更】同上
  stats: { totalWords, chapterCount, phaseDone, phaseTotal, lastWriteAt? }  // 【扩展】
  createdAt: string
  updatedAt: string
  schemaVersion: 2
}
```

### 5.2 迁移策略（幂等 + 惰性升级）

读取 `book.json` 时若 `schemaVersion < 2`，在**内存**中补齐：
- `kind = 'course'`
- `status`：`drafting → in_progress`、`finished → done`、`abandoned → archived`
- `workflowId` 缺失 → 用内置 course 模板生成 `<id>/workflow.json` 并写回
- `stats.phaseDone/phaseTotal` 由 `phases` 计算
- `genre`、`chapters/`、`docs/`、`lorebook` **零改动**
- 升级结果在下一次写盘时落盘（`atomicWriteFile` + VersionedFile）

### 5.3 存储布局

```
~/.dsh/xiashuo/
  index.json                        # 【新增】项目索引缓存（列表页秒开，损坏可重建）
  kinds.json                        # 【新增】用户自定义类型
  templates/
    workflows/builtin/*.json        # 【新增】内置模板（打包在 assets，运行时只读）
    workflows/user/<id>.json        # 【新增】用户模板
  <projectId>/
    book.json                       # 【升级】schemaVersion 2
    workflow.json                   # 【新增】项目私有工作流副本
    chapters/ch<no>.md              # 【保留】
    docs/<phase>.md                 # 【保留】（目录名由阶段 id 决定）
    audit.jsonl                     # 【保留】
```

### 5.4 类型系统改造（关键风险点）

现有 `PhaseId` 是 9 个字面量的联合类型，被 `workflow/engine.ts`、`novel/types.ts`、`tools/*`、`client/*` 广泛引用。

**方案**：`export type PhaseId = string`
- 现有代码**全部免改可编译**（字符串字面量自动兼容）；
- `DEFAULT_PHASE_ORDER`（旧九阶段）保留为"内置 course 模板的默认顺序"，仅用于创建该项目类型的初始流程与老项目迁移；
- 引擎的 `canEnter / nextPhaseOf` 改为**接收 `phases: string[]` 顺序数组**的纯函数，顺序从项目 workflow 读取，不再依赖模块级常量。

---

## 六、API 设计（全部挂在 `/api/xiashuo` 下，沿用 `x-xiashuo: 1` 围栏）

### 项目管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/kinds` | 项目类型清单（内置 + 自定义），含图标、题材列表、默认流程摘要 |
| POST | `/kinds` | 新建自定义类型 |
| PATCH / DELETE | `/kinds/<id>` | 编辑/删除自定义类型（内置类型拒绝删除） |
| GET | `/projects?kind=&status=&q=&sort=` | 项目列表（返回含 status、进度、类型） |
| POST | `/projects` | 新建（title, kind, genre?, description?, templateId?） |
| GET | `/projects/<id>` | 项目详情（与列表同构，供编辑弹窗回填） |
| PATCH | `/projects/<id>` | 编辑（title/description/status/kind/genre） |
| DELETE | `/projects/<id>?keepFiles=1` | 删除 —— **用 DELETE 而非 PRD 原稿的 `POST /delete`**，与 REST 语义一致 |
| POST | `/projects/<id>/duplicate` | 复制项目 |
| POST | `/projects/<id>/archive` | 归档 / 取消归档（快捷动作） |
| POST | `/import` | 导入 txt/md —— **新增 `kind` 入参**（决定题材口径与初始流程） |

### 工作流

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/<id>/workflow` | 读项目流程 |
| PUT | `/projects/<id>/workflow` | 整体保存（编辑器保存按钮） |
| POST | `/projects/<id>/workflow/reset` | 恢复类型默认 |
| POST | `/projects/<id>/workflow/phases` | 新增阶段（body 支持 `index` 指定插入位置） |
| POST | `/projects/<id>/workflow/phases/reorder` | 拖拽排序 |
| POST | `/projects/<id>/workflow/phases/<pid>/rename\|update\|delete` | 阶段改名 / 改属性 / 删除（最后一个阶段拒绝） |
| GET | `/workflows?kind=&scope=` | 模板列表（内置 + 用户） |
| POST | `/workflows` | 另存为模板（body: `{ projectId, name }` 或完整 workflow） |
| GET / PATCH / DELETE | `/workflows/<id>` | 模板读/改/删（内置只读） |

> 阶段级接口**独立于** `PUT /workflow` 之外，是为了让前端做单步编辑（拖拽、改名各走各的），
> 避免每次都整体 PUT 带来的写放大与并发覆盖。

### 现有路由保持不变

`/lorebook/*`、`/projects/<id>/chapters/*`、`/export`、`/share/*`、`/demo` 全部沿用，**只扩展不破坏**。

> **一处行为变更**：`/import` 现在接受 `kind`，题材按类型口径解析 —— 同一个「科幻」，
> 小说类型 → `kehuan`，课程类型 → `general`。不传 `kind` 时行为与旧版完全一致，向后兼容。

---

## 七、Agent 工具改造

| 工具 | 变更 |
|---|---|
| `course_create_project` | 新增 `kind` 参数（默认 `course`）、`description`、`templateId` |
| `course_projects` | 返回字段增加 `kind`、`status`、`phaseDone/phaseTotal`、支持按 kind/status 过滤 |
| `course_phase` | 阶段参数放宽为任意字符串，校验改为"是否存在于当前项目流程" |
| `course_commit` | 同上；产物目录按动态阶段 id |
| **新增** `course_workflow` | action: `get` / `set` / `add` / `remove` / `rename` / `reorder` / `reset` —— **AI 也能改流程**（用户说"帮我加一个'同行评议'阶段"，AI 直接改） |
| **新增** `course_project_update` | 改标题/简介/状态/类型 |
| **新增** `course_project_delete` | 删项目（带 keepFiles） |
| 其余 `course_*` | 保持不变，向后兼容 |

> 工具命名**继续使用 `course_*` 前缀**，不改成 `xiashuo_*`：避免破坏已保存的 Agent 预设、技能引用与用户习惯。

---

## 八、技能（Skill）改造

- 现有 `assets/skills/course-writing-workflow/SKILL.md`：
  - 描述改为「虾说通用创作工作流 —— 按项目类型的流程推进」
  - 正文「九阶段流程」章节 → 改为「**流程以 `course_workflow` 返回的为准**」，并给出"读取流程 → 按序推进 → 提交产物"的通用动作序列
  - 保留通用纪律：资料库沉淀、禁止口头跳阶段、提交前自检、去 AI 味、变量/账本维护
- 类型特有纪律（公文格式、论文引用、小说人设）下放到**模板的 phase prompt / rubric**，随流程动态下发，不再写死在技能里。

---

## 九、国际化

- `src/client/i18n.ts` 新增键（zh + en 同步）：首页、项目卡片、状态徽章、类型名、流程编辑器、模板管理、确认弹窗。
- 内置类型名与阶段名**存 i18n key + 中文回退**：模板 JSON 里存 `name`（中文）与可选 `nameEn`，客户端按当前语言取。
- 用户自定义的阶段名/类型名原样展示（不做翻译）。

---

## 十、UI / 视觉

- **沿用现有 Apple HIG 设计系统**（`src/client/apple-ui.ts` 的 CSS 变量令牌 + 毛玻璃 + 浅色/深色双模式），不另起炉灶。
- 首页卡片：圆角 14px、1px 分隔线、hover 微抬升、状态徽章用色遵循系统色（进行中=蓝、完成=绿、暂停=橙、归档=灰）。
- 类型图标：emoji 优先（零资源成本），与现有「不用付费生图」的约定一致。
- 流程编辑器：复用章节列表的拖拽反馈、右键菜单（`context-menu.tsx`）、inline 编辑交互，保持手感统一。

---

## 十一、交付计划（分阶段，每阶段独立闭环）

> 遵循 AGENTS.md 纪律：每模块 → 单测 → `npm run typecheck && npm test` → 登记 `docs/MODULE-LOG.md` → 再进下一个。

| 阶段 | 内容 | 产出 | 验收 |
|---|---|---|---|
| **P0 领域模型** | `core/kinds.ts`（类型注册表 + 题材联动）、`core/workflow/schema.ts`（PhaseGate/WorkflowPhase/Workflow）、4 套内置模板 JSON、内置模板加载器 | 可单测的纯常量 + 纯函数 | 单测：模板完整性（每类型 ≥1 阶段、id 唯一、内置只读）、类型→题材映射 |
| **P1 工作流动态化**（已完成） | `PhaseId → string`、`DEFAULT_PHASE_ORDER` 降级为默认模板、引擎 `canEnter/nextPhaseOf` 改为接收顺序数组、项目 `workflow.json` 读写 + 惰性迁移 | `core/workflow/engine.ts` + `core/workflow/store.ts` | 单测：动态顺序下的门禁/推进/回退全绿；老项目迁移幂等 |
| **P2 项目模型升级**（部分完成 ⚠️） | `Project` 新增 kind/status/description/stats，`book.json` schemaVersion 2 迁移，项目索引 `index.json` | `core/novel/*` + `core/project/*` | 单测：v1→v2 迁移、索引重建、状态映射 |
| **P3 后端 API**（✅ 已完成） | `/kinds`、`/projects` CRUD + 筛选排序、`/projects/<id>/workflow`、`/workflows` 模板 CRUD | `src/routes.ts` | 单测：routes.spec 覆盖新路由；旧路由回归全绿 |

> **P2 的取舍（需确认）**：P2 原稿的 `schemaVersion 2 迁移` 与 `index.json 索引` 属于**纯性能/整洁度优化**，
> 尚未启动；但首页卡片必需的 `status`（五态 + 旧三态惰性归一）与 `description` 已随 P3 一并落地 ——
> 因为 API 层要返回这两个字段，先做模型才谈得上接口。
> 现状：`status` 走**读时归一**（老 `book.json` 零重写，见 `core/novel/status.ts`），
> `index.json` 仍缺（列表每次遍历 `projects/` 全目录，项目数上百后再补不迟）。
| **P4 首页 UI**（✅ 已完成） | 项目网格/列表、卡片、搜索筛选排序、新建/编辑/删除弹窗、空态、面包屑 | `src/client/home.tsx` + `api.ts` + `format.ts` + 布局路由切换 | typecheck + 手动冒烟（本机 DSH） |
| **P5 流程编辑器 UI**（✅ 已完成） | 阶段拖拽排序、增删改名、属性面板、恢复默认、另存为模板、模板管理 | `src/client/workflow-editor.tsx` + `api.ts` 扩展 + 工作台左栏三视图接线 | typecheck + build + 单测（client-api +27 例）+ 手动冒烟 |
| **P6 Agent 侧** | `course_workflow` / `course_project_update` / `course_project_delete` 工具、`course_create_project` 扩参、SKILL.md 改造 | `src/tools/*` + `assets/skills/*` | 单测 + 对话实测（"帮我加一个阶段"） |
| **P7 收尾** | i18n 补全（zh/en）、README 更新、版本号 0.8.0、构建 + 同步本机 DSH + 打 tag | — | `npm run verify` 全绿 |

**风险与对策**

| 风险 | 对策 |
|---|---|
| `PhaseId` 放宽为 string 后，类型检查变弱 | 关键入口（工具参数、路由参数）增加运行时校验；单测覆盖"未知阶段"分支 |
| 老数据迁移出错 | 惰性升级 + 写盘前备份；迁移失败不阻断启动，回退为只读模式并提示 |
| 首页改动面大，可能回归 | 首页作为**独立视图组件**挂载，工作台代码零改动；通过视图开关切换 |
| 全量 vitest 在本机 OOM（exit 137） | 沿用现有做法：按文件分批 `vitest run <files> --pool=forks --maxWorkers=1` |

---

## 十二、已确认决策（2026-08-29，用户拍板）

| # | 议题 | 结论 |
|---|---|---|
| 1 | 内置类型范围 | **4 种**：课程 / 公文 / 小说 / 论文（不加文案、报告、剧本） |
| 2 | 自定义类型 | **开放**：用户可自建类型（名称 + 图标 + 题材列表 + 初始流程），存 `kinds.json` |
| 3 | 流程编辑器位置 | **工作台左栏「流程」页**（左栏变为 章节 / 阶段 / 流程 三视图，编辑时右侧正文可见） |
| 4 | 交付节奏 | **分阶段**：先 P0→P2 跑通模型层并验收，再继续 P3→P7 |

**由此产生的调整**

- 左栏 tab 由 `'chapters' | 'phases'` 扩展为 `'chapters' | 'phases' | 'workflow'`。
- 内置工作流模板**用 TS 常量定义**（`src/core/workflow/templates.ts`），不读 JSON 文件 —— 避免打包后 assets 路径问题，且零 IO 可单测；只有**用户模板**用 JSON 落盘。
- 自定义类型需要 `KindRegistry`：内置 4 种（不可删）+ 用户类型（可增删改），主题材列表按类型联动。
