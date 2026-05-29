import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CodexAdapter } from "../../../src/adapters/codex";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { fileExists } from "../../../src/utils/fs";
import type { ResolvedSkill, WorkspaceModel } from "../../../src/types";

let tmp: string;
const adapter = new CodexAdapter();
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-codex-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

const skill: ResolvedSkill = {
	name: "platform-copilot",
	category: "platform",
	frontmatter: { name: "platform-copilot", description: "Routes work" },
	content: "# Platform Copilot",
	sourcePath: "skills/platform/copilot/SKILL.md",
	origin: "local",
	originDetail: "local",
};

describe("CodexAdapter", () => {
	it("writes skill to .agents/skills/", async () => {
		await adapter.compileSkill(skill, tmp);
		const path = join(
			tmp,
			".agents/skills/hub-platform-platform-copilot/SKILL.md",
		);
		expect(await fileExists(path)).toBe(true);
	});

	it("generateConfig is a no-op for v1 (no hooks)", async () => {
		const model: WorkspaceModel = {
			name: "test",
			version: "1.0.0",
			runtimes: ["codex"],
			skills: [],
			agents: [],
			hooks: { stop: "hooks/stop.sh" },
			permissions: [],
			repos: {},
			output: {},
		};
		// Should not throw even with hooks declared
		await expect(adapter.generateConfig(model, tmp)).resolves.toBeUndefined();
		// No settings file written
		expect(await fileExists(join(tmp, ".agents/openai.yaml"))).toBe(false);
	});
});
