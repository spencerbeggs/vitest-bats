export interface CommandRecord {
	type: string;
	[key: string]: unknown;
}

const REGISTRY_KEY = "__vitest_bats_registry__";

// Use globalThis so the registry is shared across Vite module runner contexts
// (test files and the custom runner get separate module instances)
const registry: Map<string, ScriptBuilder> =
	((globalThis as Record<string, unknown>)[REGISTRY_KEY] as Map<string, ScriptBuilder>) ??
	(() => {
		const map = new Map<string, ScriptBuilder>();
		(globalThis as Record<string, unknown>)[REGISTRY_KEY] = map;
		return map;
	})();

export class ScriptBuilder {
	readonly path: string;
	readonly name: string;
	readonly fromTransform: boolean;
	commands: CommandRecord[] = [];

	constructor(path: string, name: string, fromTransform = false) {
		this.path = path;
		this.name = name;
		this.fromTransform = fromTransform;
	}

	run(command?: string): this {
		this.commands.push({ type: "run", args: command ? [command] : [] });
		return this;
	}

	raw(cmd: string): this {
		this.commands.push({ type: "raw", cmd });
		return this;
	}

	env(vars: Record<string, string>): this {
		this.commands.push({ type: "env", vars });
		return this;
	}

	mock(cmd: string, responses: Record<string, string>): this {
		this.commands.push({ type: "mock", cmd, responses });
		return this;
	}

	flags(value: string): this {
		this.commands.push({ type: "flags", value });
		return this;
	}

	assert_success(): this {
		this.commands.push({ type: "assert_success" });
		return this;
	}

	assert_failure(code?: number): this {
		this.commands.push({ type: "assert_failure", code });
		return this;
	}

	assert_output(opts: { partial?: string; regexp?: string; line?: string; index?: number } | string): this {
		this.commands.push({
			type: "assert_output",
			opts: typeof opts === "string" ? { line: opts } : opts,
		});
		return this;
	}

	assert_line(opts: { partial?: string; regexp?: string; index?: number } | string, expected?: string): this {
		this.commands.push({
			type: "assert_line",
			opts: typeof opts === "string" ? {} : opts,
			expected: typeof opts === "string" ? (expected ?? opts) : expected,
		});
		return this;
	}

	assert_json_value(path: string, expected: string | number | boolean | null): this {
		this.commands.push({ type: "assert_json_value", path, expected });
		return this;
	}

	assert(expression: string): this {
		this.commands.push({ type: "assert", expression });
		return this;
	}

	exit(expectedCode: number): this {
		this.commands.push({ type: "exit", code: expectedCode });
		return this;
	}

	reset(): void {
		this.commands = [];
	}
}

export function createBatsScript(path: string, name: string, fromTransform = false): ScriptBuilder {
	const existing = registry.get(path);
	if (existing) {
		existing.reset();
		return existing;
	}
	const builder = new ScriptBuilder(path, name, fromTransform);
	registry.set(path, builder);
	return builder;
}

export function resetAll(): void {
	for (const builder of registry.values()) {
		builder.reset();
	}
}

export function findActive(): ScriptBuilder | null {
	for (const builder of registry.values()) {
		if (builder.commands.length > 0) {
			return builder;
		}
	}
	return null;
}

export type { BatsDeps, KcovConfig } from "./bats-generator.js";
export { generateBatsFile } from "./bats-generator.js";
