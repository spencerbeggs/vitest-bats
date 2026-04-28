#!/usr/bin/env bash
set -euo pipefail

DECISION="approve"
REASON="default"

while [[ $# -gt 0 ]]; do
	case $1 in
		--decision)
			DECISION="${2}"
			shift 2
			;;
		--reason)
			REASON="${2}"
			shift 2
			;;
		*)
			echo "Unknown option: $1" >&2
			exit 1
			;;
	esac
done

printf '{"decision":"%s","reason":"%s"}\n' "$DECISION" "$REASON"
