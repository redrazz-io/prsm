import { join } from "node:path";
import matter from "gray-matter";
import type {
	ResolvedAgent,
	ResolvedSkill,
	RuntimeAdapter,
	WorkspaceModel,
} from "../types";
import { writeTextFile } from "../utils/fs";
import {
	cleanGeneratedFiles,
	trackGeneratedFile,
} from "../utils/generated-files";
import { logger } from "../utils/logger";

export class CodexAdapter implements RuntimeAdapter {
	id = "codex";
	displayName = "Codex CLI";

	async compileSkill(skill: ResolvedSkill, outputBase: string): Promise<void> {
		const dirName = `hub-${skill.category}-${skill.name}`;
		const outPath = join(outputBase, ".agents/skills", dirName, "SKILL.md");
		const compiled = matter.stringify(
			skill.content,
			skill.frontmatter as unknown as Record<string, unknown>,
		);
		await writeTextFile(outPath, compiled);
		await trackGeneratedFile(outputBase, this.id, outPath);
	}

	// Codex has no agent concept in v1 — no-op
	async compileAgent(
		_agent: ResolvedAgent,
		_outputBase: string,
	): Promise<void> {}

	// Codex does not support hooks in v1 — silently skip
	async generateConfig(
		model: WorkspaceModel,
		_outputBase: string,
	): Promise<void> {
		const declaredHooks = Object.values(model.hooks).filter(Boolean);
		if (declaredHooks.length > 0) {
			logger.dim(
				`  [codex] Hooks declared but Codex does not support hooks — skipped`,
			);
		}
	}

	async clean(outputBase: string): Promise<void> {
		await cleanGeneratedFiles(outputBase, this.id);
	}
}
