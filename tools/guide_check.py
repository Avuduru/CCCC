#!/usr/bin/env python3
"""Guide integrity check: the rating guide's meaning can't change without a new version.

Every rating is saved with the guide version it was made under (GUIDE_VERSION in proxy.php),
so the guide text and that number must move together. This script fails when they don't.

    python tools/guide_check.py                 # check (CI runs this on every PR and push to main)
    python tools/guide_check.py --lock          # after a meaning change: GUIDE_VERSION bumped + changelog entry added
    python tools/guide_check.py --lock --wording-only "fix a typo in Magic"
                                                # text changed but the meaning didn't: no bump, reason recorded

Checks:
  1. The guide text (levels, content flags, exceptions in guide.html) matches the fingerprint in
     tools/guide_lock.json. Any edit to that text fails until it is locked, either as a new
     version or explicitly as wording-only.
  2. GUIDE_VERSION in proxy.php equals the locked version.
  3. Every GUIDE.v<N> label in guide.html shows that version.
  4. The changelog (about.html#changelog) has an entry for every version 1..N, newest first.
  5. The guide modal on the home page (index.html) carries the same descriptions as guide.html.
"""
import hashlib
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'guide_lock.json'


def read(name):
    return (ROOT / name).read_text(encoding='utf-8')


def guide_body(src):
    """The part of guide.html that defines what ratings mean, as normalised plain text."""
    start = src.index('<!-- ── SECTION 03')
    end = src.index('<div class="guide-footnote">')
    part = src[start:end]
    part = re.sub(r'<!--.*?-->', ' ', part, flags=re.S)
    part = re.sub(r'<[^>]+>', ' ', part)
    part = html.unescape(part)
    part = re.sub(r'GUIDE\.v\d+', 'GUIDE.vN', part)
    return ' '.join(part.split())


def fingerprint(src):
    return hashlib.sha256(guide_body(src).encode('utf-8')).hexdigest()


def proxy_version():
    m = re.search(r'const GUIDE_VERSION = (\d+);', read('proxy.php'))
    if not m:
        raise SystemExit('proxy.php: GUIDE_VERSION constant not found')
    return int(m.group(1))


def descriptions(src):
    """Paragraphs inside the level ladder and the content-flag tiles."""
    return re.findall(r'<p>([^<]+)</p>', src)


def check():
    errors = []
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    guide = read('guide.html')
    v = proxy_version()

    if fingerprint(guide) != lock['sha256']:
        errors.append(
            'The guide text in guide.html changed since it was last locked.\n'
            '    Meaning changed?  bump GUIDE_VERSION in proxy.php, update the GUIDE.v<N> labels, add a dated\n'
            '                      changelog entry at the top of about.html#changelog (+ English in build_en.py),\n'
            '                      then run: python tools/guide_check.py --lock\n'
            '    Wording only?     python tools/guide_check.py --lock --wording-only "what changed"')
    if v != lock['version']:
        errors.append(f'GUIDE_VERSION in proxy.php is {v}, but the locked version is {lock["version"]} '
                      '(run --lock after a meaning change).')

    labels = set(re.findall(r'GUIDE\.v(\d+)', guide))
    if labels != {str(v)}:
        errors.append(f'guide.html labels show GUIDE.v{sorted(labels)}, expected only GUIDE.v{v}.')

    about = read('about.html')
    m = re.search(r'<section id="changelog">(.*?)</section>', about, flags=re.S)
    if not m:
        errors.append('about.html: <section id="changelog"> not found.')
    else:
        found = [int(x) for x in re.findall(r'class="cl-ver"[^>]*>GUIDE\.v(\d+)<', m.group(1))]
        want = list(range(v, 0, -1))
        if found != want:
            errors.append(f'Changelog entries are {["v%d" % x for x in found]}; expected one per version, '
                          f'newest first: {["v%d" % x for x in want]}.')

    index = read('index.html')
    missing = [d for d in descriptions(guide[guide.index('<!-- ── SECTION 03'):guide.index('<!-- ── SECTION 02')])
               if d.strip() and d not in index]
    if missing:
        errors.append('The guide modal in index.html is out of step with guide.html; missing:\n'
                      + '\n'.join('    ' + d[:90] for d in missing))

    if errors:
        print('Guide integrity check FAILED:\n')
        for e in errors:
            print('  - ' + e + '\n')
        return 1
    print(f'Guide integrity OK: GUIDE.v{v}, text matches the lock, changelog v1..v{v} present.')
    return 0


def lock(wording_only):
    old = json.loads(LOCK.read_text(encoding='utf-8')) if LOCK.exists() else {'version': 0, 'history': []}
    guide = read('guide.html')
    v = proxy_version()
    new_hash = fingerprint(guide)
    if new_hash == old.get('sha256') and v == old.get('version'):
        print('Nothing to lock: the guide text and version are unchanged.')
        return 0
    if wording_only is not None:
        if v != old.get('version'):
            raise SystemExit('--wording-only, but GUIDE_VERSION changed. A new version is a meaning change: '
                             'drop --wording-only.')
        if not wording_only.strip():
            raise SystemExit('--wording-only needs a short reason, e.g. --wording-only "fix a typo in Magic".')
        entry = {'version': v, 'date': date.today().isoformat(), 'kind': 'wording', 'note': wording_only.strip(),
                 'sha256': new_hash}
    else:
        if v != old.get('version', 0) + 1:
            raise SystemExit(f'The guide text changed but GUIDE_VERSION is {v} (locked: {old.get("version")}). '
                             f'A meaning change must bump it to {old.get("version", 0) + 1}; '
                             'for a wording-only change use --wording-only "reason".')
        entry = {'version': v, 'date': date.today().isoformat(), 'kind': 'meaning', 'sha256': new_hash}
    data = {'version': v, 'sha256': new_hash, 'history': old.get('history', []) + [entry]}
    LOCK.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Locked GUIDE.v{v} ({entry["kind"]}). Now run the check: python tools/guide_check.py')
    return 0


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--lock' in args:
        wo = None
        if '--wording-only' in args:
            i = args.index('--wording-only')
            wo = args[i + 1] if i + 1 < len(args) else ''
        sys.exit(lock(wo))
    sys.exit(check())
