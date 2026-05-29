import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runValidate } from "../../src/commands/validate";
import { writeTextFile, ensureDir } from "../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-val-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

const MANIFEST = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
`;

const SKILL_WITH_MISSING_DEP = `---
name: my-skill
description: test
dependencies:
  missing-dep:
    type: skill
    source: local
    required: true
---
content
`;

describe("runValidate", () => {
	it("returns no errors for a clean workspace", async () => {
		await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
		const errors = await runValidate(tmp);
		expect(errors).toHaveLength(0);
	});

	it("returns error when required local dep is missing", async () => {
		await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
		await ensureDir(join(tmp, "skills/test/my-skill"));
		await writeTextFile(
			join(tmp, "skills/test/my-skill/SKILL.md"),
			SKILL_WITH_MISSING_DEP,
		);
		const errors = await runValidate(tmp);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("missing-dep");
	});
});
