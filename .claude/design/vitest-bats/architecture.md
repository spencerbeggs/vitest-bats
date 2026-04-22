---
status: current
module: vitest-bats
category: architecture
created: 2026-04-21
updated: 2026-04-21
last-synced: 2026-04-21
completeness: 95
related:
  - vitest-bats/api-reference.md
---

# vitest-bats Architecture

## Overview

vitest-bats is a Vitest plugin that enables testing shell scripts via BATS
(Bash Automated Testing System) with optional kcov coverage collection. It uses
a Vite transform to intercept `.sh` imports, returning a `ScriptBuilder` that
records test commands declaratively. A custom `BatsRunner` then generates and
executes `.bats` files from those recorded commands, with coverage results
merged into Vitest's v8 Istanbul CoverageMap for unified reporting.

## Data Flow

```text
1. User writes:  import hello from "../scripts/hello.sh"

2. BatsPlugin.resolveId() intercepts the .sh import
   -> returns virtual module ID: "\0bats:/absolute/path/to/hello.sh"

3. BatsPlugin.load() generates JS for the virtual module:
   -> import { createBatsScript } from "vitest-bats/runtime";
   -> export default createBatsScript("/abs/path/hello.sh", "hello.sh", true);
   (third arg marks as transform-originated for runner scoping)

4. User calls hello.run(), hello.assert_success(), etc. in test() blocks
   -> commands are recorded on ScriptBuilder.commands[]

5. BatsRunner.onBeforeRunTask() resets all ScriptBuilder instances
   -> ensures clean slate for each test

6. Vitest runs the test function body
   -> user code fills ScriptBuilder command buffer

7. BatsRunner.onAfterTryTask() detects active builder with fromTransform=true
   -> Builders with fromTransform=false (direct unit test usage) are skipped
   -> generateBatsFile() produces .bats content from command records
   -> execSync("bats --tap <file>") runs the generated test
   -> throws Error on BATS failure (test fails in Vitest)

8. Coverage (always injected when Vitest coverage enabled):
   -> BatsCoverageReporter reads scripts.json manifest from cacheDir
   -> Three-path strategy per script:
      a) Real kcov data available: use kcov statements/lines, add synthetic
         branches/functions at threshold level (kcov can't measure these)
      b) No kcov + statementPassThrough: synthesize all four dimensions at
         exact threshold level using GCD-based fractions (scripts neutral)
      c) No kcov + no thresholds: zero-coverage fallback
   -> Multiple cobertura files per script merged via Math.max per statement
   -> Merges into v8 CoverageMap via addFileCoverage()
   -> Unified coverage report (TypeScript + shell scripts)
```

## Component Map

### Plugin Layer (`plugin.ts`)

`BatsPlugin()` is the Vite/Vitest plugin and sole integration point. It has
four responsibilities:

**Runner Auto-Injection (`config` hook):**

- The `config()` hook sets `test.runner` to `"vitest-bats/runner"` automatically.
- Throws if the user has a conflicting custom runner configured.
- This means users never set `runner` manually -- the plugin owns it.

**Vite Transform (resolveId + load hooks):**

- `resolveId(source, importer)` intercepts imports ending in `.sh`. It resolves
  the path relative to the importer and, if the file exists, returns a virtual
  module ID prefixed with `\0bats:`.
- `load(id)` generates JavaScript for virtual module IDs. The generated code
  imports `createBatsScript` from `vitest-bats/runtime` and exports a
  `ScriptBuilder` instance bound to the script's absolute path and basename,
  with `fromTransform = true` (third argument) for runner scoping.
- Uses `enforce: "pre"` so `resolveId` runs before Vite's built-in resolver.

**Script Manifest:**

- Maintains a `registeredScripts[]` array of all `.sh` paths seen during
  transform.
- Writes `scripts.json` to Vite's `cacheDir` (scoped under `vitest-bats/`)
  each time a new script is registered. This manifest is consumed by
  `BatsCoverageReporter` at coverage time.

**Vitest Configuration (`configureVitest` hook):**

- Derives `cacheDir` from Vite's `cacheDir`, scoped under `vitest-bats/`.
- Checks system dependencies (bats, bats-support, bats-assert, bats-mock, jq,
  and optionally kcov) and sets environment variables for the runner.
- Resolves the coverage mode (`"auto"` | `true` | `false`) to determine whether
  shell coverage is enabled. Sets `__VITEST_BATS_KCOV__` and
  `__VITEST_BATS_CACHE_DIR__` env vars for the runner when kcov is reliable.
- Always injects `BatsCoverageReporter` when Vitest coverage is enabled. Passes
  `CoverageThresholds` from the Vitest config and `statementPassThrough = true`
  when kcov is unreliable (so scripts are neutral in threshold checks).

### Runtime Layer (`runtime.ts`)

`ScriptBuilder` is the command recorder returned by `.sh` imports. It provides
a fluent API for defining BATS test commands declaratively.

**globalThis Registry:**

- A `Map<string, ScriptBuilder>` stored on `globalThis` under the key
  `__vitest_bats_registry__`.
- This is necessary because Vite's module runner creates separate module
  contexts for test files and the custom runner. Without `globalThis`, the
  runner cannot access the `ScriptBuilder` instances populated by test code.

**Registry Functions:**

- `createBatsScript(path, name, fromTransform?)` -- Returns an existing builder
  for the path (after resetting it) or creates a new one and registers it.
  The `fromTransform` flag (default `false`) marks builders created by the Vite
  transform so the runner can distinguish them from direct unit test usage.
- `resetAll()` -- Resets all builders in the registry (called by runner before
  each test).
- `findActive()` -- Returns the first builder with non-empty commands (called
  by runner after each test to detect if BATS execution is needed).

**ScriptBuilder Methods:**

- `run(command?)` -- Record a `run` command (defaults to `"$SCRIPT"`)
- `raw(cmd)` -- Insert raw bash
- `env(vars)` -- Set environment variables
- `mock(cmd, responses)` -- Mock a command via bats-mock
- `flags(value)` -- Set flags for the next run
- `assert_success()` / `assert_failure(code?)` -- Exit code assertions
- `assert_output(opts)` -- Stdout assertions (partial, regexp, exact)
- `assert_line(opts, expected?)` -- Line-specific assertions
- `assert_json_value(path, expected)` -- JSON field assertions via jq
- `assert(expression)` -- Raw assertion expression
- `exit(code)` -- Assert specific exit code
- `reset()` -- Clear command buffer

### BATS Generator (`bats-generator.ts`)

`generateBatsFile()` is a pure function that converts a `ScriptBuilder`'s
command records into a valid `.bats` file string.

**Inputs:**

- `scriptPath` -- Absolute path to the shell script under test
- `testName` -- Name for the `@test` block
- `commands` -- Array of `CommandRecord` from `ScriptBuilder`
- `deps` -- `BatsDeps` (paths to bats, bats-support, bats-assert, bats-mock)
- `kcov?` -- Optional `KcovConfig` (kcovPath + outputDir)

**Generated Structure:**

```bats
#!/path/to/bats

setup() {
    load '/path/to/bats-support/load.bash'
    load '/path/to/bats-assert/load.bash'
    load '/path/to/bats-mock/stub.bash'
    SCRIPT="/abs/path/to/script.sh"
    # If kcov enabled:
    KCOV_OUT="/path/to/kcov/output"
    mkdir -p "$KCOV_OUT"
}

@test "test name" {
    # Commands from ScriptBuilder.commands[]
    run "$SCRIPT"
    assert_success
    assert_output --partial 'expected'
}
```

**kcov Wrapping:**

When kcov is enabled and a `run` command invokes `$SCRIPT`, the generator wraps
the script invocation with kcov. This is a key design decision: kcov wraps the
script invocation inside the generated `.bats` file, NOT the bats process
itself. This ensures kcov tracks coverage of the shell script under test rather
than the bats runner.

### Runner (`runner.ts`)

`BatsRunner` extends Vitest's `TestRunner` and hooks into the test lifecycle to
execute generated BATS tests.

**Constructor:**

- Creates a temp directory for `.bats` files (`/tmp/vitest-bats-<pid>/`).
- Reads dependency paths from environment variables set by `BatsPlugin`.
- Reads kcov configuration from `__VITEST_BATS_KCOV__` and
  `__VITEST_BATS_CACHE_DIR__` env vars.

**`onBeforeRunTask(test)`:**

- Calls `resetAll()` to clear all `ScriptBuilder` command buffers, ensuring
  each test starts with a clean slate.

**`onAfterTryTask(test)`:**

- Calls `findActive()` to check if any `ScriptBuilder` has commands recorded.
- If active builder found AND `active.fromTransform` is `true` (builders with
  `fromTransform === false` are ignored, solving the scoping problem where unit
  tests that create ScriptBuilders directly would incorrectly trigger BATS):
  1. Copies and resets the command buffer
  2. Builds per-test kcov config with unique output directory (if kcov enabled)
  3. Ensures the script file is executable (`chmod +x` if needed)
  4. Calls `generateBatsFile()` to produce `.bats` content
  5. Writes `.bats` file to temp directory
  6. Runs `bats --tap <file>` via `execSync` (60s timeout)
  7. On failure, throws an `Error` with BATS output (Vitest marks test as
     failed)

### Coverage Layer (`coverage-reporter.ts`)

`BatsCoverageReporter` implements the `onCoverage()` hook to merge shell script
coverage into Vitest's v8 Istanbul CoverageMap. Always injected when Vitest
coverage is enabled.

**Constructor:** `new BatsCoverageReporter(cacheDir, { thresholds?, statementPassThrough? })`

**Three-Path Coverage Strategy:**

For each script in the `scripts.json` manifest:

1. **Real kcov data** -- Scans `cacheDir/kcov/<testId>/<scriptName>/cobertura.xml`
   (two levels deep) for coverage data. Parses Cobertura XML into Istanbul
   format. Multiple cobertura files for the same script are merged by taking
   `Math.max` of hit counts per statement. Synthetic branch/function entries at
   threshold level are added (kcov only tracks statements/lines for bash).

2. **Statement pass-through** -- When `statementPassThrough` is true (kcov
   unreliable, e.g., macOS) and thresholds are configured, synthesizes all four
   coverage dimensions at exact threshold level using GCD-based fractions. Pads
   statement count to ensure exact division. Prints a warning.

3. **Fallback: zero-coverage** -- When no kcov data and no pass-through, builds
   a zero-coverage entry by analyzing the script source: identifies executable
   lines (skipping comments, structural keywords, and braces) and marks them
   all as uncovered.

**Coverage Merge:**

- Calls `coverageMap.addFileCoverage()` for each script.
- This bypasses Vitest's include/exclude filters entirely.

## Package Entry Points

| Entry Point | Source File | Purpose |
| --- | --- | --- |
| `vitest-bats` | `src/index.ts` | Main: BatsPlugin, ScriptBuilder, generateBatsFile, BatsCoverageReporter, types |
| `vitest-bats/runtime` | `src/runtime.ts` | Runtime: ScriptBuilder, createBatsScript, resetAll, findActive, re-exports bats-generator |
| `vitest-bats/runner` | `src/runner.ts` | Runner: BatsRunner (default export) |

The `vitest-bats/runtime` entry point exists so that generated virtual modules
can import `createBatsScript` without pulling in the full plugin and coverage
code. The `vitest-bats/runner` entry point is used by Vitest's runner
configuration.

## Source File Map

```text
package/src/
  index.ts               # Public API re-exports + type augmentation side-effect
  plugin.ts              # BatsPlugin() -- Vite transform + configureVitest
  runtime.ts             # ScriptBuilder + globalThis registry + re-exports bats-generator
  bats-generator.ts      # generateBatsFile() pure function
  runner.ts              # BatsRunner extending TestRunner
  coverage-reporter.ts   # BatsCoverageReporter (scripts.json + kcov merge + synthetic coverage)
  shims.d.ts             # TypeScript module declaration for *.sh imports
  vitest-kcov-types.ts   # Type augmentation for vitest/node CustomProviderOptions
```

## Workspace Layout

```text
vitest-bats/              # Root workspace (consumer / integration tests)
  package/                # The npm package (`vitest-bats`)
  scripts/                # Example shell scripts for testing
  __test__/               # Integration tests consuming vitest-bats
  Dockerfile.test         # Docker environment for kcov on macOS
  docker-compose.test.yml # Docker Compose for test runner
```

The root workspace depends on `vitest-bats: workspace:*` and serves as both the
development harness and the integration test suite.

## Design Decisions

### 1. Vite Transform over import.meta.resolve()

The previous architecture required `import.meta.resolve()` and
`BatsHelper.describe()` to register scripts. The new approach uses a Vite
transform (`resolveId` + `load`) to intercept `.sh` imports and return a
`ScriptBuilder` directly. This eliminates the wrapper API, enabling natural
TypeScript imports of shell scripts.

### 2. globalThis Registry for Cross-Context Communication

Vite's module runner creates separate module contexts for test files and the
custom runner. A `ScriptBuilder` populated in test code would not be visible to
the runner if stored in module-level state. The `globalThis` registry
(`__vitest_bats_registry__`) solves this by providing a shared namespace across
all module contexts within the same process.

### 3. kcov Wraps Script Invocation, Not BATS

Coverage collection wraps the individual shell script invocation inside the
generated `.bats` file, not the `bats` process itself. This ensures kcov tracks
the script under test rather than the BATS runner infrastructure.

### 4. Coverage Mode: "auto" (Default), true, false

- `"auto"` -- Detects kcov availability and macOS SIP. Enables shell coverage
  only when kcov is present and reliable (not macOS, where SIP blocks ptrace).
- `true` -- Requires kcov and a non-macOS environment. Throws on macOS or
  missing kcov.
- `false` -- Always excludes shell scripts from coverage.

### 5. enforce: "pre" on resolveId

The plugin uses `enforce: "pre"` so its `resolveId` hook runs before Vite's
built-in resolver. Without this, Vite would fail to resolve `.sh` imports
before the plugin has a chance to intercept them.

### 6. scripts.json Manifest at Transform Time

The manifest of registered scripts is written to Vite's `cacheDir` during
`load()` (transform time), not during test execution. This ensures the coverage
reporter has a complete list of scripts even if some tests are skipped or fail.

### 7. Reporter Always Injected When Coverage Enabled

`BatsCoverageReporter` is always injected when Vitest coverage is enabled,
regardless of whether kcov is available. This ensures shell scripts always
appear in the coverage table. The reporter uses `addFileCoverage()` which
bypasses Vitest's include/exclude filters.

### 8. Synthetic Coverage with GCD-Based Fractions

When kcov is unreliable, the reporter synthesizes coverage data at the exact
threshold percentage so scripts are neutral in threshold checks. The
`thresholdFraction()` algorithm uses GCD reduction to find the smallest
total/covered pair (e.g., 50% -> 1/2, 75% -> 3/4). Statement counts are padded
to be divisible by the denominator for exact percentages with no decimals.
Synthetic branch and function entries are always applied to shell scripts since
kcov cannot measure these for bash.

### 9. Runner Scoping via fromTransform Flag

The custom BatsRunner runs for ALL tests (set globally by the plugin's `config`
hook). To prevent unit tests that directly call `createBatsScript()` from
triggering BATS execution, the Vite transform passes `fromTransform = true` as
a third argument. The runner checks `active.fromTransform` before executing
BATS, skipping builders created directly in unit tests.

### 10. Plugin Auto-Injects Runner

Rather than requiring users to set `runner: "vitest-bats/runner"` manually, the
plugin's `config` hook sets it automatically. If the user has a conflicting
custom runner, the plugin throws with a clear error message.

## Docker Strategy

kcov requires `ptrace` which macOS SIP blocks. Docker provides a Linux
environment with `SYS_PTRACE` capability for full coverage collection.

- `Dockerfile.test` installs kcov from source, BATS, and all libraries
- `docker-compose.test.yml` mounts source and coverage dirs, adds `SYS_PTRACE`
- `HTE_PATH_REWRITE` env var rewrites container paths to host paths for
  clickable hyperlinks

## System Dependencies

| Dependency | Required | Detected By | Notes |
| --- | --- | --- | --- |
| bats | Always | `command -v bats` | BATS test runner |
| bats-support | Always | Library path search | BATS support library |
| bats-assert | Always | Library path search | BATS assertion library |
| bats-mock | Always | Library path search | Command mocking via binstub |
| jq | Always | `command -v jq` | JSON processing for assert_json_value |
| kcov | Coverage only | `command -v kcov` | Blocked by SIP on macOS; use Docker |

Library path search checks: `$XDG_CONFIG_HOME`, `~/.config`, `$XDG_DATA_HOME`,
`~/.local/share`, `/opt/homebrew/lib`, `/usr/local/lib`, `/usr/lib`.
