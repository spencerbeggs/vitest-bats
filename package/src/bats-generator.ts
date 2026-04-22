import { dirname } from "node:path";
import type { CommandRecord } from "./runtime.js";

export interface BatsDeps {
	batsPath: string;
	batsSupportPath: string;
	batsAssertPath: string;
	batsMockPath: string;
}

export interface KcovConfig {
	kcovPath: string;
	outputDir: string;
}

export function generateBatsFile(
	scriptPath: string,
	testName: string,
	commands: CommandRecord[],
	deps: BatsDeps,
	kcov?: KcovConfig,
): string {
	const lines: string[] = [];
	const includePattern = dirname(scriptPath);

	lines.push(`#!${deps.batsPath}`);
	lines.push("");
	lines.push("setup() {");
	lines.push(`    load '${deps.batsSupportPath}/load.bash'`);
	lines.push(`    load '${deps.batsAssertPath}/load.bash'`);
	lines.push(`    load '${deps.batsMockPath}/stub.bash'`);
	lines.push(`    SCRIPT="${scriptPath}"`);
	if (kcov) {
		lines.push(`    KCOV_OUT="${kcov.outputDir}"`);
		lines.push('    mkdir -p "$KCOV_OUT"');
	}
	lines.push("}");
	lines.push("");
	lines.push(`@test "${testName}" {`);

	let pendingEnv: Record<string, string> = {};
	let pendingFlags = "";

	for (const cmd of commands) {
		switch (cmd.type) {
			case "env":
				pendingEnv = { ...pendingEnv, ...(cmd.vars as Record<string, string>) };
				break;

			case "flags":
				pendingFlags = cmd.value as string;
				break;

			case "run": {
				const args = cmd.args as string[];
				const envPrefix = Object.entries(pendingEnv)
					.map(([k, v]) => `${k}="${v}"`)
					.join(" ");
				const flagsSuffix = pendingFlags ? ` ${pendingFlags}` : "";
				const cmdStr = args.length > 0 ? args[0] : '"$SCRIPT"';
				const fullCmd = cmdStr + flagsSuffix;

				// When kcov is enabled and the command invokes $SCRIPT, wrap with kcov
				const isScriptRun = fullCmd.includes("$SCRIPT");
				if (kcov && isScriptRun) {
					const kcovCmd =
						`"${kcov.kcovPath}" --skip-solibs` +
						` --include-pattern="${includePattern}"` +
						` --exclude-line="^#!/,^set -euo pipefail,^set -eo pipefail"` +
						` "$KCOV_OUT" ${fullCmd}`;
					if (envPrefix) {
						lines.push(`    ${envPrefix} run ${kcovCmd}`);
					} else {
						lines.push(`    run ${kcovCmd}`);
					}
				} else if (envPrefix) {
					lines.push(`    ${envPrefix} run ${fullCmd}`);
				} else {
					lines.push(`    run ${fullCmd}`);
				}
				pendingEnv = {};
				pendingFlags = "";
				break;
			}

			case "raw":
				lines.push(`    ${cmd.cmd}`);
				break;

			case "assert_success":
				lines.push("    assert_success");
				break;

			case "assert_failure":
				if (cmd.code !== undefined && cmd.code !== null) {
					lines.push(`    assert_failure ${cmd.code}`);
				} else {
					lines.push("    assert_failure");
				}
				break;

			case "assert_output": {
				const opts = cmd.opts as { partial?: string; regexp?: string; line?: string; index?: number };
				if (opts.partial) {
					lines.push(`    assert_output --partial '${opts.partial}'`);
				} else if (opts.regexp) {
					lines.push(`    assert_output --regexp '${opts.regexp}'`);
				} else if (opts.line !== undefined) {
					lines.push(`    assert_output '${opts.line}'`);
				}
				break;
			}

			case "assert_line": {
				const opts = cmd.opts as { partial?: string; regexp?: string; index?: number };
				const expected = cmd.expected as string | undefined;
				const parts = ["assert_line"];
				if (opts.index !== undefined) {
					parts.push("--index", String(opts.index));
				}
				if (opts.partial) {
					parts.push("--partial", `'${opts.partial}'`);
				} else if (opts.regexp) {
					parts.push("--regexp", `'${opts.regexp}'`);
				} else if (expected) {
					parts.push(`'${expected}'`);
				}
				lines.push(`    ${parts.join(" ")}`);
				break;
			}

			case "assert":
				lines.push(`    ${cmd.expression}`);
				break;

			case "assert_json_value": {
				const jqPath = cmd.path as string;
				const expected = cmd.expected;
				lines.push("    local json_val");
				lines.push(`    json_val=$(echo "$output" | jq -r '.${jqPath}')`);
				lines.push(`    [ "$json_val" = '${expected}' ]`);
				break;
			}

			case "exit":
				lines.push(`    [ "$status" -eq ${cmd.code} ]`);
				break;

			case "mock": {
				const mockCmd = cmd.cmd as string;
				const responses = cmd.responses as Record<string, string>;
				const entries = Object.entries(responses);
				if (entries.length === 0) {
					lines.push(`    stub ${mockCmd}`);
				} else {
					const patterns = entries.map(([flag, response]) => `"${flag} : ${response}"`).join(" ");
					lines.push(`    stub ${mockCmd} ${patterns}`);
				}
				break;
			}
		}
	}

	lines.push("}");
	lines.push("");

	return lines.join("\n");
}
