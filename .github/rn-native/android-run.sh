#!/usr/bin/env bash
# Runs inside the emulator: install the release APK, launch, and read the app's marker lines from logcat.
set -eu
pkg=com.lucida.cinative
adb install -r example/android/app/build/outputs/apk/release/app-release.apk
adb logcat -c
adb logcat -v brief > logcat.txt &
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1
fail() { grep -E 'LUCIDA_|ReactNativeJS|AndroidRuntime' logcat.txt | tail -40 >&2 || true; exit 1; }
bash .github/rn-native/wait-for.sh logcat.txt LUCIDA_NATIVE_OK 120 || fail
[ -n "${LUCIDA_CI_KEY:-}" ] || { echo "::notice::LUCIDA_CI_KEY not set: native module check only"; exit 0; }
bash .github/rn-native/wait-for.sh logcat.txt "LUCIDA_SESSION " 120 || fail
grep -oE 'LUCIDA_SESSION [0-9a-f-]{36}' logcat.txt | tail -1 | cut -d' ' -f2 > session.txt
[ -s session.txt ] || { echo "app printed no session id" >&2; fail; }
