/**
 * TypeScript module augmentation for Vitest coverage options.
 *
 * @remarks
 * Extends Vitest's `CoverageOptions` interface to include custom `kcov` configuration.
 * This allows `defineConfig()` to properly type-check kcov options without `@ts-expect-error`.
 *
 * **Usage:**
 * ```typescript
 * import { defineConfig } from "vitest/config";
 * import "./lib/vitest-kcov-plugin/vitest-kcov-types.js";
 *
 * export default defineConfig({
 *   test: {
 *     coverage: {
 *       kcov: {
 *         enabled: true,
 *         // ... other kcov options are now type-checked
 *       }
 *     }
 *   }
 * });
 * ```
 *
 * @packageDocumentation
 */

/**
 * Log verbosity level for the kcov coverage provider.
 *
 * @remarks
 * Controls the amount of output displayed during coverage collection:
 * - `verbose`: Show all messages including debug and informational
 * - `debug`: Show debug messages and errors
 * - `errors-only`: Only show errors and warnings
 */
export type LogLevel = "verbose" | "debug" | "errors-only";

/**
 * Hyperlink format for terminal output.
 *
 * @remarks
 * Controls how file paths are formatted in terminal output:
 * - `auto`: Auto-detect terminal support for HTE links (VSCode, iTerm 3.1+, WezTerm)
 * - `default`: Plain text paths (e.g., "coverage/vitest/index.html")
 * - `hte`: Hypertext Escape sequences (OSC 8) for clickable links in compatible terminals
 */
export type LinkFormat = "auto" | "default" | "hte";

/**
 * Coverage thresholds for kcov shell script coverage.
 *
 * @remarks
 * Defines minimum coverage percentages required for tests to pass.
 *
 * **Important Limitation:**
 * Kcov does NOT actually track branch coverage for bash scripts. The `branches` field is
 * included for format compatibility with standard coverage reports, but kcov always reports
 * `branch-rate="1.0"` (100%) in cobertura.xml for all shell scripts, regardless of actual
 * branch execution.
 *
 * **What this means:**
 * - Line coverage: Fully supported and accurate
 * - Branch coverage: Always shows 100% (not meaningful for bash scripts with kcov)
 * - Branch thresholds: Will always pass since kcov reports 100%
 *
 * **Recommendation:**
 * Set branch threshold to 100% to maintain format compatibility, but rely on line coverage
 * for actual quality metrics.
 */
export interface KcovThresholds {
	/**
	 * Enforce thresholds per file instead of globally
	 *
	 * @remarks
	 * When `true` or `undefined` (default), thresholds are checked for each individual file.
	 * When `false`, thresholds are checked against overall coverage across all files.
	 *
	 * @defaultValue `true`
	 */
	perFile?: boolean;
	/** Minimum line coverage percentage (0-100) */
	lines?: number;
	/**
	 * Minimum branch coverage percentage (0-100)
	 *
	 * @remarks
	 * **Note:** Kcov always reports 100% branch coverage for bash scripts.
	 * This field exists for format compatibility but is not meaningful for shell script coverage.
	 */
	branches?: number;
}

/**
 * Configuration options for kcov coverage collection.
 *
 * @remarks
 * These options control how kcov collects and reports coverage for shell scripts.
 * All options are optional and have sensible defaults.
 *
 * @see {@link incremental} for timestamped report directories useful for debugging
 */
export interface KcovOptions {
	/**
	 * Subdirectory within reportsDirectory for kcov output.
	 *
	 * @remarks
	 * Reports are output to a subdirectory to keep them organized and separated from other files.
	 *
	 * **Path resolution:**
	 * - The subdir is resolved relative to reportsDirectory
	 * - Can be multiple levels deep (e.g., "foo/bar")
	 *
	 * @example
	 * ```typescript
	 * // Default: subdir: "kcov"
	 * // Reports output to: coverage/kcov
	 *
	 * // Custom: subdir: "foo/bar"
	 * // Reports output to: coverage/foo/bar
	 * ```
	 *
	 * @default "kcov"
	 */
	subdir?: string;
	/**
	 * Directory for BATS cache files.
	 *
	 * @remarks
	 * The cache directory stores generated .bats files and kcov output directories.
	 *
	 * **Path resolution:**
	 * - Relative paths are resolved from the reports directory
	 * - Use `../` to place cache as a sibling to the reports directory
	 * - Absolute paths can be used for system-wide cache locations
	 *
	 * @example
	 * ```typescript
	 * // Default: cacheDir: "../bats-cache"
	 * // With subdir: "kcov" -> cache at: coverage/bats-cache
	 *
	 * // Custom relative path
	 * subdir: "foo/bar"
	 * cacheDir: "../bats-cache"  // Resolves to: coverage/foo/bats-cache
	 *
	 * // Absolute path
	 * cacheDir: "/tmp/bats-cache"
	 * ```
	 *
	 * @default "../bats-cache"
	 */
	cacheDir?: string;
	/**
	 * Whether to clean the resolved reports output directory before running tests.
	 *
	 * @remarks
	 * When true, removes the entire reports directory (reportsDirectory + subdir) before
	 * running tests to ensure a fresh start.
	 *
	 * @default true
	 */
	clean?: boolean;
	/**
	 * Whether to clean the resolved cache directory before running tests.
	 *
	 * @remarks
	 * When true, removes the cache directory before running tests to ensure fresh
	 * .bats files are generated and no stale kcov data exists.
	 *
	 * @default true
	 */
	cleanCache?: boolean;
	/**
	 * Whether to use incremental (timestamped) report directories.
	 *
	 * @remarks
	 * When true, a timestamp folder is inserted into the path one level above the final segment,
	 * allowing multiple test runs to be preserved for debugging purposes.
	 *
	 * **Path Resolution with Incremental:**
	 * - The timestamp format is `YYYY-MM-DD_HH-MM-SS` (e.g., "2025-11-12_14-30-45")
	 * - The timestamp is inserted before the last segment of the subdir path
	 * - Assumes tests won't run more than once per second
	 *
	 * @example
	 * ```typescript
	 * // Without incremental (default)
	 * subdir: "foo/bar"
	 * // Reports: coverage/foo/bar
	 *
	 * // With incremental: true (custom subdir)
	 * subdir: "foo/bar"
	 * cacheDir: "../bats-cache"
	 * incremental: true
	 * // Reports: coverage/foo/2025-11-12_14-30-45/bar
	 * // Cache: coverage/foo/2025-11-12_14-30-45/bats-cache
	 *
	 * // With incremental: true (no subdir - uses defaults)
	 * incremental: true
	 * // Reports: coverage/2025-11-12_14-30-45/kcov
	 * // Cache: coverage/2025-11-12_14-30-45/kcov-cache
	 * ```
	 *
	 * @default false
	 */
	incremental?: boolean;
	/**
	 * Log verbosity level: `verbose` | `debug` | `errors-only`
	 * @defaultValue `errors-only`
	 * */
	logLevel?: LogLevel;
	/**
	 * Hyperlink format for terminal output
	 *
	 * @remarks
	 * - `auto`: Auto-detect terminal support for HTE links (VSCode, iTerm 3.1+, WezTerm)
	 * - `default`: Plain text paths (e.g., "coverage/vitest/index.html")
	 * - `hte`: Hypertext Escape sequences (OSC 8) for clickable links in compatible terminals
	 * @defaultValue `auto`
	 * */
	links?: LinkFormat;
	/**
	 * Coverage thresholds for shell scripts.
	 *
	 * @remarks
	 * Unlike v8/Istanbul, kcov only tracks line coverage for shell scripts.
	 * Functions and statements thresholds are not applicable.
	 *
	 * **Important:** Kcov does NOT track branch coverage for bash scripts - it always reports
	 * 100% branch coverage. The branch threshold exists for format compatibility but will
	 * always pass. Use line coverage thresholds for actual quality enforcement.
	 *
	 * @example
	 * ```typescript
	 * kcov: {
	 *   thresholds: {
	 *     perFile: true,
	 *     lines: 90,        // Enforced - tracks actual line execution
	 *     branches: 100     // Not enforced - kcov always reports 100%
	 *   }
	 * }
	 * ```
	 */
	thresholds?: KcovThresholds;
	/**
	 * Optional path to custom reporter module for coverage display.
	 *
	 * @remarks
	 * Defaults to the built-in KcovReporter located alongside the provider.
	 * Only specify this if you want to use a custom reporter implementation.
	 */
	customReporter?: string;
}

// Augment Vitest's CustomProviderOptions to include kcov configuration
declare module "vitest/node" {
	interface CustomProviderOptions {
		/**
		 * Kcov-specific coverage options for shell script testing.
		 *
		 * @remarks
		 * Only applies when using the custom kcov coverage provider:
		 * ```typescript
		 * coverage: {
		 *   provider: "custom",
		 *   customProviderModule: "./lib/vitest-kcov-plugin/vitest-kcov-provider.ts",
		 *   kcov: {
		 *     // ... kcov options
		 *   }
		 * }
		 * ```
		 */
		kcov?: KcovOptions;
	}
}
