#!/usr/bin/env python3
"""Catch constructs ExtendScript rejects but modern JS engines accept.

host.jsx runs on ExtendScript: ES3 plus E4X. A parse error there takes down
EVERY command, not just the new one, and CEP reports only "EvalScript error."
with no line number. Checking with a modern engine proves nothing -- ES5 removed
most ES3 reserved words, and no modern engine has E4X.
"""
import re, sys

ES3_RESERVED = """abstract boolean byte char class const debugger double enum export
extends final float goto implements import int interface long native package
private protected public short static super synchronized throws transient
volatile""".split()

ES5_ONLY = ['let ', 'const ', '=>', '...', '`']

# A '/' starts a regex only where a value is expected. After one of these
# tokens it cannot be division.
_REGEX_LEAD = set('(,=:[!&|?{};+-*%~^') | {'\n'}

def strip(src, keep_regex=False):
    """Blank out strings, comments and regex literals, preserving line structure.

    Regex bodies must go too: a word like 'final' or 'class' inside a pattern is
    just characters, and reporting it as a reserved-word violation would train
    the reader to ignore this tool.
    """
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c in '"\'':
            quote, i = c, i + 1
            while i < n and src[i] != quote:
                i += 2 if src[i] == '\\' else 1
            out.append('""'); i += 1
        elif src.startswith('//', i):
            while i < n and src[i] != '\n': i += 1
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append('\n' * src.count('\n', i, j)); i = j
        elif c == '/' and not keep_regex and _is_regex_start(out):
            i += 1
            in_class = False
            while i < n and src[i] != '\n':
                if src[i] == '\\': i += 2; continue
                if src[i] == '[': in_class = True
                elif src[i] == ']': in_class = False
                elif src[i] == '/' and not in_class: break
                i += 1
            out.append('/RE/')
            while i < n and src[i] not in '/\n': i += 1
            if i < n and src[i] == '/': i += 1
            while i < n and src[i].isalpha(): i += 1
        else:
            out.append(c); i += 1
    return ''.join(out)

def _is_regex_start(out):
    for ch in reversed(''.join(out[-40:])):
        if ch in ' \t': continue
        return ch in _REGEX_LEAD
    return True

def check(path):
    src = open(path, encoding='utf-8').read()
    code = strip(src)
    # Regex bodies survive this one so the '<' scan can see them, but comments
    # and strings do not -- prose about '<' is not a defect.
    code_with_regex = strip(src, keep_regex=True)
    problems = []
    for word in ES3_RESERVED:
        for m in re.finditer(r'\b' + word + r'\b', code):
            problems.append((code[:m.start()].count('\n') + 1,
                             '%r is an ES3 reserved word; ExtendScript rejects the file' % word))
    # A regex literal containing '<' can trip ExtendScript's E4X-aware lexer.
    # Scanned against the ORIGINAL source, since strip() blanks regex bodies.
    for m in re.finditer(r'/(?![/*])(?:\\.|\[[^\]]*\]|[^/\n\\])+/[gimy]*', code_with_regex):
        if '<' in m.group(0):
            problems.append((code_with_regex[:m.start()].count('\n') + 1,
                             'regex contains "<"; E4X may parse it as an XML literal'))
    for token in ES5_ONLY:
        for m in re.finditer(re.escape(token), code):
            problems.append((code[:m.start()].count('\n') + 1,
                             'ES5+ syntax %r is not available in ExtendScript' % token.strip()))
    for line, message in sorted(problems):
        print('%s:%d: %s' % (path, line, message))
    return len(problems)

if __name__ == '__main__':
    total = sum(check(p) for p in (sys.argv[1:] or ['jsx/host.jsx']))
    print('ExtendScript check: %s' % ('OK' if not total else '%d problem(s)' % total))
    sys.exit(1 if total else 0)
