import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { validateDependencyPresence } from "../../../src/validators/dependencies";
import { ensureDir, writeTextFile } from "../../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { ResolvedSkill } from "../../../src/types";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-dep-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

function makeSkill(name: string, deps: Record<string, { source: string; required: boolean }>): ResolvedSkill {
  return {
    name,
    category: "test",
    frontmatter: {
      name,
      description: "test",
      dependencies: Object.fromEntries(
        Object.entries(deps).map(([k, v]) => [k, { type: "skill" as const, source: v.source as "local" | "remote", required: v.required }])
      ),
    },
    content: "",
    sourcePath: `skills/test/${name}/SKILL.md`,
    origin: "local",
    originDetail: `skills/test/${name}/SKILL.md`,
    supportFiles: [],
  };
}

describe("validateDependencyPresence", () => {
  it("passes when required local dep exists", async () => {
    await ensureDir(join(tmp, "skills/test/dep-skill"));
    await writeTextFile(join(tmp, "skills/test/dep-skill/SKILL.md"), "---\nname: dep-skill\ndescription: x\n---\ncontent");
    const skill = makeSkill("my-skill", { "dep-skill": { source: "local", required: true } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(0);
  });

  it("fails when required local dep is missing", async () => {
    const skill = makeSkill("my-skill", { "missing-dep": { source: "local", required: true } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("missing-dep");
    expect(errors[0]).toContain("my-skill");
  });

  it("ignores optional local dep that is missing", async () => {
    const skill = makeSkill("my-skill", { "opt-dep": { source: "local", required: false } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(0);
  });

  it("ignores remote deps (not locally checkable)", async () => {
    const skill = makeSkill("my-skill", { "remote-dep": { source: "remote", required: true } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(0);
  });
});
