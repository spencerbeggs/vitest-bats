// Side-effect: augments vitest/node CustomProviderOptions with kcov field
import "./vitest-kcov-types.js";

// BATS file generator
export type { BatsDeps, KcovConfig } from "./bats-generator.js";
export { generateBatsFile } from "./bats-generator.js";
// Coverage merge reporter
export type { CoverageThresholds } from "./coverage-reporter.js";
export { BatsCoverageReporter } from "./coverage-reporter.js";
// Plugin
export type { BatsPluginOptions } from "./plugin.js";
export { BatsPlugin } from "./plugin.js";
// Runtime: ScriptBuilder and registry
export type { CommandRecord } from "./runtime.js";
export { ScriptBuilder, createBatsScript, findActive, resetAll } from "./runtime.js";

// Types
export type { KcovOptions, KcovThresholds, LinkFormat, LogLevel } from "./vitest-kcov-types.js";
