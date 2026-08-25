#!/usr/bin/env bash
# Puts the server and the pages onto the phone without building an APK.
#
# A change under public/ needs nothing else: the app's node runs with DEV=1 on
# a debug build, so it watches its own files and every open screen reloads
# itself. A change to server.js, game.js or a dependency needs the runtime
# restarted, and this script does that too.
#
#   android/tools/push-dev.sh            # push, and restart only if it must
#   android/tools/push-dev.sh --restart  # push and restart anyway
#
# It works on a debug build only, because it uses run-as to write into the
# app's own folder. Native code -- the Java, the manifest, chooser.html --
# still needs build-local.sh.
set -euo pipefail

pkg=com.chrisjtwomey.rivertable
here="$(cd "$(dirname "$0")" && pwd)"
android="$(dirname "$here")"
project="$android/app/src/main/assets/nodejs-project"
stamp="$android/.cache/push-stamp"
force_restart=0
[ "${1:-}" = "--restart" ] && force_restart=1

command -v adb >/dev/null || { echo "no adb. brew install --cask android-platform-tools" >&2; exit 1; }
[ -n "$(adb devices | awk 'NR>1 && $2=="device"')" ] || { echo "no phone. Plug it in and allow this computer." >&2; exit 1; }
adb shell run-as "$pkg" true 2>/dev/null || {
  echo "run-as was refused: this is not a debug build of $pkg." >&2
  echo "Install one with android/tools/build-local.sh." >&2
  exit 1
}

"$here/prepare.sh" >/dev/null

# Anything outside public/ is the runtime's own code, and node reads that once.
# prepare.sh rewrites every file each run, so the times say nothing: the
# question is whether the bytes changed.
runtime_sum() {
  find "$project" -type f -not -path "$project/public/*" -exec shasum {} + | sort | shasum | cut -d' ' -f1
}
restart=$force_restart
sum="$(runtime_sum)"
if [ "$restart" = 0 ]; then
  [ ! -f "$stamp" ] && restart=1
  [ -f "$stamp" ] && [ "$(cat "$stamp")" != "$sum" ] && restart=1
fi

echo "==> pushing the node project"
tar czf "$android/.cache/push.tgz" -C "$project" .
adb push -q "$android/.cache/push.tgz" /data/local/tmp/rivertable-push.tgz >/dev/null
adb shell run-as "$pkg" mkdir -p files/nodejs-project
adb shell run-as "$pkg" tar xzf /data/local/tmp/rivertable-push.tgz -C files/nodejs-project
adb shell rm -f /data/local/tmp/rivertable-push.tgz
mkdir -p "$android/.cache" && printf '%s' "$sum" > "$stamp"
rm -f "$android/.cache/push.tgz"

if [ "$restart" = 1 ]; then
  echo "==> restarting the runtime (server.js, game.js or a dependency changed)"
  adb shell am force-stop "$pkg"
  adb shell am start -n "$pkg/.MainActivity" --ez host true >/dev/null
  echo "    the table is coming back up. adb logcat -s UpTheRiver-node UpTheRiver"
else
  echo "==> pages only: every open screen reloads itself"
fi
