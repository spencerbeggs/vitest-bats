#!/usr/bin/env bash
set -euo pipefail

FORMAT="json"
VERBOSE=0

while [[ $# -gt 0 ]]; do
	case $1 in
		--pretty)
			FORMAT="pretty"
			shift
			;;
		--verbose|-v)
			VERBOSE=1
			shift
			;;
		--help|-h)
			echo "Usage: sysinfo.sh [OPTIONS]"
			echo ""
			echo "Options:"
			echo "  --pretty     Human-readable output"
			echo "  --help, -h   Show this help"
			exit 0
			;;
		*)
			echo "Error: Unknown option: $1" >&2
			exit 1
			;;
	esac
done

HOSTNAME_VAL=$(hostname)
OS_TYPE=$(uname -s)
CURRENT_DATE=$(date -u +"%Y-%m-%d")

if [ "$VERBOSE" -eq 1 ]; then
	echo "[DEBUG] Gathering system info..." >&2
	echo "[DEBUG] Format: $FORMAT" >&2
fi

if [ "$FORMAT" = "pretty" ]; then
	echo "System Information"
	echo "=================="
	echo "Hostname: $HOSTNAME_VAL"
	echo "OS Type: $OS_TYPE"
	echo "Date: $CURRENT_DATE"
else
	printf '{"hostname":"%s","os_type":"%s","date":"%s"}\n' "$HOSTNAME_VAL" "$OS_TYPE" "$CURRENT_DATE"
fi
