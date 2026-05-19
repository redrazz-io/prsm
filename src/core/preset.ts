import { join } from "path";
import { readTextFile, fileExists } from "../utils/fs";
import { parseYaml } from "../utils/yaml";
import { z } from "zod";
import type { PresetManifest, WorkspaceModel, HooksConfig } from "../types";
import { parseSkillFile, skillToResolved } from "./skill";
import { parseAgentFile, agentToResolved } from "./agent";
import { readdir } from "fs/promises";

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

export async function loadPresetAsLayer(presetDir: string): Promise<WorkspaceModel> {
  const presetYamlPath = join(presetDir, "preset.yaml");
  if (!(await fileExists(presetYamlPath))) {
    throw new Error(`preset.yaml not found in ${presetDir}`);
  }

  const content = await readTextFile(presetYamlPath);
  const manifest = parsePresetManifest(content, presetYamlPath);

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
