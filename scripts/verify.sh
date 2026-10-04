#!/usr/bin/env bash
# Novatio verification suite — baseline and post-fix gate.
# Runs the same checks every time so regressions are visible.
set -uo pipefail
export PATH="$HOME/.daml/bin:$PATH"
cd /home/ubuntu/Novatio || exit 1
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
chk(){ if [ "$1" -eq 0 ]; then ok "$2"; else no "$2"; fi; }

echo "=== [1/5] Daml builds ==="
OUT=$(timeout 500 daml build -o /tmp/novatio-verify.dar 2>&1)
echo "$OUT" | grep -q "Created /tmp/novatio-verify.dar"; chk $? "daml build produces DAR"

echo "=== [2/5] Daml tests pass ==="
OUT=$(timeout 500 daml test 2>&1)
echo "$OUT" | grep -q "testNovatioCompleteLifecycle: ok"; chk $? "daml test lifecycle ok"
ERRC=$(echo "$OUT" | grep -c "error:")
[ "$ERRC" -eq 0 ]; chk $? "no compile errors"

echo "=== [3/5] Frontend typechecks ==="
(cd frontend && timeout 280 npx tsc --noEmit >/tmp/tsc.log 2>&1); chk $? "tsc --noEmit clean"

echo "=== [4/5] Frontend builds ==="
(cd frontend && timeout 400 npx vite build >/tmp/vite.log 2>&1); chk $? "vite build succeeds"

echo "=== [5/5] No stale hardcoded APR ==="
# APR must be one number everywhere. Hardcoding it in any UI string is how the
# landing page, the dashboard and the docs drifted apart before (11.8 vs 11.76).
# The landing page derives it (refYieldPA) - the dashboard texts and the docs
# must state the same figure, so pin the wrong spellings out of all of them.
STALE_APR=$(grep -rn "11\.8%" frontend/src README.md docs 2>/dev/null)
[ -z "$STALE_APR" ]; chk $? "no stale 11.8% APR anywhere"
if [ -n "$STALE_APR" ]; then printf '%s\n' "$STALE_APR" | sed 's/^/    stale: /'; fi

# 6. Mobile layout: the topbar must wrap on phone widths and the page must not
# scroll horizontally. This is the regression a CSS-only refactor can
# reintroduce silently — it measures built output, not source.
#
# A copy of the probe is used (not the committed one, which is edited in place
# above) so the check never leaves the repo dirty.
echo "=== [6/6] Mobile layout has no horizontal overflow ==="
if command -v google-chrome >/dev/null 2>&1 && [ -f scripts/mobile-probe-dashboard.py ]; then
  (cd frontend && (npx vite preview --port 4179 --host 127.0.0.1 >/tmp/preview-verify.log 2>&1 &) )
  # Bounded readiness probe rather than a blind sleep.
  READY=0
  for _ in $(seq 1 24); do
    if curl -sf -o /dev/null http://127.0.0.1:4179/ 2>/dev/null; then READY=1; break; fi
    sleep 0.5
  done
  if [ "$READY" -eq 1 ]; then
    PROBE_TMP=$(mktemp /tmp/nov-mobile-probe.XXXXXX.py)
    sed "s#417[0-9]#4179#g" scripts/mobile-probe-dashboard.py > "$PROBE_TMP"
    OUT=$(timeout 200 python3 "$PROBE_TMP" 9251 2>&1)
    # Every phone width must report exactly 0 page-level overflow.
    OVERFLOWS=$(printf '%s\n' "$OUT" | grep -oE "overflowX=\s*[0-9]+" | grep -oE "[0-9]+" | grep -v "^0$" | wc -l)
    [ "$OVERFLOWS" -eq 0 ]; chk $? "no horizontal overflow at phone widths"
    # The badge must reflect reality, not a hardcoded word. Two rules:
    #   1. it must say LIVE or SIMULATED - never neither (badge broken)
    #   2. if a dev ledger was reachable when the bundle was built, it must say
    #      LIVE; otherwise it must say SIMULATED. The test cannot start a Canton
    #      node, so it compares against what the built bundle was configured
    #      for rather than assuming one.
    BADGE=$(printf '%s\n' "$OUT" | grep -oE "DASHBOARD_BADGE: (LIVE|SIMULATED)" | head -1 | awk '{print $2}')
    if [ -z "$BADGE" ]; then
      chk 1 "dashboard badge is present and readable"
    else
      echo "    (badge reports: $BADGE)"
      # Was the built bundle pointed at a ledger that answered at build time?
      if grep -q "VITE_LEDGER_URL" frontend/.env.local 2>/dev/null && \
         curl -sf -o /dev/null -m 3 "$(grep '^VITE_LEDGER_URL=' frontend/.env.local | cut -d= -f2)/readyz" 2>/dev/null; then
        [ "$BADGE" = "LIVE" ]; chk $? "dashboard reads LIVE because the ledger answered"
      else
        [ "$BADGE" = "SIMULATED" ]; chk $? "dashboard reads SIMULATED when no ledger is reachable"
      fi
    fi
    rm -f "$PROBE_TMP"
    PREVIEW_PID=$(pgrep -f "vite preview --port 4179" | head -1)
    [ -n "$PREVIEW_PID" ] && kill "$PREVIEW_PID" 2>/dev/null
  else
    no "vite preview started for mobile check"
  fi
else
  no "google-chrome or mobile probe unavailable"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
