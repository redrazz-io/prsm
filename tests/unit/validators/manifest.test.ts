import { describe, it, expect } from "bun:test";
import { parseManifest } from "../../../src/core/manifest";

const VALID = `
name: my-hub
version: 1.0.0
runtimes: [claude-code]
extends: []
`;

describe("ManifestSchema strict mode", () => {
	it("rejects skills: [] with directory-discovery hint", () => {
		const yaml = `
name: my-hub
version: 1.0.0
runtimes: [claude-code]
skills: []
`;
		expect(() => parseManifest(yaml)).toThrow(
			/skills: prsm discovers skills from the `skills\/` directory automatically — remove this field from prsm\.yaml\./,
		);
	});

	it("rejects agents: [] with directory-discovery hint", () => {
		const yaml = `
name: my-hub
version: 1.0.0
runtimes: [claude-code]
agents: []
`;
		expect(() => parseManifest(yaml)).toThrow(
			/agents: prsm discovers agents from the `agents\/` directory automatically — remove this field from prsm\.yaml\./,
		);
	});

	it("rejects legacy skills: [{path: ...}] syntax (not just empty arrays)", () => {
		const yaml = `
name: my-hub
version: 1.0.0
runtimes: [claude-code]
skills:
  - path: ./skills/foo
`;
		expect(() => parseManifest(yaml)).toThrow(
			/skills.*directory-discovery|skills.*automatically/,
		);
	});

	it("rejects arbitrary unknown keys with generic strict-mode error", () => {
		const yaml = `
name: my-hub
version: 1.0.0
runtimes: [claude-code]
frobnicate: true
`;
		expect(() => parseManifest(yaml)).toThrow(/Invalid prsm\.yaml/);
		// Should NOT mention directory-discovery for non-skills/agents keys
		try {
			parseManifest(yaml);
		} catch (e) {
			expect((e as Error).message).not.toContain("directory-discovery");
			expect((e as Error).message).not.toContain("automatically");
		}
	});

	it("accepts a valid manifest", () => {
		const m = parseManifest(VALID);
		expect(m.name).toBe("my-hub");
		expect(m.version).toBe("1.0.0");
		expect(m.runtimes).toEqual(["claude-code"]);
	});

	it("preserves existing behavior for missing required fields", () => {
		expect(() => parseManifest(`name: my-hub`)).toThrow(/Invalid prsm\.yaml/);
	});
});
