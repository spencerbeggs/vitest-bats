# vitest-bats

A [Vitest](https://vitest.dev/) plugin for testing bash scripts with
[BATS](https://github.com/bats-core/bats-core) and collecting
[kcov](https://github.com/SimonKagstrom/kcov) coverage, merged into Vitest's
standard v8 coverage report.

## Features

- **Single plugin setup** -- `BatsPlugin()` handles dependency detection,
  reporter injection, and environment configuration
- **TypeScript test API** -- Write BATS tests in TypeScript with
  `BatsHelper.describe()` and a fluent assertion builder
- **Unified coverage** -- Shell script coverage from kcov is merged into the v8
  Istanbul CoverageMap via `BatsCoverageReporter`
- **Command mocking** -- Mock system commands with controlled responses via
  bats-mock integration
- **Terminal hyperlinks** -- OSC 8 clickable links for test files and coverage
  reports in supported terminals
- **Docker support** -- Full coverage collection on macOS via Docker (kcov
  requires ptrace, blocked by macOS SIP)

## Installation

```bash
npm install --save-dev vitest-bats vitest
```

### System Dependencies

These must be installed on your system (or in your Docker container):

| Dependency | Required | Install (macOS) | Install (Linux) |
| --- | --- | --- | --- |
| bats | Yes | `brew install bats-core` | `apt-get install bats` |
| bats-support | Yes | `brew install bats-support` | `apt-get install bats-support` |
| bats-assert | Yes | `brew install bats-assert` | `apt-get install bats-assert` |
| bats-mock | Yes | `brew install bats-mock` | `apt-get install bats-file` |
| jq | Yes | `brew install jq` | `apt-get install jq` |
| kcov | Coverage only | `brew install kcov` | `apt-get install kcov` |

## Quick Start

### 1. Configure Vitest

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { BatsPlugin } from "vitest-bats";

export default defineConfig({
  plugins: [BatsPlugin()],
  test: {
    include: ["__test__/**/*.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
```

### 2. Write Tests

```typescript
// __test__/my-script.test.ts
import { BatsHelper } from "vitest-bats";

const scriptPath = import.meta.resolve("../scripts/my-script.sh");

BatsHelper.describe(scriptPath, (helper) => {
  helper.test("outputs default greeting", (script) => {
    script.run('"$SCRIPT"');
    script.assert_success();
    script.assert_output({ partial: "Hello World" });
  });

  helper.test("greets by name", (script) => {
    script.run('"$SCRIPT" --name Alice');
    script.assert_success();
    script.assert_output({ partial: "Hello Alice" });
  });

  helper.test("outputs JSON with --json flag", (script) => {
    script.run('"$SCRIPT" --json');
    script.assert_success();
    script.assert_json_value("greeting", "Hello World");
  });

  helper.test("rejects unknown arguments", (script) => {
    script.run('"$SCRIPT" --invalid');
    script.assert_failure();
    script.assert_output({ partial: "Unknown option" });
  });
});
```

### 3. Run Tests

```bash
vitest run
vitest run --coverage  # With coverage (requires kcov on Linux)
```

## API Reference

### BatsPlugin

Vitest plugin. Add to the `plugins` array in `vitest.config.ts`.

```typescript
import { BatsPlugin } from "vitest-bats";

BatsPlugin({
  reporter: true,       // Inject KcovVerboseReporter (default: true)
  logLevel: "errors-only", // "verbose" | "debug" | "errors-only"
  links: "auto",        // "auto" | "default" | "hte"
});
```

**What it does at startup:**

1. Checks system dependencies (bats, bats-support, bats-assert, bats-mock, jq,
   kcov when coverage is enabled)
2. Sets environment variables for BatsHelper (`BATS_PATH`, `BATS_SUPPORT_PATH`,
   etc.)
3. Creates the cache directory (`.vitest-bats-cache/`)
4. Injects `BatsCoverageReporter` when coverage is enabled
5. Injects `KcovVerboseReporter` unless `reporter: false`

### BatsHelper.describe

Wraps `vitest.describe()` with BATS lifecycle management. This is the
recommended way to write tests.

```typescript
import { BatsHelper } from "vitest-bats";

BatsHelper.describe(import.meta.resolve("../scripts/my-script.sh"), (helper) => {
  helper.test("test name", (script) => {
    // ... test body
  });
});
```

Automatically calls `setup()` in `beforeAll` and `teardown()` in `afterAll`.

### Test Context (script)

The callback in `helper.test()` receives a `BatsTestContext` with these
methods:

#### Command Execution

- **`script.run(command)`** -- Run a command and capture output/status
- **`script.raw(bashCode)`** -- Insert raw bash code directly

#### Environment

- **`script.env(vars)`** -- Set environment variables for the test
- **`script.mock(command, responses, options?)`** -- Mock a command via
  bats-mock. Pass `{ fallback: true }` to fall through to the real command on
  unmatched arguments.

#### Assertions

- **`script.assert_success()`** -- Assert exit code 0
- **`script.assert_failure()`** -- Assert non-zero exit code
- **`script.assert_output({ partial?, regexp? })`** -- Assert stdout content
- **`script.assert_json_value(dotPath, expected)`** -- Assert a JSON field
  value (supports strings, numbers, booleans, null)

### BatsHelper.create (Low-Level)

For manual lifecycle control:

```typescript
const helper = BatsHelper.create(import.meta.resolve("../scripts/my-script.sh"));

describe("my-script.sh", () => {
  beforeAll(() => helper.setup(), 60000);
  afterAll(() => helper.teardown());

  helper.test("test name", (script) => {
    script.run('"$SCRIPT"');
    script.assert_success();
  });
});
```

### Template Literal Syntax

For raw BATS syntax:

```typescript
helper.it`@test "custom BATS test" {
  run "$SCRIPT" --help
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "Usage:"
}`;
```

### Skipping Tests

```typescript
helper.skip("skipped test name", (script) => {
  // This test will not run
});
```

## Coverage

### How It Works

1. Vitest runs TypeScript test files
2. `BatsHelper` generates `.bats` files in `.vitest-bats-cache/`
3. Each BATS test runs scripts through kcov for coverage collection
4. `BatsCoverageReporter.onCoverage()` parses kcov's `cobertura.xml` output
5. Coverage is converted to Istanbul format and merged into the v8 CoverageMap
6. Vitest reports unified coverage (TypeScript + shell scripts)

### Platform Support

| Platform | Tests | Coverage |
| --- | --- | --- |
| Linux | Full support | Full support |
| macOS | Full support | Not supported (SIP blocks ptrace) |
| Docker on macOS | Full support | Full support |

### Custom Coverage Provider

For advanced kcov configuration, use the custom provider entry point:

```typescript
// vitest.config.ts
import "vitest-bats"; // Side-effect: augments CustomProviderOptions with kcov

export default defineConfig({
  test: {
    coverage: {
      provider: "custom",
      customProviderModule: "vitest-bats/provider",
      kcov: {
        logLevel: "errors-only",
        links: "auto",
        thresholds: {
          lines: 80,
        },
      },
    },
  },
});
```

### LCOV Exclusion Markers

Exclude untestable code from coverage:

```bash
# LCOV_EXCL_START
  # ... excluded code ...
# LCOV_EXCL_STOP
```

## Docker Setup

On macOS, use Docker for full kcov coverage:

```yaml
# docker-compose.test.yml
services:
  test:
    build:
      context: .
      dockerfile: Dockerfile.test
    cap_add:
      - SYS_PTRACE
    security_opt:
      - apparmor:unconfined
    environment:
      - CI=true
      - FORCE_HTE_LINKS=${FORCE_HTE_LINKS:-0}
      - HTE_PATH_REWRITE=${HTE_PATH_REWRITE:-}
```

Set `FORCE_HTE_LINKS=1` and `HTE_PATH_REWRITE=/workspace:$PWD` for clickable
terminal hyperlinks from Docker containers.

## Troubleshooting

### Coverage Shows 0% on macOS

Expected behavior. Kcov cannot instrument bash scripts on macOS due to SIP.
Use Docker or run in CI on Linux.

### "Missing required dependencies" Error

BatsPlugin checks for system dependencies at startup. Install the missing tools
listed in the error message.

### BATS Tests Fail

Check generated BATS files in `.vitest-bats-cache/`:

```bash
bats .vitest-bats-cache/my-script-001.bats
```

## Related

- [Vitest](https://vitest.dev/) -- Test framework
- [BATS](https://github.com/bats-core/bats-core) -- Bash Automated Testing
  System
- [kcov](https://github.com/SimonKagstrom/kcov) -- Code coverage for shell
  scripts
- [bats-mock](https://github.com/jasonkarns/bats-mock) -- Command mocking for
  BATS

## License

[MIT](LICENSE)
