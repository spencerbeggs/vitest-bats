#!/usr/bin/env bash
set -euo pipefail

URL=$(git remote get-url origin)
echo "remote: $URL"
