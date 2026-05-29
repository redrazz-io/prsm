import { Command } from "commander";
import { findWorkspaceRoot, loadWorkspace } from "../core/workspace";
import { logger } from "../utils/logger";
import { validateDependencyPresence } from "../validators/dependencies";

export async function runValidate(root: string): Promise<string[]> {
	const ws = await loadWorkspace(root);
	const errors = await validateDependencyPresence(ws.skills, root);
	return errors;
}

export function validateCommand(): Command {
	return new Command("validate")
		.description("Lint manifest, skill files, and dependency declarations")
		.action(async () => {
			const root = await findWorkspaceRoot(process.cwd());
			if (!root) {
				logger.error("No prsm.yaml found.");
				process.exit(1);
			}
			try {
				const errors = await runValidate(root);
				if (errors.length === 0) {
					logger.success("Workspace is valid.");
				} else {
					for (const e of errors) logger.error(e);
					process.exit(1);
				}
			} catch (err) {
				logger.error(String(err));
				process.exit(1);
			}
		});
}
