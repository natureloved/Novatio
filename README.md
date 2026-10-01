# NOVATIO: Confidential RWA Supply Chain Factoring & Atomic DvP on Canton Network

> **HackCanton Season #3: Track 1: Real-World Asset (RWA) & Business Workflows**  
> *Production-grade institutional trade finance invoice factoring leveraging Daml contract decomposition, single-writer authorization deduplication, and atomic Delivery vs Payment (DvP) on the Canton Network.*

---

## 1. Executive Summary

In commercial contract law, **novation** (*Latin: novatio*) is the formal legal doctrine where an existing contract is extinguished and replaced with a new obligation, specifically transferring the right to be paid from the original creditor (the supplier) to a new creditor (the factorer/bank) with the debtor's (the buyer's) explicit assent.

While supply chain accounts receivable factoring is a **$3 Trillion global market**, enterprise buyers and suppliers cannot tokenize or finance invoices on transparent public blockchains (Ethereum, Solana):
1. **Commercial Confidentiality & NDAs:** Publicly broadcasting part numbers, unit prices, supplier discounts, and volumes violates commercial non-disclosure agreements and exposes proprietary supply-chain margins to competitors.
2. **Double-Financing Fraud:** Centralized factoring portals rely on manual telephone/email checks and cannot prevent dishonest suppliers from pledging the exact same invoice to multiple financiers (e.g. the multi-billion dollar collapse of Greensill Capital).

**Novatio solves this on Canton Network** using native **sub-transaction privacy** and **authorization-based deduplication**.

---

## 2. Architectural Highlights & Canton Invariants

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Novatio Decomposed State Architecture                           │
├─────────────────────────┬───────────────────────────┬──────────────────────────────────┤
│ Contract Template       │ Signatories & Visibility  │ Mechanism & Cash Flow            │
├─────────────────────────┼───────────────────────────┼──────────────────────────────────┤
│ 1. CommercialInvoice    │ Signatory: Supplier, Buyer│ Holds private line items.        │
│                         │ Factorer has ZERO access. │ Validates line item total.       │
├─────────────────────────┼───────────────────────────┼──────────────────────────────────┤
│ 2. NovationRegistry     │ Signatory: Buyer          │ Single-writer authority anchor.  │
│    (Long-Lived)         │ Private to Buyer          │ Serializes creation; prevents    │
│                         │                           │ duplicate financing by dedup.    │
├─────────────────────────┼───────────────────────────┼──────────────────────────────────┤
│ 3. FactoringOffer       │ Signatory: Buyer          │ Created by Registry choice.      │
│                         │ Observer: Supplier,       │ Supplier exercises AcceptOffer   │
│                         │           Factorer,Auditor│ to co-sign the receivable.       │
├─────────────────────────┼───────────────────────────┼──────────────────────────────────┤
│ 4. FinanceableReceivable│ Signatory: Buyer, Supplier│ Terms only: total, due date, hash│
│                         │ Observer: Factorer,Auditor│ Factorer accepts via Atomic DvP. │
├─────────────────────────┼───────────────────────────┼──────────────────────────────────┤
│ 5. NovatedReceivable    │ Signatory: Buyer, Factorer│ Title novated to Factorer.       │
│                         │ Observer: Supplier,Auditor│ Advance ($85k) paid to Supplier. │
│                         │                           │ Leg 1: Buyer settles face value. │
├─────────────────────────┼───────────────────────────┼──────────────────────────────────┤
│ 6. SettledObligation    │ Signatory: Buyer, Factorer│ Leg 2: Factorer remits reserve   │
│                         │ Observer: Supplier,Auditor│ minus discount fee to Supplier.  │
│                         │                           │ Scoped audit choices survive.    │
└─────────────────────────┴───────────────────────────┴──────────────────────────────────┘
```

### Key Technical Breakthroughs:
1. **Contract Decomposition (Separation by Visibility Scope):** 
   - `CommercialInvoice`: Signatories `buyer, supplier` only. Holds private line-item part numbers, quantities, and unit pricing. The factorer **never receives or sees** this contract.
   - `FinanceableReceivable`: Signatories `buyer, supplier`, observers `factorer, auditor`. Holds only the buyer-attested obligation: buyer identity, supplier identity, total amount, due date, and cryptographic invoice hash.
2. **Single-Writer Authorization Dedup (Canton 3.x Ready):** Canton has no global contract store and trades away global data uniqueness for sub-transaction privacy. Rather than relying on deprecated contract keys, Novatio makes the **Buyer the single writer of its own receivables** via a long-lived `NovationRegistry` contract. All factoring requests serialize through a consuming choice on this registry, turning double-financing prevention into an **authorization and contention invariant**.
3. **Joint Cryptographic Invoice Attestation:** The buyer derives the SHA-256 commitment hash from the `CommercialInvoice`. In `AcceptOffer`, the supplier independently recomputes and verifies the hash against its own copy of the invoice before co-signing the `FinanceableReceivable`.
4. **Atomic DvP Cash Settlement:** Advance funding executes atomically inside `AcceptFactoring` using a native `Cash` contract leg. The factorer's cash transfers to the supplier in the exact same transaction that the receivable is novated. If the factorer is underfunded, the entire transaction reverts.
5. **Two-Legged Settlement & Remittance:** Upon maturity, the buyer settles the full face value ($100,000) directly to the factorer out of the buyer's cash. The factorer then remits the reserve balance minus the discount fee ($15,000 - $2,500 = $12,500) to the supplier out of the factorer's cash. Each cash movement is driven strictly by the party whose money it is, respecting Canton's contract divulgence constraints.
6. **Scoped Regulatory Audit Choice & ISO 20022 Mapping:** Non-consuming audit choices (`QueryActiveAudit` and `QuerySettledAudit`) survive contract closure, supported by an off-chain mapper exporting ISO 20022 `pacs.008` XML payment transfer messages.

---

## 3. Financial Model & Unit Economics

| Economic Parameter | Value | Financial Explanation |
|---|---|---|
| **Invoice Face Value** | **$100,000.00** | Net-90 commercial obligation payable by Enterprise Buyer. |
| **Payment Terms** | **90 Days (Net-90)** | Standard corporate working capital payment window. |
| **Advance Rate** | **85.0% ($85,000.00)** | Disbursed immediately (T+0) to Supplier upon atomic factoring. |
| **Reserve Balance** | **15.0% ($15,000.00)** | Retained by Factorer until Buyer settles the invoice at maturity. |
| **Factoring Discount Fee** | **2.50% ($2,500.00)** | 2.5% of face value, deducted from the reserve upon final settlement. |
| **Final Supplier Remittance** | **$12,500.00** | Reserve ($15,000.00) − Discount Fee ($2,500.00) paid at Net-90. |
| **Total Cash Received by Supplier** | **$97,500.00** | Advance ($85,000.00) + Remittance ($12,500.00). |
| **Supplier Cost of Capital** | **2.50% Flat** | $2,500.00 total fee paid for 90 days of liquidity. |
| **Factorer Capital Deployed** | **$85,000.00** | Principal committed for 90 days. |
| **Factorer Net Profit** | **$2,500.00** | $100,000 recovery − $85,000 advance − $12,500 remittance. |
| **Factorer Quarterly Net Yield** | **2.941%** | $2,500 / $85,000 = 2.941% return per 90-day cycle. |
| **Factorer Annualized Return (APR)** | **11.76% ≈ 11.8%** | 2.941% × 4 = 11.76% annualized asset-backed APR. |
| **Protocol Technology Fee** | **0.15% ($150.00)** | Software clearing fee captured by Novatio protocol. |

---

## 4. Repository Structure

```text
novatio/
├── daml.yaml                           # Daml package manifest
├── daml/
│   ├── Novatio.daml                    # Core Daml templates (Cash, CommercialInvoice, NovationRegistry, FinanceableReceivable, etc.)
│   └── Tests/
│       └── NovatioTest.daml            # Deterministic test script verifying privacy isolation, DvP cash legs & dedup
├── frontend/
│   ├── src/
│   │   ├── ledgerClient.ts             # TypeScript client supporting Canton JSON API v1/v2 & authentic in-memory isolation engine
│   │   ├── iso20022Mapper.ts           # Mapper exporting settled obligations to ISO 20022 pacs.008 XML
│   │   ├── App.tsx                     # Main interactive dashboard container with Split-Node console & live ledger feeds
│   │   ├── index.css                   # Vanilla CSS dark-mode institutional design system
│   │   └── main.tsx                    # React Vite application entry point
│   ├── package.json
│   ├── index.html
│   ├── tsconfig.json
│   └── vite.config.ts
├── docs/
│   ├── BUSINESS-BRIEF.md               # 1-page business brief (ICP, use case, who pays, why Canton)
│   ├── PILOT-PLAN.md                   # 3-step enterprise pilot implementation roadmap
│   └── PITCH-SCRIPT.md                 # Unbroken 60-second pitch script (0:00 to 0:60)
└── README.md                           # Documentation, architectural guide, and verification
```

---

## 5. Quickstart & Verification

### A. Smart Contracts & Tests (Daml SDK)
If Daml SDK is installed:
```bash
# Run the complete deterministic test suite:
daml test

# Build the DAR package:
daml build -o novatio-1.0.0.dar
```

### B. Interactive Frontend Dashboard
```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start local development server
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

The frontend is equipped with:
- **Split-Node Console:** Side-by-side Buyer vs Factorer participant node view proving sub-transaction privacy.
- **Data-Driven Redaction Verification:** Direct query asserting 0 `CommercialInvoice` records returned to Factorer node.
- **Interactive Lifecycle Workflow:**
  1. *Buyer Node:* Register in `NovationRegistry` & emit `FactoringOffer`.
  2. *Supplier Node:* Accept offer, recompute SHA-256 hash, and co-sign `FinanceableReceivable`.
  3. *Factorer Node:* Fund $85,000 cash advance atomically via DvP.
  4. *Buyer Node:* Settle Leg 1 ($100,000 full face value) at maturity.
  5. *Factorer Node:* Remit Leg 2 ($12,500 reserve minus fee) to Supplier.
  6. *Auditor Node:* Exercise `QueryActiveAudit` and `QuerySettledAudit`, preview and export ISO 20022 `pacs.008` XML.
- **Participant Switching:** Switch between `Acme_Electronics`, `Global_Motors_OEM`, `Canton_Capital_Desk`, and `Regulatory_Observer`.

---

## 6. Official HackCanton Track 1 Deliverables
- [1-Page Business Brief](docs/BUSINESS-BRIEF.md)
- [Enterprise Pilot Implementation Plan](docs/PILOT-PLAN.md)
- [60-Second Pitch Script](docs/PITCH-SCRIPT.md)
