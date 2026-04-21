/**
 * Custom Vitest Coverage Reporter for kcov
 *
 * @remarks
 * This reporter integrates kcov's shell script coverage data into Vitest's test output.
 * It reads kcov's generated `coverage.json` file and displays coverage statistics
 * in Istanbul-style table formatting, matching Vitest's default coverage output style.
 *
 * **Key Features:**
 * - Istanbul-style table formatting for terminal output
 * - Color-coded coverage percentages (green >= 80%, yellow >= 60%, red < 60%)
 * - File filtering via glob patterns
 * - Per-file and aggregate coverage statistics
 *
 * @packageDocumentation
 */

import { resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { minimatch } from "minimatch";
import type { Reporter, SerializedError, TestModule, TestRunEndReason, Vitest } from "vitest/node";
import { HTELink } from "./hte-link.js";
import { isMacOS } from "./platform-utils.js";
import type { LinkFormat, LogLevel } from "./vitest-kcov-types.js";

/**
 * Coverage thresholds configuration.
 *
 * @remarks
 * Defines minimum coverage percentages required for tests to pass.
 * For shell scripts, only lines and branches are applicable.
 */
interface CoverageThresholds {
	/** Enforce thresholds per file instead of globally (default: true) */
	perFile?: boolean;
	/** Minimum line coverage percentage (0-100) */
	lines?: number;
	/** Minimum branch coverage percentage (0-100) */
	branches?: number;
}

/**
 * Configuration options for the kcov coverage reporter.
 *
 * @remarks
 * These options control how coverage data is read, filtered, and displayed.
 */
interface KcovReporterOptions {
	/** Project root directory (default: process.cwd()) */
	projectRoot?: string;
	/** Coverage output directory relative to project root (default: "coverage") */
	coverageDir?: string;
	/** Glob patterns for files to include in coverage report (default: ["**\/*.sh"]) */
	include?: string[];
	/** Log verbosity level (default: "errors-only") */
	logLevel?: LogLevel;
	/** Hyperlink format for terminal output (default: "auto") */
	links?: LinkFormat;
	/** Maximum columns for terminal output (default: 80) */
	maxCols?: number;
	/** Whether E2BIG errors occurred during merge operations */
	hasE2BIGErrors?: boolean;
	/** Coverage thresholds configuration */
	thresholds?: CoverageThresholds;
}

/**
 * Coverage statistics for a single file.
 *
 * @remarks
 * Contains detailed line-level and branch-level coverage information extracted from kcov data.
 */
interface FileStats {
	/** Absolute path to the covered file */
	path: string;
	/** Total number of executable lines in the file */
	totalLines: number;
	/** Number of lines that were executed during tests */
	coveredLines: number;
	/** Number of lines that were not executed during tests */
	uncoveredLines: number;
	/** String representation of uncovered line ranges (e.g., "12-15,23,45-50") */
	uncoveredLineRanges: string;
	/** Line coverage percentage (0-100) */
	percentage: number;
	/** Branch coverage percentage (0-100) from kcov/cobertura */
	branchPercentage: number;
}

/**
 * Aggregated coverage summary across all files.
 *
 * @remarks
 * Provides overall coverage statistics by combining data from all tested files.
 */
interface CoverageSummary {
	/** Coverage statistics for individual files */
	files: FileStats[];
	/** Total number of executable lines across all files */
	totalLines: number;
	/** Total number of covered lines across all files */
	coveredLines: number;
	/** Overall line coverage percentage (0-100) */
	percentage: number;
	/** Overall branch coverage percentage (0-100) - averaged from files */
	branchPercentage: number;
}

/**
 * Coverage data extracted from cobertura.xml for a single file.
 *
 * @remarks
 * Contains both line and branch coverage information from cobertura.xml.
 */
interface CoberturaFileData {
	/** Array of uncovered line numbers */
	uncoveredLines: number[];
	/** Branch coverage rate (0.0-1.0) */
	branchRate: number;
}

/**
 * Kcov's file-level coverage data format.
 *
 * @remarks
 * Represents the structure of individual file entries in kcov's `coverage.json`.
 * Note that kcov returns numeric values as strings in some fields.
 *
 * @internal
 */
interface KcovFileCoverage {
	/** Absolute path to the covered file */
	file: string;
	/** Coverage percentage as string (e.g., "62.15") */
	percent_covered: string;
	/** Covered line ranges as string */
	covered_lines: string;
	/** Total number of executable lines */
	total_lines: number;
	/** Number of instrumented lines (optional) */
	instrumented_lines?: number;
}

/**
 * Kcov's top-level coverage data format.
 *
 * @remarks
 * Represents the structure of kcov's `coverage.json` file at the root level.
 * Contains aggregate statistics and per-file coverage data.
 *
 * @internal
 */
interface KcovCoverageData {
	/** Overall coverage percentage as string (e.g., "62.15") */
	percent_covered: string;
	/** Total number of covered lines across all files */
	covered_lines: number;
	/** Total number of executable lines across all files */
	total_lines: number;
	/** Array of per-file coverage data */
	files: KcovFileCoverage[];
}

/**
 * Custom Vitest reporter that displays kcov shell script coverage data.
 *
 * @remarks
 * This reporter implements Vitest's {@link Reporter} interface to integrate kcov
 * coverage data into Vitest's test output. It reads kcov's generated `coverage.json`
 * file and displays coverage statistics in Istanbul-style table formatting.
 *
 * **Features:**
 * - Reads kcov's coverage.json after all tests complete
 * - Filters files by glob patterns (e.g., "**\/*.sh")
 * - Displays per-file and aggregate coverage statistics
 * - Color-coded percentages for easy identification of coverage gaps
 * - Terminal output width configuration
 *
 * **Reporter Lifecycle:**
 * 1. `onInit()` - Initialize reporter with Vitest context
 * 2. `onTestModuleStart()` - Track test file starts
 * 3. `onTestModuleEnd()` - Track test file completions
 * 4. `onTestRunEnd()` - Display coverage report after all tests
 *
 * @example
 * ```typescript
 * // Used by KcovCoverageProvider
 * const reporter = new KcovCoverageReporter({
 *   projectRoot: "/path/to/project",
 *   coverageDir: "coverage",
 *   include: ["plugins/workflow/scripts/**\/*.sh"],
 *   logLevel: "errors-only",
 *   maxCols: 120
 * });
 * await reporter.displayCoverageReport();
 * ```
 */
export class KcovCoverageReporter implements Reporter {
	/** Project root directory for resolving relative paths */
	private projectRoot: string;

	/** Coverage output directory (relative to project root) */
	private coverageDir: string;

	/** Glob patterns for filtering files to include in report */
	private include: string[];

	/** Log verbosity level */
	private logLevel: LogLevel;

	/** Hyperlink generator for terminal output */
	private linker: HTELink;

	/** Maximum columns for terminal output */
	private maxCols: number;

	/** Set of test files that have started execution */
	private testFilesStarted: Set<string>;

	/** Set of test files that have completed execution */
	private testFilesCompleted: Set<string>;

	/** Whether E2BIG errors occurred during merge operations */
	private hasE2BIGErrors: boolean;

	/** Coverage thresholds configuration */
	private thresholds: CoverageThresholds;

	/**
	 * Creates a new kcov coverage reporter instance.
	 *
	 * @remarks
	 * Initializes the reporter with configuration options. All options have sensible
	 * defaults if not provided.
	 *
	 * @param opts - Reporter configuration options
	 *
	 * @example
	 * ```typescript
	 * const reporter = new KcovCoverageReporter({
	 *   projectRoot: process.cwd(),
	 *   coverageDir: "coverage",
	 *   include: ["**\/*.sh"],
	 *   logLevel: "errors-only"
	 * });
	 * ```
	 */
	constructor(opts: KcovReporterOptions) {
		this.projectRoot = opts.projectRoot || process.cwd();
		this.coverageDir = opts.coverageDir || "coverage";
		this.include = opts.include || ["**/*.sh"];
		this.logLevel = opts.logLevel || "errors-only";
		this.linker = new HTELink({ mode: opts.links || "auto" });
		this.maxCols = opts.maxCols || 120;
		this.testFilesStarted = new Set();
		this.testFilesCompleted = new Set();
		this.hasE2BIGErrors = opts.hasE2BIGErrors || false;
		this.thresholds = opts.thresholds || {};
	}

	/**
	 * Initialize the reporter with Vitest context.
	 *
	 * @remarks
	 * Called by Vitest when the reporter is initialized. This implementation is silent
	 * and lets Vitest's default reporter handle test output.
	 *
	 * @param _ctx - Vitest context instance (unused)
	 */
	onInit(_ctx: Vitest): void {
		// Silent initialization - Vitest's default reporter handles test output
	}

	/**
	 * Handle the start of a test module execution.
	 *
	 * @remarks
	 * Called by Vitest when a test file starts running. Tracks which test files
	 * have started for internal bookkeeping.
	 *
	 * @param testModule - The test module that started
	 */
	onTestModuleStart(testModule: TestModule): void {
		const fileName = testModule.moduleId;
		this.testFilesStarted.add(fileName);
	}

	/**
	 * Handle the completion of a test module execution.
	 *
	 * @remarks
	 * Called by Vitest when a test file finishes running. Tracks which test files
	 * have completed for internal bookkeeping.
	 *
	 * @param testModule - The test module that completed
	 */
	onTestModuleEnd(testModule: TestModule): void {
		const fileName = testModule.moduleId;
		this.testFilesCompleted.add(fileName);
	}

	/**
	 * Handle the end of the entire test run and display coverage report.
	 *
	 * @remarks
	 * Called by Vitest after all tests have completed. This is where the coverage
	 * report is read from kcov's output and displayed to the terminal. Errors are
	 * caught and logged, and resources are always cleaned up in the finally block.
	 *
	 * @param _testModules - Array of all test modules (unused)
	 * @param _unhandledErrors - Array of unhandled errors during test run (unused)
	 * @param _reason - Reason for test run ending (unused)
	 *
	 * @throws {Error} Errors are caught internally and logged, not re-thrown
	 */
	async onTestRunEnd(
		_testModules: ReadonlyArray<TestModule>,
		_unhandledErrors: ReadonlyArray<SerializedError>,
		_reason: TestRunEndReason,
	): Promise<void> {
		try {
			// Read and display coverage data (after Vitest's default test output)
			await this.displayCoverageReport();
		} catch (error) {
			this.logError(`\n❌ Reporter error:${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Clean up resources
			this.cleanup();
		}
	}

	/**
	 * Read and display coverage report from kcov's coverage.json file.
	 *
	 * @remarks
	 * This method:
	 * 1. Checks for coverage directory existence
	 * 2. Reads and parses kcov's coverage.json file
	 * 3. Extracts coverage statistics with file filtering
	 * 4. Displays coverage summary in Istanbul-style table format
	 *
	 * Returns early with warnings if coverage directory or data is missing.
	 * Displays appropriate error messages for JSON parsing failures.
	 *
	 * @throws {Error} If coverage.json parsing fails or data is invalid
	 *
	 * @example
	 * ```typescript
	 * await reporter.displayCoverageReport();
	 * // Displays:
	 * // % Coverage report from kcov
	 * // ----------------------------------------|---------|-------------------
	 * // File                                    | % Lines | Uncovered Line #s
	 * // ----------------------------------------|---------|-------------------
	 * // scripts/utils/info-system.sh            |   85.71 | 45-50,67
	 * // ```
	 */
	async displayCoverageReport(): Promise<void> {
		const coveragePath = resolve(this.projectRoot, this.coverageDir);
		const indexPath = resolve(coveragePath, "index.html");
		const coverageJsonPath = resolve(coveragePath, "coverage.json");
		const onMacOS = isMacOS();

		// Use async fs/promises for existence and reading
		const { stat, readFile } = await import("node:fs/promises");

		let coverageExists = false;
		try {
			await stat(coveragePath);
			coverageExists = true;
		} catch {
			// Coverage directory doesn't exist
			if (!onMacOS) {
				this.logDebug("\n📊 Coverage directory not found, skipping report");
				return;
			}
		}

		let coverageJsonExists = false;
		if (coverageExists) {
			try {
				await stat(coverageJsonPath);
				coverageJsonExists = true;
			} catch {
				// coverage.json doesn't exist
			}
		}

		// If no coverage data on macOS, show 0% report with warning
		if (onMacOS && !coverageJsonExists) {
			this.displayMacOSNoCoverageReport();
			return;
		}

		// If no coverage data on Linux, show warning and return
		if (!coverageJsonExists) {
			this.logWarning("\n⚠️  No kcov coverage data found");
			this.logWarning("   Coverage may not have been collected for shell scripts");
			return;
		}

		try {
			// Read and parse kcov coverage data
			const fileContent = await readFile(coverageJsonPath, "utf-8");
			const coverageData = JSON.parse(fileContent) as KcovCoverageData;

			// Validate coverage data structure
			if (!coverageData || typeof coverageData !== "object") {
				throw new Error("Invalid coverage data structure");
			}

			// Extract coverage summary (with uncovered line ranges from cobertura.xml)
			const summary = await this.extractCoverageSummary(coverageData);

			// Display coverage summary first (before threshold validation)
			// This provides better UX: users see the full coverage report and can identify
			// which files failed and by how much, even when thresholds are not met.
			this.displayCoverageSummary(summary, indexPath);

			// Check coverage thresholds and throw error if not met
			this.checkCoverageThresholds(summary);
		} catch (error) {
			if (error instanceof SyntaxError) {
				this.logError("\n❌ Failed to parse coverage data: Invalid JSON format");
			} else if (error instanceof Error) {
				this.logError(`\n❌ Error reading kcov coverage: ${error.message}`);
			} else {
				this.logError("\n❌ Unknown error reading kcov coverage");
			}
			throw error;
		}
	}

	/**
	 * Display a coverage report for macOS when kcov data is not available.
	 *
	 * @remarks
	 * On macOS, kcov cannot collect coverage due to System Integrity Protection (SIP).
	 * This method displays a 0% coverage report with a warning message explaining
	 * the limitation and suggesting Docker as an alternative.
	 *
	 * @internal
	 */
	private displayMacOSNoCoverageReport(): void {
		// Calculate column widths (matching istanbul text reporter layout)
		const fileColWidth = 40;
		const pctColWidth = 9;
		const uncoveredColWidth = this.maxCols - fileColWidth - pctColWidth - 4; // 4 for separators

		// Display header in istanbul style
		console.log("\n % Coverage report from kcov");
		const headerSep = `${"-".repeat(fileColWidth)}|${"-".repeat(pctColWidth)}|${"-".repeat(uncoveredColWidth)}`;
		console.log(headerSep);

		const fileHeader = "File".padEnd(fileColWidth - 1);
		const pctHeader = "% Lines".padStart(pctColWidth - 1);
		const uncoveredHeader = "Uncovered Line #s";

		console.log(`${fileHeader} |${pctHeader} | ${uncoveredHeader}`);
		console.log(headerSep);

		// Overall summary with 0% coverage
		const linesPct = "0.00";
		const linesColor = this.getCoverageColor(0);
		const linesCoverage = "(0/0)";

		console.log(
			`${"All files".padEnd(fileColWidth - 1)} |${linesColor}${linesPct.padStart(6)}${this.getResetColor()} | ${linesCoverage}`,
		);
		console.log(headerSep);
		console.log("");

		// Display macOS-specific warning
		console.warn("⚠️  Coverage collection is not supported on macOS");
		console.warn("   Kcov requires ptrace which is blocked by System Integrity Protection (SIP)");
		console.warn("   Tests ran successfully, but coverage data was not collected");
		console.log("");
		console.log("💡 To collect coverage on macOS:");
		console.log("   - Use Docker: pnpm test:docker");
		console.log("   - Run tests in CI/CD (Linux environment)");
		console.log("");
	}

	/**
	 * Clean up resources used by the reporter.
	 *
	 * @remarks
	 * Clears internal tracking sets to free memory. Called in the finally block
	 * of {@link onTestRunEnd} to ensure cleanup always happens.
	 *
	 * @internal
	 */
	private cleanup(): void {
		this.testFilesStarted.clear();
		this.testFilesCompleted.clear();
	}

	/**
	 * Log a message at debug level.
	 *
	 * @remarks
	 * Only outputs when `logLevel` is set to `"verbose"` or `"debug"` in configuration.
	 * Use for general debugging information during coverage reporting.
	 *
	 * @param message - Message to log
	 *
	 * @internal
	 */
	private logDebug(message: string): void {
		if (this.logLevel === "verbose" || this.logLevel === "debug") {
			console.log(message);
		}
	}

	/**
	 * Log an error message (always displayed).
	 *
	 * @remarks
	 * Always outputs regardless of `logLevel` setting.
	 * Use for critical errors that prevent coverage reporting.
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
	 * Check if a file path matches any of the configured include glob patterns.
	 *
	 * @remarks
	 * Converts the absolute file path to a relative path from project root, then
	 * tests it against all configured glob patterns. Uses minimatch for pattern matching
	 * with `matchBase: true` to allow matching on the basename.
	 *
	 * @param filePath - Absolute file path to test
	 * @returns `true` if the file matches any include pattern, `false` otherwise
	 *
	 * @example
	 * ```typescript
	 * // With include: ["**\/*.sh"]
	 * matchesIncludeGlob("/path/to/scripts/utils/info-system.sh"); // true
	 * matchesIncludeGlob("/path/to/lib/helper.js"); // false
	 * ```
	 *
	 * @internal
	 */
	private matchesIncludeGlob(filePath: string): boolean {
		// Check if any include pattern is an absolute path that matches exactly
		if (this.include.some((pattern) => pattern === filePath)) {
			return true;
		}

		// Get relative path from project root for glob matching
		const relativePath = filePath.replace(this.projectRoot, "").replace(/^\//, "");

		// Check if file matches any of the include globs
		return this.include.some((glob) => {
			// If the glob is an absolute path, convert to relative for comparison
			if (glob.startsWith("/")) {
				const relativeGlob = glob.replace(this.projectRoot, "").replace(/^\//, "");
				return minimatch(relativePath, relativeGlob, { matchBase: true });
			}
			return minimatch(relativePath, glob, { matchBase: true });
		});
	}

	/**
	 * Extract coverage summary from kcov's coverage data.
	 *
	 * @remarks
	 * Parses kcov's coverage.json format and builds a structured summary with:
	 * - Overall aggregate statistics (total/covered lines, percentage)
	 * - Per-file coverage statistics (filtered by include globs)
	 * - Uncovered line ranges from cobertura.xml
	 *
	 * Files that don't match the include patterns are excluded from the summary.
	 *
	 * @param coverageData - Raw coverage data from kcov's coverage.json
	 * @returns Structured coverage summary with filtered file list
	 *
	 * @internal
	 */
	private async extractCoverageSummary(coverageData: KcovCoverageData): Promise<CoverageSummary> {
		const summary: CoverageSummary = {
			files: [],
			// Use top-level summary from kcov data
			totalLines: coverageData.total_lines || 0,
			coveredLines: coverageData.covered_lines || 0,
			percentage: Number.parseFloat(coverageData.percent_covered || "0"),
			branchPercentage: 0,
		};

		// Parse cobertura.xml to get coverage data for each file
		const coverageMap = await this.parseCoberturaCoverage();

		let totalBranchPercentage = 0;
		let fileCount = 0;

		// Parse each file's coverage data
		if (coverageData.files && Array.isArray(coverageData.files)) {
			for (const file of coverageData.files) {
				// If include list is not empty, filter by include globs
				// If include list is empty, show all files from coverage.json
				if (this.include.length > 0 && !this.matchesIncludeGlob(file.file)) {
					continue;
				}

				const fileStats = this.analyzeFileCoverage(file);

				// Add uncovered line ranges and branch coverage from cobertura data
				const coberturaData = coverageMap.get(file.file);
				if (coberturaData) {
					fileStats.uncoveredLineRanges = this.convertLinesToRanges(coberturaData.uncoveredLines);
					fileStats.branchPercentage = coberturaData.branchRate * 100;
				} else {
					fileStats.uncoveredLineRanges = "";
					// Default to 100% branch coverage when cobertura data is missing.
					// This is consistent with kcov's behavior: kcov always reports 100% branch coverage
					// for bash scripts (branch-rate="1.0" in cobertura.xml).
					fileStats.branchPercentage = 100;
				}

				summary.files.push(fileStats);

				// Accumulate branch percentage for averaging
				totalBranchPercentage += fileStats.branchPercentage;
				fileCount++;
			}
		}

		// Calculate average branch percentage across all files
		// Note: Uses simple average (not weighted by file size) unlike line coverage.
		// Since kcov always reports 100% branch coverage for bash scripts, the result
		// will always be 100% regardless of averaging method.
		if (fileCount > 0) {
			summary.branchPercentage = totalBranchPercentage / fileCount;
		} else {
			// Edge case: no files matched the include patterns.
			// Default to 100% (consistent with kcov's behavior).
			// Note: If thresholds are configured, checkCoverageThresholds() will catch
			// this condition and throw an error at line 1355.
			summary.branchPercentage = 100;
		}

		return summary;
	}

	/**
	 * Analyze coverage statistics for a single file from kcov data.
	 *
	 * @remarks
	 * Extracts and calculates coverage metrics from kcov's per-file data:
	 * - Total lines from kcov data
	 * - Coverage percentage (parsed from string)
	 * - Covered lines (calculated from percentage)
	 * - Uncovered lines (calculated as difference)
	 *
	 * Note: Uncovered line ranges and branch coverage will be populated from cobertura.xml data.
	 *
	 * @param file - Kcov's coverage data for a single file
	 * @returns Structured file coverage statistics
	 *
	 * @internal
	 */
	private analyzeFileCoverage(file: KcovFileCoverage): FileStats {
		const totalLines = file.total_lines || 0;
		const percentage = Number.parseFloat(file.percent_covered || "0");
		const coveredLines = Math.round((totalLines * percentage) / 100);
		const uncoveredLines = totalLines - coveredLines;

		// Uncovered line ranges and branch coverage will be populated from cobertura.xml
		const uncoveredLineRanges = "";

		return {
			path: file.file,
			totalLines,
			coveredLines,
			uncoveredLines,
			uncoveredLineRanges,
			percentage,
			branchPercentage: 100, // Will be updated from cobertura data
		};
	}

	/**
	 * Convert an array of line numbers to a compact range string.
	 *
	 * @remarks
	 * Converts a list of line numbers into a compact string representation with ranges.
	 * Consecutive lines are combined into ranges (e.g., "83-86"), while isolated lines
	 * are kept as single numbers.
	 *
	 * @param lines - Array of line numbers (will be sorted internally)
	 * @returns Compact range string (e.g., "12-15,23,45-50")
	 *
	 * @example
	 * ```typescript
	 * convertLinesToRanges([83, 84, 85, 86, 96, 102, 103]);
	 * // Returns: "83-86,96,102-103"
	 *
	 * convertLinesToRanges([10]);
	 * // Returns: "10"
	 *
	 * convertLinesToRanges([]);
	 * // Returns: ""
	 * ```
	 *
	 * @internal
	 */
	private convertLinesToRanges(lines: number[]): string {
		if (lines.length === 0) {
			return "";
		}

		// Sort lines in ascending order
		const sortedLines = [...lines].sort((a, b) => a - b);

		const ranges: string[] = [];
		let start = sortedLines[0];
		let end = sortedLines[0];

		for (let i = 1; i < sortedLines.length; i++) {
			if (sortedLines[i] === end + 1) {
				// Consecutive line, extend the range
				end = sortedLines[i];
			} else {
				// Gap found, save the current range
				ranges.push(start === end ? `${start}` : `${start}-${end}`);
				start = sortedLines[i];
				end = sortedLines[i];
			}
		}

		// Add the final range
		ranges.push(start === end ? `${start}` : `${start}-${end}`);

		return ranges.join(",");
	}

	/**
	 * Parse cobertura.xml to extract coverage data for each file.
	 *
	 * @remarks
	 * Reads and parses kcov's cobertura.xml file to extract line-level and branch coverage data.
	 * Returns a map of file paths to coverage data (uncovered lines and branch rate).
	 *
	 * @returns Map of absolute file paths to coverage data (uncovered lines and branch rate)
	 *
	 * @internal
	 */
	private async parseCoberturaCoverage(): Promise<Map<string, CoberturaFileData>> {
		const coveragePath = resolve(this.projectRoot, this.coverageDir);
		const coberturaPath = resolve(coveragePath, "cobertura.xml");

		const coverageMap = new Map<string, CoberturaFileData>();

		// Use async fs/promises for reading
		const { stat, readFile } = await import("node:fs/promises");

		// Check if cobertura.xml exists
		try {
			await stat(coberturaPath);
		} catch {
			// Cobertura file doesn't exist
			this.logDebug("\n📊 Cobertura.xml not found, skipping coverage parsing");
			return coverageMap;
		}

		try {
			// Read the XML file
			const xmlContent = await readFile(coberturaPath, "utf-8");

			// Parse XML with fast-xml-parser
			const parser = new XMLParser({
				ignoreAttributes: false,
				attributeNamePrefix: "@_",
			});

			const parsed = parser.parse(xmlContent);

			// Extract the source path from <sources><source>
			const sources = parsed?.coverage?.sources?.source;
			const sourcePath = Array.isArray(sources) ? sources[0] : sources;

			// Navigate the XML structure to find classes and lines
			const packages = parsed?.coverage?.packages?.package;
			if (!packages) {
				this.logDebug("\n📊 No package data found in cobertura.xml");
				return coverageMap;
			}

			// Handle both single package and array of packages
			const packageList = Array.isArray(packages) ? packages : [packages];

			for (const pkg of packageList) {
				const classes = pkg?.classes?.class;
				if (!classes) continue;

				// Handle both single class and array of classes
				const classList = Array.isArray(classes) ? classes : [classes];

				for (const cls of classList) {
					const filename = cls["@_filename"];
					if (!filename) continue;

					// Resolve relative filename to absolute path using source path from XML
					const absolutePath = this.resolveCobertulaFilePath(filename, sourcePath);

					// Extract branch rate (default to 1.0 if not present)
					// Note: Kcov always reports branch-rate="1.0" (100%) for bash scripts.
					// This value exists for format compatibility but is not meaningful for shell scripts.
					const branchRate = Number.parseFloat(cls["@_branch-rate"] || "1.0");

					const lines = cls?.lines?.line;
					if (!lines) {
						// No line data, but still track branch rate
						coverageMap.set(absolutePath, { uncoveredLines: [], branchRate });
						continue;
					}

					// Handle both single line and array of lines
					const lineList = Array.isArray(lines) ? lines : [lines];

					// Extract uncovered lines (hits="0")
					const uncoveredLines: number[] = [];
					for (const line of lineList) {
						const lineNumber = Number.parseInt(line["@_number"], 10);
						const hits = Number.parseInt(line["@_hits"], 10);

						if (hits === 0 && !Number.isNaN(lineNumber)) {
							uncoveredLines.push(lineNumber);
						}
					}

					// Store both uncovered lines and branch rate
					coverageMap.set(absolutePath, { uncoveredLines, branchRate });
				}
			}
		} catch (error) {
			this.logError(`\n❌ Error parsing cobertura.xml: ${error instanceof Error ? error.message : String(error)}`);
		}

		return coverageMap;
	}

	/**
	 * Resolve a cobertura.xml relative filename to an absolute path.
	 *
	 * @remarks
	 * Cobertura.xml files contain relative paths (e.g., "utils/info-system.sh").
	 * The source path prefix is defined in the XML's sources element.
	 * This method combines the source prefix with the relative filename.
	 *
	 * @param filename - Relative filename from cobertura.xml
	 * @param sourcePath - Source path from cobertura.xml's sources element
	 * @returns Absolute file path
	 *
	 * @example
	 * ```typescript
	 * // With source="/workspace/plugins/workflow/scripts/"
	 * resolveCobertulaFilePath("utils/info-system.sh", "/workspace/plugins/workflow/scripts/");
	 * // Returns: "/workspace/plugins/workflow/scripts/utils/info-system.sh"
	 * ```
	 *
	 * @internal
	 */
	private resolveCobertulaFilePath(filename: string, sourcePath?: string): string {
		// If filename is already absolute, return it
		if (filename.startsWith("/")) {
			return filename;
		}

		// If we have a source path from the XML, use it
		if (sourcePath) {
			// Ensure source path ends with /
			const normalizedSource = sourcePath.endsWith("/") ? sourcePath : `${sourcePath}/`;
			return `${normalizedSource}${filename}`;
		}

		// Fallback: construct path based on project structure
		const scriptBasePath = resolve(this.projectRoot, "plugins/workflow/scripts");
		return resolve(scriptBasePath, filename);
	}

	/**
	 * Display coverage summary in Istanbul-style table format.
	 *
	 * @remarks
	 * Outputs a formatted table to the console with:
	 * - Header with column titles (File, % Lines, Uncovered Line #s)
	 * - Per-file coverage rows with color-coded percentages
	 * - Footer with aggregate statistics
	 *
	 * **Color Scheme:**
	 * - Green (>= 80%): Good coverage
	 * - Yellow (>= 60%): Moderate coverage
	 * - Red (< 60%): Poor coverage
	 *
	 * **Table Layout:**
	 * ```
	 * % Coverage report from kcov
	 * ----------------------------------------|---------|-------------------
	 * File                                    | % Lines | Uncovered Line #s
	 * ----------------------------------------|---------|-------------------
	 * scripts/utils/info-system.sh            |   85.71 | 45-50,67
	 * ----------------------------------------|---------|-------------------
	 * All files                               |   82.15 | (123/150)
	 * ----------------------------------------|---------|-------------------
	 * ```
	 *
	 * @param summary - Coverage summary with per-file and aggregate statistics
	 * @param htmlReportPath - Path to HTML coverage report for display in success message
	 *
	 * @internal
	 */
	private displayCoverageSummary(summary: CoverageSummary, htmlReportPath: string): void {
		// Only show branches column if a branch threshold is configured
		const showBranches = this.thresholds.branches !== undefined;

		// Calculate column widths (matching istanbul text reporter layout)
		const fileColWidth = 40;
		const pctColWidth = 9;
		const branchColWidth = showBranches ? 11 : 0; // "% Branches" column (conditional)
		const separatorCount = showBranches ? 6 : 4; // Adjust separator count based on columns
		const uncoveredColWidth = this.maxCols - fileColWidth - pctColWidth - branchColWidth - separatorCount;

		// Find common base path for smarter display names
		const commonBase = this.findCommonBasePath(summary.files.map((f) => f.path));

		// Display header in istanbul style
		console.log("\n % Coverage report from kcov");

		// Build header separator with conditional branch column
		let headerSep = `${"-".repeat(fileColWidth)}|${"-".repeat(pctColWidth)}`;
		if (showBranches) {
			headerSep += `|${"-".repeat(branchColWidth)}`;
		}
		headerSep += `|${"-".repeat(uncoveredColWidth)}`;
		console.log(headerSep);

		// Build header row with conditional branch column
		const fileHeader = "File".padEnd(fileColWidth - 1);
		const pctHeader = "% Lines".padStart(pctColWidth - 1);
		const uncoveredHeader = "Uncovered Line #s";

		let headerRow = `${fileHeader} |${pctHeader}`;
		if (showBranches) {
			const branchHeader = "% Branches".padStart(branchColWidth - 1);
			headerRow += ` |${branchHeader}`;
		}
		headerRow += ` | ${uncoveredHeader}`;
		console.log(headerRow);
		console.log(headerSep);

		// Display per-file coverage
		if (summary.files.length > 0) {
			for (const file of summary.files) {
				// Get display name relative to common base
				const displayName = this.getDisplayNameFromBase(file.path, commonBase, fileColWidth - 2);
				const pct = file.percentage.toFixed(2);
				const color = this.getCoverageColor(file.percentage);
				// Pad percentage to match header width (8 chars to align with "% Lines" header)
				const pctDisplay = `${color}${pct.padStart(8)}${this.getResetColor()}`;

				const uncoveredDisplay = file.uncoveredLineRanges || "";

				// Convert Docker path to local path for VSCode
				const localPath = this.convertToLocalPath(file.path);
				// Use vscode:// scheme for better VSCode integration with OSC 8 links
				const fileUrl = `vscode://file${localPath}`;

				// Display the row with clickable file link (padding outside the link)
				this.linker.write(fileUrl, displayName);
				// Add padding spaces outside the link to align columns
				const paddingLength = fileColWidth - 1 - displayName.length;
				if (paddingLength > 0) {
					process.stdout.write(" ".repeat(paddingLength));
				}
				process.stdout.write(" |");
				process.stdout.write(pctDisplay);

				// Conditionally display branch coverage column
				if (showBranches) {
					const branchPct = file.branchPercentage.toFixed(2);
					const branchColor = this.getCoverageColor(file.branchPercentage, "branches");
					const branchDisplay = `${branchColor}${branchPct.padStart(10)}${this.getResetColor()}`;
					process.stdout.write(" |");
					process.stdout.write(branchDisplay);
				}

				process.stdout.write(" | ");

				// If we have uncovered lines, make each range clickable to its own starting line
				if (uncoveredDisplay) {
					this.writeClickableUncoveredRanges(uncoveredDisplay, fileUrl, uncoveredColWidth - 2);
				}

				process.stdout.write("\n");
			}
		}

		console.log(headerSep);

		// Overall summary
		const linesPct = summary.percentage.toFixed(2);
		const linesColor = this.getCoverageColor(summary.percentage);
		const linesCoverage = `(${summary.coveredLines}/${summary.totalLines})`;

		// Build summary row with conditional branch column
		let summaryRow = `${"All files".padEnd(fileColWidth - 1)} |${linesColor}${linesPct.padStart(8)}${this.getResetColor()}`;
		if (showBranches) {
			const branchPct = summary.branchPercentage.toFixed(2);
			const branchColor = this.getCoverageColor(summary.branchPercentage, "branches");
			summaryRow += ` |${branchColor}${branchPct.padStart(10)}${this.getResetColor()}`;
		}
		summaryRow += ` | ${linesCoverage}`;

		console.log(summaryRow);
		console.log(headerSep);
		console.log("");

		// Display E2BIG warning if errors occurred during merge
		if (this.hasE2BIGErrors) {
			console.log("\x1b[33m⚠️  WARNING: E2BIG errors occurred during coverage merging\x1b[0m");
			console.log("\x1b[33m   Some coverage data may be incomplete or missing\x1b[0m");
			console.log("\x1b[33m   Consider reducing the number of test files or increasing BATCH_SIZE\x1b[0m");
			console.log("");
		}

		// Display helpful information about accessing the coverage report
		const relativePath = htmlReportPath.replace(this.projectRoot, "").replace(/^\//, "");
		const htmlFileUrl = `file://${htmlReportPath}`;

		console.log("✅ Tests complete! Coverage report available at:");
		process.stdout.write(`   `);
		this.linker.writeln(htmlFileUrl, relativePath);
		console.log("");

		// Display macOS warning if coverage is 0%
		if (isMacOS() && summary.percentage === 0) {
			console.log("\x1b[33m⚠️  Coverage shows 0% on macOS due to System Integrity Protection (SIP)\x1b[0m");
			console.log("\x1b[33m   SIP blocks kcov from attaching to processes for coverage collection\x1b[0m");
			console.log("\x1b[33m   For accurate coverage, use Docker: pnpm test:docker\x1b[0m");
			console.log("");
		}

		console.log("💡 Tip: Open coverage report with:");
		console.log("   - VSCode: Run task 'Coverage: Open Report' (Cmd+Shift+P > Tasks: Run Task)");
		console.log("   - CLI: pnpm coverage:open");
		process.stdout.write(`   - Browser: open `);
		this.linker.writeln(htmlFileUrl, relativePath);
		console.log("");
	}

	/**
	 * Find the common base path among a list of file paths.
	 *
	 * @remarks
	 * Finds the longest common directory path prefix shared by all files.
	 * Used to determine the best base path for displaying relative file names.
	 *
	 * @param paths - Array of absolute file paths
	 * @returns Common base path (directory), or empty string if no common base
	 *
	 * @example
	 * ```typescript
	 * findCommonBasePath([
	 *   "/workspace/plugins/workflow/scripts/utils/info-system.sh",
	 *   "/workspace/plugins/workflow/scripts/doctor-biome.sh"
	 * ]);
	 * // Returns: "/workspace/plugins/workflow/scripts"
	 * ```
	 *
	 * @internal
	 */
	private findCommonBasePath(paths: string[]): string {
		if (paths.length === 0) return "";
		if (paths.length === 1) {
			const parts = paths[0].split("/");
			return parts.slice(0, -1).join("/");
		}

		// Split all paths into parts
		const pathParts = paths.map((p) => p.split("/"));

		// Find shortest path length
		const minLength = Math.min(...pathParts.map((p) => p.length));

		// Find common prefix
		let commonLength = 0;
		for (let i = 0; i < minLength - 1; i++) {
			// -1 to exclude filename
			const part = pathParts[0][i];
			if (pathParts.every((p) => p[i] === part)) {
				commonLength = i + 1;
			} else {
				break;
			}
		}

		if (commonLength === 0) return "";

		return pathParts[0].slice(0, commonLength).join("/");
	}

	/**
	 * Get a display name for a file relative to a common base path.
	 *
	 * @remarks
	 * Strips the common base path and returns the relative portion.
	 * If the result is too long, truncates intelligently with ".../" prefix.
	 *
	 * @param filePath - Absolute file path
	 * @param commonBase - Common base path to strip
	 * @param maxLength - Maximum allowed length
	 * @returns Display name that fits within the specified length
	 *
	 * @example
	 * ```typescript
	 * getDisplayNameFromBase(
	 *   "/workspace/plugins/workflow/scripts/utils/info-system.sh",
	 *   "/workspace/plugins/workflow/scripts",
	 *   40
	 * );
	 * // Returns: "utils/info-system.sh"
	 * ```
	 *
	 * @internal
	 */
	private getDisplayNameFromBase(filePath: string, commonBase: string, maxLength: number): string {
		// Strip common base
		let relativePath = filePath;
		if (commonBase && filePath.startsWith(commonBase)) {
			relativePath = filePath.substring(commonBase.length).replace(/^\//, "");
		}

		// If it fits, return as-is
		if (relativePath.length <= maxLength) {
			return relativePath;
		}

		// Try to show filename + parent directory
		const parts = relativePath.split("/");
		if (parts.length >= 2) {
			const filename = parts[parts.length - 1];
			const parent = parts[parts.length - 2];
			const shortPath = `${parent}/${filename}`;

			// If filename + parent fits with ".../" prefix
			if (shortPath.length + 4 <= maxLength) {
				return `.../${shortPath}`;
			}
		}

		// Fallback: truncate from the left with "..."
		return `...${relativePath.substring(relativePath.length - maxLength + 3)}`;
	}

	/**
	 * Convert a Docker path to a local path for VSCode links.
	 *
	 * @remarks
	 * When running in Docker, file paths use `/workspace/` prefix.
	 * This method converts them to local filesystem paths for clickable links.
	 *
	 * @param dockerPath - File path from Docker environment (may start with /workspace/)
	 * @returns Local filesystem path
	 *
	 * @example
	 * ```typescript
	 * // Running in Docker with projectRoot = "/Users/spencer/project"
	 * convertToLocalPath("/workspace/plugins/workflow/scripts/doctor.sh");
	 * // Returns: "/Users/spencer/project/plugins/workflow/scripts/doctor.sh"
	 * ```
	 *
	 * @internal
	 */
	private convertToLocalPath(dockerPath: string): string {
		// If path starts with /workspace/, replace it with projectRoot
		if (dockerPath.startsWith("/workspace/")) {
			const relativePath = dockerPath.substring("/workspace/".length);
			return resolve(this.projectRoot, relativePath);
		}

		// If path already starts with projectRoot, return as-is
		if (dockerPath.startsWith(this.projectRoot)) {
			return dockerPath;
		}

		// Otherwise, assume it's already a local path or resolve it
		return dockerPath;
	}

	/**
	 * Write uncovered line ranges with each range as a clickable link.
	 *
	 * @remarks
	 * Splits the uncovered line ranges string by comma and creates a separate
	 * clickable link for each range. Each range links to its starting line number.
	 * If the total length exceeds maxLength, truncates at a comma boundary and adds "...".
	 *
	 * @param rangesString - Uncovered line ranges string (e.g., "83-86,96,102-103")
	 * @param fileUrl - Base VSCode URL for the file
	 * @param maxLength - Maximum allowed length for the column
	 *
	 * @example
	 * ```typescript
	 * // Creates individual clickable links:
	 * // "83-86" -> vscode://file/path/to/file.sh:83
	 * // "96" -> vscode://file/path/to/file.sh:96
	 * // "102-103" -> vscode://file/path/to/file.sh:102
	 * writeClickableUncoveredRanges("83-86,96,102-103", "vscode://file/path.sh", 30);
	 * ```
	 *
	 * @internal
	 */
	private writeClickableUncoveredRanges(rangesString: string, fileUrl: string, maxLength: number): void {
		const ranges = rangesString.split(",");
		let totalLength = 0;

		for (let i = 0; i < ranges.length; i++) {
			const range = ranges[i];
			const rangeLength = range.length + (i > 0 ? 1 : 0); // +1 for comma separator

			// Check if adding this range would exceed max length
			if (totalLength + rangeLength > maxLength) {
				// Would exceed max length, truncate here
				process.stdout.write(",...");
				break;
			}

			// Add comma separator if not first range
			if (i > 0) {
				process.stdout.write(",");
				totalLength += 1;
			}

			// Get first line number of this range
			const firstLine = this.getFirstLineOfRange(range);
			if (firstLine !== null) {
				const rangeUrl = `${fileUrl}:${firstLine}`;
				this.linker.write(rangeUrl, range);
			} else {
				// Fallback: write plain text if we can't parse the line number
				process.stdout.write(range);
			}

			totalLength += range.length;
		}
	}

	/**
	 * Extract the first line number from a single range string.
	 *
	 * @remarks
	 * Parses a range like "83-86" or a single line like "96" and returns the first line number.
	 *
	 * @param range - Single range string (e.g., "83-86" or "96")
	 * @returns First line number, or null if parsing fails
	 *
	 * @example
	 * ```typescript
	 * getFirstLineOfRange("83-86"); // Returns: 83
	 * getFirstLineOfRange("96");    // Returns: 96
	 * getFirstLineOfRange("");      // Returns: null
	 * ```
	 *
	 * @internal
	 */
	private getFirstLineOfRange(range: string): number | null {
		if (!range) return null;

		// If it's a range (e.g., "83-86"), get the start
		const rangeParts = range.split("-");
		const lineNumber = Number.parseInt(rangeParts[0], 10);

		return Number.isNaN(lineNumber) ? null : lineNumber;
	}

	/**
	 * Check if coverage meets configured thresholds and throw error if not.
	 *
	 * @remarks
	 * Validates coverage against configured thresholds (lines and branches).
	 * Throws an error if any threshold is not met, either globally or per-file.
	 *
	 * For shell scripts, only line and branch coverage are applicable.
	 *
	 * @param summary - Coverage summary with file-level and aggregate statistics
	 * @throws {Error} If coverage thresholds are not met
	 *
	 * @internal
	 */
	private checkCoverageThresholds(summary: CoverageSummary): void {
		// If no thresholds configured, pass
		if (!this.thresholds || Object.keys(this.thresholds).length === 0) {
			return;
		}

		const { lines, branches } = this.thresholds;
		const lineThreshold = lines;
		const branchThreshold = branches;

		if (!lineThreshold && !branchThreshold) {
			return; // No thresholds configured
		}

		// Warn if branch thresholds are configured
		// Branch coverage is always 100% for bash scripts with kcov, so branch thresholds
		// will always pass and are not meaningful quality metrics.
		if (branchThreshold) {
			console.log("\n💡 Note: Branch coverage thresholds are configured but not meaningful for bash scripts");
			console.log("   Kcov always reports 100% branch coverage for shell scripts (limitation of the tool)");
			console.log("   Use line coverage thresholds for actual quality enforcement");
			console.log("");
		}

		// CRITICAL: Fail if no files were tracked when thresholds are configured
		// This prevents tests from passing when coverage collection silently fails
		if (summary.files.length === 0) {
			console.error("\n❌ Coverage threshold check failed: No files were tracked for coverage");
			console.error("   This usually indicates a problem with coverage collection.");
			console.error("   Common causes:");
			console.error("   - kcov failed to run or instrument scripts");
			console.error("   - Scripts were not registered via BatsHelper.describe()");
			console.error("   - Coverage data was not copied from test runs");
			process.exitCode = 1;
			throw new Error("Coverage threshold not met: No files were tracked for coverage");
		}

		// Check per-file thresholds (default: true, only skip if explicitly set to false)
		if (this.thresholds.perFile !== false) {
			const lineFailures: Array<{ path: string; percentage: number }> = [];
			const branchFailures: Array<{ path: string; percentage: number }> = [];

			for (const file of summary.files) {
				// Check line threshold
				if (lineThreshold && file.percentage < lineThreshold) {
					lineFailures.push({ path: file.path, percentage: file.percentage });
				}

				// Check branch threshold
				if (branchThreshold && file.branchPercentage < branchThreshold) {
					branchFailures.push({ path: file.path, percentage: file.branchPercentage });
				}
			}

			// Report line threshold failures
			if (lineFailures.length > 0 && lineThreshold) {
				console.error("\n❌ Line coverage threshold not met for the following files:");
				this.reportThresholdFailures(lineFailures, lineThreshold);
			}

			// Report branch threshold failures
			if (branchFailures.length > 0 && branchThreshold) {
				console.error("\n❌ Branch coverage threshold not met for the following files:");
				this.reportThresholdFailures(branchFailures, branchThreshold);
			}

			// Show macOS-specific warning if there are files with very low coverage
			if ((lineFailures.length > 0 || branchFailures.length > 0) && isMacOS()) {
				const filesWithZeroCoverage = lineFailures.filter((f) => f.percentage === 0).length;
				if (filesWithZeroCoverage > 0) {
					console.error("\n⚠️  macOS Coverage Limitation:");
					console.error(
						`   ${filesWithZeroCoverage} file(s) have 0% coverage, likely due to SIP (System Integrity Protection).`,
					);
					console.error("   Kcov on macOS cannot fully instrument bash conditionals and file checks.");
					console.error("   For accurate coverage metrics, use Docker: pnpm test:docker");
				}
			}

			// Throw error if any failures occurred
			if (lineFailures.length > 0 || branchFailures.length > 0) {
				const totalFailures = lineFailures.length + branchFailures.length;
				process.exitCode = 1; // Signal test failure
				throw new Error(`Coverage threshold not met: ${totalFailures} threshold violation(s)`);
			}
		} else {
			// Check global thresholds
			let hasFailure = false;

			if (lineThreshold && summary.percentage < lineThreshold) {
				console.error(
					`\n❌ Global line coverage threshold not met: ${summary.percentage.toFixed(2)}% (threshold: ${lineThreshold}%)`,
				);
				hasFailure = true;
			}

			if (branchThreshold && summary.branchPercentage < branchThreshold) {
				console.error(
					`\n❌ Global branch coverage threshold not met: ${summary.branchPercentage.toFixed(2)}% (threshold: ${branchThreshold}%)`,
				);
				hasFailure = true;
			}

			if (hasFailure) {
				process.exitCode = 1; // Signal test failure
				throw new Error("Coverage threshold not met");
			}
		}
	}

	/**
	 * Report threshold failures with aligned formatting and clickable links.
	 *
	 * @remarks
	 * Formats and displays files that failed to meet coverage thresholds.
	 *
	 * @param failures - Array of files with their coverage percentages
	 * @param threshold - The threshold percentage that was not met
	 *
	 * @internal
	 */
	private reportThresholdFailures(failures: Array<{ path: string; percentage: number }>, threshold: number): void {
		// Apply path rewriting to all paths first
		const rewrittenPaths = failures.map((f) => {
			let localPath = f.path;
			if (process.env.HTE_PATH_REWRITE) {
				const [from, ...toParts] = process.env.HTE_PATH_REWRITE.split(":");
				const to = toParts.join(":"); // Handle Windows paths with colons
				if (localPath.startsWith(from)) {
					localPath = localPath.replace(from, to);
				}
			}
			return { ...f, localPath };
		});

		// Find common base path from rewritten paths
		const commonBase = this.findCommonBasePath(rewrittenPaths.map((f) => f.localPath));

		// Calculate display names and max width for alignment
		const displayData = rewrittenPaths.map((failure) => {
			// Get display name by stripping common base (without ellipsis prefix)
			let displayName = failure.localPath;
			if (commonBase && failure.localPath.startsWith(commonBase)) {
				displayName = failure.localPath.substring(commonBase.length).replace(/^\//, "");
			}
			return { ...failure, displayName };
		});

		const maxDisplayNameWidth = Math.max(...displayData.map((d) => d.displayName.length));

		for (const failure of displayData) {
			// Pad display name for alignment
			const paddedDisplayName = failure.displayName.padEnd(maxDisplayNameWidth);

			// Create file URL with rewritten path
			const fileUrl = `vscode://file${failure.localPath}`;

			// Use HTELink.create() to format the link (supports both HTE and plain text modes)
			const hteLink = this.linker.create(fileUrl, paddedDisplayName);

			// Write clickable file path with red percentage to stderr
			process.stderr.write(
				`  ${hteLink}: \x1b[31m${failure.percentage.toFixed(2)}%\x1b[0m (threshold: ${threshold}%)\n`,
			);
		}
	}

	/**
	 * Get ANSI color code based on coverage percentage and threshold.
	 *
	 * @remarks
	 * Returns terminal color codes for visual coverage indication:
	 * - Red: Below configured threshold (if threshold exists)
	 * - Green (>= 80%): Good coverage, meets typical quality thresholds
	 * - Yellow (>= 60%): Moderate coverage, needs improvement
	 * - Red (< 60%): Poor coverage, requires attention
	 *
	 * @param percentage - Coverage percentage (0-100)
	 * @param type - Type of coverage ('lines' or 'branches') to check threshold for (default: 'lines')
	 * @returns ANSI color escape code
	 *
	 * @example
	 * ```typescript
	 * getCoverageColor(85); // "\x1b[32m" (green)
	 * getCoverageColor(65); // "\x1b[33m" (yellow)
	 * getCoverageColor(45); // "\x1b[31m" (red)
	 * getCoverageColor(95, 'branches'); // "\x1b[31m" (red if branch threshold is 99%)
	 * ```
	 *
	 * @internal
	 */
	private getCoverageColor(percentage: number, type: "lines" | "branches" = "lines"): string {
		// If thresholds are configured, check against threshold first
		const threshold = type === "lines" ? this.thresholds?.lines : this.thresholds?.branches;
		if (threshold && percentage < threshold) {
			return "\x1b[31m"; // Red - below threshold
		}

		// Default color scheme
		if (percentage >= 80) return "\x1b[32m"; // Green
		if (percentage >= 60) return "\x1b[33m"; // Yellow
		return "\x1b[31m"; // Red
	}

	/**
	 * Get ANSI color reset code.
	 *
	 * @remarks
	 * Returns the ANSI escape code to reset terminal colors back to default.
	 * Used after color-coded coverage percentages to prevent color bleed.
	 *
	 * @returns ANSI reset escape code
	 *
	 * @internal
	 */
	private getResetColor(): string {
		return "\x1b[0m";
	}
}

export default KcovCoverageReporter;
