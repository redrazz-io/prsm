import { describe, expect, it } from "bun:test";
import { parseSkillFile } from "../../../src/core/skill";

const SKILL_MD = `---
name: platform-copilot
description: Routes platform work
version: 1.0.0
category: platform
triggers:
  - dispatch work
runtimes:
  - claude-code
tools:
  - Read
  - Write
dependencies:
  hub-adr:
    type: skill
    source: local
    required: true
---

# Platform Copilot

This skill routes work.
`;

describe("parseSkillFile", () => {
	it("extracts frontmatter and content", () => {
		const skill = parseSkillFile(SKILL_MD, "skills/platform/copilot/SKILL.md");
		expect(skill.frontmatter.name).toBe("platform-copilot");
		expect(skill.frontmatter.triggers).toContain("dispatch work");
		expect(skill.content).toContain("# Platform Copilot");
		expect(skill.frontmatter.dependencies?.["hub-adr"].required).toBe(true);
	});

	it("throws when name is missing", () => {
		expect(() =>
			parseSkillFile("---\ndescription: x\n---\ncontent", "path"),
		).toThrow();
	});
});
