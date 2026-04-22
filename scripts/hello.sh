#!/usr/bin/env bash
set -euo pipefail

NAME="World"
FORMAT="text"
VERBOSE=0

log_debug() {
	local timestamp
	timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
	echo "[DEBUG $timestamp] $1" >&2
}

while [[ $# -gt 0 ]]; do
	case $1 in
		--name)
			NAME="${2:?Error: --name requires a value}"
			shift 2
			;;
		--json)
			FORMAT="json"
			shift
			;;
		--verbose|-v)
			VERBOSE=1
			shift
			;;
		--help|-h)
			echo "Usage: hello.sh [OPTIONS]"
			echo ""
			echo "Options:"
			echo "  --name <name>  Name to greet (default: World)"
			echo "  --json         Output as JSON"
			echo "  --help, -h     Show this help"
			exit 0
			;;
		*)
			echo "Error: Unknown option: $1" >&2
			exit 1
			;;
	esac
done

if [ "$VERBOSE" -eq 1 ]; then
	log_debug "Format: $FORMAT, Name: $NAME"
fi

if [ "$FORMAT" = "json" ]; then
	printf '{"greeting":"Hello %s"}\n' "$NAME"
else
	echo "Hello $NAME"
fi
