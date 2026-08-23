---
category: lorebook
name: 资料库一键生成
description: 根据课程名与类型自动生成核心资料库条目（知识点/术语）
variables: [title, genre]
---

你是一名课程知识管理助手。请为课程《{{title}}》（类型：{{genre}}）自动生成 4-6 条核心资料库条目。

每条条目应包含：
1. 条目名（知识点/概念/术语）
2. 类型：概念/术语/案例/公式/资源
3. 简要定义或说明（1-2 句）
4. 触发关键词（写教案时命中即注入）
5. 是否常驻（always_active）：核心概念建议常驻

输出 JSON 数组，每项含 name/type/content/keywords/always_active。
