---
status: current
module: vitest-bats
category: architecture
created: 2026-04-21
updated: 2026-04-27
last-synced: 2026-04-27
completeness: 95
related:
  - vitest-bats/api-reference.md
---

# vitest-bats Architecture

## Overview

vitest-bats is a Vitest plugin that enables testing shell scripts via BATS
(Bash Automated Testing System) with optional kcov coverage collection. It uses
a Vite transform to intercept `.sh` imports, returning a `ScriptBuilder`. Each
test calls `script.run(...)` (or `script.exec(...)`) which generates and
executes a `.bats` file synchronously and returns a `BatsResult`. Vitest
matchers (`expect(result).toSucceed()`, `toContainOutput`, `toHaveJsonValue`,
etc.) are auto-registered via a setup file the plugin injects into
`test.setupFiles`. Coverage results are merged into Vitest's v8 Istanbul
CoverageMap for unified reporting.

## Data Flow

```text
1. User writes:  import hello from "../scripts/hello.sh"

2. BatsPlugin.resolveId() intercepts the .sh import
   -> returns virtual module ID: "\0bats:/absolute/path/to/hello.sh"

3. BatsPlugin.load() generates JS for the virtual module:
   -> import { ScriptBuilder } from "vitest-bats/runtime";
   -> export default new ScriptBuilder("/abs/path/hello.sh", "hello.sh");

4. BatsPlugin.config() appends "vitest-bats/setup" to test.setupFiles.
   The setup module runs once per worker:
   -> expect.extend(batsMatchers)
   -> beforeEach(() => resetAllBuilders())

5. User calls hello.env(...).flags(...).mock(...).run(...args) in test().
   The builder accumulates env/flags/stubs, then run()/exec() consumes them:
   -> generateBatsFile() builds a self-contained .bats file
   -> executeBats() spawns `bats --tap <file>` synchronously
   -> The .bats test writes status/output/stderr (base64) to result.txt
      and mock invocations to calls.jsonl in a per-execution recorderDir
   -> parseExecutionResult() reads those files and returns BatsResultData
   -> ScriptBuilder.run() wraps it in `new BatsResult(data)` and resets state

6. Test asserts on the result via expect(result).toX():
   -> Matchers from matchers.ts use a Symbol-brand check in ensureBatsResult()
      to accept the value (instanceof can't be used across rslib entries —
      see "Build-Time Class Identity" below)
   -> Failed matchers throw via the standard expect.extend contract,
      Vitest marks the test failed

7. Coverage (only when Vitest coverage is enabled):
   -> BatsPlugin's configureVitest hook sets __VITEST_BATS_KCOV__=1 when
      kcov is reliable, and unconditionally injects BatsCoverageReporter
   -> ScriptBuilder.run() allocates a per-script kcov outputDir under
      <cacheDir>/kcov/ and the generated .bats wraps "$SCRIPT" with kcov
   -> BatsCoverageReporter.onInit() clears <cacheDir>/kcov from prior runs
   -> BatsCoverageReporter.onCoverage() reads scripts.json, walks
      <cacheDir>/kcov/<id>/<scriptName>/cobertura.xml, and merges into the
      v8 Istanbul CoverageMap via addFileCoverage()
   -> Three-path strategy per script (real kcov, statementPassThrough
      synthetic, or zero-coverage line analysis)
```

## Component Map

### Plugin Layer (`plugin.ts`)

`BatsPlugin()` is the Vite/Vitest plugin and sole integration point. It has
four responsibilities:

**Setup-File Auto-Injection (`config` hook):**

- The `config()` hook appends `"vitest-bats/setup"` to `test.setupFiles`
  (handling undefined, single-string, and array forms).
- This wires `expect.extend(batsMatchers)` and a `beforeEach(resetAllBuilders)`
  hook into every test file without users touching their config.
- The plugin no longer injects a custom test runner — execution happens
  inline inside `ScriptBuilder.run/exec`.

**Vite Transform (resolveId + load hooks):**

- `resolveId(source, importer)` intercepts imports ending in `.sh`. Resolves
  the path relative to the importer; if the file exists, returns a virtual
  module ID prefixed with `\0bats:`.
- `load(id)` generates JavaScript that constructs a fresh `ScriptBuilder`
  bound to the script's absolute path and basename:
  `new ScriptBuilder("/abs/path/hello.sh", "hello.sh")`.
- Uses `enforce: "pre"` so `resolveId` runs before Vite's built-in resolver.

**Script Manifest:**

- Maintains a `registeredScripts` set of all `.sh` paths seen during
  transform. Writes `scripts.json` to `<cacheDir>/vitest-bats/` each time
  a new script is registered. Consumed by `BatsCoverageReporter`.

**Vitest Configuration (`configureVitest` hook):**

- Resolves the cache directory from Vitest's `cacheDir` (falling back to
  Vite's `cacheDir`, finally `node_modules/.vitest`), scoped under
  `vitest-bats/`.
- Checks system dependencies (bats, bats-support, jq, optionally kcov) and
  validates BATS version >= 1.5 (required for `run --separate-stderr`). Sets
  environment variables for the runtime. `bats-assert` and `bats-mock` are
  NOT probed — assertions happen JS-side and the recorder shims are
  self-contained.
- The `deps` option controls behavior on missing dependencies: `"error"`
  (default) throws; `"warn"` logs and continues so pure-TS unit tests still
  run while integration tests fail individually.
- Resolves the coverage mode (`"auto"` | `true` | `false`). Always exports
  `__VITEST_BATS_CACHE_DIR__`; sets `__VITEST_BATS_KCOV__=1` when shell
  coverage is enabled and kcov is reliable.
- Always injects `BatsCoverageReporter` when Vitest coverage is enabled.
  Passes thresholds from the Vitest config and `statementPassThrough = true`
  when kcov is unreliable (so scripts are neutral in threshold checks).

### Runtime Layer (`runtime.ts`)

`ScriptBuilder` is a config-then-execute builder returned by `.sh` imports.
It accumulates state (`env`, `flags`, `mock`) and consumes it on `run()` /
`exec()` to produce a `BatsResult`.

**Module-local Builder Registry:**

- A `Set<ScriptBuilder>` declared at module scope (no globalThis indirection).
- Each new `ScriptBuilder` registers itself in its constructor.
- `resetAllBuilders()` iterates the set and calls `.reset()` on each builder.
  Called from `setup.ts`'s `beforeEach` hook to ensure each test starts with
  a clean slate.

**ScriptBuilder Methods:**

- `env(vars)` -- Accumulate env vars for the next run (chainable, returns
  `this`).
- `flags(value)` -- Set flags appended to the script invocation (chainable).
- `mock(cmd, responses)` -- Register a recorder shim for `cmd` with optional
  pattern-to-response mapping (chainable). Multiple stubs accumulate.
- `run(...args)` -- Generate a .bats file that invokes `"$SCRIPT" arg0 arg1
  ...` (with current env/flags/stubs), execute it, and return a `BatsResult`.
  Resets internal state via the `finally` block whether execution succeeds
  or throws.
- `exec(shellExpr)` -- Same lifecycle as `run`, but the .bats test runs
  `bash -c '<expr>'` for shell pipelines or arbitrary shell expressions.
  `$SCRIPT` is exported in `setup()` so it's available inside the expression.
- `reset()` -- Clear `env`, `flags`, and `stubs` (called automatically after
  every run/exec and from `resetAllBuilders()`).

**BatsResult:**

- Plain class (not a Promise/thenable) holding `status`, `output`, `stderr`,
  `lines` (split `output` on `\n`, empty array for empty string),
  `stderr_lines`, and `calls: Record<string, MockCall[]>`.
- `json<T>()` lazily parses `output` as JSON, caching the result; throws
  with a clear message on parse failure.
- Because `BatsResult` is not thenable, `await batsResult` resolves to
  the same value (per the JS Promise spec). Tests can write either
  `const r = hello.run(...)` or `const r = await hello.run(...)`; both
  work and return the same instance.

**Per-Run Allocations:**

- `loadDeps()` reads `BATS_PATH`, `BATS_SUPPORT_PATH`, `BATS_MOCK_PATH` from
  env (set by the plugin's dependency check).
- `loadKcov()` returns a fresh `KcovConfig` per run when
  `__VITEST_BATS_KCOV__=1`, with a unique `outputDir` under
  `<cacheDir>/kcov/<scriptName>-<timestamp-rand>/`.
- `makeRecorderDir()` allocates a unique recorder directory under
  `os.tmpdir()/vitest-bats-<pid>/recorder/<id>/`.

### Setup Module (`setup.ts`)

Auto-loaded module added to `test.setupFiles` by the plugin. Three lines:

```ts
expect.extend(batsMatchers);

beforeEach(() => {
  resetAllBuilders();
});
```

Users never import this directly — the plugin appends
`"vitest-bats/setup"` to setupFiles in its `config` hook.

### Matchers (`matchers.ts`)

Twenty-three Vitest matchers exported as `batsMatchers` and registered via
`expect.extend()` in `setup.ts`. Grouped by category:

| Group | Matchers |
| --- | --- |
| Status | `toSucceed`, `toFail(code?)` |
| Output (stdout) | `toHaveOutput`, `toContainOutput`, `toMatchOutput`, `toHaveEmptyOutput` |
| Stderr | `toHaveStderr`, `toContainStderr`, `toMatchStderr` |
| Lines | `toHaveLine`, `toHaveLineContaining`, `toHaveLineMatching`, `toHaveLineCount` |
| JSON | `toOutputJson`, `toEqualJson`, `toMatchJson`, `toHaveJsonValue`, `toHaveJsonPath` |
| Schema | `toMatchSchema`, `toMatchJsonSchema` |
| Invocation | `toHaveInvoked`, `toHaveInvokedTimes`, `toHaveInvokedExactly` |

Each matcher returns `{ pass, message }` per the `expect.extend` contract,
where `message` is a thunk that produces a human-readable diff-style string
(including a `status:` and truncated `stderr:` context block on failure).

`ensureBatsResult()` checks for the `BATS_RESULT_BRAND` symbol (registered
via `Symbol.for("vitest-bats.BatsResult")`) on the received value, rather
than `instanceof BatsResult`. This is required because the rslib build
emits self-contained per-entry bundles (workaround for
savvy-web/rslib-builder#158), so the `BatsResult` class identity in
runtime.js differs from the one imported in setup.js. The brand is shared
across entries via the global symbol registry, so brand checks succeed
where `instanceof` would fail. Brand checks also survive minification
(unlike a `constructor.name` check).

The file also augments `vitest`'s `Assertion` and
`AsymmetricMatchersContaining` interfaces via `declare module "vitest"`.
Because Microsoft API Extractor strips `declare module` from rolled-up
.d.ts, the root workspace mirrors this in
`types/vitest-matchers.d.ts` for typechecking.

### Schema Validation (`schema.ts`)

Supports two schema flavors:

- **Standard Schema** -- detected by the `~standard` property; works with
  Zod, Valibot, Arktype, Effect Schema, and any other library implementing
  the spec. Async validators throw a clear migration message; users must
  parse `result.json()` and compare directly with a built-in matcher.
- **Raw JSON Schema** -- any plain object passed to `validate()` is compiled
  via Ajv (`strict: false`, `allErrors: true`) with `ajv-formats` enabled.
  Compiled validators are cached in a `WeakMap` keyed by the schema object.

`validate()` is the single entry point used by `toMatchSchema` (accepts
either kind) and `toMatchJsonSchema` (always raw JSON Schema). Returns
`{ ok: true } | { ok: false; issues: string[] }` where `issues` are
human-readable path-prefixed error messages.

### BATS Generator (`bats-generator.ts`)

`generateBatsFile()` is a pure function that produces a fully self-contained
`.bats` file string for a single test execution.

**Inputs (`GenerateInput`):** `scriptPath`, `args`, `env`, `flags`, `stubs`,
`recorderDir`, `deps`, `mode`, optional `kcov`.

**Generated Structure:**

```bats
#!/path/to/bats

setup() {
    load '/path/to/bats-support/load.bash'
    export SCRIPT="/abs/path/to/script.sh"
    export VBATS_RECORDER="/tmp/.../recorder/<id>"
    mkdir -p "$VBATS_RECORDER/bin"
    # If kcov enabled:
    export KCOV_OUT="/cacheDir/kcov/<scriptName>-<id>"
    mkdir -p "$KCOV_OUT"
    # Per-stub recorder shim binaries written here, then PATH prefixed:
    cat > "$VBATS_RECORDER/bin/<cmd>" <<__VBATS_EOF__
    #!/usr/bin/env bash
    jq -nc --arg cmd "<cmd>" --args '{cmd: $cmd, args: $ARGS.positional}' -- "$@" \
      >> "$VBATS_RECORDER/calls.jsonl"
    if [[ "$*" == "<glob>" ]]; then eval '<response>'; exit $?
    elif ...
    else echo "vitest-bats: no mock pattern matched for ..." >&2; exit 1
    fi
    __VBATS_EOF__
    chmod +x "$VBATS_RECORDER/bin/<cmd>"
    PATH="$VBATS_RECORDER/bin:$PATH"
}

@test "_run_" {
    NAME="Alice" run --separate-stderr "$SCRIPT" "Alice" "Bob"
    {
        echo "status:$status"
        echo "output_b64:$(printf '%s' "$output" | base64 | tr -d '\n')"
        echo "stderr_b64:$(printf '%s' "$stderr" | base64 | tr -d '\n')"
    } > "$VBATS_RECORDER/result.txt"
}
```

**Key Decisions:**

- `setup()` loads only `bats-support` (for the `--separate-stderr` form of
  `run`). It does **not** load `bats-assert` or `bats-mock` — assertions
  happen on the JS side and mocks are self-contained recorder shims.
- The recorder shim records every call (cmd + args) as a JSON line via
  `jq -nc --args` to `calls.jsonl`, then dispatches responses by matching
  `$*` against bash globs converted from user patterns by
  `patternToBashGlob()` (literal segments are double-quoted; `* ? [ ]`
  stay unquoted and active).
- Skipping `bats-mock` is deliberate: under kcov instrumentation, the exec
  chain into bats-mock's binstub fails (ptrace + `set -e` interaction).
  Embedding responses directly also means the mocked binary need not exist
  on the host system.
- `run --separate-stderr` requires BATS >= 1.5 (enforced by the plugin's
  dependency check).
- Output and stderr are base64-encoded and piped through `tr -d '\n'`. GNU
  coreutils `base64` wraps at 76 columns by default; without the strip,
  multi-line base64 reads back as just the first line and truncates the
  capture. `tr -d '\n'` is portable across BSD/GNU.
- `"shell"` mode generates `bash -c '<expr>'` (single-quoted with `'\''`
  escaping) so users can write pipelines like `"$SCRIPT" | cat`.
- When `kcov` is provided and mode is `"args"`, the script invocation is
  wrapped: `"<kcov>" --skip-solibs --include-pattern="<dir>"
  --exclude-line="^#!/,..." "$KCOV_OUT" "$SCRIPT" <args>`. Shell mode is
  not kcov-wrapped (the user controls what runs).

### BATS Executor (`bats-executor.ts`)

`executeBats()` writes the generated .bats file to a per-pid temp directory,
spawns `bats --tap <file>` synchronously via `child_process.spawnSync`
(60s default timeout), then calls `parseExecutionResult()` to read
`result.txt` and `calls.jsonl` from the recorder directory.

- The temp directory `os.tmpdir()/vitest-bats-<pid>/` is created lazily and
  registered for cleanup via `process.on("exit")` (best-effort `rmSync`).
- `parseExecutionResult()` parses `status`, `output_b64`, `stderr_b64` from
  `result.txt` (decoding base64), and accumulates `MockCall[]` from
  `calls.jsonl` (one JSON object per line: `{cmd, args}`).
- A non-zero BATS exit code is **not** treated as a tooling error — per-test
  status comes from `result.txt`. Only a missing `result.txt` throws (true
  tool-level failure).

### Coverage Layer (`coverage-reporter.ts`)

`BatsCoverageReporter` implements two hooks:

- `onInit()` — clears `<cacheDir>/kcov` at the start of each Vitest session
  so coverage merge only sees data from the current run.
- `onCoverage(coverage)` — three-path strategy per script in
  `scripts.json`:

1. **Real kcov data** — Walks `<cacheDir>/kcov/<id>/<scriptName>/
   cobertura.xml` two levels deep, parses each via `fast-xml-parser`,
   converts to Istanbul format. Multiple cobertura files per script are
   merged via `Math.max` per statement (covers multiple test executions
   touching the same script). Synthetic branch/function entries at
   threshold level are added (kcov tracks only statements/lines for bash).
2. **Statement pass-through** — When `statementPassThrough` is `true` (kcov
   unreliable, e.g., macOS) and thresholds are configured, synthesizes all
   four coverage dimensions at the exact threshold percentage using
   GCD-based fractions. Pads statement count to be divisible by the
   denominator. Prints a one-line warning per session listing affected
   scripts.
3. **Zero-coverage fallback** — When neither real data nor pass-through,
   the reporter analyzes the script source: identifies executable lines
   (skipping comments, structural keywords `then`/`else`/`fi`/`do`/`done`/
   `esac`/`;;`, and bare braces) and marks them all uncovered.

All entries are merged into the v8 CoverageMap via `addFileCoverage()`,
which bypasses Vitest's include/exclude filters entirely.

## Package Entry Points

| Entry Point | Source File | Purpose |
| --- | --- | --- |
| `vitest-bats` | `src/index.ts` | Main: BatsPlugin, ScriptBuilder, BatsResult, generateBatsFile, executeBats, batsMatchers, schema validation, BatsCoverageReporter, types |
| `vitest-bats/runtime` | `src/runtime.ts` | Runtime: `ScriptBuilder`, `BatsResult`, `resetAllBuilders`. Imported by virtual `.sh` modules. |
| `vitest-bats/setup` | `src/setup.ts` | Auto-injected setup file: registers matchers and the `beforeEach` reset hook. |

The previous `vitest-bats/runner` subpath has been **removed** — execution
moved into `ScriptBuilder.run/exec`.

## Source File Map

```text
package/src/
  index.ts                          # Public API re-exports + type aug side-effect
  plugin.ts                         # BatsPlugin() — Vite transform + configureVitest
  runtime.ts                        # ScriptBuilder, BatsResult, resetAllBuilders
  setup.ts                          # expect.extend(batsMatchers) + beforeEach(reset)
  matchers.ts                       # 23 matchers + Vitest type augmentation
  schema.ts                         # Standard Schema + JSON Schema (Ajv) validation
  bats-generator.ts                 # generateBatsFile() pure function
  bats-executor.ts                  # spawnSync bats + parseExecutionResult
  coverage-reporter.ts              # BatsCoverageReporter (kcov merge + synthetic)
  shims.d.ts                        # `declare module "*.sh"` for TS consumers
  vitest-kcov-types.ts              # Type augmentation for vitest/node options
```

## Workspace Layout

```text
vitest-bats/                # Root workspace (consumer / integration tests)
  package/                  # The npm package (`vitest-bats`)
  scripts/                  # Example shell scripts for testing
  __test__/                 # Integration tests consuming vitest-bats
    *.test.ts               # Top-level integration tests (hello, sysinfo)
    integration/
      schema.int.test.ts    # JSON Schema + Standard Schema validation
      mocks.int.test.ts     # Mock recording (uses-git.sh, uses-widget.sh)
      exec.int.test.ts      # exec() shell-pipeline escape hatch
  types/                    # Root-workspace type augmentations
    vitest-matchers.d.ts    # Mirror of matchers.ts type aug (API Extractor workaround)
  .devcontainer/            # Devcontainer with bats, kcov, and BATS libs
  Dockerfile.test           # Docker environment for kcov on macOS
  docker-compose.test.yml   # Docker Compose for test runner
```

The root workspace depends on `vitest-bats: workspace:*`.

## Design Decisions

### 1. Vite Transform over import.meta.resolve()

`.sh` imports are resolved via Vite hooks (`resolveId` + `load`) and return
a `ScriptBuilder` directly. No wrapper or registration step is needed.

### 2. Real-Execution Builder, Not a Recording API

`ScriptBuilder.run()` synchronously generates a .bats file, executes it via
`bats --tap`, and returns a `BatsResult` for the test to assert on. The
previous "record commands and execute later via a custom test runner"
architecture has been replaced. State (`env`, `flags`, `mock`) is
configured between runs and reset after each `run/exec`. This eliminates
the runner, the cross-context globalThis registry, and the
`fromTransform` flag.

### 3. Auto-Injected Setup File for Matchers + Reset

The plugin's `config` hook appends `"vitest-bats/setup"` to
`test.setupFiles`. The setup module registers the matchers and a
`beforeEach(resetAllBuilders)` hook. Users never set this up manually.

### 4. Self-Contained Recorder Shims (No bats-mock Runtime Dependency)

The generated .bats file writes its own shim binaries that record calls to
`calls.jsonl` and emit responses via bash `[[ ]]` glob matching against
patterns converted by `patternToBashGlob()`. This avoids a hard runtime
dependency on bats-mock's `binstub`, which is unreliable under kcov
instrumentation (ptrace + `set -e`). The mocked binary need not exist on
the host system.

### 5. base64 + `tr -d '\n'` for Result Capture

`run --separate-stderr` populates `$output` and `$stderr` with arbitrary
bytes. We base64 them through `tr -d '\n'` to strip GNU coreutils' default
76-column wrap, which would otherwise truncate the captured bytes when
read back as `output_b64:` line. Portable across BSD/GNU.

### 6. BATS >= 1.5 Required

`run --separate-stderr` was introduced in BATS 1.5. The plugin parses the
`bats --version` output and refuses to start (with a clear warning) when
the version is older.

### 7. Symbol-Branded `ensureBatsResult()` for Cross-Entry Identity

The rslib build emits self-contained per-entry bundles (workaround for
savvy-web/rslib-builder#158, see `package/rslib.config.ts`). `BatsResult`
class identity differs across the runtime entry and the setup entry, so
`instanceof` would fail. Each `BatsResult` instance carries a
`BATS_RESULT_BRAND` symbol (registered via `Symbol.for("vitest-bats.BatsResult")`,
shared across modules through Node's global symbol registry). Matchers
check for that brand. Brand-based identity also survives minification —
unlike `constructor.name` checks.

### 8. kcov Wraps Script Invocation, Not BATS

Coverage wraps the individual `"$SCRIPT"` invocation inside the generated
`.bats` file's `@test` body, not the `bats` process itself. This keeps
kcov focused on the script under test rather than the BATS infrastructure.

### 9. Coverage Mode: "auto" (Default), true, false

- `"auto"` -- Detects kcov availability and macOS SIP. Enables shell
  coverage only when kcov is present and reliable (not macOS).
- `true` -- Requires kcov and a non-macOS environment. Throws on macOS or
  missing kcov.
- `false` -- Always excludes shell scripts from coverage.

### 10. Reporter Always Injected When Coverage Enabled

`BatsCoverageReporter` is always injected when Vitest coverage is enabled,
regardless of whether kcov is available. This ensures shell scripts always
appear in the coverage table. The reporter uses `addFileCoverage()` which
bypasses Vitest's include/exclude filters.

### 11. Synthetic Coverage with GCD-Based Fractions

When kcov is unreliable, the reporter synthesizes coverage data at the
exact threshold percentage so scripts are neutral in threshold checks.
`thresholdFraction()` uses GCD reduction to find the smallest
total/covered pair (e.g., 50% -> 1/2, 75% -> 3/4). Statement counts are
padded to be divisible by the denominator for exact percentages.
Synthetic branch and function entries are always applied to shell scripts
since kcov cannot measure those for bash.

### 12. enforce: "pre" on resolveId

The plugin uses `enforce: "pre"` so its `resolveId` runs before Vite's
built-in resolver, which would otherwise fail to resolve `.sh` imports.

### 13. scripts.json Manifest at Transform Time

The manifest is written to `<cacheDir>/vitest-bats/` during `load()` (i.e.,
transform time), not during test execution. This guarantees the coverage
reporter has the full script set even if some tests are skipped or fail.

### 14. `deps: "warn"` Degraded Mode

When `deps: "warn"` is configured, missing required dependencies log a
warning instead of throwing. Pure-TS unit tests still run; integration
tests using `.sh` imports fail individually at runtime when they spawn
`bats`.

## Docker Strategy

kcov requires `ptrace`, which macOS SIP blocks. Two options:

- **Devcontainer** (preferred): `.devcontainer/` provides bats, kcov, and
  all BATS libraries pre-installed. Works in VS Code and Codespaces.
- **Docker**: `Dockerfile.test` + `docker-compose.test.yml` add
  `SYS_PTRACE` capability. `HTE_PATH_REWRITE` rewrites container paths to
  host paths for clickable hyperlinks.

## System Dependencies

| Dependency | Required | Detected By | Notes |
| --- | --- | --- | --- |
| bats | Always (>= 1.5) | `command -v bats` + `bats --version` | `run --separate-stderr` requires 1.5+ |
| bats-support | Always | Library path search | Loaded by generated `setup()` |
| jq | Always | `command -v jq` | Used by recorder shims to write `calls.jsonl` |
| kcov | Coverage only | `command -v kcov` | Blocked by SIP on macOS; use Docker or devcontainer |

Library path search checks: `$XDG_CONFIG_HOME`, `~/.config`,
`$XDG_DATA_HOME`, `~/.local/share`, `/opt/homebrew/lib`, `/usr/local/lib`,
`/usr/lib`.

`bats-assert` and `bats-mock` are NOT probed. Assertions happen JS-side
(via `expect.extend` matchers) and the recorder shims are self-contained,
so neither library is needed at runtime.

## Build-Time Class Identity

`package/rslib.config.ts` wraps `NodeLibraryBuilder.create` and overrides
`output.library.type` from rslib's default `"modern-module"` to plain
`"module"`. This is a workaround for `savvy-web/rslib-builder#158` —
modern-module emits chunks that share `__webpack_require__` declarations,
producing invalid ESM output for multi-entry packages.

The trade-off: each entry (`index`, `runtime`, `setup`) is a self-contained
bundle, so shared classes like `BatsResult` are duplicated across entries.
`matchers.ts` accommodates this by branding `BatsResult` instances with
`BATS_RESULT_BRAND` (a `Symbol.for(...)`-registered symbol shared via
Node's global symbol registry) and checking the brand instead of using
`instanceof`. Brand identity is also minification-safe — unlike a
`constructor.name` check. The `types/vitest-matchers.d.ts` file in the
root workspace similarly mirrors the matcher type augmentation because
API Extractor strips `declare module` from rolled-up .d.ts.
