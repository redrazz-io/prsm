import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { parsePresetManifest, computePresetContentHash } from "../core/preset";
import { writeLockFile, createLockFile } from "../core/lockfile";
import { readTextFile, fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { join } from "path";

export async function runInstall(root: string): Promise<void> {
	const ws = await loadWorkspace(root);
	const manifest = ws.manifest;
	const presetEntries: Record<
		string,
		{ version: string; url: string; checksum: string }
	> = {};

	for (const presetRef of manifest.extends) {
		const presetYamlPath = join(presetRef, "preset.yaml");
		if (!(await fileExists(presetYamlPath))) {
			throw new Error(
				`Cannot resolve preset "${presetRef}": preset.yaml not found at ${presetYamlPath}`,
			);
		}
		const content = await readTextFile(presetYamlPath);
		const presetManifest = parsePresetManifest(content, presetYamlPath);
		const checksum = `sha256:${await computePresetContentHash(presetRef)}`;
		presetEntries[presetManifest.name] = {
			version: presetManifest.version,
			url: presetRef,
			checksum,
		};
		logger.success(`Resolved ${presetManifest.name}@${presetManifest.version}`);
	}

	const lock = createLockFile(presetEntries);
	await writeLockFile(join(root, "prsm.lock"), lock);
	logger.success(
		`prsm.lock written with ${Object.keys(presetEntries).length} preset(s).`,
	);
}

export function installCommand(): Command {
	return new Command("install")
		.description("Resolve preset inheritance and generate prsm.lock")
		.action(async () => {
			const root = await findWorkspaceRoot(process.cwd());
			if (!root) {
				logger.error("No prsm.yaml found.");
				process.exit(1);
			}
			try {
				await runInstall(root);
			} catch (err) {
				logger.error(String(err));
				process.exit(1);
			}
		});
}
