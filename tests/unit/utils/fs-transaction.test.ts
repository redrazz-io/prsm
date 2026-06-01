import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FsTransaction } from "../../../src/utils/fs-transaction";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "prsm-fstx-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("FsTransaction", () => {
  it("writeFile creates a new file and rollback removes it (plus the dirs it created)", async () => {
    const tx = new FsTransaction();
    const target = join(tmp, "a/b/c.txt");
    await tx.writeFile(target, "hello");
    expect(existsSync(target)).toBe(true);

    await tx.rollback();
    // File and every directory the transaction created are gone.
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(tmp, "a/b"))).toBe(false);
    expect(existsSync(join(tmp, "a"))).toBe(false);
  });

  it("writeFile over an existing file restores the original bytes on rollback", async () => {
    const target = join(tmp, "existing.txt");
    await writeFile(target, "ORIGINAL", "utf-8");

    const tx = new FsTransaction();
    await tx.writeFile(target, "OVERWRITTEN");
    expect(await readFile(target, "utf-8")).toBe("OVERWRITTEN");

    await tx.rollback();
    expect(existsSync(target)).toBe(true);
    expect(await readFile(target, "utf-8")).toBe("ORIGINAL");
  });

  it("copyDirInto copies a tree and rollback removes only what it added", async () => {
    // Source tree to copy.
    const src = join(tmp, "src");
    await mkdir(join(src, "cat"), { recursive: true });
    await writeFile(join(src, "cat/skill.md"), "skill", "utf-8");

    // Destination already has a pre-existing sibling that must survive rollback.
    const dest = join(tmp, "dest");
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "pre-existing.txt"), "keep me", "utf-8");

    const tx = new FsTransaction();
    await tx.copyDirInto(src, dest);
    expect(existsSync(join(dest, "cat/skill.md"))).toBe(true);

    await tx.rollback();
    // Copied tree gone…
    expect(existsSync(join(dest, "cat/skill.md"))).toBe(false);
    expect(existsSync(join(dest, "cat"))).toBe(false);
    // …pre-existing dir + file untouched (we did not create dest).
    expect(existsSync(dest)).toBe(true);
    expect(await readFile(join(dest, "pre-existing.txt"), "utf-8")).toBe("keep me");
  });

  it("copyDirInto overwriting an existing file restores it on rollback (--force case)", async () => {
    const src = join(tmp, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "shared.md"), "FROM SRC", "utf-8");

    const dest = join(tmp, "dest");
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "shared.md"), "LOCAL ORIGINAL", "utf-8");

    const tx = new FsTransaction();
    await tx.copyDirInto(src, dest);
    expect(await readFile(join(dest, "shared.md"), "utf-8")).toBe("FROM SRC");

    await tx.rollback();
    expect(await readFile(join(dest, "shared.md"), "utf-8")).toBe("LOCAL ORIGINAL");
  });

  it("guard restores an externally-written existing file on rollback", async () => {
    const target = join(tmp, "prsm.yaml");
    await writeFile(target, "extends:\n  - ./base\n", "utf-8");

    const tx = new FsTransaction();
    await tx.guard(target); // journal BEFORE an external writer mutates it
    await writeFile(target, "extends: []\n", "utf-8");

    await tx.rollback();
    expect(await readFile(target, "utf-8")).toBe("extends:\n  - ./base\n");
  });

  it("guard removes an externally-created new file on rollback", async () => {
    const target = join(tmp, "prsm.lock");
    expect(existsSync(target)).toBe(false);

    const tx = new FsTransaction();
    await tx.guard(target); // file does not exist yet
    await writeFile(target, "locked", "utf-8");

    await tx.rollback();
    expect(existsSync(target)).toBe(false);
  });

  it("rollback replays in reverse so a mixed journal restores cleanly", async () => {
    const dest = join(tmp, "ws");
    await mkdir(dest, { recursive: true });
    const manifest = join(dest, "prsm.yaml");
    await writeFile(manifest, "ORIGINAL MANIFEST", "utf-8");

    const src = join(tmp, "preset");
    await mkdir(join(src, "skills/cat/a"), { recursive: true });
    await writeFile(join(src, "skills/cat/a/SKILL.md"), "skill", "utf-8");

    const tx = new FsTransaction();
    await tx.copyDirInto(join(src, "skills"), join(dest, "skills"));
    await tx.guard(manifest);
    await writeFile(manifest, "REWRITTEN", "utf-8");

    await tx.rollback();
    expect(existsSync(join(dest, "skills"))).toBe(false);
    expect(await readFile(manifest, "utf-8")).toBe("ORIGINAL MANIFEST");
  });
});
