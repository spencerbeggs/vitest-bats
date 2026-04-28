import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { parseExecutionResult } from "../src/bats-executor.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "vbats-test-"));
});

function writeResult(content: string): void {
	writeFileSync(join(dir, "result.txt"), content);
}

function writeCalls(lines: string[]): void {
	writeFileSync(join(dir, "calls.jsonl"), `${lines.join("\n")}\n`);
}

const b64 = (s: string): string => Buffer.from(s, "utf-8").toString("base64");

describe("parseExecutionResult", () => {
	test("parses status, output, stderr from result.txt", () => {
		writeResult(["status:0", `output_b64:${b64("hello world\n")}`, `stderr_b64:${b64("")}`].join("\n"));
		const r = parseExecutionResult(dir);
		expect(r.status).toBe(0);
		expect(r.output).toBe("hello world\n");
		expect(r.stderr).toBe("");
		expect(r.calls).toEqual({});
	});

	test("parses non-zero status", () => {
		writeResult(["status:2", `output_b64:${b64("")}`, `stderr_b64:${b64("error message")}`].join("\n"));
		const r = parseExecutionResult(dir);
		expect(r.status).toBe(2);
		expect(r.stderr).toBe("error message");
	});

	test("decodes multi-line output via base64", () => {
		const out = "line one\nline two\nline three\n";
		writeResult(["status:0", `output_b64:${b64(out)}`, `stderr_b64:${b64("")}`].join("\n"));
		const r = parseExecutionResult(dir);
		expect(r.output).toBe(out);
	});

	test("parses calls.jsonl when present", () => {
		writeResult(["status:0", `output_b64:${b64("")}`, `stderr_b64:${b64("")}`].join("\n"));
		writeCalls([
			JSON.stringify({ cmd: "git", args: ["remote", "get-url", "origin"] }),
			JSON.stringify({ cmd: "git", args: ["commit", "-m", "hello world"] }),
			JSON.stringify({ cmd: "curl", args: ["-X", "GET", "https://example.com"] }),
		]);
		const r = parseExecutionResult(dir);
		expect(r.calls.git).toEqual([{ args: ["remote", "get-url", "origin"] }, { args: ["commit", "-m", "hello world"] }]);
		expect(r.calls.curl).toEqual([{ args: ["-X", "GET", "https://example.com"] }]);
	});

	test("ignores blank lines in calls.jsonl", () => {
		writeResult(["status:0", `output_b64:${b64("")}`, `stderr_b64:${b64("")}`].join("\n"));
		writeCalls(["", JSON.stringify({ cmd: "git", args: ["x"] }), ""]);
		const r = parseExecutionResult(dir);
		expect(r.calls.git).toEqual([{ args: ["x"] }]);
	});

	test("throws when result.txt is missing", () => {
		expect(() => parseExecutionResult(dir)).toThrow(/result\.txt/);
	});

	test("throws when result.txt is malformed (missing status)", () => {
		writeResult(`output_b64:${b64("hi")}\nstderr_b64:${b64("")}`);
		expect(() => parseExecutionResult(dir)).toThrow(/status/);
	});

	test("throws on malformed calls.jsonl with helpful context", () => {
		writeResult(["status:0", `output_b64:${b64("")}`, `stderr_b64:${b64("")}`].join("\n"));
		writeCalls(["this is not json"]);
		expect(() => parseExecutionResult(dir)).toThrow(/calls\.jsonl/);
	});
});
