import type {} from "vitest";
import type { BatsResult } from "./runtime.js";
import { BATS_RESULT_BRAND } from "./runtime.js";
import { validate as schemaValidate } from "./schema.js";

export interface MatcherResult {
	pass: boolean;
	message: () => string;
}

function ensureBatsResult(received: unknown): BatsResult {
	// Brand check via Symbol.for() — survives module-graph duplication
	// (per-entry self-contained bundles in the rslib-builder#158 workaround
	// produce distinct BatsResult class identities, so `instanceof` fails)
	// AND minification (no reliance on class names or property keys that a
	// minifier could rename).
	if (
		received !== null &&
		typeof received === "object" &&
		(received as Record<symbol, unknown>)[BATS_RESULT_BRAND] === true
	) {
		return received as BatsResult;
	}
	throw new Error(
		"vitest-bats matcher: expected received value to be a BatsResult (the value returned by hello.run() or hello.exec())",
	);
}

function ctx(r: BatsResult): string {
	const stderr = r.stderr.length > 200 ? `${r.stderr.slice(0, 200)}…` : r.stderr;
	const tail = stderr ? `\n  stderr: ${stderr}` : "";
	return `\n  status: ${r.status}${tail}`;
}

function getPath(obj: unknown, path: string): { found: boolean; value: unknown } {
	const parts: (string | number)[] = [];
	const re = /([^.[\]]+)|\[(\d+)\]/g;
	for (const m of path.matchAll(re)) {
		if (m[1] !== undefined) parts.push(m[1]);
		else if (m[2] !== undefined) parts.push(Number(m[2]));
	}
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== "object") {
			return { found: false, value: undefined };
		}
		if (typeof part === "number") {
			if (!Array.isArray(current) || part >= current.length) {
				return { found: false, value: undefined };
			}
			current = (current as unknown[])[part];
		} else {
			if (!(part in (current as Record<string, unknown>))) {
				return { found: false, value: undefined };
			}
			current = (current as Record<string, unknown>)[part];
		}
	}
	return { found: true, value: current };
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		return a.every((x, i) => deepEqual(x, b[i]));
	}
	if (typeof a === "object" && typeof b === "object") {
		const aKeys = Object.keys(a as object);
		const bKeys = Object.keys(b as object);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
	}
	return false;
}

function partialMatch(actual: unknown, expected: unknown): boolean {
	if (expected === null || typeof expected !== "object") return deepEqual(actual, expected);
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return false;
		return expected.every((e, i) => partialMatch(actual[i], e));
	}
	if (typeof actual !== "object" || actual === null) return false;
	return Object.keys(expected as object).every((k) =>
		partialMatch((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k]),
	);
}

export const batsMatchers = {
	// ============= Status =============
	toSucceed(received: unknown): MatcherResult {
		const r = ensureBatsResult(received);
		return {
			pass: r.status === 0,
			message: () =>
				r.status === 0 ? `expected script not to succeed, but it did${ctx(r)}` : `expected script to succeed${ctx(r)}`,
		};
	},

	toFail(received: unknown, code?: number): MatcherResult {
		const r = ensureBatsResult(received);
		const pass = code === undefined ? r.status !== 0 : r.status === code;
		return {
			pass,
			message: () =>
				code === undefined
					? `expected script ${pass ? "not " : ""}to fail${ctx(r)}`
					: `expected script to fail with code ${code}${ctx(r)}`,
		};
	},

	// ============= Output =============
	toHaveOutput(received: unknown, text: string): MatcherResult {
		const r = ensureBatsResult(received);
		return {
			pass: r.output === text,
			message: () => `expected output to be ${JSON.stringify(text)}, got ${JSON.stringify(r.output)}${ctx(r)}`,
		};
	},

	toContainOutput(received: unknown, text: string): MatcherResult {
		const r = ensureBatsResult(received);
		return {
			pass: r.output.includes(text),
			message: () =>
				`expected output to contain ${JSON.stringify(text)}\n  output: ${JSON.stringify(r.output)}${ctx(r)}`,
		};
	},

	toMatchOutput(received: unknown, pattern: RegExp | string): MatcherResult {
		const r = ensureBatsResult(received);
		const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
		return {
			pass: re.test(r.output),
			message: () => `expected output to match ${re}\n  output: ${JSON.stringify(r.output)}${ctx(r)}`,
		};
	},

	toHaveEmptyOutput(received: unknown): MatcherResult {
		const r = ensureBatsResult(received);
		return {
			pass: r.output === "",
			message: () => `expected output to be empty\n  output: ${JSON.stringify(r.output)}${ctx(r)}`,
		};
	},

	// ============= Stderr =============
	toHaveStderr(received: unknown, text: string): MatcherResult {
		const r = ensureBatsResult(received);
		return {
			pass: r.stderr === text,
			message: () => `expected stderr to be ${JSON.stringify(text)}, got ${JSON.stringify(r.stderr)}`,
		};
	},

	toContainStderr(received: unknown, text: string): MatcherResult {
		const r = ensureBatsResult(received);
		return {
			pass: r.stderr.includes(text),
			message: () => `expected stderr to contain ${JSON.stringify(text)}\n  stderr: ${JSON.stringify(r.stderr)}`,
		};
	},

	toMatchStderr(received: unknown, pattern: RegExp | string): MatcherResult {
		const r = ensureBatsResult(received);
		const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
		return {
			pass: re.test(r.stderr),
			message: () => `expected stderr to match ${re}\n  stderr: ${JSON.stringify(r.stderr)}`,
		};
	},

	// ============= Lines =============
	toHaveLine(received: unknown, index: number, text: string): MatcherResult {
		const r = ensureBatsResult(received);
		const pass = r.lines[index] === text;
		return {
			pass,
			message: () =>
				`expected lines[${index}] to be ${JSON.stringify(text)}, got ${JSON.stringify(r.lines[index])}${ctx(r)}`,
		};
	},

	toHaveLineContaining(received: unknown, text: string, index?: number): MatcherResult {
		const r = ensureBatsResult(received);
		const pass = index !== undefined ? Boolean(r.lines[index]?.includes(text)) : r.lines.some((l) => l.includes(text));
		return {
			pass,
			message: () =>
				index !== undefined
					? `expected lines[${index}] to contain ${JSON.stringify(text)}, got ${JSON.stringify(r.lines[index])}${ctx(r)}`
					: `expected some line to contain ${JSON.stringify(text)}\n  output: ${JSON.stringify(r.output)}${ctx(r)}`,
		};
	},

	toHaveLineMatching(received: unknown, pattern: RegExp | string, index?: number): MatcherResult {
		const r = ensureBatsResult(received);
		const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
		const pass =
			index !== undefined ? Boolean(r.lines[index] && re.test(r.lines[index])) : r.lines.some((l) => re.test(l));
		return {
			pass,
			message: () =>
				index !== undefined
					? `expected lines[${index}] to match ${re}, got ${JSON.stringify(r.lines[index])}${ctx(r)}`
					: `expected some line to match ${re}\n  output: ${JSON.stringify(r.output)}${ctx(r)}`,
		};
	},

	toHaveLineCount(received: unknown, n: number): MatcherResult {
		const r = ensureBatsResult(received);
		return {
			pass: r.lines.length === n,
			message: () => `expected ${n} line(s), got ${r.lines.length}`,
		};
	},

	// ============= JSON =============
	toOutputJson(received: unknown): MatcherResult {
		const r = ensureBatsResult(received);
		try {
			r.json();
			return { pass: true, message: () => "expected output not to be valid JSON, but it was" };
		} catch (err) {
			return {
				pass: false,
				message: () =>
					`expected output to be valid JSON: ${(err as Error).message}\n  output: ${JSON.stringify(r.output)}`,
			};
		}
	},

	toEqualJson(received: unknown, expected: unknown): MatcherResult {
		const r = ensureBatsResult(received);
		let parsed: unknown;
		try {
			parsed = r.json();
		} catch (err) {
			return {
				pass: false,
				message: () => `expected output to be valid JSON: ${(err as Error).message}`,
			};
		}
		return {
			pass: deepEqual(parsed, expected),
			message: () => `expected JSON output to deep-equal ${JSON.stringify(expected)}, got ${JSON.stringify(parsed)}`,
		};
	},

	toMatchJson(received: unknown, partial: object): MatcherResult {
		const r = ensureBatsResult(received);
		let parsed: unknown;
		try {
			parsed = r.json();
		} catch (err) {
			return {
				pass: false,
				message: () => `expected output to be valid JSON: ${(err as Error).message}`,
			};
		}
		return {
			pass: partialMatch(parsed, partial),
			message: () => `expected JSON output to match ${JSON.stringify(partial)}, got ${JSON.stringify(parsed)}`,
		};
	},

	toHaveJsonValue(received: unknown, path: string, expected: unknown): MatcherResult {
		const r = ensureBatsResult(received);
		let parsed: unknown;
		try {
			parsed = r.json();
		} catch (err) {
			return {
				pass: false,
				message: () => `expected output to be valid JSON: ${(err as Error).message}`,
			};
		}
		const { found, value } = getPath(parsed, path);
		return {
			pass: found && deepEqual(value, expected),
			message: () =>
				!found
					? `expected JSON path ${JSON.stringify(path)} to exist`
					: `expected JSON path ${JSON.stringify(path)} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`,
		};
	},

	toHaveJsonPath(received: unknown, path: string): MatcherResult {
		const r = ensureBatsResult(received);
		let parsed: unknown;
		try {
			parsed = r.json();
		} catch (err) {
			return {
				pass: false,
				message: () => `expected output to be valid JSON: ${(err as Error).message}`,
			};
		}
		const { found } = getPath(parsed, path);
		return {
			pass: found,
			message: () => `expected JSON path ${JSON.stringify(path)} to exist`,
		};
	},

	// ============= Schema =============
	toMatchSchema(received: unknown, schema: unknown): MatcherResult {
		const r = ensureBatsResult(received);
		let parsed: unknown;
		try {
			parsed = r.json();
		} catch (err) {
			return {
				pass: false,
				message: () => `expected output to be valid JSON: ${(err as Error).message}`,
			};
		}
		const v = schemaValidate(schema, parsed);
		return {
			pass: v.ok,
			message: () =>
				v.ok
					? "expected output not to match schema, but it did"
					: `expected output to match schema, but validation failed:\n${v.issues.map((i) => `  - ${i}`).join("\n")}`,
		};
	},

	toMatchJsonSchema(received: unknown, schema: object): MatcherResult {
		const r = ensureBatsResult(received);
		let parsed: unknown;
		try {
			parsed = r.json();
		} catch (err) {
			return {
				pass: false,
				message: () => `expected output to be valid JSON: ${(err as Error).message}`,
			};
		}
		const v = schemaValidate(schema, parsed);
		return {
			pass: v.ok,
			message: () =>
				v.ok
					? "expected output not to match JSON schema, but it did"
					: `expected output to match JSON schema, but validation failed:\n${v.issues.map((i) => `  - ${i}`).join("\n")}`,
		};
	},

	// ============= Invocation =============
	toHaveInvoked(received: unknown, cmd: string, opts?: { args?: string[] }): MatcherResult {
		const r = ensureBatsResult(received);
		const calls = r.calls[cmd] ?? [];
		const expectedArgs = opts?.args;
		const pass = calls.length > 0 && (expectedArgs === undefined || calls.some((c) => deepEqual(c.args, expectedArgs)));
		return {
			pass,
			message: () =>
				expectedArgs === undefined
					? `expected ${cmd} to have been invoked at least once. calls: ${JSON.stringify(calls)}`
					: `expected ${cmd} to have been invoked with args ${JSON.stringify(expectedArgs)}. calls: ${JSON.stringify(calls)}`,
		};
	},

	toHaveInvokedTimes(received: unknown, cmd: string, n: number): MatcherResult {
		const r = ensureBatsResult(received);
		const calls = r.calls[cmd] ?? [];
		return {
			pass: calls.length === n,
			message: () => `expected ${cmd} to have been invoked ${n} time(s), got ${calls.length}`,
		};
	},

	toHaveInvokedExactly(received: unknown, cmd: string, calls: { args: string[] }[]): MatcherResult {
		const r = ensureBatsResult(received);
		const actual = r.calls[cmd] ?? [];
		return {
			pass: deepEqual(actual, calls),
			message: () =>
				`expected ${cmd} call history to deep-equal ${JSON.stringify(calls)}, got ${JSON.stringify(actual)}`,
		};
	},
};

// =================================================================
// Vitest type augmentation
// =================================================================
declare module "vitest" {
	interface Assertion {
		toSucceed(): void;
		toFail(code?: number): void;

		toHaveOutput(text: string): void;
		toContainOutput(text: string): void;
		toMatchOutput(pattern: RegExp | string): void;
		toHaveEmptyOutput(): void;

		toHaveStderr(text: string): void;
		toContainStderr(text: string): void;
		toMatchStderr(pattern: RegExp | string): void;

		toHaveLine(index: number, text: string): void;
		toHaveLineContaining(text: string, index?: number): void;
		toHaveLineMatching(pattern: RegExp | string, index?: number): void;
		toHaveLineCount(n: number): void;

		toOutputJson(): void;
		toEqualJson(expected: unknown): void;
		toMatchJson(partial: object): void;
		toHaveJsonValue(path: string, expected: unknown): void;
		toHaveJsonPath(path: string): void;

		toMatchSchema(schema: unknown): void;
		toMatchJsonSchema(schema: object): void;

		toHaveInvoked(cmd: string, opts?: { args?: string[] }): void;
		toHaveInvokedTimes(cmd: string, n: number): void;
		toHaveInvokedExactly(cmd: string, calls: { args: string[] }[]): void;
	}

	interface AsymmetricMatchersContaining {
		toSucceed(): void;
		toFail(code?: number): void;
		toHaveOutput(text: string): void;
		toContainOutput(text: string): void;
		toMatchOutput(pattern: RegExp | string): void;
		toHaveEmptyOutput(): void;
		toHaveStderr(text: string): void;
		toContainStderr(text: string): void;
		toMatchStderr(pattern: RegExp | string): void;
		toHaveLine(index: number, text: string): void;
		toHaveLineContaining(text: string, index?: number): void;
		toHaveLineMatching(pattern: RegExp | string, index?: number): void;
		toHaveLineCount(n: number): void;
		toOutputJson(): void;
		toEqualJson(expected: unknown): void;
		toMatchJson(partial: object): void;
		toHaveJsonValue(path: string, expected: unknown): void;
		toHaveJsonPath(path: string): void;
		toMatchSchema(schema: unknown): void;
		toMatchJsonSchema(schema: object): void;
		toHaveInvoked(cmd: string, opts?: { args?: string[] }): void;
		toHaveInvokedTimes(cmd: string, n: number): void;
		toHaveInvokedExactly(cmd: string, calls: { args: string[] }[]): void;
	}
}
