import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensureDir,
	fileExists,
	readTextFile,
	writeTextFile,
} from "../../../src/utils/fs";

let tmp: string;
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

describe("fs utils", () => {
	it("fileExists returns false for missing file", async () => {
		expect(await fileExists(join(tmp, "nope.txt"))).toBe(false);
	});

	it("writeTextFile + readTextFile roundtrip", async () => {
		await writeTextFile(join(tmp, "hello.txt"), "world");
		expect(await readTextFile(join(tmp, "hello.txt"))).toBe("world");
	});

	it("ensureDir creates nested dirs", async () => {
		await ensureDir(join(tmp, "a/b/c"));
		expect(await fileExists(join(tmp, "a/b/c"))).toBe(true);
	});
});
