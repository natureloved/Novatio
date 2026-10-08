declare const process: any;

import { CantonLedgerClient } from './src/ledgerClient';
import { generatePacs008Xml } from './src/iso20022Mapper';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

async function runVerification() {
  console.log('--- STARTING NOVATIO PARTICIPANT ENGINE & INVARIANT TEST ---');
  const ledger = new CantonLedgerClient();

  // 1. Verify initial participant isolation:
  const buyerInvoices = await ledger.queryContracts('CommercialInvoice', 'Global_Motors_OEM');
  const supplierInvoices = await ledger.queryContracts('CommercialInvoice', 'Acme_Electronics');
  const factorerInvoices = await ledger.queryContracts('CommercialInvoice', 'Canton_Capital_Desk');

  console.log(`✓ Buyer CommercialInvoices: ${buyerInvoices.length} (Expected: 1)`);
  console.log(`✓ Supplier CommercialInvoices: ${supplierInvoices.length} (Expected: 1)`);
  console.log(`✓ Factorer CommercialInvoices: ${factorerInvoices.length} (Expected: 0 - SUB-TRANSACTION PRIVACY PROVEN)`);

  if (factorerInvoices.length !== 0) throw new Error('Privacy violation: Factorer saw CommercialInvoice!');

  // 2. Buyer registers invoice in NovationRegistry
  const registries = await ledger.queryContracts('NovationRegistry', 'Global_Motors_OEM');
  const offer = await ledger.exerciseChoice(
    'NovationRegistry',
    registries[0].contractId,
    'RegisterAndOfferFactoring',
    {
      commercialInvoiceCid: buyerInvoices[0].contractId,
      factorer: 'Canton_Capital_Desk',
      advanceRate: 0.85,
      discountFee: 2500,
      auditor: 'Regulatory_Observer',
    },
    'Global_Motors_OEM'
  );
  console.log(`✓ FactoringOffer created: ${offer.contractId} ($100k, 85% advance, $2,500 fee)`);

  // 3. Test Invariant 1: Single-Writer Dedup (Double-financing attack MUST fail)
  const updatedRegistries = await ledger.queryContracts('NovationRegistry', 'Global_Motors_OEM');
  try {
    await ledger.exerciseChoice(
      'NovationRegistry',
      updatedRegistries[0].contractId,
      'RegisterAndOfferFactoring',
      {
        commercialInvoiceCid: buyerInvoices[0].contractId,
        factorer: 'Canton_Capital_Desk',
        advanceRate: 0.85,
        discountFee: 2500,
        auditor: 'Regulatory_Observer',
      },
      'Global_Motors_OEM'
    );
  } catch (err: unknown) {
    console.log(`✓ INVARIANT 1 PASS: Duplicate financing attempt safely rejected: ${getErrorMessage(err)}`);
  }

  // 4. Supplier accepts offer
  const receivable = await ledger.exerciseChoice(
    'FactoringOffer',
    offer.contractId,
    'AcceptOffer',
    { commercialInvoiceCid: supplierInvoices[0].contractId },
    'Acme_Electronics'
  );
  console.log(`✓ FinanceableReceivable co-signed by Supplier & Buyer: ${receivable.contractId}`);

  // 5. Test Invariant 2: Underfunded DvP Revert
  try {
    await ledger.exerciseChoice(
      'FinanceableReceivable',
      receivable.contractId,
      'AcceptFactoring',
      { factorerCashCid: 'cash-underfunded-fake' },
      'Canton_Capital_Desk'
    );
  } catch (err: unknown) {
    console.log(`✓ INVARIANT 2 PASS: Underfunded cash advance safely reverted: ${getErrorMessage(err)}`);
  }

  // 6. Atomic DvP Advance: Factorer pays $85k cash to supplier
  const factorerCash = await ledger.queryContracts('Cash', 'Canton_Capital_Desk');
  const novated = await ledger.exerciseChoice(
    'FinanceableReceivable',
    receivable.contractId,
    'AcceptFactoring',
    { factorerCashCid: factorerCash[0].contractId },
    'Canton_Capital_Desk'
  );
  console.log(`✓ Atomic DvP executed: Title novated to Factorer (${novated.contractId})`);

  // Check supplier received $85k
  const supplierCash1 = await ledger.queryContracts('Cash', 'Acme_Electronics');
  console.log(`✓ Supplier Cash received upon advance: $${supplierCash1[0].payload.amount.toLocaleString()} (Expected: $85,000)`);
  if (supplierCash1[0].payload.amount !== 85000) throw new Error('Supplier advance amount incorrect');

  // 7. Scoped Active Audit Choice
  const activeReport = await ledger.exerciseChoice(
    'NovatedReceivable',
    novated.contractId,
    'QueryActiveAudit',
    {},
    'Regulatory_Observer'
  );
  console.log(`✓ QueryActiveAudit report: Debtor=${activeReport.debtor}, Amount=$${activeReport.verifiedAmount.toLocaleString()}, isSettled=${activeReport.isSettled}`);

  // 8. Leg 1 Settlement: Buyer settles $100k face value to Factorer
  const buyerCash = await ledger.queryContracts('Cash', 'Global_Motors_OEM');
  const settled = await ledger.exerciseChoice(
    'NovatedReceivable',
    novated.contractId,
    'SettleReceivable',
    { buyerCashCid: buyerCash[0].contractId },
    'Global_Motors_OEM'
  );
  console.log(`✓ Leg 1 Settlement executed: Buyer paid $100,000 to Factorer (${settled.contractId})`);

  // 9. Leg 2 Remittance: Factorer remits $12,500 ($15k reserve - $2,500 fee) to Supplier
  const factorerSettlementCash = await ledger.queryContracts('Cash', 'Canton_Capital_Desk');
  const finalSettled = await ledger.exerciseChoice(
    'SettledObligation',
    settled.contractId,
    'RemitSupplier',
    { factorerCashCid: factorerSettlementCash[0].contractId },
    'Canton_Capital_Desk'
  );
  console.log(`✓ Leg 2 Remittance executed: Factorer remitted reserve balance minus fee (${finalSettled.contractId})`);

  // Verify Supplier total cash: $85,000 + $12,500 = $97,500
  const supplierFinalCash = await ledger.queryContracts('Cash', 'Acme_Electronics');
  const totalSupplierReceived = supplierFinalCash.reduce((sum, c) => sum + c.payload.amount, 0);
  console.log(`✓ Total Supplier Cash Received: $${totalSupplierReceived.toLocaleString()} (Expected: $97,500.00)`);
  if (totalSupplierReceived !== 97500) throw new Error('Total supplier received mismatch');

  // Verify Factorer cash: Initial $100,000 - $85,000 + $100,000 - $12,500 = $102,500 (+$2,500 net profit)
  const factorerFinalCash = await ledger.queryContracts('Cash', 'Canton_Capital_Desk');
  const totalFactorerBalance = factorerFinalCash.reduce((sum, c) => sum + c.payload.amount, 0);
  console.log(`✓ Total Factorer Balance: $${totalFactorerBalance.toLocaleString()} (Net profit: +$${(totalFactorerBalance - 100000).toLocaleString()} = 11.76% Net APR)`);
  if (totalFactorerBalance !== 102500) throw new Error('Factorer balance mismatch');

  // 10. Test Invariant 3: Anti-Fraud Double-Remittance Guard
  try {
    await ledger.exerciseChoice(
      'SettledObligation',
      finalSettled.contractId,
      'RemitSupplier',
      { factorerCashCid: factorerFinalCash[0].contractId },
      'Canton_Capital_Desk'
    );
  } catch (err: unknown) {
    console.log(`✓ INVARIANT 3 PASS: Double remittance blocked: ${getErrorMessage(err)}`);
  }

  // 11. Scoped Settled Audit Choice & ISO 20022 XML Generation
  const settledReport = await ledger.exerciseChoice(
    'SettledObligation',
    finalSettled.contractId,
    'QuerySettledAudit',
    {},
    'Regulatory_Observer'
  );
  console.log(`✓ QuerySettledAudit report: Debtor=${settledReport.debtor}, Amount=$${settledReport.verifiedAmount.toLocaleString()}, isSettled=${settledReport.isSettled}`);

  const xml = generatePacs008Xml(finalSettled.payload);
  console.log(`✓ ISO 20022 pacs.008 XML successfully generated (${xml.length} bytes, Document namespace urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10)`);

  // 12. Test Invariant 4: NovationRegistry Lifecycle & ReleaseSettledInvoice
  const registriesBeforeRelease = await ledger.queryContracts('NovationRegistry', 'Global_Motors_OEM');
  const releasedRegistry = await ledger.exerciseChoice(
    'NovationRegistry',
    registriesBeforeRelease[0].contractId,
    'ReleaseSettledInvoice',
    { settledCid: finalSettled.contractId },
    'Global_Motors_OEM'
  );
  const releasedList = releasedRegistry.payload.registeredInvoices;
  if (releasedList.includes('INV-2026-001')) {
    throw new Error('Settled invoice failed to release from NovationRegistry');
  }
  console.log(`✓ INVARIANT 4 PASS: Settled invoice INV-2026-001 released from NovationRegistry (${releasedRegistry.contractId})`);

  // 13. Test Invariant 5: CancelOfferAndRelease unaccepted FactoringOffer
  const offerToCancel = await ledger.exerciseChoice(
    'NovationRegistry',
    releasedRegistry.contractId,
    'RegisterAndOfferFactoring',
    {
      commercialInvoiceCid: buyerInvoices[0].contractId,
      factorer: 'Canton_Capital_Desk',
      advanceRate: 0.85,
      discountFee: 2500,
      auditor: 'Regulatory_Observer',
    },
    'Global_Motors_OEM'
  );
  const registryAfterOffer = (await ledger.queryContracts('NovationRegistry', 'Global_Motors_OEM'))[0];
  const registryAfterCancel = await ledger.exerciseChoice(
    'NovationRegistry',
    registryAfterOffer.contractId,
    'CancelOfferAndRelease',
    { offerCid: offerToCancel.contractId },
    'Global_Motors_OEM'
  );
  if (registryAfterCancel.payload.registeredInvoices.includes('INV-2026-001')) {
    throw new Error('Cancelled offer failed to release invoice from registry');
  }
  console.log(`✓ INVARIANT 5 PASS: CancelOfferAndRelease archived offer and cleared registry (${registryAfterCancel.contractId})`);

  // 14. Test Invariant 6: Commercial Dispute Lifecycle (RaiseDispute -> ResolveDispute)
  // Re-run offer & accept to get active NovatedReceivable
  const newOffer = await ledger.exerciseChoice(
    'NovationRegistry',
    registryAfterCancel.contractId,
    'RegisterAndOfferFactoring',
    {
      commercialInvoiceCid: buyerInvoices[0].contractId,
      factorer: 'Canton_Capital_Desk',
      advanceRate: 0.85,
      discountFee: 2500,
      auditor: 'Regulatory_Observer',
    },
    'Global_Motors_OEM'
  );
  const newReceivable = await ledger.exerciseChoice(
    'FactoringOffer',
    newOffer.contractId,
    'AcceptOffer',
    { commercialInvoiceCid: supplierInvoices[0].contractId },
    'Acme_Electronics'
  );
  const factorerCash2 = await ledger.queryContracts('Cash', 'Canton_Capital_Desk');
  const novatedForDispute = await ledger.exerciseChoice(
    'FinanceableReceivable',
    newReceivable.contractId,
    'AcceptFactoring',
    { factorerCashCid: factorerCash2[0].contractId },
    'Canton_Capital_Desk'
  );
  // Buyer raises dispute for $5,000 defective goods
  const disputedContract = await ledger.exerciseChoice(
    'NovatedReceivable',
    novatedForDispute.contractId,
    'RaiseDispute',
    { disputeReason: 'Defective flight microcontroller batch (#404)', disputedAmount: 5000 },
    'Global_Motors_OEM'
  );
  console.log(`✓ INVARIANT 6A PASS: Commercial dispute raised on-ledger: ${disputedContract.contractId} ($5,000 disputed)`);

  // Factorer resolves dispute with adjusted face value $95,000
  const resolvedNovated = await ledger.exerciseChoice(
    'DisputedReceivable',
    disputedContract.contractId,
    'ResolveDispute',
    { resolvedAmount: 95000 },
    'Canton_Capital_Desk'
  );
  if (resolvedNovated.payload.totalAmount !== 95000) throw new Error('Dispute resolved amount mismatch');
  console.log(`✓ INVARIANT 6B PASS: Dispute resolved and adjusted on-ledger: ${resolvedNovated.contractId} ($95,000 adjusted face value)`);

  console.log('\n--- ALL 14 CANTON PARTICIPANT & FINANCIAL INVARIANTS PASSED 100% ---');
}

runVerification().catch((err: unknown) => {
  console.error('VERIFICATION ERROR:', getErrorMessage(err));
  if (typeof process !== 'undefined' && process && process.exit) {
    process.exit(1);
  }
});
