import { join } from "path";
import { fileExists, readTextFile, writeTextFile, ensureDir } from "./fs";

function manifestPath(outputBase: string, adapterId: string): string {
	return join(outputBase, `.prsm/generated-files-${adapterId}.json`);
}

export async function trackGeneratedFile(
	outputBase: string,
	adapterId: string,
	path: string,
): Promise<void> {
	const mPath = manifestPath(outputBase, adapterId);
	let files: string[] = [];
	if (await fileExists(mPath)) {
		files = JSON.parse(await readTextFile(mPath));
	}
	if (!files.includes(path)) {
		files.push(path);
		await ensureDir(join(outputBase, ".prsm"));
		await writeTextFile(mPath, JSON.stringify(files, null, 2));
	}
}

export async function cleanGeneratedFiles(
	outputBase: string,
	adapterId: string,
): Promise<void> {
	const mPath = manifestPath(outputBase, adapterId);
	if (!(await fileExists(mPath))) return;
	const { rm } = await import("fs/promises");
	const files: string[] = JSON.parse(await readTextFile(mPath));
	for (const f of files) {
		try {
			await rm(f, { force: true });
		} catch {}
	}
	await rm(mPath, { force: true });
}
