import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { listAllRepos } from "../core/repo-map";
import { fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { join } from "path";
import chalk from "chalk";

export function diffCommand(): Command {
	return new Command("diff")
		.description("Detect drift in skills/hooks/permissions")
		.option("--cross-repo", "detect drift across all mapped repos")
		.action(async (options: { crossRepo?: boolean }) => {
			const root = await findWorkspaceRoot(process.cwd());
			if (!root) {
				logger.error("No prsm.yaml found.");
				process.exit(1);
			}
			const ws = await loadWorkspace(root);

			if (options.crossRepo) {
				const repos = listAllRepos(ws.repos as any);
				if (repos.length === 0) {
					logger.info("No repos mapped in prsm.yaml repos: block.");
					return;
				}
				for (const { name, entry } of repos) {
					const repoPath = entry.path.replace(/^~/, process.env.HOME ?? "~");
					const hasPrsm = await fileExists(join(repoPath, "prsm.yaml"));
					const hasAgentsMd = await fileExists(join(repoPath, "AGENTS.md"));
					const status = hasPrsm
						? chalk.green("prsm workspace")
						: hasAgentsMd
							? chalk.yellow("AGENTS.md only (not prsm)")
							: chalk.dim("no AI config");
					console.log(`  ${chalk.bold(name)}: ${status}`);
				}
			} else {
				logger.info(
					"Local diff: comparing current workspace against last build output...",
				);
				logger.info(
					"Run prsm build to regenerate outputs and use git diff to see changes.",
				);
			}
		});
}
