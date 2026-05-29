import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstall } from "../../src/commands/install";
import { ensureDir, fileExists, writeTextFile } from "../../src/utils/fs";

let tmp: string;
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-install-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

const MANIFEST_NO_PRESETS = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends: []
`;

const PRESET_YAML = `
name: test-preset
version: 1.0.0
skills: []
agents: []
hooks: {}
permissions: []
`;

describe("runInstall", () => {
	it("creates prsm.lock when no extends (empty lock)", async () => {
		await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST_NO_PRESETS);
		await runInstall(tmp);
		expect(await fileExists(join(tmp, "prsm.lock"))).toBe(true);
	});

	it("resolves local preset and writes lock entry", async () => {
		const presetDir = join(tmp, "presets/test-preset");
		await ensureDir(presetDir);
		await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
		const manifest = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifest);
		await runInstall(tmp);
		expect(await fileExists(join(tmp, "prsm.lock"))).toBe(true);
	});
});
