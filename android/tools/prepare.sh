#!/usr/bin/env bash
# Puts everything into android/app/ that is too big, or too generated, for git:
#   1. the node project -- the server, the pages and its two dependencies
#   2. libnode.so, the Node.js for Mobile shared library (about 60 MB)
# Run it before every Gradle build. The CI workflow runs it for you.
set -euo pipefail

NODE_MOBILE_VERSION="${NODE_MOBILE_VERSION:-18.20.4}"
here="$(cd "$(dirname "$0")" && pwd)"
android="$(dirname "$here")"
root="$(dirname "$android")"
project="$android/app/src/main/assets/nodejs-project"
libnode="$android/app/libnode"
cache="${NODE_MOBILE_CACHE:-$android/.cache}"

echo "==> the node project"
rm -rf "$project"
mkdir -p "$project/node_modules"
cp "$root/server.js" "$root/game.js" "$root/package.json" "$project/"
cp -R "$root/public" "$project/public"
# Only what the server requires. Both are pure JavaScript, so nothing here is
# built for the phone's architecture.
for dep in ws qrcode-generator; do
  if [ ! -d "$root/node_modules/$dep" ]; then
    echo "missing $root/node_modules/$dep -- run npm install first" >&2
    exit 1
  fi
  cp -R "$root/node_modules/$dep" "$project/node_modules/$dep"
done
# The phone has no certificate and no writable folder beside the project, so
# the service passes PORT, DATA_DIR and NO_TLS in the environment instead.
find "$project" -name '*.map' -delete
echo "    $(du -sh "$project" | cut -f1)"

echo "==> libnode.so $NODE_MOBILE_VERSION"
zip="$cache/nodejs-mobile-v$NODE_MOBILE_VERSION-android.zip"
if [ ! -f "$zip" ]; then
  mkdir -p "$cache"
  url="https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v$NODE_MOBILE_VERSION/nodejs-mobile-v$NODE_MOBILE_VERSION-android.zip"
  echo "    downloading $url"
  curl -fsSL -o "$zip.part" "$url"
  mv "$zip.part" "$zip"
fi
rm -rf "$libnode/bin" "$libnode/include"
mkdir -p "$libnode"
unzip -q "$zip" 'bin/*' 'include/*' -d "$libnode"
echo "    $(ls "$libnode/bin" | tr '\n' ' ')"

echo "==> ready. Now: cd $android && gradle assembleDebug"
