/**
 * ISO 20022 Financial Messaging Mapper
 * - pacs.008.001.10: Financial Institution Customer Credit Transfer (Leg 1: Buyer pays full face value to Factorer)
 * - camt.054.001.08: Bank To Customer Debit Credit Notification (Leg 2: Factorer remits reserve balance minus fee to Supplier)
 */

export interface SettledObligationData {
  invoiceNumber: string;
  totalAmount: number;
  reserveAmount?: number;
  discountFee?: number;
  buyer: string;
  supplier: string;
  factorer: string;
  invoiceHash: string;
}

/**
 * Leg 1: FI-to-FI Customer Credit Transfer (pacs.008.001.10)
 */
export function generatePacs008Xml(data: SettledObligationData): string {
  const msgId = `NOVATIO-PACS008-${Date.now()}`;
  const creationTime = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${creationTime}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
        <ClrSys>
          <Prtry>CANTON-NETWORK</Prtry>
        </ClrSys>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>${data.invoiceNumber}</EndToEndId>
        <TxId>CANTON-TX-${data.invoiceHash.slice(0, 12)}</TxId>
      </PmtId>
      <IntrBkSttlmAmt Ccy="USD">${data.totalAmount.toFixed(2)}</IntrBkSttlmAmt>
      <IntrBkSttlmDt>${creationTime.slice(0, 10)}</IntrBkSttlmDt>
      <Dbtr>
        <Nm>${data.buyer}</Nm>
      </Dbtr>
      <Cdtr>
        <Nm>${data.factorer}</Nm>
      </Cdtr>
      <RmtInf>
        <Ustrd>Leg 1 Full Settlement: ${data.invoiceNumber} | Debtor: ${data.buyer} | Creditor: ${data.factorer} | Commitment Hash: ${data.invoiceHash}</Ustrd>
      </RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
}

/**
 * Leg 2: Bank to Customer Credit Notification (camt.054.001.08)
 * Disbursed upon factorer reserve remittance to supplier.
 */
export function generateCamt054Xml(data: SettledObligationData): string {
  const msgId = `NOVATIO-CAMT054-${Date.now()}`;
  const creationTime = new Date().toISOString();
  const reserve = data.reserveAmount ?? (data.totalAmount * 0.15);
  const fee = data.discountFee ?? 2500;
  const remittedAmount = Math.max(0, reserve - fee);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${creationTime}</CreDtTm>
    </GrpHdr>
    <Ntfctn>
      <Id>NTFCTN-${data.invoiceNumber}</Id>
      <CreDtTm>${creationTime}</CreDtTm>
      <Acct>
        <Id><Othr><Id>${data.supplier}-ESCROW</Id></Othr></Id>
      </Acct>
      <Ntry>
        <Amt Ccy="USD">${remittedAmount.toFixed(2)}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${creationTime.slice(0, 10)}</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>${data.invoiceNumber}</EndToEndId>
              <TxId>CANTON-REMIT-${data.invoiceHash.slice(0, 12)}</TxId>
            </Refs>
            <Amt Ccy="USD">${remittedAmount.toFixed(2)}</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <RltdPties>
              <Dbtr><Nm>${data.factorer}</Nm></Dbtr>
              <Cdtr><Nm>${data.supplier}</Nm></Cdtr>
            </RltdPties>
            <RmtInf>
              <Ustrd>Leg 2 Reserve Remittance: Gross Reserve $${reserve.toFixed(2)} minus Discount Fee $${fee.toFixed(2)} = Net $${remittedAmount.toFixed(2)}</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
}

/**
 * Browser-only download helpers
 */
export function downloadPacs008Xml(data: SettledObligationData) {
  const xml = generatePacs008Xml(data);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pacs008_${data.invoiceNumber}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCamt054Xml(data: SettledObligationData) {
  const xml = generateCamt054Xml(data);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `camt054_remittance_${data.invoiceNumber}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}
