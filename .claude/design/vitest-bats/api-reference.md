---
status: current
module: vitest-bats
category: api-reference
created: 2026-04-21
updated: 2026-04-21
last-synced: 2026-04-21
---

# vitest-bats API Reference

## Public Exports (`vitest-bats`)

The main entry point (`package/src/index.ts`) re-exports everything consumers
need:

```typescript
// Plugin (primary API)
export { BatsPlugin } from "./plugin.js";
export type { BatsPluginOptions } from "./plugin.js";

// Test-writing API
export {
  BatsHelper,
  BatsAssertionBuilder,
  BatsTestContext,
  parseBatsFile,
  parseTapOutput,
  runBatsFile,
  verifyBatsInstalled,
} from "./vitest-kcov-bats-helper.js";
export type { BatsTest, FileResults, TestResult } from "./vitest-kcov-bats-helper.js";

// Coverage merge reporter
export { BatsCoverageReporter } from "./coverage-reporter.js";

// Kcov reporters
export { KcovCoverageReporter } from "./vitest-kcov-reporter-coverage.js";
export { default as KcovVerboseReporter } from "./vitest-kcov-reporter-verbose.js";

// Hyperlink utility
export { HTELink } from "./hte-link.js";
export type { HTELinkOptions } from "./hte-link.js";

// Types (side-effect import augments vitest/node)
export type { KcovOptions, KcovThresholds, LinkFormat, LogLevel } from "./vitest-kcov-types.js";
```

A second entry point `vitest-bats/provider` re-exports
`package/src/provider.ts` for use as `customProviderModule`.

## BatsPlugin (Vitest Plugin)

Primary integration point. Add to `vitest.config.ts` `plugins` array.

```typescript
import { BatsPlugin } from "vitest-bats";

export default defineConfig({
  plugins: [BatsPlugin()],
  test: { /* ... */ },
});
```

### BatsPluginOptions

```typescript
interface BatsPluginOptions {
  /** Inject KcovVerboseReporter. Default: true */
  reporter?: boolean;
  /** Log level for detection output. Default: "errors-only" */
  logLevel?: LogLevel;  // "verbose" | "debug" | "errors-only"
  /** Hyperlink format for reporter. Default: "auto" */
  links?: LinkFormat;   // "auto" | "default" | "hte"
}
```

### What BatsPlugin does at startup

1. Checks system dependencies (bats, bats-support, bats-assert, bats-mock, jq,
   and kcov when coverage is enabled)
2. Sets environment variables (`BATS_PATH`, `BATS_SUPPORT_PATH`, etc.) for
   BatsHelper to consume
3. Creates cache dir at `.vitest-bats-cache/`
4. When coverage is enabled, injects `BatsCoverageReporter` (first in reporter
   chain so it can mutate the CoverageMap)
5. Unless `reporter: false`, injects `KcovVerboseReporter`

### System Dependencies

| Dependency | Required | Notes |
| --- | --- | --- |
| bats | Yes | BATS test runner |
| bats-support | Yes | BATS support library |
| bats-assert | Yes | BATS assertion library |
| bats-mock | Yes | Command mocking via binstub |
| jq | Yes | JSON processing |
| kcov | Only with coverage | Blocked by SIP on macOS; use Docker |

## BatsHelper (Test-Writing API)

### BatsHelper.describe()

Static method that wraps `vitest.describe()` with lifecycle management:

```typescript
import { BatsHelper } from "vitest-bats";

const scriptPath = import.meta.resolve("../scripts/my-script.sh");

BatsHelper.describe(scriptPath, (helper) => {
  helper.test("name", (script) => {
    script.run('"$SCRIPT"');
    script.assert_success();
  });
});
```

This automatically calls `helper.setup()` in `beforeAll` and
`helper.teardown()` in `afterAll`. Preferred over manual lifecycle.

### BatsHelper.create(scriptPath)

Lower-level factory. Returns a singleton per script path. Requires manual
`setup()`/`teardown()` in `beforeAll`/`afterAll`.

### helper.test(name, callback)

Defines a BATS test. The callback receives a `BatsTestContext` with:

#### Command Execution

- `script.run(command)` -- Run a command and capture output/status
- `script.raw(bashCode)` -- Insert raw bash directly

#### Environment

- `script.env(vars)` -- Set env vars for the test
- `script.mock(command, responses, options?)` -- Mock a command via bats-mock.
  `options.fallback: true` falls through to real command on miss.

#### Assertions

- `script.assert_success()` -- Exit code 0
- `script.assert_failure()` -- Non-zero exit code
- `script.assert_output({ partial?, regexp? })` -- Check stdout
- `script.assert_json_value(dotPath, expected)` -- Check JSON field (supports
  strings, numbers, booleans, null)

### helper.skip(name, callback)

Skips a test (not added to generated BATS file).

## BatsCoverageReporter

Injected by BatsPlugin when coverage is enabled. Implements `onCoverage()`
hook to parse kcov's cobertura.xml output and merge it into the v8 Istanbul
CoverageMap via `addFileCoverage()`.

Reads from `.vitest-bats-cache/kcov/*/cobertura.xml`.

## KcovCoverageReporter

Istanbul-style terminal coverage table for shell scripts. Features:

- Color-coded coverage percentages
- Clickable uncovered line ranges (VSCode URL scheme)
- Smart file path display (shortest common path)
- macOS zero-coverage warning

## KcovVerboseReporter

Enhanced test output reporter:

- Shortened file paths
- OSC 8 clickable hyperlinks for test files and scripts
- Colored duration times

## HTELink

Terminal hyperlink utility. Generates OSC 8 escape sequences for clickable
links in supported terminals (WezTerm, VSCode, iTerm2, GNOME Terminal).

```typescript
const linker = new HTELink({ mode: "hte" });
const link = linker.create("vscode://file/path/to/file.ts", "file.ts");
```

### Docker Path Rewriting

Set `HTE_PATH_REWRITE=/workspace:$PWD` and `FORCE_HTE_LINKS=1` to rewrite
container paths to host paths in hyperlinks.

## KcovOptions (Vitest Config Extension)

Side-effect import from `vitest-bats` augments `vitest/node`
`CustomProviderOptions` with:

```typescript
interface KcovOptions {
  enabled?: boolean;
  logLevel?: "verbose" | "debug" | "errors-only";
  links?: "default" | "hte" | "auto";
}
```

## Coverage Exclusion Markers

Use LCOV markers in shell scripts to exclude untestable code:

```bash
# LCOV_EXCL_START
  # ... excluded code ...
# LCOV_EXCL_STOP
```

Exclude: help text, platform-specific branches not under test, unreachable
defensive checks. Never exclude normal business logic.
