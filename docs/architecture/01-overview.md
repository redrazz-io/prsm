# 01 — System Overview

## System Context (C4 Level 1)

Who interacts with prsm and what external systems it touches.

```mermaid
C4Context
    title prsm — System Context

    Person(author, "Skill Author", "Writes skills/agents/presets in canonical format, publishes to registry")
    Person(consumer, "Team Member", "Installs and builds skills for their AI runtime")

    System(prsm, "prsm", "CLI compiler + registry client for portable AI agent skills")

    System_Ext(registry, "prsm Registry", "GitHub-backed index of community skills and presets")
    System_Ext(claudecode, "Claude Code", "Anthropic's AI coding assistant — consumes .claude/ outputs")
    System_Ext(codex, "Codex CLI", "OpenAI's coding assistant — consumes .agents/ outputs")
    System_Ext(gh, "GitHub", "Hosts registry repo, preset repos, and skill source repos")

    Rel(author, prsm, "prsm publish")
    Rel(consumer, prsm, "prsm add / prsm install / prsm build")
    Rel(prsm, registry, "fetch index, download tarballs", "HTTPS")
    Rel(prsm, claudecode, "writes .claude/skills/, .claude/agents/, .claude/settings.json")
    Rel(prsm, codex, "writes .agents/skills/")
    Rel(prsm, gh, "PR-based publishing, tarball hosting")
```

## Container Diagram (C4 Level 2)

Internal components of the prsm CLI.

```mermaid
C4Container
    title prsm — Containers

    Person(user, "User")

    Container(cli, "CLI", "Bun / TypeScript", "Command router: init, build, add, publish, install, eject, doctor, explain")
    Container(compiler, "Compiler", "TypeScript", "Reads resolved workspace, dispatches each primitive to the right adapter")
    Container(resolver, "Manifest Resolver", "TypeScript", "Merges prsm.yaml + preset layers + dep skills into a unified workspace model")
    Container(dep_resolver, "Dependency Resolver", "TypeScript", "Semver resolution, prsm.lock read/write, checksum verification")
    Container(registry_client, "Registry Client", "TypeScript", "HTTP fetch, index caching, tarball download and extraction")
    Container(preset_engine, "Preset Engine", "TypeScript", "Resolves extends chains, applies layer merge strategy")
    Container(adapter_cc, "Claude Code Adapter", "TypeScript", "Emits .claude/skills/, .claude/agents/, .claude/settings.json")
    Container(adapter_codex, "Codex Adapter", "TypeScript", "Emits .agents/skills/")

    Rel(user, cli, "runs commands")
    Rel(cli, resolver, "build, add, eject")
    Rel(cli, dep_resolver, "add, install")
    Rel(cli, registry_client, "add, search, publish")
    Rel(resolver, preset_engine, "when extends: present")
    Rel(resolver, compiler, "resolved workspace")
    Rel(compiler, adapter_cc, "for claude-code runtime")
    Rel(compiler, adapter_codex, "for codex runtime")
    Rel(dep_resolver, registry_client, "download tarballs")
```

## Key Invariants

- **Source of truth is the workspace.** `prsm.yaml` + `prsm.lock` + `skills/` fully describe the build. Runtime outputs (`.claude/`, `.agents/`) are derived artifacts and can be regenerated at any time.
- **Lockfile pins exact versions.** `prsm build` never re-resolves from the registry. It always uses what `prsm.lock` says.
- **Project-local always beats global.** Both Claude Code and Codex resolve project-local dirs before `~/.claude/skills/` or global installs. prsm only writes to project-local dirs.
- **Adapters are the only runtime-specific code.** All authoring primitives (SKILL.yaml, AGENT.yaml, hooks) are runtime-agnostic. Only adapters know the target format.
