# prsm — Design Spec

**Date:** 2026-05-17  
**Status:** Draft  
**Author:** Eduardo Leal

---

## Name

**prsm** (pronounced "prism")

A prism takes a single source beam and refracts it into multiple distinct outputs — the same signal, expressed across different wavelengths. prsm does the same: one canonical skill manifest → multiple runtime-specific artifacts. The signal (workflow semantics) is preserved; only the output medium changes.

**Tagline:** *One source. Every runtime.*

Alternative taglines:
- *Refract your agent workflows.*
- *Write skills once. Run them everywhere.*
- *The runtime-agnostic skill compiler.*

---

## Problem

Platform engineering teams waste significant time reproducing the same AI agent infrastructure from scratch: Claude Code skills, subagents, lifecycle hooks, permission configs, ADR workflows. There is no portable, tool-agnostic way to author, share, and version these artifacts across teams. Each team reinvents the wheel.

## Vision

prsm is an open-source CLI + registry that lets teams author AI agent skills and workflows once, compile them to multiple runtimes (Claude Code, Codex CLI), share them via a GitHub-backed registry, and consume community-built presets — all with version-pinned, reproducible builds.

Analogy: **Babel/webpack for AI agent skills.** Write in a canonical format, compile to whatever runtime your team uses.

---

## Naming Conventions

| Artifact | Convention | Example |
|----------|-----------|---------|
| CLI binary | `prsm` | `prsm build` |
| npm package | `@prsm/cli` | `npm i -g @prsm/cli` |
| Workspace manifest | `prsm.yaml` | root of any prsm workspace |
| Lockfile | `prsm.lock` | committed to git |
| Internal dir | `.prsm/` | gitignored deps cache |
| Presets | `prsm-preset-<name>` | `prsm-preset-platform-engineering` |
| Registry GitHub org | `prsm-registry` | `prsm-registry/skills` |
| Preset GitHub org | `prsm-presets` | `prsm-presets/platform-engineering` |

**prsm vs prism in docs:** The brand is always lowercase `prsm`. Pronunciation guide appears on first mention in user-facing docs ("prsm, pronounced 'prism'"). Marketing copy and the logo use `prsm` — never spell it out as `prism` to avoid conflating with PrismJS or GraphPad Prism.

---

## Conflict Map

| Space | Name | Status |
|-------|------|--------|
| npm unscoped | `prsm` | Taken — abandoned 2019 placeholder, requestable |
| npm scoped | `@prsm/cli` | **Available** |
| npm | `prism` | Taken — dead React/Redux lib (2017) |
| npm | `prismjs` | Active (syntax highlighter) — avoid |
| Homebrew | `prsm` | Clear |
| Homebrew | `prism` | GraphPad Prism (stats app) — different domain |

Use `@prsm/cli` as the canonical npm package. Binary stays `prsm`.

---

## Core Primitives

| Primitive | What it defines |
|-----------|----------------|
| **Skill** | A reusable AI behavior unit (`SKILL.yaml` + `SKILL.md`) |
| **Agent** | A specialized subagent (`AGENT.yaml` + `AGENT.md`) |
| **Hook** | Lifecycle shell script (session-start, pre-tool-use, stop, etc.) |
| **Preset** | A curated bundle of skills + agents + hooks + permissions |
| **Workspace** | A repo with `prsm.yaml` at root declaring everything |
| **Runtime Adapter** | Plugin that compiles workspace artifacts to a specific tool's output format |

Skills and agents share the same authoring UX: YAML metadata + markdown content. Hooks are plain shell scripts — prsm wires them into the correct runtime config. Adapters are the only runtime-specific code.

---

## Workspace Structure

```
prsm.yaml               # workspace manifest
prsm.lock               # pinned dependency versions (committed to git)

skills/
  <category>/
    <name>/
      SKILL.yaml        # metadata: name, description, triggers, tools, runtimes
      SKILL.md          # content: instructions the AI follows

agents/
  <name>/
    AGENT.yaml          # metadata: model, tools, description, color
    AGENT.md            # system prompt / instructions

hooks/
  session-start.sh
  pretool-safety.sh
  session-stop.sh

.prsm/
  deps/                 # installed dependency skills (gitignored)
```

---

## Manifest Format

### `prsm.yaml`

```yaml
name: my-platform-hub
version: 1.0.0

runtimes:
  - claude-code
  - codex

extends:
  - prsm-preset-platform-engineering@^2.0.0   # optional preset

dependencies:
  superpowers: "^5.1.0"
  claude-mem: "~2.3.0"

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

registry:
  url: https://raw.githubusercontent.com/prsm-registry/skills/main/registry.json
  # Override to point at a private registry:
  # url: https://raw.githubusercontent.com/myorg/prsm-registry/main/registry.json
```

### `SKILL.yaml`

```yaml
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
  - Grep
```

### `AGENT.yaml`

```yaml
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
```

---

## CLI Commands

```
prsm init [name]          Scaffold a new workspace from template
prsm build                Resolve deps (if needed) + compile all skills/agents → runtime outputs
prsm install              Hydrate .prsm/deps/ from prsm.lock without compiling (CI, new machines)
prsm validate             Lint manifest, skill files, and lock consistency
prsm add <name>[@ver]     Install skill/preset from registry + update prsm.lock
prsm remove <name>        Remove installed skill/preset
prsm publish              Publish a local skill or preset to the registry
prsm search <query>       Search the registry (--presets to filter to presets only)
prsm list                 List installed skills, agents, deps + their runtime targets
prsm eject [name]         Copy preset internals into local skills/ for customization
prsm doctor               Diagnose version mismatches between global and project-local installs
prsm explain <skill>      Show resolved configuration for a skill (origin: local/dep/preset)
```

---

## Dependency Management + Lockfile

### Declaring dependencies

```yaml
# prsm.yaml
dependencies:
  superpowers: "^5.1.0"
  claude-mem: "~2.3.0"
  my-org/internal-skills: "1.0.0"
```

### `prsm.lock` (committed to git)

```yaml
# Auto-generated by prsm. Do not edit manually.
version: 1

superpowers:
  version: 5.1.0
  url: https://raw.githubusercontent.com/prsm-registry/skills/main/superpowers/5.1.0.tar.gz
  checksum: sha256:a3f9c2d8e1b047f3c9a2d5e8f1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8

claude-mem:
  version: 2.3.1
  url: https://raw.githubusercontent.com/prsm-registry/skills/main/claude-mem/2.3.1.tar.gz
  checksum: sha256:b7d1e4f7a0c3d6e9f2a5b8c1d4e7f0a3b6c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1
```

`prsm build` always uses `.prsm/deps/` (locked versions). Version resolution never re-runs unless `prsm add` or `prsm install` is invoked explicitly.

Checksums protect against registry tampering — prsm refuses to use a dep whose hash doesn't match the lockfile.

### Conflict resolution: global vs. project-local

Both Claude Code and Codex resolve project-local skill dirs before global ones:

```
~/.claude/skills/superpowers/   ← global v5.0.0, ignored for this repo
.claude/skills/superpowers/     ← project-local v5.1.0, wins
```

`prsm doctor` surfaces mismatches informatively — no action required, the project version always wins.

---

## Preset System

A preset is a prsm package bundling skills + agents + hooks + permission configs.

### Consuming a preset

```yaml
# prsm.yaml
extends:
  - prsm-preset-platform-engineering@^2.0.0
  - my-org/prsm-preset-internal@1.0.0

# Local definitions override preset on conflict
skills:
  - path: skills/custom/my-copilot
```

### Preset structure

```
prsm-preset-platform-engineering/
  preset.yaml
  skills/
    platform/copilot/
    security/stride/
    adr/lifecycle/
  agents/
    pr-reviewer/
    triage/
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
description: Full platform engineering setup — ADR lifecycle, PR review, threat modeling, Jira
extends:
  - prsm-preset-base@^1.0.0   # presets can extend presets

skills:
  - skills/platform/copilot
  - skills/security/stride
  - skills/adr/lifecycle

agents:
  - agents/pr-reviewer
  - agents/triage

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

### Community conventions

- Naming: `prsm-preset-<name>` for discoverability
- Official community presets live under the `prsm-presets/` GitHub org
- `prsm search --presets` lists available presets with download counts and descriptions

---

## Registry Architecture

GitHub-backed, no custom backend for v1.

### Index format

A public repo (`prsm-registry/skills`) hosts `registry.json`:

```json
{
  "version": 1,
  "skills": {
    "superpowers": {
      "description": "Claude Code superpowers skill library",
      "versions": {
        "5.1.0": {
          "url": "https://raw.githubusercontent.com/prsm-registry/skills/main/superpowers/5.1.0.tar.gz",
          "checksum": "sha256:a3f9c2...",
          "published": "2026-05-01T00:00:00Z"
        }
      },
      "latest": "5.1.0"
    }
  },
  "presets": { }
}
```

Publishing = opening a PR to the registry repo. Consuming = prsm fetches the index, resolves versions, downloads tarballs.

The `version: 1` field in the index allows prsm to migrate to a real API backend later without breaking existing `prsm.lock` files.

---

## Runtime Adapters

Each adapter knows:
1. Output file format for skills (frontmatter fields, directory naming)
2. Output file format for agents (model field, tools format)
3. Where to write outputs
4. How to generate runtime config (`.claude/settings.json` for Claude Code)

**v1 adapters:** `claude-code`, `codex`

Adding a new runtime = adding a new adapter module. No changes to authoring format or core compiler.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Bun | Fast startup, native TS, `bun build --compile` → single binary |
| Language | TypeScript | Low contribution barrier, npm ecosystem, community-friendly |
| CLI framework | `commander` | Proven, minimal |
| Schema validation | `zod` | Type-safe manifest + skill validation |
| YAML parsing | `js-yaml` | Bun-compatible, battle-tested |
| Semver | `semver` | Standard version resolution |
| Terminal output | `chalk` | Standard terminal colors |
| HTTP | `fetch` (native) | Built into Bun, no node-fetch needed |
| Tests | `bun test` | Built-in, no extra dep |

### Distribution

- **npm:** `bunx @prsm/cli` / `npm i -g @prsm/cli` (JS bundle)
- **GitHub Releases:** pre-compiled binaries (macOS arm64/x64, Linux x64, Windows x64) via `bun build --compile`
- **Homebrew tap:** wraps the binary release

The project dogfoods itself: the prsm repo is itself a prsm workspace (`prsm.yaml` at root).

---

## Success Criteria (v1)

1. `prsm init` scaffolds a working workspace in under 60 seconds
2. `prsm build` compiles skills to Claude Code + Codex outputs with zero manual steps
3. `prsm add <skill>` installs from registry, updates lockfile, recompiles
4. `prsm eject` produces locally-owned skill files identical to the preset source
5. Two team members on different machines produce byte-identical `.claude/skills/` output from the same `prsm.lock`
6. At least one community preset ships at launch (`prsm-preset-platform-engineering` seeded from platform-hub)
