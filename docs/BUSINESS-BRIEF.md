# NOVATIO — 1-Page Business Brief (HackCanton Season #3)

## 1. Executive Summary
Novatio brings the $3 Trillion trade finance invoice factoring market to Canton Network. Enterprise suppliers waiting 60–90 days for payments cannot use public blockchains because exposing customer names, line-items, and negotiated prices violates enterprise NDAs and leaks trade secrets. Novatio uses Daml contract decomposition and atomic Delivery vs Payment (DvP) to let institutional lenders finance receivables in seconds with mathematical commercial confidentiality.

## 2. Ideal Customer Profile (ICP)
- **Primary Borrowers:** Mid-market automotive, aerospace, and electronics manufacturing suppliers ($10M–$150M revenue) operating on Net-60/Net-90 payment terms.
- **Enterprise Debtors:** Tier-1 OEM manufacturers (e.g. Boeing, General Motors, Siemens) who demand long payment windows but maintain prime credit ratings.
- **Liquidity Providers:** Institutional private credit funds and corporate treasury desks seeking short-duration (30–90 day), high-yield asset-backed returns.

## 3. Revenue Model & Unit Economics (Who Pays?)
- **Face Value:** $100,000.00 commercial invoice due in 90 days.
- **Advance Leg:** 85% ($85,000.00) cash advance disbursed immediately to supplier upon factoring.
- **Reserve Leg:** 15% ($15,000.00) held in reserve until buyer settlement.
- **Discount Fee:** 2.5% ($2,500.00) of face value.
- **Net Remittance:** Upon settlement, supplier receives Reserve ($15,000) − Fee ($2,500) = $12,500.00. Total supplier received: $97,500.00 (effective cost: 2.50%).
- **Factorer Yield:** Factorer earns $2,500.00 on $85,000.00 capital deployed for 90 days = 2.941% quarterly return ≈ 11.8% annualized asset-backed APR.
- **Novatio Protocol Fee:** Novatio captures 0.15% technology clearing fee per transaction ($150 on $100k).

## 4. Why Canton Network?
- **Contract Decomposition Privacy:** Confidential line-items exist solely on a bilateral `CommercialInvoice` contract between buyer and supplier. The financier receives a `FinanceableReceivable` containing only buyer attestation and total amount.
- **Single-Writer Authorization Dedup:** Canton deliberately has no global state. Novatio makes the enterprise buyer the single-writer authority anchor via a long-lived `NovationRegistry`, turning double-financing prevention into a Canton-native authorization and contention guarantee.
- **Atomic DvP Settlement:** Cash advance disbursement and title novation occur in the single choice `AcceptFactoring` with zero settlement counterparty risk.
