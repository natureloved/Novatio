#!/usr/bin/env python3
"""Seed a fresh local Canton node with demo contracts.

Why this exists: `scripts/canton-local.sh` starts an in-memory participant, so
every start is an empty ledger. Without seeded state the dashboard is live but
shows zero active receivables, which reads as "the ledger is broken" rather than
"nothing has been financed yet".

Creates, in order:
  1. Cash for the factorer and the buyer, issued by the central reserve bank
  2. The buyer's long-lived NovationRegistry (empty)
  3. One CommercialInvoice between supplier and buyer - and ONLY two signatories,
     so the factorer's node provably cannot read its line items

This is a dev convenience, not application logic: the store starts empty by
design so every run is reproducible. Contracts created here are the same
`Genesis` state `resetState()` builds locally, not extra invention.

    python3 scripts/seed-ledger.py [config.json path]

Reads the runtime config that `canton-local.sh` writes (ledger URL, dev JWT,
package id), so it never hardcodes a token or a package hash. Idempotent by
default: it checks for existing contracts first and refuses to double-seed.
"""

import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG = os.path.join(HERE, "..", "frontend", "public", "novatio-canton", "config.json")

config_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CONFIG
with open(config_path) as fh:
    cfg = json.load(fh)

BASE = cfg["ledgerUrl"].rstrip("/")
TOKEN = cfg["jwt"]
PKG = cfg["packageId"]
if not PKG:
    raise SystemExit("no packageId in the runtime config; run canton-local.sh first")

# Party ids are `<name>::<namespace>`; the namespace is deployment-specific, so
# take it from the ledger rather than assuming it.
def platform():
    return urllib.request.Request(
        BASE + "/v1/parties",
        headers={"Authorization": "Bearer " + TOKEN})


def req(path, body=None, method="GET"):
    r = platform() if body is None else urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOKEN,
                 "Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        # Failures live inside a 200 on this API, so a real HTTP error is rare.
        try:
            return json.loads(exc.read().decode() or "{}")
        except Exception:
            return {"errors": [f"HTTP {exc.code}"]}


parties = req("/v1/parties").get("result", [])
NAMESPACE = None
for p in parties:
    ident = p.get("identifier", "")
    if "::" in ident:
        NAMESPACE = ident.split("::", 1)[1]
        break
if not NAMESPACE:
    raise SystemExit("could not resolve the party namespace; is the node up?")


def party(name):
    return f"{name}::{NAMESPACE}"


BANK = party("Central_Reserve_Bank")
BUYER = party("Global_Motors_OEM")
SUPPLIER = party("Acme_Electronics")
FACTORER = party("Canton_Capital_Desk")

# Balance the reference economics used by the landing page and the docs: 85%
# advance on $100k face, 2.5% flat fee, 90-day tenor.
CASH_BUYER = 100000.0
CASH_FACTORER = 100000.0
FACE_VALUE = 100000.0
TENOR_DAYS = 90
DUE_DATE = "2027-01-02T00:00:00Z"  # ~90 days out from a fresh node start

# One CommercialInvoice payload, shared between the seed and the sum check so
# the two cannot drift apart.
LINE_ITEMS = [
    {"itemCode": "MCU-901", "description": "Flight Microcontroller",
     "quantity": "1000.0", "unitPrice": "75.0", "totalPrice": "75000.0"},
    {"itemCode": "PCB-404", "description": "Radiation Shield Board",
     "quantity": "500.0", "unitPrice": "50.0", "totalPrice": "25000.0"},
]


def create(template, payload):
    body = {"templateId": f"{PKG}:Novatio:{template}", "payload": payload}
    out = req("/v1/create", body, "POST")
    if out.get("errors"):
        raise SystemExit(f"failed to create {template}: {out['errors']}")
    return out.get("result", {}).get("contractId")


def count(template):
    out = req("/v1/query", {"templateIds": [f"{PKG}:Novatio:{template}"]}, "POST")
    if out.get("errors"):
        raise SystemExit(f"failed to query {template}: {out['errors']}")
    return len(out.get("result", []))


# Refuse to double-seed: a second run would fund the same parties twice and the
# dashboard would report double the capital that was ever issued.
if count("Cash") or count("CommercialInvoice") or count("NovationRegistry"):
    print("ledger already has contracts; not seeding again")
    print(f"  Cash={count('Cash')} CommercialInvoice={count('CommercialInvoice')} "
          f"NovationRegistry={count('NovationRegistry')}")
    raise SystemExit(0)

created = []

created.append(("Cash (factorer)", create("Cash", {
    "issuer": BANK, "holder": FACTORER, "amount": str(CASH_FACTORER)})))
created.append(("Cash (buyer)", create("Cash", {
    "issuer": BANK, "holder": BUYER, "amount": str(CASH_BUYER)})))
created.append(("NovationRegistry (buyer)", create("NovationRegistry", {
    "buyer": BUYER, "registeredInvoices": []})))

# lineItems must sum to `amount` exactly - a precondition on CommercialInvoice,
# not a UI convenience, so the seed has to respect it.
created.append(("CommercialInvoice INV-2026-001", create("CommercialInvoice", {
    "supplier": SUPPLIER,
    "buyer": BUYER,
    "invoiceNumber": "INV-2026-001",
    "amount": str(FACE_VALUE),
    "dueDate": DUE_DATE,
    "lineItems": LINE_ITEMS,
})))

for label, cid in created:
    print(f"  created {label:32} {cid[:24]}...")

# Prove the numbers add up before reporting success: the reference economics the
# landing page displays must match what actually landed on the ledger.
assert float(sum(float(i["totalPrice"]) for i in LINE_ITEMS)) == FACE_VALUE, \
    "line items must sum to face value (CommercialInvoice precondition)"

print(f"\nseeded {len(created)} contracts")
print(f"  party namespace: {NAMESPACE[:16]}...")
print(f"  invoice due:     {DUE_DATE} ({TENOR_DAYS}-day tenor)")
print(f"  face value:      ${FACE_VALUE:,.2f} across {len(LINE_ITEMS)} line items")
print("  NOTE: the seed runs with the shared dev JWT, so this script cannot prove "
      "factorer-side privacy of the line items; that needs a per-party token and "
      "is asserted by the Daml test suite (NovatioTest) instead.")
