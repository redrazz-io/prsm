# Prsm Backlog

## Design Decisions — v1.0 (Locked)

These decisions define what prsm 1.0 ships with and what stays post-1.0.

### Dependency Resolution — Deferred (auto-install only)
- **Decision:** Keep dependency metadata in SKILL.md frontmatter; defer auto-resolution and download to post-1.0
- **Rationale:** Avoids package manager scope creep; metadata is forward-compatible for future implementation
- **Metadata format:** Comprehensive `dependencies:` block with type, source, version, platforms, required flag
- **v1 behavior:** Parse & validate syntax; check local presence of `required: true` skill dependencies; no auto-resolution or download
- **Distinction:** "No auto-install" ≠ "no enforcement" — v1 validates that required deps exist locally; it does not fetch missing ones
- **Post-1.0:** Add transitive resolution, version negotiation, and `prsm install --missing` without SKILL.md changes
- **Status:** ✓ Decided 2026-05-17, updated 2026-05-19

### Preset Composition — Local Skills Only
- **Decision:** Presets reference skills that already exist (built-in, local, symlinked); no downloading
- **Rationale:** Avoids package manager; aligns with platform-hub's symlink setup (make setup.skills)
- **Mechanism:** Teams install skills independently (plugins, npm, repos), then presets compose what's available
- **AGENTS.md documents dependencies:** "platform-preset includes X because skill Y requires it"
- **No transitive resolution in v1**
- **Post-1.0:** Could add a skill registry if cross-org sharing becomes a pattern
- **Status:** ✓ Decided 2026-05-18

### Repo-Mapping Primitive — First-Class Feature
- **Decision:** Prsm includes explicit repo-mapping with nested organization (category → repo_name → {path, org, default_branch})
- **Rationale:** Validated against platform-hub config.yaml; solves cross-repo context awareness and skill topology
- **Features:**
  - `prsm context <repo>` — loads target repo AGENTS.md + presets
  - `prsm sync` — fans changes across mapped repos via extends: chain
  - `prsm diff --cross-repo` — detects drift across dependencies
  - `prsm init --from-claude-dir` — migration from existing .claude/ tree
- **Three scopes:** team (local), department (extends: org-preset), company-wide (extends: base-preset)
- **Status:** ✓ Decided + validated 2026-05-17

### Chain of Thoughts — Workflow Enablement, Not Orchestration
- **Decision:** Prsm enables chain-of-thoughts workflows (hooks, skills, file artifacts) but doesn't include a workflow orchestration layer
- **Rationale:** 
  - Workflow orchestration (task detection, sequencing, resumption, state tracking) is platform-specific
  - Platform-hub's workflow (brainstorming → planning → execution → ADR lifecycle) is a reference implementation, not a prsm mandate
  - Scope creep: adding workflow definitions → state tracking → resumption logic = building Temporal/Airflow
  - Hooks + skills already support these workflows; prsm just needs to deliver them well
- **What prsm does:** Delivers hooks, repo-mapping, skills to enable cross-repo workflows
- **What prsm doesn't do:** Declare workflow definitions, track execution state, orchestrate skill sequencing
- **Post-1.0 question:** If workflow orchestration becomes a common need, consider whether prsm should formalize it or delegate to existing tools
- **Status:** ✓ Decided 2026-05-18

---

## Post-1.0 Features

These are features that would be valuable but are out of scope for MVP.

### Skill Dependency Resolution (2.0+)
- Add `prsm install --missing` to auto-fetch and install missing deps
- Transitive dependency resolution with version negotiation
- Skill registry + lock files for remote deps (prsm.lock already covers preset lockfile)
- See: Dependency Resolution decision above

### Skill Package Management (3.0+)
- Formalize skill source resolution (GitHub, npm, local, HTTP)
- Publish/subscribe model for skill discovery
- Skill registry API
- Version constraint negotiation across org/team/user presets

### Workflow Orchestration Layer (Post-1.0, low priority)
- Formalize workflow definitions (if cross-org adoption shows the need)
- Declarative skill sequencing, artifact tracking, resumption
- Hook-based state machine (detect → phase → next step)
- Consider: delegate to existing tools (Temporal, Airflow) instead

### Platform Support
- Codex adapter improvements (agents/openai.yaml generation from Codex-specific frontmatter)
- Cursor adapter (.cursor/rules/ generation)
- Generic CLI tools (agents/skill-manifest.json)
- IDE integrations (VS Code, JetBrains)

### Validation & Diagnostics
- `prsm validate --check-cross-repo-deps` — verify Infrastructure→GitOps ordering rules
- `prsm tree <skill>` — dependency graph visualization
- `prsm doctor` — audit config consistency across repos
- `prsm diff --audit-trail` — show what changed and why

### Migration Tools
- `prsm init --from-claude-dir` enhanced with interactive prompts
- `prsm migrate-from <tool>` for CraftDesk, other legacy config tools
- Rollback helpers for preset version mismatches

---

## Open Questions

### Naming & Branding
- **Question:** Is "prsm" safe from Blue Prism trademark in developer tools class?
- **Status:** Needs trademark search + legal review before launch
- **Current assumption:** npm "prsm" package is abandoned (2019), recoverable

### Cross-Org Skill Sharing
- **Question:** At what team scale does skill sharing become painful without a registry?
- **Evidence needed:** Platform-hub data (how many teams reuse platform-preset? How do they propagate updates?)
- **Post-1.0 gate:** If >50% of teams sync preset from central org, prioritize skill registry

### Dependency DSL Extensibility
- **Question:** Does the `dependencies:` frontmatter format handle all future types (library, docker, cli, service mesh)?
- **Status:** Designed to be extensible (new types don't break existing skills)

### Hook Standardization Across Runtimes
- **Question:** How should runtime-specific hooks (Claude SessionStart ≠ Codex PostToolUse) be declared to be runtime-agnostic?
- **Evidence:** Platform-hub uses only `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` (Claude-only)
- **Codex gap:** Codex doesn't support hooks; config delivery is limited to openai.yaml

---

## Pre-Block-1 Adversarial Findings (deferred)

Surfaced by Codex bot reviews on PR #1 during the Block 1 closeout (2026-05-27 / -28).
These are real bugs that pre-date Block 1 — flagged here for follow-up work, not blocking v1.0 ship.

### P1 — Per-item `frontmatter.runtimes` filter ignored in compile loop
- **Where:** `src/compiler/index.ts:74`
- **Bug:** The build loop emits every resolved skill and agent to every workspace runtime, ignoring each item's `frontmatter.runtimes`. A skill declared for Claude only is still emitted to Codex when the workspace runs both runtimes.
- **Fix shape:** Filter `model.skills` / `model.agents` per runtime inside the for-runtime loop, using each item's `frontmatter.runtimes` (default to all runtimes if absent).

### P1 — `loadPresetAsLayer` does not resolve transitive preset `extends:`
- **Where:** `src/core/preset.ts:80` (`loadPresetAsLayer`)
- **Bug:** `preset.yaml` supports an `extends:` array, but `loadPresetAsLayer` only reads files from the current preset directory — it never recursively loads the chain. A preset that extends another preset silently inherits nothing.
- **Fix shape:** Recursively resolve `manifest.extends` inside `loadPresetAsLayer` and merge layers in order. Add cycle detection.

### P2 — Stale prsm-managed hooks survive `settings.json` regeneration
- **Where:** `src/adapters/claude-code.ts:67` (`generateConfig`)
- **Bug:** Hook generation merges `existing.hooks` with `prsmHooks` via `{ ...existing, ...new }`, which preserves old prsm-managed entries even after they are removed from `prsm.yaml`. The compiled `.claude/settings.json` keeps running deleted hooks.
- **Fix shape:** Track prsm-managed hook event names separately (similar to `generated-files.json`) and drop them from existing before merging in new ones. Or namespace prsm hooks under a known key.

### P2 — Relative preset paths resolve from CWD, not workspace root
- **Where:** `src/compiler/index.ts:28` (compile preset loop)
- **Bug:** When `prsm.yaml` uses a relative `extends:` path (e.g., `./presets/platform`) and `prsm build` is invoked from a subdirectory, `findWorkspaceRoot` correctly locates the workspace, but the preset-loading loop still resolves the path against `process.cwd()` instead of the workspace root.
- **Fix shape:** Resolve `presetRef` against `workspaceRoot` before passing to `parsePresetManifest` / `loadPresetAsLayer`.

---

## Definition of Done for v1.0

- [ ] Architecture docs complete (repo-mapping, config delivery, presets, runtime adapters)
- [ ] Spec written and approved
- [ ] Implementation plan generated
- [ ] Compiler working (reads prsm.yaml → emits .claude/settings.json, .agents/openai.yaml, etc.)
- [ ] Repo-mapping tested against platform-hub reference
- [ ] Preset inheritance working (extends: chain resolves correctly)
- [ ] Migration tool validates (prsm init --from-claude-dir parses platform-hub .claude/)
- [ ] Documentation complete (README, architecture, plugin guide, ADR)
- [ ] npm package published as `@redrazz/prsm` (the `@prsm` npm scope is owned by a third party; `@redrazz` matches the GitHub org `redrazz-io`)
