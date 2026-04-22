# vitest-bats Package

The publishable npm package. Provides a Vitest plugin for testing shell scripts
via BATS with kcov coverage collection.

## Package Overview

Published as `vitest-bats` to npm and GitHub Packages. Three entry points:

- `vitest-bats` (`src/index.ts`) -- Main entry: BatsPlugin, ScriptBuilder, reporters, types
- `vitest-bats/runner` (`src/runner.ts`) -- Custom test runner (auto-injected by plugin)
- `vitest-bats/runtime` (`src/runtime.ts`) -- Runtime API: ScriptBuilder, registry

## Source Layout

```text
src/
  index.ts                          # Public API re-exports
  plugin.ts                         # BatsPlugin() -- Vite transform + runner setup
  runner.ts                         # Custom test runner (auto-injected by plugin)
  runtime.ts                        # ScriptBuilder + registry (test-writing API)
  bats-generator.ts                 # Generates .bats file content from test definitions
  coverage-reporter.ts              # BatsCoverageReporter (CoverageMap merge)
  shims.d.ts                        # Module declarations for virtual imports
  vitest-kcov-types.ts              # Type augmentation for vitest/node
```

## Primary APIs

### BatsPlugin (plugin.ts)

Vitest plugin added to `plugins` array. Handles:

1. System dependency detection (bats, kcov, jq, bats-mock, bats-support,
   bats-assert)
2. Vite transform: resolves `.sh` imports into ScriptBuilder instances
   (with `fromTransform: true` for runner scoping)
3. Auto-injects custom BatsRunner via `config` hook -- errors if user sets
   a conflicting `runner` manually
4. Cache directory creation (scoped under Vite's cacheDir as `vitest-bats/`)
5. Coverage reporter injection: always injects `BatsCoverageReporter` when
   coverage is enabled, with synthetic branch/function entries

### ScriptBuilder (runtime.ts)

Test-writing API. Import `.sh` files in standard `.test.ts` files:

```typescript
import hello from "../scripts/hello.sh";

test("outputs greeting", () => {
  hello.run('"$SCRIPT"');
  hello.assert_success();
  hello.assert_output({ partial: "Hello" });
});
```

Has a `fromTransform` flag (set `true` by the Vite transform) so the runner
only processes transform-originated ScriptBuilders. Uses a `globalThis`
registry shared across Vite module runner contexts.

Key methods: `run()`, `raw()`, `env()`, `mock()`, `flags()`,
`assert_success()`, `assert_failure()`, `assert_output()`, `assert_line()`,
`assert_json_value()`, `assert()`, `exit()`.

### BatsCoverageReporter (coverage-reporter.ts)

Constructor: `new BatsCoverageReporter(cacheDir, { thresholds?, statementPassThrough? })`.
Always injected by BatsPlugin when coverage is enabled. Implements `onCoverage()`
hook: parses kcov cobertura.xml, converts to Istanbul format, and injects into
the v8 CoverageMap. Adds synthetic branch/function entries to satisfy threshold
checks (kcov only tracks statements/lines). When `statementPassThrough` is
true (kcov unreliable), also synthesizes statement data so scripts are neutral
in threshold checks.

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
