import { describe, it, expect } from "bun:test";
import type { WorkspaceManifest, ResolvedSkill, ResolvedAgent } from "../../src/types";

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
      output: {},
    };
    expect(manifest.name).toBe("my-hub");
  });
});
