import { join, relative, dirname } from "path";
import { readdir } from "fs/promises";
import { readTextFile, fileExists } from "../utils/fs";
import { parseManifest } from "./manifest";
import { parseSkillFile, skillToResolved } from "./skill";
import { parseAgentFile, agentToResolved } from "./agent";
import type { WorkspaceManifest, WorkspaceModel, ResolvedSkill, ResolvedAgent } from "../types";

export async function findWorkspaceRoot(from: string): Promise<string | null> {
  let dir = from;
  while (true) {
    if (await fileExists(join(dir, "prsm.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function discoverSkillsDir(skillsDir: string, workspaceRoot: string): Promise<ResolvedSkill[]> {
  const skills: ResolvedSkill[] = [];
  if (!(await fileExists(skillsDir))) return skills;

  const addSkill = async (skillMdPath: string): Promise<void> => {
    const content = await readTextFile(skillMdPath);
    const relPath = relative(workspaceRoot, skillMdPath);
    const parsed = parseSkillFile(content, relPath);
    skills.push(skillToResolved(parsed, "local", relPath));
  };

  // Support BOTH on-disk layouts, mirroring collectSkillsShapedFiles so the
  // local loader and the skills-shaped preset loader agree:
  //   - 2-level (canonical Agent Skills):  skills/<name>/SKILL.md
  //   - 3-level (prsm convention):         skills/<category>/<name>/SKILL.md
  // This is what makes an ejected skills-shaped repo self-contained: eject
  // copies a 2-level tree verbatim, and the local build/load path must then
  // emit those skills (P2a). The emitted category comes from SKILL.md
  // frontmatter (default "general"), NOT the directory name, so build output
  // is identical regardless of which layout a skill was discovered from.
  const topEntries = await readdir(skillsDir, { withFileTypes: true });
  for (const top of topEntries) {
    if (!top.isDirectory()) continue;
    const topDir = join(skillsDir, top.name);

    // 2-level: a dir with its own SKILL.md is itself a skill. Its nested dirs
    // are that skill's supporting files, not sub-skills — do not descend.
    const directSkillMd = join(topDir, "SKILL.md");
    if (await fileExists(directSkillMd)) {
      await addSkill(directSkillMd);
      continue;
    }

    // 3-level: treat this dir as a category and descend one level.
    const skillDirs = await readdir(topDir, { withFileTypes: true });
    for (const sd of skillDirs) {
      if (!sd.isDirectory()) continue;
      const skillMdPath = join(topDir, sd.name, "SKILL.md");
      if (!(await fileExists(skillMdPath))) continue;
      await addSkill(skillMdPath);
    }
  }
  return skills;
}

async function discoverAgentsDir(agentsDir: string, workspaceRoot: string): Promise<ResolvedAgent[]> {
  const agents: ResolvedAgent[] = [];
  if (!(await fileExists(agentsDir))) return agents;

  const agentDirs = await readdir(agentsDir, { withFileTypes: true });
  for (const ad of agentDirs) {
    if (!ad.isDirectory()) continue;
    const agentMdPath = join(agentsDir, ad.name, "AGENT.md");
    if (!(await fileExists(agentMdPath))) continue;
    const content = await readTextFile(agentMdPath);
    const relPath = relative(workspaceRoot, agentMdPath);
    const parsed = parseAgentFile(content, relPath);
    agents.push(agentToResolved(parsed, "local", relPath));
  }
  return agents;
}

export async function loadWorkspace(root: string): Promise<WorkspaceModel & { manifest: WorkspaceManifest }> {
  const manifestPath = join(root, "prsm.yaml");
  if (!(await fileExists(manifestPath))) {
    throw new Error(`prsm.yaml not found in ${root}`);
  }

  const manifestContent = await readTextFile(manifestPath);
  const manifest = parseManifest(manifestContent);

  const skills = await discoverSkillsDir(join(root, "skills"), root);
  const agents = await discoverAgentsDir(join(root, "agents"), root);

  return {
    manifest,
    name: manifest.name,
    version: manifest.version,
    runtimes: manifest.runtimes,
    skills,
    agents,
    hooks: manifest.hooks,
    permissions: manifest.permissions,
    repos: manifest.repos,
    output: manifest.output,
  };
}
