# vitest-bats

Test bash scripts with [BATS](https://github.com/bats-core/bats-core) directly
in [Vitest](https://vitest.dev/), with
[kcov](https://github.com/SimonKagstrom/kcov) coverage merged into your
existing v8 coverage report.

## Features

- **Vitest plugin** -- `BatsPlugin()` handles all setup: dependency detection,
  reporter injection, environment configuration
- **TypeScript test API** -- `BatsHelper.describe()` lets you write BATS tests
  in TypeScript with a fluent assertion builder
- **Unified coverage** -- `BatsCoverageReporter` merges kcov shell script
  coverage into Vitest's v8 Istanbul CoverageMap
- **Terminal hyperlinks** -- OSC 8 clickable links in supported terminals
  (VSCode, WezTerm, iTerm2)
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

Write a test:

```typescript
import { BatsHelper } from "vitest-bats";

const scriptPath = import.meta.resolve("../scripts/hello.sh");

BatsHelper.describe(scriptPath, (helper) => {
  helper.test("outputs default greeting", (script) => {
    script.run('"$SCRIPT"');
    script.assert_success();
    script.assert_output({ partial: "Hello World" });
  });

  helper.test("greets by name", (script) => {
    script.run('"$SCRIPT" --name Alice');
    script.assert_success();
    script.assert_output({ partial: "Hello Alice" });
  });

  helper.test("outputs JSON", (script) => {
    script.run('"$SCRIPT" --json');
    script.assert_success();
    script.assert_json_value("greeting", "Hello World");
  });
});
```

Run tests:

```bash
vitest run
```

## System Dependencies

BatsPlugin checks for these at startup and reports what is missing:

| Dependency | Required | Install (macOS) | Install (Linux) |
| --- | --- | --- | --- |
| bats | Yes | `brew install bats-core` | `apt-get install bats` |
| bats-support | Yes | `brew install bats-support` | `apt-get install bats-support` |
| bats-assert | Yes | `brew install bats-assert` | `apt-get install bats-assert` |
| bats-mock | Yes | `brew install bats-mock` | `apt-get install bats-file` |
| jq | Yes | `brew install jq` | `apt-get install jq` |
| kcov | Coverage only | `brew install kcov` | `apt-get install kcov` |

kcov coverage collection requires Linux. On macOS, tests run but coverage is
not collected due to SIP restrictions on ptrace. Use the
[dev container](.devcontainer/) or Docker for full coverage on macOS -- see
[docs/docker-coverage.md](docs/docker-coverage.md).

## Documentation

- [Testing Helpers API](docs/testing-helpers.md) -- `script.mock()`,
  `script.assert_json_value()`, and advanced usage
- [Non-Executable Scripts](docs/non-executable-scripts.md) -- Testing scripts
  without the executable bit
- [Docker Coverage](docs/docker-coverage.md) -- Running kcov in Docker on macOS

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
