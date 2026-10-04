#!/usr/bin/env bash
# Novatio - local Canton dev stack.
#
# `daml sandbox` only exposes Canton's gRPC ledger API, which a browser cannot
# speak. This script runs the two processes the frontend actually needs:
#
#   1. Canton daemon  - participant + local domain, DAR uploaded, parties allocated
#   2. `daml json-api` - HTTP JSON Ledger API in front of it
#
# The JSON API in SDK 2.10.6 refuses unsigned requests out of the box, so this
# script forges a local-only unsigned JWT (alg=none) carrying the namespaced
# party IDs. That is a dev shortcut for a node bound to 127.0.0.1 - it is not an
# auth design and must never point at a network-reachable ledger.
#
# Usage:  bash scripts/canton-local.sh [start|stop|status]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOVATIO_ROOT="$(cd "$HERE/.." && pwd)"

RUN_DIR="${TMPDIR:-/tmp}/novatio-canton"
PID_FILE="$RUN_DIR/canton.pid"
JSONAPI_PID_FILE="$RUN_DIR/jsonapi.pid"
PROXY_PID_FILE="$RUN_DIR/cors-proxy.pid"
BUILD_LOG="$RUN_DIR/build.log"
CANTON_LOG="$RUN_DIR/canton.log"
JSONAPI_LOG="$RUN_DIR/jsonapi.log"
PROXY_LOG="$RUN_DIR/cors-proxy.log"
SEED_LOG="$RUN_DIR/seed.log"
JWT_FILE="$RUN_DIR/novatio.jwt"
CONF_FILE="$RUN_DIR/canton.conf"
BOOTSTRAP_FILE="$RUN_DIR/bootstrap.canton"
DAR="$NOVATIO_ROOT/.daml/dist/novatio-1.0.0.dar"

# 6865 is Canton's ledger API, 6866/6867 the domain, 7576 the admin API, and
# 7575 the JSON Ledger API the frontend targets.
LEDGER_PORT=6865
JSONAPI_PORT=7575
ADMIN_PORT=7576
# The JSON API sets no CORS headers and 404s the preflight, so the browser
# reaches it through this shim. Frontend points here, not at JSONAPI_PORT.
PROXY_PORT=7577

export PATH="$HOME/.daml/bin:$PATH"

log() { printf '[canton-local] %s\n' "$1"; }

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

http_ok() { curl -sf -o /dev/null "$1" 2>/dev/null; }

# The browser can only reach the JSON API through the CORS proxy, so this
# asserts the preflight itself, not merely that the upstream answers 200.
preflight_ok() {
  curl -s -D- -o /dev/null -m 5 -X OPTIONS \
    -H "Origin: http://127.0.0.1:4180" \
    -H "Access-Control-Request-Method: POST" "$1" 2>/dev/null \
    | grep -qi "access-control-allow-origin"
}

# Forge a local-only unsigned JWT. The JSON API parses claims rather than
# verifying a signature, and the claims must use fully-qualified party ids.
# Lives in its own file so no nested heredoc is needed here.
write_token_script() {
  cat > "$RUN_DIR/forge-token.py" <<'TOKEN_SCRIPT'
import base64, json, sys

def b64url(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

ns = sys.argv[1]
names = ["Central_Reserve_Bank", "Acme_Electronics", "Global_Motors_OEM",
         "Canton_Capital_Desk", "Regulatory_Observer"]
ids = ["%s::%s" % (n, ns) for n in names]

header = {"alg": "none", "typ": "JWT"}
payload = {
    "ledgerId": "participant1",
    "participantId": "participant1",
    "applicationId": "novatio-ui",
    "exp": 9999999999,
    "iat": 1700000000,
    "admin": True,
    "actAs": ids,
    "readAs": ids,
}
with open(sys.argv[2], "w") as fh:
    fh.write("%s.%s." % (b64url(header), b64url(payload)))
with open(sys.argv[3], "w") as fh:
    fh.write(json.dumps(ids, indent=2))
TOKEN_SCRIPT
}

start() {
  if alive "$PID_FILE"; then
    log "already running (pid $(cat "$PID_FILE")); VITE_LEDGER_URL=http://127.0.0.1:$JSONAPI_PORT"
    return 0
  fi

  mkdir -p "$RUN_DIR" "$NOVATIO_ROOT/.daml/dist" "$NOVATIO_ROOT/frontend"

  log "building DAR"
  ( cd "$NOVATIO_ROOT" && daml build -o "$DAR" ) >"$BUILD_LOG" 2>&1
  if [ ! -f "$DAR" ]; then
    log "daml build failed - see $BUILD_LOG"
    tail -5 "$BUILD_LOG"
    return 1
  fi

  # Canton participant + local domain. Protocol version 5 is the lowest that
  # SDK 2.10.6 supports; in-memory storage keeps restarts clean.
  cat > "$CONF_FILE" <<CANTON_CONF
canton {
  participants {
    participant1 {
      storage { type = memory }
      admin-api { port = $ADMIN_PORT }
      ledger-api { port = $LEDGER_PORT }
    }
  }
  domains {
    da {
      storage { type = memory }
      public-api { port = 6866 }
      admin-api { port = 6867 }
      init { domain-parameters { protocol-version = "5" } }
    }
  }
}
CANTON_CONF

  # Nodes must be started before they resolve by name, hence nodes.local.start().
  #
  # Allocation only: `parties.enable` is the whole step, and re-enabling an
  # existing party is a CommandFailure, so this runs exactly once per fresh
  # node. Do not add a `parties.list`-based re-check here - on this console
  # group `parties.list` returns ListPartiesResult entries keyed by the
  # PARTICIPANT id, not by the business parties, so it cannot verify what we
  # want and silently reports every business party as "missing".
  cat > "$BOOTSTRAP_FILE" <<BOOTSTRAP_SCRIPT
nodes.local.start()
val participant = participants.local.head
participant.domains.connect_local(domains.local.head)
participant.dars.upload("$DAR")
Seq("Central_Reserve_Bank","Acme_Electronics","Global_Motors_OEM","Canton_Capital_Desk","Regulatory_Observer").foreach { name =>
  participant.parties.enable(name)
}
println("BOOTSTRAP_COMPLETE")
BOOTSTRAP_SCRIPT

  log "starting Canton (participant + local domain)"
  java -Xmx1g -jar "$HOME/.daml/sdk/2.10.6/canton/canton.jar" \
    daemon -c "$CONF_FILE" --bootstrap "$BOOTSTRAP_FILE" >"$CANTON_LOG" 2>&1 &
  echo $! > "$PID_FILE"
  local canton_pid
  canton_pid="$(cat "$PID_FILE")"

  local i
  for i in $(seq 1 90); do
    grep -q "BOOTSTRAP_COMPLETE" "$CANTON_LOG" 2>/dev/null && break
    kill -0 "$canton_pid" 2>/dev/null || { log "Canton exited - see $CANTON_LOG"; tail -5 "$CANTON_LOG"; return 1; }
    sleep 1
  done
  grep -q "BOOTSTRAP_COMPLETE" "$CANTON_LOG" || { log "Canton not ready - see $CANTON_LOG"; tail -5 "$CANTON_LOG"; return 1; }
  log "Canton ready (pid $canton_pid)"

  log "starting JSON Ledger API on 127.0.0.1:$JSONAPI_PORT"
  daml json-api --ledger-host localhost --ledger-port "$LEDGER_PORT" \
    --http-port "$JSONAPI_PORT" --address 127.0.0.1 >"$JSONAPI_LOG" 2>&1 &
  echo $! > "$JSONAPI_PID_FILE"
  local json_pid
  json_pid="$(cat "$JSONAPI_PID_FILE")"

  for i in $(seq 1 60); do
    http_ok "http://127.0.0.1:$JSONAPI_PORT/readyz" && break
    kill -0 "$json_pid" 2>/dev/null || { log "JSON API exited - see $JSONAPI_LOG"; tail -5 "$JSONAPI_LOG"; return 1; }
    sleep 1
  done
  http_ok "http://127.0.0.1:$JSONAPI_PORT/readyz" || { log "JSON API not ready - see $JSONAPI_LOG"; return 1; }

  # Browsers cannot read the JSON API directly: no Access-Control-* headers and
  # a 404 on OPTIONS. Put the CORS shim in front of it and health-check the
  # preflight, which is what the app actually depends on.
  log "starting CORS proxy on 127.0.0.1:$PROXY_PORT -> 127.0.0.1:$JSONAPI_PORT"
  python3 "$NOVATIO_ROOT/scripts/cors-proxy.py" "$PROXY_PORT" "$JSONAPI_PORT" \
    >"$PROXY_LOG" 2>&1 &
  echo $! > "$PROXY_PID_FILE"
  local proxy_pid
  proxy_pid="$(cat "$PROXY_PID_FILE")"

  for i in $(seq 1 30); do
    preflight_ok "http://127.0.0.1:$PROXY_PORT/v1/query" && break
    kill -0 "$proxy_pid" 2>/dev/null || { log "CORS proxy exited - see $PROXY_LOG"; return 1; }
    sleep 1
  done
  preflight_ok "http://127.0.0.1:$PROXY_PORT/v1/query" || {
    log "CORS proxy did not start serving preflight - see $PROXY_LOG"; return 1; }
  log "CORS proxy ready (preflight served)"

  # Chicken-and-egg: /v1/parties needs a token, but the token's actAs/readAs must
  # carry the participant's party namespace, which is only knowable by asking the
  # ledger. Break it by minting a throwaway token first, reading the real
  # namespace with it, then re-minting with correct claims.
  write_token_script

  local ns=""
  local probe_ns=""
  for attempt in 1 2; do
    python3 "$RUN_DIR/forge-token.py" "$ns" "$JWT_FILE" "$RUN_DIR/party-ids.json" 2>/dev/null
    probe_ns="$(curl -s -m 8 -H "Authorization: Bearer $(cat "$JWT_FILE")" \
      "http://127.0.0.1:$JSONAPI_PORT/v1/parties" 2>/dev/null | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    ids=[p["identifier"] for p in d.get("result",[])]
    print(ids[0].split("::",1)[1] if ids else "")
except Exception:
    print("")')"
    [ -n "$probe_ns" ] && { ns="$probe_ns"; break; }
    sleep 1
  done

  if [ -z "$ns" ]; then
    log "could not resolve party namespace from the JSON API"
    return 1
  fi

  python3 "$RUN_DIR/forge-token.py" "$ns" "$JWT_FILE" "$RUN_DIR/party-ids.json"
  log "dev JWT written to $JWT_FILE"

  # Resolve the Novatio package id once and bake it into the env file, so the
  # browser does not probe every package on each cold start. Probing (rather than
  # trusting an index or "the last one") is what makes this survive a changing
  # dependency set — Novatio's id samples at index 6 today with 37 packages
  # loaded, so any positional assumption is wrong.
  cat > "$RUN_DIR/find-package.py" <<'PKG_SCRIPT'
import json, sys, urllib.error, urllib.request

base, token = "http://127.0.0.1:" + sys.argv[1], sys.argv[2]


def get(path):
    req = urllib.request.Request(base + path,
                                 headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.load(r)


def post(path, body):
    """Returns (ok, payload). Judged by the envelope, not the transport status:
    this JSON API reports failures as errors inside an HTTP 200."""
    req = urllib.request.Request(
        base + path, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode() or "{}")
        except Exception:
            return {"errors": ["HTTP " + str(e.code)]}


listing = get("/v1/packages")
for candidate in listing.get("result", []):
    data = post("/v1/query", {"templateIds": [candidate + ":Novatio:Cash"]})
    if not data.get("errors"):
        print(candidate)
        break
else:
    print("")
PKG_SCRIPT

  local pkg_id
  pkg_id="$(python3 "$RUN_DIR/find-package.py" "$JSONAPI_PORT" "$(cat "$JWT_FILE")" 2>/dev/null)"
  PKG_ID="${pkg_id:-}"
  if [ -n "$PKG_ID" ]; then
    log "resolved Novatio package id ${PKG_ID:0:12}..."
  else
    log "warning: could not resolve package id; the client will discover it at runtime"
  fi

  # Write a runtime config JSON that the app fetches on load.
  # This keeps the JWT out of the bundle: Vite embeds import.meta.env
  # values at build time, so any JWT baked into the bundle ends up in
  # dist/assets/*.js and is visible to anyone who loads the page.
  # The runtime path reads /novatio-canton/config.json from the page
  # origin (the CORS proxy / preview server). Vercel has no such file,
  # so the fetch 404s and the client falls back to the empty deploy env
  # → honest SIMULATED mode. canton-local.sh is the only place the
  # token is written, and it binds to 127.0.0.1 only.
  mkdir -p "$NOVATIO_ROOT/frontend/public/novatio-canton"
  cat > "$NOVATIO_ROOT/frontend/public/novatio-canton/config.json" <<CONFIG_EOF
{
  "ledgerUrl": "http://127.0.0.1:${PROXY_PORT}",
  "apiVersion": "v1",
  "jwt": "$(cat "$JWT_FILE")",
  "packageId": "${PKG_ID}"
}
CONFIG_EOF
  log "wrote frontend/public/novatio-canton/config.json"

  # Seed demo contracts so the ledger is not empty on a fresh start. In-memory
  # storage means every start begins blank, and a live-but-empty dashboard reads
  # as "the ledger is broken". Refuses to run if contracts already exist.
  if python3 "$NOVATIO_ROOT/scripts/seed-ledger.py" "$NOVATIO_ROOT/frontend/public/novatio-canton/config.json" >"$SEED_LOG" 2>&1; then
    log "seeded demo contracts ($(grep -c 'created' "$SEED_LOG") created)"
  else
    log "warning: seed step did not seed - see $SEED_LOG"
  fi

  log "READY - VITE_LEDGER_URL=http://127.0.0.1:$PROXY_PORT (CORS proxy -> JSON API on $JSONAPI_PORT)"
}

stop() {
  local stopped=0
  # Proxy first, then the JSON API, then Canton. Ordering matters: the proxy
  # holds a keep-alive client connection, and killing Canton first would leave
  # it serving 502s while its pid file still exists.
  for f in "$PROXY_PID_FILE" "$JSONAPI_PID_FILE" "$PID_FILE"; do
    if alive "$f"; then
      kill "$(cat "$f")" 2>/dev/null || true
      stopped=1
    fi
  done
  if [ "$stopped" -eq 1 ]; then
    sleep 2
    log "stopped"
    for f in "$PROXY_PID_FILE" "$JSONAPI_PID_FILE" "$PID_FILE"; do
      if [ -f "$f" ]; then
        kill -9 "$(cat "$f")" 2>/dev/null || true
        rm -f "$f"
      fi
    done
    return 0
  fi

  # No pid file, which is not the same as not running. This project's run dir
  # lives under a cache that is pruned every 24h, so a live node can lose its
  # pid file. Reap by matching the actual processes on the ports we own.
  local orphans=()
  for p in "$PROXY_PORT" "$JSONAPI_PORT" "$LEDGER_PORT"; do
    local listener
    listener="$(ss -ltnp 2>/dev/null | awk -v port=":$p" '$4 ~ port {print $0}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
    [ -n "$listener" ] && orphans+=("$listener")
  done
  if [ "${#orphans[@]}" -gt 0 ]; then
    log "no pid files, but ports are still held - killing pids: ${orphans[*]}"
    kill -9 "${orphans[@]}" 2>/dev/null || true
    log "stopped (by port)"
  else
    log "not running"
  fi
}

status() {
  if alive "$PID_FILE"; then
    log "running (canton pid $(cat "$PID_FILE"), json-api pid $(cat "$JSONAPI_PID_FILE" 2>/dev/null), cors-proxy pid $(cat "$PROXY_PID_FILE" 2>/dev/null))"
    if preflight_ok "http://127.0.0.1:$PROXY_PORT/v1/query"; then
      log "  browser reachable via CORS proxy on 127.0.0.1:$PROXY_PORT"
    else
      log "  WARNING: CORS proxy on $PROXY_PORT is not serving preflight; the dashboard cannot reach the ledger"
    fi
    curl -s -m 5 "http://127.0.0.1:$JSONAPI_PORT/readyz" 2>/dev/null | sed 's/^/  /'
  else
    log "not running"
  fi
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
