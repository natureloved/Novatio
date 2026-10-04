#!/usr/bin/env python3
"""Exercise the full Novatio lifecycle against a real Canton ledger.

Why this exists: `daml test` proves the Daml lifecycle inside the Ledger API
test harness, and the verify gate proves the browser can READ the ledger.
Neither proves the *browser's own write path* works end-to-end against a real
node - and that is the claim the demo makes when a judge clicks
"Register & Offer".

So drive all six steps over the JSON API, asserting the on-ledger effect of
each one rather than trusting a transport status. The JSON API hides failures
inside HTTP 200, so every response is judged by its envelope.

    python3 scripts/lifecycle-check.py [config.json]

Exit 0 only if every step commits and every expected contract exists after it.

Party ids are `<name>::<namespace>` and the namespace is REGENERATED on every
fresh node, so it is read from the dev token rather than hardcoded. A stale
namespace in a test produces UNKNOWN_INFORMEES - which looks exactly like a
broken node and is actually a broken test.
"""

import base64
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    HERE, "..", "frontend", "public", "novatio-canton", "config.json")

with open(CONFIG) as fh:
    cfg = json.load(fh)

BASE = cfg["ledgerUrl"].rstrip("/")
TOKEN = cfg["jwt"]
PKG = cfg["packageId"]
if not PKG:
    raise SystemExit("no packageId in the runtime config; run canton-local.sh first")

_token = TOKEN.split(".")[1]
_token += "=" * (-len(_token) % 4)
NS = json.loads(base64.urlsafe_b64decode(_token))["actAs"][0].split("::", 1)[1]

BUYER = f"Global_Motors_OEM::{NS}"
SUPPLIER = f"Acme_Electronics::{NS}"
FACTORER = f"Canton_Capital_Desk::{NS}"
AUDITOR = f"Regulatory_Observer::{NS}"


def post(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOKEN,
                 "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode() or "{}")
        except Exception:
            return {"errors": [f"HTTP {exc.code}"]}


def tid(template):
    return f"{PKG}:Novatio:{template}"


def query(template):
    out = post("/v1/query", {"templateIds": [tid(template)]})
    if out.get("errors"):
        raise SystemExit(f"query {template} failed: {out['errors']}")
    return out.get("result", [])


def exercise(template, cid, choice, argument):
    return post("/v1/exercise", {
        "templateId": tid(template), "contractId": cid,
        "choice": choice, "argument": argument})


failures = []


def step(num, description, fn):
    try:
        out = fn()
    except Exception as exc:
        print(f"  STEP {num}: ERROR {description}: {exc}")
        failures.append(num)
        return None
    if out.get("errors"):
        body = json.dumps(out["errors"])
        # UNKNOWN_INFORMEES on a fresh node means this script's namespace or a
        # party is wrong, not that the ledger is broken.
        hint = " (check party namespace)" if "UNKNOWN_INFORMEES" in body else ""
        print(f"  STEP {num}: REJECTED {description}: {body[:220]}{hint}")
        failures.append(num)
        return None
    print(f"  STEP {num}: committed - {description}")
    return out


def expect(template, minimum, label):
    n = len(query(template))
    ok = n >= minimum
    print(f"  {'ok' if ok else 'FAIL'}   {label}: {template} = {n} (need >= {minimum})")
    if not ok:
        failures.append(label)


print(f"ledger {BASE}  package {PKG[:12]}...  namespace {NS[:12]}...")
print("state before:", {t: len(query(t)) for t in
                       ["Cash", "CommercialInvoice", "NovationRegistry", "FactoringOffer"]})

# 1. Buyer registers the invoice in the long-lived registry and emits the offer.
#    This is the single-writer dedup gate: a second registration of the same
#    invoice number must be REJECTED, so register only if not already active.
registry = query("NovationRegistry")
invoices = query("CommercialInvoice")
if not registry or not invoices:
    raise SystemExit("no seeded registry/invoice - run canton-local.sh first (it seeds)")

registrations = [p["payload"]["registeredInvoices"] for p in registry]
invoice_numbers = [p["payload"]["invoiceNumber"] for p in invoices]
already = any(n in r for r, n in zip(registrations, invoice_numbers))
offers = query("FactoringOffer")

if offers:
    print("  STEP 1: already registered (offer live), skipping rather than double-registering")
elif already:
    print("  STEP 1: invoice already in the registry but no offer - refusing to re-register")
    failures.append(1)
else:
    step(1, "buyer registers invoice and emits FactoringOffer", lambda: exercise(
        "NovationRegistry", registry[0]["contractId"], "RegisterAndOfferFactoring", {
            "commercialInvoiceCid": invoices[0]["contractId"],
            "factorer": FACTORER, "advanceRate": "0.85",
            "discountFee": "2500.0", "auditor": AUDITOR}))
expect("FactoringOffer", 1, "after registration")

offer_list = query("FactoringOffer")
if offer_list:
    offer = offer_list[0]
    # 2. Supplier accepts: verifies the SHA-256 commitment and co-signs.
    fr = query("FinanceableReceivable")
    if not fr:
        step(2, "supplier co-signs FinanceableReceivable", lambda: exercise(
            "FactoringOffer", offer["contractId"], "AcceptOffer", {
                "commercialInvoiceCid": invoices[0]["contractId"]}))
    expect("FinanceableReceivable", 1, "after supplier acceptance")

    fr = query("FinanceableReceivable")
    if fr:
        # 3. Factorer funds the advance: atomic DvP, one transaction, both legs.
        #    The factorer must nominate WHICH Cash contract funds the advance,
        #    which is what makes this a genuine delivery-vs-payment rather than
        #    a bookkeeping copy - the cash leg and the title leg commit or fail
        #    together.
        if not query("NovatedReceivable"):
            factorer_cash = [c for c in query("Cash")
                             if c["payload"]["holder"] == FACTORER]
            if not factorer_cash:
                print("  FAIL   no Cash held by the factorer to fund the advance")
                failures.append("3")
            else:
                step(3, "factorer funds advance (atomic DvP)", lambda: exercise(
                    "FinanceableReceivable", fr[0]["contractId"],
                    "AcceptFactoring",
                    {"factorerCashCid": factorer_cash[0]["contractId"]}))
        expect("NovatedReceivable", 1, "after DvP")
        expect("Cash", 2, "cash still exists after transfer legs")

        nr = query("NovatedReceivable")
        if nr:
            # 4. Buyer settles at maturity. The buyer nominates the Cash
            #    contract that settles the face value - again real DvP: the
            #    factorer only becomes paid once cash actually moves.
            if not query("SettledObligation"):
                buyer_cash = [c for c in query("Cash")
                              if c["payload"]["holder"] == BUYER]
                if not buyer_cash:
                    print("  FAIL   no Cash held by the buyer to settle with")
                    failures.append("4")
                else:
                    step(4, "buyer settles face value at maturity", lambda: exercise(
                        "NovatedReceivable", nr[0]["contractId"],
                        "SettleReceivable",
                        {"buyerCashCid": buyer_cash[0]["contractId"]}))
            expect("SettledObligation", 1, "after settlement")

            so = query("SettledObligation")
            if so:
                # 5. Factorer remits reserve minus fee to the supplier.
                factorer_cash = [c for c in query("Cash")
                                 if c["payload"]["holder"] == FACTORER]
                if not factorer_cash:
                    print("  FAIL   no Cash held by the factorer to remit")
                    failures.append("5")
                else:
                    step(5, "factorer remits reserve minus fee", lambda: exercise(
                        "SettledObligation", so[0]["contractId"], "RemitSupplier",
                        {"factorerCashCid": factorer_cash[0]["contractId"]}))
                expect("Cash", 3, "cash contracts after remittance")

# 6. Auditor reads the scoped audit trail - a non-consuming choice, so it must
#    still succeed after everything above has settled.
so = query("SettledObligation")
nr = query("NovatedReceivable")
audit_target = ("SettledObligation", so[0]["contractId"], "QuerySettledAudit") if so else \
               ("NovatedReceivable", nr[0]["contractId"], "QueryActiveAudit") if nr else None
if audit_target:
    out = step(6, f"auditor exercises {audit_target[2]}", lambda: exercise(
        audit_target[0], audit_target[1], audit_target[2], {}))
    if out:
        print("  ok   audit report:", json.dumps(out.get("result", out))[:220])

print("\nFINAL ON-LEDGER STATE:")
for t in ["Cash", "CommercialInvoice", "NovationRegistry", "FactoringOffer",
          "FinanceableReceivable", "NovatedReceivable", "SettledObligation"]:
    print(f"  {t:24} {len(query(t))}")

if failures:
    print(f"\nFAILED steps: {failures}")
    raise SystemExit(1)
print("\nLIFECYCLE OK: every step committed against the real ledger")
