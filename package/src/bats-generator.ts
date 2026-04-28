import { dirname } from "node:path";

export interface BatsDeps {
	batsPath: string;
	batsSupportPath: string;
}

export interface KcovConfig {
	kcovPath: string;
	outputDir: string;
}

export interface StubSpec {
	cmd: string;
	responses: Record<string, string>;
}

export type RunMode = { kind: "args" } | { kind: "shell"; expression: string };

export interface GenerateInput {
	scriptPath: string;
	args: string[];
	env: Record<string, string>;
	flags: string;
	stubs: StubSpec[];
	recorderDir: string;
	deps: BatsDeps;
	mode: RunMode;
	kcov?: KcovConfig;
}

function shellQuote(s: string): string {
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function singleQuoteForBash(s: string): string {
	return `'${s.replace(/'/g, `'"'"'`)}'`;
}

function patternToBashGlob(pattern: string): string {
	// Convert a user pattern like `remote get-url *` into a bash [[ ]]-
	// compatible glob: literal segments get double-quoted; glob chars
	// (* ? [ ]) stay unquoted. Result for `remote get-url *` is
	// `"remote get-url "*`. Result for `status` is `"status"`.
	let result = "";
	let inLiteral = false;
	for (const ch of pattern) {
		const isGlob = ch === "*" || ch === "?" || ch === "[" || ch === "]";
		if (isGlob) {
			if (inLiteral) {
				result += '"';
				inLiteral = false;
			}
			result += ch;
		} else {
			if (!inLiteral) {
				result += '"';
				inLiteral = true;
			}
			// Escape characters that break the double-quoted string. The
			// supported input is bash-glob-ish text plus spaces; backslashes,
			// dollars, and double-quotes need escaping so they don't activate
			// shell expansion or terminate the literal.
			if (ch === "\\" || ch === '"' || ch === "$" || ch === "`") {
				result += `\\${ch}`;
			} else {
				result += ch;
			}
		}
	}
	if (inLiteral) result += '"';
	return result;
}

function buildRecorderShim(stub: StubSpec, indent: string): string[] {
	// Self-contained mock: records every call to calls.jsonl, then matches
	// the call args against configured patterns via [[ "$*" == GLOB ]] and
	// evals the matched response. If no pattern matches, exits 1.
	//
	// Unquoted heredoc so $VBATS_RECORDER expands at shim-creation time.
	// Runtime references ($@, $*, $cmd, $ARGS) are escaped so they stay
	// literal in the written shim.
	//
	// We deliberately do NOT depend on bats-mock's binstub: under kcov
	// instrumentation the exec chain into binstub fails (ptrace + set -e
	// interaction), and embedding the responses directly means tests don't
	// need the mocked binary to exist on the system at all.
	const lines: string[] = [
		`${indent}cat > "$VBATS_RECORDER/bin/${stub.cmd}" <<__VBATS_EOF__`,
		`#!/usr/bin/env bash`,
		`jq -nc --arg cmd "${stub.cmd}" --args '{cmd: \\$cmd, args: \\$ARGS.positional}' -- "\\$@" \\\\`,
		`  >> "$VBATS_RECORDER/calls.jsonl"`,
	];
	const entries = Object.entries(stub.responses);
	if (entries.length === 0) {
		// No responses configured: just record and succeed silently.
		lines.push(`exit 0`);
	} else {
		const arms = entries.map(([pattern, response], i) => {
			const keyword = i === 0 ? "if" : "elif";
			return [
				`${keyword} [[ "\\$*" == ${patternToBashGlob(pattern)} ]]; then`,
				`    eval ${singleQuoteForBash(response)}`,
				`    exit \\$?`,
			];
		});
		for (const arm of arms) {
			for (const line of arm) lines.push(line);
		}
		lines.push(`else`);
		lines.push(`    echo "vitest-bats: no mock pattern matched for '${stub.cmd} \\$*'" >&2`);
		lines.push(`    exit 1`);
		lines.push(`fi`);
	}
	lines.push(`__VBATS_EOF__`);
	lines.push(`${indent}chmod +x "$VBATS_RECORDER/bin/${stub.cmd}"`);
	return lines;
}

function buildRunCommand(
	scriptPath: string,
	args: string[],
	flags: string,
	mode: RunMode,
	kcov: KcovConfig | undefined,
): string {
	const wrapWithKcov = (target: string): string => {
		if (!kcov) return target;
		const includePattern = dirname(scriptPath);
		return [
			shellQuote(kcov.kcovPath),
			"--skip-solibs",
			// singleQuoteForBash so paths containing $ or backtick stay literal.
			`--include-pattern=${singleQuoteForBash(includePattern)}`,
			`--exclude-line="^#!/,^set -euo pipefail,^set -eo pipefail"`,
			`"$KCOV_OUT"`,
			target,
		].join(" ");
	};

	if (mode.kind === "shell") {
		return `bash -c ${singleQuoteForBash(mode.expression)}`;
	}

	const quotedArgs = args.map(shellQuote).join(" ");
	const flagsSuffix = flags ? ` ${flags}` : "";
	const target = `"$SCRIPT"${quotedArgs ? ` ${quotedArgs}` : ""}${flagsSuffix}`;
	return wrapWithKcov(target);
}

export function generateBatsFile(input: GenerateInput): string {
	const { scriptPath, args, env, flags, stubs, recorderDir, deps, mode, kcov } = input;

	const lines: string[] = [];

	lines.push(`#!${deps.batsPath}`);
	lines.push("");
	lines.push("setup() {");
	// bats `load` argument: bats-support's path comes from a curated env-var
	// detection so we know it doesn't contain shell metacharacters. Single-
	// quoted is sufficient (no expansion).
	lines.push(`    load '${deps.batsSupportPath}/load.bash'`);
	// Export so subshells (bash -c, recorder shim binaries) inherit them.
	// Use singleQuoteForBash so values containing $, backtick, or other
	// shell-active characters stay literal.
	lines.push(`    export SCRIPT=${singleQuoteForBash(scriptPath)}`);
	lines.push(`    export VBATS_RECORDER=${singleQuoteForBash(recorderDir)}`);
	lines.push('    mkdir -p "$VBATS_RECORDER/bin"');

	if (kcov) {
		lines.push(`    export KCOV_OUT=${singleQuoteForBash(kcov.outputDir)}`);
		lines.push('    mkdir -p "$KCOV_OUT"');
	}

	// Self-contained recorder shims — no bats-mock dependency. Each shim
	// records the call to calls.jsonl and emits the configured response
	// directly via bash case-pattern matching. Mocked binaries don't need
	// to exist on the system at all.
	for (const stub of stubs) {
		for (const shimLine of buildRecorderShim(stub, "    ")) {
			lines.push(shimLine);
		}
	}
	if (stubs.length > 0) {
		lines.push('    PATH="$VBATS_RECORDER/bin:$PATH"');
	}

	lines.push("}");
	lines.push("");
	lines.push(`@test "_run_" {`);

	const envEntries = Object.entries(env);
	// Shell-quote env values so values containing ", $, \, or ` survive
	// without breaking the bats file's syntax or expanding unintended vars.
	const envPrefix = envEntries.length > 0 ? `${envEntries.map(([k, v]) => `${k}=${shellQuote(v)}`).join(" ")} ` : "";

	const target = buildRunCommand(scriptPath, args, flags, mode, kcov);
	lines.push(`    ${envPrefix}run --separate-stderr ${target}`);

	// Pipe base64 through `tr -d '\n'` to strip wrap newlines. GNU coreutils
	// base64 wraps at 76 columns by default (BSD/macOS doesn't); without the
	// strip, multi-line base64 gets read back as just the first line, which
	// truncates the captured output/stderr. `tr -d '\n'` is portable.
	lines.push("    {");
	lines.push('        echo "status:$status"');
	lines.push("        echo \"output_b64:$(printf '%s' \"$output\" | base64 | tr -d '\\n')\"");
	lines.push("        echo \"stderr_b64:$(printf '%s' \"$stderr\" | base64 | tr -d '\\n')\"");
	lines.push('    } > "$VBATS_RECORDER/result.txt"');

	lines.push("}");
	lines.push("");

	return lines.join("\n");
}
