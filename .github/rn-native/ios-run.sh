#!/usr/bin/env bash
# Boots a simulator, installs the Release .app, launches, and reads the app's marker lines from the unified log.
set -eu
udid=$(xcrun simctl list devices available | grep -m1 'iPhone' | grep -oE '[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}')
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b
app=$(ls -d example/ios/build/Build/Products/Release-iphonesimulator/*.app | head -1)
xcrun simctl install "$udid" "$app"
xcrun simctl spawn "$udid" log stream --style compact --predicate 'eventMessage CONTAINS "LUCIDA_"' > simlog.txt &
sleep 3
xcrun simctl launch "$udid" com.lucida.cinative
fail() { tail -40 simlog.txt >&2 || true; exit 1; }
bash .github/rn-native/wait-for.sh simlog.txt LUCIDA_NATIVE_OK 120 || fail
[ -n "${LUCIDA_CI_KEY:-}" ] || { echo "::notice::LUCIDA_CI_KEY not set: native module check only"; exit 0; }
bash .github/rn-native/wait-for.sh simlog.txt "LUCIDA_SESSION " 120 || fail
grep -oE 'LUCIDA_SESSION [0-9a-f-]{36}' simlog.txt | tail -1 | cut -d' ' -f2 > session.txt
[ -s session.txt ] || { echo "app printed no session id" >&2; fail; }
