// Side-effect: augments vitest/node CustomProviderOptions with kcov field
import "./vitest-kcov-types.js";

// Coverage merge reporter
export { BatsCoverageReporter } from "./coverage-reporter.js";
export type { HTELinkOptions } from "./hte-link.js";
// Hyperlink utility
export { HTELink } from "./hte-link.js";
export type { BatsPluginOptions } from "./plugin.js";
// Plugin
export { BatsPlugin } from "./plugin.js";
export type { BatsTest, FileResults, TestResult } from "./vitest-kcov-bats-helper.js";
// BatsHelper API
export {
	BatsAssertionBuilder,
	BatsHelper,
	BatsTestContext,
	parseBatsFile,
	parseTapOutput,
	runBatsFile,
	verifyBatsInstalled,
} from "./vitest-kcov-bats-helper.js";
export { KcovCoverageReporter } from "./vitest-kcov-reporter-coverage.js";
// Reporters
export { default as KcovVerboseReporter } from "./vitest-kcov-reporter-verbose.js";

// Types
export type { KcovOptions, KcovThresholds, LinkFormat, LogLevel } from "./vitest-kcov-types.js";
