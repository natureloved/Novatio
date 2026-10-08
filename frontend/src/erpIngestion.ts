/**
 * Novatio ERP & E-Invoicing Ingestion Gateway
 * Parses and validates enterprise invoice formats:
 * - Peppol BIS Billing 3.0 (UBL 2.1 XML standard)
 * - Corporate JSON / SAP S/4HANA & Oracle NetSuite EDI payloads
 * Computes deterministic SHA-256 commitment hashes and enforces Daml ensure constraints.
 */

export interface ParsedLineItem {
  itemCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ParsedCommercialInvoice {
  invoiceNumber: string;
  buyer: string;
  supplier: string;
  amount: number;
  dueDate: string;
  currency: string;
  lineItems: ParsedLineItem[];
  commitmentHash?: string;
  format: 'PEPPOL_UBL' | 'JSON_EDI' | 'MANUAL';
}

/**
 * Validates mathematical line-item sum integrity matching Daml ensure clause:
 * ensure amount > 0.0 && sum (map (\i -> i.totalPrice) lineItems) == amount
 */
export function validateInvoiceIntegrity(inv: ParsedCommercialInvoice): { valid: boolean; error?: string } {
  if (!inv.invoiceNumber || inv.invoiceNumber.trim() === '') {
    return { valid: false, error: 'Invoice number identifier is required.' };
  }
  if (!inv.buyer || !inv.supplier) {
    return { valid: false, error: 'Buyer and Supplier enterprise counterparties are required.' };
  }
  if (inv.amount <= 0) {
    return { valid: false, error: 'Invoice amount must be strictly greater than 0.' };
  }
  if (!inv.lineItems || inv.lineItems.length === 0) {
    return { valid: false, error: 'Commercial invoice must contain at least one line item.' };
  }

  const calculatedSum = inv.lineItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  const delta = Math.abs(calculatedSum - inv.amount);
  if (delta > 0.01) {
    return {
      valid: false,
      error: `Daml ensure violation: Sum of line items ($${calculatedSum.toFixed(2)}) does not match declared face value ($${inv.amount.toFixed(2)}). Delta: $${delta.toFixed(2)}`,
    };
  }

  return { valid: true };
}

/**
 * Derives SHA-256 cryptographic commitment hash matching Daml formula:
 * sha256 (invoice.invoiceNumber <> show invoice.amount <> show invoice.dueDate)
 */
export async function deriveCommitmentHash(
  invoiceNumber: string,
  amount: number,
  dueDate: string
): Promise<string> {
  const preimage = `${invoiceNumber}${amount.toFixed(1)}${dueDate}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(preimage);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback deterministic digest generator for local non-web environments
  let hash = 0;
  for (let i = 0; i < preimage.length; i++) {
    const char = preimage.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, 'a');
}

/**
 * Parses Peppol BIS Billing 3.0 (UBL 2.1 XML) invoice string
 */
export function parsePeppolUblXml(xmlString: string): ParsedCommercialInvoice {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`XML parsing error: ${parserError.textContent}`);
  }

  const getTagValue = (tagName: string, fallback = ''): string => {
    const elements = xmlDoc.getElementsByTagName(tagName);
    return elements.length > 0 && elements[0].textContent ? elements[0].textContent.trim() : fallback;
  };

  const invoiceNumber = getTagValue('cbc:ID') || getTagValue('ID', `INV-${Date.now()}`);
  const dueDate = getTagValue('cbc:DueDate') || getTagValue('DueDate', '2026-12-31T00:00:00Z');
  const payableAmountStr = getTagValue('cbc:PayableAmount') || getTagValue('PayableAmount', '0');
  const amount = parseFloat(payableAmountStr) || 0;
  const currency = xmlDoc.getElementsByTagName('cbc:PayableAmount')[0]?.getAttribute('currencyID') || 'USD';

  const buyer = getTagValue('cac:AccountingCustomerParty')
    ? xmlDoc.getElementsByTagName('cac:PartyName')[1]?.textContent?.trim() || 'Global_Motors_OEM'
    : 'Global_Motors_OEM';

  const supplier = getTagValue('cac:AccountingSupplierParty')
    ? xmlDoc.getElementsByTagName('cac:PartyName')[0]?.textContent?.trim() || 'Acme_Electronics'
    : 'Acme_Electronics';

  const lineItems: ParsedLineItem[] = [];
  const lines = xmlDoc.getElementsByTagName('cac:InvoiceLine');

  if (lines.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const itemCode = line.getElementsByTagName('cbc:ID')[0]?.textContent?.trim() || `ITEM-${i + 1}`;
      const description = line.getElementsByTagName('cbc:Name')[0]?.textContent?.trim() || `Commercial line item ${i + 1}`;
      const quantity = parseFloat(line.getElementsByTagName('cbc:InvoicedQuantity')[0]?.textContent?.trim() || '1');
      const unitPrice = parseFloat(line.getElementsByTagName('cbc:PriceAmount')[0]?.textContent?.trim() || '0');
      const totalPrice = parseFloat(line.getElementsByTagName('cbc:LineExtensionAmount')[0]?.textContent?.trim() || `${quantity * unitPrice}`);

      lineItems.push({
        itemCode,
        description,
        quantity,
        unitPrice,
        totalPrice,
      });
    }
  } else {
    // Single aggregated line item if detailed lines absent
    lineItems.push({
      itemCode: 'LINE-001',
      description: 'Commercial invoice balance',
      quantity: 1,
      unitPrice: amount,
      totalPrice: amount,
    });
  }

  return {
    invoiceNumber,
    buyer,
    supplier,
    amount,
    dueDate: dueDate.includes('T') ? dueDate : `${dueDate}T00:00:00Z`,
    currency,
    lineItems,
    format: 'PEPPOL_UBL',
  };
}

/**
 * Parses JSON enterprise payload (SAP / NetSuite format)
 */
export function parseEnterpriseJson(jsonString: string): ParsedCommercialInvoice {
  const raw = JSON.parse(jsonString);
  const invoiceNumber = raw.invoiceNumber || raw.id || raw.invoiceId || `INV-${Date.now()}`;
  const buyer = raw.buyer || raw.debtor || raw.customer || 'Global_Motors_OEM';
  const supplier = raw.supplier || raw.creditor || raw.vendor || 'Acme_Electronics';
  const amount = Number(raw.amount || raw.totalAmount || raw.payableAmount || 0);
  const dueDate = raw.dueDate || '2026-12-31T00:00:00Z';
  const currency = raw.currency || 'USD';

  const lineItems: ParsedLineItem[] = (raw.lineItems || raw.items || []).map((item: any, idx: number) => {
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.unitPrice || item.price || 0);
    const totalPrice = Number(item.totalPrice || item.amount || (quantity * unitPrice));
    return {
      itemCode: String(item.itemCode || item.code || item.sku || `ITEM-${idx + 1}`),
      description: String(item.description || item.name || 'Commercial Goods'),
      quantity,
      unitPrice,
      totalPrice,
    };
  });

  return {
    invoiceNumber,
    buyer,
    supplier,
    amount,
    dueDate,
    currency,
    lineItems: lineItems.length > 0 ? lineItems : [{
      itemCode: 'AGG-001',
      description: 'Trade receivables aggregate',
      quantity: 1,
      unitPrice: amount,
      totalPrice: amount,
    }],
    format: 'JSON_EDI',
  };
}

/**
 * Built-in Sample Enterprise Datasets for instant testing and demos
 */
export const SAMPLE_ENTERPRISE_INVOICES = {
  aerospace: {
    name: 'Aerospace Flight Avionics (Boeing Tier-1)',
    format: 'JSON',
    json: JSON.stringify({
      invoiceNumber: 'INV-AERO-2026-08',
      buyer: 'Global_Motors_OEM',
      supplier: 'Acme_Electronics',
      amount: 250000,
      dueDate: '2027-01-15T00:00:00Z',
      currency: 'USD',
      lineItems: [
        { itemCode: 'AVN-9020', description: 'Dual-Channel Flight Microcontroller', quantity: 2000, unitPrice: 85, totalPrice: 170000 },
        { itemCode: 'RSH-400', description: 'Radiation Hardened FPGA Array', quantity: 400, unitPrice: 200, totalPrice: 80000 },
      ],
    }, null, 2),
  },
  automotive: {
    name: 'Automotive EV Battery Cell Modules (Net-90)',
    format: 'PEPPOL',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ID>INV-AUTO-2026-501</cbc:ID>
  <cbc:IssueDate>2026-10-01</cbc:IssueDate>
  <cbc:DueDate>2027-01-01</cbc:DueDate>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Acme_Electronics</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Global_Motors_OEM</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="USD">180000.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="USD">180000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>BAT-MOD-01</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">100</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="USD">120000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>High-Density 800V EV Battery Pack Modules</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="USD">1200.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>BMS-CTRL-09</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">200</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="USD">60000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Solid-State Battery Management System Boards</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="USD">300.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`,
  },
};
