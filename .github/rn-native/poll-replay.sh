#!/usr/bin/env bash
# poll-replay.sh SESSION_ID: waits for the session's replay to show up in the Lucida API with at least one readable chunk.
# Needs env LUCIDA_CI_API_KEY and LUCIDA_CI_PROJECT; the key reaches curl on stdin only, never argv.
set -u
sid=$1 host=${LUCIDA_CI_API_HOST:-https://lucidace.com}
base="$host/v1/projects/$LUCIDA_CI_PROJECT/replays/$sid"
get() { printf 'header = "Authorization: Bearer %s"\n' "$LUCIDA_CI_API_KEY" | curl -sS -K - -o "$1" -w '%{http_code}' "$2"; }
for i in $(seq 20); do
  code=$(get detail.json "$base")
  seq=$(python3 -I -c 'import json,sys
c=json.load(open("detail.json")).get("chunks") or []
print(c[0]["seq"] if c else "")' 2>/dev/null)
  if [ "$code" = 200 ] && [ -n "$seq" ]; then
    code=$(get chunk.bin "$base/chunks/$seq")
    [ "$code" = 200 ] && [ -s chunk.bin ] && { echo "replay $sid has chunk $seq ($(wc -c < chunk.bin) bytes)"; exit 0; }
  fi
  echo "attempt $i: not ready (HTTP $code)"; sleep 15
done
echo "no replay chunk for session $sid after 5 minutes" >&2
exit 1
