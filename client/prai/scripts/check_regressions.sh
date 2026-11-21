#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
osascript -l JavaScript scripts/regression_checks.jxa
git diff --check
