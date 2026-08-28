#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
"$script_dir/build-macos.sh"
/bin/zsh "$script_dir/stop-listener-macos.sh"
sleep 0.4
/bin/zsh "$script_dir/start-listener-macos.sh"
