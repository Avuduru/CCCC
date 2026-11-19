# CCCC home dashboard

A live page for the owner's **home network only** (runs in a Proxmox container, never on muhafid.com;
the Caddyfile blocks `/tools` on the site). Refreshes every minute.

- **Visits** — GoatCounter API (read-only key, kept in `/opt/cccc-dash/dash.env`, never sent to the browser).
- **Ratings** — `https://muhafid.com/proxy.php?type=stats` (public, counts only).
- **Monitor** (`monitor.py`, runs all day in the background, read-only — never saves a rating):
  every 2 min the home internet, home page and database; every 10 min every search type and card feature
  through the site, the sources on their own, security (headers + private files blocked), the TLS certificate,
  a stuck deploy (GitHub `main` newer than the live files), the export libraries, real visitors' failures
  (GoatCounter events `save-failed`, `export-failed`, `copy-failed`, `js-error`, refused saves), "ratings
  stopped" and "visit counter not receiving". Searches retry a second title before failing.
- **Phone alerts** — Telegram (`TELEGRAM_BOT_TOKEN` from @BotFather + `TELEGRAM_CHAT_ID`, found by
  `server.py --telegram-setup` after messaging the bot; low-priority messages arrive silently) and/or ntfy (`NTFY_TOPIC`): our problems after 2 failed runs, security at once (urgent), outside
  services only after ~1 h (low); one batched message, "recovered" when it clears, a reminder every 6 h,
  nothing while the home internet is down, and a daily summary at `HEARTBEAT_HOUR` — if it stops arriving,
  the monitor itself is down.

**Still not covered:** visitors with ad-blockers (their errors are invisible), the CDN/WAF blocking real
visitors in some country, CranL resources (CPU/memory/disk), RAWG's remaining monthly quota, how the card
looks (Arabic shaping, iOS), and everything while the home internet or the Proxmox box is off.

Standard-library Python 3 (`server.py`) + one static page (`static/`). Charts: Chart.js, map: d3 + world-atlas,
flags: flagcdn.com, logos: simple-icons — loaded by the browser from CDNs.

## Install / update (inside the container, as root)

Updates itself every night (~04:00 New York, `cccc-dash-update.timer`): downloads `main`, restarts only if a
file changed, and rolls back if the new version doesn't start. Run it by hand to update at once.

```bash
curl -fsSL https://raw.githubusercontent.com/Avuduru/CCCC/main/tools/dashboard/install.sh -o /root/install.sh
bash /root/install.sh            # or: bash /root/install.sh <branch>
nano /opt/cccc-dash/dash.env     # GOATCOUNTER_API_KEY=...  (first time only)
systemctl restart cccc-dash
runuser -u dash -- env DASH_ENV=/opt/cccc-dash/dash.env python3 /opt/cccc-dash/server.py --test-alert
runuser -u dash -- env DASH_ENV=/opt/cccc-dash/dash.env python3 /opt/cccc-dash/server.py --check-once
```

Logs: `journalctl -u cccc-dash -f`. Local test: `DASH_ENV=/path/to/env python3 tools/dashboard/server.py`.
