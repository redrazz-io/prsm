import matter from "gray-matter";
import { z } from "zod";
import type { AgentFrontmatter, ResolvedAgent } from "../types";

const AgentFrontmatterSchema = z.object({
	name: z.string(),
	description: z.string(),
	version: z.string().optional(),
	model: z.string().optional(),
	color: z.string().optional(),
	tools: z.array(z.string()).optional(),
	runtimes: z.array(z.string()).optional(),
});

export function parseAgentFile(
	fileContent: string,
	sourcePath: string,
): { frontmatter: AgentFrontmatter; content: string; sourcePath: string } {
	const { data, content } = matter(fileContent);
	const result = AgentFrontmatterSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid AGENT.md at ${sourcePath}:\n${issues}`);
	}
	return {
		frontmatter: result.data as AgentFrontmatter,
		content: content.trim(),
		sourcePath,
	};
}

export function agentToResolved(
	parsed: {
		frontmatter: AgentFrontmatter;
		content: string;
		sourcePath: string;
	},
	origin: "local" | "preset",
	originDetail: string,
): ResolvedAgent {
	return {
		name: parsed.frontmatter.name,
		frontmatter: parsed.frontmatter,
		content: parsed.content,
		sourcePath: parsed.sourcePath,
		origin,
		originDetail,
	};
}
