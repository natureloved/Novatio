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
grep -q "11.8% p.a." frontend/src/LandingPage.tsx; [ $? -ne 0 ]; chk $? "no hardcoded APR string"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
