import { describe, expect, test } from "vitest";
import { ScriptBuilder, createBatsScript, findActive, resetAll } from "../src/runtime.js";

describe("ScriptBuilder", () => {
	test("createBatsScript returns a ScriptBuilder with path and name", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		expect(script.path).toBe("/path/to/hello.sh");
		expect(script.name).toBe("hello.sh");
	});

	test("fromTransform defaults to false", () => {
		const script = createBatsScript("/path/to/default.sh", "default.sh");
		expect(script.fromTransform).toBe(false);
	});

	test("fromTransform is true when passed as third arg", () => {
		const script = createBatsScript("/path/to/transform.sh", "transform.sh", true);
		expect(script.fromTransform).toBe(true);
	});

	test("ScriptBuilder constructor sets fromTransform", () => {
		const builder = new ScriptBuilder("/test.sh", "test.sh", true);
		expect(builder.fromTransform).toBe(true);

		const builderDefault = new ScriptBuilder("/test2.sh", "test2.sh");
		expect(builderDefault.fromTransform).toBe(false);
	});

	test("run() records a run command", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.run('"$SCRIPT"');
		expect(script.commands).toEqual([{ type: "run", args: ['"$SCRIPT"'] }]);
	});

	test("run() without args records a bare run", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.run();
		expect(script.commands).toEqual([{ type: "run", args: [] }]);
	});

	test("raw() records a raw bash command", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.raw('[ -f "$SCRIPT" ]');
		expect(script.commands).toEqual([{ type: "raw", cmd: '[ -f "$SCRIPT" ]' }]);
	});

	test("assert_success() records assertion", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.assert_success();
		expect(script.commands).toEqual([{ type: "assert_success" }]);
	});

	test("assert_failure() records assertion with optional code", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.assert_failure(1);
		expect(script.commands).toEqual([{ type: "assert_failure", code: 1 }]);
	});

	test("assert_output() records partial match", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.assert_output({ partial: "Hello" });
		expect(script.commands).toEqual([{ type: "assert_output", opts: { partial: "Hello" } }]);
	});

	test("assert_output() with string shorthand records line match", () => {
		const script = createBatsScript("/path/to/str-out.sh", "str-out.sh");
		script.assert_output("exact line");
		expect(script.commands).toEqual([{ type: "assert_output", opts: { line: "exact line" } }]);
	});

	test("assert_line() with string records line assertion", () => {
		const script = createBatsScript("/path/to/line.sh", "line.sh");
		script.assert_line("expected line");
		expect(script.commands).toEqual([{ type: "assert_line", opts: {}, expected: "expected line" }]);
	});

	test("assert_line() with object records indexed/partial assertion", () => {
		const script = createBatsScript("/path/to/line2.sh", "line2.sh");
		script.assert_line({ index: 0, partial: "first" });
		expect(script.commands).toEqual([
			{ type: "assert_line", opts: { index: 0, partial: "first" }, expected: undefined },
		]);
	});

	test("assert_line() with string and expected records both", () => {
		const script = createBatsScript("/path/to/line3.sh", "line3.sh");
		script.assert_line("label", "value");
		expect(script.commands).toEqual([{ type: "assert_line", opts: {}, expected: "value" }]);
	});

	test("assert_json_value() records JSON assertion", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.assert_json_value("greeting", "Hello World");
		expect(script.commands).toEqual([{ type: "assert_json_value", path: "greeting", expected: "Hello World" }]);
	});

	test("assert() records a raw assertion expression", () => {
		const script = createBatsScript("/path/to/assert.sh", "assert.sh");
		script.assert('[ "$status" -eq 0 ]');
		expect(script.commands).toEqual([{ type: "assert", expression: '[ "$status" -eq 0 ]' }]);
	});

	test("exit() records expected exit code", () => {
		const script = createBatsScript("/path/to/exit.sh", "exit.sh");
		script.exit(42);
		expect(script.commands).toEqual([{ type: "exit", code: 42 }]);
	});

	test("env() records environment variables", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.env({ PATH: "/usr/bin" });
		expect(script.commands).toEqual([{ type: "env", vars: { PATH: "/usr/bin" } }]);
	});

	test("mock() records mock setup", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.mock("node", { "--version": "v20.0.0" });
		expect(script.commands).toEqual([{ type: "mock", cmd: "node", responses: { "--version": "v20.0.0" } }]);
	});

	test("flags() records script flags", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.flags("-j");
		expect(script.commands).toEqual([{ type: "flags", value: "-j" }]);
	});

	test("commands chain in order", () => {
		const script = createBatsScript("/path/to/hello.sh", "hello.sh");
		script.run('"$SCRIPT" --name Alice');
		script.assert_success();
		script.assert_output({ partial: "Hello Alice" });
		expect(script.commands).toHaveLength(3);
		expect(script.commands[0].type).toBe("run");
		expect(script.commands[1].type).toBe("assert_success");
		expect(script.commands[2].type).toBe("assert_output");
	});
});

describe("Script Registry", () => {
	test("resetAll() clears all command buffers", () => {
		const a = createBatsScript("/a.sh", "a.sh");
		const b = createBatsScript("/b.sh", "b.sh");
		a.run('"$SCRIPT"');
		b.run('"$SCRIPT"');
		resetAll();
		expect(a.commands).toEqual([]);
		expect(b.commands).toEqual([]);
	});

	test("findActive() returns the builder with pending commands", () => {
		resetAll();
		const a = createBatsScript("/a.sh", "a.sh");
		createBatsScript("/b.sh", "b.sh");
		a.run('"$SCRIPT"');
		expect(findActive()).toBe(a);
	});

	test("findActive() returns null when no builders have commands", () => {
		resetAll();
		createBatsScript("/a.sh", "a.sh");
		expect(findActive()).toBeNull();
	});

	test("createBatsScript reuses existing builder and resets it", () => {
		const first = createBatsScript("/reuse.sh", "reuse.sh");
		first.run('"$SCRIPT"');
		expect(first.commands).toHaveLength(1);

		const second = createBatsScript("/reuse.sh", "reuse.sh");
		expect(second).toBe(first);
		expect(second.commands).toEqual([]);
	});
});
