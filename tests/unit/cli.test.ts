import { describe, expect, it } from "bun:test";

describe("cli entry", () => {
	it("exports a main function", async () => {
		const mod = await import("../../src/cli");
		expect(typeof mod.main).toBe("function");
	});
});
