import { z } from "zod";
import { parseYaml } from "../utils/yaml";
import type { WorkspaceManifest } from "../types";

const SkillRefSchema = z.object({ path: z.string() });
const AgentRefSchema = z.object({ path: z.string() });
const RepoEntrySchema = z.object({
  path: z.string(),
  org: z.string().optional(),
  default_branch: z.string().optional(),
});
const HooksSchema = z
  .object({
    "session-start": z.string().optional(),
    "pre-tool-use": z.string().optional(),
    "post-tool-use": z.string().optional(),
    "user-prompt-submit": z.string().optional(),
    stop: z.string().optional(),
  })
  .default({});
const OutputConfigSchema = z.object({
  skills: z.string().optional(),
  agents: z.string().optional(),
  settings: z.string().optional(),
});

export const ManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  author: z.string().optional(),
  runtimes: z.array(z.enum(["claude-code", "codex"])).min(1),
  extends: z.array(z.string()).default([]),
  dependencies: z.record(z.string()).default({}),
  skills: z.array(SkillRefSchema).default([]),
  agents: z.array(AgentRefSchema).default([]),
  hooks: HooksSchema,
  repos: z.record(z.record(RepoEntrySchema)).default({}),
  output: z.record(OutputConfigSchema).default({}),
});

export function parseManifest(yamlContent: string): WorkspaceManifest {
  const raw = parseYaml(yamlContent);
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid prsm.yaml:\n${issues}`);
  }
  return result.data as WorkspaceManifest;
}
