# Security

How muhafid.com (CCCC) is defended, what to check when changing it, and the account/hosting
hardening that lives outside this repo.

## Reporting a vulnerability

Open a private report via GitHub Security Advisories on `Avuduru/cccc`, or email the maintainer
(see the profile on [@Avuduru](https://github.com/Avuduru)). Please don't file a public issue for a
security problem. Include steps to reproduce; a fix usually ships within a few days.

## Attack surface

The site has **no accounts, logins, sessions or payments**. The only server code that takes input is:

- **`proxy.php`** — calls the data-source APIs (keys stay server-side), proxies cover images, translates
  synopses, and stores anonymous rating counts.
- **`index.php`** — routes clean URLs to the page files and sets the response security headers.

Everything else is static HTML/CSS/JS.

## Application-level controls (in this repo)

- **Image proxy (`type=image_proxy`)** — fetches only from the hosts in `$allowedImageHosts`
  (TMDB, RAWG, SteamGridDB, AniList, MyAnimeList, Open Library's covers, Google Books). `archive.org`
  is accepted **only** as the redirect an Open Library cover issues (`/download/*_covers_*` →
  `iaNNN.us.archive.org`), never as a starting point. Every redirect hop is re-checked, the connection
  is pinned to the IP that was checked (no DNS-rebinding swap), only raster images are returned, and
  each response carries `nosniff` + `Content-Security-Policy: default-src 'none'; sandbox`. 10 s timeout,
  5 MB cap; TMDB only in the sizes the site uses (w92–w1280, never `original`), since every relayed byte counts against the plan's monthly bandwidth. **Adding a data source means adding its image host here**, or covers won't load.
- **Upstream parameters** — `movie_details`/`tv_details` take a numeric id only, `game_details` a slug,
  Open Library a `/works/OL…W` key. So a request can't be steered to other upstream endpoints.
- **AniList** search text is passed as a GraphQL **variable**, never spliced into the query.
- **SQL** — every query uses prepared statements; the only interpolated names are hardcoded column lists.
- **Secret safety net** — an output buffer strips every configured API key and the DB password from
  every response, and RAWG pagination URLs (which embed the key) are removed.
- **Rating log (`type=log`)** — `content_id` must match the id shape for its type; vote levels are
  clamped to 0–3; a work's title is set by its **first** vote only (later voters can't rename it);
  the payload is capped (16 KB) and the content-type whitelisted; in production, if the DB is down the
  endpoint returns 503 rather than writing an unbounded fallback file. The rating's `guide_version` is
  set server-side from `GUIDE_VERSION` and never read from the request.
- **Stored user text (the classifier's own `synopsis`)** — the one piece of free-form user-generated
  content stored. It is kept as **plain text** (control characters stripped, capped at 2000), and is
  **never rendered server-side**. ⚠️ Whatever later **displays** it (e.g. a community/consensus page)
  **must HTML-escape it** (stored-XSS risk lives in the display, not the storage) and should have a way
  to **hide/moderate** abuse, spam or personal info. Until such a page exists, the text is write-only.
- **Per-work consensus (`type=lookup`)** — **switched off** (`LOOKUP_ENABLED = false`, returns 404).
  No page uses it yet, and an open endpoint would let anyone harvest every work's ratings. Its
  individual-rating rows (rater names) were removed; when the per-work pages arrive, re-enable it with
  totals only and a per-IP rate limit.
- **Rate limits** (`rateLimited()`, per hashed visitor IP, counters in `data/ratelimit/`):
  240 API calls / 10 min, 100 images / 10 min, 30 rated works / 10 min; calls that reach RAWG 30 / 10 min and
  100 / day (one script can't spend the site's 20,000-a-month RAWG quota). Server-side caches (searches, game details,
  covers) are capped at 3,000 files per bucket, so unique queries can't fill the disk.
- **Rating integrity** — a new work's title is taken from its source by id (AniList, Kitsu, Jikan, TMDB, RAWG,
  Open Library — `canonicalTitle()`), never from the browser (the card title is editable and the API can be
  called directly); an id the source says doesn't exist is refused. If the source can't be reached the sent
  title is kept (capped) so a real vote isn't lost — the residual gap. Manual entries keep their typed title
  and are left out of the public `stats` top list.
- **Stored IP hash** — `ipHash()` = HMAC-SHA256 keyed with `IP_HASH_SECRET`, so the stored hashes can't be
  reversed by hashing every IPv4 address. Rows saved under the old plain SHA-256 move to the keyed hash the
  next time that visitor rates (no double counting). Without the secret it falls back to plain SHA-256.
- **Client IP** (`clientIp()`) — used for the above. Reads `TRUSTED_IP_HEADER` if set (e.g. `X-Real-IP`),
  else the last `X-Forwarded-For` entry, else `REMOTE_ADDR`; the value must parse as an IP. **Set
  `TRUSTED_IP_HEADER`** to whatever the host's edge guarantees to overwrite, so a client can't forge it.
- **Translate** — the synopsis is sent **base64url-encoded** in `q=` (only `A–Z a–z 0–9 _ -`), so text
  with a `%`, quote or `<` never appears in the URL and can't false-positive the edge WAF. `proxy.php`
  decodes it; plain `?query=` still works.
- **Response headers** — pages get a `Content-Security-Policy` (scripts from self + cdnjs only, pinned
  with SRI; **no `'unsafe-inline'` for scripts** — `index.php` lists the SHA-256 of each page's own inline
  scripts, import map included, computed when the page is built, so an injected script is refused),
  `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`,
  HSTS (`includeSubDomains`); `X-Powered-By` is removed. Pages answer GET/HEAD only (405 otherwise).
  **New external scripts/fonts/fetch targets must be added to the CSP in `index.php`.** Inline scripts
  need nothing extra (hashed automatically); inline `on…=` handlers are not allowed and would be blocked.
  Note: `local-router.php` (dev server) doesn't go through `index.php`, so it sends no CSP — test CSP
  through `index.php`.
- **Visit counting (GoatCounter)** — off unless the `GOATCOUNTER_CODE` env var is set (validated
  `[a-z0-9-]`). Then `index.php` adds our own copy of `count.v5.js` (`js/vendor/goatcounter/`, ISC, no
  third-party script) to every page and allows only `https://<code>.goatcounter.com` in `connect-src`.
  No cookies; sends path, referrer, screen size and a bot flag. Events (`js/analytics.js`): `searched-<type>`,
  `no-results-<type>`, `picked-<type>`, `share`, `post-x`, `copy-text` — names only, never the search text or
  the work. Exports/copies are counted in the DB (`classifications.action`), not here.
- **Caching** — only versioned static files get the year-long immutable cache; pages (`no-cache`) and
  `proxy.php` (`no-store`) are never long-cached, so a `?v=` can't pin a dynamic response at the edge.
- **File access** — the `Caddyfile` 404s dotfiles, `data/`, `Docs/`, `tools/`, `lang/` and config files.

## Edge layer (CranL, outside this repo)

Production sits behind the host's CDN edge: an **OWASP Core Rule Set WAF** (keep it in **Block** mode),
bot challenge, IP-reputation lists, per-IP flood limits, and a cache. The app controls above are the
primary defense; the edge is a second layer. If a legitimate request is ever blocked, check the WAF
**Events** and add a narrow, path-scoped **exclusion** — don't disable a rule globally.

## When you change things — security checklist

- Added a data source → add its image host to `$allowedImageHosts`.
- Added an external script/font/`fetch()` target → add it to the CSP in `index.php`.
- Added a page → add it to `sitemap.xml`; it inherits the headers only if served through `index.php`.
- Added a `proxy.php` endpoint that builds an upstream URL from input → validate the input to a strict
  shape first (see the existing id/slug checks).
- New user-controlled text that reaches a URL the WAF inspects → consider base64url (see Translate).

## Owner hardening — not in the repo (do these in GitHub / CranL)

- [ ] **GitHub 2FA** and **branch protection on `main`** (every push to `main` auto-deploys).
- [ ] **CranL 2FA.**
- [ ] **WAF in Block mode** (CranL → app → Security → Firewall).
- [ ] **Minimum TLS 1.2** (disable TLS 1.0/1.1) — CranL edge setting or a support request. *Low risk:
      modern browsers already refuse 1.0/1.1.*
- [ ] **`TRUSTED_IP_HEADER`** set in the CranL Environment once support confirms which header carries
      the real client IP.
- [ ] **`IP_HASH_SECRET`** set in the CranL Environment (`openssl rand -hex 32`), then redeploy.
- [x] **Database not reachable from the internet** — CranL applied an IP allowlist (app IP only), 2026-11-19.
      Side effect: a desktop DB client (DBeaver) needs its own IP added by CranL support.
- [ ] **DB connection encrypted** — `getDB()` uses TLS by default (`DB_TLS=prefer`). Once live and saves
      work, set `DB_TLS=require` in the CranL Environment so it can never fall back to plain. The
      certificate isn't verified (self-signed, regenerated), so this stops eavesdropping, not impersonation.
- [ ] Rotate any API key ever pasted outside `.env` / the CranL dashboard.

## Audit history

- **2026-11 — full review + two independent passes.** Reviewed SSRF/open-proxy, injection (SQL,
  GraphQL, path/URL), XSS (reflected/stored/DOM), secret exposure (responses + git history), file/path
  access, headers/CSP, CORS, clickjacking, rate-limiting/abuse, cache poisoning, third-party integrity,
  and HTTP methods. Findings fixed: image-proxy open-relay (arbitrary pages, incl. via the Wayback
  Machine) → host allowlist + redirect re-checks; upstream path injection → strict id/slug validation;
  `?v=` edge cache poisoning → caching narrowed to static files; log endpoint → id/level/title/size
  limits + rate limit + no unbounded fallback; WAF false-positive on `%` in synopses → base64url
  translate. No secrets were ever committed (the one key-shaped string in history is a placeholder).
