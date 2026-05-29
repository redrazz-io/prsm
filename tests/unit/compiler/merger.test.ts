import { describe, it, expect } from "bun:test";
import { mergeLayers } from "../../../src/compiler/merger";
import type { WorkspaceModel, ResolvedSkill } from "../../../src/types";

function makeModel(skills: ResolvedSkill[]): WorkspaceModel {
	return {
		name: "test",
		version: "1.0.0",
		runtimes: ["claude-code"],
		skills,
		agents: [],
		hooks: {},
		permissions: [],
		repos: {},
		output: {},
	};
}

function makeSkill(name: string, origin: "local" | "preset"): ResolvedSkill {
	return {
		name,
		category: "test",
		frontmatter: { name, description: "test" },
		content: `content for ${name} from ${origin}`,
		sourcePath: `skills/test/${name}/SKILL.md`,
		origin,
		originDetail: origin,
	};
}

describe("mergeLayers", () => {
	it("later layer wins on name conflict", () => {
		const base = makeModel([makeSkill("platform-copilot", "preset")]);
		const local = makeModel([makeSkill("platform-copilot", "local")]);
		const merged = mergeLayers([base, local]);
		expect(merged.skills).toHaveLength(1);
		expect(merged.skills[0].origin).toBe("local");
	});

	it("preserves skills from both layers when no conflict", () => {
		const layer1 = makeModel([makeSkill("skill-a", "preset")]);
		const layer2 = makeModel([makeSkill("skill-b", "local")]);
		const merged = mergeLayers([layer1, layer2]);
		expect(merged.skills).toHaveLength(2);
	});

	it("permissions are additive", () => {
		const layer1: WorkspaceModel = {
			...makeModel([]),
			permissions: ["Bash(git *)"],
		};
		const layer2: WorkspaceModel = {
			...makeModel([]),
			permissions: ["Bash(gh *)"],
		};
		const merged = mergeLayers([layer1, layer2]);
		expect(merged.permissions).toContain("Bash(git *)");
		expect(merged.permissions).toContain("Bash(gh *)");
	});

	it("hooks: later layer wins per event", () => {
		const layer1: WorkspaceModel = {
			...makeModel([]),
			hooks: { stop: "hooks/base-stop.sh" },
		};
		const layer2: WorkspaceModel = {
			...makeModel([]),
			hooks: { stop: "hooks/local-stop.sh" },
		};
		const merged = mergeLayers([layer1, layer2]);
		expect(merged.hooks.stop).toBe("hooks/local-stop.sh");
	});
});
