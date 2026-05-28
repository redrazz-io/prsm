import { join, resolve } from "path";
import { loadWorkspace } from "../core/workspace";
import { mergeLayers } from "./merger";
import { getAdapter } from "../adapters/index";
import { readLockFile } from "../core/lockfile";
import { loadPresetAsLayer, computePresetContentHash, resolvePresetClosure } from "../core/preset";
import { logger } from "../utils/logger";
import type { WorkspaceModel, Runtime } from "../types";

/**
 * Whether an item with the given frontmatter.runtimes should be emitted for a
 * runtime. Absent or empty list = all runtimes (default).
 */
function targetsRuntime(itemRuntimes: Runtime[] | undefined, runtime: Runtime): boolean {
  if (!itemRuntimes || itemRuntimes.length === 0) return true;
  return itemRuntimes.includes(runtime);
}

export async function compile(workspaceRoot: string): Promise<void> {
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

    for (const presetRef of manifest.extends) {
      // Resolve relative extends against the workspace root, not process.cwd(),
      // so build works from any subdirectory (#6). Absolute paths pass through.
      const presetDir = resolve(workspaceRoot, presetRef);
      // Verify the FULL transitive closure against the lockfile, not just the
      // direct preset — a mutated `../base` referenced by a direct preset must
      // be caught even though it lives outside the direct preset's tree (Codex #1).
      for (const { dir, manifest: pm } of await resolvePresetClosure(presetDir)) {
        const actualChecksum = `sha256:${await computePresetContentHash(dir)}`;
        const lockEntry = lock.presets[pm.name];
        if (!lockEntry) {
          throw new Error(
            `Preset "${pm.name}" is not in prsm.lock. Run prsm install to update the lockfile.`,
          );
        }
        if (lockEntry.checksum !== actualChecksum) {
          throw new Error(
            `Preset "${pm.name}" checksum mismatch — preset contents changed since last prsm install. Run prsm install to update prsm.lock.`,
          );
        }
      }

      layers.push(await loadPresetAsLayer(presetDir));
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

    for (const skill of skillsForRuntime) {
      await adapter.compileSkill(skill, workspaceRoot);
    }

    for (const agent of agentsForRuntime) {
      await adapter.compileAgent(agent, workspaceRoot);
    }

    await adapter.generateConfig(model, workspaceRoot);

    logger.success(`${adapter.displayName}: ${skillsForRuntime.length} skills, ${agentsForRuntime.length} agents`);
  }
}
