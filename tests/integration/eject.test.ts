import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeTextFile, ensureDir, readTextFile, fileExists } from "../../src/utils/fs";
import { parseYaml } from "../../src/utils/yaml";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { compile } from "../../src/compiler/index";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-eject-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const CLI = join(import.meta.dir, "../../src/cli.ts");

function runEject(cwd: string, args: string[] = []): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", CLI, "eject", ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function setupPreset(
  presetDir: string,
  spec: { hooks?: Record<string, string>; permissions?: string[]; dependencies?: Record<string, string> },
) {
  await ensureDir(presetDir);
  const presetYaml = [
    "name: test-preset",
    "version: 1.0.0",
    `hooks: ${JSON.stringify(spec.hooks ?? {})}`,
    `permissions: ${JSON.stringify(spec.permissions ?? [])}`,
    `dependencies: ${JSON.stringify(spec.dependencies ?? {})}`,
  ].join("\n");
  await writeTextFile(join(presetDir, "preset.yaml"), presetYaml + "\n");
}

describe("eject manifest merge", () => {
  it("preserves comments in prsm.yaml through eject (AE2 — critical regression)", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, {});

    const manifest = `# Platform team's hub manifest — owned by @platform
name: my-hub
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}

# Hooks below — keep manual
hooks: {}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    const after = await readTextFile(join(tmp, "prsm.yaml"));
    expect(after).toContain("# Platform team's hub manifest — owned by @platform");
    expect(after).toContain("# Hooks below — keep manual");
  });

  it("dedups permissions (AE3): preset perms appended, existing kept once", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, { permissions: ["Bash(git:*)", "Read(./docs/**)"] });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
permissions:
  - Bash(git:*)
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code } = await runEject(tmp);
    expect(code).toBe(0);

    const after = parseYaml<{ permissions: string[] }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.permissions).toEqual(["Bash(git:*)", "Read(./docs/**)"]);
  });

  it("local gains preset hook when local has no value for that event", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, { hooks: { "session-start": "./hooks/session-start.sh" } });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
hooks: {}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code } = await runEject(tmp);
    expect(code).toBe(0);

    const after = parseYaml<{ hooks: Record<string, string> }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.hooks["session-start"]).toBe("./hooks/session-start.sh");
  });

  it("local hook wins when present (last-wins per event)", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, { hooks: { "session-start": "./hooks/preset.sh" } });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
hooks:
  session-start: ./hooks/local.sh
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code } = await runEject(tmp);
    expect(code).toBe(0);

    const after = parseYaml<{ hooks: Record<string, string> }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.hooks["session-start"]).toBe("./hooks/local.sh");
  });

  it("existing dependency keys unchanged (key-level merge)", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, { dependencies: { kubectl: ">=1.28", helm: ">=3.10" } });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
dependencies:
  kubectl: ">=1.20"
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code } = await runEject(tmp);
    expect(code).toBe(0);

    const after = parseYaml<{ dependencies: Record<string, string> }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.dependencies.kubectl).toBe(">=1.20"); // unchanged
    expect(after.dependencies.helm).toBe(">=3.10"); // newly added
  });

  it("local gains preset dependencies when local has none", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, { dependencies: { kubectl: ">=1.28" } });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code } = await runEject(tmp);
    expect(code).toBe(0);

    const after = parseYaml<{ dependencies?: Record<string, string> }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.dependencies?.kubectl).toBe(">=1.28");
  });

  it("multi-preset eject merges both presets' configuration", async () => {
    const presetA = join(tmp, "presets/preset-a");
    const presetB = join(tmp, "presets/preset-b");
    await setupPreset(presetA, { permissions: ["Bash(git:*)"] });
    await setupPreset(presetB, { permissions: ["Read(./**)"], dependencies: { kubectl: ">=1.28" } });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetA}
  - ${presetB}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    const after = parseYaml<{
      permissions?: string[];
      dependencies?: Record<string, string>;
      extends: string[];
    }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.permissions).toContain("Bash(git:*)");
    expect(after.permissions).toContain("Read(./**)");
    expect(after.dependencies?.kubectl).toBe(">=1.28");
    expect(after.extends).toEqual([]);
  });

  it("two presets defining the same hook: LAST preset wins (matches mergeLayers, C1 regression)", async () => {
    const presetA = join(tmp, "presets/preset-a");
    const presetB = join(tmp, "presets/preset-b");
    await setupPreset(presetA, { hooks: { "session-start": "./hooks/a.sh" } });
    await setupPreset(presetB, { hooks: { "session-start": "./hooks/b.sh" } });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetA}
  - ${presetB}
hooks: {}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    const after = parseYaml<{ hooks: Record<string, string> }>(await readTextFile(join(tmp, "prsm.yaml")));
    // LAST preset wins, matching compiler/merger.ts mergeLayers semantics.
    // Before C1 fix, this was './hooks/a.sh' (first preset won) — divergent from build.
    expect(after.hooks["session-start"]).toBe("./hooks/b.sh");
  });

  it("explicit empty-string local hook suppresses preset hook (C1 regression)", async () => {
    // The build path treats empty-string hook values as "no hook" — so an
    // explicit empty string in prsm.yaml is a deliberate suppression that
    // must survive eject. Before C1, eject treated empty string as missing
    // and let preset values override.
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, { hooks: { "session-start": "./hooks/preset.sh" } });

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
hooks:
  session-start: ""
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code } = await runEject(tmp);
    expect(code).toBe(0);

    const after = parseYaml<{ hooks: Record<string, string> }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.hooks["session-start"]).toBe("");
  });

  it("preflight allows valid serialization through (happy path)", async () => {
    // Happy path eject succeeds — proves the preflight does not false-positive
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, { permissions: ["Bash(git:*)"] });
    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);
    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    expect(stderr).not.toContain("Aborting");
  });

  it("makes no filesystem changes when a later preset fails to parse (#7 transactional)", async () => {
    // Preset A is valid and carries a skill file. Preset B has an invalid
    // preset.yaml (missing version) that fails parsing. Pre-fix, eject parsed
    // and copied A inside the EXECUTE loop before reaching B, so A's files were
    // left behind on B's parse failure. The fix moves all parsing into
    // preflight, so nothing is copied when any preset is invalid.
    const presetA = join(tmp, "presets/preset-a");
    const presetB = join(tmp, "presets/preset-b");
    await setupPreset(presetA, {});
    await ensureDir(join(presetA, "skills/cat/from-a"));
    await writeTextFile(
      join(presetA, "skills/cat/from-a/SKILL.md"),
      `---\nname: from-a\ndescription: from preset a\ncategory: cat\n---\n# from-a\n`,
    );
    // Invalid: no `version` — parsePresetManifest rejects this.
    await ensureDir(presetB);
    await writeTextFile(join(presetB, "preset.yaml"), "name: bad-preset\n");

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetA}
  - ${presetB}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);
    const before = await readTextFile(join(tmp, "prsm.yaml"));

    const { code } = await runEject(tmp);
    expect(code).not.toBe(0);

    // Transactional guarantee: preset A's skill must NOT have been copied.
    expect(await fileExists(join(tmp, "skills/cat/from-a/SKILL.md"))).toBe(false);
    // prsm.yaml must be untouched (extends still lists both presets).
    expect(await readTextFile(join(tmp, "prsm.yaml"))).toBe(before);
  });

  it("rolls back copied files when a later preset's copy fails mid-execute (Codex adversarial #1)", async () => {
    // Both presets parse cleanly (so preflight passes), but preset B's copy is
    // forced to fail during EXECUTE: the workspace has `skills/dog` as a FILE,
    // so creating `skills/dog/b/` (for B's skill) hits ENOTDIR. Preset A's skill
    // copies first; the transaction must roll it back so no partial state remains.
    const presetA = join(tmp, "presets/preset-a");
    const presetB = join(tmp, "presets/preset-b");
    await setupPreset(presetA, {});
    await setupPreset(presetB, {});
    await ensureDir(join(presetA, "skills/cat/a"));
    await writeTextFile(
      join(presetA, "skills/cat/a/SKILL.md"),
      `---\nname: a\ndescription: from a\ncategory: cat\n---\n# a\n`,
    );
    await ensureDir(join(presetB, "skills/dog/b"));
    await writeTextFile(
      join(presetB, "skills/dog/b/SKILL.md"),
      `---\nname: b\ndescription: from b\ncategory: dog\n---\n# b\n`,
    );

    // Land mine: skills/dog is a regular file, so B's mkdir(skills/dog/b) fails.
    await ensureDir(join(tmp, "skills"));
    await writeTextFile(join(tmp, "skills/dog"), "not a directory\n");

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetA}
  - ${presetB}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);
    const before = await readTextFile(join(tmp, "prsm.yaml"));

    const { code, stderr } = await runEject(tmp);
    expect(code).not.toBe(0);
    expect(stderr).toContain("rolled back");

    // Preset A's already-copied skill (and the dirs created for it) are gone.
    expect(await fileExists(join(tmp, "skills/cat/a/SKILL.md"))).toBe(false);
    expect(await fileExists(join(tmp, "skills/cat"))).toBe(false);
    // The pre-existing land-mine file is untouched (we did not create it).
    expect(await fileExists(join(tmp, "skills/dog"))).toBe(true);
    // prsm.yaml is unchanged — extends still lists both presets.
    expect(await readTextFile(join(tmp, "prsm.yaml"))).toBe(before);
  });

  it("restores prsm.yaml when the write phase fails AFTER the manifest is rewritten (Codex adversarial #1)", async () => {
    // The skill copies and the prsm.yaml rewrite succeed, then the lockfile step
    // fails (prsm.lock is a directory → read throws). Rollback must undo BOTH the
    // copies AND the manifest rewrite, leaving the workspace exactly as found.
    const presetDir = join(tmp, "presets/preset-a");
    await setupPreset(presetDir, {});
    await ensureDir(join(presetDir, "skills/cat/a"));
    await writeTextFile(
      join(presetDir, "skills/cat/a/SKILL.md"),
      `---\nname: a\ndescription: from a\ncategory: cat\n---\n# a\n`,
    );

    // Land mine: prsm.lock is a directory, so the lockfile read/write throws
    // after prsm.yaml has already been rewritten.
    await ensureDir(join(tmp, "prsm.lock"));

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);
    const before = await readTextFile(join(tmp, "prsm.yaml"));

    const { code, stderr } = await runEject(tmp);
    expect(code).not.toBe(0);
    expect(stderr).toContain("rolled back");

    // Copies undone…
    expect(await fileExists(join(tmp, "skills/cat/a/SKILL.md"))).toBe(false);
    // …and the manifest restored to its original (extends still present).
    expect(await readTextFile(join(tmp, "prsm.yaml"))).toBe(before);
  });

  it("materializes the full transitive closure — inherited content survives (Codex #2)", async () => {
    // workspace extends team; team extends base. After eject the workspace must
    // be self-contained: base's skills, hooks, permissions, and dependencies
    // (inherited transitively) must all land locally, not just team's own.
    const baseDir = join(tmp, "presets/base");
    const teamDir = join(tmp, "presets/team");
    await ensureDir(join(baseDir, "skills/security/from-base"));
    await writeTextFile(
      join(baseDir, "preset.yaml"),
      [
        "name: base",
        "version: 1.0.0",
        "hooks:",
        "  session-start: ./hooks/base.sh",
        "permissions:",
        "  - Bash(git:*)",
        "dependencies:",
        '  kubectl: ">=1.28"',
      ].join("\n") + "\n",
    );
    await writeTextFile(
      join(baseDir, "skills/security/from-base/SKILL.md"),
      `---\nname: from-base\ndescription: base skill\ncategory: security\n---\n# from-base\n`,
    );
    await ensureDir(join(teamDir, "skills/platform/from-team"));
    await writeTextFile(
      join(teamDir, "preset.yaml"),
      `name: team\nversion: 1.0.0\nextends:\n  - ${baseDir}\n`,
    );
    await writeTextFile(
      join(teamDir, "skills/platform/from-team/SKILL.md"),
      `---\nname: from-team\ndescription: team skill\ncategory: platform\n---\n# from-team\n`,
    );

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${teamDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    // Inherited (base) AND direct (team) skill files both materialized locally.
    expect(await fileExists(join(tmp, "skills/security/from-base/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, "skills/platform/from-team/SKILL.md"))).toBe(true);

    // Inherited hooks / permissions / dependencies merged into prsm.yaml.
    const after = parseYaml<{
      hooks: Record<string, string>;
      permissions: string[];
      dependencies: Record<string, string>;
      extends: string[];
    }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.hooks["session-start"]).toBe("./hooks/base.sh");
    expect(after.permissions).toContain("Bash(git:*)");
    expect(after.dependencies.kubectl).toBe(">=1.28");
    expect(after.extends).toEqual([]);
  });

  it("preserves direct-preset precedence: a later direct preset wins over the same preset reached transitively (Codex #3)", async () => {
    // extends: [team, base] where team extends base. Both define skills/security/shared/SKILL.md.
    // build processes each direct extends entry as its own layer in declaration order, so the
    // DIRECT base (last) wins the collision. eject must reproduce that — not let team win because
    // base was first seen as team's transitive dependency.
    const baseDir = join(tmp, "presets/base");
    const teamDir = join(tmp, "presets/team");
    await ensureDir(join(baseDir, "skills/security/shared"));
    await writeTextFile(join(baseDir, "preset.yaml"), "name: base\nversion: 1.0.0\n");
    await writeTextFile(
      join(baseDir, "skills/security/shared/SKILL.md"),
      `---\nname: shared\ndescription: shared skill\ncategory: security\n---\n# shared\nBASE_VERSION\n`,
    );
    await ensureDir(join(teamDir, "skills/security/shared"));
    await writeTextFile(join(teamDir, "preset.yaml"), `name: team\nversion: 1.0.0\nextends:\n  - ${baseDir}\n`);
    await writeTextFile(
      join(teamDir, "skills/security/shared/SKILL.md"),
      `---\nname: shared\ndescription: shared skill\ncategory: security\n---\n# shared\nTEAM_VERSION\n`,
    );

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${teamDir}
  - ${baseDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    // Direct base is the last extends entry → its version wins, matching build.
    const shared = await readTextFile(join(tmp, "skills/security/shared/SKILL.md"));
    expect(shared).toContain("BASE_VERSION");
    expect(shared).not.toContain("TEAM_VERSION");
  });

  it("ejects a skills-shaped repo — materializes its SKILL.md files, empties extends (BR2)", async () => {
    // A workspace extending a skills-shaped repo (no preset.yaml) must be
    // ejectable: eject calling resolvePresetClosure unconditionally threw
    // 'preset.yaml not found'. eject now branches on skills-shaped like install/build.
    const repo = join(tmp, "skills-repo");
    await ensureDir(join(repo, "skills/security/from-skills"));
    await writeTextFile(
      join(repo, "skills/security/from-skills/SKILL.md"),
      `---\nname: from-skills\ndescription: a skills-shaped skill\ncategory: security\n---\n# from-skills\n`,
    );

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${repo}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    // Skill file materialized locally; workspace is now self-contained.
    expect(await fileExists(join(tmp, "skills/security/from-skills/SKILL.md"))).toBe(true);
    const after = parseYaml<{ extends: string[] }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.extends).toEqual([]);
  });

  it("ejecting a 2-level skills-shaped repo leaves a self-contained workspace that builds (P2a)", async () => {
    // A skills-shaped repo can use the canonical 2-level layout
    // (skills/<name>/SKILL.md, no category dir). eject copies skills/ verbatim,
    // so the ejected workspace ends up with a 2-level local tree. The local
    // loader used to discover ONLY 3-level skills/<cat>/<name>/SKILL.md, so the
    // ejected skill was silently dropped at the next build — the workspace was
    // NOT self-contained. The loader now reads both layouts.
    const repo = join(tmp, "flat-skills-repo");
    await ensureDir(join(repo, "skills/flat-skill"));
    await writeTextFile(
      join(repo, "skills/flat-skill/SKILL.md"),
      `---\nname: flat-skill\ndescription: a 2-level skills-shaped skill\n---\n# flat-skill\n`,
    );

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${repo}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code, stderr } = await runEject(tmp);
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    // The 2-level tree is copied verbatim and extends is emptied.
    expect(await fileExists(join(tmp, "skills/flat-skill/SKILL.md"))).toBe(true);
    const after = parseYaml<{ extends: string[] }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.extends).toEqual([]);

    // The real assertion: a plain local build (no extends, no lockfile) must
    // emit the ejected skill — proving the workspace is genuinely self-contained.
    await compile(tmp);
    // No category in frontmatter → resolved category "general".
    expect(await fileExists(join(tmp, ".claude/skills/hub-general-flat-skill/SKILL.md"))).toBe(true);
  });

  it("removes ejected presets from extends list", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await setupPreset(presetDir, {});

    const manifest = `name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);

    const { code } = await runEject(tmp);
    expect(code).toBe(0);

    const after = parseYaml<{ extends: string[] }>(await readTextFile(join(tmp, "prsm.yaml")));
    expect(after.extends).toEqual([]);
  });
});
