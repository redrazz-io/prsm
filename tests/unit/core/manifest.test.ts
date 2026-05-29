import { describe, expect, it } from "bun:test";
import { parseManifest } from "../../../src/core/manifest";

const VALID_YAML = `
name: my-hub
version: 1.0.0
runtimes:
  - claude-code
hooks:
  session-start: hooks/session-start.sh
repos: {}
extends: []
output:
  claude-code:
    skills: .claude/skills/
    agents: .claude/agents/
`;

describe("parseManifest", () => {
	it("parses a valid prsm.yaml", () => {
		const m = parseManifest(VALID_YAML);
		expect(m.name).toBe("my-hub");
		expect(m.runtimes).toContain("claude-code");
		expect(m.hooks["session-start"]).toBe("hooks/session-start.sh");
	});

	it("throws on missing required fields", () => {
		expect(() => parseManifest("name: only-name")).toThrow();
	});

	it("defaults missing optional fields to sensible empties", () => {
		const m = parseManifest(
			"name: x\nversion: 1.0.0\nruntimes:\n  - claude-code",
		);
		expect(m.extends).toEqual([]);
		expect(m.dependencies).toEqual({});
		expect(m.repos).toEqual({});
		expect(m.output).toEqual({});
	});
});
