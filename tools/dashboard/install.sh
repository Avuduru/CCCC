#!/bin/bash
# Install or update the CCCC home dashboard inside a Debian container.
#   bash install.sh [git-ref]      (default ref: main)
# Run as root inside the container. Safe to run again (it also runs nightly, see the timer below):
#   * downloads everything first and checks it, so a failed download changes nothing;
#   * restarts the dashboard only if a file changed;
#   * if the new version doesn't start, puts the previous one back.
# dash.env (keys, alert settings) is created once and never overwritten.
set -euo pipefail

REF="${1:-main}"
BASE="https://raw.githubusercontent.com/Avuduru/CCCC/${REF}/tools/dashboard"
DIR=/opt/cccc-dash
FILES="server.py monitor.py static/index.html static/app.js static/style.css"
UNIT=/etc/systemd/system/cccc-dash.service

[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
command -v python3 >/dev/null || { apt-get update && apt-get -y install python3; }
command -v curl >/dev/null || { apt-get update && apt-get -y install curl ca-certificates; }

# Always run the newest installer: fetch it first and, if it changed, save it over this file and
# re-run it (an old installer once missed a new file and the dashboard failed to start).
if [ -z "${CCCC_INSTALLER_FRESH:-}" ]; then
  NEW=$(mktemp)
  if curl -fsSL "$BASE/install.sh" -o "$NEW" && bash -n "$NEW"; then
    if ! cmp -s "$NEW" "$0"; then
      cp "$NEW" "$0" 2>/dev/null || true
      echo "Installer updated; running the new one…"
      CCCC_INSTALLER_FRESH=1 exec bash "$NEW" "$REF"
    fi
  fi
  rm -f "$NEW"
fi

id dash >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin dash
mkdir -p "$DIR/static"

# 1. Download everything into a temporary folder and check it before touching the live files.
echo "Downloading the dashboard ($REF)…"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/static"
for f in $FILES; do
  curl -fsSL "$BASE/$f" -o "$TMP/$f"
done
python3 -m py_compile "$TMP/server.py" "$TMP/monitor.py"
rm -rf "$TMP/__pycache__"

CHANGED=0
for f in $FILES; do
  cmp -s "$TMP/$f" "$DIR/$f" 2>/dev/null || CHANGED=1
done

# 2. Config: created once, never overwritten.
if [ ! -f "$DIR/dash.env" ]; then
  printf 'GOATCOUNTER_API_KEY=\nGOATCOUNTER_CODE=kureiji\nSITE=https://muhafid.com\nPORT=8090\n' > "$DIR/dash.env"
  # ntfy topic only on a first install (delete the line to turn ntfy off; it won't come back)
  printf 'NTFY_TOPIC=cccc-%s\n' "$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$DIR/dash.env"
fi
grep -q '^ALERT_TZ=' "$DIR/dash.env" || echo 'ALERT_TZ=America/New_York' >> "$DIR/dash.env"
grep -q '^HEARTBEAT_HOUR=' "$DIR/dash.env" || echo 'HEARTBEAT_HOUR=9' >> "$DIR/dash.env"

# 3. Swap in the new files, keeping the previous ones for a rollback.
if [ "$CHANGED" = 1 ]; then
  rm -rf "$DIR/.prev" && mkdir -p "$DIR/.prev/static"
  for f in $FILES; do if [ -f "$DIR/$f" ]; then cp -p "$DIR/$f" "$DIR/.prev/$f"; fi; done
  for f in $FILES; do cp "$TMP/$f" "$DIR/$f"; done
fi

# Code belongs to root (the service can read it, not change it); only root + the service read the key.
chown -R root:root "$DIR"
chown root:dash "$DIR/dash.env"
chmod 640 "$DIR/dash.env"
chmod 755 "$DIR" "$DIR/static"
chmod 644 "$DIR/server.py" "$DIR/monitor.py" "$DIR"/static/*
rm -rf "$DIR/__pycache__"

cat > "$UNIT" <<EOF
[Unit]
Description=CCCC home dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=dash
Group=dash
Environment=DASH_ENV=$DIR/dash.env
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/usr/bin/python3 $DIR/server.py
Restart=always
RestartSec=5
StateDirectory=cccc-dash
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

# Nightly auto-update (04:00 + up to 30 min random delay; catches up after a power cut)
cat > /etc/systemd/system/cccc-dash-update.service <<EOF
[Unit]
Description=Update the CCCC home dashboard from GitHub (main)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /root/install.sh main
EOF
cat > /etc/systemd/system/cccc-dash-update.timer <<EOF
[Unit]
Description=Nightly update of the CCCC home dashboard

[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF
if [ "$(readlink -f "$0")" != /root/install.sh ]; then cp "$0" /root/install.sh 2>/dev/null || true; fi

systemctl daemon-reload
systemctl enable cccc-dash >/dev/null 2>&1
systemctl enable --now cccc-dash-update.timer >/dev/null 2>&1

start_ok() { sleep 3; systemctl is-active --quiet cccc-dash; }

if [ "$CHANGED" = 1 ] || ! systemctl is-active --quiet cccc-dash; then
  systemctl restart cccc-dash
  # Some container setups refuse systemd's sandbox options (status 226/NAMESPACE): drop them if so.
  if ! start_ok && journalctl -u cccc-dash -n 5 --no-pager | grep -q NAMESPACE; then
    echo "Service didn't start with sandboxing; retrying without it…"
    mkdir -p /etc/systemd/system/cccc-dash.service.d
    printf '[Service]\nProtectSystem=no\nProtectHome=no\nPrivateTmp=no\n' > /etc/systemd/system/cccc-dash.service.d/no-sandbox.conf
    systemctl daemon-reload
    systemctl restart cccc-dash
  fi
  # The new version doesn't start: put the previous one back.
  if ! start_ok && [ -d "$DIR/.prev" ]; then
    echo "The new version did not start. Rolling back:"
    journalctl -u cccc-dash -n 15 --no-pager || true
    for f in $FILES; do if [ -f "$DIR/.prev/$f" ]; then cp -p "$DIR/.prev/$f" "$DIR/$f"; fi; done
    systemctl restart cccc-dash
    if start_ok; then echo "Rolled back; the previous version is running."; else echo "Rollback did not start either."; fi
    exit 1
  fi
else
  echo "Already up to date."
fi

if systemctl is-active --quiet cccc-dash; then
  IP=$(hostname -I | awk '{print $1}')
  echo
  echo "Dashboard running:  http://${IP}:8090   (auto-update: nightly ~04:00)"
  if ! grep -q '^GOATCOUNTER_API_KEY=.' "$DIR/dash.env"; then
    echo "Next: add the GoatCounter key:  nano $DIR/dash.env   then:  systemctl restart cccc-dash"
  fi
  if ! grep -q '^TELEGRAM_CHAT_ID=.' "$DIR/dash.env"; then
    echo "Phone alerts, either or both:"
    echo "  Telegram: put TELEGRAM_BOT_TOKEN=... in $DIR/dash.env, message your bot, then run:"
    echo "            DASH_ENV=$DIR/dash.env python3 $DIR/server.py --telegram-setup   (then restart)"
    TOPIC=$(grep '^NTFY_TOPIC=' "$DIR/dash.env" | cut -d= -f2- || true)
    if [ -n "$TOPIC" ]; then echo "  ntfy app: subscribe to this topic (keep it private):  $TOPIC"; fi
  fi
else
  echo "The service did not start. Details:"
  journalctl -u cccc-dash -n 30 --no-pager || true
  exit 1
fi
