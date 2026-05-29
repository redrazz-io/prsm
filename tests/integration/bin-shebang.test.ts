import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { spawn } from "child_process";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-shebang-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const REPO_ROOT = join(import.meta.dir, "../..");

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

describe("published bin", () => {
  it("bundle preserves a Bun shebang so prsm is directly executable (#8)", async () => {
    // Mirror the `build:bundle` script that prepack runs, to a temp outfile.
    const outFile = join(tmp, "cli.js");
    const code = await run(
      "bun",
      ["build", join(REPO_ROOT, "src/cli.ts"), "--outfile", outFile, "--target", "bun"],
      REPO_ROOT,
    );
    expect(code).toBe(0);

    const bundle = await readFile(outFile, "utf-8");
    expect(bundle.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  });
});
