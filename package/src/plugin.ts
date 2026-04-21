import { execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { type as osType } from "node:os";
import { dirname, resolve } from "node:path";
import type { VitestPluginContext } from "vitest/node";
import type { LinkFormat, LogLevel } from "./vitest-kcov-types.js";

export interface BatsPluginOptions {
	/** Inject KcovVerboseReporter. Default: true */
	reporter?: boolean;
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

function checkDependencies(options: BatsPluginOptions, coverageEnabled: boolean): Dependency[] {
	const onMacOS = osType() === "Darwin";
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

	// Fail on missing required
	const missing = deps.filter((d) => d.required && !d.available);
	if (missing.length > 0) {
		const lines = missing.map((d) => `  ${d.name}: ${getInstallCommand(d.name, onMacOS)}`);
		throw new Error(`[vitest-bats] Missing required dependencies:\n${lines.join("\n")}`);
	}

	return deps;
}

export function BatsPlugin(options: BatsPluginOptions = {}): {
	name: string;
	configureVitest: (ctx: VitestPluginContext) => Promise<void>;
} {
	return {
		name: "vitest-bats",
		async configureVitest(ctx: VitestPluginContext) {
			const { vitest } = ctx;

			// Read coverage.enabled from Vitest config
			const coverageCfg = vitest.config.coverage as { enabled?: boolean } | undefined;
			const coverageEnabled = coverageCfg?.enabled === true;

			// 1. Check dependencies and set env vars
			checkDependencies(options, coverageEnabled);

			// 2. Set BatsHelper cache dir via env var
			const cacheDir = resolve(process.cwd(), ".vitest-bats-cache");
			process.env.__VITEST_KCOV_BATS_HELPER_CACHE_DIR__ = cacheDir;

			// 3. Inject coverage-merging reporter (must be first to mutate CoverageMap)
			if (coverageEnabled) {
				const { BatsCoverageReporter } = await import("./coverage-reporter.js");
				const coverageReporter = new BatsCoverageReporter(cacheDir);
				(vitest.config.reporters as unknown[]).unshift(coverageReporter);
			}

			// 4. Inject verbose reporter
			if (options.reporter !== false) {
				const { default: KcovVerboseReporter } = await import("./vitest-kcov-reporter-verbose.js");
				const reporter = new KcovVerboseReporter({
					debug: options.logLevel === "debug",
				});
				(vitest.config.reporters as unknown[]).push(reporter);
			}
		},
	};
}
