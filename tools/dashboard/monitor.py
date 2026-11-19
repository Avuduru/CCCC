"""Background monitor for the home dashboard: checks muhafid.com all day and sends phone alerts.

Runs inside server.py (a thread), so it works even when no one has the page open.
  quick (every 2 min):  home internet, home page, database
  deep  (every 10 min): every search type and card feature through the site, the sources on their
                        own, security (headers + private paths blocked), TLS certificate, deploy stuck,
                        export libraries, real visitors' failures (GoatCounter events), ratings stopped,
                        visit counter receiving.
Read-only: never saves a rating or writes anything on the site.

Alerts (ntfy, optional: NTFY_TOPIC in dash.env):
  * "ours" (the site's own problems) after 2 failed runs in a row; security problems at once.
  * "theirs" (an outside service like Open Library) only after ~1 hour, low priority.
  * one message per run listing every new problem; a "recovered" message when it clears;
    a reminder every 6 h while it lasts; nothing while the home internet itself is down.
  * a daily summary at HEARTBEAT_HOUR (ALERT_TZ): if it doesn't arrive, the monitor itself is down.
"""
import base64
import email.utils
import json
import random
import socket
import ssl
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9
    ZoneInfo = None

QUICK_EVERY = 120
DEEP_EVERY = 600
REMIND_EVERY = 6 * 3600
GAME_FRESH_EVERY = 3600       # fresh (uncached) game search at most hourly: RAWG free plan is 20k calls/month
POOL = {
    'anime': ['naruto', 'frieren', 'one piece', 'bleach', 'monster', 'mushishi', 'haikyuu', 'trigun', 'dorohedoro', 'kingdom'],
    'manga': ['berserk', 'vagabond', 'monster', 'vinland saga', 'blame', 'pluto', 'dorohedoro', 'kingdom', 'akira', 'gantz'],
    'movie': ['dune', 'inception', 'interstellar', 'the matrix', 'heat', 'alien', 'arrival', 'gravity', 'up', 'jaws'],
    'tv': ['breaking bad', 'dark', 'the office', 'severance', 'chernobyl', 'fargo', 'lost', 'friends', 'sherlock', 'dexter'],
    'game': ['elden ring', 'minecraft', 'hollow knight', 'hades', 'celeste', 'portal', 'doom', 'tetris', 'outer wilds', 'inside'],
    'book': ['dune', 'the hobbit', '1984', 'frankenstein', 'dracula', 'emma', 'ulysses', 'beloved', 'carrie', 'jane eyre'],
}
# Paths that must never be served (any 200 here is a leak)
PRIVATE_PATHS = ['/.env', '/.git/config', '/data/schema.sql', '/data/classifications.jsonl', '/Caddyfile',
                 '/tools/dashboard/server.py', '/README.md', '/php.ini']
# Real visitors' failures (GoatCounter events from js/analytics.js), alert thresholds per ~3 hours
SIGNALS = [('save-failed', 'Saving ratings', 2), ('export-failed', 'Card export', 3),
           ('copy-failed', 'Card copy', 3), ('js-error', 'Page errors', 3)]
GROUP_ORDER = ['Site', 'Security', 'Visitors', 'Search', 'Cards', 'Sources']


def now_utc():
    return datetime.now(timezone.utc)


class Monitor:
    def __init__(self, fetch, gc, site, conf):
        self.fetch, self.gc, self.site = fetch, gc, site
        self.topic = conf.get('NTFY_TOPIC', '').strip()
        self.ntfy = conf.get('NTFY_SERVER', 'https://ntfy.sh').rstrip('/')
        tzname = conf.get('ALERT_TZ', 'America/New_York')
        try:
            self.tz = ZoneInfo(tzname) if ZoneInfo else timezone.utc
        except Exception:
            self.tz = timezone.utc
        self.heartbeat_hour = int(conf.get('HEARTBEAT_HOUR', '9'))
        self.state_file = Path(conf.get('STATE_DIR', '/var/lib/cccc-dash')) / 'monitor.json'
        self.lock = threading.Lock()
        self.checks = {}          # id -> latest result
        self.alerts = {}          # id -> {fails, alerted, since, last_sent}
        self.sent = []            # last notifications, newest first
        self.last_heartbeat = ''  # local date of the last daily summary
        self.home_online = True
        self.last_game_fresh = 0.0
        self.started = time.time()
        self._load()

    # ------------------------------------------------------------------ state
    def _load(self):
        try:
            s = json.loads(self.state_file.read_text(encoding='utf-8'))
            self.alerts = s.get('alerts', {})
            self.sent = s.get('sent', [])[:20]
            self.last_heartbeat = s.get('last_heartbeat', '')
        except Exception:
            pass

    def _save(self):
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.state_file.with_suffix('.tmp')
            tmp.write_text(json.dumps({'alerts': self.alerts, 'sent': self.sent[:20],
                                       'last_heartbeat': self.last_heartbeat}), encoding='utf-8')
            tmp.replace(self.state_file)
        except Exception:
            pass   # not writable: keep state in memory only

    # ------------------------------------------------------------------ helpers
    def _result(self, cid, group, name, fn, owner='ours', threshold=2):
        t0 = time.monotonic()
        try:
            ok, note = fn()
        except Exception as e:
            ok, note = False, type(e).__name__
        ms = int((time.monotonic() - t0) * 1000)
        return {'id': cid, 'group': group, 'name': name, 'ok': ok, 'ms': ms, 'note': note,
                'owner': owner, 'threshold': threshold, 'checked': now_utc().strftime('%Y-%m-%dT%H:%M:%SZ')}

    def _site_json(self, params, timeout=20):
        s, b, h, _ = self.fetch(f'{self.site}/proxy.php?' + urllib.parse.urlencode(params), timeout=timeout)
        try:
            d = json.loads(b)
        except ValueError:
            d = None
        return s, d, h

    @staticmethod
    def _count(d):
        if isinstance(d, dict):
            for k in ('results', 'data', 'docs'):
                if isinstance(d.get(k), list):
                    return len(d[k])
        return 0

    # ------------------------------------------------------------------ quick checks
    def quick(self):
        out = []

        def internet():
            for url in ('https://www.google.com/generate_204', 'https://www.cloudflare.com/cdn-cgi/trace'):
                try:
                    s, _, _, _ = self.fetch(url, timeout=8)
                    if s in (200, 204):
                        return True, 'online'
                except Exception:
                    pass
            return False, 'home internet is down: alerts paused'
        out.append(self._result('internet', 'Site', 'Home internet', internet, owner='info'))
        self.home_online = out[-1]['ok']

        def home():
            s, b, _, ms = self.fetch(f'{self.site}/', timeout=20)
            if s != 200:
                return False, f'HTTP {s}'
            if b'search-query' not in b:
                return False, 'page loads but looks wrong (no search box)'
            return True, f'HTTP 200' + (' (slow)' if ms > 4000 else '')
        out.append(self._result('home', 'Site', 'Home page', home))

        def database():
            s, d, _ = self._site_json({'type': 'stats'})
            src = (d or {}).get('source')
            if s != 200:
                return False, f'HTTP {s}'
            return src == 'mysql', f'source: {src}' + ('' if src == 'mysql' else ' (database unreachable: ratings not saved)')
        out.append(self._result('database', 'Site', 'Database', database))
        return out

    # ------------------------------------------------------------------ deep checks
    def deep(self):
        out = []
        add = lambda *a, **k: out.append(self._result(*a, **k))

        # --- sources on their own (decide "theirs" vs "ours" for the site checks)
        def anilist():
            s, _, h, _ = self.fetch('https://graphql.anilist.co', timeout=10, method='POST',
                                    data=json.dumps({'query': '{Media(id:1){id}}'}).encode(),
                                    headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
            lim = h.get('X-RateLimit-Limit')
            return s == 200, f'HTTP {s}' + (f', limit {lim}/min' + (' (degraded)' if lim and int(lim) < 90 else '') if lim else '')
        add('src-anilist', 'Sources', 'AniList', anilist, owner='theirs', threshold=6)
        add('src-kitsu', 'Sources', 'Kitsu', lambda: (lambda r: (r[0] == 200, f'HTTP {r[0]}'))(
            self.fetch('https://kitsu.io/api/edge/anime?page%5Blimit%5D=1', timeout=10, headers={'Accept': 'application/vnd.api+json'})),
            owner='theirs', threshold=6)
        add('src-openlibrary', 'Sources', 'Open Library', lambda: (lambda r: (r[0] == 200, f'HTTP {r[0]}'))(
            self.fetch('https://openlibrary.org/search.json?q=dune&limit=1', timeout=12)), owner='theirs', threshold=6)
        add('src-google', 'Sources', 'Google Translate', lambda: (lambda r: (r[0] == 200, f'HTTP {r[0]}'))(
            self.fetch('https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=ar&dt=t&q=hello', timeout=10)),
            owner='theirs', threshold=6)
        add('src-hltb', 'Sources', 'HowLongToBeat', lambda: (lambda r: (r[0] == 200, f'HTTP {r[0]}'))(
            self.fetch('https://howlongtobeat.com/', timeout=12)), owner='theirs', threshold=6)

        def gc_api():
            self.gc('stats/sizes', start=(now_utc() - timedelta(hours=1)).strftime('%Y-%m-%dT%H:00:00Z'),
                    end=(now_utc() + timedelta(hours=1)).strftime('%Y-%m-%dT%H:00:00Z'))
            return True, 'API OK'
        add('src-goatcounter', 'Sources', 'GoatCounter', gc_api, owner='theirs', threshold=6)
        down = {c['name'] for c in out if c['group'] == 'Sources' and not c['ok']}

        # --- every search type through the site
        poster = {}
        for typ in POOL:
            def search(typ=typ):
                fresh = typ != 'game' or time.time() - self.last_game_fresh > GAME_FRESH_EVERY
                titles = random.sample(POOL[typ], 2) if fresh else ['elden ring', 'minecraft']
                if typ == 'game' and fresh:
                    self.last_game_fresh = time.time()
                for q in titles:          # one slow/empty answer is a blip: fail only if a 2nd title fails too
                    s, d, h = self._site_json({'type': typ, 'query': q})
                    n = self._count(d)
                    if s == 200 and n > 0:
                        break
                if typ == 'movie':
                    for r in (d or {}).get('results', []):
                        if r.get('poster_path'):
                            poster['url'] = 'https://image.tmdb.org/t/p/w185' + r['poster_path']
                            break
                cached = (h.get('X-Search-Cache') or '').upper() == 'HIT'
                return s == 200 and n > 0, f'"{q}": {n} results' + (' (cached)' if cached else '') + ('' if s == 200 else f', HTTP {s}')
            theirs = (typ == 'book' and 'Open Library' in down) or (typ in ('anime', 'manga') and {'AniList', 'Kitsu'} <= down)
            add(f'search-{typ}', 'Search', 'TV' if typ == 'tv' else typ.capitalize(), search,
                owner='theirs' if theirs else 'ours', threshold=6 if theirs else 2)

        # --- card features
        def translate():
            q = base64.urlsafe_b64encode(f'A story about friendship {random.randint(1, 9999)}.'.encode()).decode().rstrip('=')
            s, d, _ = self._site_json({'type': 'translate', 'q': q})
            return s == 200 and isinstance(d, dict) and 'error' not in d, f'HTTP {s}'
        add('card-translate', 'Cards', 'Translation', translate,
            owner='theirs' if 'Google Translate' in down else 'ours', threshold=6 if 'Google Translate' in down else 2)
        add('card-hltb', 'Cards', 'HowLongToBeat', lambda: (lambda r: (r[0] == 200 and bool((r[1] or {}).get('success')), f'HTTP {r[0]}'))(
            self._site_json({'type': 'hltb', 'query': 'Elden Ring'})),
            owner='theirs' if 'HowLongToBeat' in down else 'ours', threshold=6 if 'HowLongToBeat' in down else 2)
        add('card-cover', 'Cards', 'Game cover (SteamGridDB)', lambda: (lambda r: (r[0] == 200 and bool((r[1] or {}).get('success')), f'HTTP {r[0]}'))(
            self._site_json({'type': 'game_cover', 'query': 'Elden Ring'})))
        add('card-movie', 'Cards', 'Movie details', lambda: (lambda r: (r[0] == 200 and bool((r[1] or {}).get('title')), f'HTTP {r[0]}'))(
            self._site_json({'type': 'movie_details', 'query': '550'})))

        def image_proxy():
            url = poster.get('url')
            if not url:
                return None, 'skipped: no poster from the movie search'
            s, _, h, _ = self.fetch(f'{self.site}/proxy.php?' + urllib.parse.urlencode({'type': 'image_proxy', 'query': url}), timeout=20)
            ct = h.get('Content-Type', '')
            return s == 200 and ct.startswith('image/'), ct or f'HTTP {s}'
        add('card-image', 'Cards', 'Image proxy', image_proxy)

        def export_libs():
            s, b, _, _ = self.fetch(f'{self.site}/', timeout=20)
            import re
            m = re.search(r'<script[^>]+src="(https://[^"]*html2canvas[^"]*)"', b.decode('utf-8', 'replace'))
            src = m.group(1) if m else ''
            if not src:
                return False, 'html2canvas tag not found on the page'
            s1, _, _, _ = self.fetch(src, timeout=15)
            s2, _, _, _ = self.fetch(f'{self.site}/js/vendor/jsquash-jpeg/encode.js', timeout=15)
            return s1 == 200 and s2 == 200, f'html2canvas {s1}, JPEG encoder {s2}'
        add('card-export', 'Cards', 'Export libraries', export_libs)

        # --- site: deploy + certificate
        def deploy():
            s, _, h, _ = self.fetch(f'{self.site}/js/app.js', timeout=15, method='HEAD')
            lm = h.get('Last-Modified')
            if s != 200 or not lm:
                return False, f'HTTP {s}'
            deployed = email.utils.parsedate_to_datetime(lm)
            gs, gb, _, _ = self.fetch('https://api.github.com/repos/Avuduru/CCCC/commits/main', timeout=10,
                                      headers={'Accept': 'application/vnd.github+json'})
            when = deployed.astimezone(self.tz).strftime('%b %d, %H:%M')
            if gs != 200:
                return True, f'deployed {when} (GitHub not checked)'
            committed = datetime.fromisoformat(json.loads(gb)['commit']['committer']['date'].replace('Z', '+00:00'))
            lag = (committed - deployed).total_seconds() / 60
            if lag > 20 and (now_utc() - committed).total_seconds() > 20 * 60:
                return False, f'stuck: main changed {int(lag)} min after the last deploy ({when})'
            return True, f'deployed {when}'
        add('deploy', 'Site', 'Last deploy', deploy)

        def cert():
            host = urllib.parse.urlsplit(self.site).hostname
            ctx = ssl.create_default_context()
            with socket.create_connection((host, 443), timeout=10) as sock:
                with ctx.wrap_socket(sock, server_hostname=host) as tls:
                    exp = ssl.cert_time_to_seconds(tls.getpeercert()['notAfter'])
            days = int((exp - time.time()) / 86400)
            return days >= 14, f'expires in {days} days'
        add('cert', 'Site', 'HTTPS certificate', cert)

        # --- security: headers + private paths stay private (any failure alerts at once)
        def headers():
            s, _, h, _ = self.fetch(f'{self.site}/', timeout=15)
            csp = h.get('Content-Security-Policy', '')
            missing = [n for n, ok in [('CSP', "default-src 'self'" in csp and "'unsafe-inline'" not in csp.split('script-src', 1)[-1].split(';')[0]),
                                       ('HSTS', bool(h.get('Strict-Transport-Security'))),
                                       ('X-Frame-Options', bool(h.get('X-Frame-Options'))),
                                       ('nosniff', h.get('X-Content-Type-Options') == 'nosniff')] if not ok]
            return not missing, 'all present' if not missing else 'missing/weak: ' + ', '.join(missing)
        add('sec-headers', 'Security', 'Security headers', headers, threshold=1)

        def private():
            leaks = []
            for p in PRIVATE_PATHS:
                s, _, _, _ = self.fetch(self.site + p, timeout=10)
                if s == 200:
                    leaks.append(p)
            s, _, _, _ = self.fetch(f'{self.site}/proxy.php?type=lookup&query=x&content_type=anime', timeout=10)
            if s != 404:
                leaks.append(f'lookup is on (HTTP {s})')
            return not leaks, f'{len(PRIVATE_PATHS)} private paths blocked, lookup off' if not leaks else 'EXPOSED: ' + ', '.join(leaks)
        add('sec-private', 'Security', 'Private files blocked', private, threshold=1)

        # --- real visitors (GoatCounter events from the site) + ratings stopped + counter receiving
        visits = {'pages_3h': None, 'events': {}}

        def load_visits():
            if visits['events'] or visits['pages_3h'] is not None:
                return
            end = (now_utc() + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
            d = self.gc('stats/hits', limit=200, start=(end - timedelta(hours=4)).strftime('%Y-%m-%dT%H:00:00Z'),
                        end=end.strftime('%Y-%m-%dT%H:00:00Z'))
            pages = 0
            for hit in d.get('hits', []):
                if hit.get('event'):
                    visits['events'][hit['path']] = hit.get('count', 0)
                else:
                    pages += hit.get('count', 0)
            visits['pages_3h'] = pages

        for ev, label, limit in SIGNALS:
            def signal(ev=ev, limit=limit):
                load_visits()
                n = visits['events'].get(ev, 0)
                return n < limit, f'{n} visitor{"s" if n != 1 else ""} hit it in the last ~3 h'
            add(f'vis-{ev}', 'Visitors', label, signal)

        def rejected():
            load_visits()
            rej = {k[len('save-rejected-'):]: v for k, v in visits['events'].items() if k.startswith('save-rejected-')}
            n = sum(rej.values())
            return n < 10, ('none' if not n else ', '.join(f'{v}× HTTP {k}' for k, v in sorted(rej.items()))) + ' in the last ~3 h'
        add('vis-rejected', 'Visitors', 'Saves refused (4xx)', rejected)

        def stalled():
            load_visits()
            s, d, _ = self._site_json({'type': 'stats'})
            last, dbnow = (d or {}).get('last_rating_at'), (d or {}).get('db_now')
            if not last or not dbnow:
                return None, 'needs PR #77 live (last_rating_at)'
            hrs = (datetime.fromisoformat(dbnow) - datetime.fromisoformat(last)).total_seconds() / 3600
            v = visits['pages_3h'] or 0
            ok = not (hrs >= 3 and v >= 15)
            return ok, f'last rating {hrs:.1f} h ago, {v} visitors in ~3 h' + ('' if ok else ': saving may be broken')
        add('vis-stalled', 'Visitors', 'Ratings still coming in', stalled)

        def counter():
            load_visits()
            s, d, _ = self._site_json({'type': 'stats'})
            act = (d or {}).get('activity_3h')
            v = visits['pages_3h'] or 0
            if act is None:
                return None, 'needs PR #77 live (activity_3h)'
            ok = not (act >= 3 and v == 0)
            return ok, f'{v} visits counted, {act} ratings in ~3 h' + ('' if ok else ': the visit counter is not receiving')
        add('vis-counter', 'Visitors', 'Visit counter receiving', counter)
        return out

    # ------------------------------------------------------------------ alerting
    def notify(self, title, message, priority=3, tags=None):
        entry = {'at': now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), 'title': title, 'message': message, 'priority': priority}
        self.sent.insert(0, entry)
        del self.sent[20:]
        if not self.topic:
            entry['delivered'] = False
            return False
        try:
            s, _, _, _ = self.fetch(self.ntfy, method='POST', timeout=15, headers={'Content-Type': 'application/json'},
                                    data=json.dumps({'topic': self.topic, 'title': title, 'message': message,
                                                     'priority': priority, 'tags': tags or []}).encode())
            entry['delivered'] = s == 200
        except Exception:
            entry['delivered'] = False
        return entry['delivered']

    def process(self, results):
        """Update failure counters and send one batched message for what changed."""
        new, recovered, remind = [], [], []
        now = time.time()
        for c in results:
            self.checks[c['id']] = c
            if c['ok'] is None or c['owner'] == 'info':
                continue
            a = self.alerts.setdefault(c['id'], {'fails': 0, 'alerted': False, 'since': None, 'last_sent': 0})
            if c['ok']:
                if a['alerted']:
                    mins = int((now - (a['since'] or now)) / 60)
                    recovered.append(f"{c['name']}: OK again (was down ~{mins} min)")
                self.alerts[c['id']] = {'fails': 0, 'alerted': False, 'since': None, 'last_sent': 0}
                continue
            a['fails'] += 1
            a['since'] = a['since'] or now
            if not self.home_online:
                continue                                  # our own internet is down: don't blame the site
            if not a['alerted'] and a['fails'] >= c['threshold']:
                a['alerted'], a['last_sent'] = True, now
                new.append(c)
            elif a['alerted'] and now - a['last_sent'] > REMIND_EVERY:
                a['last_sent'] = now
                remind.append(c)
        line = lambda c: f"{c['name']}: {c['note']}" + (' (outside service)' if c['owner'] == 'theirs' else '')
        if new:
            ours = [c for c in new if c['owner'] == 'ours']
            sec = any(c['group'] == 'Security' for c in new)
            pr = 5 if sec else (4 if ours else 2)
            title = ('SECURITY: ' if sec else '') + (f'muhafid: {len(new)} problem' + ('s' if len(new) > 1 else ''))
            self.notify(title, '\n'.join(line(c) for c in new), priority=pr,
                        tags=['rotating_light'] if pr >= 4 else ['warning'])
        if remind:
            self.notify('muhafid: still failing', '\n'.join(line(c) for c in remind), priority=3, tags=['hourglass'])
        if recovered:
            self.notify('muhafid: recovered', '\n'.join(recovered), priority=2, tags=['white_check_mark'])

    def heartbeat(self):
        local = datetime.now(self.tz)
        today = local.strftime('%Y-%m-%d')
        if local.hour < self.heartbeat_hour or self.last_heartbeat == today:
            return
        self.last_heartbeat = today
        failing = [c for c in self.checks.values() if c['ok'] is False and c['owner'] != 'info']
        extra = ''
        try:
            s, d, _ = self._site_json({'type': 'stats'})
            ratings = sum(h.get('new', 0) for h in (d or {}).get('hourly', [])[-24:])
            extra = f'\n{ratings} new ratings in the last 24 h · {(d or {}).get("total_raters", "?")} raters all-time'
        except Exception:
            pass
        if failing:
            self.notify(f'Daily: {len(failing)} problem' + ('s' if len(failing) > 1 else ''),
                        '\n'.join(f"{c['name']}: {c['note']}" for c in failing) + extra, priority=3, tags=['clipboard'])
        else:
            self.notify('Daily: all good', f'{len(self.checks)} checks passing' + extra, priority=2, tags=['green_circle'])

    # ------------------------------------------------------------------ loop + snapshot
    def run_once(self, deep=True, dry=False):
        results = self.quick()
        if deep and self.home_online:
            results += self.deep()
        with self.lock:
            if dry:                       # manual test: show results, send/save nothing
                for c in results:
                    self.checks[c['id']] = c
                return
            self.process(results)
            self.heartbeat()
            self._save()

    def loop(self):
        last_deep = 0.0
        while True:
            t0 = time.time()
            do_deep = t0 - last_deep >= DEEP_EVERY
            try:
                self.run_once(deep=do_deep)
                if do_deep:
                    last_deep = t0
            except Exception as e:  # never let the monitor thread die
                print(f'monitor error: {type(e).__name__}: {e}', flush=True)
            time.sleep(max(5, QUICK_EVERY - (time.time() - t0)))

    def start(self):
        threading.Thread(target=self.loop, name='monitor', daemon=True).start()

    def snapshot(self):
        with self.lock:
            checks = sorted(self.checks.values(),
                            key=lambda c: (GROUP_ORDER.index(c['group']) if c['group'] in GROUP_ORDER else 99))
            failing = [c for c in checks if c['ok'] is False and c['owner'] != 'info']
            return {
                'checked': max((c['checked'] for c in checks), default=None),
                'failed': len(failing),
                'ours_failing': [c['name'] for c in failing if c['owner'] == 'ours'],
                'home_online': self.home_online,
                'alerts_on': bool(self.topic),
                'sent': self.sent[:8],
                'checks': [{k: c[k] for k in ('group', 'name', 'ok', 'ms', 'note', 'owner')} for c in checks],
            }
