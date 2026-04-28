# Testing Helpers API Reference

This document covers the runtime API exposed by `vitest-bats`: the
`ScriptBuilder` returned from `.sh` imports, the `BatsResult` it produces,
the 23 `expect.extend` matchers, and the schema-validation layer.

## Table of Contents

- [Overview](#overview)
- [ScriptBuilder](#scriptbuilder)
- [BatsResult](#batsresult)
- [Matchers](#matchers)
- [Schema Validation](#schema-validation)
- [Mocking](#mocking)
- [Advanced Usage](#advanced-usage)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

`vitest-bats` registers a Vite transform that turns every `.sh` import into a
fresh `ScriptBuilder` instance. Tests configure the builder with `env()`,
`flags()`, and `mock()`, then call `run(...args)` or `exec(shellExpr)` to
execute the script via BATS. Both terminators return a `BatsResult` that the
auto-registered matchers operate on.

```typescript
import { describe, expect, test } from "vitest";
import hello from "../scripts/hello.sh";

describe("hello.sh", () => {
  test("greets by name", () => {
    const result = hello.run("--name", "Alice");
    expect(result).toSucceed();
    expect(result).toContainOutput("Hello Alice");
  });
});
```

There is no custom test runner, no `BatsHelper.describe`, and no
`script.assert_*` methods. Use Vitest's standard `describe` / `test` and
the matchers below.

## ScriptBuilder

`ScriptBuilder` is the value returned by every `.sh` import. It is a
config-then-execute builder: configuration methods accumulate state and
return `this`; termination methods consume the state and return a
`BatsResult`. Builder state is reset after every run (via a `finally`
block) and again before each test (via the auto-injected `beforeEach`).

### Configuration

#### `env(vars: Record<string, string>): this`

Set environment variables for the next run. Multiple calls accumulate.

```typescript
const result = hello.env({ NAME: "Alice", DEBUG: "1" }).run();
```

Generates: `NAME="Alice" DEBUG="1" run --separate-stderr "$SCRIPT"`

#### `flags(value: string): this`

Set a fixed flag string appended to the script invocation. Replaces any
prior `flags()` (does not accumulate).

```typescript
const result = hello.flags("--verbose").run("--name", "Alice");
```

Generates: `run --separate-stderr "$SCRIPT" "--name" "Alice" --verbose`

#### `mock(cmd: string, responses?: Record<string, string>): this`

Register a recorder shim for `cmd`. Multiple `mock()` calls accumulate
shims for different commands. See [Mocking](#mocking).

### Termination

#### `run(...args: string[]): BatsResult`

Invoke the script as `"$SCRIPT" arg0 arg1 ...` (with current `env`,
`flags`, and `mock` state). When coverage is enabled, the invocation is
kcov-wrapped. State is reset in a `finally` block whether execution
succeeds or throws.

```typescript
const result = hello.run();                       // "$SCRIPT"
const result = hello.run("--name", "Alice");     // "$SCRIPT" "--name" "Alice"
```

#### `exec(shellExpr: string): BatsResult`

Run `bash -c '<expr>'`. The same lifecycle as `run`, but the user controls
what is executed. `$SCRIPT` is exported in `setup()` so it is available
inside the expression. `exec()` is **not** kcov-wrapped -- coverage stops
at the explicit shell boundary.

```typescript
const result = hello.exec('"$SCRIPT" --name Pipeline');
const result = hello.exec('"$SCRIPT" | tr a-z A-Z');
const result = hello.exec('echo "input" | "$SCRIPT"');
```

Use `exec()` for pipelines, redirection, conditional logic, or anything
that doesn't fit the simple `args` shape.

## BatsResult

`BatsResult` is a plain class returned by `run()` and `exec()`. It is
**not** a Promise -- `await result` is harmless but resolves to the same
instance per the JS Promise spec.

```typescript
class BatsResult {
  readonly status: number;
  readonly output: string;
  readonly stderr: string;
  readonly lines: string[];          // output split on "\n"
  readonly stderr_lines: string[];   // stderr split on "\n"
  readonly calls: Record<string, MockCall[]>;
  json<T = unknown>(): T;            // Lazy parse, cached
}
```

Empty `output` produces `lines === []` (rather than `[""]`). Same for
stderr. Stdout and stderr are captured separately via BATS 1.5+
`run --separate-stderr`.

### `result.json<T>()`

Lazily parses `output` as JSON and caches the parsed value via a `WeakMap`.
Throws with a descriptive message if the output is not valid JSON.

```typescript
const data = result.json<{ greeting: string }>();
expect(data.greeting).toBe("Hello World");
```

### `result.calls`

Per-mock array of `MockCall` entries:

```typescript
interface MockCall {
  args: string[];
}

result.calls; // { git: [{ args: ["remote", "get-url", "origin"] }] }
```

Empty when no `mock()` was registered for a given command.

## Matchers

23 Vitest matchers are registered via `expect.extend()` by the auto-injected
setup file. Every matcher operates on a `BatsResult` (duck-typed for
cross-build-entry compatibility, not `instanceof`).

### Status

| Matcher | Asserts |
| --- | --- |
| `toSucceed()` | `result.status === 0` |
| `toFail(code?)` | `result.status !== 0`, or `=== code` if given |

```typescript
expect(result).toSucceed();
expect(result).toFail();
expect(result).toFail(2);
```

### Output (stdout)

| Matcher | Asserts |
| --- | --- |
| `toHaveOutput(text)` | `output === text` |
| `toContainOutput(text)` | `output.includes(text)` |
| `toMatchOutput(pattern)` | RegExp test |
| `toHaveEmptyOutput()` | `output === ""` |

```typescript
expect(result).toHaveOutput("Hello World\n");
expect(result).toContainOutput("Hello");
expect(result).toMatchOutput(/^Hello/);
expect(result).toHaveEmptyOutput();
```

### Stderr

| Matcher | Asserts |
| --- | --- |
| `toHaveStderr(text)` | `stderr === text` |
| `toContainStderr(text)` | `stderr.includes(text)` |
| `toMatchStderr(pattern)` | RegExp test |

```typescript
expect(result).toContainStderr("Unknown option");
expect(result).toMatchStderr(/Error: .*/);
```

### Lines

| Matcher | Asserts |
| --- | --- |
| `toHaveLine(index, text)` | `lines[index] === text` |
| `toHaveLineContaining(text, index?)` | line at `index` contains `text`, or any line if omitted |
| `toHaveLineMatching(pattern, index?)` | same shape, RegExp |
| `toHaveLineCount(n)` | `lines.length === n` |

```typescript
expect(result).toHaveLine(0, "Hello World");
expect(result).toHaveLineContaining("World");           // any line
expect(result).toHaveLineContaining("World", 0);        // line 0 only
expect(result).toHaveLineMatching(/^\[DEBUG/);
expect(result).toHaveLineCount(3);
```

### JSON

| Matcher | Asserts |
| --- | --- |
| `toOutputJson()` | `result.json()` doesn't throw |
| `toEqualJson(expected)` | parsed JSON deep-equals `expected` |
| `toMatchJson(partial)` | `partial` is a deep subset of parsed JSON |
| `toHaveJsonValue(path, expected)` | path exists and deep-equals `expected` |
| `toHaveJsonPath(path)` | path exists |

Path syntax: dots for keys, brackets for array indices.

```typescript
expect(result).toOutputJson();
expect(result).toEqualJson({ greeting: "Hello World" });
expect(result).toMatchJson({ greeting: "Hello World" });   // ignores extra keys
expect(result).toHaveJsonValue("greeting", "Hello World");
expect(result).toHaveJsonValue("users[0].name", "Alice");
expect(result).toHaveJsonPath("settings.theme");
```

`toMatchJson` performs a structural subset check -- the actual JSON may
contain additional keys or array elements not present in `partial`.
`toEqualJson` requires exact deep equality.

### Schema

| Matcher | Asserts |
| --- | --- |
| `toMatchSchema(schema)` | Standard Schema **or** raw JSON Schema validates parsed JSON |
| `toMatchJsonSchema(schema)` | raw JSON Schema validates parsed JSON |

`toMatchSchema` auto-detects Standard Schema (Zod, Valibot, Arktype, Effect
Schema) by the `~standard` property on the value. Plain objects are treated
as raw JSON Schema and compiled via Ajv. See
[Schema Validation](#schema-validation).

### Invocation (mock calls)

| Matcher | Asserts |
| --- | --- |
| `toHaveInvoked(cmd, opts?)` | `cmd` was invoked at least once; if `opts.args` given, at least one call matches |
| `toHaveInvokedTimes(cmd, n)` | `result.calls[cmd].length === n` |
| `toHaveInvokedExactly(cmd, calls)` | `result.calls[cmd]` deep-equals the given list (order-sensitive) |

```typescript
expect(result).toHaveInvoked("git");
expect(result).toHaveInvoked("git", { args: ["remote", "get-url", "origin"] });
expect(result).toHaveInvokedTimes("widget-cli", 3);
expect(result).toHaveInvokedExactly("widget-cli", [
  { args: ["init"] },
  { args: ["build", "--target=foo"] },
  { args: ["ship", "release"] },
]);
```

> Strict-count matchers can be flaky when kcov is enabled and the
> instrumented script invokes binaries kcov uses internally
> (e.g., `git rev-parse` during instrumentation). For reliable strict-count
> assertions, mock binaries kcov never touches.

## Schema Validation

`vitest-bats` accepts both Standard Schema validators and raw JSON Schema.

### Standard Schema (Zod, Valibot, Arktype, Effect Schema)

Pass any value implementing the
[Standard Schema](https://github.com/standard-schema/standard-schema)
specification:

```typescript
import { z } from "zod";

const HookSchema = z.object({
  decision: z.enum(["approve", "block"]),
  reason: z.string(),
});

test("hook.sh emits a valid response", () => {
  const result = hook.run();
  expect(result).toSucceed();
  expect(result).toMatchSchema(HookSchema);
});
```

Async validators throw with a clear migration message -- `toMatchSchema`
is synchronous. If you need async validation, parse `result.json()` and
assert directly:

```typescript
const data = result.json();
const parsed = await asyncSchema.parseAsync(data);
expect(parsed).toMatchObject({ ... });
```

### Raw JSON Schema

Plain JSON Schema objects are compiled via
[Ajv](https://ajv.js.org/) (`strict: false`, `allErrors: true`) with
[`ajv-formats`](https://github.com/ajv-validator/ajv-formats) enabled.
Compiled validators are cached in a `WeakMap`.

```typescript
const HookJsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["approve", "block"] },
    reason: { type: "string" },
  },
  required: ["decision", "reason"],
} as const;

test("hook.sh matches JSON Schema", () => {
  const result = hook.run();
  expect(result).toSucceed();
  expect(result).toMatchJsonSchema(HookJsonSchema);
});
```

`toMatchSchema` accepts both flavors; `toMatchJsonSchema` always treats
the schema as raw JSON Schema.

## Mocking

`mock(cmd, responses?)` registers a shim binary that intercepts calls to
`cmd` while the script under test runs. The shim records every invocation
to a `calls.jsonl` file (read back into `result.calls`) and dispatches
responses by matching argv against bash globs derived from the user's
patterns.

### Basic Usage

```typescript
import gitScript from "../../scripts/uses-git.sh";

test("records git invocation", () => {
  const result = gitScript
    .mock("git", { "remote get-url *": "echo https://example.com" })
    .run();

  expect(result).toSucceed();
  expect(result).toContainOutput("https://example.com");
  expect(result).toHaveInvoked("git", { args: ["remote", "get-url", "origin"] });
});
```

### Pattern Syntax

Patterns are matched against the full `$*` (space-joined argv) of the
shim invocation. They are converted to bash globs by the BATS generator:

- Literal segments (no glob characters) are double-quoted in the generated
  bash, so they match exactly.
- `*`, `?`, `[`, `]` stay unquoted and active.

| Pattern | Matches |
| --- | --- |
| `"--version"` | `--version` |
| `"remote get-url *"` | `remote get-url <anything>` |
| `"build --target=*"` | `build --target=foo`, `build --target=bar`, ... |
| `"ship *"` | `ship release with spaces` (entire trailing argv) |

Responses are evaluated by bash `eval`, so they can include any expression:

```typescript
script.mock("clock", { "now": "echo 1700000000" });
script.mock("env-tool", { "show": 'echo "PATH=$PATH"' });
```

### Multiple Patterns

```typescript
const result = widget
  .mock("widget-cli", {
    init: "echo initialized",
    "build --target=*": "echo built",
    "ship *": "echo shipped",
  })
  .run();

expect(result).toHaveInvokedExactly("widget-cli", [
  { args: ["init"] },
  { args: ["build", "--target=foo"] },
  { args: ["ship", "release with spaces"] },
]);
```

### Multiple Commands

Each `mock()` call registers a separate shim. Calls accumulate:

```typescript
const result = script
  .mock("git", { "rev-parse --show-toplevel": "echo /repo" })
  .mock("docker", { "version": "echo 'Docker version 24.0.0'" })
  .run();
```

### Recording Without Responding

Pass an empty `responses` object to record calls without producing output.
The shim still exits 0:

```typescript
const result = script.mock("audit-log", {}).run();
expect(result).toHaveInvokedTimes("audit-log", 1);
```

### No Match Behavior

If no pattern matches at runtime, the shim emits an error to stderr and
exits 1:

```text
vitest-bats: no mock pattern matched for git: status --short
```

This makes missed cases visible. Add the missing pattern, or use a
catch-all `"*"`:

```typescript
script.mock("git", { "*": "echo ''" });   // match everything, no output
```

### Why Not bats-mock?

`vitest-bats` does not use `bats-mock` at runtime. Recorder shims are
embedded directly into the generated `.bats` file. This:

- Avoids a hard runtime dependency on `bats-mock`'s `binstub` (unreliable
  under kcov instrumentation due to ptrace + `set -e` interaction).
- Means the mocked binary need not exist on the host system.
- Captures structured `MockCall` entries directly into the result.

`bats-mock` is still detected at startup for compatibility warnings, but
not loaded at runtime.

## Advanced Usage

### Combining Mocks with Schema Validation

```typescript
test("emits valid status JSON when git is mocked", () => {
  const result = statusScript
    .mock("git", { "rev-parse --abbrev-ref HEAD": "echo main" })
    .run("--json");

  expect(result).toSucceed();
  expect(result).toMatchJsonSchema({
    type: "object",
    properties: {
      branch: { type: "string" },
      clean: { type: "boolean" },
    },
    required: ["branch"],
  });
});
```

### Typed JSON Access

`result.json<T>()` is generic. For strongly-typed access:

```typescript
interface HookResponse {
  decision: "approve" | "block";
  reason: string;
}

test("typed JSON access", () => {
  const result = hook.run("--decision", "block", "--reason", "policy");
  const data = result.json<HookResponse>();
  expect(data.decision).toBe("block");
  expect(data.reason).toBe("policy");
});
```

### Pipelines via `exec()`

`run()` invokes the script as `"$SCRIPT" args...`. For anything that needs
shell evaluation -- pipelines, redirects, conditionals -- use `exec()`:

```typescript
test("pipes stdin through the script", () => {
  const result = hello.exec('"$SCRIPT" | tr a-z A-Z');
  expect(result).toSucceed();
  expect(result).toContainOutput("HELLO WORLD");
});

test("respects shell-level redirection", () => {
  const result = hello.exec('"$SCRIPT" --json > /tmp/out.json && cat /tmp/out.json');
  expect(result).toSucceed();
  expect(result).toOutputJson();
});
```

`exec()` is not kcov-wrapped -- the user controls what runs.

## Best Practices

### 1. Use Specific Matchers Over Output Substring Checks

```typescript
// Good - structural and type-safe
expect(result).toHaveJsonValue("count", 5);
expect(result).toMatchSchema(StatusSchema);

// Avoid - false positives, fragile against formatting changes
expect(result).toContainOutput('"count": 5');
```

### 2. Mock Realistically

```typescript
// Good - realistic versions and paths
script.mock("npm", { "--version": "10.2.3" });

// Avoid - sentinel values that hide bugs
script.mock("npm", { "--version": "999.999.999" });
```

### 3. Prefer `run(...)` over `exec(...)` When Possible

`run(...)` is kcov-wrapped (when coverage is enabled) and quotes args
correctly. Reach for `exec()` only when you need shell features:

```typescript
// Prefer
const result = script.run("--name", "Alice", "--json");

// When you need a pipe or redirect
const result = script.exec('"$SCRIPT" --json | jq .greeting');
```

### 4. Reset Builder State Between Configurations

State is reset automatically after every `run()` / `exec()` and again
before each test. Within a single test, the second termination starts
fresh:

```typescript
test("two invocations", () => {
  const first = script.env({ MODE: "a" }).run();
  expect(first).toSucceed();

  // env({ MODE: "a" }) is no longer set here
  const second = script.run();
  expect(second).toSucceed();
});
```

If you want shared configuration across multiple terminations within a
single test, re-apply it:

```typescript
test("with shared env", () => {
  const env = { TZ: "UTC" };

  const first = script.env(env).run("--time");
  const second = script.env(env).run("--date");
});
```

### 5. Mock Binaries kcov Never Touches for Strict-Count Assertions

When coverage is on, kcov instrumentation may invoke binaries (notably
`git rev-parse`). Those invocations flow through your recorder shim and
inflate counts. For reliable strict-count assertions, mock binaries kcov
has no reason to invoke.

```typescript
// Flaky under coverage - kcov may invoke git internally
expect(result).toHaveInvokedTimes("git", 1);

// Reliable - widget-cli is fictional
expect(result).toHaveInvokedTimes("widget-cli", 3);
```

## Troubleshooting

### `Cannot find module '../scripts/hello.sh'`

TypeScript needs the `.sh` module declaration. Add `"vitest-bats"` to
`tsconfig.json` `compilerOptions.types`:

```json
{
  "compilerOptions": {
    "types": ["vitest-bats"]
  }
}
```

### "BATS version 1.4 is too old"

`run --separate-stderr` requires BATS 1.5+. Upgrade your BATS install.

### Mock Not Being Used

The recorder shim is on `PATH` at `$VBATS_RECORDER/bin` for the duration
of the BATS test. If the script invokes the command via an absolute path
(e.g., `/usr/bin/git`), the shim is bypassed. Make sure scripts use
unqualified command names.

### `toHaveInvokedTimes` Off by One Under Coverage

kcov may invoke `git rev-parse` (or similar) internally during
instrumentation, and those calls go through your shim. Mock binaries
kcov never touches for strict-count assertions.

### `result.json()` Throws

Verify the script outputs valid JSON. Print `result.output` to debug:

```typescript
console.log(JSON.stringify(result.output));
```

Common causes: a trailing newline followed by a debug log to stdout, an
empty body, or partial output truncation.

### Schema Validation Fails Unexpectedly

`toMatchSchema` accepts both Standard Schema and raw JSON Schema. If you
pass a Zod schema and validation fails with cryptic messages, inspect the
parsed value:

```typescript
const result = script.run();
console.log(result.json());
expect(result).toMatchSchema(MySchema);
```

## See Also

- [Non-Executable Scripts](non-executable-scripts.md) -- testing scripts
  without the executable bit
- [Docker Coverage](docker-coverage.md) -- running kcov in Docker
- [BATS documentation](https://bats-core.readthedocs.io/) -- BATS framework
  reference
- [Standard Schema](https://github.com/standard-schema/standard-schema) --
  schema validator interoperability spec

## License

[MIT](../LICENSE)
