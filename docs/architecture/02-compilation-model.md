# 02 — Compilation Model

`prsm build` is the core operation. It reads the workspace manifest, resolves all sources (local skills, deps, preset layers), and dispatches to runtime adapters to emit outputs.

## Build Pipeline

```mermaid
flowchart TD
    A([prsm build]) --> B[Parse prsm.yaml\nValidate schema with zod]
    B --> C{prsm.lock\nexists?}

    C -->|yes| D[Read locked versions\nfrom prsm.lock]
    C -->|no| E[No deps declared\nskip dep resolution]

    D --> F[Hydrate .prsm/deps/\nif not already present]
    F --> G[Verify checksums\nagainst prsm.lock]
    G -->|mismatch| ERR1([Error: checksum mismatch\nrun prsm install to fix])
    G -->|ok| H

    E --> H[Resolve Preset Layers]
    H --> I{extends:\ndeclared?}

    I -->|yes| J[Preset Engine:\nresolve extends chain]
    J --> K[Merge layers:\nbase → extends → local]
    I -->|no| K

    K --> L[Collect unified workspace:\nskills + agents + hooks + permissions]
    L --> M{For each\nruntime in prsm.yaml}

    M --> N[Claude Code Adapter]
    M --> O[Codex Adapter]
    M --> P[... future adapters]

    N --> Q[.claude/skills/\n.claude/agents/\n.claude/settings.json]
    O --> R[.agents/skills/]
    P --> S[runtime-specific output]

    Q & R & S --> DONE([Build complete])
```

## Workspace Model

Before dispatching to adapters, the compiler builds a unified in-memory model:

```
WorkspaceModel {
  name: string
  version: string
  runtimes: string[]
  skills: ResolvedSkill[]     // local + from deps + from presets, merged
  agents: ResolvedAgent[]
  hooks: ResolvedHooks
  permissions: ResolvedPermissions
}

ResolvedSkill {
  name: string
  category: string
  version: string
  content: string             // SKILL.md content
  metadata: SkillMetadata     // parsed SKILL.yaml
  origin: "local" | "dep" | "preset"
  originDetail: string        // path or package@version
}
```

## Skill Resolution Order

When the same skill name appears in multiple sources, last-wins applies:

```mermaid
flowchart LR
    A[prsm-preset-base\nskills] -->|layer 1| M[Merger]
    B[prsm-preset-platform\nskills] -->|layer 2| M
    C[.prsm/deps/\nskills] -->|layer 3| M
    D[local skills/\ndirectory] -->|layer 4 — wins| M
    M --> E[WorkspaceModel.skills]
```

`prsm explain <skill-name>` shows which layer a skill came from and why.

## Output Directory Structure

### Claude Code adapter output

```
.claude/
  skills/
    hub-platform-copilot/
      SKILL.md              # compiled from skills/platform/copilot/SKILL.md
    hub-security-stride/
      SKILL.md
    superpowers/            # from dep prsm.lock: superpowers@5.1.0
      using-superpowers/
        SKILL.md
  agents/
    pr-reviewer.md          # compiled from agents/pr-reviewer/AGENT.md
  settings.json             # hooks + permissions generated from prsm.yaml
```

### Codex adapter output

```
.agents/
  skills/
    hub-platform-copilot/
      SKILL.md
    hub-security-stride/
      SKILL.md
```

## Incremental Builds

`prsm build` is idempotent — running it multiple times produces identical output. Output dirs are wiped and rewritten on each build to prevent stale artifacts from lingering.
