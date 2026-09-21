#!/usr/bin/env osascript -l JavaScript
//
// JXA port of tools/check-extendscript.py.
//
// The Python original stopped running when Xcode began requiring licence
// acceptance — /usr/bin/python3 is the Xcode-provided one. This check is the
// only thing standing between a host.jsx edit and a parse error that takes down
// every command, so it needs a runtime that does not depend on Xcode.
//
//   osascript -l JavaScript tools/check-extendscript.js jsx/host.jsx
//
// Checks what actually breaks ExtendScript (ES3 + E4X), none of which a modern
// engine would complain about:
//   - ES3 FutureReservedWords used as identifiers
//   - regex literals containing '<', which E4X may read as an XML literal
//   - ES5+ syntax
ObjC.import('Foundation');

var ES3_RESERVED = ('abstract boolean byte char class const debugger double enum export ' +
  'extends final float goto implements import int interface long native package ' +
  'private protected public short static super synchronized throws transient ' +
  'volatile').split(' ');

var ES5_ONLY = ['let ', 'const ', '=>', '...', '`'];

// A '/' starts a regex only where a value is expected; after one of these it
// cannot be division.
var REGEX_LEAD = '(,=:[!&|?{};+-*%~^\n';

function readFile(path) {
  var text = $.NSString.stringWithContentsOfFileEncodingError($(path), 4, null);
  if (!text) throw new Error('could not read ' + path);
  return ObjC.unwrap(text);
}

function isRegexStart(out) {
  var tail = out.slice(-40).join('');
  for (var i = tail.length - 1; i >= 0; i--) {
    var ch = tail.charAt(i);
    if (ch === ' ' || ch === '\t') continue;
    return REGEX_LEAD.indexOf(ch) !== -1;
  }
  return true;
}

// Blank out strings, comments and (optionally) regex literals while preserving
// line structure, so reported line numbers stay accurate.
function strip(src, keepRegex) {
  var out = [], i = 0, n = src.length;
  while (i < n) {
    var c = src.charAt(i);
    if (c === '"' || c === "'") {
      var quote = c; i += 1;
      while (i < n && src.charAt(i) !== quote) { i += src.charAt(i) === '\\' ? 2 : 1; }
      out.push('""'); i += 1;
    } else if (src.substr(i, 2) === '//') {
      while (i < n && src.charAt(i) !== '\n') i += 1;
    } else if (src.substr(i, 2) === '/*') {
      var end = src.indexOf('*/', i + 2);
      end = end < 0 ? n : end + 2;
      var chunk = src.slice(i, end);
      out.push(chunk.replace(/[^\n]/g, ''));
      i = end;
    } else if (c === '/' && !keepRegex && isRegexStart(out)) {
      i += 1;
      var inClass = false;
      while (i < n && src.charAt(i) !== '\n') {
        if (src.charAt(i) === '\\') { i += 2; continue; }
        if (src.charAt(i) === '[') inClass = true;
        else if (src.charAt(i) === ']') inClass = false;
        else if (src.charAt(i) === '/' && !inClass) break;
        i += 1;
      }
      out.push('/RE/');
      if (i < n && src.charAt(i) === '/') i += 1;
      while (i < n && /[a-z]/i.test(src.charAt(i))) i += 1;
    } else {
      out.push(c); i += 1;
    }
  }
  return out.join('');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function check(path) {
  var src = readFile(path);
  var code = strip(src, false);
  // Regex bodies survive this one so the '<' scan can see them, while comments
  // and strings do not — prose about '<' is not a defect.
  var codeWithRegex = strip(src, true);
  var problems = [];

  ES3_RESERVED.forEach(function (word) {
    var re = new RegExp('\\b' + word + '\\b', 'g'), m;
    while ((m = re.exec(code)) !== null) {
      problems.push([lineOf(code, m.index),
        "'" + word + "' is an ES3 reserved word; ExtendScript rejects the file"]);
    }
  });

  var reLiteral = /\/(?![/*])(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimy]*/g, hit;
  while ((hit = reLiteral.exec(codeWithRegex)) !== null) {
    if (hit[0].indexOf('<') !== -1) {
      problems.push([lineOf(codeWithRegex, hit.index),
        'regex contains "<"; E4X may parse it as an XML literal']);
    }
  }

  ES5_ONLY.forEach(function (token) {
    var from = 0, at;
    while ((at = code.indexOf(token, from)) !== -1) {
      problems.push([lineOf(code, at),
        "ES5+ syntax '" + token.replace(/\s+$/, '') + "' is not available in ExtendScript"]);
      from = at + token.length;
    }
  });

  problems.sort(function (a, b) { return a[0] - b[0]; });
  return problems.map(function (p) { return path + ':' + p[0] + ': ' + p[1]; });
}

// Returns the whole report as one string. osascript echoes the final value, so
// printing inside the script as well would duplicate every line.
// NOT named run(): JXA treats a global run() as the script entry point and
// osascript calls it itself with no arguments, silently ignoring ours.
function checkFiles(argv) {
  var files = argv.length ? argv : ['jsx/host.jsx'];
  var lines = [];
  files.forEach(function (f) { lines = lines.concat(check(f)); });
  lines.push('ExtendScript check: ' + (lines.length ? lines.length + ' problem(s)' : 'OK'));
  return lines.join('\n');
}
