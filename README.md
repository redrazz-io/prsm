# prsm

> One source. Every runtime.

prsm (pronounced "prism") is a runtime-agnostic CLI for authoring, compiling, and distributing AI agent skills and workflows. Write skills once in a canonical format — prsm refracts them into whatever AI runtime your team uses.

## Install

```bash
npm i -g @redrazz/prsm
# or
bunx @redrazz/prsm init my-platform
```

## How it works

A prism takes one source beam and splits it into multiple outputs. prsm does the same: one `prsm.yaml` manifest + markdown skill files → Claude Code skills, Codex adapters, hooks, and permission configs — all from a single source of truth.

## Docs

See [`docs/superpowers/specs/2026-05-17-forge-design.md`](docs/superpowers/specs/2026-05-17-forge-design.md) for the full design spec.

## Releasing

Releases are automated via GitHub Actions on a version tag.

1. Bump the version in `package.json`.
2. Tag and push:
   ```bash
   git tag vX.Y.Z      # must equal the package.json version
   git push origin vX.Y.Z
   ```
3. The release workflow verifies the build, publishes `@redrazz/prsm` to npm
   (via OIDC trusted publishing, with provenance), then attaches standalone
   binaries to the GitHub Release.

**One-time setup (maintainer, on npmjs.com):**

- Create the `@redrazz` npm organization (free; allows public scoped packages).
- Register the trusted publisher for `@redrazz/prsm`: GitHub repo
  `redrazz-io/prsm`, workflow `release.yml`. Until this exists, the first
  `npm publish` will fail.
