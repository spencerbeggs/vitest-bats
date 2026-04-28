# Testing Non-Executable Scripts

## Overview

For security or policy reasons, some projects do not allow shell scripts
to carry the executable bit (`chmod +x`) in version control. This guide
shows how to test such scripts with `vitest-bats`.

## The Problem

`script.run(...)` generates a `.bats` file that invokes the script as
`"$SCRIPT" arg0 arg1 ...`. That invocation requires the script to have
the executable bit. If the bit is missing, BATS will fail with
"Permission denied".

Scripts can always be executed through an explicit interpreter, regardless
of the executable bit:

```bash
bash script.sh   # No executable bit needed
```

## Solution: Use `exec()` Instead of `run()`

`ScriptBuilder.exec(shellExpr)` runs `bash -c '<expr>'` and exports
`$SCRIPT` to point at the script's absolute path. Invoke `bash "$SCRIPT"`
explicitly to bypass the executable-bit check:

```typescript
import { describe, expect, test } from "vitest";
import hello from "../scripts/hello.sh";

describe("hello.sh (non-executable)", () => {
  test("greets by name", () => {
    const result = hello.exec('bash "$SCRIPT" --name Alice');
    expect(result).toSucceed();
    expect(result).toContainOutput("Hello Alice");
  });

  test("emits JSON with --json flag", () => {
    const result = hello.exec('bash "$SCRIPT" --json');
    expect(result).toSucceed();
    expect(result).toHaveJsonValue("greeting", "Hello World");
  });
});
```

### Trade-offs

- **No kcov coverage.** `exec()` is not kcov-wrapped because the user
  controls what runs inside the shell expression. If you need kcov
  coverage, the script must be executable. The dev container and Docker
  setups both run on Linux where coverage works -- but the script itself
  still needs the bit.
- **You write the invocation.** Quote `$SCRIPT` so paths with spaces
  survive: `bash "$SCRIPT"`, not `bash $SCRIPT`.
- **Mocks and env vars still work.** `mock()` and `env()` are applied
  before `exec()` runs, so the recorder shim is on `PATH` and env vars
  are exported in the same way as for `run()`.

## When to Apply the Executable Bit Anyway

If your project allows it, just `chmod +x` the script. Then `run()` works
unmodified and kcov can collect coverage:

```typescript
const result = hello.run("--name", "Alice");
```

Coverage requires:

1. The script has the executable bit, **and**
2. kcov is available (Linux only, due to macOS SIP).

For a CI policy that forbids the bit but you still want coverage, run the
script under `bash` in a kcov-aware wrapper -- but `vitest-bats` does not
ship that mode.

## Combining `exec()` with Mocks and Env Vars

```typescript
import { describe, expect, test } from "vitest";
import statusScript from "../scripts/status.sh";

describe("status.sh (non-executable)", () => {
  test("emits JSON status when git is mocked", () => {
    const result = statusScript
      .mock("git", { "rev-parse --abbrev-ref HEAD": "echo main" })
      .env({ STATUS_FORMAT: "json" })
      .exec('bash "$SCRIPT"');

    expect(result).toSucceed();
    expect(result).toHaveJsonValue("branch", "main");
  });
});
```

The recorder shim and env vars are applied in the BATS `setup()` block
before the `exec()` body runs.

## Removing Executable Bits

To remove executable permissions from all shell scripts in your project:

```bash
find scripts -name "*.sh" -type f -exec chmod -x {} \;

# Verify they're no longer executable
find scripts -name "*.sh" -type f -perm +111
# (Should return nothing)
```

## Pre-Commit Enforcement

If you want to prevent executable scripts from being committed, add a
pre-commit hook:

```bash
#!/usr/bin/env bash
# .git/hooks/pre-commit
set -euo pipefail

offenders=$(git diff --cached --name-only --diff-filter=ACM \
  | grep '\.sh$' \
  | xargs -I {} test -x {} && echo {} || true)

if [ -n "$offenders" ]; then
  echo "Error: executable shell scripts staged. Remove the bit:" >&2
  echo "$offenders" >&2
  exit 1
fi
```

Make the hook executable:

```bash
chmod +x .git/hooks/pre-commit
```

## Troubleshooting

### `Permission denied` when running a non-executable script

You are using `run()`. Switch to `exec('bash "$SCRIPT" ...')`, or apply
the executable bit:

```bash
chmod +x scripts/foo.sh
```

### `exec()` produces no coverage

Expected. `exec()` is not kcov-wrapped. To collect coverage, the script
must have the executable bit and kcov must be available.

### Mock not honored under `exec()`

The recorder shim is on `PATH` for the duration of the BATS test. If
your shell expression invokes the command via an absolute path
(`/usr/bin/git ...`), the shim is bypassed. Use unqualified command
names inside the expression.

## See Also

- [Testing Helpers API](testing-helpers.md) -- builder, matchers, and
  schema validation reference
- [Docker Coverage](docker-coverage.md) -- running kcov in Docker
