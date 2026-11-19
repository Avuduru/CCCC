#!/bin/bash
# Install or update the CCCC home dashboard inside a Debian container.
#   bash install.sh [git-ref]      (default ref: main)
# Run as root inside the container. Safe to run again: updates the code, keeps dash.env.
set -euo pipefail

REF="${1:-main}"
BASE="https://raw.githubusercontent.com/Avuduru/CCCC/${REF}/tools/dashboard"
DIR=/opt/cccc-dash
UNIT=/etc/systemd/system/cccc-dash.service

[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }

# Always run the newest installer: fetch it first and, if it changed, save it over this file and
# re-run it (an old installer once missed a new file and the dashboard failed to start).
if [ -z "${CCCC_INSTALLER_FRESH:-}" ] && command -v curl >/dev/null; then
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
command -v python3 >/dev/null || { apt-get update && apt-get -y install python3; }
command -v curl >/dev/null || { apt-get update && apt-get -y install curl ca-certificates; }

id dash >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin dash
mkdir -p "$DIR/static"

echo "Downloading the dashboard ($REF)…"
for f in server.py monitor.py static/index.html static/app.js static/style.css; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
python3 -m py_compile "$DIR/server.py" "$DIR/monitor.py"

# Config: created once, never overwritten. The key is added by hand (see below).
if [ ! -f "$DIR/dash.env" ]; then
  printf 'GOATCOUNTER_API_KEY=\nGOATCOUNTER_CODE=kureiji\nSITE=https://muhafid.com\nPORT=8090\n' > "$DIR/dash.env"
fi
# Phone alerts (ntfy): a random private topic name, created once. Anyone who knows it can read
# the alerts, so it's long and random. ALERT_TZ / HEARTBEAT_HOUR = when the daily summary comes.
if ! grep -q '^NTFY_TOPIC=' "$DIR/dash.env"; then
  printf 'NTFY_TOPIC=cccc-%s\nALERT_TZ=America/New_York\nHEARTBEAT_HOUR=9\n' "$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$DIR/dash.env"
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

systemctl daemon-reload
systemctl enable cccc-dash >/dev/null 2>&1
systemctl restart cccc-dash
sleep 2

# Some container setups refuse systemd's sandbox options (status 226/NAMESPACE): drop them if so.
if ! systemctl is-active --quiet cccc-dash; then
  echo "Service didn't start with sandboxing; retrying without it…"
  mkdir -p /etc/systemd/system/cccc-dash.service.d
  printf '[Service]\nProtectSystem=no\nProtectHome=no\nPrivateTmp=no\n' > /etc/systemd/system/cccc-dash.service.d/no-sandbox.conf
  systemctl daemon-reload
  systemctl restart cccc-dash
  sleep 2
fi

if systemctl is-active --quiet cccc-dash; then
  IP=$(hostname -I | awk '{print $1}')
  echo
  echo "Dashboard running:  http://${IP}:8090"
  TOPIC=$(grep '^NTFY_TOPIC=' "$DIR/dash.env" | cut -d= -f2-)
  echo "Phone alerts, either or both:"
  echo "  Telegram: put TELEGRAM_BOT_TOKEN=... in $DIR/dash.env, message your bot, then run:"
  echo "            DASH_ENV=$DIR/dash.env python3 $DIR/server.py --telegram-setup   (then restart)"
  echo "  ntfy app: subscribe to this topic (keep it private):  $TOPIC"
  echo "Test it:  runuser -u dash -- env DASH_ENV=$DIR/dash.env python3 $DIR/server.py --test-alert"
  if ! grep -q '^GOATCOUNTER_API_KEY=.' "$DIR/dash.env"; then
    echo "Next: add the GoatCounter key:  nano $DIR/dash.env   then:  systemctl restart cccc-dash"
  fi
else
  echo "The service did not start. Details:"
  journalctl -u cccc-dash -n 30 --no-pager
  exit 1
fi
