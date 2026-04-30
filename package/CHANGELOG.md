# vitest-bats

## 1.0.0

### Breaking Changes

* [`6d83c16`](https://github.com/spencerbeggs/vitest-bats/commit/6d83c163d6e2369a22502ec49c055b5281bc372d) The recording-style `ScriptBuilder.assert_*` API has been replaced with a real-execution API plus an idiomatic Vitest `expect.extend` matcher set. The custom `BatsRunner` is removed.

- [`5283088`](https://github.com/spencerbeggs/vitest-bats/commit/5283088673818239daa47eeb5e8cca052cd9fe6b) The `BatsHelper.describe()` + `import.meta.resolve()` test-writing API has been removed and replaced with a Vite import transform. Shell scripts are now imported directly as ES modules, and tests are written using standard Vitest `describe`/`test` blocks.

### Features

* [`6d83c16`](https://github.com/spencerbeggs/vitest-bats/commit/6d83c163d6e2369a22502ec49c055b5281bc372d) ### Config-then-execute Builder

`ScriptBuilder` is now a builder that accumulates configuration and terminates on a single execution call.

* `env(vars)` / `flags(value)` / `mock(cmd, responses)` chain config (returns `this`)
* `run(...args)` — invoke the script with positional args; quoting is handled internally so spaces/special chars in args survive
* `exec(shellExpr)` — escape hatch for shell pipelines or compositions; the expression runs through `bash -c` with `$SCRIPT` exported

Both terminators return a `BatsResult`. State resets after each call so config doesn't leak between runs. A `beforeEach` hook (auto-installed by the setup module) also clears all builders between tests.

### Bug Fixes

* [`6d83c16`](https://github.com/spencerbeggs/vitest-bats/commit/6d83c163d6e2369a22502ec49c055b5281bc372d) Recorder shim heredoc body emitted without indentation so the generated shim's shebang sits at column 0
* Base64-encoded result emission piped through `tr -d '\n'` for portable single-line output (GNU coreutils `base64` wraps at 76 columns by default; without the strip, multi-line output got truncated)
* `SCRIPT` / `VBATS_RECORDER` / `KCOV_OUT` exported in setup so `bash -c` subshells and shim binaries inherit them

### Other

* [`6d83c16`](https://github.com/spencerbeggs/vitest-bats/commit/6d83c163d6e2369a22502ec49c055b5281bc372d) ### Coverage

Coverage continues to merge kcov data into Vitest's v8 Istanbul `CoverageMap`. The reporter now clears stale kcov outputs at session start (via a new `onInit` hook), so previous-run artifacts don't pollute the current report. Cache directory resolves from Vitest's config first (defaults to `node_modules/.vitest/vitest-bats/`).

For shell scripts:

* Statements / lines: real kcov data when kcov is reliable; threshold-padded synthetic when not (macOS without kcov, or `coverage: false`)
* Branches / functions: always synthetic at the configured threshold (kcov doesn't emit branch/function data for shell scripts)

- [`5283088`](https://github.com/spencerbeggs/vitest-bats/commit/5283088673818239daa47eeb5e8cca052cd9fe6b) ### Vite Transform Pipeline

`BatsPlugin` includes Vite `resolveId`/`load` transform hooks that resolve `.sh` imports to a `ScriptBuilder` instance, enabling native ES module syntax for shell script test files.

### Removed exports

* `BatsHelper` -- replaced by direct `.sh` module imports via Vite transform
* `BatsTestContext` -- replaced by `ScriptBuilder` (exposed through the imported script module)
* `KcovVerboseReporter` -- removed entirely
* `KcovCoverageReporter` -- removed entirely; use `BatsCoverageReporter`
* `vitest-bats/provider` -- subpath removed; use `vitest-bats/runner` and `vitest-bats/runtime`

- `vitest-bats/runner` — subpath removed; the plugin no longer injects a custom runner
- `ScriptBuilder.assert_success` / `assert_failure` / `assert_output` / `assert_line` / `assert_json_value` / `assert` / `exit` / `raw`
- `createBatsScript` / `findActive` / `resetAll` / `CommandRecord` / `ScriptBuilder.fromTransform` / globalThis registry

* `vitest-bats/runner` -- custom Vitest runner (auto-injected by plugin)
* `vitest-bats/runtime` -- `ScriptBuilder` and registry helpers for advanced use

### Added exports

* `vitest-bats/setup` — auto-loaded module that registers matchers via `expect.extend` and adds a `beforeEach` builder reset (the plugin auto-injects this into `test.setupFiles`; users don't reference it directly)
* `BatsResult` / `BatsResultData` / `MockCall` — result type returned by `run()` / `exec()`
* `batsMatchers` / `MatcherResult` — the matcher set, exported for users who want manual registration
* `executeBats` / `parseExecutionResult` / `ExecuteOptions` — executor primitives
* `validate` / `isStandardSchema` / `ValidationResult` — schema validation utilities
* `resetAllBuilders` — resets all registered builders' accumulated state

### Peer / system dependencies

* BATS >= 1.5 now required (was unspecified) — the executor depends on `bats run --separate-stderr`
* New runtime deps: `ajv ^8.20.0`, `ajv-formats ^3.0.1`, `@standard-schema/spec ^1.1.0`
* `bats-mock` is no longer used at runtime (the recorder shims are self-contained)

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

* [`5283088`](https://github.com/spencerbeggs/vitest-bats/commit/5283088673818239daa47eeb5e8cca052cd9fe6b) ### Vite Transform Pipeline

`BatsPlugin` includes Vite `resolveId`/`load` transform hooks that resolve `.sh` imports to a `ScriptBuilder` instance, enabling native ES module syntax for shell script test files.

### Migration

```typescript
// Before
import hello from "../scripts/hello.sh";

test("outputs greeting", () => {
  hello.run('"$SCRIPT"');
  hello.assert_success();
  hello.assert_output({ partial: "Hello World" });
});

// After
import hello from "../scripts/hello.sh";

test("outputs greeting", () => {
  const result = hello.run();
  expect(result).toSucceed();
  expect(result).toContainOutput("Hello World");
});
```

The `BatsPlugin()` line in `vitest.config.ts` is unchanged.

### BatsResult

The value returned by `run()` / `exec()`. Exposes the captured execution state:

* `status: number` — exit status
* `output: string` — stdout (captured via `bats run --separate-stderr`)
* `stderr: string` — stderr captured separately
* `lines: string[]` / `stderr_lines: string[]` — split on newlines
* `calls: Record<string, MockCall[]>` — recorded mock invocations
* `json<T = unknown>(): T` — lazy + cached JSON parse with optional generic typing

`BatsResult` is a plain class, not a thenable. `await result` is harmless but unnecessary.

### 23 expect.extend Matchers

Auto-registered via the setup file the plugin injects. All sync; all compose with `.not`.

* **Status** (2): `toSucceed()`, `toFail(code?)`
* **Output** (4): `toHaveOutput(text)`, `toContainOutput(text)`, `toMatchOutput(pattern)`, `toHaveEmptyOutput()`
* **Stderr** (3): `toHaveStderr(text)`, `toContainStderr(text)`, `toMatchStderr(pattern)`
* **Lines** (4): `toHaveLine(index, text)`, `toHaveLineContaining(text, index?)`, `toHaveLineMatching(pattern, index?)`, `toHaveLineCount(n)`
* **JSON** (5): `toOutputJson()`, `toEqualJson(expected)`, `toMatchJson(partial)`, `toHaveJsonValue(path, expected)` (lodash-style path), `toHaveJsonPath(path)`
* **Schema** (2): `toMatchSchema(standardSchema)`, `toMatchJsonSchema(jsonSchema)`
* **Invocation** (3): `toHaveInvoked(cmd, opts?)`, `toHaveInvokedTimes(cmd, n)`, `toHaveInvokedExactly(cmd, calls)`

### Schema Validation

First-class JSON validation against either:

* **Standard Schema** (Zod ≥3.24, Valibot ≥1.0, Arktype, Effect Schema ≥0.66): detected via the `~standard` property, validated synchronously. Async validators throw a clear migration message pointing at `expect.resolves`.
* **Raw JSON Schema**: validated via `ajv` (configured `strict: false, allErrors: true`) plus `ajv-formats`. Compiled validators are cached in a `WeakMap` keyed on the schema object so repeated assertions don't recompile.

```typescript
import { z } from "zod";

const HookResponse = z.object({
  decision: z.enum(["approve", "block"]),
  reason: z.string(),
});

test("hook returns valid decision", () => {
  const result = hook.run("--decision", "approve");
  expect(result).toMatchSchema(HookResponse);
  const data = result.json<z.infer<typeof HookResponse>>();
});
```

### Self-contained Mock Subsystem

`mock(cmd, responses)` no longer depends on `bats-mock`. The plugin generates a recorder shim binary that:

* Records every invocation to `calls.jsonl` (JSON-Lines format via `jq`, preserving args with spaces/quotes/special chars losslessly)
* Pattern-matches against the configured responses using `[[ "$*" == ... ]]` glob matching
* Evaluates the matched response via `bash -c`

Mocked binaries don't need to exist on the system. Pattern syntax uses bash globs (`*`, `?`, `[...]`).

```typescript
const result = await gitScript
  .mock("git", { "remote get-url *": "echo https://example.com" })
  .run();
expect(result).toHaveInvoked("git", { args: ["remote", "get-url", "origin"] });
expect(result).toContainOutput("https://example.com");
```

Note: under coverage instrumentation (kcov), additional internal calls may appear in `result.calls` (e.g. kcov's own `git rev-parse --is-inside-work-tree`). For strict-count assertions, mock a binary that no coverage tool internally invokes.

### exec() Escape Hatch

For shell pipelines, redirections, or compositions where the variadic-args form of `run()` is insufficient:

```typescript
const result = hello.exec('"$SCRIPT" --json | jq .greeting');
```

`$SCRIPT` is exported in the bats setup so the subshell sees it.

### Plugin Auto-injection

`BatsPlugin()` now appends `vitest-bats/setup` to `test.setupFiles` automatically (via the Vite `config` hook). Existing setup files are preserved.

### Automatic Runner Injection

The plugin auto-injects the custom `BatsRunner` via its Vite `config` hook. Users never set `runner` manually. The runner uses a `fromTransform` flag on `ScriptBuilder` to only execute BATS for scripts imported via the transform, leaving unit tests that create ScriptBuilders directly unaffected.

### Coverage Pipeline

* `BatsCoverageReporter` is always injected when Vitest coverage is enabled
* Real kcov data: parses cobertura.xml, merges hit counts across test runs
* Synthetic coverage: when kcov is unreliable (macOS SIP), synthesizes coverage at exact threshold level using GCD-based fractions so shell scripts are neutral in threshold checks
* Synthetic branch/function entries always applied (kcov only tracks statements/lines for bash)

### ScriptBuilder API

New fluent API supports `run()`, `raw()`, `env()`, `mock()`, `flags()`, `assert_success()`, `assert_failure()`, `assert_output()`, `assert_line()`, `assert_json_value()`, `assert()`, and `exit()`.

### Coverage Mode Option

New `coverage` option on `BatsPlugin`: accepts `"auto"` (default, detects macOS SIP and skips kcov when blocked), `true` (always run kcov), or `false` (disable kcov entirely).

### BATS Generator

New pure function `generateBatsFile` compiles a `ScriptBuilder` command list into a `.bats` file, with optional kcov wrapping for coverage collection.
