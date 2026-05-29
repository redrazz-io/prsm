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

## Compatibility with Agent Skills

prsm sits one layer above Agent Skills — it does not replace them. A skill is the unit
of capability (a `SKILL.md` with frontmatter and instructions); prsm is the source layer
that authors, composes, and refracts those skills across runtimes.

Because of that layering, prsm can **consume** an existing skills repo directly. If you
point `extends:` at a directory that has no `preset.yaml` but does have a `skills/` tree,
prsm treats it as a "skills-shaped repo" — a preset without the manifest — and installs
its `SKILL.md` files. Both the canonical Agent Skills layout (`skills/<name>/SKILL.md`)
and prsm's categorized layout (`skills/<category>/<name>/SKILL.md`) are recognized:

```yaml
# prsm.yaml
extends:
  - ./vendor/some-skills-repo   # no preset.yaml, just skills/
```

```text
→ Detected skills-shaped repo; installing 4 SKILL.md files from skills/. Use --strict-preset to require preset.yaml.
```

The same content-hash integrity gate applies: the skills-shaped source is locked in
`prsm.lock` and verified at build time, so a mutated skill is caught just like a mutated
preset. When a directory has **both** `preset.yaml` and `skills/`, the `preset.yaml` path
always wins.

For CI or locked-down setups where every source must carry an explicit manifest, pass
`--strict-preset` to `prsm install` or `prsm build` and prsm will fail fast on any
`extends:` ref that lacks a `preset.yaml`.

## Docs

See [`docs/superpowers/specs/2026-05-17-forge-design.md`](docs/superpowers/specs/2026-05-17-forge-design.md) for the full design spec.
