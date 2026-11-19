#!/usr/bin/env python3
"""CCCC home dashboard — runs on the owner's home network (Proxmox container), not on the site.

Pulls three sources and serves one page that refreshes itself every minute:
  * GoatCounter API  (visits, events, countries, referrers, devices) — needs a read-only key
  * muhafid.com/proxy.php?type=stats  (ratings: totals, per day/hour, tiles; public, counts only)
  * a few quick service checks (site, deploy time, AniList, Kitsu, Open Library)

Standard library only (Python 3.9+). Config comes from dash.env next to this file (or the file
named by $DASH_ENV): GOATCOUNTER_API_KEY (required), GOATCOUNTER_CODE (default kureiji),
SITE (default https://muhafid.com), BIND (default 0.0.0.0), PORT (default 8090).
The key is only ever sent to GoatCounter; it never reaches the browser or the logs.
"""
import concurrent.futures as cf
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATIC = HERE / 'static'
STATIC_FILES = {'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8',
                'style.css': 'text/css; charset=utf-8'}


def load_env(path):
    conf = {}
    try:
        for line in Path(path).read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            conf[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return conf


CONF = load_env(os.environ.get('DASH_ENV', HERE / 'dash.env'))
GC_KEY = CONF.get('GOATCOUNTER_API_KEY', '')
GC_CODE = CONF.get('GOATCOUNTER_CODE', 'kureiji')
SITE = CONF.get('SITE', 'https://muhafid.com').rstrip('/')
BIND = CONF.get('BIND', '0.0.0.0')
PORT = int(CONF.get('PORT', '8090'))
UA = 'cccc-dash/1.0 (home dashboard)'

RANGES = {  # name -> (length, GoatCounter grouping)
    '24h': (timedelta(hours=24), 'hour'),
    '7d': (timedelta(days=7), 'day'),
    '30d': (timedelta(days=30), 'day'),
    '90d': (timedelta(days=90), 'day'),
}
DATA_TTL = 60      # seconds; the page refreshes every minute
HEALTH_TTL = 600   # deep service check at most every 10 minutes (only while the page is open)


class SourceError(Exception):
    pass


def fetch(url, headers=None, data=None, timeout=15, method=None):
    """GET/POST url; returns (status, body bytes, response headers, milliseconds)."""
    h = {'User-Agent': UA}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers, int((time.monotonic() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read() or b'', e.headers, int((time.monotonic() - t0) * 1000)


def gc(path, **params):
    if not GC_KEY:
        raise SourceError('GOATCOUNTER_API_KEY is not set')
    url = f'https://{GC_CODE}.goatcounter.com/api/v0/{path}?' + urllib.parse.urlencode(params)
    for attempt in range(3):
        status, body, hdrs, _ = fetch(url, headers={'Authorization': f'Bearer {GC_KEY}',
                                                    'Content-Type': 'application/json'})
        if status == 429 and attempt < 2:      # rate limited: wait as told, then retry
            time.sleep(min(float(hdrs.get('Retry-After') or 1), 5))
            continue
        if status != 200:
            raise SourceError(f'GoatCounter {path}: HTTP {status}')   # never echo the body (could hold the URL)
        return json.loads(body)
    raise SourceError(f'GoatCounter {path}: rate limited')


def site_stats():
    status, body, _, _ = fetch(f'{SITE}/proxy.php?type=stats', timeout=20)
    if status != 200:
        raise SourceError(f'site stats: HTTP {status}')
    return json.loads(body)


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:00:00Z')


def collect(rng):
    span, group = RANGES[rng]
    end = (datetime.now(timezone.utc) + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    start = end - span
    q = {'start': iso(start), 'end': iso(end)}
    jobs = {
        'hits': lambda: gc('stats/hits', limit=200, group=group, **q),
        'total': lambda: gc('stats/total', **q),
        'locations': lambda: gc('stats/locations', limit=100, **q),
        'refs': lambda: gc('stats/toprefs', limit=15, **q),
        'sizes': lambda: gc('stats/sizes', **q),
        'browsers': lambda: gc('stats/browsers', limit=8, **q),
        'systems': lambda: gc('stats/systems', limit=8, **q),
        'campaigns': lambda: gc('stats/campaigns', limit=8, **q),
        'site': site_stats,
    }
    out, errors = {}, []
    with cf.ThreadPoolExecutor(max_workers=4) as ex:   # gentle on GoatCounter
        futs = {ex.submit(fn): name for name, fn in jobs.items()}
        for f in cf.as_completed(futs):
            name = futs[f]
            try:
                out[name] = f.result()
            except Exception as e:  # one source failing must not blank the whole page
                errors.append(str(e) if isinstance(e, SourceError) else f'{name}: {type(e).__name__}')
                out[name] = None

    # Slim the GoatCounter path list: name, event?, visitors, and per-day / per-hour counts
    paths = []
    for h in (out.get('hits') or {}).get('hits', []):
        days = [{'day': s['day'], 'daily': s.get('daily', 0), 'hourly': s.get('hourly') or []}
                for s in h.get('stats', [])]
        paths.append({'path': h['path'], 'event': bool(h.get('event')), 'count': h.get('count', 0), 'days': days})
    total = out.get('total') or {}

    def stat_list(name):
        return [{'id': s.get('id', ''), 'name': s.get('name', ''), 'count': s.get('count', 0),
                 'ref_scheme': s.get('ref_scheme')} for s in ((out.get(name) or {}).get('stats') or [])]

    return {
        'range': rng, 'group': group, 'start': q['start'], 'end': q['end'], 'site_url': SITE,
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'gc': {
            'total': total.get('total', 0), 'total_events': total.get('total_events', 0),
            'days': [{'day': s['day'], 'daily': s.get('daily', 0), 'hourly': s.get('hourly') or []}
                     for s in total.get('stats', [])],
            'paths': paths,
            'locations': stat_list('locations'), 'refs': stat_list('refs'), 'sizes': stat_list('sizes'),
            'browsers': stat_list('browsers'), 'systems': stat_list('systems'), 'campaigns': stat_list('campaigns'),
        },
        'site': out.get('site'),
        'errors': errors,
    }


# Search titles for the through-the-site checks (same idea as tools/upstream_check.py): a random
# title is usually not in the site's 10-minute search cache, so the check reaches the real source.
POOL = {
    'anime': ['naruto', 'frieren', 'one piece', 'bleach', 'monster', 'mushishi', 'haikyuu', 'trigun', 'dorohedoro', 'kingdom'],
    'manga': ['berserk', 'vagabond', 'monster', 'vinland saga', 'blame', 'pluto', 'dorohedoro', 'kingdom', 'akira', 'gantz'],
    'movie': ['dune', 'inception', 'interstellar', 'the matrix', 'heat', 'alien', 'arrival', 'gravity', 'up', 'jaws'],
    'tv': ['breaking bad', 'dark', 'the office', 'severance', 'chernobyl', 'fargo', 'lost', 'friends', 'sherlock', 'dexter'],
    'game': ['elden ring', 'minecraft', 'hollow knight', 'hades', 'celeste', 'portal', 'doom', 'tetris', 'outer wilds', 'inside'],
    'book': ['dune', 'the hobbit', '1984', 'frankenstein', 'dracula', 'emma', 'ulysses', 'beloved', 'it', 'carrie'],
}
GAME_FRESH_EVERY = 3600   # a fresh (uncached) game search at most hourly: RAWG's free plan is 20k calls/month
_last_game_fresh = [0.0]


def health():
    """Deep check, run only while the page is open (cached HEALTH_TTL). Read-only: never saves a rating."""
    import base64
    import random
    checks = []
    api = f'{SITE}/proxy.php?'

    def add(group, name, fn):
        try:
            ok, ms, note = fn()
        except Exception as e:
            ok, ms, note = False, None, type(e).__name__
        checks.append({'group': group, 'name': name, 'ok': bool(ok), 'ms': ms, 'note': note})

    def site_json(params, timeout=20):
        s, b, h, ms = fetch(api + urllib.parse.urlencode(params), timeout=timeout)
        try:
            d = json.loads(b)
        except ValueError:
            d = None
        return s, d, h, ms

    def count(d):
        if not isinstance(d, dict):
            return 0
        for k in ('results', 'data', 'docs'):
            if isinstance(d.get(k), list):
                return len(d[k])
        return 0

    # --- the site itself
    def home():
        s, _, _, ms = fetch(f'{SITE}/', timeout=15)
        return s == 200, ms, f'HTTP {s}'

    def database():
        s, d, _, ms = site_json({'type': 'stats'})
        src = (d or {}).get('source')
        return src == 'mysql', ms, f'source: {src}' if src else f'HTTP {s}'

    def deploy():
        s, _, h, ms = fetch(f'{SITE}/js/app.js', timeout=15, method='HEAD')
        return s == 200, ms, h.get('Last-Modified', '?')

    def counter():
        t0 = time.monotonic()
        gc('stats/sizes', start=iso(datetime.now(timezone.utc) - timedelta(hours=1)),
           end=iso(datetime.now(timezone.utc) + timedelta(hours=1)))
        return True, int((time.monotonic() - t0) * 1000), 'API OK'

    # --- every search type, through the site
    poster = {}

    def search(typ):
        def fn():
            fresh = typ != 'game' or time.time() - _last_game_fresh[0] > GAME_FRESH_EVERY
            q = random.choice(POOL[typ]) if fresh else 'elden ring'
            if typ == 'game' and fresh:
                _last_game_fresh[0] = time.time()
            s, d, h, ms = site_json({'type': typ, 'query': q})
            n = count(d)
            hit = (h.get('X-Search-Cache') or '').upper() == 'HIT'
            if typ == 'movie':
                for r in (d or {}).get('results', []):
                    if r.get('poster_path'):
                        poster['url'] = 'https://image.tmdb.org/t/p/w185' + r['poster_path']
                        break
            return s == 200 and n > 0, ms, f'"{q}": {n} results' + (' (cached)' if hit else '')
        return fn

    # --- features that cards depend on
    def translate():
        q = base64.urlsafe_b64encode(b'A story about friendship.').decode().rstrip('=')
        s, d, _, ms = site_json({'type': 'translate', 'q': q})
        return s == 200 and isinstance(d, dict) and 'error' not in d, ms, f'HTTP {s}'

    def hltb():
        s, d, _, ms = site_json({'type': 'hltb', 'query': 'Elden Ring'})
        return s == 200 and bool((d or {}).get('success')), ms, f'HTTP {s}'

    def cover():
        s, d, _, ms = site_json({'type': 'game_cover', 'query': 'Elden Ring'})
        return s == 200 and bool((d or {}).get('success')), ms, f'HTTP {s}'

    def movie_details():
        s, d, _, ms = site_json({'type': 'movie_details', 'query': '550'})
        return s == 200 and bool((d or {}).get('title')), ms, f'HTTP {s}'

    def image_proxy():
        url = poster.get('url')
        if not url:
            return False, None, 'no poster from the movie search to test with'
        s, _, h, ms = fetch(api + urllib.parse.urlencode({'type': 'image_proxy', 'query': url}), timeout=20)
        ctype = h.get('Content-Type', '')
        return s == 200 and ctype.startswith('image/'), ms, ctype or f'HTTP {s}'

    # --- sources on their own (tells "the site is broken" apart from "the source is down")
    def anilist():
        s, _, h, ms = fetch('https://graphql.anilist.co', timeout=10, method='POST',
                            data=json.dumps({'query': '{Media(id:1){id}}'}).encode(),
                            headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        lim = h.get('X-RateLimit-Limit')
        return s == 200, ms, f'HTTP {s}' + (f', limit {lim}/min' + (' (degraded)' if lim and int(lim) < 90 else '') if lim else '')

    def kitsu():
        s, _, _, ms = fetch('https://kitsu.io/api/edge/anime?page%5Blimit%5D=1', timeout=10,
                            headers={'Accept': 'application/vnd.api+json'})
        return s == 200, ms, f'HTTP {s}'

    def openlibrary():
        s, _, _, ms = fetch('https://openlibrary.org/search.json?q=dune&limit=1', timeout=12)
        return s == 200, ms, f'HTTP {s}'

    def google_tr():
        s, _, _, ms = fetch('https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=ar&dt=t&q=hello', timeout=10)
        return s == 200, ms, f'HTTP {s}'

    groups = [
        ('Site', [('Home page', home), ('Database', database), ('Last deploy', deploy), ('GoatCounter', counter)]),
        ('Search', [(t.capitalize() if t != 'tv' else 'TV', search(t)) for t in POOL]),
        ('Cards', [('Movie details', movie_details), ('Translation', translate), ('HowLongToBeat', hltb),
                   ('Game cover (SteamGridDB)', cover)]),
        ('Sources', [('AniList', anilist), ('Kitsu', kitsu), ('Open Library', openlibrary), ('Google Translate', google_tr)]),
    ]
    jobs = [(g, n, f) for g, items in groups for n, f in items]
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(lambda j: add(*j), jobs))
    add('Cards', 'Image proxy', image_proxy)        # needs the movie search's poster
    order = [(g, n) for g, n, _ in jobs] + [('Cards', 'Image proxy')]
    checks.sort(key=lambda c: order.index((c['group'], c['name'])))
    failed = sum(1 for c in checks if not c['ok'])
    return {'checked': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'failed': failed, 'checks': checks}


_cache, _lock = {}, threading.Lock()
_key_locks = {}


def cached(key, ttl, fn):
    """At most one fetch per key at a time; others wait and reuse it."""
    with _lock:
        kl = _key_locks.setdefault(key, threading.Lock())
    with kl:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        val = fn()
        _cache[key] = (time.time(), val)
        return val


class Handler(BaseHTTPRequestHandler):
    server_version = 'cccc-dash'
    sys_version = ''

    def send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def send_json(self, obj, code=200):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        if path == '/':
            path = '/index.html'
        name = path.lstrip('/')
        if name in STATIC_FILES:
            return self.send(200, (STATIC / name).read_bytes(), STATIC_FILES[name])
        if path == '/api/data':
            rng = urllib.parse.parse_qs(url.query).get('range', ['7d'])[0]
            if rng not in RANGES:
                return self.send_json({'error': 'bad range'}, 400)
            try:
                return self.send_json(cached('data:' + rng, DATA_TTL, lambda: collect(rng)))
            except Exception as e:
                return self.send_json({'error': type(e).__name__}, 502)
        if path == '/api/health':
            return self.send_json(cached('health', HEALTH_TTL, health))
        self.send(404, b'Not found', 'text/plain; charset=utf-8')

    def log_message(self, format, *args):  # quiet: only errors reach the journal
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            super().log_message(format, *args)


if __name__ == '__main__':
    if not GC_KEY:
        print('Warning: GOATCOUNTER_API_KEY is not set; visit numbers will be missing.', flush=True)
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f'CCCC dashboard on http://{BIND}:{PORT}  (GoatCounter: {GC_CODE}, site: {SITE})', flush=True)
    srv.serve_forever()
