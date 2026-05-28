import { join, relative, resolve, sep } from "path";
import { readTextFile, fileExists } from "../utils/fs";
import { parseYaml } from "../utils/yaml";
import { sha256Hex } from "../utils/checksum";
import { z } from "zod";
import type { PresetManifest, WorkspaceModel, HooksConfig } from "../types";
import { parseSkillFile, skillToResolved } from "./skill";
import { parseAgentFile, agentToResolved } from "./agent";
import { mergeLayers } from "../compiler/merger";
import { readdir } from "fs/promises";

const HASH_SKIP_FILENAMES = new Set([".DS_Store", "Thumbs.db"]);

async function collectPresetFiles(dir: string, root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      // Symlinks bypass integrity: readTextFile follows them at build time, but
      // Dirent.isFile() is false for symlinks — so the symlink target is read
      // by compile but not included in the hash. Reject explicitly.
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      throw new Error(
        `Symbolic links are not allowed inside presets — found "${rel}". ` +
          `Replace symlinks with real files (or remove them) before running prsm install.`,
      );
    }
    if (entry.isDirectory()) {
      out.push(...(await collectPresetFiles(join(dir, entry.name), root)));
    } else if (entry.isFile()) {
      if (HASH_SKIP_FILENAMES.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      // Normalize to POSIX separators so Windows checkouts produce the same hash
      out.push(rel.split(sep).join("/"));
    }
  }
  return out;
}

function normalizeContent(text: string): string {
  // CRLF → LF
  const lf = text.replace(/\r\n/g, "\n");
  // Ensure exactly one trailing newline
  return lf.replace(/\n*$/, "\n");
}

/**
 * SHA-256 of the full preset content tree.
 * Deterministic across filesystems: POSIX path-sort, CRLF→LF and trailing-newline
 * normalization. Skips OS noise files (.DS_Store, Thumbs.db).
 */
export async function computePresetContentHash(presetDir: string): Promise<string> {
  const relPaths = (await collectPresetFiles(presetDir, presetDir)).sort();
  const parts: string[] = [];
  for (const rel of relPaths) {
    const content = await readTextFile(join(presetDir, ...rel.split("/")));
    parts.push(rel + "\0" + normalizeContent(content) + "\0");
  }
  return sha256Hex(parts.join(""));
}

const PresetManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  extends: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  hooks: z.object({
    "session-start": z.string().optional(),
    "pre-tool-use": z.string().optional(),
    "post-tool-use": z.string().optional(),
    "user-prompt-submit": z.string().optional(),
    stop: z.string().optional(),
  }).default({}),
  permissions: z.array(z.string()).default([]),
  dependencies: z.record(z.string()).default({}),
});

export function parsePresetManifest(content: string, sourcePath: string): PresetManifest {
  const raw = parseYaml(content);
  const result = PresetManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid preset.yaml at ${sourcePath}:\n${issues}`);
  }
  return result.data as PresetManifest;
}

/** A preset in a resolved closure: its directory (as referenced) and manifest. */
export interface ResolvedPreset {
  dir: string;
  manifest: PresetManifest;
}

/**
 * Resolve a preset's full transitive closure in dependency-first layer order
 * (extended presets before the presets that extend them, the root preset last).
 * Deduplicates shared dependencies (diamonds) by canonical path, keeping the
 * first — lowest-precedence — occurrence. Rejects true `extends:` cycles.
 *
 * This is the single source of truth for "which presets does this entail",
 * shared by install (lock every preset), build (verify every preset), eject
 * (materialize every preset), and loadPresetAsLayer (merge every preset). Each
 * `extends` ref is resolved relative to the preset that declares it, so
 * `../base` means "sibling of the current preset".
 */
export async function resolvePresetClosure(presetDir: string): Promise<ResolvedPreset[]> {
  const out: ResolvedPreset[] = [];
  const added = new Set<string>(); // canonical dirs already in `out` (dedup)
  await walkPresetClosure(presetDir, new Set(), out, added);
  return out;
}

async function walkPresetClosure(
  presetDir: string,
  branch: Set<string>, // canonical dirs along the current branch (cycle detection)
  out: ResolvedPreset[],
  added: Set<string>,
): Promise<void> {
  const canonical = resolve(presetDir);
  if (branch.has(canonical)) {
    throw new Error(
      `Preset extends: cycle detected at "${canonical}". ` +
        `Chain: ${[...branch, canonical].join(" -> ")}`,
    );
  }

  const presetYamlPath = join(presetDir, "preset.yaml");
  if (!(await fileExists(presetYamlPath))) {
    throw new Error(`preset.yaml not found in ${presetDir}`);
  }
  const manifest = parsePresetManifest(await readTextFile(presetYamlPath), presetYamlPath);

  // Dependencies first (lower precedence), each resolved relative to this dir.
  const nextBranch = new Set(branch);
  nextBranch.add(canonical);
  for (const ref of manifest.extends ?? []) {
    await walkPresetClosure(resolve(presetDir, ref), nextBranch, out, added);
  }

  if (!added.has(canonical)) {
    added.add(canonical);
    out.push({ dir: presetDir, manifest });
  }
}

export async function loadPresetAsLayer(presetDir: string): Promise<WorkspaceModel> {
  const closure = await resolvePresetClosure(presetDir);
  const layers: WorkspaceModel[] = [];
  for (const p of closure) {
    layers.push(await loadOwnPresetLayer(p.dir, p.manifest));
  }
  return layers.length === 1 ? layers[0] : mergeLayers(layers);
}

/** Load a single preset's own files (no extends resolution). */
async function loadOwnPresetLayer(
  presetDir: string,
  manifest: PresetManifest,
): Promise<WorkspaceModel> {
  const skills = [];
  const skillsDir = join(presetDir, "skills");
  if (await fileExists(skillsDir)) {
    const cats = await readdir(skillsDir, { withFileTypes: true });
    for (const cat of cats) {
      if (!cat.isDirectory()) continue;
      const skillNames = await readdir(join(skillsDir, cat.name), { withFileTypes: true });
      for (const sn of skillNames) {
        if (!sn.isDirectory()) continue;
        const p = join(skillsDir, cat.name, sn.name, "SKILL.md");
        if (await fileExists(p)) {
          const parsed = parseSkillFile(await readTextFile(p), p);
          skills.push(skillToResolved(parsed, "preset", manifest.name));
        }
      }
    }
  }

  const agents = [];
  const agentsDir = join(presetDir, "agents");
  if (await fileExists(agentsDir)) {
    const agentDirs = await readdir(agentsDir, { withFileTypes: true });
    for (const ad of agentDirs) {
      if (!ad.isDirectory()) continue;
      const p = join(agentsDir, ad.name, "AGENT.md");
      if (await fileExists(p)) {
        const parsed = parseAgentFile(await readTextFile(p), p);
        agents.push(agentToResolved(parsed, "preset", manifest.name));
      }
    }
  }

  return {
    name: manifest.name,
    version: manifest.version,
    runtimes: [],
    skills,
    agents,
    hooks: manifest.hooks as WorkspaceModel["hooks"],
    permissions: manifest.permissions ?? [],
    repos: {},
    output: {},
  };
}
