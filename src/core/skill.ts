import matter from "gray-matter";
import { z } from "zod";
import type { SkillFrontmatter, ResolvedSkill } from "../types";

const SkillDependencySchema = z.object({
	type: z.enum(["skill", "plugin", "library"]),
	source: z.enum(["local", "remote", "package-manager"]),
	version: z.string().optional(),
	platforms: z.array(z.string()).optional(),
	required: z.boolean(),
});

const SkillFrontmatterSchema = z.object({
	name: z.string(),
	description: z.string(),
	version: z.string().optional(),
	category: z.string().optional(),
	triggers: z.array(z.string()).optional(),
	runtimes: z.array(z.string()).optional(),
	tools: z.array(z.string()).optional(),
	"cross-repo": z.boolean().optional(),
	dependencies: z.record(SkillDependencySchema).optional(),
});

export function parseSkillFile(
	fileContent: string,
	sourcePath: string,
): { frontmatter: SkillFrontmatter; content: string; sourcePath: string } {
	const { data, content } = matter(fileContent);
	const result = SkillFrontmatterSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid SKILL.md at ${sourcePath}:\n${issues}`);
	}
	return {
		frontmatter: result.data as SkillFrontmatter,
		content: content.trim(),
		sourcePath,
	};
}

export function skillToResolved(
	parsed: {
		frontmatter: SkillFrontmatter;
		content: string;
		sourcePath: string;
	},
	origin: "local" | "preset",
	originDetail: string,
): ResolvedSkill {
	return {
		name: parsed.frontmatter.name,
		category: parsed.frontmatter.category ?? "general",
		frontmatter: parsed.frontmatter,
		content: parsed.content,
		sourcePath: parsed.sourcePath,
		origin,
		originDetail,
	};
}
