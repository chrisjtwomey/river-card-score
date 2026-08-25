#!/usr/bin/env bash
# Builds the APK on this machine, with no GitHub runner and no Android Studio.
#
# The first run downloads a JDK and the Android command line tools, the SDK
# platform, the build tools, CMake and the NDK: about 2 GB, into
# ~/Library/Android/sdk (macOS) or ~/Android/Sdk (Linux). Nothing needs sudo,
# and nothing is installed outside those folders and Homebrew.
#
#   android/tools/build-local.sh              # debug APK
#   android/tools/build-local.sh assembleRelease
#
# The APK carries a version in its name. Without one it says 'dev':
#   APP_VERSION=v0.2.0 android/tools/build-local.sh
#
# The APK lands in android/app/build/outputs/apk/.
set -euo pipefail

task="${1:-assembleDebug}"
here="$(cd "$(dirname "$0")" && pwd)"
android="$(dirname "$here")"
root="$(dirname "$android")"

case "$(uname -s)" in
  Darwin) sdk_default="$HOME/Library/Android/sdk"; tools_os=mac ;;
  *)      sdk_default="$HOME/Android/Sdk";         tools_os=linux ;;
esac
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$sdk_default}}"
CMDLINE_VERSION=13114758          # command line tools 17.0
GRADLE_VERSION=8.11.1

need() { command -v "$1" >/dev/null 2>&1; }

echo "==> a JDK"
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME:-}/bin/javac" ]; then
  if [ -x /opt/homebrew/opt/openjdk@17/bin/javac ]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@17
  elif [ -x /usr/local/opt/openjdk@17/bin/javac ]; then
    export JAVA_HOME=/usr/local/opt/openjdk@17
  elif need brew; then
    echo "    installing openjdk@17 with Homebrew"
    brew install --quiet openjdk@17
    export JAVA_HOME="$(brew --prefix openjdk@17)"
  else
    echo "no JDK 17. Install one and set JAVA_HOME." >&2
    exit 1
  fi
fi
echo "    $JAVA_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

echo "==> the Android SDK in $SDK"
sdkmanager="$SDK/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$sdkmanager" ]; then
  echo "    downloading the command line tools"
  mkdir -p "$SDK/cmdline-tools"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/tools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-${tools_os}-${CMDLINE_VERSION}_latest.zip"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$tmp"
fi
export ANDROID_HOME="$SDK"

# The versions here follow android/app/build.gradle: compileSdk and ndkVersion.
packages=(
  "platform-tools"
  "platforms;android-35"
  "build-tools;35.0.0"
  "cmake;3.22.1"
  "ndk;27.2.12479018"
)
missing=0
for p in "${packages[@]}"; do
  case "$p" in
    platform-tools)   [ -d "$SDK/platform-tools" ] || missing=1 ;;
    platforms*)       [ -d "$SDK/platforms/android-35" ] || missing=1 ;;
    build-tools*)     [ -d "$SDK/build-tools/35.0.0" ] || missing=1 ;;
    cmake*)           [ -d "$SDK/cmake/3.22.1" ] || missing=1 ;;
    ndk*)             [ -d "$SDK/ndk/27.2.12479018" ] || missing=1 ;;
  esac
done
if [ "$missing" = 1 ]; then
  echo "    installing the SDK packages (this is the 2 GB part)"
  yes | "$sdkmanager" --licenses >/dev/null 2>&1 || true
  "$sdkmanager" --install "${packages[@]}"
fi
echo "    ready"

echo "==> gradle"
if need gradle; then
  gradle_cmd=gradle
else
  gradle_home="$android/.cache/gradle-$GRADLE_VERSION"
  if [ ! -x "$gradle_home/bin/gradle" ]; then
    echo "    downloading gradle $GRADLE_VERSION"
    mkdir -p "$android/.cache"
    curl -fsSL -o "$android/.cache/gradle.zip" \
      "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
    unzip -q "$android/.cache/gradle.zip" -d "$android/.cache"
    rm -f "$android/.cache/gradle.zip"
  fi
  gradle_cmd="$gradle_home/bin/gradle"
fi
echo "    $gradle_cmd"

echo "==> the server's dependencies"
[ -d "$root/node_modules/ws" ] || (cd "$root" && npm install)

"$here/prepare.sh"

echo "==> $task"
cd "$android"
echo "sdk.dir=$SDK" > local.properties
"$gradle_cmd" --no-daemon "$task"

find "$android/app/build/outputs/apk" -name '*.apk' -print
echo "==> install it with: adb install -r <that file>"
