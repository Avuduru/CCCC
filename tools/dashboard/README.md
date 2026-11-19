# CCCC home dashboard

A live page for the owner's **home network only** (runs in a Proxmox container, never on muhafid.com;
the Caddyfile blocks `/tools` on the site). Refreshes every minute.

- **Visits** — GoatCounter API (read-only key, kept in `/opt/cccc-dash/dash.env`, never sent to the browser).
- **Ratings** — `https://muhafid.com/proxy.php?type=stats` (public, counts only).
- **Services** — a read-only deep check every 10 min while the page is open: the site, database, last deploy,
  every search type through the site, card features (details, translation, HLTB, game cover, image proxy),
  and the sources on their own. A fresh game search at most hourly (RAWG budget). Never saves a rating.

Standard-library Python 3 (`server.py`) + one static page (`static/`). Charts: Chart.js, map: d3 + world-atlas,
flags: flagcdn.com, logos: simple-icons — loaded by the browser from CDNs.

## Install / update (inside the container, as root)

```bash
curl -fsSL https://raw.githubusercontent.com/Avuduru/CCCC/main/tools/dashboard/install.sh -o /root/install.sh
bash /root/install.sh            # or: bash /root/install.sh <branch>
nano /opt/cccc-dash/dash.env     # GOATCOUNTER_API_KEY=...  (first time only)
systemctl restart cccc-dash
```

Logs: `journalctl -u cccc-dash -f`. Local test: `DASH_ENV=/path/to/env python3 tools/dashboard/server.py`.
