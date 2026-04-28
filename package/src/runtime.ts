import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeBats } from "./bats-executor.js";
import type { BatsDeps, KcovConfig, RunMode, StubSpec } from "./bats-generator.js";
import { generateBatsFile } from "./bats-generator.js";

export interface MockCall {
	args: string[];
}

export interface BatsResultData {
	status: number;
	output: string;
	stderr: string;
	calls: Record<string, MockCall[]>;
}

/**
 * Symbol brand identifying a BatsResult instance. Used by matchers to
 * detect BatsResult inputs in a way that survives:
 * - Module-graph duplication (per-entry self-contained bundles produced as
 *   the workaround for savvy-web/rslib-builder#158, where each entry has
 *   its own copy of the BatsResult class — `instanceof` would fail).
 * - Property name minification (a `constructor.name === "BatsResult"`
 *   check would break under any minifier that renames classes).
 *
 * Registered with `Symbol.for(...)` so the symbol is shared across module
 * graphs (the global symbol registry is process-wide).
 */
export const BATS_RESULT_BRAND: unique symbol = Symbol.for("vitest-bats.BatsResult") as never;

export class BatsResult {
	readonly [BATS_RESULT_BRAND] = true;
	readonly status: number;
	readonly output: string;
	readonly stderr: string;
	readonly lines: string[];
	readonly stderr_lines: string[];
	readonly calls: Record<string, MockCall[]>;

	private _jsonCache: { value: unknown } | null = null;

	constructor(data: BatsResultData) {
		this.status = data.status;
		this.output = data.output;
		this.stderr = data.stderr;
		this.lines = data.output === "" ? [] : data.output.split("\n");
		this.stderr_lines = data.stderr === "" ? [] : data.stderr.split("\n");
		this.calls = data.calls;
	}

	json<T = unknown>(): T {
		if (this._jsonCache) return this._jsonCache.value as T;
		let parsed: unknown;
		try {
			parsed = JSON.parse(this.output);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`vitest-bats: result.output is not valid JSON: ${msg}`);
		}
		this._jsonCache = { value: parsed };
		return parsed as T;
	}
}

const builders = new Set<ScriptBuilder>();

export function resetAllBuilders(): void {
	for (const b of builders) {
		b.reset();
	}
}

function loadDeps(): BatsDeps {
	return {
		batsPath: process.env.BATS_PATH ?? "bats",
		batsSupportPath: process.env.BATS_SUPPORT_PATH ?? "",
	};
}

function loadKcov(scriptPath: string): KcovConfig | undefined {
	if (process.env.__VITEST_BATS_KCOV__ !== "1") return undefined;
	const cacheDir = process.env.__VITEST_BATS_CACHE_DIR__;
	const kcovPath = process.env.KCOV_PATH;
	if (!cacheDir || !kcovPath) return undefined;
	const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const scriptName = scriptPath.split("/").pop()?.replace(/\.sh$/, "") ?? "script";
	const outputDir = resolve(cacheDir, "kcov", `${scriptName}-${id}`);
	mkdirSync(outputDir, { recursive: true });
	return { kcovPath, outputDir };
}

function makeRecorderDir(): string {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const dir = resolve(tmpdir(), `vitest-bats-${process.pid}`, "recorder", id);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export class ScriptBuilder {
	readonly path: string;
	readonly name: string;

	private _env: Record<string, string> = {};
	private _flags = "";
	private _stubs: StubSpec[] = [];

	constructor(path: string, name: string) {
		this.path = path;
		this.name = name;
		builders.add(this);
	}

	env(vars: Record<string, string>): this {
		this._env = { ...this._env, ...vars };
		return this;
	}

	flags(value: string): this {
		this._flags = value;
		return this;
	}

	mock(cmd: string, responses: Record<string, string> = {}): this {
		this._stubs.push({ cmd, responses });
		return this;
	}

	run(...args: string[]): BatsResult {
		return this.execute({ kind: "args" }, args);
	}

	exec(shellExpr: string): BatsResult {
		return this.execute({ kind: "shell", expression: shellExpr }, []);
	}

	reset(): void {
		this._env = {};
		this._flags = "";
		this._stubs = [];
	}

	private execute(mode: RunMode, args: string[]): BatsResult {
		const recorderDir = makeRecorderDir();
		const deps = loadDeps();
		const kcov = loadKcov(this.path);

		const batsContent = generateBatsFile({
			scriptPath: this.path,
			args,
			env: this._env,
			flags: this._flags,
			stubs: this._stubs,
			recorderDir,
			deps,
			mode,
			...(kcov ? { kcov } : {}),
		});

		try {
			const data = executeBats({
				batsPath: deps.batsPath,
				batsContent,
				recorderDir,
			});
			return new BatsResult(data);
		} finally {
			this.reset();
		}
	}
}
