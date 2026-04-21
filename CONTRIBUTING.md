# Contributing

Contributions are welcome. This guide covers setup, workflow, and conventions.

## Prerequisites

- **Node.js** 24+
- **pnpm** 10.33+
- **System tools**: bats, bats-support, bats-assert, bats-mock, jq
- **Optional**: kcov (Linux only -- coverage collection), Docker (macOS
  coverage)

### macOS

```bash
brew install bats-core bats-support bats-assert bats-mock jq kcov
```

### Linux (Debian/Ubuntu)

```bash
apt-get install -y bats bats-support bats-assert bats-file jq kcov
```

## Setup

```bash
git clone https://github.com/spencerbeggs/vitest-bats.git
cd vitest-bats
pnpm install
pnpm run test
```

## Project Structure

```text
package/              Published npm package (vitest-bats)
  src/                Package source code
  __test__/           Package unit tests
scripts/              Example shell scripts for testing
__test__/             Integration tests consuming the package
Dockerfile.test       Docker environment for kcov on macOS
docker-compose.test.yml
```

The root workspace (`@spencerbeggs/vitest-bats`) is the development harness.
The publishable package lives in `package/` and is consumed via
`vitest-bats: workspace:*`.

## Development Workflow

### Key Commands

| Command | Purpose |
| --- | --- |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Tests in watch mode |
| `pnpm run test:coverage` | Tests with v8 coverage |
| `pnpm run build` | Build dev + prod outputs |
| `pnpm run lint` | Biome lint + format check |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run typecheck` | Type-check via tsgo |

### Running a Specific Test

```bash
pnpm vitest run __test__/hello.test.ts
```

### Building the Package

```bash
cd package
pnpm run build:dev    # Development build
pnpm run build:prod   # Production build
```

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting.
Configuration extends `@savvy-web/lint-staged/biome/silk.jsonc`. Run
`pnpm run lint:fix` before committing.

### Import Conventions

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins (`import fs from 'node:fs'`)
- Separate type imports: `import type { Foo } from './bar.js'`

## Testing

Tests live in `__test__/`, never co-located in `src/`. See
[`__test__/CLAUDE.md`](__test__/CLAUDE.md) for the full directory structure.

- Unit tests: `__test__/*.test.ts`
- E2e tests: `__test__/e2e/*.e2e.test.ts`
- Integration tests: `__test__/integration/*.int.test.ts`

Coverage collection requires kcov on Linux. On macOS, tests run but kcov
coverage is not collected. Use Docker for macOS coverage -- see
[docs/docker-coverage.md](docs/docker-coverage.md).

## Commits

All commits require:

1. **Conventional commit format** -- `feat:`, `fix:`, `chore:`, etc. See the
   [Conventional Commits spec](https://www.conventionalcommits.org/).
2. **DCO signoff** -- `Signed-off-by: Your Name <email@example.com>`

Git hooks enforce both requirements automatically.

## Pull Requests

1. Fork the repository and create a feature branch
2. Make your changes with tests
3. Ensure `pnpm run test` and `pnpm run lint` pass
4. Submit a PR against `main`

## Changesets

This project uses
[@savvy-web/changesets](https://github.com/savvy-web/changesets) for
versioning. If your change affects the published package, add a changeset:

```bash
pnpm changeset
```

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
