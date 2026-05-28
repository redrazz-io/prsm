import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { parsePresetManifest } from "../core/preset";
import { readLockFile, writeLockFile } from "../core/lockfile";
import { readTextFile, writeTextFile, ensureDir, fileExists } from "../utils/fs";
import {
  parseYamlDocument,
  stringifyYamlDocument,
  type Document,
} from "../utils/yaml";
import { logger } from "../utils/logger";
import { join, dirname } from "path";
import { copyFile, readdir } from "fs/promises";
import type { PresetManifest } from "../types";

async function collectFilePaths(dir: string): Promise<string[]> {
  const paths: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      paths.push(...await collectFilePaths(p));
    } else {
      paths.push(p);
    }
  }
  return paths;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = join(src, e.name);
    const destPath = join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await ensureDir(dirname(destPath));
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Compute the post-eject hooks state by replaying the build-time merge once
 * across all ejected presets, then overlaying the doc's original local hooks.
 *
 * This must match `mergeLayers` in src/compiler/merger.ts: later presets win
 * over earlier presets per event, and local hooks override everything (an
 * explicit empty-string local value is a valid suppression — the build path
 * already treats empty strings as "no hook").
 *
 * Per-preset hook merge is wrong here because writing one preset into the
 * document before merging the next would make the first preset win.
 */
function applyPresetHookMerge(
  doc: Document,
  originalLocalHooks: Record<string, unknown>,
  presetManifests: PresetManifest[],
): void {
  const effective: Record<string, string> = {};
  for (const pm of presetManifests) {
    const ph = (pm.hooks ?? {}) as Record<string, unknown>;
    for (const [event, value] of Object.entries(ph)) {
      if (value == null) continue;
      effective[event] = value as string;
    }
  }
  // Local overlays — preserve every set value, including empty string (suppression)
  for (const [event, value] of Object.entries(originalLocalHooks)) {
    if (value == null) continue;
    effective[event] = value as string;
  }

  for (const [event, value] of Object.entries(effective)) {
    doc.setIn(["hooks", event], value);
  }
}

function mergePresetPermissions(doc: Document, preset: PresetManifest): void {
  const presetPerms = preset.permissions ?? [];
  if (presetPerms.length === 0) return;
  const localPermsNode = doc.get("permissions");
  const localPerms: string[] = localPermsNode
    ? ((doc.toJSON() as Record<string, unknown>).permissions as string[]) ?? []
    : [];
  const merged = [...localPerms];
  for (const p of presetPerms) {
    if (!merged.includes(p)) merged.push(p);
  }
  doc.set("permissions", merged);
}

function mergePresetDependencies(doc: Document, preset: PresetManifest): void {
  const presetDeps = preset.dependencies ?? {};
  if (Object.keys(presetDeps).length === 0) return;
  for (const [key, value] of Object.entries(presetDeps)) {
    const localValue = doc.getIn(["dependencies", key]);
    // Existing keys unchanged — only add missing keys
    if (localValue === undefined || localValue === null) {
      doc.setIn(["dependencies", key], value);
    }
  }
}

export function ejectCommand(): Command {
  return new Command("eject")
    .description("Copy preset contents into local workspace, removing preset dependency")
    .argument("[preset-name]", "preset to eject (ejects all if omitted)")
    .option("--force", "overwrite existing local files without prompting")
    .action(async (presetName: string | undefined, options: { force?: boolean }) => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      const ws = await loadWorkspace(root);
      const manifest = ws.manifest;

      const toEject = presetName
        ? manifest.extends.filter((e) => e.includes(presetName))
        : manifest.extends;

      if (toEject.length === 0) {
        logger.warn("No matching presets found in extends:.");
        process.exit(0);
      }

      // ── PREFLIGHT ──────────────────────────────────────────────────────
      // Everything that can fail runs here, BEFORE any disk mutation. Once we
      // reach EXECUTE, only file writes remain — so a parse/merge failure can
      // never leave the workspace half-ejected (#7 transactional guarantee).

      // PREFLIGHT: all preset dirs must exist
      for (const presetRef of toEject) {
        const presetYamlPath = join(presetRef, "preset.yaml");
        if (!(await fileExists(presetYamlPath))) {
          logger.error(`Preset not found at ${presetRef}. Aborting — no changes made.`);
          process.exit(1);
        }
      }

      // PREFLIGHT: parse every preset manifest up front — a single invalid
      // preset.yaml aborts the whole eject before anything is copied.
      const presetManifests: PresetManifest[] = [];
      for (const presetRef of toEject) {
        const content = await readTextFile(join(presetRef, "preset.yaml"));
        presetManifests.push(parsePresetManifest(content, join(presetRef, "preset.yaml")));
      }

      // PREFLIGHT: collision check
      if (!options.force) {
        const collisions: string[] = [];
        for (const presetRef of toEject) {
          for (const subdir of ["skills", "agents", "hooks"]) {
            const srcDir = join(presetRef, subdir);
            if (!(await fileExists(srcDir))) continue;
            const srcFiles = await collectFilePaths(srcDir);
            for (const srcFile of srcFiles) {
              const rel = srcFile.slice(srcDir.length);
              const destFile = join(root, subdir, rel);
              if (await fileExists(destFile)) collisions.push(destFile);
            }
          }
        }
        if (collisions.length > 0) {
          logger.error(
            `Eject would overwrite existing files. Use --force to proceed:\n` +
            collisions.map((f) => `  ${f}`).join("\n") +
            `\nNo changes made.`,
          );
          process.exit(1);
        }
      }

      // PREFLIGHT: dry-run the manifest merge via Document API (preserves
      // comments + key order) and validate the serialized result parses back.
      // Nothing is written yet — this only computes the final prsm.yaml string.
      const manifestContent = await readTextFile(join(root, "prsm.yaml"));
      const doc = parseYamlDocument(manifestContent);

      // Snapshot the original local hooks BEFORE any preset writes — used to
      // overlay local-wins semantics in applyPresetHookMerge.
      const originalLocalHooks = ((doc.toJSON() as Record<string, unknown>)?.hooks ?? {}) as Record<string, unknown>;

      applyPresetHookMerge(doc, originalLocalHooks, presetManifests);
      for (const pm of presetManifests) {
        mergePresetPermissions(doc, pm);
        mergePresetDependencies(doc, pm);
      }

      // Update extends:
      const currentExtends = ((doc.toJSON() as Record<string, unknown>).extends as string[]) ?? [];
      doc.set("extends", currentExtends.filter((e) => !toEject.includes(e)));

      const serialized = stringifyYamlDocument(doc);

      // PREFLIGHT: parse-back sanity check — never corrupt prsm.yaml mid-write
      const reparsed = parseYamlDocument(serialized);
      if (reparsed.errors.length > 0) {
        const errs = reparsed.errors.map((e) => `  ${e.message}`).join("\n");
        logger.error(
          `Eject would produce unparseable prsm.yaml:\n${errs}\nAborting — no changes made.`,
        );
        process.exit(1);
      }

      // ── EXECUTE ────────────────────────────────────────────────────────
      // Pure file writes from here on. No operation in this block can fail on
      // bad input — all validation already passed in preflight.

      for (let i = 0; i < toEject.length; i++) {
        const presetRef = toEject[i];
        const pm = presetManifests[i];
        logger.info(`Ejecting ${pm.name}@${pm.version}...`);
        for (const subdir of ["skills", "agents", "hooks"]) {
          const srcDir = join(presetRef, subdir);
          if (await fileExists(srcDir)) {
            await copyDir(srcDir, join(root, subdir));
            logger.success(`  Copied ${subdir}/`);
          }
        }
      }

      await writeTextFile(join(root, "prsm.yaml"), serialized);

      // Update lockfile
      const lock = await readLockFile(join(root, "prsm.lock"));
      if (lock) {
        for (const ref of toEject) {
          for (const [name] of Object.entries(lock.presets)) {
            if (ref.includes(name)) delete lock.presets[name];
          }
        }
        await writeLockFile(join(root, "prsm.lock"), lock);
      }

      logger.success(`Ejected ${toEject.length} preset(s). Workspace is now self-contained.`);
    });
}
