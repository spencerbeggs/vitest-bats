import { describe, expect, test } from "vitest";
import type { GenerateInput } from "../src/bats-generator.js";
import { generateBatsFile } from "../src/bats-generator.js";

const baseDeps = {
	batsPath: "/opt/homebrew/bin/bats",
	batsSupportPath: "/opt/homebrew/lib/bats-support",
};

const baseInput: GenerateInput = {
	scriptPath: "/path/to/hello.sh",
	args: [],
	env: {},
	flags: "",
	stubs: [],
	recorderDir: "/tmp/recorder-xyz",
	deps: baseDeps,
	mode: { kind: "args" },
};

describe("generateBatsFile", () => {
	test("emits shebang and bats-support load", () => {
		const out = generateBatsFile(baseInput);
		expect(out).toContain("#!/opt/homebrew/bin/bats");
		expect(out).toContain("load '/opt/homebrew/lib/bats-support/load.bash'");
	});

	test("does NOT load bats-mock (we own the mocking)", () => {
		const out = generateBatsFile({
			...baseInput,
			stubs: [{ cmd: "git", responses: { "remote get-url *": "echo hi" } }],
		});
		expect(out).not.toContain("bats-mock");
	});

	test("does NOT load bats-assert (assertions moved to JS)", () => {
		const out = generateBatsFile(baseInput);
		expect(out).not.toContain("bats-assert");
	});

	test("emits SCRIPT and VBATS_RECORDER variables (single-quoted for safety)", () => {
		const out = generateBatsFile({ ...baseInput, recorderDir: "/tmp/abc" });
		expect(out).toContain("SCRIPT='/path/to/hello.sh'");
		expect(out).toContain("VBATS_RECORDER='/tmp/abc'");
	});

	test("paths containing $ or backtick are emitted literally (not expanded)", () => {
		const out = generateBatsFile({
			...baseInput,
			scriptPath: "/home/user/my$projects/hello.sh",
			recorderDir: "/tmp/back`tick",
		});
		expect(out).toContain("SCRIPT='/home/user/my$projects/hello.sh'");
		expect(out).toContain("VBATS_RECORDER='/tmp/back`tick'");
	});

	test("emits run --separate-stderr on script with no args", () => {
		const out = generateBatsFile(baseInput);
		expect(out).toMatch(/run --separate-stderr "\$SCRIPT"/);
	});

	test("emits run with quoted args (mode: args)", () => {
		const out = generateBatsFile({
			...baseInput,
			args: ["--name", "Alice Smith", "--json"],
		});
		expect(out).toMatch(/run --separate-stderr "\$SCRIPT" "--name" "Alice Smith" "--json"/);
	});

	test("emits shell expression unmodified (mode: shell)", () => {
		const out = generateBatsFile({
			...baseInput,
			mode: { kind: "shell", expression: 'echo input | "$SCRIPT"' },
		});
		expect(out).toMatch(/run --separate-stderr bash -c 'echo input \| "\$SCRIPT"'/);
	});

	test("emits env prefix on run", () => {
		const out = generateBatsFile({
			...baseInput,
			env: { FOO: "bar baz", BAZ: "qux" },
		});
		expect(out).toMatch(/FOO="bar baz" BAZ="qux" run --separate-stderr/);
	});

	test("emits flags after script path", () => {
		const out = generateBatsFile({ ...baseInput, flags: "-j" });
		expect(out).toMatch(/run --separate-stderr "\$SCRIPT" -j/);
	});

	test("writes a self-contained recorder shim per stubbed cmd", () => {
		const out = generateBatsFile({
			...baseInput,
			stubs: [{ cmd: "git", responses: { "remote get-url *": "echo https://example.com" } }],
		});
		expect(out).toContain('mkdir -p "$VBATS_RECORDER/bin"');
		expect(out).toContain("$VBATS_RECORDER/bin/git");
		expect(out).toContain('jq -nc --arg cmd "git"');
		expect(out).toContain('PATH="$VBATS_RECORDER/bin:$PATH"');
		// Pattern is emitted as [[ ]]-style match with proper quoting:
		// literal segments quoted, glob char unquoted.
		expect(out).toContain('if [[ "\\$*" == "remote get-url "* ]]; then');
		expect(out).toContain("eval 'echo https://example.com'");
	});

	test("shim with no responses records and exits 0", () => {
		const out = generateBatsFile({
			...baseInput,
			stubs: [{ cmd: "curl", responses: {} }],
		});
		expect(out).toContain("$VBATS_RECORDER/bin/curl");
		expect(out).toContain('jq -nc --arg cmd "curl"');
		expect(out).toContain("exit 0");
	});

	test("shim with multiple patterns emits if/elif chain", () => {
		const out = generateBatsFile({
			...baseInput,
			stubs: [
				{
					cmd: "git",
					responses: {
						status: "echo nothing",
						"remote get-url *": "echo https://example.com",
					},
				},
			],
		});
		expect(out).toContain('if [[ "\\$*" == "status" ]]; then');
		expect(out).toContain('elif [[ "\\$*" == "remote get-url "* ]]; then');
		expect(out).toContain("eval 'echo nothing'");
		expect(out).toContain("eval 'echo https://example.com'");
	});

	test("emits result.txt write with base64-encoded output and stderr", () => {
		const out = generateBatsFile(baseInput);
		expect(out).toContain('echo "status:$status"');
		expect(out).toContain("printf '%s' \"$output\" | base64");
		expect(out).toContain("printf '%s' \"$stderr\" | base64");
		expect(out).toContain('> "$VBATS_RECORDER/result.txt"');
	});

	test("kcov wraps the run command when kcov config is provided", () => {
		const out = generateBatsFile({
			...baseInput,
			kcov: {
				kcovPath: "/usr/bin/kcov",
				outputDir: "/cache/kcov/hello-1",
			},
		});
		expect(out).toContain("KCOV_OUT='/cache/kcov/hello-1'");
		expect(out).toContain('mkdir -p "$KCOV_OUT"');
		expect(out).toMatch(/run --separate-stderr "\/usr\/bin\/kcov" --skip-solibs/);
		expect(out).toContain("--include-pattern='/path/to'");
		expect(out).toContain('"$KCOV_OUT" "$SCRIPT"');
	});

	test("kcov is omitted when config is undefined", () => {
		const out = generateBatsFile(baseInput);
		expect(out).not.toContain("kcov");
		expect(out).not.toContain("KCOV_OUT");
	});
});
