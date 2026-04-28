import { describe, expect, test, vi } from "vitest";
import * as exec from "../src/bats-executor.js";
import { BatsResult, ScriptBuilder, resetAllBuilders } from "../src/runtime.js";

const stubResult = (
	overrides: Partial<{
		status: number;
		output: string;
		stderr: string;
		calls: Record<string, { args: string[] }[]>;
	}> = {},
) => ({
	status: 0,
	output: "",
	stderr: "",
	calls: {},
	...overrides,
});

describe("ScriptBuilder builder methods", () => {
	test("env() merges and overrides keys", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0 }));
		const b = new ScriptBuilder("/x.sh", "x.sh");
		b.env({ A: "1", B: "old" }).env({ B: "new" });
		b.run();
		const arg = spy.mock.calls[0][0];
		expect(arg.batsContent).toContain('A="1"');
		expect(arg.batsContent).toContain('B="new"');
		expect(arg.batsContent).not.toContain('B="old"');
		spy.mockRestore();
	});

	test("flags() last call wins", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0 }));
		const b = new ScriptBuilder("/x.sh", "x.sh");
		b.flags("-v").flags("-j");
		b.run();
		expect(spy.mock.calls[0][0].batsContent).toContain(" -j");
		expect(spy.mock.calls[0][0].batsContent).not.toContain(" -v");
		spy.mockRestore();
	});

	test("mock() registers a self-contained shim with [[ ]]-style pattern matching", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0 }));
		const b = new ScriptBuilder("/x.sh", "x.sh");
		b.mock("git", { "remote get-url *": "echo https://example.com" });
		b.run();
		const content = spy.mock.calls[0][0].batsContent;
		expect(content).toContain("$VBATS_RECORDER/bin/git");
		expect(content).toContain('"remote get-url "*');
		expect(content).toContain("eval 'echo https://example.com'");
		spy.mockRestore();
	});

	test("mock() with no responses creates a recorder-only shim", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0 }));
		const b = new ScriptBuilder("/x.sh", "x.sh");
		b.mock("curl");
		b.run();
		const content = spy.mock.calls[0][0].batsContent;
		expect(content).toContain("$VBATS_RECORDER/bin/curl");
		expect(content).toContain('jq -nc --arg cmd "curl"');
		spy.mockRestore();
	});
});

describe("ScriptBuilder.run / exec", () => {
	test("run() returns a BatsResult", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0, output: "Hello\n" }));
		const b = new ScriptBuilder("/x.sh", "x.sh");
		const r = b.run();
		expect(r).toBeInstanceOf(BatsResult);
		expect(r.output).toBe("Hello\n");
		spy.mockRestore();
	});

	test("run() resets accumulated state", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0 }));
		const b = new ScriptBuilder("/x.sh", "x.sh");
		b.env({ A: "1" }).run();
		b.run();
		const second = spy.mock.calls[1][0];
		expect(second.batsContent).not.toContain('A="1"');
		spy.mockRestore();
	});

	test("exec() generates a shell-mode bats file", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0 }));
		const b = new ScriptBuilder("/x.sh", "x.sh");
		b.exec('echo input | "$SCRIPT"');
		expect(spy.mock.calls[0][0].batsContent).toContain('echo input | "$SCRIPT"');
		expect(spy.mock.calls[0][0].batsContent).toContain("bash -c");
		spy.mockRestore();
	});
});

describe("resetAllBuilders", () => {
	test("clears accumulated state on each registered builder", () => {
		const spy = vi.spyOn(exec, "executeBats").mockReturnValue(stubResult({ status: 0 }));
		const a = new ScriptBuilder("/a.sh", "a.sh");
		const b = new ScriptBuilder("/b.sh", "b.sh");
		a.env({ A: "1" });
		b.flags("-j");
		resetAllBuilders();
		a.run();
		b.run();
		expect(spy.mock.calls[0][0].batsContent).not.toContain('A="1"');
		expect(spy.mock.calls[1][0].batsContent).not.toContain(" -j");
		spy.mockRestore();
	});
});
