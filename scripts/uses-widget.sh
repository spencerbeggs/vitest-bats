#!/usr/bin/env bash
set -euo pipefail

# Calls a fictitious `widget-cli` binary multiple times. Used in mock tests
# where strict call counts matter — `widget-cli` is a name no coverage tool
# will internally invoke, so the recorder shim only sees the script's calls.

widget-cli init
widget-cli build --target=foo
widget-cli ship "release with spaces"
