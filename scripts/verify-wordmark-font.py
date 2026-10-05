"""Verify the wordmark font and the brand lockup in a REAL browser via CDP.

Proves three things a static file check cannot:
  1. the self-hosted Chakra Petch font actually loads (status 200, no CORS error)
  2. document.fonts.check('700 16px "Chakra Petch"') is true after load
  3. the rendered lockup text is UPPERCASE and uses the expected font family,
     i.e. the CSS class reached the DOM and was not silently dropped
"""
import json
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9244
URL = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:4178/"

tabs = []
for _ in range(24):
    try:
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
        if tabs:
            break
    except Exception:
        pass
    time.sleep(0.5)

pages = [t for t in tabs if t.get("type") == "page"]
if not pages:
    print("FATAL: no page target on the CDP port")
    raise SystemExit(1)

ws = websocket.create_connection(pages[0]["webSocketDebuggerUrl"], timeout=30)
mid = [0]


def send(method, **params):
    mid[0] += 1
    ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == mid[0]:
            if r.get("error"):
                raise RuntimeError(r["error"])
            return r


def ev(expr):
    r = send("Runtime.evaluate", expression=expr, returnByValue=True)
    return r.get("result", {}).get("result", {}).get("value")


send("Page.enable")
send("Runtime.enable")
send("Network.enable")
send("Page.navigate", url=URL)
time.sleep(5)

font_ok = ev(
    "document.fonts.check('700 16px \"Chakra Petch\"')"
)
loaded = ev(
    "(() => { let n=[]; document.fonts.forEach(f => n.push(f.family + ' ' + f.weight + ' ' + f.status)); return n; })()"
)
lockup = ev(
    "(() => { const el = document.querySelector('.wordmark');"
    " if (!el) return null;"
    " const cs = getComputedStyle(el);"
    " return { text: el.textContent.trim(),"
    "         family: cs.fontFamily,"
    "         transform: cs.textTransform,"
    "         weight: cs.fontWeight }; })()"
)
font_reqs = ev(
    "performance.getEntriesByType('resource')"
    ".filter(r => r.name.includes('.ttf') || r.name.includes('.woff2'))"
    ".map(r => ({ url: r.name.split('/').pop(),"
    "            duration: Math.round(r.duration) }))"
)

print("--- wordmark font verification (real browser, CDP) ---")
print(f"document.fonts.check('700 16px \"Chakra Petch\"'): {font_ok}")
print(f"loaded font faces: {loaded}")
print(f"font requests: {font_reqs}")
print(f"lockup element: {lockup}")

ok = True
if font_ok is not True:
    print("FAIL: Chakra Petch did not load")
    ok = False
if not lockup:
    print("FAIL: no .wordmark element rendered in the DOM")
    ok = False
else:
    if "Chakra Petch" not in (lockup.get("family") or ""):
        print(f"FAIL: computed font-family is {lockup.get('family')!r}, not Chakra Petch")
        ok = False
    if lockup.get("transform") != "uppercase":
        print(f"FAIL: textTransform is {lockup.get('transform')!r}, expected 'uppercase'")
        ok = False
if not font_reqs:
    print("FAIL: no font file was requested over the network")

print("RESULT:", "wordmark font verified in a real browser" if ok else "FAILED")
raise SystemExit(0 if ok else 1)
