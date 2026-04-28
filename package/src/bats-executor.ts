import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BatsResultData, MockCall } from "./runtime.js";

export interface ExecuteOptions {
	batsPath: string;
	batsContent: string;
	recorderDir: string;
	timeoutMs?: number;
}

let cleanupRegistered = false;
let batsFileDirCache: string | null = null;

function getBatsFileDir(): string {
	if (batsFileDirCache) return batsFileDirCache;
	const dir = join(tmpdir(), `vitest-bats-${process.pid}`);
	mkdirSync(dir, { recursive: true });
	batsFileDirCache = dir;
	if (!cleanupRegistered) {
		cleanupRegistered = true;
		process.on("exit", () => {
			try {
				if (batsFileDirCache) {
					rmSync(batsFileDirCache, { recursive: true, force: true });
				}
			} catch {
				// best-effort
			}
		});
	}
	return dir;
}

function decodeB64(b64: string): string {
	return Buffer.from(b64, "base64").toString("utf-8");
}

export function parseExecutionResult(recorderDir: string): BatsResultData {
	const resultPath = join(recorderDir, "result.txt");
	if (!existsSync(resultPath)) {
		throw new Error(
			`vitest-bats: expected result file not found at ${resultPath}. ` +
				"BATS likely crashed before the test body completed.",
		);
	}

	const raw = readFileSync(resultPath, "utf-8");
	let status: number | null = null;
	let outputB64: string | null = null;
	let stderrB64: string | null = null;

	for (const line of raw.split("\n")) {
		if (line.startsWith("status:")) {
			const n = Number(line.slice("status:".length));
			if (!Number.isNaN(n)) status = n;
		} else if (line.startsWith("output_b64:")) {
			outputB64 = line.slice("output_b64:".length);
		} else if (line.startsWith("stderr_b64:")) {
			stderrB64 = line.slice("stderr_b64:".length);
		}
	}

	if (status === null) {
		throw new Error(`vitest-bats: malformed result file at ${resultPath}: missing 'status:' line. Contents:\n${raw}`);
	}
	if (outputB64 === null || stderrB64 === null) {
		throw new Error(
			`vitest-bats: malformed result file at ${resultPath}: missing output_b64 or stderr_b64. Contents:\n${raw}`,
		);
	}

	const calls: Record<string, MockCall[]> = {};
	const callsPath = join(recorderDir, "calls.jsonl");
	if (existsSync(callsPath)) {
		const callsRaw = readFileSync(callsPath, "utf-8");
		for (const [i, line] of callsRaw.split("\n").entries()) {
			if (line.trim() === "") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(`vitest-bats: failed to parse calls.jsonl line ${i + 1}: ${msg}\n  line: ${line}`);
			}
			if (!parsed || typeof parsed !== "object" || !("cmd" in parsed) || !("args" in parsed)) {
				throw new Error(`vitest-bats: calls.jsonl line ${i + 1} missing cmd or args: ${line}`);
			}
			const { cmd, args } = parsed as { cmd: unknown; args: unknown };
			if (typeof cmd !== "string" || !Array.isArray(args)) {
				throw new Error(`vitest-bats: calls.jsonl line ${i + 1} has wrong types: ${line}`);
			}
			const argsStr = args.map(String);
			if (!calls[cmd]) calls[cmd] = [];
			calls[cmd].push({ args: argsStr });
		}
	}

	return {
		status,
		output: decodeB64(outputB64),
		stderr: decodeB64(stderrB64),
		calls,
	};
}

export function executeBats(opts: ExecuteOptions): BatsResultData {
	mkdirSync(opts.recorderDir, { recursive: true });

	const batsFileDir = getBatsFileDir();
	const batsFile = resolve(batsFileDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.bats`);
	writeFileSync(batsFile, opts.batsContent, { mode: 0o755 });

	const result = spawnSync(opts.batsPath, ["--tap", batsFile], {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: opts.timeoutMs ?? 60000,
		env: { ...process.env, VBATS_RECORDER: opts.recorderDir },
	});

	if (result.error) {
		throw new Error(`vitest-bats: failed to spawn bats at ${opts.batsPath}: ${result.error.message}`);
	}

	// BATS returns non-zero when a test fails. We don't treat that as a tooling
	// error — the per-test status comes from result.txt. We only throw if the
	// result file is missing (true tool-level failure).
	return parseExecutionResult(opts.recorderDir);
}
