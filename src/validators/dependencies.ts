import { join } from "node:path";
import type { ResolvedSkill } from "../types";
import { fileExists } from "../utils/fs";

async function findSkillPath(
	depName: string,
	workspaceRoot: string,
): Promise<string | null> {
	const { readdir } = await import("node:fs/promises");
	const skillsDir = join(workspaceRoot, "skills");
	if (!(await fileExists(skillsDir))) return null;

	const cats = await readdir(skillsDir, { withFileTypes: true });
	for (const cat of cats) {
		if (!cat.isDirectory()) continue;
		const candidate = join(skillsDir, cat.name, depName, "SKILL.md");
		if (await fileExists(candidate)) return candidate;
	}
	return null;
}

export async function validateDependencyPresence(
	skills: ResolvedSkill[],
	workspaceRoot: string,
): Promise<string[]> {
	const errors: string[] = [];

	for (const skill of skills) {
		const deps = skill.frontmatter.dependencies ?? {};
		for (const [depName, dep] of Object.entries(deps)) {
			if (!dep.required) continue;
			if (dep.source !== "local") continue;

			const found = await findSkillPath(depName, workspaceRoot);
			if (!found) {
				errors.push(
					`Skill "${skill.name}" requires local skill "${depName}" but it was not found in skills/. ` +
						`Add it under skills/<category>/${depName}/SKILL.md or set required: false.`,
				);
			}
		}
	}

	return errors;
}
