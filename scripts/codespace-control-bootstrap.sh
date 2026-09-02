#!/usr/bin/env bash
set -euo pipefail
REPO="/workspaces/stock-info-mcp-gateway"
PORT=8765
STATE="$REPO/.codespace-control"
LOGS="$STATE/logs"
mkdir -p "$LOGS"; chmod 700 "$STATE"
cd "$REPO"
stop_pid(){ local f="$1"; if [ -f "$f" ]; then local p; p="$(cat "$f" 2>/dev/null || true)"; [ -n "$p" ] && kill "$p" 2>/dev/null || true; fi; }
stop_pid "$STATE/server.pid"
stop_pid "$STATE/cloudflared.pid"
python3 - <<'PY'
from pathlib import Path
import secrets
p=Path('/workspaces/stock-info-mcp-gateway/.codespace-control/capability')
p.write_text(secrets.token_urlsafe(32)); p.chmod(0o600)
PY
CAP="$(cat "$STATE/capability")"
nohup python3 "$REPO/scripts/codespace-control-server.py" >"$LOGS/server.log" 2>&1 & echo $! > "$STATE/server.pid"
sleep 1
kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null || { cat "$LOGS/server.log"; exit 1; }
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(uname -m)"; case "$ARCH" in x86_64) CF=amd64;; aarch64|arm64) CF=arm64;; *) echo "unsupported arch: $ARCH"; exit 1;; esac
  mkdir -p "$HOME/.local/bin"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF" -o "$HOME/.local/bin/cloudflared"
  chmod +x "$HOME/.local/bin/cloudflared"
  export PATH="$HOME/.local/bin:$PATH"
fi
: > "$LOGS/cloudflared.log"
nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >"$LOGS/cloudflared.log" 2>&1 & echo $! > "$STATE/cloudflared.pid"
HOST=""
for _ in $(seq 1 30); do HOST="$(grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' "$LOGS/cloudflared.log" | tail -1 || true)"; [ -n "$HOST" ] && break; sleep 1; done
[ -n "$HOST" ] || { cat "$LOGS/cloudflared.log"; exit 1; }
printf '%s' "$HOST" > "$STATE/tunnel-url"; chmod 600 "$STATE/tunnel-url"
curl -fsS "http://127.0.0.1:$PORT/$CAP/health" >/dev/null
BODY="$(python3 - "$HOST" "$CAP" <<'PY'
import json,sys
print(json.dumps({'host':sys.argv[1],'capability':sys.argv[2],'ttl_minutes':360}))
PY
)"
curl -fsS -X POST "https://aneonwkxfhgqywtczmvc.supabase.co/functions/v1/codespace-control-register" -H 'Content-Type: application/json' --data "$BODY" > "$STATE/register.json"
chmod 600 "$STATE/register.json"
python3 - "$STATE/register.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
if x.get('ok') is not True: raise SystemExit('registry registration failed')
print('codespace control registered')
PY
