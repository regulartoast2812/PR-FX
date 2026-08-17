#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h}"
output_dir="$project_dir/build"
app_dir="$output_dir/PR FX Shortcut Listener.app"
module_cache="${TMPDIR:-/tmp}/prfx-swift-module-cache"

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" "$module_cache"
swiftc -module-cache-path "$module_cache" "$project_dir/PRFXShortcutListener.swift" "$project_dir/PRFXAccessibilityProbe.swift" -o "$app_dir/Contents/MacOS/PR FX Shortcut Listener" -framework AppKit -framework ApplicationServices -framework Carbon -framework Network
cp "$project_dir/Info.plist" "$app_dir/Contents/Info.plist"
# Prefer a stable local signing identity. An ad-hoc signature (--sign -) changes
# the app's code hash on every build, so macOS treats each build as a new app and
# discards its Accessibility grant — which the listener needs to function at all.
# Signing with a certificate makes the designated requirement depend on the
# bundle id and certificate root instead, so the grant survives rebuilds.
#
# To recreate the identity on another machine:
#   openssl req -x509 -newkey rsa:2048 -keyout k.pem -out c.pem -days 3650 -nodes \
#     -subj "/CN=PR FX Local Dev/O=PR FX" -addext "extendedKeyUsage=codeSigning" \
#     -addext "basicConstraints=critical,CA:false" -addext "keyUsage=critical,digitalSignature"
#   openssl pkcs12 -export -out id.p12 -inkey k.pem -in c.pem -passout pass:prfx
#   security import id.p12 -k ~/Library/Keychains/login.keychain-db -P prfx -T /usr/bin/codesign
signing_identity="PR FX Local Dev"
if security find-certificate -c "$signing_identity" >/dev/null 2>&1; then
  codesign --force --deep --sign "$signing_identity" "$app_dir"
  echo "Signed with: $signing_identity"
else
  codesign --force --deep --sign - "$app_dir"
  echo "Signed ad-hoc; Accessibility must be re-granted after every build."
fi
echo "Built: $app_dir"
