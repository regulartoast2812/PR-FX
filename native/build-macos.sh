#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h}"
output_dir="$project_dir/build"
app_dir="$output_dir/PR FX Shortcut Listener.app"
current_listener_binary="$app_dir/Contents/MacOS/PRFXShortcutListener"
backup_app_dir="$output_dir/PR FX Shortcut Listener.app.previous"
staging_app_dir="$output_dir/PR FX Shortcut Listener.app.staging.$$"
staging_listener_binary="$staging_app_dir/Contents/MacOS/PRFXShortcutListener"
module_cache="${TMPDIR:-/tmp}/prfx-swift-module-cache"
generated_build_info="$output_dir/PRFXGeneratedBuildInfo.swift"
build_marker="$output_dir/listener-build.txt"
build_lock="$output_dir/.listener-build.lock"
listener_sources=("$project_dir/PRFXShortcutListener.swift" "$project_dir/PRFXAccessibilityProbe.swift" "$project_dir/Info.plist")
can_build_listener=1

for source_file in "${listener_sources[@]}"; do
  if [[ ! -f "$source_file" ]]; then
    can_build_listener=0
  fi
done

mkdir -p "$output_dir" "$module_cache"

if (( can_build_listener )); then
  source_hash="$(/usr/bin/shasum -a 256 "${listener_sources[@]}" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print substr($1,1,12)}')"
  # Keep this deterministic for a given listener source. A timestamp here made
  # every Install / Repair look like a new app to macOS, which in turn made
  # shortcut state appear random across repairs.
  build_id="source-$source_hash"
elif [[ -f "$build_marker" ]]; then
  # Soft-launch packages can ship a prebuilt app without requiring every tester
  # machine to have Swift/Xcode. In that case the bundled marker is the expected
  # install build.
  build_id="$(<"$build_marker")"
else
  build_id=""
fi

cleanup_staging() {
  rm -f "$build_lock"
  if [[ -d "$staging_app_dir" ]]; then
    rm -rf "$staging_app_dir"
  fi
}
trap cleanup_staging EXIT

codesign_ok_for_local_install() {
  local target="$1"
  local verify_output=""
  if verify_output="$(codesign --verify --deep --strict "$target" 2>&1)"; then
    return 0
  fi

  # A self-signed/local Developer ID can be perfectly usable for PR FX's
  # soft-launch flow even when macOS refuses to trust the certificate chain.
  # Treat trust failures as non-fatal, but still require codesign to be able to
  # read the bundle signature so corrupted/unsigned bundles do not pass.
  if print -r -- "$verify_output" | /usr/bin/grep -Eiq 'CSSMERR_TP_NOT_TRUSTED|not trusted|untrusted|unable to build chain|self-signed'; then
    codesign -dv "$target" >/dev/null 2>&1
    return $?
  fi

  return 1
}

if [[ -x "$current_listener_binary" && -f "$app_dir/Contents/Info.plist" && -f "$build_marker" ]]; then
  existing_build_id="$(<"$build_marker")"
  if [[ -n "$build_id" && "$existing_build_id" == "$build_id" ]] && codesign_ok_for_local_install "$app_dir"; then
    echo "Existing listener is current; skipped rebuild."
    echo "Built: $app_dir"
    echo "Listener build: $build_id"
    exit 0
  fi
fi

if (( ! can_build_listener )); then
  echo "No usable bundled PR FX Shortcut Listener app was found, and listener source files are not included in this package." >&2
  echo "Ship native/build/PR FX Shortcut Listener.app with native/build/listener-build.txt, or include native/*.swift so Install / Repair can rebuild it." >&2
  exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "No usable bundled PR FX Shortcut Listener app was found, and Swift/Xcode Command Line Tools are not installed." >&2
  echo "For soft launch, ship a current native/build/PR FX Shortcut Listener.app so tester machines do not need to build from source." >&2
  exit 1
fi

print -r -- "$$" > "$build_lock"

mkdir -p "$staging_app_dir/Contents/MacOS" "$staging_app_dir/Contents/Resources"
cat > "$generated_build_info" <<EOF
import Foundation

let prfxListenerBuild = "$build_id"
EOF
swiftc -D PRFX_GENERATED_BUILD -module-cache-path "$module_cache" "$project_dir/PRFXShortcutListener.swift" "$project_dir/PRFXAccessibilityProbe.swift" "$generated_build_info" -o "$staging_listener_binary" -framework AppKit -framework ApplicationServices -framework Carbon -framework Network
cp "$project_dir/Info.plist" "$staging_app_dir/Contents/Info.plist"
print -n 'APPL????' > "$staging_app_dir/Contents/PkgInfo"
print -r -- "$build_id" > "$staging_app_dir/Contents/Resources/listener-build.txt"
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
  codesign --force --deep --sign "$signing_identity" "$staging_app_dir"
  if codesign_ok_for_local_install "$staging_app_dir"; then
    echo "Signed with: $signing_identity"
  else
    codesign --force --deep --sign - "$staging_app_dir"
    echo "Local signing identity produced an unusable bundle; signed ad-hoc instead."
  fi
else
  codesign --force --deep --sign - "$staging_app_dir"
  echo "Signed ad-hoc."
fi

if ! codesign_ok_for_local_install "$staging_app_dir"; then
  echo "The rebuilt listener bundle could not be validated." >&2
  exit 1
fi

rm -rf "$backup_app_dir"
if [[ -d "$app_dir" ]]; then
  mv "$app_dir" "$backup_app_dir"
fi
if ! mv "$staging_app_dir" "$app_dir"; then
  if [[ -d "$backup_app_dir" && ! -d "$app_dir" ]]; then
    mv "$backup_app_dir" "$app_dir"
  fi
  echo "Could not install the rebuilt listener; the previous app was restored." >&2
  exit 1
fi
print -r -- "$build_id" > "$build_marker"
rm -f "$build_lock"
trap - EXIT

echo "Built: $app_dir"
echo "Listener build: $build_id"
