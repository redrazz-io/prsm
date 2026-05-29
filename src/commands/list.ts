import chalk from "chalk";
import { Command } from "commander";
import { findWorkspaceRoot, loadWorkspace } from "../core/workspace";
import { logger } from "../utils/logger";

export function listCommand(): Command {
	return new Command("list")
		.description("List installed skills, agents, and their runtime targets")
		.action(async () => {
			const root = await findWorkspaceRoot(process.cwd());
			if (!root) {
				logger.error("No prsm.yaml found.");
				process.exit(1);
			}
			const ws = await loadWorkspace(root);

			console.log(chalk.bold("\nSkills:"));
			if (ws.skills.length === 0) {
				console.log("  (none)");
			} else {
				for (const s of ws.skills) {
					const runtimes = s.frontmatter.runtimes ?? ws.runtimes;
					console.log(
						`  ${chalk.cyan(s.name)} (${s.category}) — ${s.frontmatter.description}`,
					);
					console.log(
						`    runtimes: ${runtimes.join(", ")}  origin: ${s.origin}`,
					);
				}
			}

			console.log(chalk.bold("\nAgents:"));
			if (ws.agents.length === 0) {
				console.log("  (none)");
			} else {
				for (const a of ws.agents) {
					console.log(
						`  ${chalk.magenta(a.name)} — ${a.frontmatter.description}`,
					);
					console.log(
						`    model: ${a.frontmatter.model ?? "default"}  origin: ${a.origin}`,
					);
				}
			}
			console.log();
		});
}
