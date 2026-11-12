#!/usr/bin/env bash
# Archives a Release build of Morax Code (iPhone + iPad) for TestFlight. The build number is the
# commit count of HEAD, so every upload is strictly increasing without editing project.yml.
#
#   scripts/archive.sh            archive only
#   scripts/archive.sh --upload   archive + export + upload to App Store Connect
#
# Signing uses an App Store Connect team API key (works from a non-interactive shell where the
# login keychain is locked): `$ASC_ENV_FILE` defines ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH.
# The archive is built unsigned; the export is signed with a Cloud Managed Apple Distribution
# certificate. Without the env file, the Xcode account signed in for the team signs locally.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain -- .)" ] || { echo "Commit first: the build number must name a commit." >&2; exit 1; }
BUILD_NUMBER=$(git rev-list --count HEAD)
ARCHIVE="build/MoraxCode-${BUILD_NUMBER}.xcarchive"
MODE="${1:-}"

AUTH=()
SIGNING=()
ASC_ENV_FILE="${ASC_ENV_FILE:-$HOME/.appstoreconnect/speaklikejess.env}"
if [ -f "$ASC_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ASC_ENV_FILE"
  [ -f "${ASC_KEY_PATH:-}" ] || { echo "ASC_KEY_PATH missing or unreadable in $ASC_ENV_FILE" >&2; exit 1; }
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
  SIGNING=(CODE_SIGNING_ALLOWED=NO)
  echo "Cloud signing with App Store Connect API key $ASC_KEY_ID."
fi

xcodegen generate --quiet
xcodebuild archive -project MoraxCode.xcodeproj -scheme MoraxCode -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -allowProvisioningUpdates \
  ${AUTH[@]+"${AUTH[@]}"} ${SIGNING[@]+"${SIGNING[@]}"} CURRENT_PROJECT_VERSION="$BUILD_NUMBER"
echo "Archived $ARCHIVE (build $BUILD_NUMBER)."

case "$MODE" in
  --upload)
    rm -rf build/export
    xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist scripts/ExportOptions.plist \
      -exportPath build/export -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}
    echo "Uploaded build $BUILD_NUMBER to App Store Connect (TestFlight processing takes a few minutes)."
    ;;
  "") ;;
  *) echo "Unknown option $MODE (use --upload)." >&2; exit 2 ;;
esac
