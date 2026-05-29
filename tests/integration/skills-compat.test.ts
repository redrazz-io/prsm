import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runInstall } from "../../src/commands/install";
import { compile } from "../../src/compiler/index";
import { readLockFile } from "../../src/core/lockfile";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs";
import { join, basename } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-skills-compat-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const SKILL_A = `---
name: skill-a
description: First skill from a skills-shaped repo
category: security
---
# Skill A
From a skills-shaped repo.
`;

const SKILL_B = `---
name: skill-b
description: Second skill from a skills-shaped repo
category: platform
---
# Skill B
Also from a skills-shaped repo.
`;

const PRESET_YAML = `
name: real-preset
version: 2.0.0
skills: []
agents: []
hooks: {}
permissions: []
`;

const PRESET_SKILL = `---
name: preset-skill
description: A skill that lives in a real preset
category: security
---
# Preset Skill
`;

/**
 * A "skills-shaped repo" is a directory with NO preset.yaml at its root, but
 * WITH a skills/<category>/<name>/SKILL.md tree. prsm treats it as a preset
 * without the manifest (Block 2, Approach B: the interop bridge).
 */
async function makeSkillsShapedRepo(dir: string): Promise<void> {
  await ensureDir(join(dir, "skills/security/skill-a"));
  await ensureDir(join(dir, "skills/platform/skill-b"));
  await writeTextFile(join(dir, "skills/security/skill-a/SKILL.md"), SKILL_A);
  await writeTextFile(join(dir, "skills/platform/skill-b/SKILL.md"), SKILL_B);
}

function manifestExtending(presetDir: string): string {
  return `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
}

describe("skills-compat interop bridge (Block 2)", () => {
  // (a) auto-detect happy path
  it("install auto-detects a skills-shaped repo and locks a synthetic entry", async () => {
    const repo = join(tmp, "skills-repo");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);

    const lock = await readLockFile(join(tmp, "prsm.lock"));
    expect(lock).not.toBeNull();
    const synthName = `skills:${basename(repo)}`;
    expect(lock!.presets[synthName]).toBeDefined();
    expect(lock!.presets[synthName].version).toBe("0.0.0");
    expect(lock!.presets[synthName].checksum).toMatch(/^sha256:/);
  });

  it("build emits the SKILL.md files from a skills-shaped repo", async () => {
    const repo = join(tmp, "skills-repo");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);
    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/skills/hub-security-skill-a/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".claude/skills/hub-platform-skill-b/SKILL.md"))).toBe(true);
  });

  // (b) --strict-preset error path
  it("install with strictPreset fails fast when no preset.yaml is found", async () => {
    const repo = join(tmp, "skills-repo");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await expect(runInstall(tmp, { strictPreset: true })).rejects.toThrow(/preset\.yaml/);
  });

  it("build with strictPreset fails fast when no preset.yaml is found", async () => {
    const repo = join(tmp, "skills-repo");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp); // lock the skills-shaped repo normally
    await expect(compile(tmp, { strictPreset: true })).rejects.toThrow(/preset\.yaml/);
  });

  // (c) precedence: preset.yaml present + skills/ present → preset.yaml path wins
  it("prefers the preset.yaml path when both preset.yaml and skills/ exist", async () => {
    const repo = join(tmp, "hybrid-preset");
    await ensureDir(join(repo, "skills/security/preset-skill"));
    await writeTextFile(join(repo, "preset.yaml"), PRESET_YAML);
    await writeTextFile(join(repo, "skills/security/preset-skill/SKILL.md"), PRESET_SKILL);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);

    const lock = await readLockFile(join(tmp, "prsm.lock"));
    // The real preset identity must be used — NOT the synthetic skills: identity.
    expect(lock!.presets["real-preset"]).toBeDefined();
    expect(lock!.presets["real-preset"].version).toBe("2.0.0");
    expect(lock!.presets[`skills:${basename(repo)}`]).toBeUndefined();

    await compile(tmp);
    expect(await fileExists(join(tmp, ".claude/skills/hub-security-preset-skill/SKILL.md"))).toBe(true);
  });

  // (d) end-to-end: install → build → skill appears in output
  it("installs one skills-shaped repo end-to-end and logs the detection line", async () => {
    const repo = join(tmp, "my-skills");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await runInstall(tmp);
    } finally {
      console.log = orig;
    }

    // Detection log line must be emitted with the file count.
    const joined = logs.join("\n");
    expect(joined).toContain("Detected skills-shaped repo");
    expect(joined).toContain("2 SKILL.md");
    expect(joined).toContain("--strict-preset");

    await compile(tmp);
    expect(await fileExists(join(tmp, ".claude/skills/hub-security-skill-a/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".claude/skills/hub-platform-skill-b/SKILL.md"))).toBe(true);
  });

  it("compile fails when a skills-shaped repo is mutated after install (integrity holds)", async () => {
    const repo = join(tmp, "skills-repo");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);

    await writeTextFile(join(repo, "skills/security/skill-a/SKILL.md"), SKILL_A + "\nTAMPERED\n");

    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });
});
