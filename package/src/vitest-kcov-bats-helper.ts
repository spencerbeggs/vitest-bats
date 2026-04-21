/**
 * Shared utilities for running BATS tests with Vitest
 */
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test as vitestTest } from "vitest";
import { HTELink } from "./hte-link.js";
import type { LinkFormat } from "./vitest-kcov-types.js";

const execAsync: (
	command: string,
	options?: { encoding: BufferEncoding; cwd?: string; env?: NodeJS.ProcessEnv; shell?: string },
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

/**
 * Represents a single BATS test case extracted from a .bats file.
 *
 * @remarks
 * Used to track test metadata when parsing BATS files and mapping TAP output to individual tests.
 */
export interface BatsTest {
	/** The test name as it appears in the @test directive */
	name: string;
	/** The absolute path to the .bats file containing this test */
	file: string;
	/** The line number where the test starts (1-indexed) */
	line: number;
}

/**
 * Represents the result of a single test execution.
 *
 * @remarks
 * Contains the test outcome and associated output from BATS TAP format parsing.
 */
export interface TestResult {
	/** The test name from the TAP output */
	name: string;
	/** Whether the test passed (true) or failed (false) */
	passed: boolean;
	/** Whether the test was skipped (marked with # skip in TAP) */
	skipped: boolean;
	/** The output or status message from the test execution */
	output: string;
}

/**
 * Aggregated results for all tests in a single BATS file.
 *
 * @remarks
 * Provides a complete view of test execution including individual test results
 * and summary statistics.
 */
export interface FileResults {
	/** The absolute path to the .bats file */
	filePath: string;
	/** The filename without extension (e.g., "info-system") */
	fileName: string;
	/** Array of all tests found in the file */
	tests: BatsTest[];
	/** Map of test name to execution result */
	results: Map<string, TestResult>;
	/** Total number of tests found in the file */
	totalTests: number;
	/** Number of tests that passed */
	passedTests: number;
	/** Number of tests that were skipped */
	skippedTests: number;
}

/**
 * Parses a BATS file to extract all test cases.
 *
 * @remarks
 * Searches for `@test "test name" {` patterns in the file and extracts test metadata.
 * The parser handles standard BATS syntax and ignores comments and other directives.
 *
 * @param filePath - The absolute path to the .bats file to parse
 * @returns A promise that resolves to an array of test cases found in the file
 *
 * @throws {Error} If the file cannot be read or does not exist
 *
 * @example
 * ```typescript
 * const tests = await parseBatsFile("/path/to/test.bats");
 * console.log(tests);
 * // [
 * //   { name: "test 1", file: "/path/to/test.bats", line: 5 },
 * //   { name: "test 2", file: "/path/to/test.bats", line: 12 }
 * // ]
 * ```
 */
export async function parseBatsFile(filePath: string): Promise<BatsTest[]> {
	const content = await readFile(filePath, "utf-8");
	const lines = content.split("\n");
	const tests: BatsTest[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Match @test "test name" {
		const match = line.match(/^@test\s+"([^"]+)"\s*\{/);
		if (match) {
			tests.push({
				name: match[1],
				file: filePath,
				line: i + 1, // 1-indexed
			});
		}
	}

	return tests;
}

/**
 * Parses TAP (Test Anything Protocol) output from BATS to extract individual test results.
 *
 * @remarks
 * BATS outputs test results in TAP format, which follows the pattern:
 * - `ok N test name` for passing tests
 * - `not ok N test name` for failing tests
 * - `ok N test name # skip reason` for skipped tests
 *
 * This function maps the TAP output lines to the corresponding test cases.
 *
 * @param output - The TAP-formatted output string from BATS execution
 * @param tests - Array of tests extracted from the BATS file (for mapping test numbers to names)
 * @returns A map of test names to their execution results
 *
 * @example
 * ```typescript
 * const tapOutput = `
 * 1..2
 * ok 1 first test
 * not ok 2 second test
 * `;
 * const tests = [
 *   { name: "first test", file: "test.bats", line: 1 },
 *   { name: "second test", file: "test.bats", line: 5 }
 * ];
 * const results = parseTapOutput(tapOutput, tests);
 * console.log(results.get("first test")); // { name: "first test", passed: true, skipped: false, output: "Passed" }
 * ```
 *
 * @see {@link parseBatsFile} for extracting test metadata from BATS files
 */
export function parseTapOutput(output: string, tests: BatsTest[]): Map<string, TestResult> {
	const results = new Map<string, TestResult>();
	const lines = output.split("\n");

	for (const line of lines) {
		// Match TAP output lines like:
		// ok 1 test name
		// ok 2 test name # skip reason
		// not ok 3 test name
		const okMatch = line.match(/^ok\s+(\d+)\s+(.+?)(?:\s+#\s*skip\s*(.*))?$/);
		const notOkMatch = line.match(/^not ok\s+(\d+)\s+(.+?)(?:\s+#\s*skip\s*(.*))?$/);

		if (okMatch) {
			const testNum = Number.parseInt(okMatch[1], 10) - 1;
			const testName = okMatch[2].trim();
			const skipReason = okMatch[3];

			if (testNum < tests.length) {
				results.set(tests[testNum].name, {
					name: testName,
					passed: true,
					skipped: !!skipReason,
					output: skipReason ? `Skipped: ${skipReason}` : "Passed",
				});
			}
		} else if (notOkMatch) {
			const testNum = Number.parseInt(notOkMatch[1], 10) - 1;
			const testName = notOkMatch[2].trim();

			if (testNum < tests.length) {
				results.set(tests[testNum].name, {
					name: testName,
					passed: false,
					skipped: false,
					output: "Failed",
				});
			}
		}
	}

	return results;
}

/**
 * Executes all BATS tests in a file and returns aggregated results.
 *
 * @remarks
 * This function runs the BATS test file, parses the TAP output, and aggregates
 * test results including pass/fail status and skip counts. If BATS execution fails,
 * partial results are still parsed and returned.
 *
 * @param filePath - The absolute path to the .bats file to execute
 * @param cwd - Optional working directory for test execution (defaults to current directory)
 * @returns A promise that resolves to file results with test outcomes and statistics
 *
 * @example
 * ```typescript
 * const results = await runBatsFile("/path/to/test.bats");
 * console.log(`Passed: ${results.passedTests}/${results.totalTests}`);
 * for (const [testName, result] of results.results) {
 *   console.log(`${result.passed ? "✓" : "✗"} ${testName}`);
 * }
 * ```
 *
 * @see {@link parseBatsFile} for parsing test metadata
 * @see {@link parseTapOutput} for parsing TAP output
 */
export async function runBatsFile(filePath: string, cwd?: string): Promise<FileResults> {
	const fileName = filePath.split("/").pop()?.replace(".bats", "") || "";
	const tests = await parseBatsFile(filePath);

	try {
		const { stdout } = await execAsync(`bats "${filePath}"`, {
			encoding: "utf-8",
			...(cwd ? { cwd } : {}),
		});

		// Parse TAP output
		const results = parseTapOutput(stdout, tests);
		const testCountMatch = stdout.match(/^1\.\.(\d+)$/m);
		const totalTests = Number.parseInt(testCountMatch?.[1] || "0", 10);
		const passedTests = (stdout.match(/^ok /gm) || []).length;
		const skippedTests = (stdout.match(/# skip/g) || []).length;

		return {
			filePath,
			fileName,
			tests,
			results,
			totalTests,
			passedTests,
			skippedTests,
		};
	} catch (error) {
		const err = error as { stdout?: string; stderr?: string };
		const stdout = err.stdout || "";

		// Parse partial results even on failure
		const results = parseTapOutput(stdout, tests);
		const testCountMatch = stdout.match(/^1\.\.(\d+)$/m);
		const totalTests = Number.parseInt(testCountMatch?.[1] || "0", 10);
		const passedTests = (stdout.match(/^ok /gm) || []).length;
		const skippedTests = (stdout.match(/# skip/g) || []).length;

		return {
			filePath,
			fileName,
			tests,
			results,
			totalTests,
			passedTests,
			skippedTests,
		};
	}
}

/**
 * Verifies that BATS (Bash Automated Testing System) is installed on the system.
 *
 * @remarks
 * This function checks if the `bats` command is available in the system PATH.
 * It's recommended to call this during test setup to provide clear error messages
 * if BATS is missing.
 *
 * @returns A promise that resolves if BATS is installed
 * @throws {Error} If BATS is not found, with installation instructions
 *
 * @example
 * ```typescript
 * beforeAll(async () => {
 *   await verifyBatsInstalled();
 *   // Continue with test setup...
 * });
 * ```
 */
export async function verifyBatsInstalled(): Promise<void> {
	try {
		await execAsync("command -v bats");
	} catch {
		throw new Error("bats is not installed. Install it with: brew install bats-core");
	}
}

/**
 * Test context for fluent API-based shell script testing.
 *
 * @remarks
 * BatsTestContext provides a TypeScript-friendly way to write shell script tests
 * without generating BATS files. It executes commands directly and provides
 * assertion methods for validating results.
 *
 * Note: This class is experimental. The recommended approach is to use the
 * builder API with {@link BatsHelper.test} which generates BATS files for
 * coverage collection.
 *
 * @example
 * ```typescript
 * const context = new BatsTestContext("/path/to/script.sh");
 * await context.run('"$SCRIPT" --version');
 * context.expectSuccess();
 * expect(context.output).toContain("1.0.0");
 * ```
 */
export class BatsTestContext {
	private scriptPath: string;
	private lastOutput = "";
	private lastStatus = 0;
	private lastJson: unknown = null;

	/**
	 * Creates a new test context for a shell script.
	 *
	 * @param scriptPath - The absolute path to the shell script being tested
	 */
	constructor(scriptPath: string) {
		this.scriptPath = scriptPath;
	}

	/**
	 * Executes a command and captures its output and exit status.
	 *
	 * @remarks
	 * The command is executed with the script path available as the `$SCRIPT`
	 * environment variable. Both stdout and stderr are captured. If the output
	 * is valid JSON, it's automatically parsed and available via {@link json}.
	 *
	 * @param command - The command to execute (can reference `$SCRIPT`)
	 * @returns This context instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * await context.run('"$SCRIPT" --json');
	 * ```
	 */
	async run(command: string): Promise<BatsTestContext> {
		try {
			const { stdout } = await execAsync(command, {
				encoding: "utf-8",
				env: {
					...process.env,
					SCRIPT: this.scriptPath,
				},
			});
			this.lastOutput = stdout;
			this.lastStatus = 0;

			// Try to parse as JSON
			try {
				this.lastJson = JSON.parse(stdout);
			} catch {
				this.lastJson = null;
			}
		} catch (error) {
			const err = error as { code?: number; stdout?: string; stderr?: string };
			this.lastOutput = err.stdout || err.stderr || "";
			this.lastStatus = err.code || 1;
			this.lastJson = null;

			// Try to parse as JSON even on error
			try {
				this.lastJson = JSON.parse(this.lastOutput);
			} catch {
				// Not JSON
			}
		}

		return this;
	}

	/**
	 * Gets the captured output (stdout and stderr) from the last command execution.
	 *
	 * @returns The combined stdout and stderr output as a string
	 */
	get output(): string {
		return this.lastOutput;
	}

	/**
	 * Gets the exit status code from the last command execution.
	 *
	 * @returns The exit status code (0 for success, non-zero for failure)
	 */
	get status(): number {
		return this.lastStatus;
	}

	/**
	 * Gets the parsed JSON output from the last command execution.
	 *
	 * @remarks
	 * Returns null if the output was not valid JSON or if JSON parsing failed.
	 *
	 * @returns The parsed JSON object, or null if output is not valid JSON
	 */
	get json(): unknown {
		return this.lastJson;
	}

	/**
	 * Asserts that the last command exited successfully (status code 0).
	 *
	 * @returns This context instance for method chaining
	 * @throws {Error} If the exit status is not 0
	 *
	 * @example
	 * ```typescript
	 * await context.run('"$SCRIPT"');
	 * context.expectSuccess(); // Throws if status !== 0
	 * ```
	 */
	expectSuccess(): BatsTestContext {
		if (this.lastStatus !== 0) {
			throw new Error(`Expected success but got exit code ${this.lastStatus}\nOutput: ${this.lastOutput}`);
		}
		return this;
	}

	/**
	 * Asserts that the last command exited with a failure (non-zero status code).
	 *
	 * @param expectedCode - Optional specific exit code to expect
	 * @returns This context instance for method chaining
	 * @throws {Error} If the exit status is 0, or doesn't match expectedCode
	 *
	 * @example
	 * ```typescript
	 * await context.run('"$SCRIPT" --invalid');
	 * context.expectFailure(); // Throws if status === 0
	 * context.expectFailure(1); // Throws if status !== 1
	 * ```
	 */
	expectFailure(expectedCode?: number): BatsTestContext {
		if (this.lastStatus === 0) {
			throw new Error(`Expected failure but got exit code ${this.lastStatus}\nOutput: ${this.lastOutput}`);
		}
		if (expectedCode !== undefined && this.lastStatus !== expectedCode) {
			throw new Error(`Expected exit code ${expectedCode} but got ${this.lastStatus}\nOutput: ${this.lastOutput}`);
		}
		return this;
	}

	/**
	 * Checks if the command output contains a specific substring.
	 *
	 * @param substring - The substring to search for
	 * @returns True if the substring is found, false otherwise
	 *
	 * @example
	 * ```typescript
	 * if (context.outputContains("version")) {
	 *   // Output contains "version"
	 * }
	 * ```
	 */
	outputContains(substring: string): boolean {
		return this.lastOutput.includes(substring);
	}

	/**
	 * Checks if the command output matches a regular expression.
	 *
	 * @param pattern - The regular expression pattern to test
	 * @returns True if the pattern matches, false otherwise
	 *
	 * @example
	 * ```typescript
	 * if (context.outputMatches(/^version: \d+\.\d+\.\d+$/m)) {
	 *   // Output contains a semantic version line
	 * }
	 * ```
	 */
	outputMatches(pattern: RegExp): boolean {
		return pattern.test(this.lastOutput);
	}
}

/**
 * Fluent API builder for creating BATS-style test assertions.
 *
 * @remarks
 * BatsAssertionBuilder provides a TypeScript-friendly API for writing shell script
 * tests that generate BATS test files. The builder pattern allows for method chaining
 * and provides type-safe access to BATS assertion functions.
 *
 * All methods return `this` for chaining. The generated commands are converted to
 * BATS test syntax when {@link BatsHelper.test} is called.
 *
 * @example
 * ```typescript
 * helper.test("detects node when installed", (t) => {
 *   t.mock("node", { "--version": "v20.10.0" });
 *   t.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
 *   t.flags("-j");
 *   t.assert_success();
 *   t.assert_json_value("node.version", "20.10.0");
 * });
 * ```
 *
 * @see {@link BatsHelper.test} for creating tests with the builder API
 */
/**
 * Helper class for piping data to scripts via stdin.
 * Accessed via {@link BatsAssertionBuilder.pipe}.
 */
class PipeBuilder {
	constructor(private parent: BatsAssertionBuilder) {}

	/**
	 * Pipes JSON data to the script via stdin.
	 *
	 * @remarks
	 * This method is useful for testing hooks and other scripts that read JSON from stdin.
	 * The JSON object is serialized with proper shell escaping and piped to the script.
	 * Shell variables (starting with $) in string values are preserved for runtime expansion.
	 *
	 * @param jsonObj - The JSON object to pipe to the script
	 * @returns The parent builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Pipe JSON with variable substitution
	 * script.pipe.json({ tool_input: { file_path: "$test_file" } });
	 * script.exit(0);
	 *
	 * // Pipe JSON with literal values
	 * script.pipe.json({ tool_input: { file_path: "/tmp/test.ts" } });
	 * script.assert_success();
	 * ```
	 */
	json(jsonObj: Record<string, unknown>): BatsAssertionBuilder {
		// Use jq to build JSON with proper variable substitution
		// This avoids complex shell escaping issues
		const _jqArgs: string[] = [];
		const jqVars = new Map<string, string>();
		let varCounter = 0;

		// Find all shell variables ($varname) in the JSON and extract them
		const jsonStr = JSON.stringify(jsonObj, (_key, value) => {
			if (typeof value === "string" && value.startsWith("$")) {
				// This is a shell variable reference
				const varName = `var${varCounter++}`;
				jqVars.set(varName, value);
				return `__JQ_VAR_${varName}__`;
			}
			return value;
		});

		// Build jq command with --arg for each variable
		// These will be passed as arguments so variables expand in the subshell
		const jqArgsStr = Array.from(jqVars.entries())
			.map(([name, shellVar]) => `--arg ${name} "${shellVar}"`)
			.join(" ");

		// Replace placeholders with jq variable references
		let jqExpr = jsonStr;
		for (const [name, _] of jqVars.entries()) {
			jqExpr = jqExpr.replace(`"__JQ_VAR_${name}__"`, `$${name}`);
		}

		// Build env var prefix if any
		const _envPrefix = Object.entries(this.parent.envVars)
			.map(([key, value]) => `${key}="${value}"`)
			.join(" ");

		// Generate: run bash -c 'jq -n --arg var0 "'"$test_file"'" '\''{...}'\'' | bash "$SCRIPT"'
		// Note: We inject variables using the pattern '...' "$var" '...' to allow expansion
		// while keeping the rest of the command protected in single quotes
		const escapedJqExpr = jqExpr.replace(/'/g, "'\\''");

		if (jqArgsStr) {
			// With variables: bash -c 'jq -n --arg var0 "'"$test_file"'" '\''{...}'\'' | bash "$SCRIPT"'
			// Use the pattern: '...' "'"'" ... "'"'" '...' to inject quoted variables
			const jqArgsWithVars = Array.from(jqVars.entries())
				.map(([name, shellVar]) => `--arg ${name} "'"'"${shellVar}"'"'"`)
				.join(" ");

			// Build the bash command - env vars need to be exported for inner bash to see them
			// Generate: bash -c 'export PATH='"$PWD"'/fake-bin:/usr/bin:/bin; jq -n ... | bash "$SCRIPT"'
			// Use the pattern '...' "$var" '...' to allow variable expansion
			const envExports = Object.entries(this.parent.envVars)
				.map(([key, value]) => `export ${key}="'"${value}"'"`)
				.join("; ");
			const bashCmd = envExports
				? `bash -c '${envExports}; jq -n ${jqArgsWithVars} '"'"'${escapedJqExpr}'"'"' | bash "$SCRIPT"'`
				: `bash -c 'jq -n ${jqArgsWithVars} '"'"'${escapedJqExpr}'"'"' | bash "$SCRIPT"'`;

			this.parent.commands.push(`run ${bashCmd}`);
			this.parent.envVars = {}; // Clear after use
		} else {
			// No variables: bash -c 'jq -n '\''{...}'\'' | bash "$SCRIPT"'
			const envExports = Object.entries(this.parent.envVars)
				.map(([key, value]) => `export ${key}="'"${value}"'"`)
				.join("; ");
			const bashCmd = envExports
				? `bash -c '${envExports}; jq -n '"'"'${escapedJqExpr}'"'"' | bash "$SCRIPT"'`
				: `bash -c 'jq -n '"'"'${escapedJqExpr}'"'"' | bash "$SCRIPT"'`;

			this.parent.commands.push(`run ${bashCmd}`);
			this.parent.envVars = {}; // Clear after use
		}

		// Clear flags/args as they don't apply when piping
		this.parent.scriptFlags = "";
		this.parent.scriptArgs = "";

		this.parent.hasRun = true;
		return this.parent;
	}
}

export class BatsAssertionBuilder {
	public commands: string[] = [];
	public envVars: Record<string, string> = {};
	public scriptFlags: string = "";
	public scriptArgs: string = "";
	public hasRun: boolean = false;

	/**
	 * Provides methods for piping data to the script via stdin.
	 */
	readonly pipe = new PipeBuilder(this);

	/**
	 * Sets environment variables for the next {@link run} command.
	 *
	 * @remarks
	 * Environment variables are prefixed to the run command, allowing kcov
	 * to properly instrument the script while modifying the environment.
	 * Variables are cleared after being used in the next run() call.
	 *
	 * @param vars - Record of environment variable names to values
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" }).run('"$SCRIPT"');
	 * // Generates: PATH="$PWD/fake-bin:/usr/bin:/bin" run "$SCRIPT"
	 * ```
	 */
	env(vars: Record<string, string>): this {
		this.envVars = { ...this.envVars, ...vars };
		return this;
	}

	/**
	 * Sets command-line flags for the script.
	 *
	 * @remarks
	 * Flags are cleared after being used in the next {@link run} call.
	 *
	 * @param flags - The flags to pass to the script (e.g., "-h", "-j", "--verbose")
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.flags("-h");
	 * t.run(); // Executes: run_script -h
	 *
	 * t.flags("-j");
	 * t.exit(0);
	 * ```
	 */
	flags(flags: string): this {
		this.scriptFlags = flags;
		return this;
	}

	/**
	 * Sets positional arguments for the script.
	 *
	 * @remarks
	 * Arguments are cleared after being used in the next {@link run} call.
	 *
	 * @param args - The positional arguments to pass to the script
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.args("file.txt");
	 * t.run(); // Executes: run_script file.txt
	 *
	 * t.flags("-v");
	 * t.args("input.txt output.txt");
	 * t.run(); // Executes: run_script -v input.txt output.txt
	 * ```
	 */
	args(args: string): this {
		this.scriptArgs = args;
		return this;
	}

	/**
	 * Creates a temporary file with the given content and stores its path in a variable.
	 *
	 * @remarks
	 * Files are created in `$BATS_TEST_TMPDIR` and automatically cleaned up after the test.
	 * The file path is stored in a variable that can be referenced in subsequent commands.
	 *
	 * @param varName - The variable name to store the file path (without $)
	 * @param filename - The filename (e.g., "test.ts", "readme.txt")
	 * @param content - The file content
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Create a TypeScript file
	 * script.file("test_file", "test.ts", "const x = 1;");
	 * script.pipe.json({ tool_input: { file_path: "$test_file" } });
	 * script.exit(0);
	 * ```
	 */
	file(varName: string, filename: string, content: string): this {
		// Escape content for bash (handle quotes and special chars)
		const escapedContent = content.replace(/'/g, "'\\''");

		// Generate BATS code to create file
		this.commands.push(`${varName}="$BATS_TEST_TMPDIR/${filename}"`);
		this.commands.push(`echo '${escapedContent}' > "$${varName}"`);

		return this;
	}

	/**
	 * Executes the script with an optional direct command or using flags/args set via
	 * {@link flags} and {@link args}.
	 *
	 * @remarks
	 * The command is wrapped in BATS's `run` function, which captures stdout,
	 * stderr, and the exit status. The output is available as `$output` and
	 * the status as `$status` in subsequent assertions.
	 *
	 * If a `command` string is provided, it is used directly (e.g., `'"$SCRIPT" --name Alice'`).
	 * Otherwise the command is built from `run_script` plus any flags and args set via
	 * {@link flags} and {@link args}.
	 *
	 * If environment variables were set with {@link env}, they are prefixed
	 * to this command.
	 *
	 * This method is typically called implicitly before assertions, so you
	 * rarely need to call it explicitly.
	 *
	 * @param command - Optional direct bash command to run (e.g., `'"$SCRIPT" --name Alice'`)
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Direct command string (recommended for scripts with arguments)
	 * t.run('"$SCRIPT" --name Alice');
	 * t.assert_success();
	 *
	 * // Explicit run() call with flags
	 * t.flags('--json');
	 * t.run();
	 * t.assert_success();
	 *
	 * // Implicit run() call (preferred)
	 * t.flags('-h');
	 * t.exit(0);  // run() called automatically
	 * ```
	 */
	run(command?: string): this {
		let finalCommand: string;

		if (command) {
			// Direct command provided — use it as-is, ignore any pending flags/args
			finalCommand = command;
			this.scriptFlags = "";
			this.scriptArgs = "";
		} else {
			// Build command from run_script + flags + args
			const parts = ["run_script"];
			if (this.scriptFlags) {
				parts.push(this.scriptFlags);
			}
			if (this.scriptArgs) {
				parts.push(this.scriptArgs);
			}
			finalCommand = parts.join(" ");
			// Clear flags/args after use
			this.scriptFlags = "";
			this.scriptArgs = "";
		}

		// Build env var prefix if any
		const envPrefix = Object.entries(this.envVars)
			.map(([key, value]) => `${key}="${value}"`)
			.join(" ");

		// Pass command through as-is - user is responsible for proper quoting
		if (envPrefix) {
			this.commands.push(`${envPrefix} run ${finalCommand}`);
			this.envVars = {}; // Clear after use
		} else {
			this.commands.push(`run ${finalCommand}`);
		}

		this.hasRun = true;
		return this;
	}

	/**
	 * Automatically calls run() if it hasn't been called yet.
	 * This allows for a simpler API where assertions auto-trigger execution.
	 *
	 * @private
	 */
	private ensureRun(): void {
		if (!this.hasRun) {
			this.run();
		}
	}

	/**
	 * Asserts that the last command exited successfully (status code 0).
	 *
	 * @remarks
	 * If {@link run} hasn't been called yet, it will be called automatically
	 * with any flags and arguments previously set via {@link flags} and {@link args}.
	 *
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.flags('-h');
	 * t.assert_success();  // run() called implicitly
	 * ```
	 */
	assert_success(): this {
		this.ensureRun();
		this.commands.push("assert_success");
		return this;
	}

	/**
	 * Asserts that the last command exited with a failure (non-zero status).
	 *
	 * @remarks
	 * If {@link run} hasn't been called yet, it will be called automatically.
	 *
	 * @param expectedCode - Optional specific exit code to expect
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.flags('--invalid');
	 * t.assert_failure(); // Any non-zero exit code
	 * t.assert_failure(1); // Specific exit code
	 * ```
	 */
	assert_failure(expectedCode?: number): this {
		this.ensureRun();
		if (expectedCode !== undefined) {
			this.commands.push(`assert_failure ${expectedCode}`);
		} else {
			this.commands.push("assert_failure");
		}
		return this;
	}

	/**
	 * Asserts that the last command exited with a specific exit code.
	 *
	 * @remarks
	 * If {@link run} hasn't been called yet, it will be called automatically.
	 * This is the most commonly used assertion method for checking exit codes.
	 *
	 * @param expectedCode - The expected exit code (0 for success, non-zero for failure)
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // No flags or args - script runs as-is
	 * t.exit(0); // Expect success
	 *
	 * // With flags
	 * t.flags('--invalid');
	 * t.exit(1); // Expect exit code 1
	 *
	 * // With args
	 * t.args('invalid-path');
	 * t.exit(2); // Expect exit code 2
	 * ```
	 */
	exit(expectedCode: number): this {
		this.ensureRun();
		this.commands.push(`assert_exit ${expectedCode}`);
		return this;
	}

	/**
	 * Asserts that two values are equal.
	 *
	 * @param actual - The actual value
	 * @param expected - The expected value
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.assert_equal("$output", "expected value");
	 * ```
	 */
	assert_equal(actual: string, expected: string): this {
		this.ensureRun();
		this.commands.push(`assert_equal "${this.escape(actual)}" "${this.escape(expected)}"`);
		return this;
	}

	/**
	 * Asserts conditions about the command output.
	 *
	 * @remarks
	 * Supports three modes:
	 * - Exact match: output must exactly equal the string
	 * - Partial match: output must contain the substring
	 * - Regex match: output must match the regular expression
	 *
	 * @param options - String for exact match, or object with partial/regexp options
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Exact match
	 * t.assert_output("expected output");
	 *
	 * // Partial match
	 * t.assert_output({ partial: "substring" });
	 *
	 * // Regex match
	 * t.assert_output({ regexp: "^version: [0-9]+" });
	 * ```
	 */
	assert_output(options: { partial?: string; regexp?: string; line?: string; index?: number } | string): this {
		this.ensureRun();
		if (typeof options === "string") {
			// Simple string match
			this.commands.push(`assert_output "${this.escape(options)}"`);
		} else if (options.partial) {
			this.commands.push(`assert_output --partial "${this.escape(options.partial)}"`);
		} else if (options.regexp) {
			this.commands.push(`assert_output --regexp "${this.escape(options.regexp)}"`);
		} else if (options.line !== undefined) {
			this.commands.push(`assert_output "${this.escape(options.line)}"`);
		}
		return this;
	}

	/**
	 * Asserts that the command output does NOT contain specific content.
	 *
	 * @remarks
	 * Without options, asserts that output is empty.
	 * With options, asserts that output does not contain the specified pattern.
	 *
	 * @param options - Object with partial or regexp options, or undefined for empty check
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Assert empty output
	 * t.refute_output();
	 *
	 * // Assert does not contain substring
	 * t.refute_output({ partial: "error" });
	 *
	 * // Assert does not match regex
	 * t.refute_output({ regexp: "^ERROR:" });
	 * ```
	 */
	refute_output(options?: { partial?: string; regexp?: string }): this {
		this.ensureRun();
		if (!options) {
			this.commands.push("refute_output");
		} else if (options.partial) {
			this.commands.push(`refute_output --partial "${this.escape(options.partial)}"`);
		} else if (options.regexp) {
			this.commands.push(`refute_output --regexp "${this.escape(options.regexp)}"`);
		}
		return this;
	}

	/**
	 * Asserts conditions about a specific line in the output.
	 *
	 * @remarks
	 * Supports multiple modes:
	 * - Line search: finds a line containing the string
	 * - Index match: checks line at specific index (0-based)
	 * - Partial match: finds a line containing substring
	 * - Regex match: finds a line matching pattern
	 *
	 * @param options - String for line search, or object with index/partial/regexp options
	 * @param expected - Expected line content (used with index option)
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Find line containing text
	 * t.assert_line("version: 1.0.0");
	 *
	 * // Check specific line by index
	 * t.assert_line({ index: 0 }, "first line");
	 *
	 * // Find line with partial match
	 * t.assert_line({ partial: "error" });
	 *
	 * // Find line matching regex
	 * t.assert_line({ regexp: "^[0-9]+" });
	 * ```
	 */
	assert_line(options: { partial?: string; regexp?: string; index?: number } | string, expected?: string): this {
		if (typeof options === "string") {
			// Simple line search
			this.commands.push(`assert_line "${this.escape(options)}"`);
		} else if (options.index !== undefined && expected) {
			this.commands.push(`assert_line --index ${options.index} "${this.escape(expected)}"`);
		} else if (options.partial) {
			this.commands.push(`assert_line --partial "${this.escape(options.partial)}"`);
		} else if (options.regexp) {
			this.commands.push(`assert_line --regexp "${this.escape(options.regexp)}"`);
		}
		return this;
	}

	/**
	 * Asserts that NO line in the output matches the specified criteria.
	 *
	 * @param options - String for exact match, or object with index/partial/regexp options
	 * @param expected - Expected line to NOT match (used with index option)
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Assert no line contains text
	 * t.refute_line("error");
	 *
	 * // Assert line at index doesn't match
	 * t.refute_line({ index: 0 }, "ERROR");
	 *
	 * // Assert no line contains substring
	 * t.refute_line({ partial: "warning" });
	 * ```
	 */
	refute_line(options?: { partial?: string; regexp?: string; index?: number } | string, expected?: string): this {
		if (typeof options === "string") {
			this.commands.push(`refute_line "${this.escape(options)}"`);
		} else if (options?.index !== undefined && expected) {
			this.commands.push(`refute_line --index ${options.index} "${this.escape(expected)}"`);
		} else if (options?.partial) {
			this.commands.push(`refute_line --partial "${this.escape(options.partial)}"`);
		} else if (options?.regexp) {
			this.commands.push(`refute_line --regexp "${this.escape(options.regexp)}"`);
		}
		return this;
	}

	/**
	 * Asserts that a bash expression evaluates to true.
	 *
	 * @param expression - The bash expression to evaluate
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.assert('[ -f "$SCRIPT" ]'); // File exists
	 * t.assert('[ "$status" -eq 0 ]'); // Exit code is 0
	 * ```
	 */
	assert(expression: string): this {
		this.commands.push(`assert ${expression}`);
		return this;
	}

	/**
	 * Asserts that a bash expression evaluates to false.
	 *
	 * @param expression - The bash expression to evaluate
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.refute('[ -f "$SCRIPT.backup" ]'); // File doesn't exist
	 * t.refute('[ "$status" -eq 0 ]'); // Exit code is not 0
	 * ```
	 */
	refute(expression: string): this {
		this.commands.push(`refute ${expression}`);
		return this;
	}

	/**
	 * Adds a raw bash command directly to the test.
	 *
	 * @remarks
	 * Use this for custom bash logic that doesn't fit into the standard assertion
	 * methods. The command is added as-is to the generated BATS test.
	 *
	 * @param command - The raw bash command to add
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.raw('[ -f "$SCRIPT" ]'); // Check file exists
	 * t.raw('echo "$output" | jq empty || exit 1'); // Validate JSON
	 * t.raw('mkdir -p test-dir'); // Create directory
	 * ```
	 */
	raw(command: string): this {
		this.commands.push(command);
		return this;
	}

	/**
	 * Creates a mock executable for testing command detection and version checking.
	 *
	 * @remarks
	 * Generates a fake binary in `fake-bin/` that responds to specific command arguments.
	 * The mock supports simple command-response patterns and nested command structures.
	 *
	 * **Special Handling:**
	 * - For `npm`: Automatically generates `config ls -l --json` response from config object
	 * - Supports nested commands with multiple arguments (e.g., "npm config get prefix")
	 * - With `fallback: true`, unmatched commands are forwarded to the real binary
	 *
	 * **Usage Patterns:**
	 * - Simple version mocking: `{ "--version": "1.0.0" }`
	 * - Nested commands: `{ "config": { "get prefix": "/usr/local" } }`
	 * - Fallback mode: `{ ... }, { fallback: true }`
	 *
	 * @param command - The command name to mock (e.g., "npm", "node", "yarn")
	 * @param config - Map of command arguments to responses, supports nesting for subcommands
	 * @param options - Optional configuration with fallback setting
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Simple version mock
	 * t.mock("node", { "--version": "v20.10.0" });
	 *
	 * // Nested command structure
	 * t.mock("npm", {
	 *   "--version": "10.2.3",
	 *   "config": {
	 *     "get prefix": "/usr/local",
	 *     "get cache": "/tmp/npm-cache"
	 *   }
	 * });
	 *
	 * // With fallback to real binary
	 * t.mock("yarn", {
	 *   "--version": "1.22.19"
	 * }, { fallback: true });  // Unmatched commands call real yarn
	 * ```
	 *
	 * @see {@link nullBin} for creating a binary that always fails
	 */
	mock(
		command: string,
		config: Record<
			string,
			string | { output: string; exit?: number } | Record<string, string | { output: string; exit?: number }>
		>,
		options?: { fallback?: boolean },
	): this {
		this.commands.push("mkdir -p fake-bin");

		// Special handling for npm: auto-generate config ls -l --json response
		if (command === "npm" && config.config && typeof config.config === "object") {
			const npmVersion = config["--version"] || "10.0.0";
			const npmConfig = config.config as Record<string, string>;

			// Extract values from config object
			const prefix = npmConfig["get prefix"] || "/usr/local";
			const cache = npmConfig["get cache"] || "/tmp/npm-cache";
			const userconfig = npmConfig["get userconfig"] || "$HOME/.npmrc";
			const globalconfig = npmConfig["get globalconfig"] || "/usr/local/etc/npmrc";

			// Create a minimal npm config ls -l --json response
			const configJson = {
				"npm-version": npmVersion,
				prefix: prefix,
				cache: cache,
				userconfig: userconfig,
				globalconfig: globalconfig,
			};

			// Add ls -l --json pattern to config
			(config.config as Record<string, string>)["ls -l --json"] = JSON.stringify(configJson);
		}

		// Generate the bash script
		const scriptLines: string[] = ["#!/bin/bash"];

		// Build case statement
		const topLevelCases: string[] = [];

		for (const [pattern, response] of Object.entries(config)) {
			if (typeof response === "string") {
				// Simple case: pattern -> response
				topLevelCases.push(`  ${pattern}) echo "${response}" ;;`);
			} else if ("output" in response && typeof response.output === "string") {
				// Object with output and optional exit code
				const output = response.output.replace(/"/g, '\\"');
				const exitCode = response.exit !== undefined ? `; exit ${response.exit}` : "";
				topLevelCases.push(`  ${pattern}) echo "${output}"${exitCode} ;;`);
			} else {
				// Nested case: pattern -> sub-cases
				const subCases: string[] = [];
				for (const [subPattern, subResponse] of Object.entries(response)) {
					let casePattern: string;
					let caseBody: string;

					// Check if pattern is a wildcard
					if (subPattern === "*") {
						casePattern = "*";
					} else if (subPattern.split(" ").length > 2) {
						// Long pattern: match full argument string
						casePattern = `"${subPattern}"`;
					} else {
						// Short pattern: match $2 $3 as before
						casePattern = `"${subPattern}"`;
					}

					// Handle response - could be string or object with exit code
					if (typeof subResponse === "string") {
						const escapedResponse = subResponse.replace(/"/g, '\\"');
						caseBody = `echo "${escapedResponse}"`;
					} else {
						const escapedOutput = subResponse.output.replace(/"/g, '\\"');
						const exitCode = subResponse.exit !== undefined ? `; exit ${subResponse.exit}` : "";
						caseBody = `echo "${escapedOutput}"${exitCode}`;
					}

					subCases.push(`      ${casePattern}) ${caseBody} ;;`);
				}

				// Check if we have any long patterns (>2 words) or wildcards
				const hasLongPatterns = Object.keys(response).some((k) => k.split(" ").length > 2 || k === "*");

				if (hasLongPatterns) {
					// Use full argument matching for long patterns or wildcards (${*:2} gives all args from $2 onwards)
					topLevelCases.push(`  ${pattern})\n    case "\${*:2}" in\n${subCases.join("\n")}\n    esac\n    ;;`);
				} else {
					// Use existing $2 $3 matching for short patterns
					topLevelCases.push(`  ${pattern})\n    case "$2 $3" in\n${subCases.join("\n")}\n    esac\n    ;;`);
				}
			}
		}

		scriptLines.push('case "$1" in');
		scriptLines.push(...topLevelCases);

		// Add fallback case if enabled
		if (options?.fallback) {
			scriptLines.push(`  *)`);
			scriptLines.push(`    # Fallback: call real ${command} from system PATH`);
			scriptLines.push(`    # Remove fake-bin from PATH to find the real binary`);
			scriptLines.push(
				`    REAL_PATH=$(echo "$PATH" | tr ':' '\\n' | grep -v "fake-bin" | tr '\\n' ':' | sed 's/:$//')`,
			);
			scriptLines.push(`    REAL_CMD=$(PATH="$REAL_PATH" command -v ${command} 2>/dev/null || true)`);
			scriptLines.push(`    if [ -n "$REAL_CMD" ]; then`);
			scriptLines.push(`      # Use the real PATH for execution so dependencies (like node) are found`);
			scriptLines.push(`      PATH="$REAL_PATH" exec "$REAL_CMD" "$@"`);
			scriptLines.push(`    else`);
			scriptLines.push(`      echo "Error: ${command} not found in system" >&2`);
			scriptLines.push(`      exit 127`);
			scriptLines.push(`    fi`);
			scriptLines.push(`    ;;`);
		}

		scriptLines.push("esac");

		const script = scriptLines.join("\n");

		// Use heredoc to write the script
		this.commands.push(`cat > fake-bin/${command} <<'EOF'\n${script}\nEOF`);
		this.commands.push(`chmod +x fake-bin/${command}`);

		return this;
	}

	/**
	 * Creates a null binary that exists but always fails.
	 *
	 * @remarks
	 * Useful for testing "not available" scenarios while still exercising
	 * the detection code paths for coverage tracking. The binary will be
	 * found by `command -v` but will exit with status 1 when executed.
	 *
	 * @param command - The command name to create as a null binary
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // command -v npm succeeds, but npm --version fails with exit 1
	 * t.nullBin("npm");
	 * t.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" }).run('"$SCRIPT"');
	 * t.assert_json_value("npm.available", false);
	 * ```
	 *
	 * @see {@link mock} for creating a functional mock binary
	 */
	nullBin(command: string): this {
		this.commands.push("mkdir -p fake-bin");
		this.commands.push(`cat > fake-bin/${command} <<'EOF'\n#!/bin/bash\nexit 1\nEOF`);
		this.commands.push(`chmod +x fake-bin/${command}`);
		return this;
	}

	/**
	 * Asserts that a JSON field in the output matches an expected value.
	 *
	 * @remarks
	 * Uses `jq` to extract the value at the specified path and compares it
	 * to the expected value. Supports dot notation for nested paths and
	 * handles all JSON types (strings, numbers, booleans, null).
	 *
	 * **Type Handling:**
	 * - Strings: Compared as-is
	 * - Numbers: Converted to string for comparison
	 * - Booleans: Converted to "true" or "false"
	 * - Null: Converted to "null"
	 *
	 * @param path - Dot-separated JSON path (e.g., "npm.available", "config.cache")
	 * @param expected - Expected value (string, number, boolean, or null)
	 * @returns This builder instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * t.assert_json_value("npm.available", true);
	 * t.assert_json_value("npm.version", "10.2.3");
	 * t.assert_json_value("summary.total_available", 2);
	 * t.assert_json_value("pnpm.path", null);
	 * t.assert_json_value("node.corepack.enabled", false);
	 * ```
	 */
	assert_json_value(path: string, expected: string | number | boolean | null): this {
		this.ensureRun();
		// Convert path to jq format (prepend with .)
		const jqPath = `.${path}`;

		// Convert expected value to appropriate format for comparison
		let expectedStr: string;
		if (typeof expected === "string") {
			expectedStr = expected;
		} else if (typeof expected === "boolean") {
			expectedStr = expected ? "true" : "false";
		} else if (expected === null) {
			expectedStr = "null";
		} else {
			expectedStr = String(expected);
		}

		// Generate bash code for assertion using jq
		this.commands.push(
			`actual=$(echo "$output" | jq -r '${jqPath}')`,
			`if [ "$actual" != "${expectedStr}" ]; then`,
			`  echo "Expected JSON path '${path}' to equal '${expectedStr}', got: $actual"`,
			`  exit 1`,
			`fi`,
		);

		return this;
	}

	/**
	 * Escapes double quotes in strings for safe inclusion in BATS commands.
	 *
	 * @param str - The string to escape
	 * @returns The escaped string with `\"` replacing `"`
	 * @private
	 */
	private escape(str: string): string {
		return str.replace(/"/g, '\\"');
	}

	/**
	 * Generates the complete BATS test body from accumulated commands.
	 *
	 * @remarks
	 * Each command is indented with 2 spaces for proper BATS syntax.
	 * This method is called internally when {@link BatsHelper.test} writes the test file.
	 *
	 * @returns The generated bash commands as a multi-line string
	 * @internal
	 */
	toString(): string {
		return this.commands.map((cmd) => `  ${cmd}`).join("\n");
	}
}

/**
 * Main helper class for writing shell script tests that generate BATS files with kcov coverage.
 *
 * @remarks
 * BatsHelper is the primary API for creating shell script tests in TypeScript.
 * It provides multiple ways to write tests:
 *
 * 1. **Builder API** (recommended): Type-safe fluent API with method chaining
 * 2. **Template literals**: Write BATS syntax directly in TypeScript
 * 3. **Fluent context**: Experimental direct execution without BATS files
 *
 * **Key Features:**
 * - Singleton pattern: One helper instance per script (shared across test files)
 * - Automatic BATS file generation for coverage collection with kcov
 * - Reference counting for proper setup/teardown across multiple test files
 * - Integration with Vitest's test runner and assertions
 *
 * **Lifecycle:**
 * 1. Create helper with {@link create} (or retrieve cached instance)
 * 2. Call {@link setup} in `beforeAll`
 * 3. Write tests with {@link test}, {@link it}, or {@link skip}
 * 4. Call {@link teardown} in `afterAll` (writes BATS files)
 *
 * @example
 * ```typescript
 * import { describe, beforeAll, afterAll } from "vitest";
 * import { BatsHelper } from "./vitest-kcov-bats-helper.js";
 *
 * const scriptPath = import.meta.resolve("../scripts/my-script.sh");
 *
 * describe(BatsHelper.getDisplayName(scriptPath), () => {
 *   const helper = BatsHelper.create(scriptPath);
 *
 *   beforeAll(async () => {
 *     await helper.setup();
 *   }, 60000);
 *
 *   afterAll(async () => {
 *     await helper.teardown();
 *   });
 *
 *   // Builder API (recommended)
 *   helper.test("detects node when installed", (t) => {
 *     t.mock("node", { "--version": "v20.10.0" });
 *     t.run('"$SCRIPT"');
 *     t.assert_success();
 *     t.assert_json_value("node.version", "20.10.0");
 *   });
 * });
 * ```
 *
 * @see {@link create} for singleton instantiation
 * @see {@link test} for the recommended builder API
 * @see {@link getDisplayName} for generating display names from script paths
 */
export class BatsHelper {
	private scriptPath: string;
	private tempDir: string | null = null;
	private refCount = 0;
	private tests: Array<{ name: string; body: string; lineNumber?: number; filePath?: string }> = [];
	private linker: HTELink;

	/** Cache of helper instances per script path (singleton pattern) */
	static cache: Map<string, BatsHelper> = new Map();
	/** Flag to track if cache directory has been cleared during this session */
	static cacheDirCleared = false;
	/** Configured cache directory set by the coverage provider */
	private static _configuredCacheDir: string | null = null;
	/** Configured link format for terminal output */
	private static _configuredLinkFormat: LinkFormat = "auto";

	/** Global key for sharing cache directory across module contexts */
	private static readonly GLOBAL_CACHE_DIR_KEY = "__VITEST_KCOV_BATS_HELPER_CACHE_DIR__";
	/** Global key for sharing link format across module contexts */
	private static readonly GLOBAL_LINK_FORMAT_KEY = "__VITEST_KCOV_BATS_HELPER_LINK_FORMAT__";

	/**
	 * Configures the cache directory and link format for all BatsHelper instances.
	 *
	 * @remarks
	 * This method should be called by the coverage provider during initialization
	 * to set the cache directory and link format for all BatsHelper instances. Once configured,
	 * all instances will use this directory for storing generated BATS files
	 * and kcov coverage output, and will format file paths in error messages using
	 * the configured link format.
	 *
	 * @param cacheDir - The absolute path to the cache directory
	 * @param linkFormat - The link format mode for terminal output (default: "auto")
	 *
	 * @example
	 * ```typescript
	 * // In coverage provider's initialize() method
	 * BatsHelper.configure("/path/to/coverage/bats-cache", "auto");
	 * ```
	 */
	static configure(cacheDir: string, linkFormat: LinkFormat = "auto"): void {
		BatsHelper._configuredCacheDir = cacheDir;
		BatsHelper._configuredLinkFormat = linkFormat;

		// Also store in process.env to share across Vitest isolated contexts (worker threads/VMs)
		process.env[BatsHelper.GLOBAL_CACHE_DIR_KEY] = cacheDir;
		process.env[BatsHelper.GLOBAL_LINK_FORMAT_KEY] = linkFormat;
	}

	/**
	 * Gets the configured cache directory.
	 *
	 * @remarks
	 * Returns the cache directory configured via {@link configure}.
	 * If not configured, returns a default based on the current working directory.
	 *
	 * @returns The absolute path to the cache directory
	 */
	private static getCacheDir(): string {
		// First check local static variable
		if (BatsHelper._configuredCacheDir) {
			return BatsHelper._configuredCacheDir;
		}

		// Check process.env for configuration from different Vitest context (worker threads/VMs)
		const envCacheDir = process.env[BatsHelper.GLOBAL_CACHE_DIR_KEY];
		if (envCacheDir) {
			// Cache it locally for next time
			BatsHelper._configuredCacheDir = envCacheDir;
			return envCacheDir;
		}

		// Fallback: assume coverage/bats-cache as default
		// This handles cases where coverage is disabled (e.g., macOS) but tests still run
		return resolve(process.cwd(), "coverage/bats-cache");
	}

	/**
	 * Private constructor - use {@link create} to instantiate.
	 *
	 * @param scriptPath - Absolute path to the shell script (file:// URLs are supported)
	 * @private
	 */
	private constructor(scriptPath: string) {
		// Handle file:// URLs from import.meta.resolve()
		if (scriptPath.startsWith("file://")) {
			this.scriptPath = new URL(scriptPath).pathname;
		} else {
			this.scriptPath = scriptPath;
		}

		// Initialize HTELink with configured link format
		// Check process.env for cross-context configuration from Vitest provider
		const linkFormat =
			BatsHelper._configuredLinkFormat || (process.env[BatsHelper.GLOBAL_LINK_FORMAT_KEY] as LinkFormat) || "auto";
		this.linker = new HTELink({ mode: linkFormat });
	}

	/**
	 * Creates or retrieves a cached BatsHelper instance for a script.
	 *
	 * @remarks
	 * Uses the singleton pattern - multiple calls with the same scriptPath
	 * return the same instance. This allows multiple test files to share
	 * the same helper and contribute tests to the same BATS file.
	 *
	 * @param scriptPath - Absolute path to the script (use `import.meta.resolve()`)
	 * @returns A BatsHelper instance (cached if previously created)
	 *
	 * @example
	 * ```typescript
	 * const helper = BatsHelper.create(import.meta.resolve("../scripts/info-system.sh"));
	 * ```
	 */
	static create(scriptPath: string): BatsHelper {
		if (BatsHelper.cache.has(scriptPath)) {
			return BatsHelper.cache.get(scriptPath) as BatsHelper;
		}
		const helper = new BatsHelper(scriptPath);
		BatsHelper.cache.set(scriptPath, helper);

		return helper;
	}

	/**
	 * Returns all shell scripts that have been registered for testing.
	 *
	 * @remarks
	 * Scripts are automatically registered when {@link describe} is called during test suite
	 * initialization (before tests run). This method is used internally by the kcov provider
	 * for automatic script discovery, eliminating the need for manual configuration.
	 *
	 * The cache is populated during test file imports when {@link describe} or {@link create}
	 * is invoked. Each unique script path is registered once in the singleton cache, allowing
	 * multiple test files to share the same helper instance and contribute tests to the same
	 * BATS file.
	 *
	 * @returns Array of absolute paths to all registered shell scripts
	 *
	 * @example
	 * ```typescript
	 * // After tests have registered scripts via BatsHelper.describe()
	 * const scripts = BatsHelper.getRegisteredScripts();
	 * // Returns: ["/path/to/script1.sh", "/path/to/script2.sh"]
	 * ```
	 */
	static getRegisteredScripts(): string[] {
		return Array.from(BatsHelper.cache.values()).map((helper) => helper.scriptPath);
	}

	/**
	 * Generates a human-readable display name from a script path.
	 *
	 * @remarks
	 * Extracts a shortened, meaningful path for test suite naming. The strategy:
	 * 1. Find common root markers ("scripts", "bin", "src", "lib", "tools")
	 * 2. Return everything after the marker directory
	 * 3. If no marker found, return last 2 path segments
	 * 4. Fallback: just the filename
	 *
	 * This provides cleaner test output without exposing full system paths.
	 *
	 * @param scriptPath - Absolute or file:// URL path to a script
	 * @returns A shortened display name suitable for test suite titles
	 *
	 * @example
	 * ```typescript
	 * BatsHelper.getDisplayName("/foo/plugins/workflow/scripts/doctor-biome.sh");
	 * // Returns: "doctor-biome.sh"
	 *
	 * BatsHelper.getDisplayName("/foo/plugins/workflow/scripts/utils/info-system.sh");
	 * // Returns: "utils/info-system.sh"
	 *
	 * BatsHelper.getDisplayName("file:///my-project/bin/deploy.sh");
	 * // Returns: "deploy.sh"
	 * ```
	 */
	static getDisplayName(scriptPath: string): string {
		// Handle file:// URLs from import.meta.resolve()
		let path = scriptPath;
		if (scriptPath.startsWith("file://")) {
			path = new URL(scriptPath).pathname;
		}

		const parts = path.split(sep).filter((p) => p.length > 0);

		// Find common root markers (directory names that typically contain scripts)
		const rootMarkers = ["scripts", "bin", "src", "lib", "tools"];
		const markerIndex = parts.findIndex((part) => rootMarkers.includes(part));

		if (markerIndex !== -1 && markerIndex < parts.length - 1) {
			// Return everything after the marker directory
			return parts.slice(markerIndex + 1).join(sep);
		}

		// Fallback: return the last 2 segments (parent-dir/filename)
		if (parts.length >= 2) {
			return parts.slice(-2).join(sep);
		}

		// Ultimate fallback: just the filename
		return parts[parts.length - 1] || basename(path);
	}

	/**
	 * Generates a human-readable display name from a test file path.
	 *
	 * @remarks
	 * Similar to {@link getDisplayName} but optimized for test files.
	 * Looks for "__tests__" marker and returns the filename relative to it.
	 *
	 * @param testPath - Absolute path to a test file
	 * @returns A shortened display name (e.g., "info-system.test.ts")
	 *
	 * @example
	 * ```typescript
	 * BatsHelper.getTestDisplayName("/foo/plugins/workflow/__tests__/info-system.test.ts");
	 * // Returns: "info-system.test.ts"
	 * ```
	 */
	static getTestDisplayName(testPath: string): string {
		const parts = testPath.split(sep).filter((p) => p.length > 0);

		// Find __tests__ directory
		const testsIndex = parts.indexOf("__tests__");

		if (testsIndex !== -1 && testsIndex < parts.length - 1) {
			// Return everything after __tests__
			return parts.slice(testsIndex + 1).join(sep);
		}

		// Fallback: just the filename
		return parts[parts.length - 1] || basename(testPath);
	}

	/**
	 * Wraps a test suite with automatic setup/teardown for BATS testing.
	 *
	 * @remarks
	 * This is the recommended API for writing BATS tests with BatsHelper. It:
	 * - Automatically creates a describe block with a clean display name
	 * - Handles helper instance creation (with caching)
	 * - Sets up beforeAll/afterAll hooks with configurable timeout (default: 60s)
	 * - Provides the helper instance to your callback for writing tests
	 *
	 * This eliminates the boilerplate of manual setup/teardown and import management.
	 *
	 * **Timeout Configuration:**
	 * The timeout parameter controls how long Vitest will wait for the setup/teardown operations
	 * to complete. Recommended range: 30000-180000ms (30-180 seconds) for most operations.
	 * The default of 60 seconds is suitable for typical shell script testing scenarios.
	 *
	 * @param scriptPath - Absolute path to the script (use `import.meta.resolve()`)
	 * @param callback - Test definition callback that receives the helper instance
	 * @param timeout - Test setup timeout in milliseconds (default: 60000)
	 *
	 * @example
	 * ```typescript
	 * import { BatsHelper } from "../../../lib/vitest-kcov-plugin/vitest-kcov-bats-helper.js";
	 *
	 * // Default 60s timeout
	 * BatsHelper.describe(import.meta.resolve("../scripts/info/info-yarn.sh"), (helper) => {
	 *   helper.test("detects yarn when installed", (script) => {
	 *     script.mock("yarn", { "--version": "1.22.19" });
	 *     script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
	 *     script.flags("-j");
	 *     script.assert_success();
	 *     script.assert_json_value("version", "1.22.19");
	 *   });
	 * });
	 *
	 * // Custom 120s timeout for slower operations
	 * BatsHelper.describe(import.meta.resolve("../scripts/slow-script.sh"), (helper) => {
	 *   helper.test("handles slow operation", (script) => {
	 *     script.assert_success();
	 *   });
	 * }, 120000);
	 * ```
	 */
	static describe(scriptPath: string, callback: (helper: BatsHelper) => void, timeout: number = 60000): void {
		const displayName = BatsHelper.getDisplayName(scriptPath);
		const helper = BatsHelper.create(scriptPath);
		// Get the converted filesystem path from the helper (handles file:// URLs)
		const fsPath = helper.getScriptPath();

		// Store script path in suite metadata for reporters to access
		// Note: meta is not in Vitest's TypeScript types but is supported at runtime
		describe(displayName, { meta: { scriptPath } } as Parameters<typeof describe>[1], () => {
			beforeAll(async () => {
				await helper.setup();

				// Make script executable for kcov coverage collection
				try {
					const stats = await stat(fsPath);
					const currentMode = stats.mode;
					const octalBefore = (currentMode & 0o777).toString(8).padStart(3, "0");
					// Add owner execute bit: 0o100
					const newMode = currentMode | 0o100;
					const octalAfter = (newMode & 0o777).toString(8).padStart(3, "0");
					await chmod(fsPath, newMode);
					const logLevel = process.env.KCOV_LOG_LEVEL || "errors-only";
					if (logLevel === "debug") {
						console.log(`[DEBUG beforeAll] Made ${basename(fsPath)} executable: ${octalBefore} → ${octalAfter}`);
					}
				} catch (error) {
					console.warn(`Warning: Failed to make script executable: ${fsPath}:`, error);
				}
			}, timeout);

			afterAll(async () => {
				// Remove executable bit from script
				try {
					const statsBefore = await stat(fsPath);
					const currentMode = statsBefore.mode;
					const octalBefore = (currentMode & 0o777).toString(8).padStart(3, "0");
					// Remove owner execute bit: ~0o100
					const newMode = currentMode & ~0o100;
					const octalAfter = (newMode & 0o777).toString(8).padStart(3, "0");
					await chmod(fsPath, newMode);
					const logLevel = process.env.KCOV_LOG_LEVEL || "errors-only";
					if (logLevel === "debug") {
						console.log(
							`[DEBUG afterAll] Removed executable bit from ${basename(fsPath)}: ${octalBefore} → ${octalAfter}`,
						);
					}
				} catch (error) {
					console.warn(`Warning: Failed to remove executable bit: ${fsPath}:`, error);
				}

				await helper.teardown();
			});

			callback(helper);
		});
	}

	/**
	 * Clears the test cache and coverage directories.
	 *
	 * @remarks
	 * Removes `.cache` and `coverage` directories to ensure fresh BATS file
	 * generation and kcov coverage collection. Should be called once during
	 * global setup (typically in `vitest.setup.ts`).
	 *
	 * Clears:
	 * - `plugins/workflow/__tests__/.cache` - Generated BATS files
	 * - `coverage` - Kcov coverage data
	 *
	 * @returns A promise that resolves when cache clearing is complete
	 *
	 * @example
	 * ```typescript
	 * // vitest.setup.ts
	 * import { beforeAll } from "vitest";
	 * import { BatsHelper } from "./lib/vitest-kcov-plugin/vitest-kcov-bats-helper.js";
	 *
	 * beforeAll(async () => {
	 *   await BatsHelper.clearCache();
	 * });
	 * ```
	 */
	static async clearCache(): Promise<void> {
		// Clear configured cache directory
		const cacheDir = BatsHelper.getCacheDir();

		try {
			await stat(cacheDir);
			await rm(cacheDir, { recursive: true, force: true });
		} catch (_err) {
			// Directory does not exist, nothing to remove
		}

		// Reset the flag so the first writeBatsFile will create the directory
		BatsHelper.cacheDirCleared = false;
	}

	/**
	 * Gets the absolute path to the shell script being tested.
	 *
	 * @returns The absolute filesystem path to the script
	 *
	 * @example
	 * ```typescript
	 * const scriptPath = helper.getScriptPath();
	 * console.log(scriptPath); // "/path/to/project/scripts/info-system.sh"
	 * ```
	 */
	getScriptPath(): string {
		return this.scriptPath;
	}

	/**
	 * Gets all tests registered with this helper.
	 *
	 * @remarks
	 * Returns a copy of the internal test array. Each test contains the test name
	 * and the generated bash command body. Useful for debugging or introspection.
	 *
	 * @returns Array of test objects with `name` and `body` properties
	 *
	 * @example
	 * ```typescript
	 * const tests = helper.getTests();
	 * console.log(`Registered ${tests.length} tests`);
	 * for (const test of tests) {
	 *   console.log(`- ${test.name}`);
	 * }
	 * ```
	 */
	getTests(): Array<{ name: string; body: string }> {
		return [...this.tests];
	}

	/**
	 * Generate a complete BATS file from stored tests
	 */
	generateBatsFile(): string {
		const lines: string[] = [];

		// Shebang - use detected bats path from environment
		const batsPath = process.env.BATS_PATH;
		if (!batsPath) {
			throw new Error("BATS_PATH environment variable not set. Provider should have set this during dependency check.");
		}
		lines.push(`#!${batsPath}`);
		lines.push("");

		// Load bats-mock for command stubbing - use detected path
		const batsMockPath = process.env.BATS_MOCK_PATH;
		if (!batsMockPath) {
			throw new Error(
				"BATS_MOCK_PATH environment variable not set. Provider should have set this during dependency check.",
			);
		}
		lines.push("# Load bats-mock for command stubbing");
		lines.push(`source ${batsMockPath}/stub.bash`);
		lines.push("");

		// Note: bats-assert is NOT loaded here to avoid bashcov parsing issues
		// Instead, we provide simplified implementations of the assert functions below
		lines.push("# bats-assert functions are implemented inline to avoid bashcov parsing issues");
		lines.push("");

		// Setup function
		lines.push("setup() {");
		lines.push("    # Store the script path (use absolute path for bashcov)");
		lines.push(`    SCRIPT="${this.scriptPath}"`);
		lines.push("");
		lines.push("    # Create bash wrapper function for non-executable scripts");
		lines.push("    # This allows tests to run scripts without the executable bit set");
		lines.push("    run_script() {");
		lines.push('        bash "$SCRIPT" "$@"');
		lines.push("    }");
		lines.push("");
		lines.push("    # Create temporary directory for test fixtures");
		lines.push('    TEST_DIR="$BATS_TEST_TMPDIR/test"');
		lines.push('    mkdir -p "$TEST_DIR"');
		lines.push('    cd "$TEST_DIR"');
		lines.push("}");
		lines.push("");

		// Teardown function
		lines.push("teardown() {");
		lines.push("    # Clean up test directory");
		lines.push('    rm -rf "$TEST_DIR"');
		lines.push("}");
		lines.push("");

		// Add simplified bats-assert function implementations
		lines.push("# Simplified bats-assert implementations (inline to avoid bashcov issues)");
		lines.push("");
		lines.push("run() {");
		lines.push("  set +e");
		lines.push('  output=$("$@" 2>&1)');
		lines.push("  status=$?");
		lines.push("  set -e");
		lines.push("}");
		lines.push("");
		lines.push("assert_success() {");
		lines.push('  if [ "$status" -ne 0 ]; then');
		lines.push('    echo "Expected success but got exit code $status"');
		lines.push("    return 1");
		lines.push("  fi");
		lines.push("}");
		lines.push("");
		lines.push("assert_output() {");
		lines.push('  local mode="exact"');
		lines.push('  local expected="$1"');
		lines.push('  if [ "$1" = "--partial" ]; then');
		lines.push('    mode="partial"');
		lines.push('    expected="$2"');
		lines.push('  elif [ "$1" = "--regexp" ]; then');
		lines.push('    mode="regexp"');
		lines.push('    expected="$2"');
		lines.push("  fi");
		lines.push('  if [ "$mode" = "partial" ]; then');
		lines.push('    echo "$output" | grep -qF "$expected" || return 1');
		lines.push('  elif [ "$mode" = "regexp" ]; then');
		lines.push('    echo "$output" | grep -qE "$expected" || return 1');
		lines.push("  else");
		lines.push('    [ "$output" = "$expected" ] || return 1');
		lines.push("  fi");
		lines.push("}");
		lines.push("");
		lines.push("refute_output() {");
		lines.push("  if [ $# -eq 0 ]; then");
		lines.push('    [ -z "$output" ] || return 1');
		lines.push("    return 0");
		lines.push("  fi");
		lines.push('  local mode="exact"');
		lines.push('  local pattern="$1"');
		lines.push('  if [ "$1" = "--partial" ]; then');
		lines.push('    mode="partial"');
		lines.push('    pattern="$2"');
		lines.push('  elif [ "$1" = "--regexp" ]; then');
		lines.push('    mode="regexp"');
		lines.push('    pattern="$2"');
		lines.push("  fi");
		lines.push('  if [ "$mode" = "partial" ]; then');
		lines.push('    echo "$output" | grep -qF "$pattern" && return 1');
		lines.push('  elif [ "$mode" = "regexp" ]; then');
		lines.push('    echo "$output" | grep -qE "$pattern" && return 1');
		lines.push("  fi");
		lines.push("  return 0");
		lines.push("}");
		lines.push("");
		lines.push("assert_line() {");
		lines.push('  local mode="search"');
		lines.push('  local expected="$1"');
		lines.push('  if [ "$1" = "--index" ]; then');
		lines.push('    mode="index"');
		lines.push('    local line_num="$2"');
		lines.push('    expected="$3"');
		lines.push('    local actual=$(echo "$output" | sed -n "$((line_num + 1))p")');
		lines.push('    [ "$actual" = "$expected" ] || return 1');
		lines.push('  elif [ "$1" = "--partial" ]; then');
		lines.push('    expected="$2"');
		lines.push('    echo "$output" | grep -qF "$expected" || return 1');
		lines.push('  elif [ "$1" = "--regexp" ]; then');
		lines.push('    expected="$2"');
		lines.push('    echo "$output" | grep -qE "$expected" || return 1');
		lines.push("  else");
		lines.push('    echo "$output" | grep -qF "$expected" || return 1');
		lines.push("  fi");
		lines.push("}");
		lines.push("");

		// Add all tests
		for (const test of this.tests) {
			lines.push(`@test "${test.name}" {`);
			// The body is already indented from the template literal, don't add more
			lines.push(test.body);
			lines.push("}");
			lines.push("");
		}

		return lines.join("\n");
	}

	/**
	 * Initializes the helper for test execution.
	 *
	 * @remarks
	 * Uses reference counting to support multiple test files sharing the same helper.
	 * Creates a temporary directory on first setup call. Must be called in `beforeAll`.
	 *
	 * **Important:** Use a 60-second timeout for `beforeAll` as BATS setup can be slow.
	 *
	 * @returns A promise that resolves when setup is complete
	 *
	 * @example
	 * ```typescript
	 * beforeAll(async () => {
	 *   await helper.setup();
	 * }, 60000); // 60s timeout recommended
	 * ```
	 */
	async setup(): Promise<void> {
		this.refCount++;
		// Only create temp directory on first setup call
		if (this.refCount === 1) {
			this.tempDir = await mkdtemp(`${tmpdir()}${sep}bats-test-`);
		}
	}

	/**
	 * Cleans up after test execution and writes BATS files for coverage.
	 *
	 * @remarks
	 * Uses reference counting - only performs cleanup when all test files are done.
	 * Writes generated BATS files to `.cache` directory for kcov coverage collection.
	 * Must be called in `afterAll`.
	 *
	 * **What it does:**
	 * - Decrements reference count
	 * - If ref count reaches 0: writes .bats files to `.cache`
	 * - Leaves temp files for debugging/inspection
	 *
	 * @returns A promise that resolves when teardown is complete
	 *
	 * @example
	 * ```typescript
	 * afterAll(async () => {
	 *   await helper.teardown();
	 * });
	 * ```
	 */
	async teardown(): Promise<void> {
		this.refCount--;
		// Only cleanup when all test files are done
		if (this.refCount === 0 && this.tempDir) {
			// Write .bats file for coverage generation
			await this.writeBatsFile();

			// Cleanup is disabled for debugging. .bats files will remain for inspection.
			// await rm(this.tempDir, { recursive: true, force: true });
			// this.tempDir = null;
		}
	}

	/**
	 * Write separate .bats files - one per test
	 * This reduces BATS framework code per file and avoids bashcov parsing errors
	 * Files are written to __tests__/.cache directory which is cleared on first write
	 */
	private async writeBatsFile(): Promise<void> {
		if (this.tests.length === 0) return;

		// Derive base name from script name
		const scriptName = basename(this.scriptPath, ".sh");

		// Use configured cache directory
		const cacheDir = BatsHelper.getCacheDir();

		// Ensure cache directory exists (cleared in global setup)
		try {
			await stat(cacheDir);
		} catch {
			await mkdir(cacheDir, { recursive: true });
		}

		// Async generator for writing files in parallel
		async function* batsFileWriterParallel(
			tests: Array<{ name: string; body: string }>,
			generateSingleTestBatsFile: (test: { name: string; body: string }) => string,
		): AsyncGenerator<string, void, unknown> {
			const writePromises = tests.map((test, i) => {
				return (async () => {
					const fileNumber = String(i + 1).padStart(3, "0");
					const batsFilePath = resolve(cacheDir, `${scriptName}-${fileNumber}.bats`);
					const batsContent = generateSingleTestBatsFile(test);
					try {
						await writeFile(batsFilePath, batsContent, "utf-8");
						return batsFilePath;
					} catch (error) {
						// Silently fail - coverage generation will handle missing files
						console.warn(`Failed to write .bats file: ${batsFilePath}: ${error}`);
						return null;
					}
				})();
			});
			const results = await Promise.all(writePromises);
			for (const filePath of results) {
				if (filePath) yield filePath;
			}
		}

		// Use the async generator to write files as quickly as possible (in parallel)
		const writer = batsFileWriterParallel(this.tests, this.generateSingleTestBatsFile.bind(this));
		for await (const _ of writer) {
			// Files are written as soon as possible
		}
		// Removed verbose logging for cleaner test output
	}

	/**
	 * Find the project root directory by traversing up from the script path
	 * Looks for .git directory or falls back to current working directory
	 */
	private findProjectRoot(scriptPath: string): string {
		let currentDir = dirname(scriptPath);

		// Traverse up looking for .git directory
		while (currentDir !== "/" && currentDir !== ".") {
			if (existsSync(resolve(currentDir, ".git"))) {
				return currentDir;
			}
			currentDir = dirname(currentDir);
		}

		// Fall back to current working directory
		return process.cwd();
	}

	/**
	 * Generate a BATS file containing a single test
	 * Uses kcov for coverage collection instead of bashcov
	 * Note: kcov may not work on older macOS versions due to SIP restrictions
	 */
	private generateSingleTestBatsFile(test: { name: string; body: string }): string {
		const lines: string[] = [];

		// Shebang
		const scriptPath = this.scriptPath;
		const cacheDir = resolve(BatsHelper.getCacheDir(), "kcov");

		// Calculate the include pattern for kcov - use project root
		// This ensures we only track files in the project, not system files
		const includePattern = this.findProjectRoot(scriptPath);

		// Get BATS and library paths from environment (set by provider during dependency check)
		const batsPath = process.env.BATS_PATH;
		if (!batsPath) {
			throw new Error("BATS_PATH environment variable not set. Provider should have set this during dependency check.");
		}
		const batsMockPath = process.env.BATS_MOCK_PATH;
		if (!batsMockPath) {
			throw new Error(
				"BATS_MOCK_PATH environment variable not set. Provider should have set this during dependency check.",
			);
		}
		const batsSupportPath = process.env.BATS_SUPPORT_PATH;
		if (!batsSupportPath) {
			throw new Error(
				"BATS_SUPPORT_PATH environment variable not set. Provider should have set this during dependency check.",
			);
		}
		const batsAssertPath = process.env.BATS_ASSERT_PATH;
		if (!batsAssertPath) {
			throw new Error(
				"BATS_ASSERT_PATH environment variable not set. Provider should have set this during dependency check.",
			);
		}

		lines.push(`#!${batsPath}

setup() {
    # Load bats-support library
    load '${batsSupportPath}/load.bash'

    # Load bats-assert library
    load '${batsAssertPath}/load.bash'

    # Load bats-mock for command stubbing (must be in setup to access BATS_TMPDIR)
    load '${batsMockPath}/stub.bash'

    # Store the script path (use absolute path for kcov)
    SCRIPT_PATH="${scriptPath}"
    SCRIPT="${scriptPath}"

    # Create bash wrapper function for non-executable scripts
    # This allows tests to run scripts without the executable bit set
    run_script() {
        bash "$SCRIPT" "$@"
    }

    # Set up kcov output directory
    KCOV_OUT="$BATS_TEST_TMPDIR/kcov-out"
    mkdir -p "$KCOV_OUT"

    # Create temporary directory for test fixtures
    TEST_DIR="$BATS_TEST_TMPDIR/test"
    mkdir -p "$TEST_DIR"
    cd "$TEST_DIR"
}

teardown() {
    # Copy kcov output to persistent location for coverage aggregation
    # Use a unique subdirectory per test file to avoid overwriting coverage
    if [ -d "$KCOV_OUT" ]; then
        # Create unique directory name based on test filename
        TEST_ID=$(basename "$BATS_TEST_FILENAME" .bats)
        CACHE_DIR="${cacheDir}/$TEST_ID"

        # Debug: Check if kcov output exists
        if [ -n "$(ls -A "$KCOV_OUT" 2>/dev/null)" ]; then
            mkdir -p "$CACHE_DIR"
            cp -r "$KCOV_OUT"/* "$CACHE_DIR/" 2>&1 || {
                echo "Warning: Failed to copy kcov output from $KCOV_OUT to $CACHE_DIR" >&2
            }
        else
            echo "Warning: No kcov output found in $KCOV_OUT for test $TEST_ID" >&2
        fi
    else
        echo "Warning: KCOV_OUT directory does not exist: $KCOV_OUT" >&2
    fi

    # Clean up test directory
    rm -rf "$TEST_DIR"
}
`);

		lines.push(
			`
# Simplified bats-assert implementations

run() {
  set +e
  # Check if we're running the script under test - if so, try kcov
  # Note: kcov may not work on older macOS versions due to SIP restrictions
  local use_kcov=false
  local use_run_script_wrapper=false

  if command -v kcov > /dev/null 2>&1; then
    # Check if running the script directly
    if [ "$#" -gt 0 ] && [ "$1" = "$SCRIPT" ]; then
      use_kcov=true
    # Check if running via run_script wrapper (for non-executable scripts)
    elif [ "$#" -gt 0 ] && [ "$1" = "run_script" ]; then
      use_kcov=true
      use_run_script_wrapper=true
    fi
  fi

  if [ "$use_kcov" = true ]; then
    # Wrap command with kcov and export COVERAGE_RUN=1 so scripts can detect coverage context
    # Use LCOV markers to exclude heredoc regions from coverage
    local script_dir
    script_dir=$(dirname "$SCRIPT")
    export COVERAGE_RUN=1

    if [ "$use_run_script_wrapper" = true ]; then
      # When using run_script, shift off the function name and run with bash interpreter
      shift
      # First run: Execute script without kcov to get real exit code and output
      output=$(bash "$SCRIPT" "$@" 2>&1)
      status=$?

      # Debug: Check script permissions before kcov
      echo "[DEBUG run()] Checking script permissions: $SCRIPT" >&2
      ls -l "$SCRIPT" >&2
      if [ -x "$SCRIPT" ]; then
        echo "[DEBUG run()] ✓ Script is executable" >&2
      else
        echo "[DEBUG run()] ✗ WARNING: Script is NOT executable!" >&2
      fi

      # Second run: Execute with kcov for coverage (discard output, ignore exit code)
      # Note: Script permissions are managed by BatsHelper.describe() beforeAll/afterAll hooks
      echo "[DEBUG run()] Running kcov: kcov --skip-solibs --include-pattern=${includePattern} ... $KCOV_OUT $SCRIPT $@" >&2
      echo "[DEBUG run()] KCOV_OUT=$KCOV_OUT" >&2
      echo "[DEBUG run()] include_pattern=${includePattern}" >&2
      local kcov_output kcov_exit_code
      kcov_exit_code=0
      kcov_output=$(kcov \
        --skip-solibs \
        --include-pattern="${includePattern}" \
        --exclude-line='^#!/,^set -euo pipefail,^set -eo pipefail,^readonly SCRIPT_' \
        --exclude-region='# LCOV_EXCL_START:# LCOV_EXCL_STOP' \
        "$KCOV_OUT" "$SCRIPT" "$@" 2>&1) || kcov_exit_code=$?
      echo "[DEBUG run()] kcov exit code: $kcov_exit_code" >&2
      if [ "$kcov_exit_code" -ne 0 ]; then
        echo "Warning: kcov failed with exit code $kcov_exit_code for $SCRIPT" >&2
        echo "kcov output: $kcov_output" >&2
      else
        echo "[DEBUG run()] kcov succeeded!" >&2
        # Show what files were created
        if [ -d "$KCOV_OUT" ]; then
          echo "[DEBUG run()] kcov output directory contents:" >&2
          ls -la "$KCOV_OUT" | head -20 >&2
        fi
      fi
    else
      # Direct script execution
      # First run: Execute script without kcov to get real exit code and output
      output=$("$@" 2>&1)
      status=$?

      echo "[DEBUG run()] Running kcov for direct execution: $@" >&2
      echo "[DEBUG run()] include_pattern=${includePattern}" >&2
      # Second run: Execute with kcov for coverage (discard output, ignore exit code)
      local kcov_output kcov_exit_code
      kcov_exit_code=0
      kcov_output=$(kcov \
        --skip-solibs \
        --include-pattern="${includePattern}" \
        --exclude-line='^#!/,^set -euo pipefail,^set -eo pipefail,^readonly SCRIPT_' \
        --exclude-region='# LCOV_EXCL_START:# LCOV_EXCL_STOP' \
        "$KCOV_OUT" "$@" 2>&1) || kcov_exit_code=$?
      echo "[DEBUG run()] kcov exit code: $kcov_exit_code" >&2
      if [ "$kcov_exit_code" -ne 0 ]; then
        echo "Warning: kcov failed with exit code $kcov_exit_code for $SCRIPT" >&2
        echo "kcov output: $kcov_output" >&2
      else
        echo "[DEBUG run()] kcov succeeded" >&2
      fi
    fi
    unset COVERAGE_RUN
  else
    # Run normally without kcov
    # Check if the first argument is run_script (for non-executable scripts)
    if [ "$#" -gt 0 ] && [ "$1" = "run_script" ]; then
      # Execute with bash interpreter
      shift
      output=$(bash "$SCRIPT" "$@" 2>&1)
      status=$?
    else
      # Standard command execution
      output=$("$@" 2>&1)
      status=$?
    fi
  fi
  set -e
}

assert_success() {
  if [ "$status" -ne 0 ]; then
    echo "Expected success but got exit code $status"
    return 1
  fi
}

assert_failure() {
  if [ "$status" -eq 0 ]; then
    echo "Expected failure but got exit code $status"
    return 1
  fi
}

assert_exit() {
  local expected_code="$1"
  if [ "$status" -ne "$expected_code" ]; then
    echo "Expected exit code $expected_code but got $status"
    echo "Output: $output"
    return 1
  fi
}

assert_output() {
  local mode="exact"
  local expected="$1"
  if [ "$1" = "--partial" ]; then
    mode="partial"
    expected="$2"
  elif [ "$1" = "--regexp" ]; then
    mode="regexp"
    expected="$2"
  fi
  if [ "$mode" = "partial" ]; then
    echo "$output" | grep -qF "$expected" || return 1
  elif [ "$mode" = "regexp" ]; then
    echo "$output" | grep -qE "$expected" || return 1
  else
    [ "$output" = "$expected" ] || return 1
  fi
}

refute_output() {
  if [ $# -eq 0 ]; then
    [ -z "$output" ] || return 1
    return 0
  fi
  local mode="exact"
  local pattern="$1"
  if [ "$1" = "--partial" ]; then
    mode="partial"
    pattern="$2"
  elif [ "$1" = "--regexp" ]; then
    mode="regexp"
    pattern="$2"
  fi
  if [ "$mode" = "partial" ]; then
    echo "$output" | grep -qF "$pattern" && return 1
  elif [ "$mode" = "regexp" ]; then
    echo "$output" | grep -qE "$pattern" && return 1
  fi
  return 0
}

assert_line() {
  if [ "$1" = "--index" ]; then
    local line_num="$2"
    local expected="$3"
    local actual=$(echo "$output" | sed -n "$((line_num + 1))p")
    [ "$actual" = "$expected" ] || return 1
  elif [ "$1" = "--partial" ]; then
    echo "$output" | grep -qF "$2" || return 1
  elif [ "$1" = "--regexp" ]; then
    echo "$output" | grep -qE "$2" || return 1
  else
    echo "$output" | grep -qF "$1" || return 1
  fi
}
`,
		);

		// Add the single test
		lines.push(`@test "${test.name}" {`);
		lines.push(test.body);
		lines.push("}");
		lines.push("");

		return lines.join("\n");
	}

	/**
	 * Create a test from BATS syntax using tagged template literal OR fluent API
	 *
	 * Template literal usage:
	 * ```typescript
	 * helper.it`@test "test name" { ... bash commands ... }`
	 * ```
	 *
	 * Fluent API usage:
	 * ```typescript
	 * const { it } = BatsHelper.create(...);
	 * it("test name", async (test) => {
	 *   await test.run("$SCRIPT --json");
	 *   expect(test.json).toHaveProperty("status");
	 * });
	 * ```
	 */
	it(testName: string, testFn: (test: BatsTestContext) => Promise<void>): void;
	it(batsTest: TemplateStringsArray, ...values: unknown[]): void;
	it(testNameOrTemplate: string | TemplateStringsArray, ...args: unknown[]): void {
		// Check if this is fluent API (string + function)
		if (typeof testNameOrTemplate === "string" && typeof args[0] === "function") {
			const testName = testNameOrTemplate;
			const testFn = args[0] as (test: BatsTestContext) => Promise<void>;

			// Create Vitest test with fluent API
			vitestTest(testName, async () => {
				const testContext = new BatsTestContext(this.scriptPath);
				await testFn(testContext);
			});

			// TODO: For coverage generation, instrument BatsTestContext to record commands
			return;
		}

		// Otherwise, handle as template literal
		const testCode =
			typeof testNameOrTemplate === "string" ? testNameOrTemplate : String.raw(testNameOrTemplate, ...args);

		// Parse BATS test
		const testMatch = testCode.match(/@test\s+"([^"]+)"\s*\{([\s\S]*)\}/);
		if (!testMatch) {
			throw new Error(`Invalid BATS test syntax: ${testCode.slice(0, 100)}`);
		}

		const testName = testMatch[1];
		const testBody = testMatch[2].trim();

		// Store test for coverage generation
		this.tests.push({ name: testName, body: testBody });

		// Create Vitest test
		vitestTest(testName, async () => {
			await this.runBatsCommands(testBody, testName);
		});
	}

	/**
	 * Skips a test - creates a skipped Vitest test but does NOT generate a BATS file.
	 *
	 * @remarks
	 * Useful for debugging when you want to isolate specific tests or temporarily
	 * disable tests without removing them. The test will NOT be included in coverage
	 * collection since no BATS file is generated.
	 *
	 * @param batsTest - BATS test syntax as string or template literal
	 * @param values - Template literal values (if using tagged template)
	 *
	 * @example
	 * ```typescript
	 * // Skip a specific test during debugging
	 * helper.skip`@test "problematic test" {
	 *   run "$SCRIPT" --complex-operation
	 *   assert_success
	 * }`;
	 * ```
	 */
	skip(batsTest: string | TemplateStringsArray, ...values: unknown[]): void {
		// Handle tagged template literal
		const testCode = typeof batsTest === "string" ? batsTest : String.raw(batsTest, ...values);

		// Parse BATS test
		const testMatch = testCode.match(/@test\s+"([^"]+)"\s*\{([\s\S]*)\}/);
		if (!testMatch) {
			throw new Error(`Invalid BATS test syntax: ${testCode.slice(0, 100)}`);
		}

		const testName = testMatch[1];

		// DO NOT store test for coverage generation - that's the point of skip!
		// this.tests.push({ name: testName, body: testBody });

		// Create Vitest skipped test
		vitestTest.skip(testName, async () => {
			// This won't run, but we need the function for type safety
		});
	}

	/**
	 * Creates a test using the builder API (recommended approach).
	 *
	 * @remarks
	 * The builder API provides a type-safe, fluent interface for writing shell script tests.
	 * Tests are executed in Vitest AND generate BATS files for kcov coverage collection.
	 *
	 * **Builder Features:**
	 * - Command mocking with {@link BatsAssertionBuilder.mock}
	 * - Environment variable manipulation with {@link BatsAssertionBuilder.env}
	 * - Command execution with {@link BatsAssertionBuilder.run}
	 * - Assertions: success, failure, output matching, JSON validation
	 * - Raw bash commands with {@link BatsAssertionBuilder.raw}
	 *
	 * @param testName - Descriptive name for the test
	 * @param testFn - Function that receives a {@link BatsAssertionBuilder} instance
	 *
	 * @example
	 * ```typescript
	 * // Basic test
	 * helper.test("script exists and is executable", (t) => {
	 *   t.raw('[ -f "$SCRIPT" ]');
	 *   t.raw('[ -x "$SCRIPT" ]');
	 * });
	 *
	 * // Test with mocking
	 * helper.test("detects node when installed", (t) => {
	 *   t.mock("node", { "--version": "v20.10.0" });
	 *   t.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
	 *   t.run('"$SCRIPT"');
	 *   t.assert_success();
	 *   t.assert_json_value("node.available", true);
	 *   t.assert_json_value("node.version", "20.10.0");
	 * });
	 *
	 * // Test error handling
	 * helper.test("rejects invalid arguments", (t) => {
	 *   t.run('"$SCRIPT" --invalid-option');
	 *   t.assert_failure();
	 *   t.assert_output({ partial: "Error: Unknown option" });
	 * });
	 * ```
	 *
	 * @see {@link BatsAssertionBuilder} for all available assertion methods
	 */
	test(testName: string, testFn: (builder: BatsAssertionBuilder) => void): void {
		const builder = new BatsAssertionBuilder();

		// Capture stack trace to get line number of test definition
		const stack = new Error().stack || "";
		const stackLines = stack.split("\n");
		let lineNumber: number | undefined;
		let filePath: string | undefined;

		// Parse stack trace to find the caller's location
		// Stack format: "at <function> (<file>:<line>:<col>)" or "at <file>:<line>:<col>"
		for (const line of stackLines) {
			const match = line.match(/at (?:.*? \()?(.+?):(\d+):\d+\)?$/);
			if (match) {
				const [, path, lineNum] = match;
				// Skip internal files (this file, vitest, node_modules)
				if (
					!path.includes("vitest-kcov-bats-helper") &&
					!path.includes("node_modules") &&
					!path.includes("node:") &&
					path.includes(".test.ts")
				) {
					filePath = path;
					lineNumber = Number.parseInt(lineNum, 10);
					break;
				}
			}
		}

		// Execute the test function to build up the assertions
		testFn(builder);

		// Get the generated BATS test body
		const testBody = builder.toString();

		// Store test for coverage generation with location metadata
		this.tests.push({
			name: testName,
			body: testBody,
			...(lineNumber !== undefined ? { lineNumber } : {}),
			...(filePath !== undefined ? { filePath } : {}),
		});

		// Create Vitest test
		vitestTest(testName, async () => {
			await this.runBatsCommands(testBody, testName, lineNumber, filePath);
		});
	}

	/**
	 * Execute BATS commands and handle assertions
	 * Runs with kcov coverage collection if kcov is available
	 */
	private async runBatsCommands(
		commands: string,
		testName?: string,
		testLineNumber?: number,
		testFilePath?: string,
	): Promise<void> {
		// Create a unique subdirectory for this test to isolate it from others
		const testSubdir = await mkdtemp(`${this.tempDir}${sep}test-`);

		// Check if kcov is available for coverage collection
		// Note: kcov may not work on older macOS versions due to SIP restrictions, but works on newer versions
		let useKcov = false;
		try {
			await execAsync("command -v kcov", { encoding: "utf-8" });
			useKcov = true;
		} catch {
			// kcov not available, run without coverage
		}

		// Set up kcov output directory if using kcov
		let kcovOutDir: string | null = null;
		if (useKcov) {
			const scriptName = basename(this.scriptPath, ".sh");
			const testId = `${scriptName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			kcovOutDir = resolve(BatsHelper.getCacheDir(), "kcov", testId);

			// Create kcov output directory
			await mkdir(kcovOutDir, { recursive: true });
		}

		const script = this.createBatsScript(commands, kcovOutDir);

		try {
			await execAsync(script, {
				encoding: "utf-8",
				shell: "/bin/bash", // Use bash instead of default /bin/sh for full PATH support
				cwd: testSubdir,
				env: {
					...process.env,
					SCRIPT: this.scriptPath || "",
					TEST_DIR: testSubdir,
					BATS_TEST_TMPDIR: testSubdir, // Set BATS temp directory for tests
					KCOV_OUT: kcovOutDir || "",
				},
			});
		} catch (error) {
			const err = error as {
				code?: number;
				stdout?: string;
				stderr?: string;
				message?: string;
			};
			const errorMsg = err.stderr || err.stdout || err.message || "Unknown error";

			// Build context for error message
			const _scriptName = BatsHelper.getDisplayName(this.scriptPath);

			// Use captured test file path or derive from script path
			const derivedTestFilePath =
				testFilePath || this.scriptPath.replace(/scripts\/.*?([^/]+)\.sh$/, "__tests__/$1.test.ts");

			// Create clickable links for file paths (use short names for display text)
			const testFileUrl = testLineNumber
				? `vscode://file${derivedTestFilePath}:${testLineNumber}`
				: `vscode://file${derivedTestFilePath}`;
			const testFileShortName = BatsHelper.getTestDisplayName(derivedTestFilePath);
			const testFileDisplay = testLineNumber ? `${testFileShortName}:${testLineNumber}` : testFileShortName;
			const testFileLink = this.linker.create(testFileUrl, testFileDisplay);

			const scriptShortName = BatsHelper.getDisplayName(this.scriptPath);
			const scriptPathLink = this.linker.create(`vscode://file${this.scriptPath}`, scriptShortName);

			// Build context message: test name first, then test file, then script
			let contextMsg = testName
				? `"${testName}"\ntest: ${testFileLink}\nscript: ${scriptPathLink}`
				: `test: ${testFileLink}\nscript: ${scriptPathLink}`;

			// Try to extract line number from bash error messages
			// Formats: "/path/to/script.sh: line 122: error" or "script.sh: line 122: error"
			// Use a more specific pattern that looks for ": line \d+:" to avoid false matches
			const bashErrorMatch = errorMsg.match(/([^\s:]+\.sh): line (\d+): (.+?)(?:\n|$)/);
			if (bashErrorMatch) {
				const [, scriptPath, lineNum, bashError] = bashErrorMatch;
				// Only show line number if it's from our script (not from bash internals)
				if (scriptPath.includes(basename(this.scriptPath))) {
					const lineDisplayText = `${scriptShortName}:${lineNum}`;
					const lineLink = this.linker.create(`vscode://file${this.scriptPath}:${lineNum}`, lineDisplayText);
					contextMsg += `\nerror: ${lineLink}: ${bashError.trim()}`;
				}
			}

			// Try to parse assertions in the format "Expected X to equal Y, got: Z"
			// or "Expected X but got Y" to use Vitest's expect API for better error messages
			const assertionMatch = errorMsg.match(/Expected (.*?) to equal ['"]([^'"]+)['"], got: (.+)/);
			const successMatch = errorMsg.match(/Expected success but got exit code (\d+)/);
			const failureMatch = errorMsg.match(/Expected failure but got exit code (\d+)/);
			const exitMatch = errorMsg.match(/Expected exit code (\d+) but got (\d+)\nOutput: (.+)/s);
			const containsMatch = errorMsg.match(/Expected output to contain: (.+)\nActual output: (.+)/s);

			if (assertionMatch) {
				// Parse "Expected JSON path 'x' to equal 'y', got: z"
				const [, path, expected, actual] = assertionMatch;
				// path already contains "JSON path 'key'" so just use it directly
				expect(
					actual.trim(),
					`${contextMsg}\nassert_json_value: ${path}: expected '${actual.trim()}' to be '${expected}'`,
				).toBe(expected);
			} else if (successMatch) {
				// Parse "Expected success but got exit code X"
				const exitCode = Number.parseInt(successMatch[1], 10);
				expect(exitCode, `${contextMsg}\nassert_success: expected exit code 0`).toBe(0);
			} else if (failureMatch) {
				// Parse "Expected failure but got exit code X"
				const exitCode = Number.parseInt(failureMatch[1], 10);
				expect(exitCode, `${contextMsg}\nassert_failure: expected non-zero exit code`).not.toBe(0);
			} else if (exitMatch) {
				// Parse "Expected exit code X but got Y\nOutput: Z"
				const expectedCode = Number.parseInt(exitMatch[1], 10);
				const actualCode = Number.parseInt(exitMatch[2], 10);
				const output = exitMatch[3].trim();
				expect(actualCode, `${contextMsg}\nassert_exit: expected exit code ${expectedCode}\nOutput: ${output}`).toBe(
					expectedCode,
				);
			} else if (containsMatch) {
				// Parse "Expected output to contain: X\nActual output: Y"
				const [, expected, actual] = containsMatch;
				expect(
					actual.trim(),
					`${contextMsg}\nassert_output: expected output to contain '${expected.trim()}'`,
				).toContain(expected.trim());
			} else {
				// Generic error - use expect.fail() with full context
				expect.fail(`${contextMsg}\n\n${errorMsg}`);
			}
		} finally {
			// Clean up test subdirectory after test completes
			await rm(testSubdir, { recursive: true, force: true });
		}
	}

	/**
	 * Create a bash script from BATS commands
	 * Optionally wraps script execution with kcov for coverage collection
	 * Note: kcov may not work on older macOS versions due to SIP restrictions
	 */
	private createBatsScript(commands: string, kcovOutDir: string | null = null): string {
		const useKcov = kcovOutDir !== null && kcovOutDir !== "";

		// Calculate the include pattern for kcov - use project root
		// This ensures we only track files in the project, not system files
		const includePattern = this.findProjectRoot(this.scriptPath);

		// Get BATS library paths from environment (set by provider during dependency check)
		const batsMockPath = process.env.BATS_MOCK_PATH;
		if (!batsMockPath) {
			throw new Error(
				"BATS_MOCK_PATH environment variable not set. Provider should have set this during dependency check.",
			);
		}
		const batsSupportPath = process.env.BATS_SUPPORT_PATH;
		if (!batsSupportPath) {
			throw new Error(
				"BATS_SUPPORT_PATH environment variable not set. Provider should have set this during dependency check.",
			);
		}
		const batsAssertPath = process.env.BATS_ASSERT_PATH;
		if (!batsAssertPath) {
			throw new Error(
				"BATS_ASSERT_PATH environment variable not set. Provider should have set this during dependency check.",
			);
		}

		return `#!/usr/bin/env bash
set -eo pipefail

# Load bats-support library
source "${batsSupportPath}/load.bash"

# Load bats-assert library
source "${batsAssertPath}/load.bash"

# Load bats-mock for command stubbing
export BATS_TMPDIR=\${BATS_TMPDIR:-/tmp}
source "${batsMockPath}/stub.bash"

# Create bash wrapper function for non-executable scripts
# This allows tests to run scripts without the executable bit set
run_script() {
	bash "$SCRIPT" "$@"
}

# BATS helper functions - emulate BATS run() and skip() behavior
run() {
	set +e
	${
		useKcov
			? `
	# Check if we're running the script under test - if so, try kcov
	# Note: kcov may not work on older macOS versions due to SIP restrictions
	local use_kcov_for_this_command=false
	local use_run_script_wrapper=false
	if [ -n "\${KCOV_OUT}" ] && command -v kcov > /dev/null 2>&1; then
		# Check if running the script directly
		if [ "$#" -gt 0 ] && [ "$1" = "$SCRIPT" ]; then
			use_kcov_for_this_command=true
		# Check if running via run_script wrapper (for non-executable scripts)
		elif [ "$#" -gt 0 ] && [ "$1" = "run_script" ]; then
			use_kcov_for_this_command=true
			use_run_script_wrapper=true
		fi
	fi

	if [ "$use_kcov_for_this_command" = true ]; then
		# Try to wrap command with kcov, but fall back to normal execution if it fails
		export COVERAGE_RUN=1

		if [ "$use_run_script_wrapper" = true ]; then
			# When using run_script, shift off the function name and run with bash interpreter
			shift
			# First run: Execute script without kcov to get real exit code and output
			output=$(bash "$SCRIPT" "$@" 2>&1)
			status=$?

			# Debug: Check script permissions before kcov
			echo "[DEBUG run()] Checking script permissions: $SCRIPT" >&2
			ls -l "$SCRIPT" >&2
			if [ -x "$SCRIPT" ]; then
				echo "[DEBUG run()] ✓ Script is executable" >&2
			else
				echo "[DEBUG run()] ✗ WARNING: Script is NOT executable!" >&2
			fi

			# Second run: Execute with kcov for coverage (discard output, ignore exit code)
			# Note: Script permissions are managed by BatsHelper.describe() beforeAll/afterAll hooks
			echo "[DEBUG run()] Running kcov: kcov --skip-solibs --include-pattern=${includePattern} ... \${KCOV_OUT} $SCRIPT $@" >&2
			echo "[DEBUG run()] KCOV_OUT=\${KCOV_OUT}" >&2
			echo "[DEBUG run()] include_pattern=${includePattern}" >&2
			local kcov_output kcov_exit_code
			kcov_exit_code=0
			kcov_output=$(kcov \
				--skip-solibs \
				--include-pattern="${includePattern}" \
				--exclude-line='^#!/,^set -euo pipefail,^set -eo pipefail,^readonly SCRIPT_' \
				--exclude-region='# LCOV_EXCL_START:# LCOV_EXCL_STOP' \
				"\${KCOV_OUT}" "$SCRIPT" "$@" 2>&1) || kcov_exit_code=$?
			echo "[DEBUG run()] kcov exit code: $kcov_exit_code" >&2
			if [ "$kcov_exit_code" -ne 0 ]; then
				echo "Warning: kcov failed with exit code $kcov_exit_code for $SCRIPT" >&2
				echo "kcov output: $kcov_output" >&2
			else
				echo "[DEBUG run()] kcov succeeded!" >&2
				# Show what files were created
				if [ -d "\${KCOV_OUT}" ]; then
					echo "[DEBUG run()] kcov output directory contents:" >&2
					ls -la "\${KCOV_OUT}" | head -20 >&2
				fi
			fi
		else
			# Direct script execution
			# First run: Execute script without kcov to get real exit code and output
			output=$("$@" 2>&1)
			status=$?

			echo "[DEBUG run()] Running kcov for direct execution: $@" >&2
			echo "[DEBUG run()] include_pattern=${includePattern}" >&2
			# Second run: Execute with kcov for coverage (discard output, ignore exit code)
			local kcov_output kcov_exit_code
			kcov_exit_code=0
			kcov_output=$(kcov \
				--skip-solibs \
				--include-pattern="${includePattern}" \
				--exclude-line='^#!/,^set -euo pipefail,^set -eo pipefail,^readonly SCRIPT_' \
				--exclude-region='# LCOV_EXCL_START:# LCOV_EXCL_STOP' \
				"\${KCOV_OUT}" "$@" 2>&1) || kcov_exit_code=$?
			echo "[DEBUG run()] kcov exit code: $kcov_exit_code" >&2
			if [ "$kcov_exit_code" -ne 0 ]; then
				echo "Warning: kcov failed with exit code $kcov_exit_code for $SCRIPT" >&2
				echo "kcov output: $kcov_output" >&2
			else
				echo "[DEBUG run()] kcov succeeded" >&2
			fi
		fi

		unset COVERAGE_RUN
	else
		# Run normally without kcov
		# Check if the first argument is run_script (for non-executable scripts)
		if [ "$#" -gt 0 ] && [ "$1" = "run_script" ]; then
			# Execute with bash interpreter
			shift
			output=$(bash "$SCRIPT" "$@" 2>&1)
			status=$?
		else
			# Standard command execution
			output=$("$@" 2>&1)
			status=$?
		fi
	fi
	`
			: `
	output=$("$@" 2>&1)
	status=$?
	`
	}
	set -e
}

skip() {
	# Skip function - exit with code 0 (success) to skip test
	echo "SKIPPED: $1"
	exit 0
}

# bats-assert helper functions - simplified implementations
assert_success() {
	if [ "$status" -ne 0 ]; then
		echo "Expected success but got exit code $status"
		echo "Output: $output"
		exit 1
	fi
}

assert_failure() {
	local expected_status=\${1:-}
	if [ "$status" -eq 0 ]; then
		echo "Expected failure but got exit code $status"
		echo "Output: $output"
		exit 1
	fi
	if [ -n "$expected_status" ] && [ "$status" -ne "$expected_status" ]; then
		echo "Expected exit code $expected_status but got $status"
		echo "Output: $output"
		exit 1
	fi
}

assert_exit() {
	local expected_code="$1"
	if [ "$status" -ne "$expected_code" ]; then
		echo "Expected exit code $expected_code but got $status"
		echo "Output: $output"
		exit 1
	fi
}

assert_equal() {
	local actual="$1"
	local expected="$2"
	if [ "$actual" != "$expected" ]; then
		echo "Expected: $expected"
		echo "Actual:   $actual"
		exit 1
	fi
}

assert_output() {
	local mode=""
	local expected=""

	if [ "$1" = "--partial" ]; then
		mode="partial"
		expected="$2"
	elif [ "$1" = "--regexp" ]; then
		mode="regexp"
		expected="$2"
	else
		expected="$1"
	fi

	if [ "$mode" = "partial" ]; then
		if ! echo "$output" | grep -qF "$expected"; then
			echo "Expected output to contain: $expected"
			echo "Actual output: $output"
			exit 1
		fi
	elif [ "$mode" = "regexp" ]; then
		if ! echo "$output" | grep -qE "$expected"; then
			echo "Expected output to match regex: $expected"
			echo "Actual output: $output"
			exit 1
		fi
	else
		if [ "$output" != "$expected" ]; then
			echo "Expected output: $expected"
			echo "Actual output: $output"
			exit 1
		fi
	fi
}

refute_output() {
	local mode=""
	local pattern=""

	if [ $# -eq 0 ]; then
		if [ -n "$output" ]; then
			echo "Expected empty output but got: $output"
			exit 1
		fi
		return
	fi

	if [ "$1" = "--partial" ]; then
		mode="partial"
		pattern="$2"
	elif [ "$1" = "--regexp" ]; then
		mode="regexp"
		pattern="$2"
	fi

	if [ "$mode" = "partial" ]; then
		if echo "$output" | grep -qF "$pattern"; then
			echo "Expected output NOT to contain: $pattern"
			echo "Actual output: $output"
			exit 1
		fi
	elif [ "$mode" = "regexp" ]; then
		if echo "$output" | grep -qE "$pattern"; then
			echo "Expected output NOT to match regex: $pattern"
			echo "Actual output: $output"
			exit 1
		fi
	fi
}

assert_line() {
	local mode=""
	local line_num=""
	local expected=""

	if [ "$1" = "--index" ]; then
		line_num="$2"
		expected="$3"
		local actual_line=$(echo "$output" | sed -n "$((line_num + 1))p")
		if [ "$actual_line" != "$expected" ]; then
			echo "Expected line $line_num: $expected"
			echo "Actual line $line_num: $actual_line"
			exit 1
		fi
	elif [ "$1" = "--partial" ]; then
		expected="$2"
		if ! echo "$output" | grep -qF "$expected"; then
			echo "Expected a line containing: $expected"
			echo "Actual output: $output"
			exit 1
		fi
	elif [ "$1" = "--regexp" ]; then
		expected="$2"
		if ! echo "$output" | grep -qE "$expected"; then
			echo "Expected a line matching regex: $expected"
			echo "Actual output: $output"
			exit 1
		fi
	else
		expected="$1"
		if ! echo "$output" | grep -qF "$expected"; then
			echo "Expected a line: $expected"
			echo "Actual output: $output"
			exit 1
		fi
	fi
}

refute_line() {
	local mode=""
	local line_num=""
	local pattern=""

	if [ "$1" = "--index" ]; then
		line_num="$2"
		pattern="$3"
		local actual_line=$(echo "$output" | sed -n "$((line_num + 1))p")
		if [ "$actual_line" = "$pattern" ]; then
			echo "Expected line $line_num NOT to be: $pattern"
			exit 1
		fi
	elif [ "$1" = "--partial" ]; then
		pattern="$2"
		if echo "$output" | grep -qF "$pattern"; then
			echo "Expected NO line containing: $pattern"
			echo "Actual output: $output"
			exit 1
		fi
	elif [ "$1" = "--regexp" ]; then
		pattern="$2"
		if echo "$output" | grep -qE "$pattern"; then
			echo "Expected NO line matching regex: $pattern"
			echo "Actual output: $output"
			exit 1
		fi
	else
		pattern="$1"
		if echo "$output" | grep -qF "$pattern"; then
			echo "Expected NO line: $pattern"
			echo "Actual output: $output"
			exit 1
		fi
	fi
}

assert() {
	if ! eval "$@"; then
		echo "Assertion failed: $@"
		exit 1
	fi
}

refute() {
	if eval "$@"; then
		echo "Refutation failed: $@"
		exit 1
	fi
}

# Test commands (with set -e, return statements will exit the script)
${commands}
`;
	}
}
