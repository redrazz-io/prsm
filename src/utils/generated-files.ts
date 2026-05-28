import { join } from "path";
import { fileExists, readTextFile, writeTextFile, ensureDir } from "./fs";

function manifestPath(outputBase: string, adapterId: string): string {
  return join(outputBase, `.prsm/generated-files-${adapterId}.json`);
}

export async function trackGeneratedFile(outputBase: string, adapterId: string, path: string): Promise<void> {
  const mPath = manifestPath(outputBase, adapterId);
  let files: string[] = [];
  if (await fileExists(mPath)) {
    files = JSON.parse(await readTextFile(mPath));
  }
  if (!files.includes(path)) {
    files.push(path);
    await ensureDir(join(outputBase, ".prsm"));
    await writeTextFile(mPath, JSON.stringify(files, null, 2));
  }
}

export async function cleanGeneratedFiles(outputBase: string, adapterId: string): Promise<void> {
  const mPath = manifestPath(outputBase, adapterId);
  if (!(await fileExists(mPath))) return;
  const { rm } = await import("fs/promises");
  const files: string[] = JSON.parse(await readTextFile(mPath));
  for (const f of files) {
    try { await rm(f, { force: true }); } catch {}
  }
  await rm(mPath, { force: true });
}

function managedHooksPath(outputBase: string, adapterId: string): string {
  return join(outputBase, `.prsm/managed-hooks-${adapterId}.json`);
}

/**
 * The hook event names prsm wrote into the runtime's settings on the last
 * build. Used to drop prsm-managed hooks that were since removed from
 * prsm.yaml, without clobbering user-authored hooks for other events (#5).
 * This tracking deliberately survives `clean()` — it describes settings.json,
 * a shared user file that prsm does not delete.
 */
export async function readManagedHookEvents(outputBase: string, adapterId: string): Promise<string[]> {
  const p = managedHooksPath(outputBase, adapterId);
  if (!(await fileExists(p))) return [];
  try { return JSON.parse(await readTextFile(p)) as string[]; } catch { return []; }
}

export async function writeManagedHookEvents(
  outputBase: string,
  adapterId: string,
  events: string[],
): Promise<void> {
  await ensureDir(join(outputBase, ".prsm"));
  await writeTextFile(managedHooksPath(outputBase, adapterId), JSON.stringify(events, null, 2));
}
