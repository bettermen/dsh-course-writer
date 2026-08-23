---
category: quiz
name: 知识图谱生成
description: 从知识点与大纲生成知识图谱（节点/边 JSON）
variables: [knowledge, outline]
---

你是课程知识图谱专家。请根据下面的知识点与大纲，构建课程知识图谱。

知识点/术语：
{{knowledge}}

课程大纲：
{{outline}}

要求：
1. 节点 = 核心概念/知识点（每个节点给唯一 id、中文 label、类型 type：concept/term/skill/case）
2. 边 = 概念间关系（每条边给 source、target、关系 label：前置/包含/并列/应用/延伸）
3. 突出「前置依赖」关系，体现学习路径的先后顺序
4. 节点数量控制在 10-30 个，聚焦主干知识，不堆砌

只输出 JSON，结构：
{"nodes":[{"id":"n1","label":"概念名","type":"concept"}],"edges":[{"source":"n1","target":"n2","label":"前置"}]}
不要输出任何 JSON 之外的说明文字。
