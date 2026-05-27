import { join } from "path";
import { loadWorkspace } from "../core/workspace";
import { mergeLayers } from "./merger";
import { getAdapter } from "../adapters/index";
import { readLockFile } from "../core/lockfile";
import { loadPresetAsLayer, parsePresetManifest, computePresetContentHash } from "../core/preset";
import { readTextFile } from "../utils/fs";
import { logger } from "../utils/logger";
import type { WorkspaceModel } from "../types";

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
      const presetYamlPath = join(presetRef, "preset.yaml");
      const content = await readTextFile(presetYamlPath);
      const actualChecksum = `sha256:${await computePresetContentHash(presetRef)}`;
      const presetManifest = parsePresetManifest(content, presetYamlPath);

      const lockEntry = lock.presets[presetManifest.name];
      if (!lockEntry) {
        throw new Error(
          `Preset "${presetManifest.name}" is not in prsm.lock. Run prsm install to update the lockfile.`,
        );
      }
      if (lockEntry.checksum !== actualChecksum) {
        throw new Error(
          `Preset "${presetManifest.name}" checksum mismatch — preset contents changed since last prsm install. Run prsm install to update prsm.lock.`,
        );
      }

      layers.push(await loadPresetAsLayer(presetRef));
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

    for (const skill of model.skills) {
      await adapter.compileSkill(skill, workspaceRoot);
    }

    for (const agent of model.agents) {
      await adapter.compileAgent(agent, workspaceRoot);
    }

    await adapter.generateConfig(model, workspaceRoot);

    logger.success(`${adapter.displayName}: ${model.skills.length} skills, ${model.agents.length} agents`);
  }
}
