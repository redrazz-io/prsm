import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import {
  computePresetContentHash,
  resolvePresetClosure,
  isSkillsShapedRepo,
  skillsShapedIdentity,
  countSkillsShapedFiles,
} from "../core/preset";
import { writeLockFile, createLockFile } from "../core/lockfile";
import { logger } from "../utils/logger";
import { join, resolve } from "path";
import { fileExists } from "../utils/fs";

export interface InstallOptions {
  /**
   * Fail fast when an extends: ref has no preset.yaml (CI / locked-down use).
   * When false (default), a skills-shaped ref is auto-detected and installed.
   */
  strictPreset?: boolean;
}

export async function runInstall(root: string, opts: InstallOptions = {}): Promise<void> {
  const ws = await loadWorkspace(root);
  const manifest = ws.manifest;
  const presetEntries: Record<string, { version: string; url: string; checksum: string }> = {};

  for (const presetRef of manifest.extends) {
    // Resolve relative extends against the workspace root, not process.cwd(),
    // so install works from any subdirectory (#6). Absolute paths pass through.
    const presetDir = resolve(root, presetRef);

    // Precedence: a real preset.yaml ALWAYS wins. Only when there is no
    // preset.yaml do we consider the skills-shaped interop path (Block 2).
    if (!(await fileExists(join(presetDir, "preset.yaml")))) {
      if (opts.strictPreset) {
        throw new Error(
          `No preset.yaml found in "${presetRef}" and --strict-preset is set. ` +
            `Add a preset.yaml or drop --strict-preset to install it as a skills-shaped repo.`,
        );
      }
      if (await isSkillsShapedRepo(presetDir)) {
        const { name, version } = skillsShapedIdentity(presetDir, root);
        const count = await countSkillsShapedFiles(presetDir);
        const checksum = `sha256:${await computePresetContentHash(presetDir)}`;
        presetEntries[name] = { version, url: presetDir, checksum };
        logger.info(
          `→ Detected skills-shaped repo; installing ${count} SKILL.md file${count === 1 ? "" : "s"} from skills/. ` +
            `Use --strict-preset to require preset.yaml.`,
        );
        logger.success(`Resolved ${name}@${version}`);
        continue;
      }
      // Not skills-shaped either: fall through to the resolver, which throws a
      // clear "preset.yaml not found" error.
    }

    // Lock the full transitive closure of every direct extends, not just the
    // direct presets — otherwise a mutated transitive preset slips past the
    // checksum gate at build time (Codex #1).
    for (const { dir, manifest: pm } of await resolvePresetClosure(presetDir)) {
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
    .option(
      "--strict-preset",
      "Require a preset.yaml for every extends: ref; fail on skills-shaped repos",
    )
    .action(async (options: { strictPreset?: boolean }) => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }
      try {
        await runInstall(root, { strictPreset: options.strictPreset });
      } catch (err) {
        logger.error(String(err));
        process.exit(1);
      }
    });
}
