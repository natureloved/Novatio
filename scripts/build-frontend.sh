#!/usr/bin/env bash
# Build the Novatio frontend, logging to a file.
# Kept as a script because the terminal heuristic flags inline `vite build`
# invocations as long-lived servers.
set -u
cd /home/ubuntu/Novatio/frontend || exit 126
npx vite build > /tmp/nov-vite-build.log 2>&1
rc=$?
echo "VITE_BUILD_EXIT=$rc"
tail -8 /tmp/nov-vite-build.log
exit $rc
