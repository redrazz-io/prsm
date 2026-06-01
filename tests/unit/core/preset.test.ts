import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { computePresetContentHash, loadPresetAsLayer, resolvePresetClosure, parsePresetManifest } from "../../../src/core/preset";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "prsm-preset-hash-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true });
});

async function writeFileAt(path: string, content: string) {
  await mkdir(join(tmp, path, ".."), { recursive: true });
  await writeFile(join(tmp, path), content, "utf-8");
}

describe("computePresetContentHash", () => {
  it("hashes a multi-file preset (happy path)", async () => {
    await writeFileAt("preset.yaml", "name: test\nversion: 1.0.0\n");
    await writeFileAt("skills/cat/foo/SKILL.md", "---\nname: foo\n---\nbody\n");
    await writeFileAt("agents/bar/AGENT.md", "---\nname: bar\n---\nbody\n");

    const h1 = await computePresetContentHash(tmp);
    const h2 = await computePresetContentHash(tmp);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes a degenerate preset (only preset.yaml)", async () => {
    await writeFileAt("preset.yaml", "name: minimal\nversion: 1.0.0\n");
    const h = await computePresetContentHash(tmp);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects mutations in nested skill files", async () => {
    await writeFileAt("preset.yaml", "name: test\nversion: 1.0.0\n");
    await writeFileAt("skills/cat/foo/SKILL.md", "original\n");
    const before = await computePresetContentHash(tmp);
    await writeFileAt("skills/cat/foo/SKILL.md", "mutated\n");
    const after = await computePresetContentHash(tmp);
    expect(before).not.toBe(after);
  });

  it("normalizes line endings (CRLF and LF produce identical hash)", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "prsm-lf-"));
    const dirB = await mkdtemp(join(tmpdir(), "prsm-crlf-"));
    try {
      await writeFile(join(dirA, "preset.yaml"), "name: x\nversion: 1.0.0\n", "utf-8");
      await writeFile(join(dirB, "preset.yaml"), "name: x\r\nversion: 1.0.0\r\n", "utf-8");
      const ha = await computePresetContentHash(dirA);
      const hb = await computePresetContentHash(dirB);
      expect(ha).toBe(hb);
    } finally {
      await rm(dirA, { recursive: true });
      await rm(dirB, { recursive: true });
    }
  });

  it("normalizes trailing newlines (trailing-LF and no-trailing-LF produce identical hash)", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "prsm-nl-"));
    const dirB = await mkdtemp(join(tmpdir(), "prsm-nonl-"));
    try {
      await writeFile(join(dirA, "preset.yaml"), "name: x\nversion: 1.0.0\n", "utf-8");
      await writeFile(join(dirB, "preset.yaml"), "name: x\nversion: 1.0.0", "utf-8");
      const ha = await computePresetContentHash(dirA);
      const hb = await computePresetContentHash(dirB);
      expect(ha).toBe(hb);
    } finally {
      await rm(dirA, { recursive: true });
      await rm(dirB, { recursive: true });
    }
  });

  it("produces stable hashes regardless of filesystem enumeration order (POSIX sort)", async () => {
    // Files named to invite varying enumeration order across filesystems
    await writeFileAt("preset.yaml", "name: x\nversion: 1.0.0\n");
    await writeFileAt("c.md", "c\n");
    await writeFileAt("A.md", "A\n");
    await writeFileAt("b.md", "b\n");
    const h1 = await computePresetContentHash(tmp);
    const h2 = await computePresetContentHash(tmp);
    const h3 = await computePresetContentHash(tmp);
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it("ignores .DS_Store and Thumbs.db", async () => {
    await writeFileAt("preset.yaml", "name: x\nversion: 1.0.0\n");
    const baseline = await computePresetContentHash(tmp);
    await writeFileAt(".DS_Store", "macos noise");
    await writeFileAt("Thumbs.db", "windows noise");
    const after = await computePresetContentHash(tmp);
    expect(baseline).toBe(after);
  });

  it("rejects symlinked SKILL.md (C3 integrity-bypass regression)", async () => {
    await writeFileAt("preset.yaml", "name: x\nversion: 1.0.0\n");
    // Real target lives outside the preset; the symlink lives inside.
    const targetDir = await mkdtemp(join(tmpdir(), "prsm-symlink-target-"));
    try {
      await writeFile(join(targetDir, "SKILL.md"), "real content\n", "utf-8");
      await mkdir(join(tmp, "skills/cat/foo"), { recursive: true });
      await symlink(join(targetDir, "SKILL.md"), join(tmp, "skills/cat/foo/SKILL.md"));
      await expect(computePresetContentHash(tmp)).rejects.toThrow(/Symbolic links are not allowed/);
    } finally {
      await rm(targetDir, { recursive: true });
    }
  });

  it("rejects symlinked hook script (C3 integrity-bypass regression)", async () => {
    await writeFileAt("preset.yaml", "name: x\nversion: 1.0.0\n");
    const targetDir = await mkdtemp(join(tmpdir(), "prsm-symlink-hook-"));
    try {
      await writeFile(join(targetDir, "hook.sh"), "#!/bin/bash\necho hi\n", "utf-8");
      await mkdir(join(tmp, "hooks"), { recursive: true });
      await symlink(join(targetDir, "hook.sh"), join(tmp, "hooks/session-start.sh"));
      await expect(computePresetContentHash(tmp)).rejects.toThrow(/Symbolic links are not allowed/);
    } finally {
      await rm(targetDir, { recursive: true });
    }
  });
});

const SKILL = (name: string) =>
  `---\nname: ${name}\ndescription: ${name} skill\ncategory: cat\n---\n# ${name}\nbody\n`;

describe("loadPresetAsLayer transitive extends", () => {
  it("recursively loads transitive extends: chain (#4)", async () => {
    await writeFileAt("presets/base/preset.yaml", "name: base\nversion: 1.0.0\n");
    await writeFileAt("presets/base/skills/cat/from-base/SKILL.md", SKILL("from-base"));
    await writeFileAt(
      "presets/team/preset.yaml",
      "name: team\nversion: 1.0.0\nextends:\n  - ../base\n",
    );
    await writeFileAt("presets/team/skills/cat/from-team/SKILL.md", SKILL("from-team"));

    const layer = await loadPresetAsLayer(join(tmp, "presets/team"));
    const names = layer.skills.map((s) => s.name).sort();
    expect(names).toEqual(["from-base", "from-team"]);
  });

  it("local preset wins on name conflict with extended preset (#4 precedence)", async () => {
    // Both presets define a skill named "shared"; the extending preset's copy
    // must win, matching mergeLayers last-wins semantics.
    await writeFileAt("presets/base/preset.yaml", "name: base\nversion: 1.0.0\n");
    await writeFileAt(
      "presets/base/skills/cat/shared/SKILL.md",
      `---\nname: shared\ndescription: from base\ncategory: cat\n---\n# shared\nbase\n`,
    );
    await writeFileAt(
      "presets/team/preset.yaml",
      "name: team\nversion: 1.0.0\nextends:\n  - ../base\n",
    );
    await writeFileAt(
      "presets/team/skills/cat/shared/SKILL.md",
      `---\nname: shared\ndescription: from team\ncategory: cat\n---\n# shared\nteam\n`,
    );

    const layer = await loadPresetAsLayer(join(tmp, "presets/team"));
    const shared = layer.skills.find((s) => s.name === "shared");
    expect(shared?.content).toContain("team");
  });

  it("detects cycles in extends: chain (#4)", async () => {
    await writeFileAt("presets/a/preset.yaml", "name: a\nversion: 1.0.0\nextends:\n  - ../b\n");
    await writeFileAt("presets/b/preset.yaml", "name: b\nversion: 1.0.0\nextends:\n  - ../a\n");
    await expect(loadPresetAsLayer(join(tmp, "presets/a"))).rejects.toThrow(/cycle/i);
  });
});

describe("parsePresetManifest name validation", () => {
  it("rejects a preset name containing ':' so it can't collide with the skills: namespace (BR3)", () => {
    const yaml = `name: "skills:foo"\nversion: 1.0.0\n`;
    expect(() => parsePresetManifest(yaml, "preset.yaml")).toThrow(/colon|':'|name/i);
  });

  it("accepts a normal preset name", () => {
    const yaml = `name: platform-engineering\nversion: 1.0.0\n`;
    const pm = parsePresetManifest(yaml, "preset.yaml");
    expect(pm.name).toBe("platform-engineering");
  });
});

describe("resolvePresetClosure", () => {
  it("returns dependency-first order with the root preset last", async () => {
    await writeFileAt("presets/base/preset.yaml", "name: base\nversion: 1.0.0\n");
    await writeFileAt("presets/team/preset.yaml", "name: team\nversion: 1.0.0\nextends:\n  - ../base\n");

    const closure = await resolvePresetClosure(join(tmp, "presets/team"));
    expect(closure.map((p) => p.manifest.name)).toEqual(["base", "team"]);
  });

  it("dedups a diamond by canonical path, keeping the first (lowest-precedence) occurrence", async () => {
    // top extends [left, right]; both left and right extend base.
    await writeFileAt("presets/base/preset.yaml", "name: base\nversion: 1.0.0\n");
    await writeFileAt("presets/left/preset.yaml", "name: left\nversion: 1.0.0\nextends:\n  - ../base\n");
    await writeFileAt("presets/right/preset.yaml", "name: right\nversion: 1.0.0\nextends:\n  - ../base\n");
    await writeFileAt(
      "presets/top/preset.yaml",
      "name: top\nversion: 1.0.0\nextends:\n  - ../left\n  - ../right\n",
    );

    const closure = await resolvePresetClosure(join(tmp, "presets/top"));
    // base appears once, before both left and right; top is last.
    expect(closure.map((p) => p.manifest.name)).toEqual(["base", "left", "right", "top"]);
  });

  it("rejects cycles (#4)", async () => {
    await writeFileAt("presets/a/preset.yaml", "name: a\nversion: 1.0.0\nextends:\n  - ../b\n");
    await writeFileAt("presets/b/preset.yaml", "name: b\nversion: 1.0.0\nextends:\n  - ../a\n");
    await expect(resolvePresetClosure(join(tmp, "presets/a"))).rejects.toThrow(/cycle/i);
  });

  it("includes a transitively-extended skills-shaped repo as a synthetic node (P2 transitive bridge)", async () => {
    // A real preset extends a skills-shaped repo (no preset.yaml, just skills/).
    // The recursive walker must NOT throw "preset.yaml not found" — it must
    // include the skills-shaped repo in the closure as a synthetic node so the
    // bridge works transitively, not only for top-level workspace refs.
    await writeFileAt("presets/team/preset.yaml", "name: team\nversion: 1.0.0\nextends:\n  - ../../vendor/skills\n");
    await writeFileAt("vendor/skills/skills/cat/foo/SKILL.md", SKILL("foo"));

    const closure = await resolvePresetClosure(join(tmp, "presets/team"), tmp);
    // Dependency-first: the skills-shaped repo (lower precedence) before team.
    expect(closure.map((p) => p.manifest.name)).toEqual(["skills:vendor/skills", "team"]);
    const synth = closure.find((p) => p.skillsShaped);
    expect(synth?.manifest.name).toBe("skills:vendor/skills");
    expect(synth?.manifest.version).toBe("0.0.0");
  });
});
