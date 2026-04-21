/**
 * Custom Vitest Coverage Provider for kcov
 *
 * @remarks
 * Integrates shell script coverage collection via kcov with Vitest's coverage system.
 * This provider enables line-by-line coverage tracking for bash scripts tested with BATS.
 *
 * **Key Features:**
 * - Automatic kcov integration with BATS tests
 * - Coverage merging from multiple test runs
 * - Customizable reporting with optional custom reporters
 * - Support for multiple log levels (verbose, debug, errors-only)
 *
 * @packageDocumentation
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CoverageProvider, CoverageProviderModule, ResolvedCoverageOptions, Vitest } from "vitest/node";
import { isMacOS } from "./platform-utils.js";
import { BatsHelper } from "./vitest-kcov-bats-helper.js";
// biome-ignore lint/correctness/noUnusedImports: LogLevel and LinkFormat are used in JSDoc comments
import type { KcovOptions, LinkFormat, LogLevel } from "./vitest-kcov-types.js";

/**
 * Coverage summary for a single shell script file.
 *
 * @remarks
 * Contains line-level coverage statistics extracted from kcov's JSON output.
 */
interface FileCoverageSummary {
	/** Absolute path to the covered file */
	path: string;
	/** Total number of executable lines in the file */
	totalLines: number;
	/** Number of lines that were executed during tests */
	coveredLines: number;
	/** Number of lines that were not executed during tests */
	uncoveredLines: number;
	/** Coverage percentage (0-100) */
	percentage: number;
}

/**
 * Aggregated coverage summary across all shell scripts.
 *
 * @remarks
 * Provides overall coverage statistics by combining data from all tested files.
 */
interface CoverageSummary {
	/** Coverage summaries for individual files */
	files: FileCoverageSummary[];
	/** Total number of executable lines across all files */
	totalLines: number;
	/** Total number of covered lines across all files */
	coveredLines: number;
	/** Overall coverage percentage (0-100) */
	percentage: number;
}

/**
 * Initial configuration options before defaults are applied.
 *
 * @internal
 */
type InitialOptions = ResolvedCoverageOptions & { kcov?: Partial<KcovOptions> };

/**
 * Final configuration options with all defaults applied.
 *
 * @remarks
 * All kcov options have defaults and are fully resolved after merging with user configuration.
 *
 * @internal
 */
type FinalOptions = ResolvedCoverageOptions & {
	kcov: Required<KcovOptions>;
};

/**
 * Custom coverage provider that integrates kcov with Vitest for shell script coverage.
 *
 * @remarks
 * This provider implements Vitest's {@link CoverageProvider} interface to collect and report
 * coverage for bash scripts tested with BATS. Coverage is collected by kcov during BATS test
 * execution, then merged and reported after all tests complete.
 *
 * **Lifecycle:**
 * 1. `initialize()` - Set up provider with Vitest context
 * 2. `onBeforeFilesRun()` - Warn if kcov is not available
 * 3. BATS tests run (kcov collects coverage automatically)
 * 4. `generateCoverage()` - Merge kcov output from all test runs
 * 5. `reportCoverage()` - Display coverage results
 * 6. `getCoverageSummary()` - Return parsed coverage data
 *
 * @example
 * ```typescript
 * // vitest.config.ts
 * export default defineConfig({
 *   test: {
 *     coverage: {
 *       enabled: true,
 *       provider: "custom",
 *       customProviderModule: "./lib/vitest-kcov-plugin/vitest-kcov-provider.ts",
 *       kcov: {
 *         enabled: true,
 *         // Scripts are automatically discovered from BatsHelper.describe() calls
 *         logLevel: "errors-only",
 *         customReporter: "./lib/vitest-kcov-plugin/vitest-kcov-reporter-coverage.ts",
 *       },
 *     },
 *   },
 * });
 * ```
 */
class KcovCoverageProvider implements CoverageProvider {
	/** Provider name for Vitest identification */
	name = "kcov" as const;

	/** Resolved coverage options with kcov configuration */
	options!: FinalOptions;

	/** Vitest context instance */
	ctx!: Vitest;

	/** Configured cache directory for BATS files and kcov output */
	private cacheDir!: string;

	/** Resolved reports directory (reportsDirectory + optional subdir) */
	private resolvedReportsDir!: string;

	/**
	 * Default configuration options for kcov coverage collection.
	 *
	 * @remarks
	 * These defaults are merged with user-provided options from vitest.config.ts.
	 * Users can override any of these values in their configuration.
	 *
	 * The `customReporter` path is automatically calculated from the provider's location,
	 * so users don't need to specify it unless they want a custom reporter.
	 *
	 * Default directory structure:
	 * - subdir: "kcov" - Reports go in coverage/kcov/
	 * - cacheDir: "../bats-cache" - Cache goes in coverage/bats-cache/ (sibling to kcov)
	 *
	 * Scripts are automatically discovered from BatsHelper.getRegisteredScripts().
	 */
	static DEFAULT_KCOV_OPTIONS: Required<KcovOptions> = {
		subdir: "kcov",
		cacheDir: "../bats-cache",
		clean: true,
		cleanCache: true,
		incremental: false,
		logLevel: "errors-only",
		links: "default",
		customReporter: new URL("./vitest-kcov-reporter-coverage.js", import.meta.url).pathname,
		thresholds: {},
	};

	/**
	 * Generate a timestamp folder name for incremental reports.
	 *
	 * @remarks
	 * Creates a folder name based on the current time in the format `YYYY-MM-DD_HH-MM-SS`.
	 * Used when `incremental: true` to create timestamped report directories.
	 *
	 * @returns Timestamp string (e.g., "2025-11-12_14-30-45")
	 *
	 * @internal
	 */
	private static getRunFolderName(): string {
		const now = new Date();
		return now
			.toISOString()
			.slice(0, 19) // Keep YYYY-MM-DDTHH:MM:SS
			.replace("T", "_")
			.replace(/:/g, "-");
	}

	/** Internal flag tracking whether kcov is available in PATH */
	public _available: boolean = false;

	/** Track if E2BIG errors occurred during merge operations */
	private e2bigErrorsEncountered = false;

	/**
	 * Whether kcov coverage collection is enabled.
	 *
	 * @remarks
	 * Returns true if kcov is available in the system PATH.
	 * Coverage enablement is controlled by Vitest's coverage.enabled option.
	 */
	get enabled(): boolean {
		return this.available;
	}

	/**
	 * Whether kcov is available in the system PATH.
	 *
	 * @remarks
	 * Checked during initialization by attempting to run `command -v kcov`.
	 */
	get available(): boolean {
		return this._available;
	}

	/**
	 * Initialize the coverage provider with Vitest context.
	 *
	 * @remarks
	 * Called once by Vitest before tests run. Sets up configuration, checks
	 * all system dependencies, and displays comprehensive status report.
	 *
	 * @param ctx - Vitest context instance with configuration and utilities
	 */
	initialize(ctx: Vitest): void {
		this.ctx = ctx;
		this.options = this.resolveOptions();

		this.logDebug("\n📋 Kcov Configuration Resolution:");
		this.logDebug("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

		// Calculate the resolved reports directory (reportsDirectory + optional subdir)
		const baseReportsDir = this.options.reportsDirectory;
		let subdir = this.options.kcov.subdir;
		const incremental = this.options.kcov.incremental;

		this.logDebug(`📁 Input Configuration:`);
		this.logDebug(`   - reportsDirectory: "${baseReportsDir}"`);
		this.logDebug(`   - subdir: "${subdir}"`);
		this.logDebug(`   - cacheDir: "${this.options.kcov.cacheDir}"`);
		this.logDebug(`   - incremental: ${incremental}`);

		// Handle incremental mode: insert timestamp folder before the final segment
		if (incremental) {
			const timestamp = KcovCoverageProvider.getRunFolderName();
			this.logDebug(`\n⏰ Incremental Mode:`);
			this.logDebug(`   - Timestamp: ${timestamp}`);

			if (subdir) {
				// Split subdir and insert timestamp before the last segment
				// Example: "foo/bar" -> "foo/2025-11-12_14-30-45/bar"
				const subdirParts = subdir.split("/").filter((p) => p);
				if (subdirParts.length > 0) {
					const lastSegment = subdirParts[subdirParts.length - 1];
					const parentParts = subdirParts.slice(0, -1);
					const newSubdirParts = [...parentParts, timestamp, lastSegment];
					subdir = newSubdirParts.join("/");
					this.logDebug(`   - Original subdir: "${this.options.kcov.subdir}"`);
					this.logDebug(`   - Timestamped subdir: "${subdir}"`);
				} else {
					// Single segment, prepend timestamp
					subdir = `${timestamp}/${subdir}`;
					this.logDebug(`   - Timestamped subdir: "${subdir}"`);
				}
			} else {
				// No subdir, use timestamp/kcov structure
				subdir = `${timestamp}/kcov`;
				this.logDebug(`   - Timestamped subdir: "${subdir}" (default structure)`);
			}
		}

		// Log resolved configuration after incremental processing, before path calculations
		this.logDebug(`\n📋 Resolved Configuration (after defaults and incremental processing):`);
		this.logDebug(`   - reportsDirectory: "${baseReportsDir}"`);
		this.logDebug(`   - subdir: "${subdir}"`);
		this.logDebug(`   - cacheDir: "${this.options.kcov.cacheDir}"`);
		this.logDebug(`   - incremental: ${incremental}`);
		this.logDebug(`   - clean: ${this.options.kcov.clean}`);
		this.logDebug(`   - cleanCache: ${this.options.kcov.cleanCache}`);
		this.logDebug("   - Scripts: Auto-discovered from BatsHelper.getRegisteredScripts()");
		this.logDebug(`   - logLevel: "${this.options.kcov.logLevel}"`);
		this.logDebug(`   - links: "${this.options.kcov.links}"`);

		this.resolvedReportsDir = subdir
			? resolve(this.ctx.config.root, baseReportsDir, subdir)
			: resolve(this.ctx.config.root, baseReportsDir);

		this.logDebug(`\n📂 Reports Directory Resolution:`);
		this.logDebug(`   - Resolved path: ${this.resolvedReportsDir}`);

		// Calculate default cache directory based on the resolved reports directory
		// Strategy: Place cache at the same level as the final directory
		// Example: "coverage/foo/bar" -> "coverage/foo/bar-cache"
		const resolvedReportsParts = this.resolvedReportsDir.split("/").filter((p) => p);
		const parentPath = resolvedReportsParts.slice(0, -1).join("/");
		const lastSegment = resolvedReportsParts[resolvedReportsParts.length - 1];
		const defaultCacheDir =
			parentPath.length > 0
				? resolve("/", parentPath, `${lastSegment}-cache`)
				: resolve(this.ctx.config.root, `${lastSegment}-cache`);

		this.logDebug(`\n💾 Cache Directory Resolution:`);
		this.logDebug(`   - Default cache dir: ${defaultCacheDir}`);

		// Resolve user-provided cache directory
		let userCacheDir = this.options.kcov.cacheDir;
		if (userCacheDir) {
			this.logDebug(`   - User-provided cacheDir: "${userCacheDir}"`);

			// Resolve relative paths from the resolved reports directory
			if (!userCacheDir.startsWith("/")) {
				const beforePathResolution = userCacheDir;
				userCacheDir = resolve(this.resolvedReportsDir, userCacheDir);
				this.logDebug(`   - Resolved from "${beforePathResolution}" relative to reports dir`);
			}
			this.logDebug(`   - Final cache dir: ${userCacheDir}`);
		}

		this.cacheDir = userCacheDir || defaultCacheDir;

		// Validate that reports and cache directories are different
		if (this.resolvedReportsDir === this.cacheDir) {
			const errorMessage = [
				"❌ Configuration Error: Reports and cache directories resolve to the same path!",
				`   Resolved path: ${this.resolvedReportsDir}`,
				"",
				"Configuration:",
				`   - reportsDirectory: "${baseReportsDir}"`,
				`   - subdir: "${subdir}"`,
				`   - cacheDir: "${this.options.kcov.cacheDir}"`,
				"",
				"The cache directory must be different from the reports directory.",
				"Please adjust your cacheDir configuration.",
				"",
				"Suggested fixes:",
				`   - Use "../bats-cache" to place cache as a sibling: ${resolve(this.resolvedReportsDir, "../bats-cache")}`,
				`   - Use an absolute path like "/tmp/bats-cache"`,
			].join("\n");

			console.error(`\n${errorMessage}\n`);
			throw new Error("Reports and cache directories cannot be the same path");
		}

		// When incremental mode is enabled, validate that cache is within the timestamped folder
		if (incremental) {
			// Extract timestamp from the subdir path (format: YYYY-MM-DD_HH-MM-SS)
			const timestampPattern = /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/;
			const timestampMatch = subdir.match(timestampPattern);

			if (timestampMatch) {
				const timestamp = timestampMatch[0];
				// Check if cache directory contains the same timestamp in its path
				if (!this.cacheDir.includes(timestamp)) {
					const errorMessage = [
						"❌ Configuration Error: Cache directory is outside the timestamped folder in incremental mode!",
						"",
						"When incremental is true, both reports and cache must be within the same timestamped folder",
						"to preserve complete test runs for comparison.",
						"",
						"Current paths:",
						`   - Reports: ${this.resolvedReportsDir}`,
						`   - Cache:   ${this.cacheDir}`,
						"",
						"Configuration:",
						`   - incremental: ${incremental}`,
						`   - subdir: "${this.options.kcov.subdir}"`,
						`   - cacheDir: "${this.options.kcov.cacheDir}"`,
						"",
						"The cache directory must be within the timestamped folder structure.",
						"",
						"Suggested fixes:",
						`   - Use "../bats-cache" to place cache as sibling to reports within timestamp: ${resolve(this.resolvedReportsDir, "../bats-cache")}`,
						`   - Use a relative path that stays within the timestamp folder`,
						`   - Or disable incremental mode if you want shared cache across runs`,
					].join("\n");

					console.error(`\n${errorMessage}\n`);
					throw new Error("Cache directory must be within timestamped folder when incremental is true");
				}
			}
		}

		this.logDebug(`\n✅ Final Resolved Paths:`);
		this.logDebug(`   - Reports: ${this.resolvedReportsDir}`);
		this.logDebug(`   - Cache:   ${this.cacheDir}`);
		this.logDebug("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

		// Clean up previous test artifacts if configured
		this.logDebug("\n🧹 Cleanup Configuration:");
		this.logDebug(`   - clean (reports): ${this.options.kcov.clean}`);
		this.logDebug(`   - cleanCache: ${this.options.kcov.cleanCache}`);

		if (this.options.kcov.clean && existsSync(this.resolvedReportsDir)) {
			this.logDebug(`   - Removing reports directory...`);
			rmSync(this.resolvedReportsDir, { recursive: true, force: true });
		}

		if (this.options.kcov.cleanCache && existsSync(this.cacheDir)) {
			this.logDebug(`   - Removing cache directory...`);
			rmSync(this.cacheDir, { recursive: true, force: true });
		}

		BatsHelper.configure(this.cacheDir, this.options.kcov.links);
		this.logDebug(`\n🔧 BatsHelper configured with cache: ${this.cacheDir}`);

		// Check all system dependencies and display status
		this.checkSystemDependencies();

		// Set kcov availability flag
		// Note: kcov may work on newer macOS versions, so we attempt it regardless
		this._available = this.isKcovAvailable();
	}

	/**
	 * Resolve final options by merging defaults with user configuration.
	 *
	 * @remarks
	 * Combines {@link DEFAULT_KCOV_OPTIONS} with user-provided `kcov` options
	 * from vitest.config.ts. User options take precedence over defaults.
	 *
	 * @returns Final merged configuration with all kcov options populated
	 */
	resolveOptions(): FinalOptions {
		return {
			...this.ctx.config.coverage,
			kcov: {
				...KcovCoverageProvider.DEFAULT_KCOV_OPTIONS,
				...((this.ctx.config.coverage as InitialOptions).kcov || {}),
			},
		};
	}

	/**
	 * Check if kcov is available in the system PATH.
	 *
	 * @remarks
	 * Attempts to run `command -v kcov` to verify kcov installation.
	 * Used during initialization to set the {@link available} property.
	 *
	 * @returns `true` if kcov is found in PATH, `false` otherwise
	 *
	 * @internal
	 */
	private isKcovAvailable(): boolean {
		try {
			execSync("command -v kcov", { encoding: "utf-8", stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}
	/**
	 * Get the path of a command in the system PATH.
	 *
	 * @param command - Command name to check
	 * @returns Full path to the command, or null if not found
	 *
	 * @internal
	 */
	private getCommandPath(command: string): string | null {
		// Use 'command -v' which respects the user's PATH
		// This already includes user-local bins, Homebrew, and system locations
		try {
			const path = execSync(`command -v ${command}`, { encoding: "utf-8", stdio: "pipe" }).trim();
			// Resolve symlinks to get the actual binary location
			return realpathSync(path);
		} catch {
			return null;
		}
	}

	/**
	 * Detect the actual path of a BATS library.
	 *
	 * @param libraryName - Name of the library (e.g., "bats-support")
	 * @param fileName - File to check for (e.g., "load.bash" or "stub.bash")
	 * @returns Full path to the library directory, or null if not found
	 *
	 * @internal
	 */
	private detectBatsLibraryPath(libraryName: string, fileName: string): string | null {
		const homeDir = process.env.HOME || "";

		// Build list of possible paths, checking XDG directories first, then system locations
		const possiblePaths: string[] = [];

		// XDG_CONFIG_HOME locations (user-specific, highest priority)
		if (process.env.XDG_CONFIG_HOME) {
			possiblePaths.push(`${process.env.XDG_CONFIG_HOME}/${libraryName}/${fileName}`);
		}
		if (homeDir) {
			possiblePaths.push(`${homeDir}/.config/${libraryName}/${fileName}`);
		}

		// XDG_DATA_HOME locations
		if (process.env.XDG_DATA_HOME) {
			possiblePaths.push(`${process.env.XDG_DATA_HOME}/${libraryName}/${fileName}`);
		}
		if (homeDir) {
			possiblePaths.push(`${homeDir}/.local/share/${libraryName}/${fileName}`);
		}

		// Homebrew locations (macOS)
		possiblePaths.push(`/opt/homebrew/lib/${libraryName}/${fileName}`);

		// System-wide locations
		possiblePaths.push(`/usr/local/lib/${libraryName}/${fileName}`);
		possiblePaths.push(`/usr/lib/${libraryName}/${fileName}`);

		for (const path of possiblePaths) {
			if (existsSync(path)) {
				// Resolve symlinks to get the actual file location
				const realPath = realpathSync(path);
				// Return the directory path without the filename
				return dirname(realPath);
			}
		}

		return null;
	}

	/**
	 * Check all system dependencies and display comprehensive status report.
	 *
	 * @remarks
	 * Checks for required dependencies:
	 * - BATS core (required) - Test framework
	 * - bats-support (required) - Helper functions
	 * - bats-assert (required) - Assertion library
	 * - bats-mock (required) - Mocking library
	 * - jq (required) - JSON processing for assertions
	 * - kcov (required on Linux, optional on macOS) - Coverage tool (may not work on older macOS)
	 *
	 * Displays status with clear indicators:
	 * - ✅ (installed and working)
	 * - ✗ (missing and required)
	 * - ⚠️ (installed but won't work on current platform)
	 *
	 * Detects library paths and exports them as environment variables for BATS tests.
	 *
	 * @throws {Error} If required dependencies are missing
	 *
	 * @internal
	 */
	private checkSystemDependencies(): void {
		const onMacOS = isMacOS();
		const dependencies: Array<{
			name: string;
			required: boolean;
			available: boolean;
			path?: string | null;
			warning?: string;
		}> = [];

		// Export kcov log level for BatsHelper to use
		process.env.KCOV_LOG_LEVEL = this.options.kcov.logLevel;

		// Check BATS (required) and export path
		const batsPath = this.getCommandPath("bats");
		const batsAvailable = batsPath !== null;
		if (batsPath) {
			process.env.BATS_PATH = batsPath;
		}
		dependencies.push({
			name: "bats",
			required: true,
			available: batsAvailable,
			path: batsPath,
		});

		// Check bats-support (required) and export path
		const batsSupportPath = this.detectBatsLibraryPath("bats-support", "load.bash");
		const batsSupportAvailable = batsSupportPath !== null;
		if (batsSupportPath) {
			process.env.BATS_SUPPORT_PATH = batsSupportPath;
		}
		dependencies.push({
			name: "bats-support",
			required: true,
			available: batsSupportAvailable,
			path: batsSupportPath ? `${batsSupportPath}/load.bash` : null,
		});

		// Check bats-assert (required) and export path
		const batsAssertPath = this.detectBatsLibraryPath("bats-assert", "load.bash");
		const batsAssertAvailable = batsAssertPath !== null;
		if (batsAssertPath) {
			process.env.BATS_ASSERT_PATH = batsAssertPath;
		}
		dependencies.push({
			name: "bats-assert",
			required: true,
			available: batsAssertAvailable,
			path: batsAssertPath ? `${batsAssertPath}/load.bash` : null,
		});

		// Check bats-mock (required) and export path
		const batsMockPath = this.detectBatsLibraryPath("bats-mock", "stub.bash");
		const batsMockAvailable = batsMockPath !== null;
		if (batsMockPath) {
			process.env.BATS_MOCK_PATH = batsMockPath;
		}
		dependencies.push({
			name: "bats-mock",
			required: true,
			available: batsMockAvailable,
			path: batsMockPath ? `${batsMockPath}/stub.bash` : null,
		});

		// Check jq (required for JSON assertions)
		const jqPath = this.getCommandPath("jq");
		const jqAvailable = jqPath !== null;
		dependencies.push({
			name: "jq",
			required: true,
			available: jqAvailable,
			path: jqPath,
		});

		// Check kcov last (may not work on older macOS versions due to SIP) and export path
		// Placed last for prominence when showing errors
		const kcovPath = this.getCommandPath("kcov");
		const kcovAvailable = kcovPath !== null;
		if (kcovPath) {
			process.env.KCOV_PATH = kcovPath;
		}
		if (onMacOS) {
			dependencies.push({
				name: "kcov",
				required: false,
				available: kcovAvailable,
				path: kcovPath,
				...(kcovAvailable ? { warning: "Partial coverage on macOS due to SIP - use Docker for full coverage" } : {}),
			});
		} else {
			dependencies.push({
				name: "kcov",
				required: true,
				available: kcovAvailable,
				path: kcovPath,
			});
		}

		// Display status report
		console.log("\n📋 System Dependencies:");

		for (const dep of dependencies) {
			const pathInfo = dep.path ? ` (${dep.path})` : "";

			if (dep.warning) {
				console.warn(`   ⚠️  ${dep.name}${pathInfo}`);
				console.warn(`       ${dep.warning}`);
			} else if (dep.available) {
				console.log(`   ✅ ${dep.name}${pathInfo}`);
			} else if (dep.required) {
				console.error(`   ✗ ${dep.name} (required)`);
			} else {
				console.warn(`   ⚠️  ${dep.name} (optional - recommended)`);
			}
		}

		// Check for missing required dependencies
		const missingRequired = dependencies.filter((d) => d.required && !d.available);

		if (missingRequired.length > 0) {
			console.error("\n❌ Missing required dependencies:");
			for (const dep of missingRequired) {
				const installCmd = this.getInstallCommand(dep.name, onMacOS);
				console.error(`   ${dep.name}: ${installCmd}`);
			}
			throw new Error("Required dependencies are missing. Please install them before running tests.");
		}

		console.log(""); // Empty line for readability
	}

	/**
	 * Get installation command for a dependency.
	 *
	 * @param dependency - Dependency name
	 * @param onMacOS - Whether running on macOS
	 * @returns Installation command string
	 *
	 * @internal
	 */
	private getInstallCommand(dependency: string, onMacOS: boolean): string {
		const commands: Record<string, { mac: string; linux: string }> = {
			bats: {
				mac: "brew install bats-core",
				linux: "apt-get install bats",
			},
			"bats-support": {
				mac: "brew install bats-support",
				linux: "apt-get install bats-support",
			},
			"bats-assert": {
				mac: "brew install bats-assert",
				linux: "apt-get install bats-assert",
			},
			"bats-mock": {
				mac: "brew install bats-mock",
				linux: "apt-get install bats-file",
			},
			kcov: {
				mac: "brew install kcov (may not work on older macOS)",
				linux: "apt-get install kcov",
			},
			jq: {
				mac: "brew install jq",
				linux: "apt-get install jq",
			},
		};

		const cmd = commands[dependency];
		return cmd ? (onMacOS ? cmd.mac : cmd.linux) : "See documentation";
	}

	/**
	 * Log a message at verbose level.
	 *
	 * @remarks
	 * Only outputs when `logLevel` is set to `"verbose"` in configuration.
	 * Use for detailed debugging information during coverage collection.
	 *
	 * @param message - Message to log
	 *
	 * @internal
	 */
	private logVerbose(message: string): void {
		if (this.options.kcov.logLevel === "verbose") {
			console.log(message);
		}
	}

	/**
	 * Log a message at debug level.
	 *
	 * @remarks
	 * Outputs when `logLevel` is set to `"verbose"` or `"debug"` in configuration.
	 * Use for general debugging information during coverage operations.
	 *
	 * @param message - Message to log
	 *
	 * @internal
	 */
	private logDebug(message: string): void {
		if (this.options.kcov.logLevel === "verbose" || this.options.kcov.logLevel === "debug") {
			console.log(message);
		}
	}

	/**
	 * Log an error message (always displayed).
	 *
	 * @remarks
	 * Always outputs regardless of `logLevel` setting.
	 * Use for critical errors that prevent coverage collection.
	 *
	 * @param message - Error message to log
	 *
	 * @internal
	 */
	private logError(message: string): void {
		console.error(message);
	}

	/**
	 * Log a warning message (always displayed).
	 *
	 * @remarks
	 * Always outputs regardless of `logLevel` setting.
	 * Use for non-critical issues that may affect coverage results.
	 *
	 * @param message - Warning message to log
	 *
	 * @internal
	 */
	private logWarning(message: string): void {
		console.warn(message);
	}

	/**
	 * Clean coverage directory before test run.
	 *
	 * @remarks
	 * Called by Vitest when coverage directory needs to be cleaned.
	 * Vitest handles coverage directory cleaning automatically, so no action is needed here.
	 */
	async clean(): Promise<void> {
		// Vitest handles coverage directory cleaning automatically
		// No action needed here
	}

	/**
	 * Prepare for coverage collection before tests run.
	 *
	 * @remarks
	 * Called by Vitest before any test files run. Clears the BATS cache directory
	 * to ensure fresh test files are generated for each run.
	 */
	async onBeforeFilesRun(): Promise<void> {
		// Clear the .cache directory to ensure fresh .bats files for all tests
		await BatsHelper.clearCache();
		console.log("🗑️  Cleared .bats cache directory");
	}

	/**
	 * Handle test file changes (no-op).
	 *
	 * @remarks
	 * Called by Vitest when test files change. No action needed because kcov runs
	 * automatically inside BATS tests via the {@link BatsHelper} wrapper.
	 */
	async onTestFilesChange(): Promise<void> {
		// No action needed - kcov runs inside BATS tests automatically
	}

	/**
	 * Handle completion of test file execution (no-op).
	 *
	 * @remarks
	 * Called by Vitest after a test file runs. No action needed because kcov runs
	 * automatically inside BATS tests via the {@link BatsHelper} wrapper.
	 */
	async onAfterFilesRun(): Promise<void> {
		// No action needed - kcov runs inside BATS tests automatically
	}

	/**
	 * Handle completion of test suite execution (no-op).
	 *
	 * @remarks
	 * Called by Vitest after a test suite completes (required by Vitest 4.x).
	 * No action needed because kcov runs automatically inside BATS tests via the {@link BatsHelper} wrapper.
	 */
	async onAfterSuiteRun(): Promise<void> {
		// No action needed - kcov runs inside BATS tests automatically
	}

	/**
	 * Generate merged coverage report from all kcov outputs.
	 *
	 * @remarks
	 * Called by Vitest after all tests complete. This method:
	 *
	 * 1. Locates kcov cache directory with coverage from BATS test runs
	 * 2. Finds all individual kcov output directories
	 * 3. Merges coverage data using `kcov --merge`
	 * 4. Flattens the directory structure for easier access
	 * 5. Fixes HTML file references after moving files
	 *
	 * Coverage was already collected during BATS test execution. This method only
	 * processes and merges the existing kcov output files.
	 *
	 * @throws {Error} If kcov merge command fails or directory operations fail
	 */
	async generateCoverage(): Promise<void> {
		if (!this.available) {
			return;
		}

		const projectRoot = this.ctx.config.root;
		const kcovCacheDir = resolve(this.cacheDir, "kcov");
		const coverageDir = this.resolvedReportsDir;

		try {
			this.logDebug("\n🔍 Merging shell script coverage from kcov...");
			this.logVerbose(`📂 Project root: ${projectRoot}`);
			this.logVerbose(`📂 Cache directory: ${this.cacheDir}`);
			this.logVerbose(`📂 Kcov cache directory: ${kcovCacheDir}`);
			this.logVerbose(`📂 Coverage output directory: ${coverageDir}`);

			// Check if kcov cache directory was created during test runs
			if (!existsSync(kcovCacheDir)) {
				this.logWarning("⚠️  Kcov cache directory does not exist");
				this.logWarning("   Coverage was not collected during test runs");
				this.logWarning("   Make sure kcov is installed and available in PATH");
				return;
			}

			// Find all kcov output directories
			const kcovOutputs = readdirSync(kcovCacheDir, { withFileTypes: true })
				.filter((dirent) => dirent.isDirectory())
				.map((dirent) => resolve(kcovCacheDir, dirent.name));

			this.logDebug(`📋 Found ${kcovOutputs.length} kcov output directories`);

			if (kcovOutputs.length === 0) {
				this.logWarning("⚠️  No kcov output directories found");
				return;
			}

			// Group kcov outputs by script name
			// Directory names follow pattern: "script-name-timestamp-randomid"
			// We need to group by script name so we can merge per-script first
			const scriptGroups = new Map<string, string[]>();

			for (const dir of kcovOutputs) {
				const dirName = dir.split("/").pop() || "";
				// Extract script name (everything before the first timestamp)
				// Example: "info-system-1762740744808-vcf68xt" -> "info-system"
				const scriptName = dirName.replace(/-\d{13,}-[a-z0-9]+$/, "");

				if (!scriptGroups.has(scriptName)) {
					scriptGroups.set(scriptName, []);
				}
				scriptGroups.get(scriptName)?.push(dir);
			}

			this.logDebug(`📦 Found ${scriptGroups.size} unique scripts with coverage data`);

			// Create coverage directory
			const { mkdirSync } = await import("node:fs");
			if (!existsSync(coverageDir)) {
				mkdirSync(coverageDir, { recursive: true });
			}

			// Merge coverage per script first, then merge all scripts
			this.logDebug("\n🔀 Step 1: Merging coverage per script...");

			try {
				const { rmSync } = await import("node:fs");
				const perScriptMerges: string[] = [];
				const tempDir = resolve(kcovCacheDir, "..", "temp-merges");

				// Clean up temp directory if it exists
				if (existsSync(tempDir)) {
					rmSync(tempDir, { recursive: true, force: true });
				}
				mkdirSync(tempDir, { recursive: true });

				// Step 1: Merge coverage for each script separately
				let scriptIndex = 0;
				for (const [scriptName, dirs] of scriptGroups.entries()) {
					scriptIndex++;
					this.logVerbose(`   [${scriptIndex}/${scriptGroups.size}] Merging ${scriptName}: ${dirs.length} test runs`);

					const scriptMergeDir = resolve(tempDir, scriptName);

					try {
						// Merge all coverage for this script
						// Use batches if there are many directories for a single script
						const BATCH_SIZE = 50;
						if (dirs.length <= BATCH_SIZE) {
							// Simple case: merge all at once
							const mergeCommand = `kcov --merge "${scriptMergeDir}" ${dirs.map((d) => `"${d}"`).join(" ")}`;
							execSync(mergeCommand, {
								encoding: "utf-8",
								stdio: "pipe",
								cwd: projectRoot,
							});
						} else {
							// Batch merge for scripts with many test runs
							for (let i = 0; i < dirs.length; i += BATCH_SIZE) {
								const batch = dirs.slice(i, i + BATCH_SIZE);
								const isFirstBatch = i === 0;

								if (isFirstBatch) {
									const mergeCommand = `kcov --merge "${scriptMergeDir}" ${batch.map((d) => `"${d}"`).join(" ")}`;
									execSync(mergeCommand, {
										encoding: "utf-8",
										stdio: "pipe",
										cwd: projectRoot,
									});
								} else {
									const prevMerged = resolve(scriptMergeDir, "kcov-merged");
									const mergeCommand = `kcov --merge "${scriptMergeDir}" "${prevMerged}" ${batch.map((d) => `"${d}"`).join(" ")}`;
									execSync(mergeCommand, {
										encoding: "utf-8",
										stdio: "pipe",
										cwd: projectRoot,
									});
								}
							}
						}

						perScriptMerges.push(scriptMergeDir);
					} catch (error) {
						// Check if this is an E2BIG error (argument list too long)
						const isE2BIG =
							error instanceof Error &&
							(error.message.includes("E2BIG") || error.message.includes("Argument list too long"));

						if (isE2BIG) {
							this.e2bigErrorsEncountered = true;
							this.logWarning(`⚠️  E2BIG error merging ${scriptName} - coverage data may be incomplete`);
							this.logWarning(`   This script has ${dirs.length} test runs which exceeded OS argument limits`);
							this.logDebug(`   Error details: ${error instanceof Error ? error.message : String(error)}`);
							// Continue with other scripts even if this one fails
							continue;
						}

						// For non-E2BIG errors, log and rethrow
						throw error;
					}
				}

				this.logDebug(`\n🔀 Step 2: Merging all ${perScriptMerges.length} scripts into final report...`);

				// Step 2: Merge all per-script results into final coverage
				try {
					const finalMergeCommand = `kcov --merge "${coverageDir}" ${perScriptMerges.map((d) => `"${d}"`).join(" ")}`;
					execSync(finalMergeCommand, {
						encoding: "utf-8",
						stdio: "pipe",
						cwd: projectRoot,
					});

					this.logVerbose(`📤 All coverage merged successfully`);
				} catch (error) {
					// Check if this is an E2BIG error (argument list too long)
					const isE2BIG =
						error instanceof Error &&
						(error.message.includes("E2BIG") || error.message.includes("Argument list too long"));

					if (isE2BIG) {
						this.e2bigErrorsEncountered = true;
						this.logWarning("⚠️  E2BIG error during final merge - coverage data may be incomplete");
						this.logWarning(`   Too many scripts (${perScriptMerges.length}) exceeded OS argument limits`);
						this.logDebug(`   Error details: ${error instanceof Error ? error.message : String(error)}`);
					} else {
						// For non-E2BIG errors, rethrow
						throw error;
					}
				}

				// Clean up temp directory
				rmSync(tempDir, { recursive: true, force: true });

				// Flatten kcov-merged directory to coverage root
				const kcovMergedDir = resolve(coverageDir, "kcov-merged");
				if (existsSync(kcovMergedDir)) {
					this.logDebug("🔄 Flattening kcov-merged directory to coverage root...");

					// Move all files from kcov-merged to coverage root
					const { readdirSync, renameSync, rmSync, readFileSync, writeFileSync } = await import("node:fs");
					const files = readdirSync(kcovMergedDir);

					for (const file of files) {
						const source = resolve(kcovMergedDir, file);
						const dest = resolve(coverageDir, file);

						// Remove existing file/directory at destination if it exists
						if (existsSync(dest)) {
							rmSync(dest, { recursive: true, force: true });
						}

						renameSync(source, dest);

						// Fix HTML file references after moving
						if (file.endsWith(".html")) {
							try {
								let htmlContent = readFileSync(dest, "utf-8");
								// Replace ../data/ with data/ since we're now at the root level
								htmlContent = htmlContent.replace(/\.\.\/(data\/[^"']+)/g, "$1");
								writeFileSync(dest, htmlContent, "utf-8");
							} catch (error) {
								this.logWarning(
									`⚠️  Failed to fix paths in ${file}: ${error instanceof Error ? error.message : String(error)}`,
								);
							}
						}
					}

					// Remove empty kcov-merged directory
					rmSync(kcovMergedDir, { recursive: true, force: true });

					this.logDebug("✅ Coverage structure flattened successfully");
				}

				this.logDebug("✅ Coverage data merged successfully");
				this.logDebug(`📊 Coverage report: ${coverageDir}/index.html`);

				// Warn if E2BIG errors occurred during merge
				if (this.e2bigErrorsEncountered) {
					this.logWarning("\n⚠️  WARNING: E2BIG errors occurred during coverage merging");
					this.logWarning("   Some coverage data may be incomplete or missing");
					this.logWarning("   Consider reducing the number of test files or increasing BATCH_SIZE");
				}
			} catch (error) {
				this.logError("❌ Failed to merge kcov coverage");
				if (error instanceof Error) {
					this.logError(`   Error message: ${error.message}`);
				}
				throw error;
			}
		} catch (error) {
			this.logError(`❌ Failed to collect shell script coverage:${String(error)}`);
			if (error instanceof Error) {
				this.logError(`   Error message: ${error.message}`);
				this.logVerbose(`   Error stack: ${error.stack}`);
			}
		}
	}

	/**
	 * Display coverage results to the user.
	 *
	 * @remarks
	 * Called by Vitest after coverage generation completes. This method either:
	 * - Loads and executes a custom reporter module (if `customReporter` is configured)
	 * - Displays the path to the default HTML report
	 *
	 * Custom reporters must export a class with a `displayCoverageReport()` method.
	 *
	 * Note: On older macOS versions, kcov may not collect accurate coverage data due to SIP.
	 * Newer macOS versions (Sequoia/26.x+) with recent kcov (v43+) may support coverage collection.
	 */
	async reportCoverage(): Promise<void> {
		const projectRoot = this.ctx.config.root;

		try {
			// Use custom reporter if configured
			if (this.options.kcov.customReporter) {
				// Pass the resolved reports directory as a relative path from project root
				const relativeCoverageDir = this.resolvedReportsDir.replace(`${projectRoot}/`, "");
				await this.runCustomReporter(this.options.kcov.customReporter, projectRoot, relativeCoverageDir);
			} else {
				// Default reporting
				const reportPath = resolve(this.resolvedReportsDir, "index.html");
				if (existsSync(reportPath)) {
					const relativePath = this.resolvedReportsDir.replace(`${projectRoot}/`, "");
					this.logDebug(`📊 Coverage report: ${relativePath}/index.html`);
				}
			}
		} catch (error) {
			this.logError(`❌ Failed to report coverage:${String(error)}`);
			throw error; // Re-throw to fail the build when thresholds are not met
		} finally {
			// Restore script permissions after coverage collection
			// This ensures scripts that were temporarily made executable during testing
			// are restored to their original non-executable state
			await this.restoreScriptPermissions();
		}
	}

	/**
	 * Gets the list of scripts to include in coverage collection.
	 *
	 * @remarks
	 * Auto-discovers scripts from BatsHelper.getRegisteredScripts().
	 * Only scripts that are tested via BatsHelper.describe() will be included.
	 *
	 * @returns Array of absolute paths to shell scripts
	 */
	private async getScriptsToInclude(): Promise<string[]> {
		const { BatsHelper } = await import("./vitest-kcov-bats-helper.js");
		const registeredScripts = BatsHelper.getRegisteredScripts();
		this.logDebug(`📋 Auto-discovered ${registeredScripts.length} scripts from BatsHelper`);
		return registeredScripts;
	}

	/**
	 * Restore script permissions to non-executable after tests complete.
	 *
	 * @remarks
	 * During testing, scripts are temporarily made executable so kcov can instrument them.
	 * This method restores all tested scripts to their original non-executable state (644).
	 */
	private async restoreScriptPermissions(): Promise<void> {
		try {
			// Get all scripts to include
			const scripts = await this.getScriptsToInclude();

			let restoredCount = 0;
			let skippedCount = 0;

			for (const script of scripts) {
				try {
					const stats = statSync(script);
					// Check if script is executable (has any execute bit set)
					const isExecutable = (stats.mode & 0o111) !== 0;

					if (isExecutable) {
						// Restore to 644 (rw-r--r--)
						chmodSync(script, 0o644);
						restoredCount++;
						this.logVerbose(`♻️  Restored permissions: ${script}`);
					} else {
						skippedCount++;
					}
				} catch (err) {
					this.logVerbose(`⚠️  Could not restore permissions for ${script}: ${String(err)}`);
				}
			}

			if (restoredCount > 0) {
				this.logDebug(
					`\n🔒 Restored permissions for ${restoredCount} script(s) (${skippedCount} already non-executable)`,
				);
			}
		} catch (error) {
			this.logVerbose(`⚠️  Failed to restore script permissions: ${String(error)}`);
		}
	}

	/**
	 * Load and execute a custom coverage reporter module.
	 *
	 * @remarks
	 * Dynamically imports the custom reporter module and instantiates it with configuration.
	 * The reporter module must export a class (as default or named `KcovCoverageReporter`) with a
	 * `displayCoverageReport()` method.
	 *
	 * **Reporter Interface:**
	 * ```typescript
	 * class CustomReporter {
	 *   constructor(options: {
	 *     projectRoot: string;
	 *     coverageDir: string;
	 *     include: string[];
	 *     logLevel: LogLevel;
	 *   });
	 *   async displayCoverageReport(): Promise<void>;
	 * }
	 * ```
	 *
	 * @param reporterPath - Path to reporter module (relative to project root, .ts or .js)
	 * @param projectRoot - Absolute path to project root directory
	 * @param coverageDir - Coverage output directory (relative to project root)
	 *
	 * @internal
	 */
	private async runCustomReporter(reporterPath: string, projectRoot: string, coverageDir: string): Promise<void> {
		try {
			// Resolve the reporter path relative to project root
			// Convert .ts to .js for the compiled output
			const jsPath = reporterPath.replace(/\.ts$/, ".js");
			const absoluteReporterPath = resolve(projectRoot, jsPath);
			// Convert to file URL for proper import
			const reporterUrl = `file://${absoluteReporterPath}`;
			const reporterModule = await import(reporterUrl);
			const Reporter = reporterModule.default || reporterModule.KcovCoverageReporter;

			if (!Reporter) {
				this.logWarning(`⚠️  No default export found in custom reporter: ${reporterPath}`);
				return;
			}

			const reporter = new Reporter({
				projectRoot,
				coverageDir,
				include: await this.getScriptsToInclude(),
				logLevel: this.options.kcov.logLevel,
				links: this.options.kcov.links,
				hasE2BIGErrors: this.e2bigErrorsEncountered,
				thresholds: this.options.kcov.thresholds as {
					perFile?: boolean;
					lines?: number;
					branches?: number;
				},
			});

			// The reporter will read kcov's coverage.json and display results
			await reporter.displayCoverageReport();
		} catch (error) {
			this.logError(`❌ Failed to run custom reporter:${String(error)}`);
			if (error instanceof Error) {
				this.logError(`   Error message: ${error.message}`);
			}
		}
	}

	/**
	 * Parse and return structured coverage data from kcov results.
	 *
	 * @remarks
	 * Reads kcov's `coverage.json` file and returns a structured summary with:
	 * - Per-file coverage statistics (lines covered, total lines, percentage)
	 * - Aggregated totals across all files
	 * - Overall coverage percentage
	 *
	 * Returns `undefined` if:
	 * - Coverage collection is disabled
	 * - kcov is not available
	 * - No coverage.json file was generated
	 * - JSON parsing fails
	 *
	 * **kcov's coverage.json format:**
	 * ```json
	 * {
	 *   "files": [
	 *     {
	 *       "file": "/path/to/script.sh",
	 *       "totalLines": 100,
	 *       "coveredLines": 85,
	 *       "percent": 85.0
	 *     }
	 *   ]
	 * }
	 * ```
	 *
	 * @returns Coverage summary with file-level and aggregate statistics, or `undefined`
	 */
	async getCoverageSummary(): Promise<CoverageSummary | undefined> {
		if (!this.available) {
			return undefined;
		}

		// kcov generates coverage.json with coverage data
		const coverageJsonPath = resolve(this.resolvedReportsDir, "coverage.json");

		// Check if kcov generated coverage
		if (!existsSync(coverageJsonPath)) {
			return undefined;
		}

		try {
			const coverageData = JSON.parse(readFileSync(coverageJsonPath, "utf-8"));

			// Parse kcov's coverage.json format
			const summary: CoverageSummary = {
				files: [],
				totalLines: 0,
				coveredLines: 0,
				percentage: 0,
			};

			// kcov's coverage.json has a "files" array with coverage info
			if (coverageData.files && Array.isArray(coverageData.files)) {
				for (const file of coverageData.files) {
					const fileSummary: FileCoverageSummary = {
						path: file.file || "",
						totalLines: file.totalLines || 0,
						coveredLines: file.coveredLines || 0,
						uncoveredLines: (file.totalLines || 0) - (file.coveredLines || 0),
						percentage: file.percent || 0,
					};

					summary.files.push(fileSummary);
					summary.totalLines += fileSummary.totalLines;
					summary.coveredLines += fileSummary.coveredLines;
				}
			}

			summary.percentage = summary.totalLines > 0 ? (summary.coveredLines / summary.totalLines) * 100 : 0;

			return summary;
		} catch (error) {
			this.logWarning(`⚠️  Failed to parse kcov coverage data:${String(error)}`);
			return undefined;
		}
	}
}

/**
 * Vitest coverage provider module for kcov integration.
 *
 * @remarks
 * This is the entry point used by Vitest to load the custom coverage provider.
 * It must be specified in vitest.config.ts as the `customProviderModule`.
 *
 * **Usage in vitest.config.ts:**
 * ```typescript
 * export default defineConfig({
 *   test: {
 *     coverage: {
 *       enabled: true,
 *       provider: "custom",
 *       customProviderModule: "./lib/vitest-kcov-plugin/vitest-kcov-provider.ts",
 *       kcov: {
 *         // kcov configuration options
 *       },
 *     },
 *   },
 * });
 * ```
 *
 * The module provides both `getProvider()` (Vitest 4.x) and `takeCoverage()` (older versions)
 * for compatibility across Vitest versions.
 */
const KcovCoverageProviderModule: CoverageProviderModule = {
	/**
	 * Get a new coverage provider instance.
	 *
	 * @remarks
	 * Called by Vitest 4.x and later to create the coverage provider.
	 *
	 * @returns A new {@link KcovCoverageProvider} instance
	 */
	getProvider(): CoverageProvider {
		return new KcovCoverageProvider();
	},

	/**
	 * Get a new coverage provider instance (legacy API).
	 *
	 * @remarks
	 * Called by older Vitest versions (pre-4.x) to create the coverage provider.
	 * Provides backward compatibility with earlier Vitest APIs.
	 *
	 * @returns A new {@link KcovCoverageProvider} instance
	 */
	takeCoverage(): CoverageProvider {
		return new KcovCoverageProvider();
	},
};

export default KcovCoverageProviderModule;
