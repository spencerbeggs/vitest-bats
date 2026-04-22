# Runner Scoping Investigation

## Status

The custom BatsRunner IS loading and executing BATS tests. The core pipeline
works. But there are two interrelated problems that need solving before the
runner can be wired up in production.

## Problem 1: Runner config injection

### What we found

The `runner` field in vitest.config.ts IS resolved by Vitest (confirmed via
`createVitest` API — `project.config.runner` resolves to the absolute path).
The BatsPlugin's `configureVitest` hook also successfully sets it. The runner
module at `vitest-bats/runner` exists and exports the correct class.

However, when we first tested, the runner appeared to be "ignored" because
tests completed in 0-1ms (real BATS execution takes 40-130ms per test). The
ScriptBuilder methods (run, assert_success, etc.) don't throw — they just
record commands. So vitest's default runner ran the handler, saw no errors,
and reported "pass."

### The real issue was globalThis

The runner WAS loading. But `findActive()` in the runner always returned null
because the ScriptBuilder registry was a module-level `Map`. Vite's module
runner creates separate module contexts for:

1. The test file (which imports `vitest-bats/runtime` via the .sh transform)
2. The custom runner (which imports `vitest-bats/runtime` directly)

Each got their own copy of the registry Map. The test file populated registry
instance A; the runner queried registry instance B (always empty).

### Fix applied

Changed the registry to use `globalThis.__vitest_bats_registry__` so both
module contexts share the same Map. This is in `package/src/runtime.ts`.

After this fix, the runner correctly detected active ScriptBuilders and
executed BATS. Tests took 130-555ms (real execution) and produced real
BATS errors (script permission denied — confirming actual execution).

## Problem 2: Runner scoping

### The issue

When `runner: "vitest-bats/runner"` is set globally in vitest.config.ts,
ALL tests use the custom runner — including the package unit tests in
`package/__test__/`. Those unit tests exercise ScriptBuilder methods directly
(e.g., `script.run('"$SCRIPT"')`) to verify the data recorder works. The
runner then sees an active ScriptBuilder after the handler returns and tries
to execute BATS for what was supposed to be a pure unit test.

12 of 43 tests fail because the runner tries to generate .bats files from
unit test commands that were only meant to test the recorder.

### Current workaround

The `runner` field is NOT set in vitest.config.ts. The plugin's
`configureVitest` no longer injects it either. This means the default
TestRunner is used for all tests, and BATS execution doesn't happen.
Tests "pass" because ScriptBuilder methods don't throw. This is the
checkpoint state.

### Why this is a problem

Without the custom runner, the integration tests in `__test__/hello.test.ts`
and `__test__/sysinfo.test.ts` don't actually execute BATS. They just record
commands on the ScriptBuilder and return. The tests verify nothing — they're
recording intentions but never executing them.

## Approaches to solve runner scoping

### Option A: Vitest workspace projects

Use vitest.workspace.ts (or the projects array) to create two test projects
with different runners:

```ts
// vitest.workspace.ts
export default [
  {
    test: {
      name: "unit",
      include: ["package/__test__/**/*.test.ts"],
      // default runner — no BATS execution
    },
  },
  {
    test: {
      name: "integration",
      include: ["__test__/**/*.test.ts"],
      runner: "vitest-bats/runner",
      // custom runner — executes BATS
    },
  },
];
```

Pros: Clean separation, each project has its own runner config.
Cons: Adds workspace complexity. Need to verify that @savvy-web/vitest
auto-discovery doesn't interfere. Coverage merging across projects needs
testing.

### Option B: Transform-based marker

The Vite transform already knows which test files import .sh files (it
runs resolveId/load for them). It could inject a marker into those files
that the runner checks:

```ts
// In the generated .sh virtual module:
globalThis.__vitest_bats_active_files__?.add(import.meta.url);
```

The runner checks if the current test file is in the active set. If not,
it skips BATS execution. This way the runner is global but only fires for
files that actually import .sh scripts.

Pros: No workspace complexity. Runner auto-detects which tests are BATS.
Cons: Relies on import.meta.url matching between transform and runner
contexts. Adds another globalThis coordination point.

### Option C: ScriptBuilder origin tracking

Add a `fromTransform` flag to ScriptBuilder that's only set when created
via the Vite transform (createBatsScript called from generated code).
The runner only executes BATS when `active.fromTransform` is true.

Unit tests that create ScriptBuilder directly (via `new ScriptBuilder()` or
`createBatsScript()` from test code) won't have this flag, so the runner
skips them.

Pros: Simple, no workspace changes, self-contained.
Cons: The flag could be accidentally set by test code. The transform
generates the same `createBatsScript()` call that unit tests use — need
a way to distinguish (extra parameter, or separate factory function).

### Option D: Separate factory for transforms

The transform generates a different function call than what's exported
publicly:

```ts
// Transform generates (internal, not exported):
import { __createBatsScriptFromTransform } from "vitest-bats/runtime";
export default __createBatsScriptFromTransform(path, name);
```

This internal function sets a flag on the builder. The public
`createBatsScript()` doesn't. Runner checks the flag.

Pros: Clean separation between transform-created and test-created builders.
Cons: Leaks internal API through the runtime module.

### Recommended approach

Option B (transform-based marker) seems cleanest. The transform already
runs only for .sh imports and knows exactly which files are BATS test files.
Having the runner check a per-file marker is simple and doesn't require
workspace configuration or API changes.

## Other notes from this session

### kcov wrapping

kcov must wrap the SCRIPT execution inside the .bats file, NOT the bats
command itself. Wrapping `kcov ... bats --tap file.bats` instruments the
bats framework code, not the script under test.

The fix: `generateBatsFile()` accepts an optional `KcovConfig` and generates
`run kcov --skip-solibs ... "$SCRIPT"` instead of `run "$SCRIPT"` when the
command invokes $SCRIPT.

This is implemented in bats-generator.ts but not yet tested end-to-end with
real kcov (Docker was broken during that debugging session).

### Script permissions

The runner calls `chmodSync` to ensure scripts are executable before
generating .bats files. Without this, bats gets "Permission denied" errors.
This is in runner.ts.

### Environment variable passing

The plugin sets `__VITEST_BATS_KCOV__` and `__VITEST_BATS_CACHE_DIR__` env
vars in `configureVitest`. These propagate to forked worker processes because
configureVitest runs before workers are forked. The runner reads them in its
constructor.

BATS dependency paths (BATS_PATH, BATS_SUPPORT_PATH, etc.) are set by
`checkDependencies()` in the plugin. These also propagate to workers.

### Docker testing

Docker tests pass (43/43) but kcov coverage wasn't verified end-to-end
because the runner wasn't wired up during Docker testing. Once the runner
scoping is solved, Docker testing with kcov should be retested.

The Dockerfile was updated for the new architecture:
- pnpm 10.33.0
- Copies full project before install (prepare script needs turbo.json)
- .dockerignore added
- Coverage volume mount removed (caused EBUSY on rmdir)

### Vitest 4 runner API notes

- TestRunner exported from "vitest" (not "vitest/runners" which is deprecated)
- Constructor receives serialized config
- Vitest injects moduleRunner as a property after construction
- Key hooks: onBeforeRunTask, onAfterTryTask (NOT runTest — that doesn't exist)
- config.runner resolves via mlly's resolveModule
- The runner is instantiated in the worker process, not the main process
