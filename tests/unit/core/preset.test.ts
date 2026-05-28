import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { computePresetContentHash } from "../../../src/core/preset";

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
