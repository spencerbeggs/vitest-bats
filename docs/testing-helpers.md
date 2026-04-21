# Testing Helpers API Reference

This document provides detailed documentation for the testing helper APIs available in the BatsHelper framework for testing shell scripts.

## Table of Contents

* [Overview](#overview)
* [script.mock() - Command Mocking](#scriptmock---command-mocking)
* [script.assert_json_value() - JSON Assertions](#scriptassert_json_value---json-assertions)
* [Advanced Usage](#advanced-usage)
* [Best Practices](#best-practices)
* [Implementation Details](#implementation-details)
* [Troubleshooting](#troubleshooting)

## Overview

The BatsHelper framework provides a fluent TypeScript API for writing BATS (Bash Automated Testing System) tests. This document focuses on two powerful testing helpers:

1. **`script.mock()`** - Create fake binaries with controlled responses
2. **`script.assert_json_value()`** - Assert JSON field values using dot notation

These helpers significantly improve test readability, maintainability, and reliability when testing shell scripts that interact with external commands and produce JSON output.

## script.mock() - Command Mocking

### Purpose

The `script.mock()` helper provides a declarative API for creating fake command-line binaries that respond to specific arguments. This is essential for testing scripts that depend on external tools (like package managers, CLI utilities, etc.) without requiring those tools to be installed or executing their actual implementations.

### Signature

```typescript
script.mock(
  command: string,
  config: Record<string, string | Record<string, string>>
): this
```

### Parameters

* **`command`** (string): The name of the command to mock (e.g., `"npm"`, `"git"`, `"docker"`)
* **`config`** (object): Configuration object defining command responses
  * Keys: Command-line arguments or flags (e.g., `"--version"`, `"status"`)
  * Values: Either:
    * **String**: Direct response to output when the argument matches
    * **Object**: Nested commands for sub-command patterns (see [Nested Commands](#nested-commands))

### Basic Usage

#### Simple Command Mock

Mock a command with a single argument:

```typescript
helper.test("checks version", (script) => {
  // Mock the 'git' command to respond to --version
  script.mock("git", {
    "--version": "git version 2.39.0"
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run git --version");
  script.assert_success();
  script.assert_output({ partial: "2.39.0" });
});
```

#### Multiple Arguments

Mock multiple independent arguments:

```typescript
helper.test("handles multiple flags", (script) => {
  script.mock("myapp", {
    "--version": "1.0.0",
    "--help": "Usage: myapp [options]",
    "status": "Running"
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run myapp --version");
  script.assert_output({ partial: "1.0.0" });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run myapp status");
  script.assert_output({ partial: "Running" });
});
```

### Nested Commands

For commands with sub-commands (like `npm config get prefix`), use nested objects:

```typescript
helper.test("mocks nested config commands", (script) => {
  script.mock("npm", {
    "--version": "10.2.3",
    config: {
      "get prefix": "/usr/local",
      "get cache": "/tmp/npm-cache",
      "get registry": "https://registry.npmjs.org"
    }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run npm config get prefix");
  script.assert_output({ partial: "/usr/local" });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run npm config get cache");
  script.assert_output({ partial: "/tmp/npm-cache" });
});
```

### How It Works

When you call `script.mock("command", config)`, the helper:

1. **Creates a `fake-bin/` directory** in the test's temporary workspace
2. **Generates a bash script** named after the command with a case statement structure
3. **Makes the script executable** (`chmod +x`)
4. **Returns `this`** for method chaining

The generated bash script uses pattern matching to respond to arguments:

```bash
#!/bin/bash
case "$1" in
  --version) echo "10.2.3" ;;
  config)
    case "$2 $3" in
      "get prefix") echo "/usr/local" ;;
      "get cache") echo "/tmp/npm-cache" ;;
    esac
    ;;
esac
```

### PATH Manipulation

To use the mocked command, prepend `$PWD/fake-bin` to the PATH:

```typescript
// The fake binary takes precedence over system binaries
script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
```

### Real-World Examples

#### Package Manager Detection

```typescript
helper.test("detects pnpm with full configuration", (script) => {
  script.mock("pnpm", {
    "--version": "9.5.0",
    config: {
      "get global-dir": "/home/user/.pnpm/global",
      "get global-bin-dir": "/home/user/.pnpm",
      "get store-dir": "/home/user/.pnpm-store"
    },
    store: {
      "path": "/home/user/.pnpm-store"
    }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.assert_json_value("pnpm.available", true);
  script.assert_json_value("pnpm.version", "9.5.0");
  script.assert_json_value("pnpm.store_dir", "/home/user/.pnpm-store");
});
```

#### Git Operations

```typescript
helper.test("mocks git status and branch", (script) => {
  script.mock("git", {
    "status": "On branch main\nnothing to commit",
    "branch": "* main\n  feature/new-api",
    "rev-parse": {
      "--show-toplevel": "/home/user/project",
      "HEAD": "abc123def456"
    }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run git status");
  script.assert_output({ partial: "nothing to commit" });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run git rev-parse --show-toplevel");
  script.assert_output({ partial: "/home/user/project" });
});
```

#### Docker Commands

```typescript
helper.test("mocks docker inspect", (script) => {
  script.mock("docker", {
    "version": "Docker version 24.0.0",
    inspect: {
      "container-name": '{"State": {"Running": true}}',
      "image-name": '{"Config": {"Env": ["PATH=/usr/bin"]}}'
    }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.raw("run docker inspect container-name");
  script.assert_json_value("State.Running", true);
});
```

### Limitations

* **Pattern Matching**: Uses bash case statements, which match `$1`, `$2 $3` patterns
  * More complex argument parsing (flags in any order, long options with `=`) is not supported
  * For complex scenarios, consider using `script.raw()` to create custom bash scripts
* **Single Response**: Each pattern returns one static response
  * Cannot simulate stateful behavior or different responses on repeated calls
* **Positional Arguments**: Sub-commands match `$2 $3` as a single pattern
  * `"get prefix"` matches when `$2="get"` and `$3="prefix"`

### When to Use script.mock()

✅ **Use `script.mock()`** when:

* Testing scripts that call external CLI tools
* You need controlled, predictable responses
* Testing different versions or configurations
* Simulating scenarios that are difficult to reproduce (errors, edge cases)
* Isolating tests from external dependencies

❌ **Don't use `script.mock()`** when:

* Testing the actual implementation of the command itself
* You need stateful behavior across multiple invocations
* Complex argument parsing is required (use `script.raw()` instead)
* The real command execution is fast and reliable

## script.assert_json_value() - JSON Assertions

### Purpose

The `script.assert_json_value()` helper provides a clean, type-safe API for asserting specific values in JSON output using dot notation paths. It uses `jq` for reliable JSON parsing, avoiding the pitfalls of regex-based assertions on multiline JSON.

### Signature

```typescript
script.assert_json_value(
  path: string,
  expected: string | number | boolean | null
): this
```

### Parameters

* **`path`** (string): Dot-separated path to the JSON field (e.g., `"user.name"`, `"config.settings.enabled"`)
* **`expected`** (string | number | boolean | null): Expected value to assert

### Supported Value Types

| Type | Example | Notes |
| ---- | ------- | ----- |
| **String** | `"10.2.3"`, `"/usr/local"` | Any string value |
| **Number** | `42`, `3.14`, `0` | Integers and floats |
| **Boolean** | `true`, `false` | JSON boolean values |
| **Null** | `null` | JSON null value |

### Basic Usage

```typescript
helper.test("validates JSON output", (script) => {
  script.flags("--json");
  script.assert_success();

  // Boolean assertions
  script.assert_json_value("npm.available", true);
  script.assert_json_value("pnpm.available", false);

  // String assertions
  script.assert_json_value("npm.version", "10.2.3");
  script.assert_json_value("npm.path", "/usr/local/bin/npm");

  // Number assertions
  script.assert_json_value("summary.total_available", 2);
  script.assert_json_value("summary.count", 0);

  // Null assertions
  script.assert_json_value("npm.config_file", null);
  script.assert_json_value("error", null);
});
```

### Path Notation

Use dot notation to traverse nested JSON structures:

```json
{
  "user": {
    "name": "Alice",
    "profile": {
      "age": 30,
      "active": true
    }
  },
  "settings": {
    "theme": null
  }
}
```

```typescript
script.assert_json_value("user.name", "Alice");
script.assert_json_value("user.profile.age", 30);
script.assert_json_value("user.profile.active", true);
script.assert_json_value("settings.theme", null);
```

### How It Works

1. **Converts path to jq syntax**: `"npm.version"` → `".npm.version"`
2. **Extracts the value** using `jq -r` (raw output mode)
3. **Compares with expected** value using bash string comparison
4. **Generates error message** showing expected vs actual on mismatch

Generated bash code:

```bash
actual=$(echo "$output" | jq -r '.npm.version')
if [ "$actual" != "10.2.3" ]; then
  echo "Expected JSON path 'npm.version' to equal '10.2.3', got: $actual"
  return 1
fi
```

### Real-World Examples

#### Package Manager Detection

```typescript
helper.test("validates complete package manager info", (script) => {
  script.mock("npm", {
    "--version": "10.2.3",
    config: {
      "get prefix": "/usr/local",
      "get cache": "/tmp/npm-cache"
    }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.flags("--json");
  script.assert_success();

  // Validate npm object
  script.assert_json_value("npm.available", true);
  script.assert_json_value("npm.version", "10.2.3");
  script.assert_json_value("npm.global_dir", "/usr/local/lib/node_modules");
  script.assert_json_value("npm.global_bin_dir", "/usr/local/bin");
  script.assert_json_value("npm.cache_dir", "/tmp/npm-cache");
  script.assert_json_value("npm.config_file", null);

  // Validate other package managers are not available
  script.assert_json_value("pnpm.available", false);
  script.assert_json_value("yarn.available", false);
  script.assert_json_value("bun.available", false);

  // Validate summary
  script.assert_json_value("summary.any_package_manager_available", true);
  script.assert_json_value("summary.total_available", 1);
  script.assert_json_value("summary.preferred", "npm");
});
```

#### Configuration Validation

```typescript
helper.test("validates configuration structure", (script) => {
  script.flags("--export-config");
  script.assert_success();

  // Validate config structure
  script.assert_json_value("version", "1.0.0");
  script.assert_json_value("settings.debug", false);
  script.assert_json_value("settings.verbosity", 2);
  script.assert_json_value("paths.root", "/app");
  script.assert_json_value("features.experimental", null);
});
```

#### Error Handling

```typescript
helper.test("handles errors gracefully", (script) => {
  script.env({ PATH: "/usr/bin:/bin" });
  script.flags("--json");
  script.assert_success(); // Script exits 0 but reports errors

  script.assert_json_value("status", "error");
  script.assert_json_value("error.code", 404);
  script.assert_json_value("error.message", "Command not found");
  script.assert_json_value("error.recoverable", true);
});
```

### Comparison with Other Assertion Methods

#### vs. `script.assert_output({ regexp })`

**Before** (regex - fragile with multiline JSON):

```typescript
script.assert_output({ regexp: '"npm".*"available": true' });
script.assert_output({ regexp: '"npm".*"version": "10.2.3"' });
```

**Problems**:

* `.*` doesn't match newlines in standard grep
* Matches anywhere in output (false positives)
* No type checking (could match `"available": "true"` as string)
* Poor error messages

**After** (`assert_json_value` - reliable):

```typescript
script.assert_json_value("npm.available", true);
script.assert_json_value("npm.version", "10.2.3");
```

**Benefits**:

* ✅ Proper JSON parsing with `jq`
* ✅ Type-safe comparisons
* ✅ Clear error messages: `Expected JSON path 'npm.version' to equal '10.2.3', got: 9.0.0`
* ✅ Works with any JSON formatting

#### vs. `script.assert_output({ partial })`

**Use `assert_json_value`** when:

* Testing JSON output
* Need exact value matching
* Type matters (boolean vs string)

**Use `partial`** when:

* Testing non-JSON output
* Need substring matching
* Testing formatted/pretty output

```typescript
// JSON output - use assert_json_value
script.assert_json_value("status", "success");

// Pretty output - use partial
script.assert_output({ partial: "✅ Success" });

// Log messages - use partial
script.assert_output({ partial: "Processing file: data.json" });
```

### Error Messages

When assertions fail, you get clear, actionable error messages:

```bash
# String mismatch
Expected JSON path 'npm.version' to equal '10.2.3', got: 9.5.0

# Type mismatch
Expected JSON path 'npm.available' to equal 'true', got: false

# Null vs value
Expected JSON path 'error' to equal 'null', got: Command not found

# Missing field
Expected JSON path 'npm.config_file' to equal 'null', got: null
```

### Limitations

* **Dot notation only**: Does not support array indices (e.g., `items[0].name`)
  * Use `jq` directly via `script.raw()` for array access
* **Flat path syntax**: Cannot handle keys with dots in their names
  * Use `jq` with bracket notation for keys like `"my.key"`: `script.raw('[ "$(echo "$output" | jq -r ".[\\"my.key\\"]")" = "value" ]')`
* **String comparison**: All values are compared as strings after `jq -r` extraction
  * This usually works correctly but may have edge cases with special characters

### When to Use script.assert_json_value()

✅ **Use `script.assert_json_value()`** when:

* Script outputs JSON
* Testing specific field values
* Need exact value matching
* Type-safe assertions matter
* Clear error messages are important

❌ **Don't use `script.assert_json_value()`** when:

* Output is not JSON
* Testing output format/structure (use `partial` or `regexp`)
* Need array access (use `script.raw()` with custom `jq`)
* Testing pretty/formatted output

## Advanced Usage

### Combining Mock and JSON Assertions

```typescript
helper.test("complete integration test", (script) => {
  // Mock multiple package managers
  script.mock("npm", {
    "--version": "10.2.3",
    config: {
      "get prefix": "/usr/local",
      "get cache": "/tmp/npm-cache"
    }
  });

  script.mock("pnpm", {
    "--version": "9.5.0",
    config: {
      "get global-dir": "/home/user/.pnpm/global",
      "get store-dir": "/home/user/.pnpm-store"
    }
  });

  // Run script with mocked commands in PATH
  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.flags("--json");
  script.assert_success();

  // Validate JSON output with precise assertions
  script.assert_json_value("npm.available", true);
  script.assert_json_value("npm.version", "10.2.3");
  script.assert_json_value("pnpm.available", true);
  script.assert_json_value("pnpm.version", "9.5.0");
  script.assert_json_value("summary.total_available", 2);
  script.assert_json_value("summary.preferred", "npm"); // npm preferred over pnpm
});
```

### Testing Error Scenarios

```typescript
helper.test("handles invalid version format", (script) => {
  // Mock command with unexpected output
  script.mock("myapp", {
    "--version": "invalid-version-string"
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.flags("--json");
  script.assert_success(); // Script doesn't crash

  // Validate error is reported
  script.assert_json_value("myapp.available", true);
  script.assert_json_value("myapp.version", null);
  script.assert_json_value("error.message", "Could not parse version");
});
```

### Testing Multiple Configurations

```typescript
helper.test("detects yarn v1", (script) => {
  script.mock("yarn", {
    "--version": "1.22.19",
    global: { dir: "/usr/local/yarn" }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.flags("--json");
  script.assert_json_value("yarn.major_version", "1");
});

helper.test("detects yarn v2+", (script) => {
  script.mock("yarn", {
    "--version": "4.0.2",
    config: {
      "get globalFolder": "/home/user/.yarn/berry"
    }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.flags("--json");
  script.assert_json_value("yarn.major_version", "2+");
});
```

### Custom JSON Paths

For complex JSON structures with deeply nested values:

```typescript
helper.test("validates nested configuration", (script) => {
  script.flags("--export-config");

  // Deep nesting
  script.assert_json_value("server.database.connection.host", "localhost");
  script.assert_json_value("server.database.connection.port", 5432);
  script.assert_json_value("server.database.connection.ssl", true);

  // Multiple levels
  script.assert_json_value("features.experimental.newApi.enabled", false);
  script.assert_json_value("features.experimental.newApi.version", "0.1.0");
});
```

## Best Practices

### 1. Use Meaningful Test Names

```typescript
// ✅ Good - describes what is being tested
helper.test("detects npm when installed with valid version", (script) => {

// ❌ Bad - vague or implementation-focused
helper.test("test npm detection", (script) => {
helper.test("calls npm --version", (script) => {
```

### 2. Group Related Assertions

```typescript
helper.test("validates complete npm configuration", (script) => {
  script.mock("npm", {
    "--version": "10.2.3",
    config: {
      "get prefix": "/usr/local",
      "get cache": "/tmp/npm-cache"
    }
  });

  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.flags("--json");
  script.assert_success();

  // Group by logical sections
  // Basic properties
  script.assert_json_value("npm.available", true);
  script.assert_json_value("npm.version", "10.2.3");

  // Paths
  script.assert_json_value("npm.global_bin_dir", "/usr/local/bin");
  script.assert_json_value("npm.cache_dir", "/tmp/npm-cache");

  // Config
  script.assert_json_value("npm.config_file", null);
});
```

### 3. Test Both Success and Failure Cases

```typescript
helper.test("reports npm as available when found", (script) => {
  script.mock("npm", { "--version": "10.0.0" });
  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.flags("--json");
  script.assert_json_value("npm.available", true);
});

helper.test("reports npm as unavailable when not in PATH", (script) => {
  script.env({ PATH: "/usr/bin:/bin" });
  script.flags("--json");
  script.assert_json_value("npm.available", false);
  script.assert_json_value("npm.version", null);
});
```

### 4. Use Specific Assertions

```typescript
// ✅ Good - specific and clear
script.assert_json_value("status", "success");
script.assert_json_value("count", 5);

// ❌ Bad - too broad, could match unintended output
script.assert_output({ partial: "success" }); // Could match "unsuccessful"
script.assert_output({ regexp: "count.*5" }); // Could match "countdown: 5"
```

### 5. Mock Realistically

```typescript
// ✅ Good - realistic versions and paths
script.mock("npm", {
  "--version": "10.2.3",
  config: {
    "get prefix": "/usr/local",
    "get cache": "/home/user/.npm"
  }
});

// ❌ Bad - unrealistic values that might hide bugs
script.mock("npm", {
  "--version": "999.999.999",
  config: {
    "get prefix": "/fake/path/that/doesnt/exist"
  }
});
```

### 6. Keep Tests Independent

```typescript
// ✅ Good - each test is self-contained
helper.test("test A", (script) => {
  script.mock("cmd", { "--flag": "value1" });
  # run() called implicitly
});

helper.test("test B", (script) => {
  script.mock("cmd", { "--flag": "value2" });
  # run() called implicitly
});

// ❌ Bad - tests depend on shared state
let sharedMock;
helper.test("test A", (script) => {
  sharedMock = { "--flag": "value1" };
  // ...
});
```

### 7. Document Complex Mocks

```typescript
helper.test("handles corepack-managed yarn", (script) => {
  // Yarn v1 uses 'global' and 'cache' commands
  // Yarn v2+ uses 'config get' commands
  // This mocks Yarn v1.22.19 with classic structure
  script.mock("yarn", {
    "--version": "1.22.19",
    global: {
      dir: "/usr/local/yarn/global",
      bin: "/usr/local/bin"
    },
    cache: {
      dir: "/tmp/yarn-cache"
    }
  });

  // COREPACK_ENABLE_STRICT=0 prevents corepack from managing yarn
  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin", COREPACK_ENABLE_STRICT: "0" });
  script.assert_json_value("yarn.major_version", "1");
});
```

## Implementation Details

### Generated Bash Scripts

When you call `script.mock("npm", config)`, the helper generates a bash script at `fake-bin/npm`:

```bash
#!/bin/bash
case "$1" in
  --version) echo "10.2.3" ;;
  config)
    case "$2 $3" in
      "get prefix") echo "/usr/local" ;;
      "get cache") echo "/tmp/npm-cache" ;;
    esac
    ;;
esac
```

**Key points**:

* Uses POSIX-compliant bash
* Simple case statement pattern matching
* No state between invocations
* Fast execution (no actual command logic)

### JSON Assertion Implementation

The `script.assert_json_value()` method generates bash code that:

1. Extracts the value using `jq -r` (raw mode, unquoted strings)
2. Compares using bash string comparison `[ "$actual" != "expected" ]`
3. Returns error code 1 with descriptive message on mismatch

```bash
actual=$(echo "$output" | jq -r '.npm.version')
if [ "$actual" != "10.2.3" ]; then
  echo "Expected JSON path 'npm.version' to equal '10.2.3', got: $actual"
  return 1
fi
```

**Why `jq -r`?**

* Removes JSON quotes from strings (`"value"` → `value`)
* Outputs `true`/`false`/`null` as literal strings
* Consistent format for bash string comparison

### TypeScript to BATS Translation

The fluent API calls are translated to BATS test code:

```typescript
// TypeScript
helper.test("validates npm", (script) => {
  script.mock("npm", { "--version": "10.2.3" });
  script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });
  script.assert_success();
  script.assert_json_value("npm.version", "10.2.3");
});
```

```bash
# Generated BATS
@test "validates npm" {
  mkdir -p fake-bin
  cat > fake-bin/npm <<'EOF'
#!/bin/bash
case "$1" in
  --version) echo "10.2.3" ;;
esac
EOF
  chmod +x fake-bin/npm
  run env PATH="$PWD/fake-bin:/usr/bin:/bin" "$SCRIPT"
  assert_success
  actual=$(echo "$output" | jq -r '.npm.version')
  if [ "$actual" != "10.2.3" ]; then
    echo "Expected JSON path 'npm.version' to equal '10.2.3', got: $actual"
    return 1
  fi
}
```

## Troubleshooting

### script.mock() Issues

#### Mock Not Being Used

**Problem**: Script still uses system command instead of mock.

**Solution**: Ensure `fake-bin` is first in PATH:

```typescript
// ✅ Correct - fake-bin first
script.env({ PATH: "$PWD/fake-bin:/usr/bin:/bin" });

// ❌ Wrong - system paths first
script.env({ PATH: "/usr/bin:$PWD/fake-bin:/bin" });
```

#### Mock Not Responding to Arguments

**Problem**: Mock returns no output for specific arguments.

**Debug**:

1. Check the generated `.bats` file in `.cache/`
2. Verify the case statement pattern matches your usage
3. Test the mock directly:

   ```typescript
   script.raw('./fake-bin/npm --version'); // Should output expected value
   ```

**Common issues**:

* Case sensitivity: `--Version` vs `--version`
* Extra whitespace: `"get  prefix"` vs `"get prefix"`
* Argument order: Config expects `$2 $3` pattern

#### Mock Script Not Executable

**Problem**: Permission denied when running mock.

**Solution**: This should never happen (automatic `chmod +x`), but verify:

```typescript
script.raw('[ -x fake-bin/npm ]'); // Should pass
```

### script.assert_json_value() Issues

#### "jq: command not found"

**Problem**: `jq` is not installed in the test environment.

**Solution**:

* **Docker**: Ensure `jq` is in the Docker image (it's included in `Dockerfile.test`)
* **Local**: Install `jq`: `brew install jq` (macOS) or `apt-get install jq` (Linux)

#### Assertion Fails with Correct Value

**Problem**: Test shows correct value but still fails.

**Common causes**:

1. **Whitespace differences**:

   ```bash
   Expected: "10.2.3"
   Got: "10.2.3 " # Trailing space
   ```

2. **Type mismatch**:

   ```bash
   Expected: "true" (boolean)
   Got: "\"true\"" (string) # Script outputs JSON string instead of boolean
   ```

3. **JSON path incorrect**:

   ```bash
   Expected path: 'npm.version'
   Actual path in JSON: 'npm.ver' # Typo in script output
   ```

**Debug**:

```typescript
// Add raw output check
script.raw('echo "$output"'); // Prints JSON to test output
script.raw('echo "$output" | jq .npm.version'); // Shows what jq extracts
```

#### Path with Dots Not Working

**Problem**: JSON key contains a dot (e.g., `"my.key": "value"`).

**Solution**: Use custom `jq` with bracket notation:

```typescript
// Instead of this (won't work):
script.assert_json_value("my.key", "value");

// Use this:
script.raw('actual=$(echo "$output" | jq -r ".[\\"my.key\\"]")');
script.raw('[ "$actual" = "value" ]');
```

#### Array Access Not Supported

**Problem**: Need to assert array element value.

**Solution**: Use custom `jq` query:

```typescript
// JSON: {"items": [{"name": "first"}, {"name": "second"}]}

// Instead of this (not supported):
script.assert_json_value("items[0].name", "first");

// Use this:
script.raw('actual=$(echo "$output" | jq -r ".items[0].name")');
script.raw('[ "$actual" = "first" ]');

// Or create a custom helper:
script.raw('count=$(echo "$output" | jq ".items | length")');
script.raw('[ "$count" = "2" ]');
```

### General Test Issues

#### Tests Pass Locally, Fail in Docker

**Problem**: Different environments have different behavior.

**Common causes**:

* Different default PATH values
* Different HOME directory locations
* Different temporary directory locations

**Solution**: Use environment variables consistently:

```typescript
// Use $HOME, $PWD, not hardcoded paths
script.raw('mkdir -p "$HOME/.config"');
script.raw('cd "$PWD/workspace"');

// Not: mkdir -p /root/.config
```

#### Test Output Shows Wrong JSON

**Problem**: `$output` variable contains unexpected JSON.

**Debug steps**:

1. Print the actual output:

   ```typescript
   script.raw('echo "=== OUTPUT START ==="');
   script.raw('echo "$output"');
   script.raw('echo "=== OUTPUT END ==="');
   ```

2. Check if output is valid JSON:

   ```typescript
   script.raw('echo "$output" | jq . > /dev/null 2>&1 || echo "Invalid JSON"');
   ```

3. Verify command execution:

   ```typescript
   script.raw('echo "Exit code: $status"');
   ```

#### Mock Persists Across Tests

**Problem**: Mock from one test affects another test.

**Solution**: This shouldn't happen - each test gets its own `$TEST_DIR` with fresh `fake-bin/`. If it does:

1. Check that tests are truly independent (no shared state)
2. Verify `teardown()` is cleaning up properly
3. Check for environment variable pollution

## Additional Resources

* [Non-Executable Scripts](non-executable-scripts.md) -- Testing scripts without
  the executable bit
* [Docker Coverage](docker-coverage.md) -- Running kcov in Docker
* [BatsHelper source](../package/src/vitest-kcov-bats-helper.ts) -- Implementation
  details
* [BATS documentation](https://bats-core.readthedocs.io/) -- BATS framework
  reference
* [jq documentation](https://stedolan.github.io/jq/) -- jq command-line JSON
  processor

## Contributing

When adding new testing helpers:

1. **Add to BatsHelper class** in `package/src/vitest-kcov-bats-helper.ts`
2. **Return `this`** for method chaining
3. **Generate POSIX-compliant bash** (avoid bash-specific features when possible)
4. **Add comprehensive documentation** with examples
5. **Create example tests** demonstrating usage
6. **Update this document** with the new helper's API reference

## License

MIT
