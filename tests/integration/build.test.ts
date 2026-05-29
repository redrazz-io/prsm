import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { compile } from "../../src/compiler/index";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs";
import { computePresetContentHash } from "../../src/core/preset";
import { dumpYaml } from "../../src/utils/yaml";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { LockFile } from "../../src/types";

let tmp: string;
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-build-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

const MANIFEST = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
  - codex
output:
  claude-code:
    skills: .claude/skills/
  codex:
    skills: .agents/skills/
`;

const SKILL_MD = `---
name: my-skill
description: A test skill
category: platform
triggers:
  - invoke my skill
---
# My Skill
Content here.
`;

const PRESET_SKILL_MD = `---
name: preset-skill
description: A skill from a preset
category: security
---
# Preset Skill
From preset.
`;

const PRESET_YAML = `
name: test-preset
version: 1.0.0
skills: []
agents: []
hooks: {}
permissions: []
`;

describe("compile", () => {
	it("outputs local skill to both runtimes", async () => {
		await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
		await ensureDir(join(tmp, "skills/platform/my-skill"));
		await writeTextFile(
			join(tmp, "skills/platform/my-skill/SKILL.md"),
			SKILL_MD,
		);

		await compile(tmp);

		expect(
			await fileExists(
				join(tmp, ".claude/skills/hub-platform-my-skill/SKILL.md"),
			),
		).toBe(true);
		expect(
			await fileExists(
				join(tmp, ".agents/skills/hub-platform-my-skill/SKILL.md"),
			),
		).toBe(true);
	});

	it("generates .claude/settings.json when hooks are declared", async () => {
		const manifestWithHooks = MANIFEST + `\nhooks:\n  stop: hooks/stop.sh\n`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithHooks);

		await compile(tmp);

		expect(await fileExists(join(tmp, ".claude/settings.json"))).toBe(true);
	});

	it("preset skill appears in build output when extends + prsm.lock present", async () => {
		// Set up a local preset directory
		const presetDir = join(tmp, "presets/test-preset");
		await ensureDir(join(presetDir, "skills/security/preset-skill"));
		await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
		await writeTextFile(
			join(presetDir, "skills/security/preset-skill/SKILL.md"),
			PRESET_SKILL_MD,
		);

		const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

		// Create prsm.lock with correct checksum — hash the full preset content tree
		const checksum = `sha256:${await computePresetContentHash(presetDir)}`;
		const lock: LockFile = {
			version: 1,
			presets: {
				"test-preset": { version: "1.0.0", url: presetDir, checksum },
			},
			resolvedAt: new Date().toISOString(),
		};
		await writeTextFile(
			join(tmp, "prsm.lock"),
			"# Auto-generated\n" + dumpYaml(lock),
		);

		await compile(tmp);

		expect(
			await fileExists(
				join(tmp, ".claude/skills/hub-security-preset-skill/SKILL.md"),
			),
		).toBe(true);
	});

	// CRITICAL REGRESSION (AE1): mutating any file inside an installed preset
	// must cause prsm compile to fail. Pre-U4, the checksum hashed only
	// preset.yaml — so editing skills/foo/SKILL.md was undetected.
	it("compile fails when a SKILL.md inside an installed preset is mutated", async () => {
		const presetDir = join(tmp, "presets/test-preset");
		await ensureDir(join(presetDir, "skills/security/preset-skill"));
		await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
		await writeTextFile(
			join(presetDir, "skills/security/preset-skill/SKILL.md"),
			PRESET_SKILL_MD,
		);

		const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

		const { runInstall } = await import("../../src/commands/install");
		await runInstall(tmp);

		// Tamper with the SKILL.md (the bug U4 closes)
		await writeTextFile(
			join(presetDir, "skills/security/preset-skill/SKILL.md"),
			PRESET_SKILL_MD + "\nMALICIOUS APPEND\n",
		);

		await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
	});

	it("compile fails when an AGENT.md inside an installed preset is mutated", async () => {
		const presetDir = join(tmp, "presets/test-preset");
		await ensureDir(join(presetDir, "agents/my-agent"));
		await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
		await writeTextFile(
			join(presetDir, "agents/my-agent/AGENT.md"),
			"---\nname: my-agent\ndescription: x\n---\nbody\n",
		);

		const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

		const { runInstall } = await import("../../src/commands/install");
		await runInstall(tmp);

		await writeTextFile(
			join(presetDir, "agents/my-agent/AGENT.md"),
			"---\nname: my-agent\ndescription: tampered\n---\nbody\n",
		);

		await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
	});

	it("throws when extends declared but prsm.lock missing", async () => {
		const presetDir = join(tmp, "presets/test-preset");
		await ensureDir(presetDir);
		await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
		const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);
		await expect(compile(tmp)).rejects.toThrow("prsm.lock");
	});

	it("throws when preset checksum does not match prsm.lock", async () => {
		const presetDir = join(tmp, "presets/test-preset");
		await ensureDir(presetDir);
		await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);
		const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

		const lock: LockFile = {
			version: 1,
			presets: {
				"test-preset": {
					version: "1.0.0",
					url: presetDir,
					checksum: "sha256:badhash",
				},
			},
			resolvedAt: new Date().toISOString(),
		};
		await writeTextFile(
			join(tmp, "prsm.lock"),
			"# Auto-generated\n" + dumpYaml(lock),
		);

		await expect(compile(tmp)).rejects.toThrow("checksum mismatch");
	});

	it("preserves existing non-prsm settings.json keys after rebuild", async () => {
		await writeTextFile(
			join(tmp, "prsm.yaml"),
			MANIFEST + `\nhooks:\n  stop: hooks/stop.sh\n`,
		);
		// Pre-existing user-authored settings
		await ensureDir(join(tmp, ".claude"));
		await writeTextFile(
			join(tmp, ".claude/settings.json"),
			JSON.stringify({ myCustomKey: "preserved" }, null, 2),
		);

		await compile(tmp);

		const settings = JSON.parse(
			await (await import("../../src/utils/fs")).readTextFile(
				join(tmp, ".claude/settings.json"),
			),
		);
		expect(settings.myCustomKey).toBe("preserved");
		expect(settings.hooks.Stop).toBeDefined();
	});

	it("settings.json survives a second build (not deleted by clean)", async () => {
		await writeTextFile(
			join(tmp, "prsm.yaml"),
			MANIFEST + `\nhooks:\n  stop: hooks/stop.sh\n`,
		);
		await ensureDir(join(tmp, ".claude"));
		await writeTextFile(
			join(tmp, ".claude/settings.json"),
			JSON.stringify({ userKey: "must-survive" }, null, 2),
		);

		await compile(tmp);
		await compile(tmp); // second build

		const { readTextFile: rt } = await import("../../src/utils/fs");
		const settings = JSON.parse(await rt(join(tmp, ".claude/settings.json")));
		expect(settings.userKey).toBe("must-survive");
		expect(settings.hooks.Stop).toBeDefined();
	});

	it("install then build succeeds when preset.yaml has a trailing newline", async () => {
		const presetDir = join(tmp, "presets/test-preset");
		await ensureDir(join(presetDir, "skills/security/preset-skill"));
		// Trailing newline — a common POSIX file convention
		const presetYamlWithNewline = PRESET_YAML + "\n";
		await writeTextFile(join(presetDir, "preset.yaml"), presetYamlWithNewline);
		await writeTextFile(
			join(presetDir, "skills/security/preset-skill/SKILL.md"),
			PRESET_SKILL_MD,
		);

		const manifestWithPreset = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPreset);

		// Simulate prsm install: hash raw content, same as the file on disk
		const { runInstall } = await import("../../src/commands/install");
		await runInstall(tmp);

		// prsm build must succeed — no checksum mismatch
		await expect(compile(tmp)).resolves.toBeUndefined();
		expect(
			await fileExists(
				join(tmp, ".claude/skills/hub-security-preset-skill/SKILL.md"),
			),
		).toBe(true);
	});

	it("emits manifest.permissions into .claude/settings.json (C2 regression)", async () => {
		// Regression for Codex adversarial review finding: loadWorkspace was
		// discarding manifest.permissions, so locally declared permissions never
		// reached the build output even after eject wrote them into prsm.yaml.
		const manifestWithPerms = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
permissions:
  - Bash(git:*)
  - Read(./docs/**)
output:
  claude-code:
    settings: .claude/settings.json
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestWithPerms);

		await compile(tmp);

		const { readTextFile } = await import("../../src/utils/fs");
		const settings = JSON.parse(
			await readTextFile(join(tmp, ".claude/settings.json")),
		);
		expect(settings.permissions.allow).toContain("Bash(git:*)");
		expect(settings.permissions.allow).toContain("Read(./docs/**)");
	});

	it("pre-existing Codex skills are not deleted on prsm build", async () => {
		const manifestCodexOnly = `
name: test-ws
version: 1.0.0
runtimes:
  - codex
`;
		await writeTextFile(join(tmp, "prsm.yaml"), manifestCodexOnly);
		await ensureDir(join(tmp, "skills/platform/my-skill"));
		await writeTextFile(
			join(tmp, "skills/platform/my-skill/SKILL.md"),
			SKILL_MD,
		);

		// Pre-existing user-authored Codex skill outside the hub- namespace
		await ensureDir(join(tmp, ".agents/skills/hand-authored-skill"));
		await writeTextFile(
			join(tmp, ".agents/skills/hand-authored-skill/SKILL.md"),
			"# Hand-authored",
		);

		await compile(tmp);

		// prsm-generated skill must exist
		expect(
			await fileExists(
				join(tmp, ".agents/skills/hub-platform-my-skill/SKILL.md"),
			),
		).toBe(true);
		// User-authored skill must NOT be deleted
		expect(
			await fileExists(
				join(tmp, ".agents/skills/hand-authored-skill/SKILL.md"),
			),
		).toBe(true);
	});
});
