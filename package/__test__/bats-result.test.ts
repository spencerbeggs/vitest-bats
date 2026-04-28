import { describe, expect, test } from "vitest";
import { BatsResult } from "../src/runtime.js";

function make(overrides: Partial<ConstructorParameters<typeof BatsResult>[0]> = {}): BatsResult {
	return new BatsResult({
		status: 0,
		output: "",
		stderr: "",
		calls: {},
		...overrides,
	});
}

describe("BatsResult", () => {
	test("status, output, stderr passthrough", () => {
		const r = make({ status: 2, output: "hi", stderr: "err" });
		expect(r.status).toBe(2);
		expect(r.output).toBe("hi");
		expect(r.stderr).toBe("err");
	});

	test("lines splits output", () => {
		const r = make({ output: "a\nb\nc" });
		expect(r.lines).toEqual(["a", "b", "c"]);
	});

	test("stderr_lines splits stderr", () => {
		const r = make({ stderr: "x\ny" });
		expect(r.stderr_lines).toEqual(["x", "y"]);
	});

	test("empty output yields empty lines array", () => {
		const r = make({ output: "" });
		expect(r.lines).toEqual([]);
		expect(r.stderr_lines).toEqual([]);
	});

	test("json() parses output", () => {
		const r = make({ output: '{"greeting":"Hello"}' });
		expect(r.json<{ greeting: string }>()).toEqual({ greeting: "Hello" });
	});

	test("json() caches parsed value", () => {
		const r = make({ output: '{"a":1}' });
		const first = r.json<{ a: number }>();
		const second = r.json<{ a: number }>();
		expect(first).toBe(second);
	});

	test("json() throws on invalid JSON", () => {
		const r = make({ output: "not json" });
		expect(() => r.json()).toThrow(/result\.output is not valid JSON/);
	});

	test("calls passthrough", () => {
		const r = make({ calls: { git: [{ args: ["status"] }] } });
		expect(r.calls.git).toEqual([{ args: ["status"] }]);
	});

	test("await of a non-thenable BatsResult returns the same instance", async () => {
		const r = make({ status: 0, output: "x" });
		const awaited = await r;
		expect(awaited).toBe(r);
		expect(awaited.status).toBe(0);
	});
});
