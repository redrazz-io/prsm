import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { readLockFile } from "../core/lockfile";
import { findWorkspaceRoot, loadWorkspace } from "../core/workspace";
import { fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { validateDependencyPresence } from "../validators/dependencies";

export function doctorCommand(): Command {
	return new Command("doctor")
		.description("Diagnose workspace configuration issues")
		.action(async () => {
			const root = await findWorkspaceRoot(process.cwd());
			if (!root) {
				logger.error("No prsm.yaml found.");
				process.exit(1);
			}

			let issues = 0;
			const lock = await readLockFile(join(root, "prsm.lock"));
			const ws = await loadWorkspace(root);

			if (ws.manifest.extends.length > 0 && !lock) {
				logger.warn(`prsm.lock missing — run prsm install to generate it`);
				issues++;
			} else if (lock) {
				logger.success(`prsm.lock found (resolved at ${lock.resolvedAt})`);
			}

			const depErrors = await validateDependencyPresence(ws.skills, root);
			for (const e of depErrors) {
				logger.warn(e);
				issues++;
			}

			for (const [event, scriptPath] of Object.entries(ws.hooks)) {
				if (!scriptPath) continue;
				const full = join(root, scriptPath);
				if (!(await fileExists(full))) {
					logger.warn(`Hook ${event}: script "${scriptPath}" not found`);
					issues++;
				} else {
					logger.success(`Hook ${event}: ${scriptPath}`);
				}
			}

			if (issues === 0) {
				logger.success("Workspace looks healthy.");
			} else {
				console.log(chalk.yellow(`\n${issues} issue(s) found.`));
				process.exit(1);
			}
		});
}
