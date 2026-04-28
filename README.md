# vitest-bats

Test bash scripts with [BATS](https://github.com/bats-core/bats-core) directly
in [Vitest](https://vitest.dev/), with
[kcov](https://github.com/SimonKagstrom/kcov) coverage merged into your
existing v8 coverage report.

## Features

- **Vitest plugin** -- `BatsPlugin()` handles all setup: dependency detection,
  reporter injection, environment configuration, and matcher registration
- **Native `.sh` imports** -- `import script from "./hello.sh"` returns a
  builder. Configure with `env()` / `flags()` / `mock()`, terminate with
  `run(...args)` or `exec(shellExpr)`.
- **23 `expect.extend` matchers** -- status, output, stderr, lines, JSON,
  schema validation, and mock invocation. Auto-registered via setup file.
- **Schema validation** -- `toMatchSchema` accepts any
  [Standard Schema](https://github.com/standard-schema/standard-schema)
  validator (Zod, Valibot, Arktype, Effect Schema). `toMatchJsonSchema`
  validates raw JSON Schema via Ajv.
- **Self-contained command mocking** -- shim binaries record calls and emit
  pre-recorded responses. No `bats-mock` runtime dependency.
- **Unified coverage** -- `BatsCoverageReporter` merges kcov shell script
  coverage into Vitest's v8 Istanbul CoverageMap.
- **Terminal hyperlinks** -- OSC 8 clickable links in supported terminals
  (VS Code, WezTerm, iTerm2)
- **Docker support** -- Dockerfile and Compose config for full kcov coverage on
  macOS (where SIP blocks ptrace)
- **Dev container** -- Pre-configured devcontainer with bats, kcov, and all BATS
  libraries for VS Code and GitHub Codespaces

## Quick Start

Install:

```bash
npm install --save-dev vitest-bats vitest
```

Configure `vitest.config.ts`:

```typescript
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
add it manually.

Add `vitest-bats` to `tsconfig.json` `types` so TypeScript understands `.sh`
imports:

```json
{
  "compilerOptions": {
    "types": ["vitest-bats"]
  }
}
```

Write a test:

```typescript
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

  test("outputs JSON", () => {
    const result = hello.run("--json");
    expect(result).toSucceed();
    expect(result).toHaveJsonValue("greeting", "Hello World");
  });
});
```

Run tests:

```bash
vitest run
```

`run()` returns a `BatsResult` synchronously. `await` is harmless but
unnecessary -- `BatsResult` is not thenable.

## System Dependencies

`BatsPlugin` checks for these at startup and reports what is missing:

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
assertions happen in TypeScript via the matchers.

kcov coverage collection requires Linux. On macOS, tests run but coverage is
not collected due to SIP restrictions on ptrace. Use the
[dev container](.devcontainer/) or Docker for full coverage on macOS -- see
[docs/docker-coverage.md](docs/docker-coverage.md).

## Documentation

- [Testing Helpers API](docs/testing-helpers.md) -- builder, matchers,
  `mock()`, schema validation, and advanced usage
- [Non-Executable Scripts](docs/non-executable-scripts.md) -- testing
  scripts without the executable bit
- [Docker Coverage](docs/docker-coverage.md) -- running kcov in Docker on
  macOS

## Project Structure

```text
package/           Published npm package (vitest-bats)
scripts/           Example shell scripts for testing
__test__/          Integration tests consuming the package
.devcontainer/     Dev container for VS Code / Codespaces
Dockerfile.test    Docker environment for kcov coverage
docker-compose.test.yml
```

This is a pnpm workspace. The root package (`@spencerbeggs/vitest-bats`) is
private and serves as the development harness. The publishable code lives in
`package/`.

## Development

```bash
pnpm install
pnpm run test              # Run tests
pnpm run test:watch        # Watch mode
pnpm run test:coverage     # With v8 coverage
pnpm run build             # Build dev + prod outputs
pnpm run lint              # Biome lint + format check
pnpm run typecheck         # Type-check via tsgo
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and workflow.

## License

[MIT](LICENSE)
