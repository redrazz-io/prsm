import { describe, expect, it } from "bun:test";
import type { WorkspaceManifest } from "../../src/types";

describe("types", () => {
	it("WorkspaceManifest shape is correct", () => {
		const manifest: WorkspaceManifest = {
			name: "my-hub",
			version: "1.0.0",
			runtimes: ["claude-code"],
			hooks: {},
			repos: {},
			extends: [],
			dependencies: {},
			permissions: [],
			output: {},
		};
		expect(manifest.name).toBe("my-hub");
	});
});
