import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "prsm-init-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true });
});

const CLI = join(import.meta.dir, "../../src/cli.ts");

function runCli(
	cwd: string,
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn("bun", ["run", CLI, ...args], { cwd });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d.toString()));
		child.stderr.on("data", (d) => (stderr += d.toString()));
		child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
	});
}

describe("prsm init", () => {
	it("scaffolded workspace passes prsm validate (no skills:/agents: in template)", async () => {
		const init = await runCli(tmp, ["init", "my-hub"]);
		expect(init.code).toBe(0);

		const validate = await runCli(join(tmp, "my-hub"), ["validate"]);
		if (validate.code !== 0) {
			console.error("validate stdout:", validate.stdout);
			console.error("validate stderr:", validate.stderr);
		}
		expect(validate.code).toBe(0);
	});
});
