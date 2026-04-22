import { execSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { type as osType } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type { Plugin } from "vitest/config";
import type { VitestPluginContext } from "vitest/node";
import type { LinkFormat, LogLevel } from "./vitest-kcov-types.js";

export interface BatsPluginOptions {
	/**
	 * Shell script coverage mode. Default: "auto"
	 * - "auto": include .sh in coverage when kcov is available, exclude when not
	 * - true: require kcov, throw if unavailable, include .sh in coverage
	 * - false: always exclude .sh from coverage
	 */
	coverage?: "auto" | boolean;
	/**
	 * How to handle missing system dependencies (bats, kcov, jq, etc.).
	 * Default: "error"
	 * - "error": throw on missing required deps, blocking all tests
	 * - "warn": log warnings but continue; BATS integration tests will
	 *   fail individually at runtime, pure TS unit tests run normally
	 */
	deps?: "error" | "warn";
	/** Log level for detection output. Default: "errors-only" */
	logLevel?: LogLevel;
	/** Hyperlink format for reporter. Default: "auto" */
	links?: LinkFormat;
}

interface Dependency {
	name: string;
	required: boolean;
	available: boolean;
	path: string | null;
	warning?: string;
}

function getCommandPath(command: string): string | null {
	try {
		const result = execSync(`command -v ${command}`, {
			encoding: "utf-8",
			stdio: "pipe",
		}).trim();
		return result ? realpathSync(result) : null;
	} catch {
		return null;
	}
}

function detectBatsLibraryPath(libraryName: string, fileName: string): string | null {
	const homeDir = process.env.HOME ?? "";
	const possiblePaths: string[] = [];

	if (process.env.XDG_CONFIG_HOME) {
		possiblePaths.push(`${process.env.XDG_CONFIG_HOME}/${libraryName}/${fileName}`);
	}
	if (homeDir) {
		possiblePaths.push(`${homeDir}/.config/${libraryName}/${fileName}`);
	}
	if (process.env.XDG_DATA_HOME) {
		possiblePaths.push(`${process.env.XDG_DATA_HOME}/${libraryName}/${fileName}`);
	}
	if (homeDir) {
		possiblePaths.push(`${homeDir}/.local/share/${libraryName}/${fileName}`);
	}

	possiblePaths.push(`/opt/homebrew/lib/${libraryName}/${fileName}`);
	possiblePaths.push(`/usr/local/lib/${libraryName}/${fileName}`);
	possiblePaths.push(`/usr/lib/${libraryName}/${fileName}`);

	for (const path of possiblePaths) {
		if (existsSync(path)) {
			return dirname(realpathSync(path));
		}
	}
	return null;
}

function getInstallCommand(name: string, onMacOS: boolean): string {
	const commands: Record<string, { mac: string; linux: string }> = {
		bats: { mac: "brew install bats-core", linux: "apt-get install bats" },
		"bats-support": { mac: "brew install bats-support", linux: "apt-get install bats-support" },
		"bats-assert": { mac: "brew install bats-assert", linux: "apt-get install bats-assert" },
		"bats-mock": { mac: "brew install bats-mock", linux: "apt-get install bats-file" },
		kcov: { mac: "brew install kcov", linux: "apt-get install kcov" },
		jq: { mac: "brew install jq", linux: "apt-get install jq" },
	};
	const cmd = commands[name];
	return cmd ? (onMacOS ? cmd.mac : cmd.linux) : "See documentation";
}

function checkDependencies(options: BatsPluginOptions, coverageEnabled: boolean, onMacOS: boolean): Dependency[] {
	const logLevel = options.logLevel ?? "errors-only";
	const deps: Dependency[] = [];

	// bats
	const batsPath = getCommandPath("bats");
	deps.push({ name: "bats", required: true, available: batsPath !== null, path: batsPath });

	// bats-support
	const supportPath = detectBatsLibraryPath("bats-support", "load.bash");
	deps.push({ name: "bats-support", required: true, available: supportPath !== null, path: supportPath });

	// bats-assert
	const assertPath = detectBatsLibraryPath("bats-assert", "load.bash");
	deps.push({ name: "bats-assert", required: true, available: assertPath !== null, path: assertPath });

	// bats-mock
	const mockPath = detectBatsLibraryPath("bats-mock", "stub.bash");
	deps.push({ name: "bats-mock", required: true, available: mockPath !== null, path: mockPath });

	// jq
	const jqPath = getCommandPath("jq");
	deps.push({ name: "jq", required: true, available: jqPath !== null, path: jqPath });

	// kcov (only when coverage enabled)
	if (coverageEnabled) {
		const kcovPath = getCommandPath("kcov");
		deps.push({
			name: "kcov",
			required: !onMacOS,
			available: kcovPath !== null,
			path: kcovPath,
			...(onMacOS && kcovPath
				? { warning: "Partial coverage on macOS due to SIP - use Docker for full coverage" }
				: {}),
		});
	}

	// Export env vars for found dependencies
	if (batsPath) process.env.BATS_PATH = batsPath;
	if (supportPath) process.env.BATS_SUPPORT_PATH = supportPath;
	if (assertPath) process.env.BATS_ASSERT_PATH = assertPath;
	if (mockPath) process.env.BATS_MOCK_PATH = mockPath;
	if (coverageEnabled) {
		const kcovDep = deps.find((d) => d.name === "kcov");
		if (kcovDep?.path) process.env.KCOV_PATH = kcovDep.path;
	}
	process.env.KCOV_LOG_LEVEL = logLevel;

	// Report status
	if (logLevel === "verbose" || logLevel === "debug") {
		for (const dep of deps) {
			const pathInfo = dep.path ? ` (${dep.path})` : "";
			if (dep.warning) {
				console.warn(`  [vitest-bats] ${dep.name}${pathInfo} - ${dep.warning}`);
			} else if (dep.available) {
				console.log(`  [vitest-bats] ${dep.name}${pathInfo}`);
			} else if (dep.required) {
				console.error(`  [vitest-bats] ${dep.name} - MISSING (required)`);
			} else {
				console.warn(`  [vitest-bats] ${dep.name} - not found (optional)`);
			}
		}
	}

	return deps;
}

function getMissingDeps(deps: Dependency[]): Dependency[] {
	return deps.filter((d) => d.required && !d.available);
}

function formatMissingDeps(missing: Dependency[], onMacOS: boolean): string {
	const lines = missing.map((d) => `  ${d.name}: ${getInstallCommand(d.name, onMacOS)}`);
	return `[vitest-bats] Missing required dependencies:\n${lines.join("\n")}`;
}

const VIRTUAL_PREFIX = "\0bats:";

export function BatsPlugin(options: BatsPluginOptions = {}): Plugin {
	const registeredScripts = new Set<string>();
	let cacheDir: string | null = null;

	function writeManifest(): void {
		if (!cacheDir) return;
		writeFileSync(resolve(cacheDir, "scripts.json"), JSON.stringify([...registeredScripts], null, "\t"), "utf-8");
	}

	return {
		name: "vitest-bats",
		enforce: "pre" as const,

		config(config) {
			const testConfig = (config as Record<string, Record<string, unknown>>).test;
			const userRunner = testConfig?.runner as string | undefined;
			if (userRunner && userRunner !== "vitest-bats/runner") {
				throw new Error(
					`[vitest-bats] A custom test runner is already configured: "${userRunner}". ` +
						"BatsPlugin manages the runner automatically. Remove the runner option from your vitest config.",
				);
			}
			return { test: { runner: "vitest-bats/runner" } };
		},

		resolveId(source, importer) {
			if (source.endsWith(".sh") && importer) {
				const resolved = resolve(dirname(importer), source);
				if (existsSync(resolved)) {
					return VIRTUAL_PREFIX + resolved;
				}
			}
			return null;
		},

		load(id) {
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;

			const scriptPath = id.slice(VIRTUAL_PREFIX.length);
			const scriptName = basename(scriptPath);

			if (!registeredScripts.has(scriptPath)) {
				registeredScripts.add(scriptPath);
				writeManifest();
			}

			return [
				'import { createBatsScript } from "vitest-bats/runtime";',
				`export default createBatsScript(${JSON.stringify(scriptPath)}, ${JSON.stringify(scriptName)}, true);`,
			].join("\n");
		},

		async configureVitest(ctx: VitestPluginContext) {
			const { vitest } = ctx;

			// Derive cache dir from Vite's cacheDir, scoped under vitest-bats/
			cacheDir = resolve((vitest.vite?.config?.cacheDir as string) ?? "node_modules/.vite", "vitest-bats");
			mkdirSync(cacheDir, { recursive: true });

			// Read coverage.enabled from Vitest config
			const coverageCfg = vitest.config.coverage as
				| {
						enabled?: boolean;
						exclude?: string[];
				  }
				| undefined;
			const coverageEnabled = coverageCfg?.enabled === true;

			// Check dependencies and set env vars
			const onMacOS = osType() === "Darwin";
			const depsMode = options.deps ?? "error";
			const deps = checkDependencies(options, coverageEnabled, onMacOS);

			const missing = getMissingDeps(deps);
			if (missing.length > 0) {
				const msg = formatMissingDeps(missing, onMacOS);
				if (depsMode === "error") {
					throw new Error(msg);
				}
				console.warn(`\n  ${msg}`);
				console.warn(
					"  [vitest-bats] Running in degraded mode (deps: 'warn')." +
						" BATS integration tests will fail individually.\n",
				);
			}

			// Determine shell script coverage mode
			const coverageMode = options.coverage ?? "auto";
			const kcovAvailable = deps.some((d) => d.name === "kcov" && d.available);
			const kcovReliable = kcovAvailable && !onMacOS;

			let includeShCoverage = false;
			if (coverageMode === true) {
				if (!kcovAvailable) {
					throw new Error(
						"[vitest-bats] coverage: true requires kcov but it is not available. " +
							"Install kcov or use coverage: 'auto' to skip shell coverage when unavailable.",
					);
				}
				if (onMacOS) {
					throw new Error(
						"[vitest-bats] coverage: true is not supported on macOS (SIP blocks kcov ptrace). " +
							"Use Docker for reliable shell coverage or coverage: 'auto'.",
					);
				}
				includeShCoverage = true;
			} else if (coverageMode === "auto") {
				includeShCoverage = kcovReliable;
			}
			// coverageMode === false: includeShCoverage stays false

			// Tell the runner whether to use kcov and where to write coverage
			if (includeShCoverage) {
				process.env.__VITEST_BATS_KCOV__ = "1";
				process.env.__VITEST_BATS_CACHE_DIR__ = cacheDir;
			}

			// Always inject coverage reporter when coverage is enabled.
			// Thresholds are always passed so kcov entries get synthetic
			// branch/function data (kcov only tracks statements/lines).
			// When kcov is unreliable, statementPassThrough also synthesizes
			// statement data so scripts are fully neutral in threshold checks.
			if (coverageEnabled) {
				const { BatsCoverageReporter } = await import("./coverage-reporter.js");

				const rawThresholds = (
					coverageCfg as {
						thresholds?: {
							statements?: number;
							branches?: number;
							functions?: number;
							lines?: number;
						};
					}
				)?.thresholds;

				const thresholds = rawThresholds
					? {
							statements: rawThresholds.statements ?? 0,
							branches: rawThresholds.branches ?? 0,
							functions: rawThresholds.functions ?? 0,
							lines: rawThresholds.lines ?? 0,
						}
					: undefined;

				const reporters = vitest.config.reporters as unknown[];
				reporters.unshift(
					new BatsCoverageReporter(cacheDir, {
						...(thresholds ? { thresholds } : {}),
						statementPassThrough: !includeShCoverage,
					}),
				);
			}
		},
	};
}
