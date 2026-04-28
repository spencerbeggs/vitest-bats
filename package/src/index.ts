// Side-effect: augments vitest/node CustomProviderOptions with kcov field
import "./vitest-kcov-types.js";

// Executor
export type { ExecuteOptions } from "./bats-executor.js";
export { executeBats, parseExecutionResult } from "./bats-executor.js";
// BATS file generator
export type { BatsDeps, GenerateInput, KcovConfig, RunMode, StubSpec } from "./bats-generator.js";
export { generateBatsFile } from "./bats-generator.js";
// Coverage merge reporter
export type { CoverageThresholds } from "./coverage-reporter.js";
export { BatsCoverageReporter } from "./coverage-reporter.js";
// Matchers (rare; users get them auto-injected via setup)
export type { MatcherResult } from "./matchers.js";
export { batsMatchers } from "./matchers.js";
// Plugin
export type { BatsPluginOptions } from "./plugin.js";
export { BatsPlugin } from "./plugin.js";
// Runtime: ScriptBuilder, BatsResult, registry reset
export type { BatsResultData, MockCall } from "./runtime.js";
export { BatsResult, ScriptBuilder, resetAllBuilders } from "./runtime.js";
// Schema validation
export type { ValidationResult } from "./schema.js";
export { isStandardSchema, validate } from "./schema.js";

// Types
export type { KcovOptions, KcovThresholds, LinkFormat, LogLevel } from "./vitest-kcov-types.js";
