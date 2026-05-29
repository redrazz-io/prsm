import { z } from "zod";
import { parseYaml } from "../utils/yaml";
import type { WorkspaceManifest } from "../types";

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

export const ManifestSchema = z
	.object({
		name: z.string(),
		version: z.string(),
		author: z.string().optional(),
		runtimes: z.array(z.enum(["claude-code", "codex"])).min(1),
		extends: z.array(z.string()).default([]),
		dependencies: z.record(z.string()).default({}),
		permissions: z.array(z.string()).default([]),
		hooks: HooksSchema,
		repos: z.record(z.record(RepoEntrySchema)).default({}),
		output: z.record(OutputConfigSchema).default({}),
	})
	.strict();

const DIRECTORY_DISCOVERY_KEYS = new Set(["skills", "agents"]);

export function parseManifest(yamlContent: string): WorkspaceManifest {
	const raw = parseYaml(yamlContent);
	const result = ManifestSchema.safeParse(raw);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => {
				const key = i.path[0];
				if (
					i.code === "unrecognized_keys" &&
					Array.isArray((i as { keys?: unknown }).keys)
				) {
					const unknown = (i as { keys: string[] }).keys;
					const discovery = unknown.filter((k) =>
						DIRECTORY_DISCOVERY_KEYS.has(k),
					);
					if (discovery.length > 0) {
						return discovery
							.map(
								(k) =>
									`  ${k}: prsm discovers ${k} from the \`${k}/\` directory automatically — remove this field from prsm.yaml.`,
							)
							.join("\n");
					}
				}
				const path =
					i.path.length > 0
						? i.path.join(".")
						: typeof key === "string"
							? key
							: "";
				return `  ${path}: ${i.message}`;
			})
			.join("\n");
		throw new Error(`Invalid prsm.yaml:\n${issues}`);
	}
	return result.data as WorkspaceManifest;
}
