---
name: course-writing-workflow
description: 通用创作全流程（门禁式、工作流可编辑）。支持课程/公文/小说/论文与自定义类型，每种类型自带一套默认工作流（课程九阶段、公文七阶段、小说九阶段、论文八阶段），可用 course_workflow 工具增删改序。阶段推进必须走 course_* 工具，用 lorebook_* 管理资料库，模型不得口头跳阶段。 — General gated authoring workflow with an editable pipeline (course / official document / novel / thesis + custom kinds). Advance via course_* tools, edit the workflow via course_workflow, manage the lorebook via lorebook_*; never skip phases verbally.
whenToUse: 用户要求开始创作（课程/公文/小说/论文/自定义类型）、写教案、写公文、写小说、写论文、设定学情、生成大纲、设计目标、润色或诊断，或要求调整/查看某项目的流程（加阶段/删阶段/重排阶段）时。 — When the user asks to author a course/official document/novel/thesis, draft lesson plans, generate an outline, polish, or view/edit a project's workflow.
---

# 创作工作流（xiashuo）

本技能定义各类创作的**门禁式**标准流程。**阶段推进必须走工具，未 commit 不得自称完成。**

## 0. 项目类型（Kind）

`course_create_project { title, kind?, genre?, description? }` 创建项目，`kind` 决定默认工作流与题材口径：

| kind | 名称 | 默认工作流 | 典型题材 |
|---|---|---|---|
| `course` | 课程 | 九阶段（选题→学情→目标→大纲→单元→教案→课件→评估→结课） | 通识/人文/数理化/编程/设计/营销等 |
| `official` | 公文 | 七阶段（需求→材料→提纲→初稿→校核→签发→归档） | 通知/请示/报告/函/纪要/讲话稿 |
| `novel` | 小说 | 九阶段（选题→设定→人设→大纲→分卷→细纲→正文→修订→完结） | 玄幻/都市/悬疑/科幻/历史/言情 |
| `thesis` | 论文 | 八阶段（选题→文献→设计→提纲→正文→分析→规范→答辩） | 工学/理学/社科/医学/经管/文学 |

用户也可用自定义类型（`kind` 传自定义 id，或经首页自建）。**先问清类型**再建项目，避免用错流程。创建后可 `course_project_update { projectId, description }` 补简介。

## 1. 阶段推进（禁止跳阶段）

- 进入阶段：`course_phase { projectId, phase }`（前置阶段必须 approved/skipped，否则工具报 INVALID_STATE）。
- 提交产物：`course_commit { projectId, phase, artifact, errorCount }`——产物写入 docs/<phase>.md 与版本快照；errorCount>0 会挂起 review，需要修改后重新提交。
- 用户覆盖：`course_override { action: force|reopen|skip|rollback }`（force 放行、reopen 驳回、skip 跳过、rollback 在修订期回退）。
- 阶段名因类型而异：课程是「选题/学情设定/教学目标/…」，公文是「需求确认/材料收集/…」，小说是「选题/核心设定/人设/…」，论文是「选题立项/文献综述/…」。**以 `course_phase` / `course_workflow(action=list)` 返回的实际阶段 id 为准**，不要臆测。

## 2. 工作流可编辑（course_workflow）

项目的工作流不是死的，可用 `course_workflow` 查看与编辑：

- 查看：`course_workflow { projectId, action:'list' }` → 返回阶段有序列表 + 每阶段门禁/产物/提示词/评审标准。
- 加阶段：`course_workflow { projectId, action:'add', name, index?, gate? }`。
- 改名：`course_workflow { projectId, action:'rename', phaseId, name }`。
- 改属性：`course_workflow { projectId, action:'update', phaseId, name?/description?/gate?/prompt?/rubric?/optional? }`。
- 删除：`course_workflow { projectId, action:'delete', phaseId }`（最后一个阶段拒绝删除）。
- 排序：`course_workflow { projectId, action:'reorder', from, to }`（0 起下标）。
- 恢复默认：`course_workflow { projectId, action:'reset' }`。

门禁 `gate` 取值：`none` 无 / `manual` 手动确认（默认）/ `checklist` 清单校验 / `ai` AI 评审。编辑后推进流程仍按新顺序与新门禁执行。

## 3. 项目管理

- 列出项目：`course_projects`。
- 更新元信息：`course_project_update { projectId, title?/description?/genre?/status?/kind? }`（status：draft/in_progress/paused/done/archived；**改 kind 会重置工作流**）。
- 删除：`course_project_delete { projectId, keepChapters? }`（keepChapters=true 保留讲义文件）。
- 克隆：`course_clone_project { sourceId, title?, genre?, kind? }`（复制设定与已完成的阶段文档，讲义不复制）。
- 统计/状态：`course_stats { projectId }`、`course_audit { projectId }`。

## 4. 资料库（lorebook）纪律

- **动笔前必查**：写正文前先确认已绑定足够资料库条目（`lorebook_list_entries` 按 `book_id` 核对）。没有就**主动提醒用户先建**（核心概念/知识点/术语/案例/资源）。
- **知识点即时沉淀**：过程中出现的关键知识点、术语、定义、公式、案例——**立即 `lorebook_create_entry`** 并传 `book_id` 绑定当前项目，不要等用户要求。
- 条目按 `book_id` 隔离，每类创作各自的资料库集合。
- 核心概念/术语表建议 `always_active` 常驻；案例/延伸用关键词触发。
- 小说/论文的设定、文献条目同样沉淀为资料库条目（`lorebook` 产物）。

## 5. 正文编写协议（两段式）

1. `course_write_chapter { projectId, chapterNo, brief? }` → 返回上下文包（设定 + 前文 + 摘要/变量/资料库命中 + 硬约束）。
2. 在回复中直接输出本节正文（遵守 constraints：目标/结构/时长或字数/禁用词/小结）。
3. `course_commit_chapter { projectId, chapterNo, title, text, brief? }` → 落盘并自动统计字数与达标判定。
4. 需要维护课程级变量时，文末输出 `<JSONPatch>[{"op":"replace","path":"/stat_data/…","value":"…"}]</JSONPatch>`。

## 6. 质量自检（提交前）

- 一致性：知识点/术语/案例与账本、资料库一致，不冲突。
- 结构：本阶段完成目标；末了有小结与下一步引导。
- 文风：避免 AI 味表达（"不禁/仿佛/综上所述/值得注意的是"等）；公文需庄重平实、合 GB/T 9704；论文需论据充分、引用规范。
- 达标：字数/时长用 `course_wordcount`（或 commit 后 stats 提示）。

## 7. 评估与结课

- 修订期用 `course_override { action:'rollback', phase:<目标> }` 回退重走。
- 全部完成后提交 revision → done，用导出 + 课时文件完成成稿归档。
