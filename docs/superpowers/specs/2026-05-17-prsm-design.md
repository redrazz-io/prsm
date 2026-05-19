# prsm — Design Spec

**Date:** 2026-05-17  
**Status:** Draft  
**Author:** Eduardo Leal

---

## Name

**prsm** (pronounced "prism")

A prism takes a single source beam and refracts it into multiple distinct outputs — the same signal, expressed across different wavelengths. prsm does the same: one canonical skill manifest → multiple runtime-specific artifacts. The signal (workflow semantics) is preserved; only the output medium changes.

**Tagline:** *Wire your AI stack once, deploy to any runtime.*

---

## Problem

Platform engineering teams wire AI agent infrastructure repeatedly: Claude Code skills, subagents, lifecycle hooks, permission configs, cross-repo context awareness, ADR workflows. When tools change (Claude Code → Codex) or teams scale across multiple repos, everything must be rewired. There is no single source of truth for AI agent skills that works across tools and teams.

## Vision

prsm is an open-source CLI that lets teams author AI agent skills and organization presets once, compile them to multiple runtimes (Claude Code, Codex CLI), manage cross-repo context, and consume team or community-built presets — all with lockfile-backed, reproducible builds.

Analogy: **Babel for AI agent configuration.** Write in a canonical format, compile to whatever runtime your team uses.

---

## Naming Conventions

| Artifact | Convention | Example |
|----------|-----------|---------|
| CLI binary | `prsm` | `prsm build` |
| npm package | `@prsm/prsm` | `npm i -g @prsm/prsm` |
| Workspace manifest | `prsm.yaml` | root of any prsm workspace |
| Lockfile | `prsm.lock` | committed to git, resolved preset refs + checksums |
| Internal dir | `.prsm/` | gitignored cache |
| Presets | `prsm-preset-<name>` | `prsm-preset-platform-engineering` |
| Preset GitHub org | `prsm-presets` | `prsm-presets/platform-engineering` |

**prsm vs prism in docs:** The brand is always lowercase `prsm`. Pronunciation guide appears on first mention in user-facing docs ("prsm, pronounced 'prism'"). Marketing copy and the logo use `prsm` — never spell it out as `prism` to avoid conflating with PrismJS or GraphPad Prism.

---

## Conflict Map & Distribution Strategy

| Space | Name | Status |
|-------|------|--------|
| npm scoped | `@prsm/prsm` | Clear; v1 canonical package |
| npm unscoped | `prsm` | Abandoned 2019 placeholder, requestable; post-1.0 target |
| Homebrew | `prsm` | Clear |
| Homebrew | `prism` | GraphPad Prism (stats app) — different domain |

**v1.0 Strategy:** Use `@prsm/prsm` as the canonical npm package (no supply-chain risk before ownership transfer). Binary stays `prsm`. Post-1.0, after acquiring unscoped package ownership and completing trademark clearance, migrate to canonical `prsm` package in a minor release.

---

## Core Primitives

| Primitive | What it defines |
|-----------|----------------|
| **Skill** | A reusable AI behavior unit (`SKILL.md` with frontmatter + content) |
| **Agent** | A specialized subagent (`AGENT.md` with frontmatter + system prompt) |
| **Hook** | Lifecycle shell script (session-start, pre-tool-use, stop, etc.) |
| **Preset** | A curated bundle of skills + agents + hooks + permissions |
| **Workspace** | A repo with `prsm.yaml` at root declaring everything |
| **Repo-Mapping** | Cross-repo context awareness: nested organization of repos, their paths, and default branches |
| **Runtime Adapter** | Plugin that compiles workspace artifacts to a specific tool's output format |

Skills, agents, and hooks are declarative and tool-agnostic. Adapters are the only runtime-specific code.

---

## Workspace Structure

```
prsm.yaml               # workspace manifest
prsm.lock               # lockfile with resolved preset refs and checksums (committed to git)
.prsm/                  # runtime cache (gitignored)

skills/
  <category>/
    <name>/
      SKILL.md          # metadata (frontmatter) + content
      tests/            # optional: skill tests

agents/
  <name>/
    AGENT.md            # metadata (frontmatter) + system prompt

hooks/
  session-start.sh
  pretool-safety.sh
  session-stop.sh

repos/
  <category>/
    <repo_name>/        # nested organization matching config.yaml pattern
    ...

AGENTS.md               # shared cross-repo conventions (optional at root)
```

---

## Manifest Format

### `prsm.yaml`

```yaml
name: my-platform-hub
version: 1.0.0
author: my-team

runtimes:
  - claude-code
  - codex

extends:
  - prsm-preset-platform-engineering@2.0.0
  - prsm-preset-base@1.0.0

dependencies:
  superpowers: "^5.1.0"      # metadata only in v1; parsed but not enforced
  claude-mem: "~2.3.0"

repos:
  platform:
    backstage:
      path: ~/repos/backstage
      org: myorg
      default_branch: main
    infrastructure:
      path: ~/repos/infrastructure
      org: myorg
      default_branch: main
  services:
    api-service:
      path: ~/repos/api-service
      org: myorg
      default_branch: main

skills:
  - path: skills/platform/copilot
  - path: skills/security/stride

agents:
  - path: agents/pr-reviewer

hooks:
  session-start: hooks/session-start.sh
  pre-tool-use:  hooks/pretool-safety.sh
  stop:          hooks/session-stop.sh

output:
  claude-code:
    skills:   .claude/skills/
    agents:   .claude/agents/
    settings: .claude/settings.json
  codex:
    skills:   .agents/skills/
```

### `SKILL.md`

Metadata lives in frontmatter; content in markdown below.

```markdown
---
name: platform-copilot
description: Routes platform work to the right workflow
version: 1.0.0
category: platform
triggers:
  - "dispatch work"
  - "route to skill"
  - "platform-copilot"
runtimes:
  - claude-code
  - codex
tools:
  - Read
  - Write
  - Bash
dependencies:
  hub-adr-spec-to-adr:
    type: skill
    source: local
    required: true
  superpowers:
    type: plugin
    source: claude-code-marketplace
    version: "^5.1.0"
    required: false
---

# Platform Copilot

This skill routes platform engineering work to the appropriate workflow...
```

### `AGENT.md`

```markdown
---
name: pr-reviewer
description: Deep pull-request reviewer with platform context
version: 1.0.0
model: claude-sonnet-4-6
color: purple
tools:
  - Read
  - Bash
  - Grep
  - Glob
runtimes:
  - claude-code
---

You are an expert platform engineer reviewing pull requests...
```

---

## Repo-Mapping Primitive

Prsm includes explicit repo-mapping for cross-repo context awareness.

### Features

**prsm context \<repo\>** — Load target repo's AGENTS.md and presets before working in that repo
```bash
prsm context infrastructure
# Loads ~/repos/infrastructure/AGENTS.md and applicable presets into session context
```

**prsm sync** — Fan preset changes across mapped repos via extends: chain
```bash
prsm sync
# Detects changes to extended presets, re-compiles targets in all mapped repos
```

**prsm diff --cross-repo** — Detect drift across repo dependencies
```bash
prsm diff --cross-repo
# Finds mismatched skill versions, hook changes, permission divergence across repos
```

**prsm init --from-claude-dir** — Migrate from existing .claude/ tree to prsm.yaml
```bash
prsm init --from-claude-dir ~/repos/some-repo
# Reads .claude/settings.json, extracts repo context, generates repos: block
```

### Skill-Level Cross-Repo Support

Skills can declare `cross-repo: true` to indicate topology awareness:

```yaml
---
name: platform-reviewer
cross-repo: true           # This skill understands mapped repo structure
runtimes:
  - claude-code
---

This skill validates changes against the cross-repo dependency rules in the target repo's AGENTS.md...
```

### Three Adoption Scopes

- **Team scope** (local `prsm.yaml`) — manages single repo's skills + hooks
- **Department scope** (`extends: org-preset`) — inherits platform-wide conventions, overrides locally
- **Company scope** (`extends: base-preset`) — foundational configs inherited by all teams

Inheritance is explicit and auditable via `prsm explain`.

---

## Preset System

A preset is a prsm package bundling skills + agents + hooks + permission configs.

### Consuming a preset

```yaml
# prsm.yaml
extends:
  - prsm-preset-platform-engineering@2.0.0

# Local definitions override preset on conflict
skills:
  - path: skills/custom/my-copilot
```

In v1.0, presets are consumed via:
1. **Local symlinks** — teams install presets independently (npm, git clone, etc.), prsm resolves via local paths
2. **GitHub raw URLs** — `extends: https://raw.githubusercontent.com/prsm-presets/platform-engineering/main/preset.yaml`

**Lockfile for Reproducibility:** `prsm install` resolves all preset extends references and generates `prsm.lock` with:
- Resolved preset URLs (symlink paths or GitHub commit SHAs for immutability)
- SHA checksums of each preset file
- Timestamp of resolution

Teams commit `prsm.lock` to git. Future `prsm build` operations read from the lockfile, ensuring byte-identical output across machines and after upstream preset changes. If a preset is updated and committed, the lockfile change is auditable; rollback is a single `git revert`.

**No package manager in v1** — preset installation is the team's responsibility (plugins, npm, repos). prsm composes what's already available and locks versions via the lockfile.

### Preset structure

```
prsm-preset-platform-engineering/
  preset.yaml
  skills/
    platform/copilot/
    security/stride/
  agents/
    pr-reviewer/
  hooks/
    pretool-safety.sh
    session-start.sh
  permissions/
    allowlist.yaml
```

### `preset.yaml`

```yaml
name: prsm-preset-platform-engineering
version: 2.0.0
description: Full platform engineering setup — ADR lifecycle, PR review, threat modeling
extends:
  - prsm-preset-base@^1.0.0

skills:
  - skills/platform/copilot
  - skills/security/stride

agents:
  - agents/pr-reviewer

hooks:
  pre-tool-use: hooks/pretool-safety.sh
  session-start: hooks/session-start.sh
```

### Merge strategy

Resolution order (last wins on conflict):
1. Base preset
2. Extended preset (left to right)
3. Local `prsm.yaml`

`prsm explain <skill>` shows which layer a skill came from.

`prsm eject [preset-name]` copies preset internals into local `skills/` — full ownership, no more preset dependency. The escape hatch that makes adoption low-risk.

---

## Dependency Declaration (Presence-Validated in v1)

Dependencies are declared in `SKILL.md` frontmatter for forward compatibility. **In v1.0, prsm validates syntax and checks local presence of `required: true` dependencies — it does not auto-resolve or download anything.**

```yaml
dependencies:
  hub-adr-spec-to-adr:
    type: skill
    source: local | remote | package-manager
    version: "^1.0.0"
    platforms:
      - claude-code
    required: true | false
```

**v1 behavior:**
- Syntax validation for all dependency declarations
- For `required: true` skill dependencies with `source: local`: `prsm validate` fails with an actionable error if the referenced skill path does not exist
- Does not download, fetch, or resolve remote dependencies
- `required: false` deps are noted but never block validation

**Why this distinction matters:** A preset can declare skills that aren't installed. Without presence checks, `prsm build` produces output that looks valid but fails at invocation — silent breakage across repos. Presence checking catches this at author time with no network access required.

**Post-1.0:** Add `prsm install --missing` for auto-fetch, transitive resolution, and version negotiation without changing SKILL.md format.

---

## Runtime Adapters

Each adapter knows:
1. Output file format for skills (frontmatter fields, directory structure)
2. Output file format for agents (model field, tools format)
3. Where to write outputs
4. How to generate runtime config (`.claude/settings.json` for Claude Code; `agents/openai.yaml` for Codex)

**v1 adapters:** `claude-code`, `codex`

**Claude Code adapter** outputs:
- `.claude/skills/<category>/<name>/SKILL.md` (skill content)
- `.claude/agents/<name>.md` (agent system prompts)
- `.claude/settings.json` (hooks, permissions, plugin wiring)

**Codex adapter** outputs:
- `.agents/skills/<category>/<name>/SKILL.md` (adapted for Codex format)
- `agents/openai.yaml` (Codex-specific agent config)

Adding a new runtime = adding a new adapter module. No changes to authoring format or core compiler.

---

## CLI Commands (v1.0)

```
prsm init [name]          Scaffold a new workspace from template
prsm build                Compile all skills/agents/hooks → runtime outputs
prsm install              Resolve preset inheritance (reads preset.yaml)
prsm validate             Lint manifest, skill files, dependency syntax
prsm list                 List installed skills, agents, and their runtime targets
prsm explain <skill>      Show resolved configuration for a skill (origin: local/preset)
prsm doctor               Diagnose version mismatches between global and project-local installs
prsm context <repo>       Load target repo's AGENTS.md + presets
prsm sync                 Fan preset changes across mapped repos
prsm diff [--cross-repo]  Detect drift in skills/hooks/permissions
```

**Post-1.0 commands** (v2+): `add`, `remove`, `search`, `publish` (registry/package manager features)

---

## Hook System (Enables Workflows, Doesn't Orchestrate)

Prsm wires hooks into runtime configs for runtimes that support them. Hooks **enable** platforms to coordinate workflows (brainstorming → planning → execution → ADR lifecycle) but do **not** orchestrate them.

**What prsm does:**
- Validates hook shell scripts exist
- Compiles hooks for runtimes that support them (e.g., `.claude/settings.json` for Claude Code)
- Silently skips unsupported hooks during compilation (e.g., Codex builds omit hooks since Codex only supports `openai.yaml`)

**What prsm doesn't do:**
- Define workflow definitions (phases, state, sequencing)
- Track execution state or enable resumption
- Detect which workflow to invoke based on user input

**Runtime Hook Support:**
- **Claude Code:** Full hook support (SessionStart, PreToolUse, UserPromptSubmit, PostToolUse, Stop)
- **Codex:** No hook support (config delivery limited to `agents/openai.yaml`); `prsm build` for Codex silently skips hooks without error

Teams building for multiple runtimes should be aware: Claude Code builds will include full hooks; Codex builds will not. This is by design—no false safety boundary.

**Reference:** Platform-hub's chain-of-thoughts system (5 parallel flows) is a **reference implementation** using prsm hooks + skills to orchestrate work. It is not a prsm feature — it is an **example of what teams can build with prsm hooks.**

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Bun | Fast startup, native TS, `bun build --compile` → single binary |
| Language | TypeScript | Low contribution barrier, npm ecosystem, community-friendly |
| CLI framework | `commander` | Proven, minimal |
| Schema validation | `zod` | Type-safe manifest + skill validation |
| YAML parsing | `js-yaml` | Bun-compatible, battle-tested |
| Semver | `semver` | Standard version constraint matching |
| Terminal output | `chalk` | Standard terminal colors |
| HTTP | `fetch` (native) | Built into Bun, no node-fetch needed |
| Tests | `bun test` | Built-in, no extra dep |

### Distribution

- **npm:** `npm i -g @prsm/prsm` (JS bundle; scoped package for v1.0)
- **GitHub Releases:** pre-compiled binaries (macOS arm64/x64, Linux x64, Windows x64) via `bun build --compile`
- **Homebrew tap:** wraps the binary release

The project dogfoods itself: the prsm repo is itself a prsm workspace (`prsm.yaml` at root).

---

## Success Criteria (v1.0)

1. `prsm init` scaffolds a working workspace in under 60 seconds
2. `prsm build` compiles skills to Claude Code + Codex outputs with zero manual steps
3. `prsm install` resolves preset inheritance correctly (reads preset.yaml, generates `prsm.lock`)
4. `prsm eject` produces locally-owned skill files identical to the preset source
5. Two team members on different machines produce byte-identical `.claude/skills/` output from the same `prsm.yaml` + `prsm.lock` (lockfile ensures reproducible builds)
6. Repo-mapping (`prsm context <repo>`, `prsm sync`) works against platform-hub reference structure
7. `prsm validate` catches syntax errors in manifests and dependency declarations; fails with an actionable error when a `required: true` local skill dependency is missing (no network access required)
8. At least one community preset ships at launch (`prsm-preset-platform-engineering` seeded from platform-hub)
9. Migration tool `prsm init --from-claude-dir` successfully converts platform-hub `.claude/` tree to prsm.yaml
10. Preset inheritance chain resolves unambiguously; `prsm explain` shows origin for all artifacts; hooks compile only for supported runtimes (Codex builds skip hooks without error)
