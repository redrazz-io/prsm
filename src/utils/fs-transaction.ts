import { existsSync } from "fs";
import { copyFile, mkdir, readdir, readFile, rm, rmdir, writeFile } from "fs/promises";
import { dirname, join } from "path";

/**
 * A best-effort filesystem transaction for a command's write phase.
 *
 * Every mutating operation is journaled with its inverse BEFORE it runs, so a
 * single `rollback()` after any failure restores the pre-transaction state:
 *   - a newly-created file        → deleted
 *   - an overwritten file         → original bytes restored
 *   - a directory we created      → removed (empty) on rollback
 *
 * This exists because eject's EXECUTE phase performs several sequential
 * mutations (copy N preset trees, rewrite prsm.yaml, rewrite prsm.lock). Without
 * a journal, a failure partway through (ENOSPC, permission denied, a path whose
 * parent is unexpectedly a file, an interrupt) leaves copied files on disk while
 * prsm.yaml/prsm.lock still point at the old state — breaking the advertised
 * "no changes made" guarantee for execute-phase failures (Codex adversarial #1).
 *
 * Rollback is best-effort: each undo step is independently guarded so one
 * failing step cannot abort the rest. We never claim atomicity at the syscall
 * level — only that a clean failure leaves the workspace as it was found.
 */
type UndoOp =
  | { kind: "deleteFile"; path: string }
  | { kind: "restoreFile"; path: string; content: Buffer }
  | { kind: "deleteDir"; path: string };

export class FsTransaction {
  private undo: UndoOp[] = [];

  /**
   * Create `dir` and any missing ancestors, journaling each directory we
   * actually create (so rollback removes them, but never a pre-existing dir).
   */
  async ensureDir(dir: string): Promise<void> {
    const missing: string[] = [];
    let cur = dir;
    while (!existsSync(cur)) {
      missing.push(cur);
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    // Shallowest first so each mkdir's parent already exists.
    for (const d of missing.reverse()) {
      await mkdir(d);
      this.undo.push({ kind: "deleteDir", path: d });
    }
  }

  /** Snapshot a path's pre-state for rollback WITHOUT writing it — the caller
   *  then mutates it through any API (e.g. writeLockFile) and rollback still
   *  restores the original (or deletes it if it did not exist). */
  async guard(path: string): Promise<void> {
    if (existsSync(path)) {
      this.undo.push({ kind: "restoreFile", path, content: await readFile(path) });
    } else {
      this.undo.push({ kind: "deleteFile", path });
    }
  }

  /** Write `content` to `path`, journaling for rollback (backup if it exists,
   *  else mark for deletion). Creates parent dirs as needed. */
  async writeFile(path: string, content: string | Buffer): Promise<void> {
    await this.ensureDir(dirname(path));
    await this.guard(path);
    await writeFile(path, content);
  }

  /** Copy a single file into `dest`, journaling for rollback. */
  async copyFileInto(src: string, dest: string): Promise<void> {
    await this.ensureDir(dirname(dest));
    await this.guard(dest);
    await copyFile(src, dest);
  }

  /** Recursively copy the contents of `src` into `dest`, journaling every
   *  created directory and every file written or overwritten. */
  async copyDirInto(src: string, dest: string): Promise<void> {
    await this.ensureDir(dest);
    const entries = await readdir(src, { withFileTypes: true });
    for (const e of entries) {
      const s = join(src, e.name);
      const d = join(dest, e.name);
      if (e.isDirectory()) {
        await this.copyDirInto(s, d);
      } else {
        await this.copyFileInto(s, d);
      }
    }
  }

  /**
   * Undo every journaled operation in reverse order. Files created inside a
   * directory are deleted before that directory is removed (reverse order
   * guarantees this), so empty-dir removal succeeds. Best-effort: a failure in
   * one step is swallowed so the remaining steps still run.
   */
  async rollback(): Promise<void> {
    for (let i = this.undo.length - 1; i >= 0; i--) {
      const op = this.undo[i];
      try {
        if (op.kind === "deleteFile") {
          await rm(op.path, { force: true });
        } else if (op.kind === "restoreFile") {
          await writeFile(op.path, op.content);
        } else {
          // deleteDir — only succeeds when empty, which is correct: if other
          // (pre-existing) content lives there, we must not remove it.
          await rmdir(op.path).catch(() => {});
        }
      } catch {
        // Best-effort: keep unwinding the rest of the journal.
      }
    }
  }
}
