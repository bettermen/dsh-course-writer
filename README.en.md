# dsh-course-writer (Novel Workshop)

A web-novel creation plugin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) (DSH):
**nine-phase gated creation workflow + lorebook injection + AI-taste removal + golden-three-chapters diagnosis + million-word consistency + one-click chapter writing**.

- [中文](./README.md) | English

## Features

| Capability | Description |
| --- | --- |
| **Nine-phase workflow** | topic → setting → characters → outline → volumes → chapters → writing → revision → done; phase gating (no skipping), artifact versioning, audit log, revision rollback |
| **Lorebook** | keyword/regex-triggered + always-active entries; groups & book binding; import from Operit / SillyTavern / character cards; injection token budget |
| **Prompt front/back injection** | constant directives injected at the front/back of the context packet (unified scope model) |
| **AI-taste detection & removal** | built-in 234-word, 5-category lexicon + density scoring + one-click rewrite via built-in prompts |
| **Golden-three-chapters diagnosis** | offline rule layer (hook/opening/conflict/infodump/wordcount/dialogue) + optional model layer |
| **Four-family validation** | structure/content/plot/consistency, run on commit (wordcount/title/forbidden words/POV/hook/brief coverage) |
| **Million-word consistency** | fact ledger (auto-extracted from chapter JSONPatch) + timeline regression detection + overdue foreshadowing + sediment suggestions + consistency audit; budget-constant context packets (stress-tested: 1M words, 0 over-budget, 100% conflict coverage) |
| **Per-chapter word stats** | auto stats on commit (total/CJK/dialogue ratio/sentence length) + target badge + book stats |
| **Chapter context packet** | L1 book brief + L2 volume/chapter briefs & recent chapters + L3 summaries/variables/lorebook hits |
| **Built-in prompt library** | 60 templates: creation/styles (8)/depolish/polish/diagnosis/guide/lorebook |
| **Workshop assistant** | intent parsing (natural language → tool actions) + 5-step creation wizard |
| **GUI** | sidebar "Novel Workshop" + drawer (projects/create/detail/one-click write/diagnosis/demo import) + settings card |
| **Revision & export** | proofread/rhythm/style modes (diff stats, original kept); txt/markdown/platform export |
| **Novel Creation Mode preset** | agent preset ("虾说教材写作") selectable when creating a new session — anchors the creation persona and auto-installs the `course-writing-workflow` skill + 41 `course_*`/`lorebook_*` tools (three-channel model: preset anchors the mode, skill guides the method, tools enforce the gated workflow). Zero setup: pick it in the new-session preset picker and start chatting ("create a xianxia novel project", "write the next chapter"). |

## Install

> Needs DSH installed (Windows/macOS/Linux; runtime Node ≥18). **Install only the LATEST release** (v0.1.7) — old v0.1.0/v0.1.1 fail to load with `requires options.key`.

### A — Let an AI install it (recommended)
Paste this to any command-capable AI:

> Install the DSH plugin "虾说教材写作" (dsh-course-writer), **LATEST version only**. From `https://github.com/akira399/dsh-course-writer/releases/latest` download the newest `dsh-external-dsh-course-writer-*.tgz` (highest version; not v0.1.0/v0.1.1) → run `dsh plugin --profile web add <absolute tgz path>` → confirm with `dsh plugin list` → tell me to refresh the DSH page (Ctrl+Shift+R) so the sidebar entry appears. Report any error first.

### B — Manual install
Download the newest `dsh-external-dsh-course-writer-*.tgz` from https://github.com/akira399/dsh-course-writer/releases/latest, then:

```bash
dsh plugin --profile web add <path-to-tgz>
dsh plugin list        # dsh-course-writer listed = success
```

### C — Build from source (advanced)
Needs Node ≥22 and Git:

```bash
git clone https://github.com/akira399/dsh-course-writer.git && cd dsh-course-writer
npm install && npm run verify && npm run build && npm pack
dsh plugin --profile web add ./dsh-external-dsh-course-writer-0.1.7.tgz
```
(Use Git Bash on Windows for the shell build script.)

**After install**: the sidebar "虾说教材写作" entry and the settings card appear; if not, refresh/restart DSH and check the plugin is enabled.

## Quick start

1. Open the drawer → "Import demo 《青云问道》" (or create your own project)
2. Open project detail → "Write chapter" → the session writes from the context packet → review & save
3. Or just chat: "create a fantasy novel project", "write the next chapter", "remove AI taste", "diagnose the opening"

Data lives in `~/.dsh/dsh-course-writer/` by default.

## Feature usage guide

Every capability is reachable two ways — the GUI drawer and plain chat. Example triggers:

- **Create a book**: drawer "create" + pick a genre (27) · chat: "create a xianxia novel project"
- **Walk the 9 phases**: chat "generate the worldbuilding", "design the characters", "submit the outline" → `course_phase` / `course_commit`
- **Write a chapter**: drawer "一键写教案并保存" · chat: "write the next chapter"
- **Polish + diff**: drawer "一键润色" → review marked changes → 确认保存 / 放弃还原; undo with the "↶ 撤销" button
- **Worldbook (lorebook)**: drawer "本课程资料库" → "AI 一键生成设定" or "+ 新建条目"; import Operit/SillyTavern/character-card
- **Import a local book**: drawer "导入本地课程" (txt/md) → auto-chapters & builds a book
- **Quality checks**: drawer "结构诊断"; chat "把这章去 AI 味", "校验这章" → `course_validate`
- **Consistency**: chat "跑一遍一致性巡检" → `course_consistency_audit`; "林远现在什么境界" → `course_ledger`; foreshadow/timeline via chat
- **Revise & export**: chat "修订第 3 章查错别字" → `course_revise`; drawer "导出 txt" or chat "导出成稿"
- **Market research & clone**: chat "调研下仙侠市场" → `course_market_research`; "以《青云问道》做模板开新课程" → `course_clone_project`
- **Start a session**: new session → preset picker → "虾说教材写作" → just chat your intent

Tip: you don't need to memorize commands — the creation-mode agent picks the right `course_*`/`lorebook_*` tool for you and asks for confirmation on writes. Ask "what can the workshop do?" anytime.

## Interaction with DSH

- **41 agent tools**: `course_*` + `lorebook_*` + `course_prompts`
- **Two-phase chapter protocol**: `course_write_chapter` (context packet) → model writes → `course_commit_chapter` (stats/ledger/audit)
- **Skill**: `course-writing-workflow`
- **GUI API**: `/api/course-writer/*` (fence-header protected)

## Security

Local-only storage; audit-logged writes; LLM helper calls reuse the session's model route; GUI routes require a custom fence header; disabled plugin returns 503.

## Known limitations

- Model-layer features degrade to detection/rule layers when no model route is available
- One-click chapter text backfill is best-effort (manual paste supported)
- Scheduled serialization (browser cron) not yet implemented
- Sediment suggestions require confirmation before writing to the lorebook

## Development

```bash
npm run typecheck && npm test && npm run build
node scripts/simulate-1m.mjs   # million-word consistency stress test
```

Module discipline: one module → tests → review per step (see [docs/MODULE-LOG.md](./docs/MODULE-LOG.md)).

## License

MIT
