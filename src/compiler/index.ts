import { join, resolve } from "path";
import { loadWorkspace } from "../core/workspace";
import { mergeLayers } from "./merger";
import { getAdapter } from "../adapters/index";
import { readLockFile } from "../core/lockfile";
import {
  loadPresetAsLayer,
  computePresetContentHash,
  resolvePresetClosure,
  isSkillsShapedRepo,
  skillsShapedIdentity,
  loadSkillsShapedAsLayer,
} from "../core/preset";
import { logger } from "../utils/logger";
import { fileExists } from "../utils/fs";
import type { WorkspaceModel, Runtime } from "../types";

export interface CompileOptions {
  /**
   * Require a preset.yaml for every extends: ref; fail on skills-shaped repos.
   * Mirrors `prsm install --strict-preset` (Block 2). Defaults to false.
   */
  strictPreset?: boolean;
}

/**
 * Whether an item with the given frontmatter.runtimes should be emitted for a
 * runtime. Absent or empty list = all runtimes (default).
 */
function targetsRuntime(itemRuntimes: Runtime[] | undefined, runtime: Runtime): boolean {
  if (!itemRuntimes || itemRuntimes.length === 0) return true;
  return itemRuntimes.includes(runtime);
}

export async function compile(workspaceRoot: string, opts: CompileOptions = {}): Promise<void> {
  const ws = await loadWorkspace(workspaceRoot);
  const manifest = ws.manifest;

  const layers: WorkspaceModel[] = [];

  if (manifest.extends.length > 0) {
    const lock = await readLockFile(join(workspaceRoot, "prsm.lock"));
    if (!lock) {
      throw new Error(
        "prsm.yaml declares extends: but prsm.lock is missing. Run prsm install first.",
      );
    }

    const verifyChecksum = (name: string, actualChecksum: string) => {
      const lockEntry = lock.presets[name];
      if (!lockEntry) {
        throw new Error(
          `Preset "${name}" is not in prsm.lock. Run prsm install to update the lockfile.`,
        );
      }
      if (lockEntry.checksum !== actualChecksum) {
        throw new Error(
          `Preset "${name}" checksum mismatch — preset contents changed since last prsm install. Run prsm install to update prsm.lock.`,
        );
      }
    };

    for (const presetRef of manifest.extends) {
      // Resolve relative extends against the workspace root, not process.cwd(),
      // so build works from any subdirectory (#6). Absolute paths pass through.
      const presetDir = resolve(workspaceRoot, presetRef);

      // Precedence: a real preset.yaml ALWAYS wins. Only when there is no
      // preset.yaml do we consider the skills-shaped interop path (Block 2).
      if (!(await fileExists(join(presetDir, "preset.yaml")))) {
        if (opts.strictPreset) {
          throw new Error(
            `No preset.yaml found in "${presetRef}" and --strict-preset is set. ` +
              `Add a preset.yaml or drop --strict-preset to build with it as a skills-shaped repo.`,
          );
        }
        if (await isSkillsShapedRepo(presetDir)) {
          const { name } = skillsShapedIdentity(presetDir, workspaceRoot);
          // Reuse the SAME integrity machinery as real presets — the synthetic
          // identity and computePresetContentHash keep the checksum gate intact.
          verifyChecksum(name, `sha256:${await computePresetContentHash(presetDir)}`);
          layers.push(await loadSkillsShapedAsLayer(presetDir, workspaceRoot));
          continue;
        }
        // Not skills-shaped either: fall through to the resolver, which throws
        // a clear "preset.yaml not found" error.
      }

      // Verify the FULL transitive closure against the lockfile, not just the
      // direct preset — a mutated `../base` referenced by a direct preset must
      // be caught even though it lives outside the direct preset's tree (Codex #1).
      for (const { dir, manifest: pm } of await resolvePresetClosure(presetDir, workspaceRoot, { strictPreset: opts.strictPreset })) {
        verifyChecksum(pm.name, `sha256:${await computePresetContentHash(dir)}`);
      }

      layers.push(await loadPresetAsLayer(presetDir, workspaceRoot, { strictPreset: opts.strictPreset }));
    }
  }

  // Local workspace is the final layer — always wins on name conflict
  const localLayer: WorkspaceModel = {
    name: ws.name,
    version: ws.version,
    runtimes: ws.runtimes,
    skills: ws.skills,
    agents: ws.agents,
    hooks: ws.hooks,
    permissions: ws.permissions,
    repos: ws.repos,
    output: ws.output,
  };
  layers.push(localLayer);

  const merged = layers.length > 1 ? mergeLayers(layers) : localLayer;

  // Runtimes come from the local workspace manifest — presets are runtime-agnostic
  const model = { ...merged, runtimes: localLayer.runtimes };

  for (const runtime of model.runtimes) {
    const adapter = getAdapter(runtime);
    logger.info(`Building for ${adapter.displayName}...`);

    await adapter.clean(workspaceRoot);

    // Each item may scope itself to specific runtimes via frontmatter.runtimes.
    // An absent or empty list means "all runtimes" (the common case).
    const skillsForRuntime = model.skills.filter((s) => targetsRuntime(s.frontmatter.runtimes, runtime));
    const agentsForRuntime = model.agents.filter((a) => targetsRuntime(a.frontmatter.runtimes, runtime));

    // Per-runtime output paths from prsm.yaml (#9); adapters fall back to defaults.
    const output = model.output[runtime];

    for (const skill of skillsForRuntime) {
      await adapter.compileSkill(skill, workspaceRoot, output);
    }

    for (const agent of agentsForRuntime) {
      await adapter.compileAgent(agent, workspaceRoot, output);
    }

    await adapter.generateConfig(model, workspaceRoot);

    logger.success(`${adapter.displayName}: ${skillsForRuntime.length} skills, ${agentsForRuntime.length} agents`);
  }
}
