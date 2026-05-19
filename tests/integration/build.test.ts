import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { compile } from "../../src/compiler/index";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs";
import { sha256Hex } from "../../src/utils/checksum";
import { dumpYaml } from "../../src/utils/yaml";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { LockFile } from "../../src/types";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-build-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const MANIFEST = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
  - codex
output:
  claude-code:
    skills: .claude/skills/
  codex:
    skills: .agents/skills/
`;

const SKILL_MD = `---
name: my-skill
description: A test skill
category: platform
triggers:
  - invoke my skill
---
# My Skill
Content here.
`;

const PRESET_SKILL_MD = `---
name: preset-skill
description: A skill from a preset
category: security
---
# Preset Skill
From preset.
`;

const PRESET_YAML = `
name: test-preset
version: 1.0.0
skills: []
agents: []
hooks: {}
permissions: []
`;

describe("compile", () => {
  it("outputs local skill to both runtimes", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
    await ensureDir(join(tmp, "skills/platform/my-skill"));
    await writeTextFile(join(tmp, "skills/platform/my-skill/SKILL.md"), SKILL_MD);

    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/skills/hub-platform-my-skill/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".agents/skills/hub-platform-my-skill/SKILL.md"))).toBe(true);
  });

  it("generates .claude/settings.json when hooks are declared", async () => {
    const manifestWithHooks = MANIFEST + `\nhooks:\n  stop: hooks/stop.sh\n`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithHooks);

    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/settings.json"))).toBe(true);
  });

  it("preset skill appears in build output when extends + prsm.lock present", async () => {
    // Set up a local preset directory
    const presetDir = join(tmp, "presets/test-preset");
    await ensureDir(join(presetDir, "skills/security/preset-skill"));
    await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
    await writeTextFile(join(presetDir, "skills/security/preset-skill/SKILL.md"), PRESET_SKILL_MD);

    const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

    // Create prsm.lock with correct checksum
    const presetYamlContent = PRESET_YAML.trim();
    const checksum = `sha256:${await sha256Hex(presetYamlContent)}`;
    const lock: LockFile = {
      version: 1,
      presets: { "test-preset": { version: "1.0.0", url: presetDir, checksum } },
      resolvedAt: new Date().toISOString(),
    };
    await writeTextFile(join(tmp, "prsm.lock"), "# Auto-generated\n" + dumpYaml(lock));

    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/skills/hub-security-preset-skill/SKILL.md"))).toBe(true);
  });

  it("throws when extends declared but prsm.lock missing", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await ensureDir(presetDir);
    await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
    const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);
    await expect(compile(tmp)).rejects.toThrow("prsm.lock");
  });

  it("throws when preset checksum does not match prsm.lock", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await ensureDir(presetDir);
    await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
    const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

    const lock: LockFile = {
      version: 1,
      presets: { "test-preset": { version: "1.0.0", url: presetDir, checksum: "sha256:badhash" } },
      resolvedAt: new Date().toISOString(),
    };
    await writeTextFile(join(tmp, "prsm.lock"), "# Auto-generated\n" + dumpYaml(lock));

    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });

  it("preserves existing non-prsm settings.json keys after rebuild", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST + `\nhooks:\n  stop: hooks/stop.sh\n`);
    // Pre-existing user-authored settings
    await ensureDir(join(tmp, ".claude"));
    await writeTextFile(join(tmp, ".claude/settings.json"), JSON.stringify({ myCustomKey: "preserved" }, null, 2));

    await compile(tmp);

    const settings = JSON.parse(await (await import("../../src/utils/fs")).readTextFile(join(tmp, ".claude/settings.json")));
    expect(settings.myCustomKey).toBe("preserved");
    expect(settings.hooks.Stop).toBeDefined();
  });
});
