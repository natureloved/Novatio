#!/usr/bin/env node
/**
 * Browser-free end-to-end proof of the Novatio UI write path.
 *
 * Replays the exact request sequence the built bundle performs, in order:
 *   1. GET  /novatio-canton/config.json   (runtime config, not baked-in secrets)
 *   2. GET  /v1/parties                   (party qualification)
 *   3. POST /v1/query                     (the dashboard's contract lists)
 *   4. POST /v1/exercise                  (each workflow button)
 *
 * Why this exists: a headless browser on this host is unreliable, and
 * "curl says it works" is not the same claim as "the app works". This replays
 * the app's own sequence through the real endpoints, so a green run means the
 * choices, the party names, and the cash ids the UI derives all cross the wire
 * successfully.
 *
 * Run against a freshly seeded node: canton-local.sh start && node scripts/ui-verify.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Prefer the LIVE runtime config (written by canton-local.sh at start) over the
// snapshot that `vite build` copied into dist/. Vite copies public/ once at
// build time, so after the ledger is restarted the dist copy holds a token from
// the previous node and every request 401s - which reads as "the ledger is
// broken" when it is really a stale build artifact.
const live = join(process.cwd(), 'frontend/public/novatio-canton/config.json');
const dist = join(process.cwd(), 'frontend/dist/novatio-canton/config.json');
const source = existsSync(live) ? live : dist;
console.log(`config source: ${source.replace(process.cwd(), '.')}`);
const cfg = JSON.parse(readFileSync(source, 'utf8'));
const j = (o) => JSON.stringify(o);
const base = cfg.ledgerUrl.replace(/\/$/, '');
const H = { Authorization: `Bearer ${cfg.jwt}`, 'Content-Type': 'application/json' };
const pk = cfg.packageId;

// Party qualification - the step that was missing before the fix.
const parties = {};
for (const p of (await (await fetch(`${base}/v1/parties`, { headers: H })).json()).result) {
  const [name, ns] = p.identifier.split('::');
  if (name && ns && !(name in parties)) parties[name] = p.identifier;
}
const qual = (v) => parties[v] ?? v;

const query = async (t) => (await (await fetch(`${base}/v1/query`, {
  method: 'POST', headers: H, body: j({ templateIds: [`${pk}:Novatio:${t}`] }) })).json()).result || [];

const exercise = async (template, cid, choice, argument) => {
  const r = await fetch(`${base}/v1/exercise`, {
    method: 'POST', headers: H,
    body: j({ templateId: `${pk}:Novatio:${template}`, contractId: cid, choice, argument }),
  });
  return r.json();
};

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ': ' + extra : ''}`);
  if (!ok) failures++;
};
const skipped = (label, why) => console.log(`  --   ${label}: ${why}`);

console.log(`ledger ${base}`);
console.log(`parties: ${Object.keys(parties).join(', ')}`);
check(Object.keys(parties).length >= 5, 'party qualification resolved', `${Object.keys(parties).length} names`);

// --- the dashboard's opening reads ---
const invoices = await query('CommercialInvoice');
const registries = await query('NovationRegistry');
check(invoices.length > 0, 'CommercialInvoice readable');
check(registries.length > 0, 'NovationRegistry readable');
if (!invoices.length || !registries.length) { console.error('aborting: nothing to act on'); process.exit(1); }
const invoiceNumber = invoices[0].payload.invoiceNumber;
const alreadyRegistered = (registries[0].payload.registeredInvoices || []).includes(invoiceNumber);

const cashOf = async (name) => (await query('Cash')).filter(c => c.payload.holder === qual(name));

/**
 * The lifecycle is CONSUMING: each step archives the contract it replaced, so
 * Offer -> Receivable -> Novated -> Settled is a chain, not a set. That means:
 *   - on a fresh node, the gate walks the whole chain;
 *   - on a node that already ran it, the earlier contracts are GONE, and
 *     re-running those steps is rejected by the single-writer registry.
 * So the gate resumes: it checks which stage the ledger is at, performs the
 * first step only if the chain has not been started, and then verifies each
 * transition it is actually able to make. Never does it assert that a consumed
 * contract still exists.
 */
let offers = await query('FactoringOffer');
let fr = await query('FinanceableReceivable');
let nr = await query('NovatedReceivable');
let so = await query('SettledObligation');
console.log(`  stage before: offer=${offers.length} receivable=${fr.length} novated=${nr.length} settled=${so.length}`);

// --- 1: Buyer registers & offers ---
if (!offers.length && !fr.length && !nr.length && !so.length && !alreadyRegistered) {
  const out = await exercise('NovationRegistry', registries[0].contractId, 'RegisterAndOfferFactoring', {
    commercialInvoiceCid: invoices[0].contractId,
    factorer: qual('Canton_Capital_Desk'),
    advanceRate: '0.85',
    discountFee: '2500.0',
    auditor: qual('Regulatory_Observer'),
  });
  check(!out.errors, 'BUYER: register & offer (RegisterAndOfferFactoring)', out.errors ? j(out.errors).slice(0, 160) : '');
  offers = await query('FactoringOffer');
  check(offers.length > 0, 'FactoringOffer emitted', `${offers.length} live`);
} else if (so.length) {
  skipped('BUYER register & offer', 'flow already completed on this ledger');
}

// --- 2: Supplier co-signs ---
if (offers.length && !fr.length) {
  const out = await exercise('FactoringOffer', offers[0].contractId, 'AcceptOffer',
    { commercialInvoiceCid: invoices[0].contractId });
  check(!out.errors, 'SUPPLIER: hash-verified co-sign (AcceptOffer)', out.errors ? j(out.errors).slice(0, 160) : '');
  fr = await query('FinanceableReceivable');
}
check(fr.length > 0 || nr.length > 0 || so.length > 0, 'supplier co-sign reached the ledger',
  `receivable=${fr.length} novated=${nr.length} settled=${so.length}`);

// --- 3: Factorer funds (atomic DvP) ---
if (fr.length && !nr.length) {
  const fc = await cashOf('Canton_Capital_Desk');
  check(fc.length > 0, 'factorer Cash available to fund');
  const out = await exercise('FinanceableReceivable', fr[0].contractId, 'AcceptFactoring',
    { factorerCashCid: fc[0].contractId });
  check(!out.errors, 'FACTORER: atomic DvP (AcceptFactoring)', out.errors ? j(out.errors).slice(0, 160) : '');
  nr = await query('NovatedReceivable');
}
check(nr.length > 0 || so.length > 0, 'atomic DvP reached the ledger',
  `novated=${nr.length} settled=${so.length}`);

// --- 4: Buyer settles ---
if (nr.length && !so.length) {
  const bc = await cashOf('Global_Motors_OEM');
  check(bc.length > 0, 'buyer Cash available to settle');
  const out = await exercise('NovatedReceivable', nr[0].contractId, 'SettleReceivable',
    { buyerCashCid: bc[0].contractId });
  check(!out.errors, 'BUYER: settle face value (SettleReceivable)', out.errors ? j(out.errors).slice(0, 160) : '');
  so = await query('SettledObligation');
}
check(so.length > 0, 'settlement reached the ledger', `${so.length} live settled`);

// --- 5: Factorer remits, unless this ledger already remitted ---
if (so.length) {
  if (so[0].payload.remitted === true) {
    skipped('FACTORER remit', 'already remitted on this ledger');
  } else {
    const fc = await cashOf('Canton_Capital_Desk');
    check(fc.length > 0, 'factorer Cash available to remit');
    const out = await exercise('SettledObligation', so[0].contractId, 'RemitSupplier',
      { factorerCashCid: fc[0].contractId });
    check(!out.errors, 'FACTORER: remit reserve minus fee (RemitSupplier)', out.errors ? j(out.errors).slice(0, 160) : '');
    so = await query('SettledObligation');
  }
}

// --- audit choice: reads the permanent compliance trail ---
// Re-query rather than reuse the earlier cid: RemitSupplier archives the
// settled record and re-creates it with `remitted = True`, so the old id is
// dead by this point. The AUDIT survives; the CONTRACT ID does not.
const settledNow = await query('SettledObligation');
if (settledNow.length) {
  const out = await exercise('SettledObligation', settledNow[0].contractId, 'QuerySettledAudit', {});
  check(!out.errors, 'AUDITOR: settlement audit (QuerySettledAudit)',
    out.result?.exerciseResult ? j(out.result.exerciseResult).slice(0, 120) : j(out.errors).slice(0, 160));
  if (out.result?.exerciseResult) {
    const r = out.result.exerciseResult;
    check(r.isSettled === true, 'audit confirms settlement', `isSettled=${r.isSettled}`);
  }
  check(settledNow[0].payload.remitted === true, 'settled record marked remitted',
    `remitted=${settledNow[0].payload.remitted}`);
}

// --- double-pledge must still be REJECTED after the full flow ---
const regAgain = await query('NovationRegistry');
const dup = await exercise('NovationRegistry', regAgain[0].contractId, 'RegisterAndOfferFactoring', {
  commercialInvoiceCid: invoices[0].contractId,
  factorer: qual('Canton_Capital_Desk'), advanceRate: '0.85',
  discountFee: '2500.0', auditor: qual('Regulatory_Observer'),
});
check(!!dup.errors, 'double-pledge still rejected (invariant intact)');

console.log(failures ? `\nFAILED: ${failures} check(s)` : '\nUI WRITE PATH OK: every dashboard action committed on the live ledger');
process.exit(failures ? 1 : 0);
