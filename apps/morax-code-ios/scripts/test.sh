#!/usr/bin/env bash
# Package tests, then the app's tests on an iPhone and an iPad simulator.
# Override the devices with IPHONE_SIM / IPAD_SIM (simulator names).
set -euo pipefail
cd "$(dirname "$0")/.."
IPHONE_SIM="${IPHONE_SIM:-iPhone 18 Pro}"
IPAD_SIM="${IPAD_SIM:-iPad Pro 11-inch (M5)}"

(cd Packages/MoraxWire && swift test)
xcodegen generate --quiet
for device in "$IPHONE_SIM" "$IPAD_SIM"; do
  echo "== $device"
  xcodebuild test -project MoraxCode.xcodeproj -scheme MoraxCode \
    -destination "platform=iOS Simulator,name=$device" -quiet
done
