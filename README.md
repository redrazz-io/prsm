# prsm

> One source. Every runtime.

prsm (pronounced "prism") is a runtime-agnostic CLI for authoring, compiling, and distributing AI agent skills and workflows. Write skills once in a canonical format — prsm refracts them into whatever AI runtime your team uses.

## Install

```bash
npm i -g @prsm/cli
# or
bunx @prsm/cli init my-platform
```

## How it works

A prism takes one source beam and splits it into multiple outputs. prsm does the same: one `prsm.yaml` manifest + markdown skill files → Claude Code skills, Codex adapters, hooks, and permission configs — all from a single source of truth.

## Docs

See [`docs/superpowers/specs/2026-05-17-forge-design.md`](docs/superpowers/specs/2026-05-17-forge-design.md) for the full design spec.
