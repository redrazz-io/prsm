import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeTextFile, ensureDir, readTextFile, fileExists } from "../../src/utils/fs";
import { parseYaml } from "../../src/utils/yaml";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { spawn } from "child_process";

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
