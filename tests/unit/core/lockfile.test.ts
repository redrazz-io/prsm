import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLockFile, writeLockFile } from "../../../src/core/lockfile";
import type { LockFile } from "../../../src/types";

let tmp: string;
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-lock-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

describe("lockfile", () => {
	it("roundtrips write/read", async () => {
		const lock: LockFile = {
			version: 1,
			presets: {
				"prsm-preset-platform-engineering": {
					version: "2.0.0",
					url: "https://example.com/preset.tar.gz",
					checksum: "sha256:abc123",
				},
			},
			resolvedAt: "2026-05-19T00:00:00Z",
		};
		await writeLockFile(join(tmp, "prsm.lock"), lock);
		const read = await readLockFile(join(tmp, "prsm.lock"));
		expect(read).not.toBeNull();
		expect(read?.version).toBe(1);
		expect(read?.presets["prsm-preset-platform-engineering"].version).toBe(
			"2.0.0",
		);
	});

	it("returns null for missing lockfile", async () => {
		const result = await readLockFile(join(tmp, "prsm.lock"));
		expect(result).toBeNull();
	});
});
