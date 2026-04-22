---
"vitest-bats": major
---

## Breaking Changes

The `BatsHelper.describe()` + `import.meta.resolve()` test-writing API has been removed and replaced with a Vite import transform. Shell scripts are now imported directly as ES modules, and tests are written using standard Vitest `describe`/`test` blocks.

### Removed exports

- `BatsHelper` -- replaced by direct `.sh` module imports via Vite transform
- `BatsTestContext` -- replaced by `ScriptBuilder` (exposed through the imported script module)
- `KcovVerboseReporter` -- removed entirely
- `KcovCoverageReporter` -- removed entirely; use `BatsCoverageReporter`
- `vitest-bats/provider` -- subpath removed; use `vitest-bats/runner` and `vitest-bats/runtime`

### Added exports

- `vitest-bats/runner` -- custom Vitest runner (auto-injected by plugin)
- `vitest-bats/runtime` -- `ScriptBuilder` and registry helpers for advanced use

### Peer dependency

The minimum supported Vitest version has changed from `>=3.0.0` to `>=4.1.0`.

### Migration

**Before:**

```ts
import { BatsHelper } from "vitest-bats";

const scriptPath = import.meta.resolve("../scripts/hello.sh");

BatsHelper.describe(scriptPath, (helper) => {
  helper.test("outputs greeting", (script) => {
    script.run('"$SCRIPT"');
    script.assert_success();
    script.assert_output({ partial: "Hello World" });
  });
});
```

**After:**

```ts
import { describe, test } from "vitest";
import hello from "../scripts/hello.sh";

describe("hello.sh", () => {
  test("outputs greeting", () => {
    hello.run('"$SCRIPT"');
    hello.assert_success();
    hello.assert_output({ partial: "Hello World" });
  });
});
```

No changes are required to `vitest.config.ts` -- `BatsPlugin()` continues to be added to the `plugins` array and now automatically registers the Vite transform and custom runner.

## Features

### Vite Transform Pipeline

`BatsPlugin` includes Vite `resolveId`/`load` transform hooks that resolve `.sh` imports to a `ScriptBuilder` instance, enabling native ES module syntax for shell script test files.

### Automatic Runner Injection

The plugin auto-injects the custom `BatsRunner` via its Vite `config` hook. Users never set `runner` manually. The runner uses a `fromTransform` flag on `ScriptBuilder` to only execute BATS for scripts imported via the transform, leaving unit tests that create ScriptBuilders directly unaffected.

### Coverage Pipeline

- `BatsCoverageReporter` is always injected when Vitest coverage is enabled
- Real kcov data: parses cobertura.xml, merges hit counts across test runs
- Synthetic coverage: when kcov is unreliable (macOS SIP), synthesizes coverage at exact threshold level using GCD-based fractions so shell scripts are neutral in threshold checks
- Synthetic branch/function entries always applied (kcov only tracks statements/lines for bash)

### ScriptBuilder API

New fluent API supports `run()`, `raw()`, `env()`, `mock()`, `flags()`, `assert_success()`, `assert_failure()`, `assert_output()`, `assert_line()`, `assert_json_value()`, `assert()`, and `exit()`.

### Coverage Mode Option

New `coverage` option on `BatsPlugin`: accepts `"auto"` (default, detects macOS SIP and skips kcov when blocked), `true` (always run kcov), or `false` (disable kcov entirely).

### BATS Generator

New pure function `generateBatsFile` compiles a `ScriptBuilder` command list into a `.bats` file, with optional kcov wrapping for coverage collection.
