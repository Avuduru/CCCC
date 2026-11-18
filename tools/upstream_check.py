#!/usr/bin/env python3
"""Health check for every outside service the site depends on — run it before blaming the site.

    python tools/upstream_check.py                     # checks https://muhafid.com
    python tools/upstream_check.py http://127.0.0.1:8095

Two parts:
  1. DIRECT: each upstream API on its own (AniList, Jikan, Open Library, Google Translate,
     MyMemory, HowLongToBeat). Shows AniList's live rate limit (x-ratelimit-limit), since a
     lowered limit is what took anime search down on 2026-11-18. TMDB, RAWG and SteamGridDB
     need the server's keys, so they're only checked through the site.
  2. THROUGH THE SITE: every proxy.php endpoint the pages use — search for each type, details,
     game cover, HLTB, translate, the image proxy and stats — with status, time, result count
     and whether the answer came from the 10-minute search cache.

A line is FAIL when the call errors or returns nothing where something is expected, SLOW
when it takes over 4 s, WARN for a fallback that's down (Jikan — often down, only used when
AniList fails). Exit code 1 if anything FAILs (the scheduled GitHub job then emails
the owner). Uses only the standard library. ~25 requests per run; read-only (never rates).
"""
import base64
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SITE = (sys.argv[1] if len(sys.argv) > 1 else 'https://muhafid.com').rstrip('/')
UA = 'Mozilla/5.0 (muhafid-upstream-check)'
SLOW = 4.0
failures = 0


def call(url, data=None, headers=None, timeout=15):
    """-> (status, seconds, body_bytes, response_headers); status 0 = no answer."""
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, **(headers or {})})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, time.time() - t0, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, time.time() - t0, e.read(), dict(e.headers)
    except Exception as e:   # timeout, DNS, TLS…
        return 0, time.time() - t0, str(e).encode(), {}


def report(name, status, secs, ok, note='', fatal=True):
    global failures
    verdict = 'OK  ' if ok and secs <= SLOW else ('SLOW' if ok else ('FAIL' if fatal else 'WARN'))
    failures += verdict == 'FAIL'
    print(f'  {verdict} {name:<34} {status or "---":>4} {secs:5.2f}s  {note}')


def jget(body):
    try:
        return json.loads(body)
    except Exception:
        return None


def count(d):
    if not isinstance(d, dict):
        return 0
    for k in ('results', 'data', 'docs'):
        if isinstance(d.get(k), list):
            return len(d[k])
    return 0


print(f'DIRECT — upstream services on their own')
st, s, b, h = call('https://graphql.anilist.co',
                   json.dumps({'query': '{Media(id:21){id title{romaji}}}'}).encode(),
                   {'Content-Type': 'application/json', 'Accept': 'application/json'})
lim = h.get('X-RateLimit-Limit') or h.get('x-ratelimit-limit')
report('AniList', st, s, st == 200, f'rate limit {lim}/min' + (' (DEGRADED: normal is 90)' if lim and int(lim) < 90 else ''))
st, s, b, h = call('https://api.jikan.moe/v4/anime/21', timeout=8)
report('Jikan (MAL fallback)', st, s, st == 200, 'down: only matters while AniList fails' if st != 200 else '', fatal=False)
st, s, b, h = call('https://openlibrary.org/search.json?q=dune&limit=1')
report('Open Library', st, s, st == 200 and count(jget(b)) > 0)
st, s, b, h = call('https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=ar&dt=t&q=hello')
report('Google Translate', st, s, st == 200)
st, s, b, h = call('https://api.mymemory.translated.net/get?q=hello&langpair=en|ar')
report('MyMemory (translate fallback)', st, s, st == 200)
st, s, b, h = call('https://howlongtobeat.com/')
report('HowLongToBeat', st, s, st == 200)

print(f'\nTHROUGH THE SITE — {SITE}/proxy.php')
# A different everyday title each run, so the 10-minute search cache doesn't hide a dead upstream
pick = random.choice
searches = [
    ('anime', pick(['naruto', 'frieren', 'one piece', 'bleach', 'monster'])),
    ('manga', pick(['berserk', 'vagabond', 'monster', 'vinland saga'])),
    ('movie', pick(['dune', 'inception', 'interstellar', 'the matrix'])),
    ('tv', pick(['breaking bad', 'dark', 'the office', 'severance'])),
    ('game', pick(['elden ring', 'gta 6', 'minecraft', 'hollow knight'])),
    ('book', pick(['dune', 'the hobbit', '1984', 'frankenstein'])),
]
api = SITE + '/proxy.php?'
img = None
for typ, q in searches:
    st, s, b, h = call(api + urllib.parse.urlencode({'type': typ, 'query': q}))
    d = jget(b)
    n = count(d)
    cache = (h.get('X-Search-Cache') or h.get('x-search-cache') or '').upper()
    report(f'search {typ}: "{q}"', st, s, st == 200 and n > 0, f'{n} results' + (' (cache)' if cache == 'HIT' else ''))
    if typ == 'movie' and d and not img:
        for r in d.get('results', []):
            if r.get('poster_path'):
                img = 'https://image.tmdb.org/t/p/w185' + r['poster_path']
                break

for name, params, check in [
    ('movie_details (550)', {'type': 'movie_details', 'query': '550'}, lambda d: bool(d and d.get('title'))),
    ('tv_details (1399)', {'type': 'tv_details', 'query': '1399'}, lambda d: bool(d and d.get('name'))),
    ('game_details (elden-ring)', {'type': 'game_details', 'query': 'elden-ring'}, lambda d: bool(d and d.get('name'))),
    ('book_details (OL82563W)', {'type': 'book_details', 'query': '/works/OL82563W'}, lambda d: isinstance(d, dict) and 'error' not in d),
    ('game_cover (SteamGridDB)', {'type': 'game_cover', 'query': 'Elden Ring'}, lambda d: bool(d and d.get('success'))),
    ('hltb (Elden Ring)', {'type': 'hltb', 'query': 'Elden Ring'}, lambda d: bool(d and d.get('success'))),
    ('translate', {'type': 'translate', 'q': base64.urlsafe_b64encode(b'A story about friendship.').decode().rstrip('=')},
     lambda d: isinstance(d, dict) and 'error' not in d),
    ('stats', {'type': 'stats'}, lambda d: bool(d and d.get('source') == 'mysql')),
]:
    st, s, b, h = call(api + urllib.parse.urlencode(params))
    d = jget(b)
    note = '' if check(d) else (b[:80].decode(errors='replace') if b else '')
    report(name, st, s, st == 200 and check(d), note)

if img:
    st, s, b, h = call(api + urllib.parse.urlencode({'type': 'image_proxy', 'query': img}))
    ctype = h.get('Content-Type') or h.get('content-type') or ''
    report('image_proxy (TMDB poster)', st, s, st == 200 and ctype.startswith('image/'), ctype)
else:
    report('image_proxy (TMDB poster)', 0, 0, False, 'no poster found in the movie search to test with')

print(f'\n{"ALL GOOD" if not failures else f"{failures} FAILED"}')
sys.exit(1 if failures else 0)
