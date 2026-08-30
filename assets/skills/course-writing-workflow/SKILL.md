---
name: course-writing-workflow
description: 通用课程编写全流程（九阶段门禁式）：选题→学情设定→教学目标→课程大纲→单元设计→课时教案→课件练习→评估修订→结课。使用 course_* 工具推进、lorebook_* 管理课程资料库，模型不得口头跳阶段。 — General nine-phase gated course-authoring workflow (topic → learner analysis → objectives → outline → units → lesson plans → courseware → assessment); advance via course_* tools, manage the lorebook via lorebook_*, never skip phases verbally.
whenToUse: 用户要求开始编写课程、写教案、设定学情、生成大纲、设计教学目标、润色或诊断教案时。 — When the user asks to author a course, write lesson plans, set learner analysis, generate an outline, design objectives, or polish/diagnose lesson plans.
---

# 课程编写工作流（xiashuo）

本技能定义课程编写的标准流程。**阶段推进必须走工具，未 commit 不得自称完成。**

## 1. 九阶段流程（按序推进，禁止跳阶段）

`topic(课程选题) → setting(学情设定) → character(教学目标) → outline(课程大纲) → volume(单元设计) → chapter(课时教案) → writing(课件与练习) → revision(评估修订) → done(结课)`

- 进入阶段：`course_phase { projectId, phase }`（前置阶段必须 approved/skipped，否则工具报 INVALID_STATE）。
- 提交产物：`course_commit { projectId, phase, artifact, errorCount }`——产物写入 docs/<phase>.md 与版本快照；errorCount>0 会挂起 review，需要修改后重新提交。
- 用户覆盖：`course_override { action: force|reopen|skip|rollback }`（force 放行、reopen 驳回、skip 跳过、rollback 在修订期回退）。

## 2. 课程资料库（lorebook）纪律

- **编写前必查**：开始写教案前，先确认本课程已绑定足够的资料库条目（`lorebook_list_entries` 按 `book_id` 核对）。若某课程没有绑定条目，**主动提醒用户先建立资料库**（核心概念/知识点/专业术语/案例/资源），再开始写教案。
- **知识点即时沉淀**：编写过程中出现的任何关键知识点、专业术语、定义、公式、案例——**立即用 `lorebook_create_entry` 保存**，并传 `book_id` 绑定当前课程。不要等用户要求。
- 条目按 `book_id` 绑定具体课程：每门课程拥有自己的资料库条目集合，课程之间隔离。
- 核心概念/术语表建议设为常驻条目（always_active）；案例/延伸资料用关键词触发。
- 编写前查询相关条目：`lorebook_list_entries` / `lorebook_get_entry`。
- GUI：课程工坊 → 资料库（按课程分栏管理；新建条目时选择绑定课程）。

## 3. 教案编写协议（两段式）

1. `course_write_chapter { projectId, chapterNo, brief? }` → 返回上下文包（L1 课程设定 + L2 单元教案与前文 + L3 摘要/变量/资料库命中 + 硬约束）。
2. 在回复中直接输出本课教案（遵守上下文包的 constraints：课时目标/流程/时长/禁用词/小结）。
3. `course_commit_chapter { projectId, chapterNo, title, text, brief? }` → 落盘并自动统计字数与达标判定。
4. 教案需要维护状态时，可在文末输出 `<JSONPatch>[{"op":"replace","path":"/stat_data/知识掌握","value":"已掌握"}]</JSONPatch>` 更新课程级变量。

## 4. 质量自检（提交前）

- 一致性：知识点/术语/案例与账本、资料库条目一致，不冲突。
- 结构：本课完成教学目标；课末留有小结与练习引导。
- 文风：避免 AI 味表达（"不禁/仿佛/综上所述/值得注意的是"等），语言自然、贴近教学口语。
- 字数/时长：达标用 `course_wordcount`（或 commit 后 stats 提示）。

## 5. 评估与结课

- 修订阶段用 `course_override { action: 'rollback', phase: <目标> }` 回退到已批准阶段重新走。
- 全部完成后提交 revision → done，用 `lorebook_export_entries` + 课时文件完成成稿归档。
