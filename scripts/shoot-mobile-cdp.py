import json, base64, subprocess, time, urllib.request, sys
import websocket

# ── Screenshot via CDP (real viewport, real rendered state) ────────────────────
# `google-chrome --screenshot` captures the pre-React shell and ignores the
# window width, so this drives the page, sets an explicit viewport through
# Emulation.setDeviceMetricsOverride, and grabs a real capture.

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9244
URL = "http://127.0.0.1:4178/"
OUT = "/tmp/nov-mobile-shots"
WIDTHS = [360, 390, 430, 768]

proc = subprocess.Popen([
    "google-chrome","--headless=new","--no-sandbox","--disable-gpu",
    "--disable-dev-shm-usage", f"--remote-debugging-port={PORT}",
    "--remote-allow-origins=*", f"--window-size=1440,1200", URL
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
_ws=None
try:
    tabs=[]
    for _ in range(24):
        try:
            tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            if tabs: break
        except Exception: pass
        time.sleep(0.5)
    page=[t for t in tabs if t.get("type")=="page"][0]
    ws=websocket.create_connection(page["webSocketDebuggerUrl"],timeout=30); _ws=ws
    mid=[0]
    def send(m,**p):
        mid[0]+=1; ws.send(json.dumps({"id":mid[0],"method":m,"params":p}))
        while True:
            r=json.loads(ws.recv())
            if r.get("id")==mid[0]:
                if r.get("error"): raise RuntimeError(r["error"])
                return r
    def ev(e):
        return send("Runtime.evaluate",expression=e,returnByValue=True).get("result",{}).get("result",{}).get("value")
    send("Page.enable"); send("Runtime.enable")
    time.sleep(3)

    def shot(name, w, h, full=True):
        send("Emulation.setDeviceMetricsOverride", width=w, height=h,
             deviceScaleFactor=2, mobile=(w<800))
        time.sleep(1.3)
        params = {"format":"png","captureBeyondViewport":full}
        if full:
            metrics = send("Page.getLayoutMetrics")["result"]["contentSize"]
            params["clip"] = {"x":0,"y":0,"width":w,"height":metrics["height"],
                              "scale":1}
        r = send("Page.captureScreenshot", **params)
        p = f"{OUT}/{name}-{w}.png"
        open(p,"wb").write(base64.b64decode(r["result"]["data"]))
        import os
        return os.path.getsize(p)

    # LANDING
    for w in WIDTHS:
        sz = shot("landing", w, 1100)
        print(f"landing-{w}.png  {sz} bytes")

    # DASHBOARD
    ev("""(() => {const e=[...document.querySelectorAll('button,a')];
        const t=e.find(x=>/Launch Protocol Console/i.test(x.innerText||'')); if(t)t.click();})()""")
    time.sleep(2.5)
    for w in WIDTHS:
        sz = shot("dashboard", w, 1100)
        badge = None
        print(f"dashboard-{w}.png  {sz} bytes")
finally:
    if _ws:
        try: _ws.close()
        except Exception: pass
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()

import os
print("\n=== files ===")
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT,f)))
