#!/usr/bin/env bash
# Regenerates the Morax Code app icons from the source logo with macOS built-ins only
# (swift/CoreGraphics, sips, iconutil). Run from anywhere on macOS:
#   apps/emdash-desktop/scripts/branding/generate-icons.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd "${script_dir}/../.." && pwd)"
source_logo="${app_dir}/src/assets/images/branding/morax-code-logo.png"
output_dir="${app_dir}/src/assets/images/emdash"
work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

swift "${script_dir}/render-icons.swift" "${source_logo}" "${output_dir}"

# The renderer shows icon-light.png at 48px; keep the bundled asset small.
sips -z 256 256 "${output_dir}/icon-light.png" >/dev/null

build_icns() {
  local master="$1" target="$2"
  local iconset="${work_dir}/$(basename "${target}" .icns).iconset"
  mkdir -p "${iconset}"
  for size in 16 32 128 256 512; do
    sips -z "${size}" "${size}" "${master}" --out "${iconset}/icon_${size}x${size}.png" >/dev/null
    local double=$((size * 2))
    sips -z "${double}" "${double}" "${master}" \
      --out "${iconset}/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil --convert icns "${iconset}" --output "${target}"
}

build_icns "${output_dir}/emdash.png" "${output_dir}/emdash.icns"
build_icns "${output_dir}/emdash-canary.png" "${output_dir}/emdash-canary.icns"
echo "Icons written to ${output_dir}"
