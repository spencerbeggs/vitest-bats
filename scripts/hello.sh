#!/usr/bin/env bash
set -euo pipefail

NAME="World"
FORMAT="text"

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

if [ "$FORMAT" = "json" ]; then
	printf '{"greeting":"Hello %s"}\n' "$NAME"
else
	echo "Hello $NAME"
fi
