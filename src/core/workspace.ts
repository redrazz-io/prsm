import { join, relative, dirname } from "path";
import { readdir } from "fs/promises";
import { readTextFile, fileExists } from "../utils/fs";
import { parseManifest } from "./manifest";
import { parseSkillFile, skillToResolved } from "./skill";
import { parseAgentFile, agentToResolved } from "./agent";
import type {
	WorkspaceManifest,
	WorkspaceModel,
	ResolvedSkill,
	ResolvedAgent,
} from "../types";

export async function findWorkspaceRoot(from: string): Promise<string | null> {
	let dir = from;
	while (true) {
		if (await fileExists(join(dir, "prsm.yaml"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

async function discoverSkillsDir(
	skillsDir: string,
	workspaceRoot: string,
): Promise<ResolvedSkill[]> {
	const skills: ResolvedSkill[] = [];
	if (!(await fileExists(skillsDir))) return skills;

	const categories = await readdir(skillsDir, { withFileTypes: true });
	for (const cat of categories) {
		if (!cat.isDirectory()) continue;
		const catDir = join(skillsDir, cat.name);
		const skillDirs = await readdir(catDir, { withFileTypes: true });
		for (const sd of skillDirs) {
			if (!sd.isDirectory()) continue;
			const skillMdPath = join(catDir, sd.name, "SKILL.md");
			if (!(await fileExists(skillMdPath))) continue;
			const content = await readTextFile(skillMdPath);
			const relPath = relative(workspaceRoot, skillMdPath);
			const parsed = parseSkillFile(content, relPath);
			skills.push(skillToResolved(parsed, "local", relPath));
		}
	}
	return skills;
}

async function discoverAgentsDir(
	agentsDir: string,
	workspaceRoot: string,
): Promise<ResolvedAgent[]> {
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

export async function loadWorkspace(
	root: string,
): Promise<WorkspaceModel & { manifest: WorkspaceManifest }> {
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
