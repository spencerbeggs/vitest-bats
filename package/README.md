# vitest-bats

A [Vitest](https://vitest.dev/) plugin for testing bash scripts with
[BATS](https://github.com/bats-core/bats-core) and collecting
[kcov](https://github.com/SimonKagstrom/kcov) coverage, merged into Vitest's
standard v8 coverage report.

## Features

- **Single plugin setup** -- `BatsPlugin()` handles dependency detection,
  reporter injection, environment configuration, and matcher registration
- **Native `.sh` imports** -- `import script from "./hello.sh"` returns a
  builder. Configure with `env()` / `flags()` / `mock()`, terminate with
  `run(...args)` or `exec(shellExpr)`.
- **23 `expect.extend` matchers** -- `toSucceed`, `toContainOutput`,
  `toHaveJsonValue`, `toMatchSchema`, `toHaveInvoked`, and more.
  Auto-registered via setup file -- no user setup required.
- **Schema validation** -- `toMatchSchema` accepts any
  [Standard Schema](https://github.com/standard-schema/standard-schema)
  validator (Zod, Valibot, Arktype, Effect Schema). `toMatchJsonSchema`
  validates raw JSON Schema via Ajv.
- **Self-contained command mocking** -- `.mock("git", { "remote get-url *":
  "echo https://example.com" })` embeds shim binaries that record calls and
  emit pre-recorded responses. No `bats-mock` runtime dependency.
- **Unified coverage** -- Shell script coverage from kcov is merged into the v8
  Istanbul CoverageMap and reported alongside TypeScript coverage.

## Installation

```bash
npm install --save-dev vitest-bats vitest
```

`vitest-bats` requires `vitest >= 4.1.0` and BATS `>= 1.5` (for the
`run --separate-stderr` form used to capture stderr separately).

### System Dependencies

These must be installed on the host (or in your Docker container):

| Dependency | Required | Install (macOS) | Install (Linux) |
| --- | --- | --- | --- |
| bats (>= 1.5) | Yes | `brew install bats-core` | `apt-get install bats` |
| bats-support | Yes | `brew install bats-support` | `apt-get install bats-support` |
| bats-assert | Yes | `brew install bats-assert` | `apt-get install bats-assert` |
| bats-mock | Yes | `brew install bats-mock` | `apt-get install bats-file` |
| jq | Yes | `brew install jq` | `apt-get install jq` |
| kcov | Coverage only | `brew install kcov` | `apt-get install kcov` |

`bats-assert` and `bats-mock` are still detected at startup for compatibility
warnings; the runtime no longer loads them. Mocks are self-contained, and
assertions happen in TypeScript via the matchers below.

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

The plugin auto-injects `vitest-bats/setup` into `test.setupFiles`. Do not
add it manually -- it registers all matchers and a `beforeEach` builder
reset.

### 2. Add the `.sh` module type

In `tsconfig.json`, add `vitest-bats` to `types` so TypeScript understands
`.sh` imports:

```json
{
  "compilerOptions": {
    "types": ["vitest-bats"]
  }
}
```

### 3. Write Tests

```typescript
// __test__/hello.test.ts
import { describe, expect, test } from "vitest";
import hello from "../scripts/hello.sh";

describe("hello.sh", () => {
  test("outputs default greeting", () => {
    const result = hello.run();
    expect(result).toSucceed();
    expect(result).toContainOutput("Hello World");
  });

  test("greets by name", () => {
    const result = hello.run("--name", "Alice");
    expect(result).toSucceed();
    expect(result).toContainOutput("Hello Alice");
  });

  test("outputs JSON with --json flag", () => {
    const result = hello.run("--json");
    expect(result).toSucceed();
    expect(result).toHaveJsonValue("greeting", "Hello World");
  });

  test("rejects unknown arguments", () => {
    const result = hello.run("--invalid");
    expect(result).toFail();
    expect(result).toContainStderr("Unknown option");
  });
});
```

`run()` returns a `BatsResult` synchronously. `await` is harmless but
unnecessary -- `BatsResult` is not thenable.

### 4. Run Tests

```bash
vitest run
vitest run --coverage  # With coverage (requires kcov on Linux)
```

## API Reference

### `BatsPlugin(options?)`

Vitest plugin. Add to the `plugins` array in `vitest.config.ts`.

```typescript
BatsPlugin({
  coverage: "auto",       // "auto" | true | false (default: "auto")
  deps: "error",          // "error" | "warn"      (default: "error")
  logLevel: "errors-only", // "verbose" | "debug" | "errors-only"
  links: "auto",           // "auto" | "default" | "hte"
});
```

Coverage modes:

| Value | Behavior |
| --- | --- |
| `"auto"` (default) | Shell coverage on when kcov is available and platform is not macOS |
| `true` | Require kcov on a non-macOS platform; throw otherwise |
| `false` | Always exclude shell scripts from coverage |

`deps`:

- `"error"` (default) -- throw on missing required dependencies
- `"warn"` -- log warnings; pure-TS unit tests still run, integration
  tests using `.sh` imports fail individually

### Importing Scripts

`.sh` imports return a `ScriptBuilder` instance:

```typescript
import script from "../scripts/hello.sh";
// script: ScriptBuilder
```

The plugin's Vite transform (`resolveId` + `load`) intercepts the import and
emits a virtual module that constructs a `ScriptBuilder` bound to the
script's absolute path.

### `ScriptBuilder`

Configuration methods accumulate state and return `this` for chaining.
Termination methods (`run` / `exec`) consume the state, execute the script,
and return a `BatsResult`. Builder state is reset after every termination
(via a `finally` block) and again before each test (via the auto-injected
`beforeEach`).

#### Configuration

| Method | Purpose |
| --- | --- |
| `env(vars)` | Set environment variables for the next run. Multiple calls accumulate. |
| `flags(value)` | Append a fixed flag string to the script invocation. Replaces prior `flags()`. |
| `mock(cmd, responses?)` | Register a recorder shim for `cmd`. Patterns map to bash response expressions. |

`mock()` patterns are converted to bash globs: literal segments are
double-quoted while `* ? [ ]` stay active. Responses are evaluated by `eval`
so they can include any bash expression.

```typescript
const result = script
  .env({ NAME: "Alice" })
  .flags("--upper")
  .mock("git", { "remote get-url *": "echo https://example.com" })
  .run();
```

If no pattern matches at runtime, the shim emits an error to stderr and
exits 1. Mocks accumulate across `mock()` calls; passing an empty
`responses` map records calls without producing output.

#### Termination

| Method | Generated invocation |
| --- | --- |
| `run(...args)` | `"$SCRIPT" arg0 arg1 ...` (kcov-wrapped when coverage is on) |
| `exec(shellExpr)` | `bash -c '<expr>'` -- `$SCRIPT` is exported. Not kcov-wrapped. |

`exec()` is the escape hatch for pipelines and shell expressions:

```typescript
const result = script.exec('"$SCRIPT" --name Pipeline | tr a-z A-Z');
```

### `BatsResult`

Returned by `run()` / `exec()`. Plain class, not thenable.

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

`result.json<T>()` lazily parses `output` as JSON, caching the value on
first call. Throws with a descriptive message if the output is not valid
JSON.

### Matchers

23 matchers are registered automatically. All operate on a `BatsResult`.

#### Status

| Matcher | Asserts |
| --- | --- |
| `toSucceed()` | `status === 0` |
| `toFail(code?)` | `status !== 0` (or `status === code` if given) |

#### Output (stdout)

| Matcher | Asserts |
| --- | --- |
| `toHaveOutput(text)` | `output === text` |
| `toContainOutput(text)` | `output.includes(text)` |
| `toMatchOutput(pattern)` | RegExp test against `output` |
| `toHaveEmptyOutput()` | `output === ""` |

#### Stderr

| Matcher | Asserts |
| --- | --- |
| `toHaveStderr(text)` | `stderr === text` |
| `toContainStderr(text)` | `stderr.includes(text)` |
| `toMatchStderr(pattern)` | RegExp test against `stderr` |

#### Lines

| Matcher | Asserts |
| --- | --- |
| `toHaveLine(index, text)` | `lines[index] === text` |
| `toHaveLineContaining(text, index?)` | Line at `index` contains `text`, or any line if index omitted |
| `toHaveLineMatching(pattern, index?)` | Same shape, RegExp |
| `toHaveLineCount(n)` | `lines.length === n` |

#### JSON

| Matcher | Asserts |
| --- | --- |
| `toOutputJson()` | `result.json()` doesn't throw |
| `toEqualJson(expected)` | Parsed JSON deep-equals `expected` |
| `toMatchJson(partial)` | `partial` is a deep subset of parsed JSON |
| `toHaveJsonValue(path, expected)` | Path exists and deep-equals `expected` |
| `toHaveJsonPath(path)` | Path exists |

Path syntax: dots for keys, brackets for array indices
(e.g., `"users[0].name"`).

#### Schema

| Matcher | Asserts |
| --- | --- |
| `toMatchSchema(schema)` | Standard Schema OR raw JSON Schema validates the parsed JSON |
| `toMatchJsonSchema(schema)` | Raw JSON Schema validates the parsed JSON |

`toMatchSchema` auto-detects Standard Schema (Zod, Valibot, Arktype, Effect
Schema) by the `~standard` property and falls through to Ajv for plain
objects. Compiled validators are cached.

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

#### Invocation (mock calls)

| Matcher | Asserts |
| --- | --- |
| `toHaveInvoked(cmd, opts?)` | `cmd` was invoked at least once; if `opts.args` given, at least one call matches |
| `toHaveInvokedTimes(cmd, n)` | `result.calls[cmd].length === n` |
| `toHaveInvokedExactly(cmd, calls)` | `result.calls[cmd]` deep-equals the given list (order-sensitive) |

```typescript
const result = widget
  .mock("widget-cli", {
    init: "echo initialized",
    "build --target=*": "echo built",
    "ship *": "echo shipped",
  })
  .run();

expect(result).toHaveInvokedTimes("widget-cli", 3);
expect(result).toHaveInvokedExactly("widget-cli", [
  { args: ["init"] },
  { args: ["build", "--target=foo"] },
  { args: ["ship", "release with spaces"] },
]);
```

Strict-count matchers can be flaky when kcov instrumentation invokes
binaries you have mocked (e.g., `git rev-parse`). For reliable
strict-count assertions, mock binaries kcov never touches.

## Coverage

### How It Works

1. Vitest runs TypeScript test files.
2. Each `script.run(...)` call generates a self-contained `.bats` file in a
   per-pid temp dir and executes it via `bats --tap`.
3. When coverage is enabled and kcov is available, the generated `.bats`
   wraps `"$SCRIPT"` with kcov.
4. `BatsCoverageReporter.onCoverage()` parses each script's
   `cobertura.xml`, converts to Istanbul format, and merges into the v8
   CoverageMap.
5. Vitest reports unified coverage (TypeScript + shell scripts).

### Platform Support

| Platform | Tests | Coverage |
| --- | --- | --- |
| Linux | Full support | Full support |
| macOS | Full support | Not supported (SIP blocks ptrace) |
| Docker on macOS | Full support | Full support |

When kcov is unavailable, the reporter still emits coverage entries for
every `.sh` script registered during the Vite transform: synthetic at the
configured threshold percentage when thresholds are set, otherwise
zero-coverage from source-line analysis. Shell scripts therefore always
appear in the coverage table, even on macOS.

## Entry Points

| Path | Purpose |
| --- | --- |
| `vitest-bats` | `BatsPlugin`, `BatsCoverageReporter`, `ScriptBuilder`, `BatsResult`, `batsMatchers`, types |
| `vitest-bats/runtime` | `ScriptBuilder`, `BatsResult`, `resetAllBuilders`. Imported by virtual `.sh` modules. |
| `vitest-bats/setup` | Auto-injected setup file. Registers matchers and the `beforeEach` reset hook. |

The previous `vitest-bats/runner` entry has been removed -- execution now
happens inline inside `ScriptBuilder.run/exec`.

## Troubleshooting

### Coverage Shows 0% on macOS

Expected. kcov cannot instrument bash scripts on macOS due to SIP. Use the
included Docker setup, the dev container, or run in CI on Linux.

### "Missing required dependencies" Error

`BatsPlugin` checks for system dependencies at startup. Install the missing
tools listed in the error message, or pass `deps: "warn"` to allow pure-TS
tests to run.

### "BATS version 1.4 is too old"

`run --separate-stderr` requires BATS 1.5+. Upgrade your BATS install.

## Related

- [Vitest](https://vitest.dev/) -- Test framework
- [BATS](https://github.com/bats-core/bats-core) -- Bash Automated Testing
  System
- [kcov](https://github.com/SimonKagstrom/kcov) -- Code coverage for shell
  scripts
- [Standard Schema](https://github.com/standard-schema/standard-schema) --
  Schema validator interoperability spec

## License

[MIT](LICENSE)
