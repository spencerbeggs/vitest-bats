# vitest-bats Package

The publishable npm package. Provides a Vitest plugin for testing shell scripts
via BATS with kcov coverage collection and an `expect.extend` matcher API.

## Package Overview

Published as `vitest-bats` to npm and GitHub Packages. Three entry points:

- `vitest-bats` (`src/index.ts`) -- Main entry: `BatsPlugin`,
  `BatsCoverageReporter`, `ScriptBuilder`, `BatsResult`, matchers, types
- `vitest-bats/runtime` (`src/runtime.ts`) -- Runtime API: `ScriptBuilder`,
  `BatsResult`, `resetAllBuilders`
- `vitest-bats/setup` (`src/setup.ts`) -- `expect.extend` registration +
  per-test builder reset (auto-injected by the plugin via `setupFiles`)

There is no `vitest-bats/runner` entry. Tests run on the standard vitest
runner; `BatsPlugin` wires everything via Vite transform and setup files.

BATS >= 1.5 and vitest >= 4.1.0 are required.

## Source Layout

```text
src/
  index.ts                # Public API re-exports
  plugin.ts               # BatsPlugin() -- Vite transform + setupFiles inject
  runtime.ts              # ScriptBuilder + BatsResult (test-writing API)
  setup.ts                # expect.extend(batsMatchers) + beforeEach reset
  matchers.ts             # 23 expect matchers (status/output/lines/json/schema)
  schema.ts               # Standard Schema + JSON Schema (ajv) validation
  bats-generator.ts       # Generates .bats file content from a ScriptBuilder
  bats-executor.ts        # Spawns bats, parses base64-encoded result payload
  coverage-reporter.ts    # BatsCoverageReporter (kcov -> CoverageMap merge)
  shims.d.ts              # Module declarations for `*.sh` virtual imports
  vitest-kcov-types.ts    # Type augmentation for vitest config
```

## Primary APIs

### BatsPlugin (plugin.ts)

Vitest plugin added to `plugins` array. Handles:

1. System dependency detection (bats, kcov, jq) with `deps: "warn" | "error"`
2. Vite transform: rewrites `.sh` imports to a `ScriptBuilder` instance
3. Auto-injects `vitest-bats/setup` into `setupFiles` (registers matchers and
   resets builder state per test) -- do not set this manually
4. Cache directory creation (scoped under Vite's cacheDir as `vitest-bats/`)
5. Coverage reporter injection: always injects `BatsCoverageReporter` when
   coverage is enabled, with synthetic branch/function entries

### ScriptBuilder (runtime.ts)

Test-writing API. Import `.sh` files in standard `.test.ts` files. Builder is
config-then-execute: `env()` / `flags()` / `mock()` chain, then terminate
with `run(...args)` or `exec(shellExpr)`. Both terminators return a
`BatsResult` (a plain class -- not thenable; `await` of a non-thenable
returns the value unchanged, so `await result` is a no-op but harmless).

```typescript
import hello from "../scripts/hello.sh";

test("outputs greeting", () => {
  const result = hello.env({ NAME: "world" }).run("--upper");
  expect(result).toExitWith(0);
  expect(result).toHaveOutput(/HELLO/);
});
```

### Matchers (matchers.ts, setup.ts)

23 `expect.extend` matchers auto-registered via `setupFiles`. Cover status,
stdout/stderr, lines, mock calls, JSON values, and schema validation. The
two schema matchers:

- `toMatchSchema(schema)` -- Standard Schema (Zod, Valibot, Arktype, Effect
  Schema) via `@standard-schema/spec`
- `toMatchJsonSchema(schema)` -- raw JSON Schema validated by ajv (with
  `ajv-formats`)

### BatsCoverageReporter (coverage-reporter.ts)

Always injected by `BatsPlugin` when coverage is enabled. Implements
`onCoverage()`: parses kcov `cobertura.xml`, converts to Istanbul, and merges
into the v8 CoverageMap with synthetic branch/function entries so threshold
checks pass (kcov only tracks statements/lines).

### Mock Subsystem

Self-contained. No `bats-mock` runtime dependency. The generator emits PATH
shim scripts that pattern-match on argv via bash `[[ ]]` and emit
pre-recorded responses inline. Mock invocations are captured back to the test
as structured `MockCall` entries on `BatsResult`.

## Dependencies

- **Runtime**: `ajv`, `ajv-formats`, `@standard-schema/spec`,
  `fast-xml-parser`, `minimatch`
- **Peer**: `vitest >= 4.1.0`
- **System**: bats (>= 1.5), jq, kcov (coverage only)

## Build

Uses `@savvy-web/rslib-builder`. The source `private: true` is correct -- the
builder transforms it based on `publishConfig.access`.

```bash
cd package
pnpm run build:dev         # Development build
pnpm run build:prod        # Production build
```

## Coverage Environment

kcov requires `ptrace` (blocked by macOS SIP). Two options:

- **Devcontainer** (preferred): `.devcontainer/` has bats, kcov, and all BATS
  libraries pre-installed. Works in VS Code and GitHub Codespaces.
- **Docker**: `Dockerfile.test` + `docker-compose.test.yml` in repo root.
  Adds `SYS_PTRACE` capability. Set `HTE_PATH_REWRITE=/workspace:$PWD` for
  clickable hyperlinks.

## Design Documentation

**For detailed information, load these when working on internals:**

- Architecture and data flow: `@../.claude/design/vitest-bats/architecture.md`
- Full API reference: `@../.claude/design/vitest-bats/api-reference.md`

Load when modifying exports, the matcher set, the schema layer, the BATS
generator/executor, or the coverage pipeline. **Do NOT load unless directly
relevant.**
