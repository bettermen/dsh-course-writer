<p align="center">
  <img src="./assets/brand/banner.svg" alt="虾说 — AI Creator Workspace" width="100%">
</p>

# 虾说 (xiashuo)

An **AI creator workspace plugin** for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) (DSH):
**project-managed home page + course/official/novel/thesis & custom kinds + editable workflow + three-pane workspace + gated pipeline + TXT/Word export + share & collaborate**.

- [中文](./README.md) | English

<p align="center">
  <img src="./assets/brand/logo.png" alt="虾说 Logo" width="120">
</p>

Let DSH work with you like a professional creative partner — manage all your projects through AI conversation. The home page centralizes every project; each kind (course, official document, novel, thesis, or your own custom kind) ships with a workflow you can freely add/remove/reorder phases in. From topic to finished draft, every step is methodical, gated, verifiable and exportable, with a lorebook and knowledge graph that solidify the knowledge structure.

---

## ✨ Features

### 🏠 Home page — project management
- **Project list**: card / list dual views showing kind badge, status, progress bar, lesson count, word count and last-updated
- **Filter & sort**: by kind / status (incl. "active") / keyword search; sort by updated / created / title / words / progress
- **Create / edit / delete / duplicate / archive**: one-click via card context menu; delete can "keep drafts" or "delete drafts too"
- **Empty-state guidance**: one-click sample project to get started fast

### 🗂 Multiple kinds + editable workflow
- **Four built-in kinds**: course (9 phases), official document (7), novel (9), thesis (8) — each with its own default workflow and genre set
- **Custom kinds**: create your own (name + icon + genre list + initial workflow)
- **Free workflow editing** (workspace left pane "Workflow"): **drag to reorder / add / rename** phases, edit each phase's **gate / required artifacts / AI prompt / review rubric / skippable**, **reset to default**, **save as template**, browse & apply the template library

### Three-pane workspace
- **Left pane**: chapters / phases / workflow three views — chapter list (**drag reorder** + hover-delete + context menu), gated phase navigation (progress, locked / in-progress / approved), workflow editor
- **Center pane**: Markdown editor + split preview + chapter title editing + manual save / auto-save (2s after typing stops)
- **Right pane**: lorebook (knowledge-point management) / knowledge graph (visualized structure)

### Project management
- **New project**: kind cards (course/official/novel/thesis/custom) + genre cascade dropdown + summary + workflow-template picker
- **Rename / delete / duplicate / archive**: one-click, with delete confirmation

### Lorebook (knowledge points)
- Knowledge-point **create / edit / enable-disable / delete / preview** (modal form: name, content, keywords)
- Comma-separated keywords, isolated per project

### Knowledge graph
- Visualizes project knowledge points and their relationships
- Labels spread radially around nodes (no overlap); long labels truncated with hover-to-view

### Export
- **TXT** text export
- **Word (.docx)** standard Office format (heading hierarchy + chapter styles)

### Share & collaborate
- Generate **read-only / editable** share links — others can open without logging in
- Editable collaboration has **version history** and **conflict detection** (prompt to overwrite or load latest)

### Gated pipeline (one per kind)
- **Phase gating**: cannot advance until the previous phase is approved
- **Artifact versioning**: every submission is archived and revertible
- **Audit log**: every operation is written to audit.jsonl

### Window controls
- Fullscreen / shrink to 50% (drag-resizable) / close
- Three-pane widths drag-adjustable

<p align="center">
  <img src="./assets/screenshots/shot-gui.png" alt="虾说 three-pane workspace" width="820">
</p>

### 🎭 Creator mode preset (agent preset)
The plugin ships a **「虾说」agent preset**, selectable in DSH's new-session mode picker — picking it enters "creator workspace mode" instantly.

**Three-channel coordination that constrains the model**:
1. **Mode anchoring (preset)** — anchors the "creator workspace" persona;
2. **Soft guidance (skill)** — the `course-writing-workflow` skill auto-registers on enabling and loads the full methodology (per-kind workflow definitions, template usage, tool writing);
3. **Hard rails (tools)** — host-registered `course_*` / `lorebook_*` tools are available throughout; project management, workflow editing, phase advance, submission, validation and drafting all go through tools.

**Usage**: new session → preset picker → "虾说" → start creating; or it auto-syncs to `~/.dsh/.agent-presets/course-writer/` after install.

---

## 🎯 Use cases

| Scenario | How |
| --- | --- |
| Write a new course from scratch | Open the home page → "＋ New project" → "Course" → write through the nine phases |
| Draft an official document | New project → "Official" → brief → materials → outline → draft → compliance & sign-off |
| Write a novel | New project → "Novel" → concept/worldbuilding/characters → outline/beats → draft → revision |
| Write a thesis | New project → "Thesis" → topic → literature review → design → draft → compliance & defense |
| Create a custom writing kind | Home page → create a kind (name + icon + genres + initial workflow) → follow your own pipeline |
| Already have an outline / knowledge points | Create the project, enter knowledge points into the lorebook, reference them in the text |
| Team collaboration | "分享" generates an editable link; multi-author editing with conflict detection |
| Deliver a Word document | "导出" → Word(.docx) one-click download |
| Inspect the knowledge structure | Right pane "知识图谱" visualizes knowledge-point relationships |

---

## 📦 Install

> Requires DSH (Windows/macOS/Linux; runtime Node ≥18). **Install only the LATEST release** (currently v0.8.0).

### ① Let an AI install it (recommended)
Paste this to any command-capable AI:

> Install the DSH plugin "虾说" (xiashuo), **LATEST version only**. From `https://github.com/bettermen/xiashuo/releases/latest` download the newest `dsh-external-xiashuo-*.tgz` (highest version) → run `dsh plugin --profile web add <absolute tgz path>` → confirm with `dsh plugin list` → tell me to refresh the DSH page (Ctrl+Shift+R) so the sidebar entry appears. Report any error first.

### ② Manual install
Download the newest `dsh-external-xiashuo-*.tgz` from https://github.com/bettermen/xiashuo/releases/latest, then:

```bash
dsh plugin --profile web add <path-to-tgz>
dsh plugin list        # xiashuo listed = success
```

### ③ Build from source (advanced)
Requires Node ≥22 and Git:

```bash
git clone https://github.com/bettermen/xiashuo.git && cd xiashuo
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-external-xiashuo-0.8.0.tgz
```

**After install**: the sidebar "虾说" entry and the settings card appear; if not, refresh/restart DSH and check the plugin is enabled.

---

## 🚀 Quick start

1. Open the sidebar "虾说" → enter the **home page** → "＋ New project" → pick a kind (course/official/novel/thesis/custom) + genre
2. Click a project card to enter the workspace; click chapters in the left pane to switch; write in the center pane (Markdown); auto-saves 2s after typing stops
3. The left "Workflow" tab lets you edit the pipeline anytime (drag to reorder, add/remove phases, change gates); right pane "资料库" to enter knowledge points, "知识图谱" to view the structure
4. Top "导出" to download TXT or Word; "分享" to generate a collaboration link

Data lives in `~/.dsh/xiashuo/` by default:

```
lorebook/       knowledge points (entries)
projects/       projects (book.json + workflow.json + chapters/ + audit.jsonl + ...)
templates/      user workflow templates
```

---

## 📖 Feature usage guide

### 0️⃣ Home page — project management
- Sidebar entry opens the home page: card/list view, filter by kind/status/keyword, sort
- "＋ New project": pick kind (icon cards), genre cascade dropdown, summary, workflow-template picker
- Card context menu: open / edit / duplicate / archive / delete (keep or delete drafts)

### 1️⃣ Edit workflow (left "Workflow" tab)
- Enter a project, switch the left pane to "Workflow": see the phase list (gate color dot + index + name)
- **Drag** to reorder, "＋ Add phase" to insert, click a phase to open its property panel (gate / description / required artifacts / AI prompt / review rubric / skippable)
- "Reset to default" returns to the kind's default workflow; "Save as template" stores the current workflow; "Templates" browses & applies built-in / your templates

### 2️⃣ Write chapters (CodeMirror editor)
- Left pane chapter list to switch; center pane is a **CodeMirror 6 Markdown editor**
- Markdown syntax highlighting: headings, bold, italic, strikethrough, quotes, lists, links, inline code, fenced code blocks
- Soft line wrapping; lists / block quotes auto-continue on Enter; auto-paired quotes/brackets
- Undo / redo, find & replace, optional line numbers
- Chapter title editable (top input)
- Save: click "保存", or auto-saves 2s after typing stops (status shows "● unsaved / ✓ saved")
- Search panel comes from CodeMirror (English UI); shortcuts ⌘F find, ⌘Z undo

### 2.5️⃣ Editor toolbar (manual formatting)
A **Apple-style toolbar** sits atop the center editor — format by hand without remembering Markdown. 16 buttons in 5 groups:

- **History**: undo / redo (⌘Z / ⇧⌘Z)
- **Paragraph style**: body / headings H1–H3 / quote / bullet list / ordered list / task list / code block
- **Inline**: bold / italic / strikethrough / inline code
- **Appearance**: font (default / serif / sans / mono / Kai) + text color (14 colors) + highlight (8 colors, "none" to remove)
- **Insert**: link / image / table (6×8 grid with hover preview) / divider
- **View**: find / line-number toggle

Notes:

- Every action is a **single undo step**, with caret position preserved
- Text color / highlight are stored as inline `<span style="…">` (the previewer **whitelist-restores** only safe CSS properties; `url()` / `expression` / `javascript:` are always blocked, so content stays safe to share)
- Re-applying the same color/highlight **removes** it; picking another font merges into the same span (no nesting)

### 2.6️⃣ Delete & drag reorder
- **Delete**: hover a chapter row → ✕ button fades in on the right; or **right-click → 删除课时** (confirms first)
- **Reorder**: drag a chapter row onto its target position; a blue insertion bar marks the drop point, release to save
- Context menu also offers: preview / new lesson / copy title
- Semantics:
  - Delete **keeps sparse numbering** (deleting lesson 2 leaves 1, 3) so external references (share links, ledger, AI context) stay valid; a new lesson takes `max(no)+1` and never collides
  - Reorder **renumbers everything to 1..N** and re-maps the consistency ledger, then replays project variables in the new order
  - Both actions are written to the audit log (`action: delete` / `reorder`)

### 3️⃣ Lorebook (knowledge points)
- Right pane "资料库" → "＋ 新建知识点" → name / content / keywords (comma-separated)
- Each point supports **preview / edit / enable-disable / delete**
- Isolated per project

### 4️⃣ Knowledge graph
- Right pane "知识图谱" → visualizes knowledge-point relationships
- Labels spread radially (no overlap); hover to view full name

### 5️⃣ Export
- Top "导出" → choose **TXT** or **Word(.docx)** → download

### 6️⃣ Share & collaborate
- Top "分享" → choose permission (read-only / editable) → generate link → copy to others
- Editable collaboration: saves carry a version number; conflicts prompt "overwrite or load latest"
- Any share link can be revoked

---

## ⚙️ Configuration

| Setting | Default | Description |
| --- | --- | --- |
| enabled | true | Plugin master switch (disable unregisters tools/skill; data kept) |
| dataDir | `~/.dsh/xiashuo` | Data root directory |
| uiHidden | false | Hide the sidebar "虾说" entry |

---

## 🔌 Interaction with DSH

- **agent tools**: `course_*` (project CRUD / workflow editing / phase advance / drafting / validation / export…) + `lorebook_*` (lorebook CRUD)
  - Project management: `course_projects` / `course_create_project` / `course_project_update` / `course_project_delete` / `course_clone_project`
  - Workflow: `course_workflow` (list / add / rename / update / delete / reorder / reset)
  - Writing: `course_phase` / `course_commit` / `course_write_chapter` / `course_commit_chapter` / `course_override`
- **skill**: `course-writing-workflow` (multi-kind authoring methodology guidance)
- **GUI API**: `/api/xiashuo/*` (projects/workflow/chapters/export/share/lorebook, fence-header protected)

---

## ❓ FAQ

**Q: Why doesn't saving jump back to chapter 1?**
A: By design — saving stays on the current chapter and only refreshes the chapter list, for uninterrupted writing.

**Q: Will I lose edits when switching chapters?**
A: No. With unsaved changes, switching chapter/project or closing prompts for confirmation first.

**Q: What happens when I change a project's kind (course → novel)?**
A: The kind determines the workflow, so changing it resets the workflow to the new kind's default. For projects with existing content, create a new project and import the drafts instead to avoid losing progress.

**Q: Are share links safe?**
A: Shares go through an independent `/share/` path with token auth — the admin password is never exposed; links can be revoked anytime.

**Q: Is the Word export a standard format?**
A: Yes, standard `.docx` (zero-dependency generator), openable in Word / WPS / Google Docs with heading and chapter styles preserved.

---

## 🧪 Development

```bash
npm run typecheck   # host + client
npm test            # vitest
npm run build       # tsc host + tsdown client
npm pack            # pack to tgz
```

---

## 🛡 Security model

- Local-only storage under `~/.dsh/xiashuo/`, no network upload
- All writes audit-logged
- GUI routes carry a custom fence header (anti CSRF / DNS-rebinding)
- Share endpoints use token auth + separate nginx pass-through; admin credentials never exposed

## 📄 License

MIT
