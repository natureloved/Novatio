[00:00 - 00:15] THE PROBLEM & PRIVACY CONFLICT
Speaker: "Acme Electronics has shipped $100,000 of microcontrollers to Global Motors on 90-day terms. They need cash today, but cannot tokenize invoices on Ethereum because exposing unit prices violates enterprise NDAs. On Novatio, Global Motors co-signs a private CommercialInvoice visible only to them."

[00:15 - 00:30] SINGLE-WRITER DEDUP & CONTRACT DECOMPOSITION
Speaker: "Global Motors registers the invoice in its NovationRegistry. Canton has no global state, so we don't pretend a key can give global uniqueness. We made the buyer the single writer of its own receivables, turning duplicate-financing prevention into an authorization invariant. Acme receives a decomposed FinanceableReceivable: terms are verified, but line items are omitted."

[00:30 - 00:45] ATOMIC DvP FACTORING ADVANCE
Speaker: "Canton Capital Desk clicks 'Fund Advance'. In one atomic Daml choice, $85,000 in Cash moves to Acme's wallet, and title novates to Canton Capital. If the factorer is underfunded, the entire choice reverts. Zero escrow risk."

[00:45 - 00:60] TWO-LEG SETTLEMENT & AUDIT
Speaker: "At maturity, Global Motors settles the $100,000 face value directly to the factorer. The factorer remits the $12,500 reserve balance to Acme. The regulator exercises an on-chain scoped audit choice, verifying transaction provenance without ever seeing supplier pricing. That is Novatio: production-ready trade finance on Canton."
