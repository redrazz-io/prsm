import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { computePresetContentHash, resolvePresetClosure } from "../core/preset";
import { writeLockFile, createLockFile } from "../core/lockfile";
import { logger } from "../utils/logger";
import { join } from "path";

export async function runInstall(root: string): Promise<void> {
  const ws = await loadWorkspace(root);
  const manifest = ws.manifest;
  const presetEntries: Record<string, { version: string; url: string; checksum: string }> = {};

  // Lock the full transitive closure of every direct extends, not just the
  // direct presets — otherwise a mutated transitive preset slips past the
  // checksum gate at build time (Codex #1).
  for (const presetRef of manifest.extends) {
    for (const { dir, manifest: pm } of await resolvePresetClosure(presetRef)) {
      const checksum = `sha256:${await computePresetContentHash(dir)}`;
      presetEntries[pm.name] = { version: pm.version, url: dir, checksum };
      logger.success(`Resolved ${pm.name}@${pm.version}`);
    }
  }

  const lock = createLockFile(presetEntries);
  await writeLockFile(join(root, "prsm.lock"), lock);
  logger.success(`prsm.lock written with ${Object.keys(presetEntries).length} preset(s).`);
}

export function installCommand(): Command {
  return new Command("install")
    .description("Resolve preset inheritance and generate prsm.lock")
    .action(async () => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }
      try {
        await runInstall(root);
      } catch (err) {
        logger.error(String(err));
        process.exit(1);
      }
    });
}
