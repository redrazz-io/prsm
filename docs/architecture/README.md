# prsm Architecture

Architecture documentation for prsm — the runtime-agnostic AI agent skill compiler.

## Documents

| Doc | What it covers |
|-----|---------------|
| [01-overview.md](01-overview.md) | System context, containers, and core mental model |
| [02-compilation-model.md](02-compilation-model.md) | How `prsm build` transforms manifests into runtime outputs |
| [03-dependency-resolution.md](03-dependency-resolution.md) | Lockfile, version pinning, registry fetching, conflict handling |
| [04-preset-system.md](04-preset-system.md) | Preset extends chains, merge strategy, eject |
| [05-registry.md](05-registry.md) | GitHub-backed registry, publish/consume flow, index format |
| [06-runtime-adapters.md](06-runtime-adapters.md) | Adapter interface, Claude Code and Codex outputs |

## Core Mental Model

A prism takes one source beam and refracts it into multiple distinct outputs — same signal, different wavelengths. prsm applies this to AI agent workflows:

```
prsm.yaml + skills/ + agents/ + hooks/
            │
            ▼
        prsm build
            │
     ┌──────┴──────┐
     ▼             ▼
.claude/skills/  .agents/skills/
.claude/agents/
settings.json
```

One canonical source. Multiple runtime outputs. Same workflow semantics everywhere.
