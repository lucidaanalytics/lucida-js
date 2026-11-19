#!/usr/bin/env bash
# wait-for.sh FILE PATTERN SECONDS: succeeds as soon as PATTERN (fixed string) appears in FILE.
f=$1 p=$2 t=$3
for _ in $(seq "$t"); do grep -qF -- "$p" "$f" 2>/dev/null && exit 0; sleep 1; done
echo "timed out after ${t}s waiting for $p" >&2
exit 1
