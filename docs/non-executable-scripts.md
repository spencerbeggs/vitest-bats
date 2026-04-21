# Testing Non-Executable Scripts

## Overview

For security reasons, some projects cannot have executable scripts (without the `+x` bit set) in their Git repositories. This guide shows how to test such scripts using the BatsHelper framework.

## The Problem

Traditionally, shell scripts are made executable:

```bash
chmod +x script.sh
./script.sh  # Runs directly
```

But you can always run scripts through an interpreter:

```bash
bash script.sh  # No executable bit needed
sh script.sh    # Works with any shell
```

## Solution: Use `run_script` Wrapper

BatsHelper now provides a `run_script` function in the BATS test setup that automatically invokes scripts with `bash`. This means:

1. **Your scripts don't need to be executable**
2. **Coverage collection still works** (kcov properly instruments the execution)
3. **Tests work identically** with minimal changes

## Usage

### Option 1: Use `run_script` (Recommended)

In your test file, replace `"$SCRIPT"` with `run_script`:

```typescript
// Before (requires executable script)
helper.test("shows help", (script) => {
    script.run('"$SCRIPT" -h');
    script.assert_success();
});

// After (works with non-executable scripts) - New clean API
helper.test("shows help", (script) => {
    script.flags("-h");
    script.exit(0); // Expect success (exit code 0)
});
```

**New Clean API: `script.flags()` and `script.exit()`**

The builder API now provides a clean, declarative approach to testing:

```typescript
// Test for success
helper.test("shows help", (script) => {
    script.flags("-h");
    script.exit(0); // Expect success
});

// Test for specific failure codes
helper.test("rejects invalid option", (script) => {
    script.flags("-x");
    script.exit(1); // Expect error
});

// Test with JSON output
helper.test("outputs JSON", (script) => {
    script.flags("-j");
    script.exit(0);
    script.assert_json_value("version", "1.0.0");
});

// Test with arguments
helper.test("processes file", (script) => {
    script.args("input.txt");
    script.exit(0);
});

// Combined flags and arguments
helper.test("converts file", (script) => {
    script.flags("-v");
    script.args("input.txt output.txt");
    script.exit(0);
});

// No flags needed - auto-runs script
helper.test("runs without flags", (script) => {
    script.exit(0); // Automatically runs: run_script
});
```

**Benefits:**

* **Cleaner API** - No more `script.run()` or `run_script` in tests
* **Declarative** - Express intent clearly: flags, args, expected exit code
* **Auto-run** - Assertions automatically run the script if not already run
* **Type-safe** - Exit codes are properly cast to numbers
* **Flexible** - Can test any exit code (0, 1, 2, etc.)
* **Automatic kcov coverage integration**
* **Scripts don't need executable bit**

### Option 2: Use `bash` Directly

Alternatively, you can explicitly use `bash`:

```typescript
helper.test("shows help", (script) => {
    script.run('bash "$SCRIPT" -h');
    script.assert_success();
});
```

**Tradeoffs:**

* More verbose
* Explicit interpreter selection
* Still collects coverage (kcov doesn't detect this pattern automatically, but it still works)

## Complete Example

Here's a full test file using the `run_script` pattern:

```typescript
import { afterAll, beforeAll, describe } from "vitest";
import { BatsHelper } from "vitest-bats";

const scriptPath = import.meta.resolve("../scripts/info/info-npm.sh");
describe(BatsHelper.getDisplayName(scriptPath), () => {
    const helper = BatsHelper.create(scriptPath);

    beforeAll(async () => {
        await helper.setup();
    }, 60000);

    afterAll(async () => {
        await helper.teardown();
    });

    // Test help option
    helper.test("shows help with -h option", (script) => {
        script.flags("-h");
        script.exit(0);
        script.assert_output({ partial: "Usage:" });
    });

    // Test with environment injection (no flags needed)
    helper.test("detects npm (markdown) - env injection", (script) => {
        script.env({
            TEST_NPM_VERSION: "9.8.1",
            TEST_NPM_BINARY_PATH: "/usr/bin/npm",
        });
        script.exit(0); // Auto-runs: run_script
        script.assert_output({ partial: "**Version:** 9.8.1" });
    });

    // Test JSON output
    helper.test("outputs valid JSON with -j flag", (script) => {
        script.env({ TEST_NPM_VERSION: "9.8.1" });
        script.flags("-j");
        script.exit(0);
        script.assert_json_value("version", "9.8.1");
    });

    // Test with mock binaries (integration test)
    helper.test("works with mock npm binary", (script) => {
        script.mock("npm", { "--version": "10.2.0" });
        script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
        script.flags("-j");
        script.exit(0);
        script.assert_json_value("version", "10.2.0");
    });
});
```

## API Evolution

The test API has evolved to be cleaner and more declarative:

```typescript
// Old style (still works)
helper.test("test with old API", (script) => {
    script.run('run_script --json');
    script.assert_success();
});

// New style (recommended) - Clean and declarative
helper.test("test with new API", (script) => {
    script.flags("--json");
    script.exit(0);
});

// Simplest style - No flags needed
helper.test("test default behavior", (script) => {
    script.exit(0); // Auto-runs script
    script.assert_output({ partial: "Expected output" });
});
```

**Migration Tips:**

* Replace `script.run('run_script -h')` with `script.flags('-h')`
* Replace `script.run('run_script')` with just removing the line (auto-runs)
* Replace `script.assert_success()` with `script.exit(0)`
* Replace `script.assert_failure()` with `script.exit(1)`

## How It Works

The `run_script` function is generated in the BATS test setup:

```bash
setup() {
    SCRIPT="/absolute/path/to/script.sh"

    # Wrapper function for non-executable scripts
    run_script() {
        bash "$SCRIPT" "$@"
    }

    # ... rest of setup
}
```

The `run()` function (BATS test helper) detects when `run_script` is used and:

1. Recognizes it as a shell function
2. Extracts the script path and arguments
3. Invokes kcov with `bash "$SCRIPT" "$@"` for coverage
4. Collects output and exit codes normally

## Removing Executable Bits

To remove executable permissions from all scripts in your project:

```bash
# Remove executable bit from all shell scripts
find scripts -name "*.sh" -type f -exec chmod -x {} \;

# Verify they're no longer executable
find scripts -name "*.sh" -type f -perm +111
# (Should return nothing)
```

## Git Configuration

If you want to prevent executable scripts from being committed:

1. **Pre-commit hook** (`.git/hooks/pre-commit`):

   ```bash
   #!/bin/bash
   # Reject commits with executable shell scripts
   if git diff --cached --name-only --diff-filter=ACM | xargs -I {} find {} -name "*.sh" -type f -perm +111 2>/dev/null | grep -q .; then
       echo "Error: Executable shell scripts detected. Remove executable bit:"
       git diff --cached --name-only --diff-filter=ACM | xargs -I {} find {} -name "*.sh" -type f -perm +111 2>/dev/null
       exit 1
   fi
   ```

2. **Make hook executable**:

   ```bash
   chmod +x .git/hooks/pre-commit
   ```

## Testing Coverage

Coverage collection works identically whether you use:

* `run_script` (recommended)
* `bash "$SCRIPT"` (explicit)
* `"$SCRIPT"` (traditional, requires executable bit)

All three patterns are properly instrumented by kcov.

## Migration Checklist

To migrate an existing project to non-executable scripts:

* [ ] Update BatsHelper (already done in this PR)
* [ ] Update test files to use `run_script` instead of `"$SCRIPT"`
* [ ] Run tests to verify everything works: `pnpm test`
* [ ] Remove executable bits: `find scripts -name "*.sh" -exec chmod -x {} \;`
* [ ] Verify coverage still works: check `coverage/index.html`
* [ ] Add pre-commit hook to enforce policy (optional)
* [ ] Update documentation and `CLAUDE.md` (optional)

## Troubleshooting

### Coverage not collecting

If coverage shows 0% after migration:

1. Verify kcov is installed: `kcov --version`
2. Check that you're using `run_script` or `bash "$SCRIPT"`, not just `"$SCRIPT"`
3. Clean and rebuild: `rm -rf coverage && pnpm test`
4. Check for errors in test output

### Tests failing with "Permission denied"

If tests fail with permission errors:

* You're likely using `"$SCRIPT"` directly instead of `run_script`
* Update test to use `run_script` or `bash "$SCRIPT"`

### Function not found: run_script

If you see "command not found: run_script":

* Regenerate BATS files by running tests
* Check that BatsHelper setup/teardown is in beforeAll/afterAll
* Verify you're using the updated BatsHelper version

## See Also

* [Testing Helpers API](testing-helpers.md) -- BatsHelper API reference
* [Docker Coverage](docker-coverage.md) -- Running kcov in Docker
* [CLAUDE.md](../CLAUDE.md) -- Project developer guide
