import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeTextFile, ensureDir, readTextFile } from "../../src/utils/fs";
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
