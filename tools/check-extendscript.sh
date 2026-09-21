#!/bin/zsh
# One command for the ExtendScript parse check, whatever runtime is available.
#
# The original was Python, but Xcode licence acceptance can disable
# /usr/bin/python3 outright — and this check is the only thing between a
# host.jsx edit and a parse error that takes down every command. osascript has
# no such dependency.
set -u
here="${0:A:h}"
args=""
for f in "$@"; do args="$args'$f',"; done
report=$(osascript -l JavaScript -e "
  ObjC.import('Foundation');
  eval(ObjC.unwrap(\$.NSString.stringWithContentsOfFileEncodingError('$here/check-extendscript.js', 4, null)));
  checkFiles([$args]);
" 2>/dev/null)
print -r -- "$report"
case "$report" in (*problem\(s\)*) exit 1;; esac
exit 0
