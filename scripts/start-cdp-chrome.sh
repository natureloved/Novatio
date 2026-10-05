#!/usr/bin/env bash
# Start a CDP-capable Chrome on 9244 with a writable profile dir, and wait
# for the DevTools endpoint to answer. --remote-allow-origins=* is required
# because Python's websocket-client sends its own Origin header.
set -e
PORT="${1:-9244}"
PROFILE="${2:-/home/ubuntu/.hermes/cache/scratch/chrome-brand}"

for i in $(seq 1 10); do
  if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    echo "chrome already up on ${PORT}"; exit 0
  fi
  nohup google-chrome \
    --headless \
    --disable-gpu \
    --no-sandbox \
    --disable-dev-shm-usage \
    --remote-debugging-port="${PORT}" \
    --remote-allow-origins=* \
    --user-data-dir="${PROFILE}" \
    about:blank >/tmp/chrome-cdp-${PORT}.log 2>&1 &
  for _ in $(seq 1 15); do
    sleep 0.5
    if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
      echo "chrome up on ${PORT}"; exit 0
    fi
  done
done
echo "chrome failed to start; log:" >&2
cat /tmp/chrome-cdp-${PORT}.log >&2
exit 1
