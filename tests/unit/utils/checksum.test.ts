import { describe, it, expect } from "bun:test";
import { sha256Hex } from "../../../src/utils/checksum";

describe("checksum", () => {
  it("sha256Hex produces consistent 64-char hex", async () => {
    const hash = await sha256Hex("hello world");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(await sha256Hex("hello world"));
  });

  it("different inputs produce different hashes", async () => {
    const a = await sha256Hex("foo");
    const b = await sha256Hex("bar");
    expect(a).not.toBe(b);
  });
});
