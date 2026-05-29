import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { logger } from "../utils/logger";
import chalk from "chalk";

export function explainCommand(): Command {
	return new Command("explain")
		.description("Show resolved configuration for a skill or agent")
		.argument("<name>", "skill or agent name")
		.action(async (name: string) => {
			const root = await findWorkspaceRoot(process.cwd());
			if (!root) {
				logger.error("No prsm.yaml found.");
				process.exit(1);
			}
			const ws = await loadWorkspace(root);

			const skill = ws.skills.find((s) => s.name === name);
			const agent = ws.agents.find((a) => a.name === name);

			if (!skill && !agent) {
				logger.error(`No skill or agent named "${name}" found.`);
				process.exit(1);
			}

			if (skill) {
				console.log(chalk.bold(`\nSkill: ${skill.name}`));
				console.log(`  Description: ${skill.frontmatter.description}`);
				console.log(`  Category:    ${skill.category}`);
				console.log(`  Origin:      ${skill.origin} (${skill.originDetail})`);
				console.log(
					`  Triggers:    ${(skill.frontmatter.triggers ?? []).join(", ") || "(none)"}`,
				);
				console.log(
					`  Tools:       ${(skill.frontmatter.tools ?? []).join(", ") || "(any)"}`,
				);
				if (skill.frontmatter.dependencies) {
					console.log(`  Dependencies:`);
					for (const [dep, info] of Object.entries(
						skill.frontmatter.dependencies,
					)) {
						console.log(
							`    ${dep}: ${info.type}/${info.source} required=${info.required}`,
						);
					}
				}
			}

			if (agent) {
				console.log(chalk.bold(`\nAgent: ${agent.name}`));
				console.log(`  Description: ${agent.frontmatter.description}`);
				console.log(`  Model:       ${agent.frontmatter.model ?? "default"}`);
				console.log(`  Origin:      ${agent.origin} (${agent.originDetail})`);
				console.log(
					`  Tools:       ${(agent.frontmatter.tools ?? []).join(", ") || "(any)"}`,
				);
			}
			console.log();
		});
}
