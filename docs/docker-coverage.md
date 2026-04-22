# Running Tests with Coverage in Docker

## Why Docker?

Kcov requires Linux kernel features (ptrace) to collect coverage for bash scripts. On macOS, kcov cannot instrument bash scripts properly. Running tests in a Docker container with Linux solves this limitation.

> **Alternative: Dev Container** -- The repository includes a
> `.devcontainer/` configuration with bats, kcov, and all BATS libraries
> pre-installed. Open the project in VS Code with the Dev Containers extension
> or in GitHub Codespaces for coverage support without manual Docker commands.
> See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

## Quick Start

### Option 1: Using npm script (Recommended)

```bash
pnpm test:docker
```

This will:

1. Build a Docker image with kcov, BATS, and all dependencies
2. Run tests inside the container
3. Generate coverage reports in `./coverage/`
4. Display coverage summary

### Option 2: Using docker-compose directly

```bash
# Build the image
docker-compose -f docker-compose.test.yml build

# Run tests
docker-compose -f docker-compose.test.yml run --rm test

# View coverage
open coverage/index.html
```

### Option 3: Using the shell script

```bash
./scripts/test-in-docker.sh
```

## What Gets Installed in Docker

The Docker image includes:

* **Node.js 24** - For running Vitest and TypeScript
* **kcov** - Built from source for latest bash coverage support
* **BATS** - Bash testing framework
* **pnpm** - Package manager
* **System tools** - cmake, jq, git, etc.

## Coverage Output

After running tests in Docker, coverage reports are available at:

* **HTML Report**: `coverage/index.html`
* **JSON Report**: `coverage/coverage.json`
* **Cobertura XML**: `coverage/cobertura.xml`

## Troubleshooting

### Docker not installed

Install Docker Desktop for Mac:

```bash
brew install --cask docker
```

### Permission errors

Make sure Docker has access to your project directory in Docker Desktop settings.

### Old coverage data

Clean coverage before running:

```bash
rm -rf coverage
pnpm test:docker
```

## CI/CD Integration

The Docker setup is designed for both local development and CI environments:

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Run tests with coverage
        run: pnpm test:docker
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/cobertura.xml
```

## Development Workflow

For faster iteration during development:

1. **First run** (builds image):

   ```bash
   pnpm test:docker
   ```

2. **Subsequent runs** (uses cached image):

   ```bash
   docker-compose -f docker-compose.test.yml run --rm test
   ```

3. **Rebuild after dependency changes**:

   ```bash
   docker-compose -f docker-compose.test.yml build
   ```

## File Structure

```text
vitest-bats/
├── Dockerfile.test           # Docker image definition
├── docker-compose.test.yml   # Docker Compose config
├── scripts/                  # Shell scripts under test
├── __test__/                 # Tests consuming vitest-bats
└── coverage/                 # Coverage output (mounted from container)
```

## Performance Tips

* The Docker image caches `node_modules` for faster builds
* Source files are mounted as volumes for quick iteration
* Coverage output is mounted to avoid copying large files

## Local vs Docker vs Dev Container

| Feature | Local (macOS) | Docker | Dev Container |
| ------- | ------------ | ------ | ------------- |
| Test execution | Fast | Fast | Fast |
| BATS file generation | Works | Works | Works |
| Kcov coverage | Not supported | Full coverage | Full coverage |
| Setup time | Instant | First build slow | First build slow |
| Subsequent runs | Fast | Fast (cached) | Fast |
| IDE integration | Native | None | Full (VS Code) |
| Codespaces support | No | No | Yes |

**Recommendation**:

* Use local testing for rapid development and debugging
* Use the dev container for full coverage with IDE integration
* Use Docker for headless coverage collection and CI/CD pipelines
