import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runInstall } from "../../src/commands/install";
import { compile } from "../../src/compiler/index";
import { readLockFile } from "../../src/core/lockfile";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs";
import { join, basename } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
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

  // BR1: Anthropic's canonical Agent Skills layout is 2-level (skills/<name>/SKILL.md,
  // no category dir). Detection must match it, not only prsm's 3-level tree.
  it("detects the canonical 2-level skills/<name>/SKILL.md layout (BR1)", async () => {
    const repo = join(tmp, "canonical-skills");
    await ensureDir(join(repo, "skills/canonical-skill"));
    await writeTextFile(
      join(repo, "skills/canonical-skill/SKILL.md"),
      `---\nname: canonical-skill\ndescription: A skill in the canonical 2-level layout\n---\n# Canonical Skill\n`,
    );
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);
    const lock = await readLockFile(join(tmp, "prsm.lock"));
    expect(lock!.presets[`skills:${basename(repo)}`]).toBeDefined();

    await compile(tmp);
    // No category in frontmatter → resolved category "general".
    expect(await fileExists(join(tmp, ".claude/skills/hub-general-canonical-skill/SKILL.md"))).toBe(true);
  });

  it("supports a repo mixing 2-level and 3-level skills (BR1)", async () => {
    const repo = join(tmp, "mixed-skills");
    await ensureDir(join(repo, "skills/flat-skill"));
    await ensureDir(join(repo, "skills/security/nested-skill"));
    await writeTextFile(
      join(repo, "skills/flat-skill/SKILL.md"),
      `---\nname: flat-skill\ndescription: 2-level\n---\n# Flat\n`,
    );
    await writeTextFile(
      join(repo, "skills/security/nested-skill/SKILL.md"),
      `---\nname: nested-skill\ndescription: 3-level\ncategory: security\n---\n# Nested\n`,
    );
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);
    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/skills/hub-general-flat-skill/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".claude/skills/hub-security-nested-skill/SKILL.md"))).toBe(true);
  });

  // P2b: two distinct skills-shaped repos that share the SAME leaf dir name
  // (e.g. team-a/skills and team-b/skills, both basename "skills") must get
  // DISTINCT synthetic lock identities. With a basename-only identity both
  // derived "skills:skills", the second overwrote the first in the lockfile,
  // and a valid 2-repo multi-extends install+compile failed the checksum gate.
  it("gives same-basename skills-shaped repos distinct lock identities (P2b)", async () => {
    // Both leaf dirs are named "skills" — the collision trigger.
    const repoA = join(tmp, "team-a", "skills");
    const repoB = join(tmp, "team-b", "skills");
    await ensureDir(join(repoA, "skills/security/alpha"));
    await ensureDir(join(repoB, "skills/platform/beta"));
    await writeTextFile(
      join(repoA, "skills/security/alpha/SKILL.md"),
      `---\nname: alpha\ndescription: From team-a\ncategory: security\n---\n# Alpha\n`,
    );
    await writeTextFile(
      join(repoB, "skills/platform/beta/SKILL.md"),
      `---\nname: beta\ndescription: From team-b\ncategory: platform\n---\n# Beta\n`,
    );
    await writeTextFile(
      join(tmp, "prsm.yaml"),
      `name: test-ws\nversion: 1.0.0\nruntimes:\n  - claude-code\nextends:\n  - ${repoA}\n  - ${repoB}\n`,
    );

    await runInstall(tmp);

    const lock = await readLockFile(join(tmp, "prsm.lock"));
    expect(lock).not.toBeNull();
    const keys = Object.keys(lock!.presets).filter((k) => k.startsWith("skills:"));
    // Two distinct synthetic entries, NOT one collapsed entry.
    expect(keys.length).toBe(2);
    expect(new Set(keys).size).toBe(2);
    // Identities are disambiguated by the workspace-root-relative path.
    expect(lock!.presets["skills:team-a/skills"]).toBeDefined();
    expect(lock!.presets["skills:team-b/skills"]).toBeDefined();
    // And they have different checksums (different content).
    expect(lock!.presets["skills:team-a/skills"].checksum).not.toBe(
      lock!.presets["skills:team-b/skills"].checksum,
    );

    // The whole point: compile must round-trip WITHOUT a checksum mismatch and
    // emit BOTH repos' skills (the bug failed here before the fix).
    await compile(tmp);
    expect(await fileExists(join(tmp, ".claude/skills/hub-security-alpha/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".claude/skills/hub-platform-beta/SKILL.md"))).toBe(true);
  });

  // P2 transitive bridge: a real preset (with preset.yaml) extends a
  // skills-shaped repo. extends: inheritance is transitive, so the bridge must
  // work below the top level — install must not die with "preset.yaml not
  // found", and build must emit the transitively-inherited skills.
  it("bridges a skills-shaped repo extended transitively by a real preset (P2 transitive)", async () => {
    // workspace → team-preset (real) → ../vendor-skills (skills-shaped)
    const vendor = join(tmp, "vendor-skills");
    await makeSkillsShapedRepo(vendor); // 3-level: security/skill-a, platform/skill-b

    const teamPreset = join(tmp, "team-preset");
    await ensureDir(teamPreset);
    await writeTextFile(
      join(teamPreset, "preset.yaml"),
      `name: team-preset\nversion: 1.0.0\nextends:\n  - ../vendor-skills\nskills: []\nagents: []\nhooks: {}\npermissions: []\n`,
    );
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(teamPreset));

    // Must NOT throw "preset.yaml not found" on the transitive skills-shaped ref.
    await runInstall(tmp);

    const lock = await readLockFile(join(tmp, "prsm.lock"));
    expect(lock!.presets["team-preset"]).toBeDefined();
    // The skills-shaped repo is locked under its synthetic, root-relative identity.
    expect(lock!.presets["skills:vendor-skills"]).toBeDefined();
    expect(lock!.presets["skills:vendor-skills"].version).toBe("0.0.0");

    // Build must emit the skills inherited THROUGH the real preset.
    await compile(tmp);
    expect(await fileExists(join(tmp, ".claude/skills/hub-security-skill-a/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".claude/skills/hub-platform-skill-b/SKILL.md"))).toBe(true);
  });

  // --strict-preset must reject a manifest-less ref ANYWHERE in the closure, not
  // just at the top level — otherwise a real preset can smuggle a skills-shaped
  // repo past the flag, contradicting "fail on any extends: ref lacking
  // preset.yaml" (Codex PR #14 follow-up).
  async function makeTransitiveSkillsShapedWorkspace(): Promise<void> {
    const vendor = join(tmp, "vendor-skills");
    await makeSkillsShapedRepo(vendor);
    const teamPreset = join(tmp, "team-preset");
    await ensureDir(teamPreset);
    await writeTextFile(
      join(teamPreset, "preset.yaml"),
      `name: team-preset\nversion: 1.0.0\nextends:\n  - ../vendor-skills\nskills: []\nagents: []\nhooks: {}\npermissions: []\n`,
    );
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(teamPreset));
  }

  it("install --strict-preset rejects a TRANSITIVE skills-shaped ref", async () => {
    await makeTransitiveSkillsShapedWorkspace();
    await expect(runInstall(tmp, { strictPreset: true })).rejects.toThrow(/preset\.yaml/);
  });

  it("build --strict-preset rejects a TRANSITIVE skills-shaped ref", async () => {
    await makeTransitiveSkillsShapedWorkspace();
    await runInstall(tmp); // lock it normally first
    await expect(compile(tmp, { strictPreset: true })).rejects.toThrow(/preset\.yaml/);
  });

  it("compile fails when a skills-shaped repo is mutated after install (integrity holds)", async () => {
    const repo = join(tmp, "skills-repo");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);

    await writeTextFile(join(repo, "skills/security/skill-a/SKILL.md"), SKILL_A + "\nTAMPERED\n");

    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });

  // #1: a skill is a directory, not just SKILL.md. Sibling scripts/templates/
  // assets must reach the runtime output, or a skill that references its bundled
  // files installs+builds cleanly but breaks at use time (Codex adversarial #1).
  it("emits a skill's support files from a skills-shaped repo (Codex adversarial #1)", async () => {
    const repo = join(tmp, "skills-repo");
    await ensureDir(join(repo, "skills/security/scanner/templates"));
    await writeTextFile(
      join(repo, "skills/security/scanner/SKILL.md"),
      `---\nname: scanner\ndescription: scans\ncategory: security\n---\n# Scanner\nRuns ./run.sh\n`,
    );
    await writeTextFile(join(repo, "skills/security/scanner/run.sh"), "#!/bin/bash\necho scan\n");
    await writeTextFile(join(repo, "skills/security/scanner/templates/report.md"), "# Report\n");
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await runInstall(tmp);
    await compile(tmp);

    const outDir = join(tmp, ".claude/skills/hub-security-scanner");
    expect(await fileExists(join(outDir, "SKILL.md"))).toBe(true);
    expect(await fileExists(join(outDir, "run.sh"))).toBe(true);
    expect(await fileExists(join(outDir, "templates/report.md"))).toBe(true);
  });

  // #2: the skills-shaped checksum must cover only build-relevant files (skills/**
  // + support files), not the whole referenced repo — otherwise benign changes to
  // .git/README/tests spuriously trip the build gate (Codex adversarial #2).
  it("skills-shaped checksum ignores non-build repo files (Codex adversarial #2)", async () => {
    const repo = join(tmp, "skills-repo");
    await makeSkillsShapedRepo(repo);
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));
    await runInstall(tmp);

    // Mutate files that do NOT affect build output.
    await writeTextFile(join(repo, "README.md"), "# totally different\n");
    await ensureDir(join(repo, ".git"));
    await writeTextFile(join(repo, ".git/HEAD"), "ref: refs/heads/elsewhere\n");
    await writeTextFile(join(repo, "tests/thing.test.ts"), "// noise\n");

    // Build must NOT trip the checksum gate.
    await compile(tmp);
    expect(await fileExists(join(tmp, ".claude/skills/hub-security-skill-a/SKILL.md"))).toBe(true);
  });

  it("skills-shaped checksum DOES cover a skill's support files", async () => {
    const repo = join(tmp, "skills-repo");
    await ensureDir(join(repo, "skills/security/scanner"));
    await writeTextFile(
      join(repo, "skills/security/scanner/SKILL.md"),
      `---\nname: scanner\ndescription: scans\ncategory: security\n---\n# Scanner\n`,
    );
    await writeTextFile(join(repo, "skills/security/scanner/run.sh"), "v1\n");
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));
    await runInstall(tmp);

    // Mutating a support file must trip the gate.
    await writeTextFile(join(repo, "skills/security/scanner/run.sh"), "v2 tampered\n");
    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });

  // Stop-gate: the checksum must cover BINARY support files by raw bytes. Reading
  // them as utf-8 + normalizing newlines is lossy — distinct byte sequences (e.g.
  // 0xFF vs 0xFE, both invalid utf-8 → U+FFFD) would collapse to the same string
  // and the changed asset would slip past the gate.
  it("skills-shaped checksum detects byte changes to a BINARY support file", async () => {
    const repo = join(tmp, "skills-repo");
    await ensureDir(join(repo, "skills/security/scanner"));
    await writeTextFile(
      join(repo, "skills/security/scanner/SKILL.md"),
      `---\nname: scanner\ndescription: scans\ncategory: security\n---\n# Scanner\n`,
    );
    // Binary asset with a NUL byte and an invalid-utf-8 byte.
    await writeFile(join(repo, "skills/security/scanner/logo.bin"), Buffer.from([0x00, 0xff, 0x10]));
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));
    await runInstall(tmp);

    // Flip one byte (0xFF → 0xFE) — invisible to lossy utf-8 decode + newline
    // normalization, but a real change to the emitted asset.
    await writeFile(join(repo, "skills/security/scanner/logo.bin"), Buffer.from([0x00, 0xfe, 0x10]));
    await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
  });

  // #3: a top dir with BOTH its own SKILL.md and nested skill dirs is ambiguous —
  // the old short-circuit silently dropped the nested skills. Fail loudly instead
  // (Codex adversarial #3).
  it("fails on an ambiguous mixed 2-level/3-level layout (Codex adversarial #3)", async () => {
    const repo = join(tmp, "skills-repo");
    await ensureDir(join(repo, "skills/security/nested"));
    await writeTextFile(
      join(repo, "skills/security/SKILL.md"),
      `---\nname: security\ndescription: direct\n---\n# direct\n`,
    );
    await writeTextFile(
      join(repo, "skills/security/nested/SKILL.md"),
      `---\nname: nested\ndescription: nested\n---\n# nested\n`,
    );
    await writeTextFile(join(tmp, "prsm.yaml"), manifestExtending(repo));

    await expect(runInstall(tmp)).rejects.toThrow(/ambiguous|layout/i);
  });
});
