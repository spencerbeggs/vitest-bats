---
status: current
module: vitest-bats
category: api-reference
created: 2026-04-21
updated: 2026-04-21
last-synced: 2026-04-21
completeness: 95
related:
  - vitest-bats/architecture.md
---

# vitest-bats API Reference

## Public Exports (`vitest-bats`)

The main entry point (`package/src/index.ts`) re-exports the public API:

```typescript
// Side-effect: augments vitest/node CustomProviderOptions with kcov field
import "./vitest-kcov-types.js";

// BATS file generator
export type { BatsDeps } from "./bats-generator.js";
export { generateBatsFile } from "./bats-generator.js";

// Coverage merge reporter
export { BatsCoverageReporter } from "./coverage-reporter.js";

// Plugin
export type { BatsPluginOptions } from "./plugin.js";
export { BatsPlugin } from "./plugin.js";

// Runtime: ScriptBuilder and registry
export type { CommandRecord } from "./runtime.js";
export { ScriptBuilder, createBatsScript, findActive, resetAll } from "./runtime.js";

// Types
export type { KcovOptions, KcovThresholds, LinkFormat, LogLevel } from "./vitest-kcov-types.js";
```

## Secondary Entry Points

### `vitest-bats/runtime` (`src/runtime.ts`)

Runtime API consumed by generated virtual modules. Keeps the import lightweight
by avoiding the full plugin and coverage code.

```typescript
export type { CommandRecord } from "./runtime.js";
export { ScriptBuilder, createBatsScript, findActive, resetAll } from "./runtime.js";

// Re-exports from bats-generator
export type { BatsDeps } from "./bats-generator.js";
export { generateBatsFile } from "./bats-generator.js";
```

### `vitest-bats/runner` (`src/runner.ts`)

Custom test runner. Default export is `BatsRunner` (extends `TestRunner`).

```typescript
export default class BatsRunner extends TestRunner { ... }
```

## BatsPlugin

Primary integration point. Add to the `plugins` array in `vitest.config.ts`.

```typescript
import { defineConfig } from "vitest/config";
import { BatsPlugin } from "vitest-bats";

export default defineConfig({
  plugins: [BatsPlugin()],
  test: {
    include: ["__test__/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
    },
  },
});
```

### BatsPluginOptions

```typescript
interface BatsPluginOptions {
  /**
   * Shell script coverage mode. Default: "auto"
   * - "auto": include .sh in coverage when kcov is available and reliable
   * - true: require kcov + non-macOS, throw if unavailable
   * - false: always exclude .sh from coverage
   */
  coverage?: "auto" | boolean;

  /** Log level for detection output. Default: "errors-only" */
  logLevel?: LogLevel; // "verbose" | "debug" | "errors-only"

  /** Hyperlink format for reporter. Default: "auto" */
  links?: LinkFormat; // "auto" | "default" | "hte"
}
```

### What BatsPlugin Does

**Vite Transform Phase:**

1. `resolveId(source, importer)` -- Intercepts `.sh` imports. Resolves the
   path relative to the importer. If the file exists, returns a virtual module
   ID: `\0bats:<absolute-path>`.
2. `load(id)` -- For virtual IDs, generates JavaScript that imports
   `createBatsScript` from `vitest-bats/runtime` and exports a `ScriptBuilder`
   bound to the script path.
3. Registers each script path in `registeredScripts[]` and writes a
   `scripts.json` manifest to the cache directory.

**config Phase (Vite `config` hook):**

1. Sets `test.runner` to `"vitest-bats/runner"` automatically.
2. Throws if the user has a conflicting custom runner configured.

**configureVitest Phase:**

1. Derives cache directory from Vite's `cacheDir` (scoped under
   `vitest-bats/`).
2. Checks system dependencies (bats, bats-support, bats-assert, bats-mock, jq).
   Throws on missing required dependencies with install instructions.
3. Sets environment variables: `BATS_PATH`, `BATS_SUPPORT_PATH`,
   `BATS_ASSERT_PATH`, `BATS_MOCK_PATH`, `KCOV_PATH`, `KCOV_LOG_LEVEL`.
4. Resolves coverage mode. When kcov is reliable, sets `__VITEST_BATS_KCOV__=1`
   and `__VITEST_BATS_CACHE_DIR__` for the runner.
5. Always injects `BatsCoverageReporter` when Vitest coverage is enabled. Passes
   `CoverageThresholds` from the config and `statementPassThrough = true` when
   kcov is unreliable.

### Coverage Mode Resolution

| `coverage` option | kcov available | macOS? | Result |
| --- | --- | --- | --- |
| `"auto"` (default) | Yes | No | Shell coverage ON |
| `"auto"` | Yes | Yes | Shell coverage OFF (SIP) |
| `"auto"` | No | -- | Shell coverage OFF |
| `true` | Yes | No | Shell coverage ON |
| `true` | Yes | Yes | Throws Error |
| `true` | No | -- | Throws Error |
| `false` | -- | -- | Shell coverage OFF |

## ScriptBuilder

Command recorder returned by `.sh` imports. Records test commands that are
later converted into `.bats` file content by `generateBatsFile()`.

### Usage Pattern

```typescript
import { describe, test } from "vitest";
import hello from "../scripts/hello.sh";

describe("hello.sh", () => {
  test("outputs default greeting", () => {
    hello.run('"$SCRIPT"');
    hello.assert_success();
    hello.assert_output({ partial: "Hello World" });
  });

  test("greets by name", () => {
    hello.run('"$SCRIPT" --name Alice');
    hello.assert_success();
    hello.assert_output({ partial: "Hello Alice" });
  });
});
```

Each `test()` block records commands on the builder. The `BatsRunner` resets
builders before each test and executes the generated BATS test after.

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `path` | `string` (readonly) | Absolute path to the shell script |
| `name` | `string` (readonly) | Script basename (e.g., `"hello.sh"`) |
| `fromTransform` | `boolean` (readonly) | Whether created by Vite transform (default `false`) |
| `commands` | `CommandRecord[]` | Recorded command buffer |

### Command Methods

All command methods return `this` for chaining.

#### `run(command?: string): this`

Record a `run` command. Defaults to `"$SCRIPT"` when no argument is provided.

```typescript
script.run('"$SCRIPT"');           // Run the script
script.run('"$SCRIPT" --flag');    // Run with arguments
script.run('echo "test"');         // Run arbitrary command
```

#### `raw(cmd: string): this`

Insert raw bash code into the test body. Useful for setup, custom checks, or
commands that do not fit the structured API.

```typescript
script.raw('[ -f "$SCRIPT" ]');    // Check file exists
script.raw('[ -x "$SCRIPT" ]');    // Check file is executable
```

#### `env(vars: Record<string, string>): this`

Set environment variables for the next `run` command. Variables accumulate
until consumed by a `run`.

```typescript
script.env({ NAME: "Alice", DEBUG: "1" });
script.run('"$SCRIPT"');
```

Generates: `NAME="Alice" DEBUG="1" run "$SCRIPT"`

#### `mock(cmd: string, responses: Record<string, string>): this`

Mock a command using bats-mock's stub mechanism.

```typescript
script.mock("curl", {
  "--version": "curl 7.0",
  "--help": "usage: curl ...",
});
```

#### `flags(value: string): this`

Set flags appended to the next `run` command.

```typescript
script.flags("--json");
script.run('"$SCRIPT"');
```

Generates: `run "$SCRIPT" --json`

### Assertion Methods

All assertion methods return `this` for chaining.

#### `assert_success(): this`

Assert the last command exited with code 0.

#### `assert_failure(code?: number): this`

Assert the last command exited with a non-zero code. Optionally specify the
expected exit code.

```typescript
script.assert_failure();      // Any non-zero exit
script.assert_failure(1);     // Specifically exit code 1
```

#### `assert_output(opts: string | { partial?: string; regexp?: string; line?: string; index?: number }): this`

Assert against stdout. When passed a string, matches exact output.

```typescript
script.assert_output("exact match");
script.assert_output({ partial: "substring" });
script.assert_output({ regexp: "^Hello.*$" });
```

#### `assert_line(opts: string | { partial?: string; regexp?: string; index?: number }, expected?: string): this`

Assert against a specific output line.

```typescript
script.assert_line("exact line");
script.assert_line({ index: 0, partial: "first line" });
script.assert_line({ index: 1, regexp: "^Line 2.*" });
```

#### `assert_json_value(path: string, expected: string | number | boolean | null): this`

Assert a JSON field value in stdout using jq. The `path` is a jq dot-path
without the leading dot.

```typescript
script.assert_json_value("greeting", "Hello World");
script.assert_json_value("count", 42);
script.assert_json_value("enabled", true);
```

Generates:

```bats
local json_val
json_val=$(echo "$output" | jq -r '.greeting')
[ "$json_val" = 'Hello World' ]
```

#### `assert(expression: string): this`

Insert a raw assertion expression.

```typescript
script.assert('[ "$status" -eq 0 ]');
```

#### `exit(expectedCode: number): this`

Assert the exit status equals a specific code.

```typescript
script.exit(0);   // Generates: [ "$status" -eq 0 ]
```

### Lifecycle Methods

#### `reset(): void`

Clear the command buffer. Called automatically by the runner before each test
and by `createBatsScript()` when returning an existing builder.

## Registry Functions

These functions manage the `globalThis` registry of `ScriptBuilder` instances.

### `createBatsScript(path: string, name: string, fromTransform?: boolean): ScriptBuilder`

Called by generated virtual modules (with `fromTransform = true`). Returns an
existing builder for the path (after resetting it) or creates and registers a
new one. The `fromTransform` flag enables the runner to distinguish
transform-originated builders from those created directly in unit tests.

### `resetAll(): void`

Resets all builders in the registry. Called by `BatsRunner.onBeforeRunTask()`
before each test to ensure a clean slate.

### `findActive(): ScriptBuilder | null`

Returns the first builder with a non-empty command buffer, or `null` if none.
Called by `BatsRunner.onAfterTryTask()` to detect whether BATS execution is
needed.

## generateBatsFile

Pure function that converts command records into a `.bats` file string.

```typescript
function generateBatsFile(
  scriptPath: string,
  testName: string,
  commands: CommandRecord[],
  deps: BatsDeps,
  kcov?: KcovConfig,
): string;
```

### BatsDeps

```typescript
interface BatsDeps {
  batsPath: string;
  batsSupportPath: string;
  batsAssertPath: string;
  batsMockPath: string;
}
```

### KcovConfig

```typescript
interface KcovConfig {
  kcovPath: string;
  outputDir: string;
}
```

When `KcovConfig` is provided and a `run` command invokes `$SCRIPT`, the
generator wraps the script invocation with kcov:

```bats
run "/path/to/kcov" --skip-solibs \
  --include-pattern="/dir/containing/script" \
  --exclude-line="^#!/,^set -euo pipefail,^set -eo pipefail" \
  "$KCOV_OUT" "$SCRIPT"
```

### CommandRecord

```typescript
interface CommandRecord {
  type: string;
  [key: string]: unknown;
}
```

Supported `type` values: `run`, `raw`, `env`, `mock`, `flags`,
`assert_success`, `assert_failure`, `assert_output`, `assert_line`,
`assert_json_value`, `assert`, `exit`.

## BatsRunner

Custom test runner that extends Vitest's `TestRunner`. Configured as the runner
for test files that use `.sh` imports.

### Constructor

Reads configuration from environment variables set by `BatsPlugin`:

| Env Var | Source | Purpose |
| --- | --- | --- |
| `BATS_PATH` | `checkDependencies()` | Path to bats executable |
| `BATS_SUPPORT_PATH` | `checkDependencies()` | Path to bats-support library |
| `BATS_ASSERT_PATH` | `checkDependencies()` | Path to bats-assert library |
| `BATS_MOCK_PATH` | `checkDependencies()` | Path to bats-mock library |
| `KCOV_PATH` | `checkDependencies()` | Path to kcov executable |
| `__VITEST_BATS_KCOV__` | `configureVitest()` | "1" when shell coverage active |
| `__VITEST_BATS_CACHE_DIR__` | `configureVitest()` | Cache dir for kcov output |

### Lifecycle Hooks

**`onBeforeRunTask(test)`** -- Calls `resetAll()` to clear all ScriptBuilder
command buffers.

**`onAfterTryTask(test)`** -- If `findActive()` returns a builder with
`fromTransform === true` (builders without this flag are skipped):

1. Copies the command buffer and resets the builder
2. Builds per-test `KcovConfig` with unique output directory (timestamped +
   random suffix)
3. Ensures the script file is executable
4. Calls `generateBatsFile()` with the commands and deps
5. Writes the `.bats` file to a temp directory
6. Executes `bats --tap <file>` via `execSync` (60s timeout)
7. On failure, throws `Error` with BATS stdout/stderr

## BatsCoverageReporter

Merges shell script coverage into Vitest's v8 Istanbul CoverageMap. Always
injected by `BatsPlugin` when Vitest coverage is enabled.

### Constructor

```typescript
constructor(cacheDir: string, options?: {
  thresholds?: CoverageThresholds;
  statementPassThrough?: boolean;
})
```

### CoverageThresholds

```typescript
interface CoverageThresholds {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}
```

Read from `vitest.config.ts` `coverage.thresholds` by the plugin.

### `onCoverage(coverage: unknown): void`

Called by Vitest during coverage collection. Three-path strategy per script:

1. **Real kcov data** -- Scans `cacheDir/kcov/<testId>/<scriptName>/cobertura.xml`
   (two levels deep). Multiple files for the same script are merged via
   `Math.max` per statement. Synthetic branch/function entries at threshold
   level are always applied (kcov only tracks statements/lines for bash).
2. **Statement pass-through** -- When `statementPassThrough` is true and
   thresholds are configured, synthesizes all four coverage dimensions at exact
   threshold level using GCD-based fractions. Prints a warning.
3. **Zero-coverage fallback** -- Builds entries from source line analysis with
   all hits = 0.

### Synthetic Coverage Algorithm

The `thresholdFraction(threshold)` method uses GCD reduction to find the
smallest total/covered pair: 50% -> 1/2, 75% -> 3/4, 80% -> 4/5. Statement
counts are padded to be divisible by the denominator for exact percentages.
Synthetic branch entries use a single multi-arm branch; synthetic function
entries create the minimal number of function map entries.

### Zero-Coverage Line Analysis

For scripts without kcov data and no pass-through, identifies executable lines
(skipping comments, structural keywords `then`/`else`/`fi`/`do`/`done`/`esac`/
`;;`, bare braces, and blank lines). All executable lines are marked with 0
hits.

### Cobertura XML Parsing

Uses `fast-xml-parser` with `ignoreAttributes: false` and
`attributeNamePrefix: "@_"`. Extracts source path, package/class/line data,
line numbers (`@_number`) and hit counts (`@_hits`). Converts to Istanbul
format with `statementMap` and `s` records. `fnMap`/`branchMap`/`f`/`b` start
empty and are populated by `applySyntheticBranches`/`applySyntheticFunctions`
when thresholds are configured.

## TypeScript Module Declaration (`shims.d.ts`)

Enables TypeScript to understand `.sh` imports:

```typescript
declare module "*.sh" {
  import type { ScriptBuilder } from "vitest-bats/runtime";
  const script: ScriptBuilder;
  export default script;
}
```

Users should include this file in their `tsconfig.json` or add a
`/// <reference types="vitest-bats" />` directive.

## Type Augmentation (`vitest-kcov-types.ts`)

Side-effect import that augments `vitest/node` `CustomProviderOptions` with a
`kcov` field. Imported automatically via `index.ts`.

### LogLevel

```typescript
type LogLevel = "verbose" | "debug" | "errors-only";
```

### LinkFormat

```typescript
type LinkFormat = "auto" | "default" | "hte";
```

### KcovThresholds

```typescript
interface KcovThresholds {
  perFile?: boolean;   // Default: true
  lines?: number;      // 0-100
  branches?: number;   // 0-100 (always 100% from kcov -- not meaningful)
}
```

### KcovOptions

```typescript
interface KcovOptions {
  subdir?: string;          // Default: "kcov"
  cacheDir?: string;        // Default: "../bats-cache"
  clean?: boolean;          // Default: true
  cleanCache?: boolean;     // Default: true
  incremental?: boolean;    // Default: false
  logLevel?: LogLevel;      // Default: "errors-only"
  links?: LinkFormat;       // Default: "auto"
  thresholds?: KcovThresholds;
  customReporter?: string;
}
```

## System Dependencies

| Dependency | Required | Detected | Notes |
| --- | --- | --- | --- |
| bats | Always | `command -v bats` | BATS test runner |
| bats-support | Always | Library path search | BATS support library |
| bats-assert | Always | Library path search | BATS assertion library |
| bats-mock | Always | Library path search | Command mocking (binstub) |
| jq | Always | `command -v jq` | JSON processing for assert_json_value |
| kcov | Coverage only | `command -v kcov` | Blocked by SIP on macOS |

## Peer Dependencies

- `vitest >=4.1.0`

## Runtime Dependencies

- `fast-xml-parser` -- Cobertura XML parsing
- `minimatch` -- Glob matching
