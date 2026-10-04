# NOVATIO: Pilot Implementation Plan

## Scope of this document

What a real deployment requires beyond the demonstration build: which parties
are involved, which integrations are load-bearing versus aspirational, and the
order of work. The demo runs against a local Canton node with in-memory
storage; everything below is what changes for a pilot with real money.

## Preconditions

| Requirement | Status against this repo | What it takes |
|---|---|---|
| Canton participant node | Demo: local `canton.jar` daemon | Managed participant on Canton DevNet, or a self-hosted one with persistent storage |
| Daml package packaged and versioned | `daml build` → `novatio-1.0.0.dar` | A release process; the package id is a content hash and changes on every build, so deployments must pin an explicit id rather than "latest" |
| Ledger API access | `scripts/canton-local.sh` + `scripts/cors-proxy.py` | Reverse proxy with an explicit origin allowlist, TLS, and a signing key instead of the unsigned dev JWT |
| Party provisioning | `bootstrap.canton` enables 5 parties | Per-deployment party allocation; party names are global on a shared domain and must be reserved |
| Cash settlement asset | Injected as genesis `Cash` contracts | A real settlement instrument. Cash is a private IOU contract in this demo, not CC — a production deployment needs an agreed Cash template or an external settlement rail |

The last row is the one most easily mistaken for proof of settlement. In this
repo `Cash` is a contract between participants; nothing proves the holder can
convert it to fiat.

## Phase 1: Sandbox integration (Weeks 1-2)

- **Objective:** Onboard one tier-2 automotive parts supplier (~$20M revenue) and one tier-1 OEM buyer on Canton DevNet.
- **Deliverables:**
  - Deploy the pinned DAR; participant with persistent (not in-memory) storage
  - Issue and co-sign 5 test invoices totalling $250,000 face value
  - All five parties allocated: buyer, supplier, factorer, central reserve bank, regulatory observer
- **Integrations:**
  - ERP inbound: SAP purchase-order → invoice fields. The boundary is the `CommercialInvoice` payload (invoice number, line items summing exactly to the stated amount, due date); the repo's test suite encodes these invariants and is the contract the mapper must satisfy.
  - Ledger API: real JWT signing key, HTTPS, origin allowlist. The unsigned loopback token in `scripts/canton-local.sh` is dev-only.
- **Acceptance criteria:**
  - A double-pledge attempt on the same invoice is rejected by the single-writer `NovationRegistry`
  - The factorer's node sees no line items (sub-transaction privacy verified, not assumed)
  - Invoice line items sum to the stated amount — enforced by an `ensure` precondition, so a malformed ERP mapping fails at submit rather than settling wrong

## Phase 2: Private credit pilot (Weeks 3-4)

- **Objective:** Deploy $500,000 of pilot working capital with one institutional factorer.
- **Deliverables:**
  - Execute live atomic DvP advances; settlement remains one transaction, so partial delivery is impossible rather than merely unlikely
  - Confirm zero line-item leakage on the factorer node
  - Regulatory observer node exercising scoped non-consuming audit choices
  - Export ISO 20022 `pacs.008` messages carrying the on-chain commitment hash
- **Integrations:**
  - PostgreSQL or Oracle ledger index for the JSON API's non-transactional query store, so suppliers can search without awaiting a ledger read
  - Off-chain `pacs.008` mapper (`frontend/src/iso20022Mapper.ts` generates the message; a pilot needs the mapper behind a gateway, not a browser module)
- **Acceptance criteria:**
  - Settlement failure rolls back both legs
  - Audit trail is readable by the observer and by nobody else
  - Downstream payment instruction matches the on-chain commitment hash

## Phase 3: Mainnet scale (Weeks 5-8)

- **Objective:** Transition to Canton Network Mainnet under the AppsFactory Accelerator.
- **Operational staking:** Fulfil the CIP-0116 Featured App operational locking requirement (5M CC per app provider PartyId) as an enterprise cost for throughput priority. Budget as infrastructure, not as a fee per transaction.
- **Expansion:** Connect factored receivables into Canton institutional overnight repo pools for secondary liquidity refinancing.
- **Production hardening not present in the demo:**
  - Swap in a signing key for JWT issuance and an origin allowlist for CORS (`scripts/cors-proxy.py` deliberately allows `*`; it binds loopback only)
  - Replace in-memory storage with a replicated ledger backend
  - Define key custody and a recovery path for the participant signing key
  - Rate limits and party-level quota, since the API currently accepts any authenticated party's commands

## Explicitly out of scope for the pilot

- Legal enforceability of the novation itself: the contract records party assent, but a court still needs the off-chain agreement
- Credit scoring or default handling: the model assumes the buyer pays at maturity
- Fiat on/off-ramp: `Cash` is a contract, and settlement to fiat remains a bank relationship

## Timeline risk

The two items that can move a date are persistent-storage migration (Phase 1)
and the ERP mapper's tolerance for real purchase-order variance (also Phase 1).
Everything downstream is integration plumbing against an already-working
contract model.
