import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { compile } from "../../src/compiler/index";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs";
import { computePresetContentHash } from "../../src/core/preset";
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

  it("filters per-item frontmatter.runtimes when emitting to each adapter (#3)", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
    // A skill declared for claude-code only — must NOT reach the Codex output.
    await ensureDir(join(tmp, "skills/platform/claude-only"));
    await writeTextFile(
      join(tmp, "skills/platform/claude-only/SKILL.md"),
      `---
name: claude-only
description: Claude-only skill
category: platform
runtimes:
  - claude-code
---
# Claude Only
`,
    );

    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/skills/hub-platform-claude-only/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".agents/skills/hub-platform-claude-only/SKILL.md"))).toBe(false);
  });

  it("emits items with no frontmatter.runtimes to every workspace runtime (#3 default)", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
    // SKILL_MD has no `runtimes:` field — defaults to all workspace runtimes.
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

    // Create prsm.lock with correct checksum — hash the full preset content tree
    const checksum = `sha256:${await computePresetContentHash(presetDir)}`;
    const lock: LockFile = {
      version: 1,
      presets: { "test-preset": { version: "1.0.0", url: presetDir, checksum } },
      resolvedAt: new Date().toISOString(),
    };
    await writeTextFile(join(tmp, "prsm.lock"), "# Auto-generated\n" + dumpYaml(lock));

    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/skills/hub-security-preset-skill/SKILL.md"))).toBe(true);
  });

  // CRITICAL REGRESSION (AE1): mutating any file inside an installed preset
  // must cause prsm compile to fail. Pre-U4, the checksum hashed only
  // preset.yaml — so editing skills/foo/SKILL.md was undetected.
  it("compile fails when a SKILL.md inside an installed preset is mutated", async () => {
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

    const { runInstall } = await import("../../src/commands/install");
    await runInstall(tmp);

    // Tamper with the SKILL.md (the bug U4 closes)
    await writeTextFile(
      join(presetDir, "skills/security/preset-skill/SKILL.md"),
      PRESET_SKILL_MD + "\nMALICIOUS APPEND\n",
    );

    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });

  it("compile fails when a TRANSITIVE (extended) preset is mutated after install (Codex #1)", async () => {
    // base <- team(extends base) <- workspace(extends team). Mutating base
    // after install must be caught: install locks the full closure and compile
    // verifies every transitive preset, not just the workspace's direct extends.
    const baseDir = join(tmp, "presets/base");
    const teamDir = join(tmp, "presets/team");
    await ensureDir(join(baseDir, "skills/security/from-base"));
    await writeTextFile(join(baseDir, "preset.yaml"), "name: base\nversion: 1.0.0\n");
    await writeTextFile(
      join(baseDir, "skills/security/from-base/SKILL.md"),
      `---\nname: from-base\ndescription: base skill\ncategory: security\n---\n# from-base\n`,
    );
    await ensureDir(teamDir);
    await writeTextFile(join(teamDir, "preset.yaml"), `name: team\nversion: 1.0.0\nextends:\n  - ${baseDir}\n`);

    const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${teamDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

    const { runInstall } = await import("../../src/commands/install");
    await runInstall(tmp);

    // Tamper with the TRANSITIVE base preset (not the direct one)
    await writeTextFile(
      join(baseDir, "skills/security/from-base/SKILL.md"),
      `---\nname: from-base\ndescription: base skill\ncategory: security\n---\n# from-base\nTAMPERED\n`,
    );

    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });

  it("compile fails when an AGENT.md inside an installed preset is mutated", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await ensureDir(join(presetDir, "agents/my-agent"));
    await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
    await writeTextFile(
      join(presetDir, "agents/my-agent/AGENT.md"),
      "---\nname: my-agent\ndescription: x\n---\nbody\n",
    );

    const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

    const { runInstall } = await import("../../src/commands/install");
    await runInstall(tmp);

    await writeTextFile(
      join(presetDir, "agents/my-agent/AGENT.md"),
      "---\nname: my-agent\ndescription: tampered\n---\nbody\n",
    );

    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });

  it("resolves a relative extends: path against the workspace root, not CWD (#6)", async () => {
    // The test process CWD is the repo root, not `tmp`. A relative `extends:`
    // entry must resolve against the workspace root (tmp) that install/compile
    // are handed — not against process.cwd().
    const presetDir = join(tmp, "presets/test-preset");
    await ensureDir(join(presetDir, "skills/security/preset-skill"));
    await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
    await writeTextFile(join(presetDir, "skills/security/preset-skill/SKILL.md"), PRESET_SKILL_MD);

    const manifestRelative = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ./presets/test-preset
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestRelative);

    const { runInstall } = await import("../../src/commands/install");
    await runInstall(tmp);
    await expect(compile(tmp)).resolves.toBeUndefined();
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

  it("settings.json survives a second build (not deleted by clean)", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST + `\nhooks:\n  stop: hooks/stop.sh\n`);
    await ensureDir(join(tmp, ".claude"));
    await writeTextFile(join(tmp, ".claude/settings.json"), JSON.stringify({ userKey: "must-survive" }, null, 2));

    await compile(tmp);
    await compile(tmp); // second build

    const { readTextFile: rt } = await import("../../src/utils/fs");
    const settings = JSON.parse(await rt(join(tmp, ".claude/settings.json")));
    expect(settings.userKey).toBe("must-survive");
    expect(settings.hooks.Stop).toBeDefined();
  });

  it("install then build succeeds when preset.yaml has a trailing newline", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await ensureDir(join(presetDir, "skills/security/preset-skill"));
    // Trailing newline — a common POSIX file convention
    const presetYamlWithNewline = PRESET_YAML + "\n";
    await writeTextFile(join(presetDir, "preset.yaml"), presetYamlWithNewline);
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

    // Simulate prsm install: hash raw content, same as the file on disk
    const { runInstall } = await import("../../src/commands/install");
    await runInstall(tmp);

    // prsm build must succeed — no checksum mismatch
    await expect(compile(tmp)).resolves.toBeUndefined();
    expect(await fileExists(join(tmp, ".claude/skills/hub-security-preset-skill/SKILL.md"))).toBe(true);
  });

  it("emits manifest.permissions into .claude/settings.json (C2 regression)", async () => {
    // Regression for Codex adversarial review finding: loadWorkspace was
    // discarding manifest.permissions, so locally declared permissions never
    // reached the build output even after eject wrote them into prsm.yaml.
    const manifestWithPerms = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
permissions:
  - Bash(git:*)
  - Read(./docs/**)
output:
  claude-code:
    settings: .claude/settings.json
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPerms);

    await compile(tmp);

    const { readTextFile } = await import("../../src/utils/fs");
    const settings = JSON.parse(await readTextFile(join(tmp, ".claude/settings.json")));
    expect(settings.permissions.allow).toContain("Bash(git:*)");
    expect(settings.permissions.allow).toContain("Read(./docs/**)");
  });

  it("pre-existing Codex skills are not deleted on prsm build", async () => {
    const manifestCodexOnly = `
name: test-ws
version: 1.0.0
runtimes:
  - codex
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestCodexOnly);
    await ensureDir(join(tmp, "skills/platform/my-skill"));
    await writeTextFile(join(tmp, "skills/platform/my-skill/SKILL.md"), SKILL_MD);

    // Pre-existing user-authored Codex skill outside the hub- namespace
    await ensureDir(join(tmp, ".agents/skills/hand-authored-skill"));
    await writeTextFile(join(tmp, ".agents/skills/hand-authored-skill/SKILL.md"), "# Hand-authored");

    await compile(tmp);

    // prsm-generated skill must exist
    expect(await fileExists(join(tmp, ".agents/skills/hub-platform-my-skill/SKILL.md"))).toBe(true);
    // User-authored skill must NOT be deleted
    expect(await fileExists(join(tmp, ".agents/skills/hand-authored-skill/SKILL.md"))).toBe(true);
  });
});
