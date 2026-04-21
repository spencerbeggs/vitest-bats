# vitest-bats Package

The publishable npm package. Provides a Vitest plugin for testing shell scripts
via BATS with kcov coverage collection.

## Package Overview

Published as `vitest-bats` to npm and GitHub Packages. Two entry points:

- `vitest-bats` (`src/index.ts`) -- Main entry: BatsPlugin, BatsHelper, reporters, types
- `vitest-bats/provider` (`src/provider.ts`) -- Custom coverage provider module

## Source Layout

```text
src/
  index.ts                          # Public API re-exports
  provider.ts                       # Secondary entry (vitest-bats/provider)
  plugin.ts                         # BatsPlugin() -- primary Vitest integration
  coverage-reporter.ts              # BatsCoverageReporter (CoverageMap merge)
  vitest-kcov-bats-helper.ts        # BatsHelper test-writing API
  vitest-kcov-provider.ts           # Custom kcov coverage provider
  vitest-kcov-reporter-coverage.ts  # Istanbul-style terminal coverage table
  vitest-kcov-reporter-verbose.ts   # Enhanced test reporter with OSC 8 links
  hte-link.ts                       # Terminal hyperlink utility
  platform-utils.ts                 # OS detection helpers
  vitest-kcov-types.ts              # Type augmentation for vitest/node
```

## Primary APIs

### BatsPlugin (plugin.ts)

Vitest plugin added to `plugins` array. Handles:

1. System dependency detection (bats, kcov, jq, bats-mock, bats-support,
   bats-assert)
2. Environment variable export for BatsHelper
3. Cache directory creation (`.vitest-bats-cache/`)
4. Reporter injection (BatsCoverageReporter + KcovVerboseReporter)

### BatsHelper.describe (vitest-kcov-bats-helper.ts)

Test-writing API. Wraps `vitest.describe()` with BATS lifecycle:

```typescript
import { BatsHelper } from "vitest-bats";

BatsHelper.describe(import.meta.resolve("../scripts/my-script.sh"), (helper) => {
  helper.test("outputs greeting", (script) => {
    script.run('"$SCRIPT"');
    script.assert_success();
    script.assert_output({ partial: "Hello" });
  });
});
```

Key test context methods: `run()`, `raw()`, `env()`, `mock()`,
`assert_success()`, `assert_failure()`, `assert_output()`,
`assert_json_value()`.

### BatsCoverageReporter (coverage-reporter.ts)

Implements `onCoverage()` hook. Parses kcov's cobertura.xml output from
`.vitest-bats-cache/kcov/*/cobertura.xml` and converts to Istanbul format,
then injects into the v8 CoverageMap via `addFileCoverage()`.

## Dependencies

- **Runtime**: `fast-xml-parser` (cobertura.xml parsing), `minimatch`
- **Peer**: `vitest >=3.0.0`
- **System**: bats, bats-support, bats-assert, bats-mock, jq, kcov (coverage only)

## Build

Uses `@savvy-web/rslib-builder`. The source `private: true` is correct -- the
builder transforms it based on `publishConfig.access`.

```bash
cd package
pnpm run build:dev         # Development build
pnpm run build:prod        # Production build
```

## Docker for Coverage

kcov requires `ptrace` (blocked by macOS SIP). Use Docker:

- `Dockerfile.test` in repo root installs kcov from source + BATS libraries
- `docker-compose.test.yml` adds `SYS_PTRACE` capability
- Set `HTE_PATH_REWRITE=/workspace:$PWD` for clickable hyperlinks from Docker

## Design Documentation

**For detailed information, load these when working on internals:**

- Architecture and data flow: `@../.claude/design/vitest-bats/architecture.md`
- Full API reference: `@../.claude/design/vitest-bats/api-reference.md`

Load when modifying exports, changing the coverage pipeline, or adding new
components. **Do NOT load unless directly relevant.**
