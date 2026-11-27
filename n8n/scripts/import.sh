#!/usr/bin/env sh
# Run inside the intended n8n runtime, after backing up an existing profile.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v n8n >/dev/null
stage=$(mktemp -d)
trap 'find "$stage" -maxdepth 1 -type f -delete; rmdir "$stage"' EXIT
find "$root/workflows" -type f -name '*.json' -exec cp '{}' "$stage/" \;
n8n import:workflow --separate --input="$stage" "$@"
