import json, subprocess, time, urllib.request, sys
import websocket

# ── Multi-width probe for the DASHBOARD (post-click) ───────────────────────────
# The landing page measured clean; the tables with hard min-width (440px, 780px)
# live in the dashboard, so this drives into that view before measuring.

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9227
# Port is a parameter so the suite can run it against whatever preview server it
# started (see scripts/verify.sh check 6).
URL = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:4179/"
WIDTHS = [360, 390, 430, 768, 1020, 1280]

proc = subprocess.Popen([
    "google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu",
    "--disable-dev-shm-usage", f"--remote-debugging-port={PORT}",
    "--remote-allow-origins=*", "--window-size=1440,900", URL
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

_ws = None
try:
    tabs = []
    for _ in range(24):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            if tabs: break
        except Exception: pass
        time.sleep(0.5)
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=25)
    _ws = ws
    mid = [0]

    def send(method, **params):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == mid[0]:
                if "error" in msg: raise RuntimeError(msg["error"])
                return msg

    def ev(expr):
        r = send("Runtime.evaluate", expression=expr, returnByValue=True)
        return r.get("result", {}).get("result", {}).get("value")

    send("Page.enable"); send("Runtime.enable")
    time.sleep(2.5)

    # Enter the dashboard
    clicked = ev("""(() => {
      const els = [...document.querySelectorAll('button, a')];
      const t = els.find(e => /Launch Protocol Console/i.test(e.innerText||''));
      if (!t) return null; t.click(); return t.innerText.trim();
    })()""")
    print("CLICKED:", clicked)
    time.sleep(2.0)

    badge = ev("""(() => { const m=(document.body.innerText||'').match(/SIMULATED|LIVE/g); return m?[...new Set(m)].join('|'):null; })()""")
    print("DASHBOARD_BADGE:", badge)

    MEASURE = """(() => {
      const d = document.documentElement;
      const vw = window.innerWidth;
      const out = { vw, overflowX: d.scrollWidth - d.clientWidth, offenders: [] };
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > vw + 1 || r.left < -1) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed') continue;
          const tbl = el.closest ? el.closest('[data-scroll-x]') : null;
          if (tbl) continue;  // intentional horizontally-scrollable table shell
          out.offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className||'').toString().slice(0,60),
            left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
            overflow: Math.round(r.right - vw)
          });
        }
      }
      out.offenderCount = out.offenders.length;
      return out;
    })()"""

    results = []
    for w in WIDTHS:
        send("Emulation.setDeviceMetricsOverride", width=w, height=900,
             deviceScaleFactor=1, mobile=(w < 800))
        time.sleep(1.0)
        m = ev(MEASURE); m["width"] = w
        results.append(m)
        print(f"{w:>5}px  overflowX={m['overflowX']:>5}  offenders={m['offenderCount']:>3}")
        for o in m["offenders"][:3]:
            print(f"          .{o['cls'][:40]:<40} w={o['w']:>5} right={o['right']:>5} overflow={o['overflow']}")

    print("\n=== tables / wide shells ===")
    for w in WIDTHS[:2]:
        send("Emulation.setDeviceMetricsOverride", width=w, height=900,
             deviceScaleFactor=1, mobile=True)
        time.sleep(0.8)
        t = ev("""(() => [...document.querySelectorAll('table')].map(e => {
          const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
          const p = e.parentElement.getBoundingClientRect();
          return { scrollW: e.scrollWidth, w: Math.round(r.width),
                   parentW: Math.round(p.width),
                   parentOverflowX: e.parentElement.scrollWidth - e.parentElement.clientWidth,
                   minW: cs.minWidth };
        })()""")
        print(f"  {w}px tables:", json.dumps(t))

    json.dump(results, open("/tmp/nov-dashboard-baseline.json","w"), indent=1)
finally:
    if _ws:
        try: _ws.close()
        except Exception: pass
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()
