# Test Directory

This project uses `@savvy-web/vitest` for test discovery. Tests live here in
`__test__/`, not co-located in `src/`.

## Directory Structure

```text
__test__/
  utils/              # Shared mocks, helpers, and type utilities for unit tests
  fixtures/           # Static test data and fixture files for unit tests
  *.test.ts           # Unit tests

  e2e/
    utils/            # Shared mocks, helpers, and type utilities for e2e tests
    fixtures/         # Static test data and fixture files for e2e tests
    *.e2e.test.ts     # End-to-end tests

  integration/
    utils/            # Shared mocks, helpers, and type utilities for integration tests
    fixtures/         # Static test data and fixture files for integration tests
    *.int.test.ts     # Integration tests
```

## Rules

- **Classification is by filename, not location.** `*.e2e.test.ts` is always
  e2e regardless of which directory it sits in. Same for `*.int.test.ts`.
- **`utils/` and `fixtures/` are excluded from test discovery.** Put shared
  mocks, test helpers, builder functions, and type utilities in `utils/`. Put
  static data (JSON, fixtures, sample files) in `fixtures/`.
- **Each test category has its own `utils/` and `fixtures/`.** Unit test
  helpers go in `__test__/utils/`, e2e helpers go in `__test__/e2e/utils/`,
  etc. Do not share helpers across categories — their setup needs differ.
- **Never put test files in `src/`.** All tests belong in `__test__/`.
- **Never inline large test data in test files.** Extract it to `fixtures/`.
- **Never define shared mocks or helper functions in test files.** Extract them
  to the appropriate `utils/` directory so other tests can reuse them.

## Shell Script Tests

Tests for `.sh` scripts use `vitest-bats`. Import the script, configure the
builder, terminate with `run(...args)` or `exec(shellExpr)`, and assert with
the auto-registered `expect` matchers (e.g. `toSucceed`, `toContainOutput`,
`toMatchOutput`, `toMatchSchema`). No custom runner, no `assert_*` methods.
`run()` returns a non-thenable `BatsResult` — using `await` is harmless but
unnecessary.

```typescript
import hello from "../scripts/hello.sh";

test("greets", () => {
  const result = hello.env({ NAME: "world" }).run("--upper");
  expect(result).toSucceed();
  expect(result).toMatchOutput(/HELLO/);
});
```

For the full matcher list and builder API, see
`@../../.claude/design/vitest-bats/api-reference.md`. Load only when authoring
or debugging shell tests.
