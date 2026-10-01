/**
 * ISO 20022 pacs.008.001.10 Mapper
 * Maps settled Daml obligations into financial institution credit transfer XML messages.
 * Leg 1 settlement: Buyer transfers full face value ($100,000.00) to Factorer.
 */

export interface SettledObligationData {
  invoiceNumber: string;
  totalAmount: number;
  buyer: string;
  supplier: string;
  factorer: string;
  invoiceHash: string;
}

/**
 * Pure XML generator (platform-independent)
 */
export function generatePacs008Xml(data: SettledObligationData): string {
  const msgId = `NOVATIO-${Date.now()}`;
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
 * Browser-only download helper
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
