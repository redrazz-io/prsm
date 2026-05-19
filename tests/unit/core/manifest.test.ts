import { describe, it, expect } from "bun:test";
import { parseManifest, ManifestSchema } from "../../../src/core/manifest";

const VALID_YAML = `
name: my-hub
version: 1.0.0
runtimes:
  - claude-code
skills:
  - path: skills/platform/copilot
agents: []
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
    expect(m.skills).toHaveLength(1);
    expect(m.hooks["session-start"]).toBe("hooks/session-start.sh");
  });

  it("throws on missing required fields", () => {
    expect(() => parseManifest("name: only-name")).toThrow();
  });

  it("defaults missing optional arrays to empty", () => {
    const m = parseManifest("name: x\nversion: 1.0.0\nruntimes:\n  - claude-code");
    expect(m.extends).toEqual([]);
    expect(m.skills).toEqual([]);
    expect(m.agents).toEqual([]);
  });
});
