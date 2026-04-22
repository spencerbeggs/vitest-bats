import { describe, expect, test } from "vitest";
import { generateBatsFile } from "../src/bats-generator.js";
import type { CommandRecord } from "../src/runtime.js";

describe("generateBatsFile", () => {
	const scriptPath = "/path/to/hello.sh";
	const testName = "outputs greeting";
	const deps = {
		batsPath: "/opt/homebrew/bin/bats",
		batsSupportPath: "/opt/homebrew/lib/bats-support",
		batsAssertPath: "/opt/homebrew/lib/bats-assert",
		batsMockPath: "/opt/homebrew/lib/bats-mock",
	};

	test("generates valid bats file with run and assert_success", () => {
		const commands: CommandRecord[] = [{ type: "run", args: ['"$SCRIPT"'] }, { type: "assert_success" }];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("#!/opt/homebrew/bin/bats");
		expect(result).toContain("load '/opt/homebrew/lib/bats-support/load.bash'");
		expect(result).toContain("load '/opt/homebrew/lib/bats-assert/load.bash'");
		expect(result).toContain('SCRIPT="/path/to/hello.sh"');
		expect(result).toContain('@test "outputs greeting"');
		expect(result).toContain('run "$SCRIPT"');
		expect(result).toContain("assert_success");
	});

	test("generates raw commands", () => {
		const commands: CommandRecord[] = [{ type: "raw", cmd: '[ -f "$SCRIPT" ]' }];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain('[ -f "$SCRIPT" ]');
		expect(result).not.toContain("run ");
	});

	test("generates assert_failure with exit code", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT" --invalid'] },
			{ type: "assert_failure", code: 1 },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_failure 1");
	});

	test("generates assert_failure without exit code", () => {
		const commands: CommandRecord[] = [{ type: "run", args: ['"$SCRIPT" --invalid'] }, { type: "assert_failure" }];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_failure");
		expect(result).not.toContain("assert_failure 1");
	});

	test("generates assert_output with partial match", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "assert_output", opts: { partial: "Hello" } },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_output --partial 'Hello'");
	});

	test("generates assert_output with exact match", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "assert_output", opts: { line: "Hello World" } },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_output 'Hello World'");
	});

	test("generates assert_output with regexp match", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "assert_output", opts: { regexp: "^Hello.*$" } },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_output --regexp '^Hello.*$'");
	});

	test("generates assert_json_value using jq", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT" --json'] },
			{ type: "assert_success" },
			{ type: "assert_json_value", path: "greeting", expected: "Hello World" },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("jq");
		expect(result).toContain(".greeting");
		expect(result).toContain("Hello World");
	});

	test("generates env setup before run", () => {
		const commands: CommandRecord[] = [
			{ type: "env", vars: { FOO: "bar" } },
			{ type: "run", args: ['"$SCRIPT"'] },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain('FOO="bar"');
	});

	test("generates mock setup", () => {
		const commands: CommandRecord[] = [
			{ type: "mock", cmd: "node", responses: { "--version": "v20.0.0" } },
			{ type: "run", args: ['"$SCRIPT"'] },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("stub");
		expect(result).toContain("node");
	});

	test("generates run with flags", () => {
		const commands: CommandRecord[] = [
			{ type: "flags", value: "-j" },
			{ type: "run", args: ['"$SCRIPT"'] },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("-j");
	});

	test("run without args uses $SCRIPT", () => {
		const commands: CommandRecord[] = [{ type: "run", args: [] }, { type: "assert_success" }];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain('run "$SCRIPT"');
	});

	test("generates assert expression", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "assert", expression: '[ "$status" -eq 0 ]' },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain('[ "$status" -eq 0 ]');
	});

	test("generates exit code check", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "exit", code: 42 },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain('[ "$status" -eq 42 ]');
	});

	test("generates assert_line with index and partial", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "assert_line", opts: { index: 0, partial: "Hello" } },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_line --index 0 --partial 'Hello'");
	});

	test("generates assert_line with regexp", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "assert_line", opts: { regexp: "^Hello" } },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_line --regexp '^Hello'");
	});

	test("generates assert_line with expected value", () => {
		const commands: CommandRecord[] = [
			{ type: "run", args: ['"$SCRIPT"'] },
			{ type: "assert_line", opts: {}, expected: "Hello World" },
		];
		const result = generateBatsFile(scriptPath, testName, commands, deps);
		expect(result).toContain("assert_line 'Hello World'");
	});
});

describe("generateBatsFile with kcov", () => {
	const scriptPath = "/path/to/hello.sh";
	const deps = {
		batsPath: "/usr/local/bin/bats",
		batsSupportPath: "/usr/local/lib/bats-support",
		batsAssertPath: "/usr/local/lib/bats-assert",
		batsMockPath: "/usr/local/lib/bats-mock",
	};
	const kcov = { kcovPath: "/usr/local/bin/kcov", outputDir: "/tmp/kcov-out" };

	test("wraps $SCRIPT run commands with kcov", () => {
		const commands: CommandRecord[] = [{ type: "run", args: ['"$SCRIPT"'] }, { type: "assert_success" }];
		const result = generateBatsFile(scriptPath, "kcov test", commands, deps, kcov);
		expect(result).toContain('KCOV_OUT="/tmp/kcov-out"');
		expect(result).toContain('mkdir -p "$KCOV_OUT"');
		expect(result).toContain('"/usr/local/bin/kcov"');
		expect(result).toContain("--skip-solibs");
		expect(result).toContain('--include-pattern="/path/to"');
		expect(result).toContain('"$KCOV_OUT"');
	});

	test("does not wrap non-$SCRIPT run commands with kcov", () => {
		const commands: CommandRecord[] = [{ type: "run", args: ["echo hello"] }, { type: "assert_success" }];
		const result = generateBatsFile(scriptPath, "no kcov", commands, deps, kcov);
		// The run line itself should not contain kcov wrapping
		const runLine = result.split("\n").find((l) => l.trim().startsWith("run "));
		expect(runLine).toBeDefined();
		expect(runLine).not.toContain("kcov");
		expect(runLine).toContain("run echo hello");
	});

	test("wraps kcov with env prefix when env is set", () => {
		const commands: CommandRecord[] = [
			{ type: "env", vars: { FOO: "bar" } },
			{ type: "run", args: ['"$SCRIPT"'] },
		];
		const result = generateBatsFile(scriptPath, "env kcov", commands, deps, kcov);
		expect(result).toContain('FOO="bar" run "/usr/local/bin/kcov"');
	});
});
