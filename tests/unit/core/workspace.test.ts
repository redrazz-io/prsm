import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadWorkspace } from "../../../src/core/workspace";
import { writeTextFile, ensureDir } from "../../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-ws-"));
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

const SKILL_MD = `---
name: my-skill
description: A test skill
category: test
---
# My Skill
content here
`;

describe("loadWorkspace", () => {
	it("loads manifest and discovers local skills", async () => {
		await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
		await ensureDir(join(tmp, "skills/test/my-skill"));
		await writeTextFile(join(tmp, "skills/test/my-skill/SKILL.md"), SKILL_MD);

		const ws = await loadWorkspace(tmp);
		expect(ws.name).toBe("test-ws");
		expect(ws.skills).toHaveLength(1);
		expect(ws.skills[0].name).toBe("my-skill");
		expect(ws.skills[0].origin).toBe("local");
	});

	it("throws when prsm.yaml is missing", async () => {
		await expect(loadWorkspace(tmp)).rejects.toThrow("prsm.yaml");
	});
});
