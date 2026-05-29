import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { findRepo } from "../core/repo-map";
import { findWorkspaceRoot, loadWorkspace } from "../core/workspace";
import { fileExists, readTextFile } from "../utils/fs";
import { logger } from "../utils/logger";

export function contextCommand(): Command {
	return new Command("context")
		.description("Load target repo AGENTS.md and presets into session context")
		.argument("<repo>", "repo name as declared in prsm.yaml repos:")
		.action(async (repoName: string) => {
			const root = await findWorkspaceRoot(process.cwd());
			if (!root) {
				logger.error("No prsm.yaml found.");
				process.exit(1);
			}
			const ws = await loadWorkspace(root);
			const found = findRepo(ws.repos, repoName);

			if (!found) {
				const available = Object.values(ws.repos)
					.flatMap((cat) => Object.keys(cat))
					.sort();
				logger.error(
					`Repo "${repoName}" not found. Available: ${available.join(", ")}`,
				);
				process.exit(1);
			}

			const { entry } = found;
			const repoPath = entry.path.replace(/^~/, process.env.HOME ?? "~");
			const agentsMdPath = join(repoPath, "AGENTS.md");

			console.log(chalk.bold(`\nContext for: ${repoName}`));
			console.log(`  Path:   ${repoPath}`);
			console.log(`  Org:    ${entry.org ?? "(not set)"}`);
			console.log(`  Branch: ${entry.default_branch ?? "main"}`);

			if (await fileExists(agentsMdPath)) {
				const content = await readTextFile(agentsMdPath);
				console.log(chalk.bold("\nAGENTS.md:"));
				console.log(content);
			} else {
				logger.warn(`No AGENTS.md found at ${agentsMdPath}`);
			}
		});
}
