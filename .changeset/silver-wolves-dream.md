---
"vitest-bats": minor
---

## Features

### BatsPlugin

Vitest plugin that integrates BATS-based shell script testing into a standard Vitest project. Add it to the `plugins` array for zero-config setup: the plugin auto-detects required system dependencies (`bats`, `kcov`, `jq`, `bats-support`, `bats-assert`, `bats-mock`), exports environment variables for test helpers, creates the `.vitest-bats-cache/` working directory, and injects `BatsCoverageReporter` and `KcovVerboseReporter` automatically.

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { BatsPlugin } from "vitest-bats";

export default defineConfig({
  plugins: [BatsPlugin()],
});
```

### BatsHelper.describe

TypeScript API for authoring BATS test suites without writing raw shell. Wraps `vitest.describe()` with full BATS lifecycle management. Provides a fluent assertion builder supporting mock injection, environment variable overrides, JSON value assertions, and automatic `.bats` file generation.

```typescript
import { BatsHelper } from "vitest-bats";

BatsHelper.describe(import.meta.resolve("../scripts/greet.sh"), (helper) => {
  helper.test("outputs greeting", (script) => {
    script.run('"$SCRIPT"');
    script.assert_success();
    script.assert_output({ partial: "Hello" });
  });
});
```

Key context methods: `run()`, `raw()`, `env()`, `mock()`, `assert_success()`, `assert_failure()`, `assert_output()`, `assert_json_value()`.

### BatsCoverageReporter

Vitest coverage reporter that merges kcov shell script coverage into Vitest's v8 Istanbul `CoverageMap`. Parses kcov's `cobertura.xml` output from `.vitest-bats-cache/kcov/` and converts it to Istanbul format, so shell scripts appear alongside TypeScript files in standard `--coverage` reports without any additional tooling.

### KcovVerboseReporter

Enhanced test reporter with OSC 8 terminal hyperlink support. File paths in test output are rendered as clickable links in compatible terminals (iTerm2, Ghostty, VS Code integrated terminal). Supports `HTE_PATH_REWRITE` for remapping Docker container paths to host paths, enabling clickable links when running tests inside a container.
