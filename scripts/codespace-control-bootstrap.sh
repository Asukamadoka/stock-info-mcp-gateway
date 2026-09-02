#!/usr/bin/env bash
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
STATE_DIR="${REPO}/.codespace-control"
PORT="${CODESPACE_CONTROL_PORT:-8765}"
REGISTER_URL="https://aneonwkxfhgqywtczmvc.supabase.co/functions/v1/codespace-control-register"
SERVER="${REPO}/scripts/codespace-control-server.py"
LOG_DIR="${STATE_DIR}/logs"

mkdir -p "${STATE_DIR}" "${LOG_DIR}"
chmod 700 "${STATE_DIR}"

stop_pid_file() {
  local f="$1"
  if [ -f "$f" ]; then
    local pid
    pid="$(cat "$f" 2>/dev/null || true)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  fi
}

stop_pid_file "${STATE_DIR}/server.pid"
stop_pid_file "${STATE_DIR}/cloudflared.pid"
pkill -f "cloudflared tunnel --url http://127.0.0.1:${PORT}" 2>/dev/null || true

python3 - <<PY
from pathlib import Path
import secrets
p=Path("${STATE_DIR}/capability")
p.write_text(secrets.token_urlsafe(32))
p.chmod(0o600)
PY

CAP="$(cat "${STATE_DIR}/capability")"

nohup python3 "${SERVER}" --repo "${REPO}" --state-dir "${STATE_DIR}" --port "${PORT}" > "${LOG_DIR}/server.log" 2>&1 &
echo $! > "${STATE_DIR}/server.pid"

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/${CAP}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:${PORT}/${CAP}/health" >/dev/null

if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(uname -m)"
  case "${ARCH}" in
    x86_64) CF_ARCH="amd64" ;;
    aarch64|arm64) CF_ARCH="arm64" ;;
    *) echo "unsupported architecture: ${ARCH}" >&2; exit 1 ;;
  esac
  mkdir -p "${HOME}/.local/bin"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o "${HOME}/.local/bin/cloudflared"
  chmod +x "${HOME}/.local/bin/cloudflared"
  export PATH="${HOME}/.local/bin:${PATH}"
fi

: > "${LOG_DIR}/cloudflared.log"
nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" > "${LOG_DIR}/cloudflared.log" 2>&1 &
echo $! > "${STATE_DIR}/cloudflared.pid"

TUNNEL=""
for _ in $(seq 1 60); do
  TUNNEL="$(grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' "${LOG_DIR}/cloudflared.log" | tail -1 || true)"
  [ -n "${TUNNEL}" ] && break
  sleep 1
done
[ -n "${TUNNEL}" ] || { cat "${LOG_DIR}/cloudflared.log" >&2; exit 1; }

printf '%s' "${TUNNEL}" > "${STATE_DIR}/tunnel-url"
chmod 600 "${STATE_DIR}/tunnel-url"

BODY="$(python3 - "${TUNNEL}" "${CAP}" <<'PY'
import json, sys
print(json.dumps({"host": sys.argv[1], "capability": sys.argv[2], "ttl_minutes": 360}))
PY
)"

curl -fsS -X POST "${REGISTER_URL}" -H "content-type: application/json" --data "${BODY}" > "${STATE_DIR}/registration.json"
chmod 600 "${STATE_DIR}/registration.json"

python3 - "${STATE_DIR}/registration.json" <<'PY'
import json, sys
data=json.load(open(sys.argv[1]))
if data.get("ok") is not True:
    raise SystemExit("registration failed")
print("codespace control registered")
PY
