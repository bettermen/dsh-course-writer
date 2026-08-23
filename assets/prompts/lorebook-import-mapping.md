---
category: lorebook
name: 资料库导入映射说明
description: 课程资料库导入字段说明
variables: []
---

课程资料库支持导入外部知识/术语/案例条目。字段映射如下：

- name：条目名（必填）
- type：类型，取值 concept（概念）/ term（术语）/ case（案例）/ formula（公式）/ resource（资源）
- content：条目内容/定义
- keywords：触发关键词（逗号分隔，写教案时命中即自动注入）
- always_active：是否常驻（true/false，核心概念建议 true）

导入格式支持 JSON / Markdown 列表 / CSV。导入后按 book_id 绑定到具体课程，课程之间隔离。
