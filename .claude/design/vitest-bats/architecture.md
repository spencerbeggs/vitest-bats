---
status: current
module: vitest-bats
category: architecture
created: 2026-04-21
updated: 2026-04-21
last-synced: 2026-04-21
---

# vitest-bats Architecture

## Overview

vitest-bats is a Vitest plugin that enables shell script testing via BATS
(Bash Automated Testing System) with kcov coverage collection, integrated into
Vitest's standard test and coverage pipeline.

## Data Flow

```text
TypeScript test (.test.ts)
  -> BatsHelper.describe() registers script + test definitions
  -> helper.setup() generates .bats file in .vitest-bats-cache/
  -> Vitest runs tests (which shell out to bats)
  -> kcov wraps bats execution, producing cobertura.xml
  -> BatsCoverageReporter.onCoverage() parses XML
  -> Merges into v8 Istanbul CoverageMap via addFileCoverage()
  -> Unified coverage report (TypeScript + shell scripts)
```

## Component Map

### Plugin Layer (`plugin.ts`)

`BatsPlugin()` is the single integration point. It:

1. Validates system dependencies (bats, kcov, jq, bats-mock, etc.)
2. Exports env vars for BatsHelper
3. Injects reporters into Vitest config via `configureVitest()`

### Test-Writing Layer (`vitest-kcov-bats-helper.ts`)

`BatsHelper` provides the TypeScript API for writing BATS tests:

- `BatsHelper.describe(scriptPath, fn)` -- high-level wrapper with lifecycle
- `BatsHelper.create(scriptPath)` -- singleton factory
- `BatsTestContext` -- fluent builder for test assertions

Generated BATS files go to `.vitest-bats-cache/`.

### Coverage Layer

- `vitest-kcov-provider.ts` -- Custom Vitest coverage provider that runs kcov
  on generated BATS files. Handles dependency checking, per-test-file coverage
  collection, and coverage merging.
- `coverage-reporter.ts` -- `BatsCoverageReporter` implements `onCoverage()`
  to parse cobertura.xml and inject into Istanbul CoverageMap.
- `vitest-kcov-reporter-coverage.ts` -- `KcovCoverageReporter` renders
  Istanbul-style terminal coverage table for shell scripts.

### Reporter Layer

- `vitest-kcov-reporter-verbose.ts` -- Enhanced test output with OSC 8
  hyperlinks and colored durations.
- `hte-link.ts` -- Terminal hyperlink utility (OSC 8 escape sequences).

### Type Augmentation (`vitest-kcov-types.ts`)

Side-effect import that augments `vitest/node` `CustomProviderOptions` with
`kcov` field, enabling typed kcov config in `vitest.config.ts`.

## Package Structure

```text
package/
  src/
    index.ts                          # Main entry: re-exports public API
    provider.ts                       # Secondary entry: vitest-bats/provider
    plugin.ts                         # BatsPlugin() -- primary integration
    coverage-reporter.ts              # BatsCoverageReporter (CoverageMap merge)
    vitest-kcov-bats-helper.ts        # BatsHelper test-writing API
    vitest-kcov-provider.ts           # Custom kcov coverage provider
    vitest-kcov-reporter-coverage.ts  # Terminal coverage table
    vitest-kcov-reporter-verbose.ts   # Enhanced test reporter
    hte-link.ts                       # OSC 8 hyperlink utility
    platform-utils.ts                 # OS detection helpers
    vitest-kcov-types.ts              # Type augmentation for vitest/node
  package.json                        # Published as `vitest-bats`
  rslib.config.ts                     # Build config
```

## Workspace Layout

```text
vitest-bats/              # Root workspace (consumer / integration tests)
  package/                # The npm package (`vitest-bats`)
  scripts/                # Example shell scripts for testing
  __test__/               # Integration/e2e tests consuming vitest-bats
  Dockerfile.test         # Docker environment for kcov on macOS
  docker-compose.test.yml # Docker Compose for test runner
```

The root workspace depends on `vitest-bats: workspace:*` and serves as both
the development harness and the integration test suite.

## Docker Strategy

kcov requires `ptrace` which macOS SIP blocks. Docker provides a Linux
environment with `SYS_PTRACE` capability for full coverage collection.

- `Dockerfile.test` installs kcov from source, BATS, and all libraries
- `docker-compose.test.yml` mounts source and coverage dirs, adds `SYS_PTRACE`
- `HTE_PATH_REWRITE` env var rewrites container paths to host paths for
  clickable hyperlinks

## Design Decisions

1. **Plugin over manual config** -- `BatsPlugin()` handles all wiring
   (reporters, env vars, dependency checks) instead of requiring users to
   configure each piece separately.

2. **BatsHelper.describe() over raw beforeAll/afterAll** -- Encapsulates BATS
   lifecycle, reduces boilerplate, provides consistent test structure.

3. **Coverage merge via onCoverage hook** -- Injects shell script coverage into
   the existing v8 CoverageMap so `--coverage` shows unified results.

4. **Singleton BatsHelper per script** -- Prevents duplicate BATS file
   generation when multiple test files reference the same script.
