# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Project Overview

**vitest-bats** is a Vitest plugin for testing shell scripts via BATS (Bash
Automated Testing System) with kcov coverage collection. It merges shell script
coverage into Vitest's v8 Istanbul CoverageMap for unified reporting.

The publishable package lives in `package/`. The root workspace consumes it via
`vitest-bats: workspace:*` and serves as both development harness and
integration test suite.

## Workspace Structure

```text
vitest-bats/
  package/              # npm package (published as `vitest-bats`)
  scripts/              # Example shell scripts for testing
  __test__/             # Integration tests consuming the package
  Dockerfile.test       # Docker env for kcov (macOS SIP workaround)
  docker-compose.test.yml
```

This is a pnpm workspace. The root `package.json` is `@spencerbeggs/vitest-bats`
(private, not published). The package at `package/` is `vitest-bats` (published).

## Key APIs

- **`BatsPlugin()`** -- Vitest plugin. Add to `plugins` array in
  `vitest.config.ts`. Handles dependency detection, reporter injection, and
  environment setup.
- **`BatsHelper.describe(scriptPath, fn)`** -- Test-writing API. Wraps
  `vitest.describe()` with BATS lifecycle. Tests use fluent assertion builder.
- **`BatsCoverageReporter`** -- Merges kcov cobertura.xml data into v8
  Istanbul CoverageMap via `onCoverage()` hook.

See `package/CLAUDE.md` for package-specific guidance.

## Build Pipeline

This project uses
[@savvy-web/rslib-builder](https://github.com/savvy-web/rslib-builder) to
produce dual build outputs via [Rslib](https://rslib.rs/):

| Output | Directory | Purpose |
| ------ | --------- | ------- |
| Development | `package/dist/dev/` | Local development with source maps |
| Production | `package/dist/npm/` | Published to npm and GitHub Packages |

### How `private: true` Works

The source `package.json` files are marked `"private": true` -- this is
intentional. During the build, rslib-builder reads `publishConfig` and
transforms the output `package.json` (sets `private: false`, rewrites exports,
strips dev fields). Never manually set `"private": false` in source.

### Turbo Orchestration

[Turbo](https://turbo.build/) manages build task dependencies and caching:

- `types:check` runs first (no dependencies)
- `build:dev` and `build:prod` both depend on `types:check`
- Cache excludes: `*.md`, `.changeset/**`, `.claude/**`, `.github/**`,
  `.husky/**`, `.vscode/**`
- Environment pass-through: `GITHUB_ACTIONS`, `CI`

## Commands

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run lint:fix:unsafe   # Auto-fix including unsafe transforms
pnpm run lint:md           # Check markdown with markdownlint
pnpm run lint:md:fix       # Auto-fix markdown issues
pnpm run typecheck         # Type-check via Turbo (runs tsgo)
pnpm run test              # Run all tests
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with v8 coverage report
```

### Building

```bash
pnpm run build             # Build dev + prod outputs via Turbo
pnpm run build:dev         # Build development output only
pnpm run build:prod        # Build production/npm output only
```

## Code Quality and Hooks

### Biome

Unified linter and formatter. Configuration in `biome.jsonc` extends
`@savvy-web/lint-staged/biome/silk.jsonc`.

### Husky Git Hooks

| Hook | Action |
| ---- | ------ |
| `pre-commit` | Runs lint-staged (Biome on staged files) |
| `commit-msg` | Validates commit message format via commitlint |
| `pre-push` | Runs tests for affected packages using Turbo |
| `post-checkout` | Package manager setup |
| `post-merge` | Package manager setup |

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins (e.g., `import fs from 'node:fs'`)
- Separate type imports: `import type { Foo } from './bar.js'`

### Commits

All commits require:

1. Conventional commit format (`feat`, `fix`, `chore`, etc.)
2. DCO signoff: `Signed-off-by: Name <email>`

### Publishing

Packages publish to both GitHub Packages and npm with provenance via
[@savvy-web/changesets](https://github.com/savvy-web/changesets).

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with v8 coverage provider
- **Pool**: Uses `forks` (not threads) for broader compatibility
- **Config**: `vitest.config.ts` uses `BatsPlugin()` from `vitest-bats` and
  includes `__test__/**/*.test.ts`
- **Docker**: Use `docker-compose.test.yml` for full kcov coverage on macOS

### Test Directory

All tests live in `__test__/`, never co-located in `src/`. See
`__test__/CLAUDE.md` for the full directory structure and rules.

- Unit tests: `__test__/*.test.ts`
- E2e tests: `__test__/e2e/*.e2e.test.ts`
- Integration tests: `__test__/integration/*.int.test.ts`

## Design Documentation

Detailed architecture and API reference are in design docs.

**When working on these areas, load relevant context:**

- Architecture and data flow: `@./.claude/design/vitest-bats/architecture.md`
- Full API reference: `@./.claude/design/vitest-bats/api-reference.md`

Load these docs when modifying package internals, adding new exports, or
changing the coverage pipeline. **Do NOT load unless directly relevant.**

## Savvy-Web Tool References

| Package | Purpose |
| ------- | ------- |
| rslib-builder | Build pipeline, dual output, package.json transform |
| commitlint | Conventional commit + DCO enforcement |
| changesets | Versioning, changelogs, release management |
| lint-staged | Pre-commit file linting via Biome |
| vitest | Vitest config factory with project support |
