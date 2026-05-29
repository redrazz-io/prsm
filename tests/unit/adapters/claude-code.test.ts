import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { fileExists, readTextFile } from "../../../src/utils/fs";
import type {
	ResolvedSkill,
	ResolvedAgent,
	WorkspaceModel,
} from "../../../src/types";

let tmp: string;
const adapter = new ClaudeCodeAdapter();
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-cc-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

const skill: ResolvedSkill = {
	name: "platform-copilot",
	category: "platform",
	frontmatter: {
		name: "platform-copilot",
		description: "Routes platform work",
		triggers: ["dispatch work"],
		tools: ["Read", "Write"],
	},
	content: "# Platform Copilot\n\nThis skill routes work.",
	sourcePath: "skills/platform/copilot/SKILL.md",
	origin: "local",
	originDetail: "local",
};

const agent: ResolvedAgent = {
	name: "pr-reviewer",
	frontmatter: {
		name: "pr-reviewer",
		description: "Reviews PRs",
		model: "claude-sonnet-4-6",
		color: "purple",
		tools: ["Read", "Bash"],
	},
	content: "You are an expert reviewer.",
	sourcePath: "agents/pr-reviewer/AGENT.md",
	origin: "local",
	originDetail: "local",
};

describe("ClaudeCodeAdapter", () => {
	it("writes skill to hub-<category>-<name>/SKILL.md", async () => {
		await adapter.compileSkill(skill, tmp);
		const path = join(
			tmp,
			".claude/skills/hub-platform-platform-copilot/SKILL.md",
		);
		expect(await fileExists(path)).toBe(true);
		const content = await readTextFile(path);
		expect(content).toContain("name: platform-copilot");
		expect(content).toContain("# Platform Copilot");
	});

	it("writes agent to agents/<name>.md", async () => {
		await adapter.compileAgent(agent, tmp);
		const path = join(tmp, ".claude/agents/pr-reviewer.md");
		expect(await fileExists(path)).toBe(true);
		const content = await readTextFile(path);
		expect(content).toContain("model: claude-sonnet-4-6");
		expect(content).toContain("You are an expert reviewer.");
	});

	it("generateConfig writes hooks to settings.json", async () => {
		const model: WorkspaceModel = {
			name: "test",
			version: "1.0.0",
			runtimes: ["claude-code"],
			skills: [],
			agents: [],
			hooks: { stop: "hooks/stop.sh", "pre-tool-use": "hooks/safety.sh" },
			permissions: ["Bash(git *)"],
			repos: {},
			output: {},
		};
		await adapter.generateConfig(model, tmp);
		const path = join(tmp, ".claude/settings.json");
		expect(await fileExists(path)).toBe(true);
		const settings = JSON.parse(await readTextFile(path));
		expect(settings.hooks.Stop).toBeDefined();
		expect(settings.hooks.PreToolUse).toBeDefined();
		expect(settings.permissions.allow).toContain("Bash(git *)");
	});
});
