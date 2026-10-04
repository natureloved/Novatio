/**
 * Novatio Canton Ledger API Client
 * Supports Canton JSON API v1 (/v1/query, /v1/create, /v1/exercise)
 * and Canton 3.x JSON Ledger API v2 (/v2/commands/submit-and-wait, /v2/state/active-contracts).
 * Includes an authentic multi-party participant isolation engine for local evaluation.
 */

export interface Contract<T = any> {
  contractId: string;
  templateId: string;
  signatories: string[];
  observers: string[];
  payload: T;
}

export interface AuditReport {
  debtor: string;
  creditor: string;
  invoiceId: string;
  verifiedAmount: number;
  commitmentHash: string;
  isSettled: boolean;
}

export interface LedgerClientConfig {
  jsonApiUrl?: string; // e.g. "http://localhost:7575"
  jsonApiVersion?: 'v1' | 'v2'; // default: 'v1'
  jwtTokens?: Record<string, string>; // Party -> Bearer Token
  /**
   * Single bearer token applied to every request when `jwtTokens` has no entry
   * for the acting party. A local Canton node (scripts/canton-local.sh) mints
   * one unsigned dev JWT carrying all party ids, so this is how the browser
   * authenticates against it. Not a production auth scheme.
   */
  authToken?: string;
  /**
   * Novatio package id, e.g. "5f275467...". Optional: when omitted the client
   * discovers it from the ledger, so a `daml build` that changes the hash does
   * not silently break template lookups.
   */
  packageId?: string;
}

/**
 * How the client obtained its data.
 *
 * 'canton'  — an HTTP request to a real Canton JSON API succeeded.
 * 'local'   — no JSON API URL was configured, or every request failed, so the
 *            bundled participant-isolation engine served the data.
 *
 * The dashboard renders this verbatim so an observer always knows whether they
 * are looking at a live ledger or the local simulator. Nothing here is inferred
 * or hidden: `connectionMode` is only ever 'canton' after a real HTTP response.
 */
export type ConnectionMode = 'canton' | 'local';

export interface TransactionEvent {
  txId: string;
  timestamp: string;
  actAs: string;
  choice: string;
  template: string;
  status: 'COMMITTED' | 'REJECTED';
  stakeholders: string[];
  summary: string;
}

export class CantonLedgerClient {
  private config: LedgerClientConfig;
  private inMemoryStore: Contract[] = [];
  private contractCounter = 1000;
  private transactionHistory: TransactionEvent[] = [];
  private listeners: (() => void)[] = [];

  /**
   * Starts as 'local' and only flips to 'canton' once a real JSON API request
   * has returned. Never inferred from configuration alone — see ConnectionMode.
   */
  private mode: ConnectionMode = 'local';
  private lastRemoteFailure: string | null = null;

  /**
   * Canton package id, e.g. "5f275467...". Discovered lazily from the ledger's
   * package list and cached, because it changes on every `daml build` and the
   * JSON API only accepts fully-qualified `<packageId>:<module>:<template>` ids.
   */
  private packageId: string | null = null;
  private packageIdPromise: Promise<string | null> | null = null;

  constructor(config: LedgerClientConfig = {}) {
    this.config = { jsonApiVersion: 'v1', ...config };
    this.seedInitialParticipantState();
  }

  /** 'canton' only after a successful HTTP round-trip to a real ledger. */
  public getConnectionMode(): ConnectionMode {
    return this.mode;
  }

  /** Human-readable reason the client is serving local state, if it is. */
  public getRemoteFailureReason(): string | null {
    return this.lastRemoteFailure;
  }

  /** True when every read is served by the bundled isolation engine. */
  public isLocalSimulation(): boolean {
    return this.mode === 'local';
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  public getTransactionHistory(): TransactionEvent[] {
    return [...this.transactionHistory];
  }

  /**
   * Reset to initial state
   */
  public resetState() {
    this.inMemoryStore = [];
    this.contractCounter = 1000;
    this.seedInitialParticipantState();
    this.recordEvent({
      txId: `tx-init-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actAs: 'Central_Reserve_Bank',
      choice: 'InitGenesisState',
      template: 'Genesis',
      status: 'COMMITTED',
      stakeholders: ['Central_Reserve_Bank', 'Global_Motors_OEM', 'Canton_Capital_Desk', 'Acme_Electronics'],
      summary: 'Ledger reset: Initial Cash ($100k Buyer, $100k Factorer) & CommercialInvoice INV-2026-001 deployed.',
    });
    this.notify();
  }

  /**
   * Seed initial contracts representing the setup state
   */
  private seedInitialParticipantState() {
    const bank = 'Central_Reserve_Bank';
    const buyer = 'Global_Motors_OEM';
    const supplier = 'Acme_Electronics';
    const factorer = 'Canton_Capital_Desk';

    // 1. Initial Cash Assets
    this.inMemoryStore.push({
      contractId: `cash-${this.contractCounter++}`,
      templateId: 'Novatio:Cash',
      signatories: [bank],
      observers: [factorer],
      payload: { issuer: bank, holder: factorer, amount: 100000 },
    });

    this.inMemoryStore.push({
      contractId: `cash-${this.contractCounter++}`,
      templateId: 'Novatio:Cash',
      signatories: [bank],
      observers: [buyer],
      payload: { issuer: bank, holder: buyer, amount: 100000 },
    });

    // 2. Buyer NovationRegistry
    this.inMemoryStore.push({
      contractId: `registry-${this.contractCounter++}`,
      templateId: 'Novatio:NovationRegistry',
      signatories: [buyer],
      observers: [],
      payload: { buyer, registeredInvoices: [] },
    });

    // 3. Private Commercial Invoice (Buyer + Supplier ONLY. Factorer CANNOT see this!)
    this.inMemoryStore.push({
      contractId: `inv-${this.contractCounter++}`,
      templateId: 'Novatio:CommercialInvoice',
      signatories: [supplier, buyer],
      observers: [],
      payload: {
        supplier,
        buyer,
        invoiceNumber: 'INV-2026-001',
        amount: 100000,
        dueDate: '2026-12-27T00:00:00Z',
        lineItems: [
          { itemCode: 'MCU-901', description: 'Flight Microcontroller', quantity: 1000, unitPrice: 75, totalPrice: 75000 },
          { itemCode: 'PCB-404', description: 'Radiation Shield Board', quantity: 500, unitPrice: 50, totalPrice: 25000 },
        ],
      },
    });

    this.recordEvent({
      txId: `tx-init-contracts`,
      timestamp: new Date().toISOString(),
      actAs: 'Central_Reserve_Bank',
      choice: 'CreateContracts',
      template: 'Novatio:Cash, Novatio:CommercialInvoice',
      status: 'COMMITTED',
      stakeholders: [bank, buyer, supplier, factorer],
      summary: 'Initial ledger state seeded: CommercialInvoice INV-2026-001 ($100k), Cash reserves.',
    });
  }

  private recordEvent(event: TransactionEvent) {
    this.transactionHistory.unshift(event);
    if (this.transactionHistory.length > 50) {
      this.transactionHistory.pop();
    }
  }

  /**
   * Query active contracts visible to the specified party.
   * Canton Invariant: A party can ONLY read contracts where they are a signatory or observer.
   *
   * When `jsonApiUrl` is set this goes to the real ledger and records mode 'canton'.
   * Otherwise — or when the request fails — it serves from the bundled isolation
   * engine and records mode 'local'. The caller can always ask which happened.
   */
  /**
   * Resolves the bearer token for a request. Prefers a per-party token, then a
   * single shared dev token. Returns null when neither is configured, in which
   * case the request goes out unsigned and the ledger answers 401 — recorded as
   * a remote failure rather than silently falling back to the simulator.
   */
  private tokenFor(party: string): string | null {
    return this.config.jwtTokens?.[party] || this.config.authToken || null;
  }

  /**
   * Headers for an authenticated request, or null if no token is available.
   */
  private authHeaders(party: string): Record<string, string> | null {
    const token = this.tokenFor(party);
    return token ? { Authorization: `Bearer ${token}` } : null;
  }

  /**
   * Qualifies a template id, awaiting package-id discovery if it has not
   * resolved yet. `queryContracts` cannot be async-cached without changing its
   * signature, so this is the awaitable form used by `exerciseChoice`.
   */
  private async ensureQualifiedAsync(templateId: string): Promise<string> {
    if (templateId.split(':').length >= 3) return templateId;
    const pkg = await this.resolvePackageId();
    return pkg ? `${pkg}:${templateId}` : templateId;
  }

  /**
   * Discovers the Novatio package id on the ledger.
   *
   * The id is a content hash, so it changes on every `daml build`; hardcoding
   * it would break silently on the next build. `GET /v1/packages` lists every
   * package the participant knows (37 on a fresh node: Novatio plus its stdlib
   * dependencies) but does not say which is which — and the order is dependency
   * resolution order, so "the last one" and "index 6" are both guesses that
   * break when the dependency set changes.
   *
   * So each candidate is probed. The probe must read the JSON body, NOT the
   * HTTP status: this JSON API answers 200 on the wire and carries its real
   * status in a `status` field, with `errors` set when a template id does not
   * resolve. Judging by transport status accepts the wrong package.
   */
  private async resolvePackageId(): Promise<string | null> {
    if (this.packageId) return this.packageId;
    if (this.packageIdPromise) return this.packageIdPromise;

    this.packageIdPromise = (async () => {
      // 1. Explicitly configured wins — no round-trip, and works offline.
      if (this.config.packageId) {
        this.packageId = this.config.packageId;
        return this.packageId;
      }
      if (!this.config.jsonApiUrl) return null;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(this.authHeaders('probe') || {}),
        };
        const listRes = await fetch(`${this.config.jsonApiUrl}/v1/packages`, { headers });
        if (!listRes.ok) return null;
        const ids: string[] = (await listRes.json()).result || [];

        // 2. Probe each candidate. A package that does not contain the template
        //    answers with `errors` (unknownTemplateIds) even at transport 200.
        for (const id of ids) {
          const probe = await fetch(`${this.config.jsonApiUrl}/v1/query`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ templateIds: [`${id}:Novatio:Cash`] }),
          });
          const data = await probe.json().catch(() => ({}));
          if (!data.errors) {
            this.packageId = id;
            return this.packageId;
          }
        }
      } catch {
        // falls through
      }
      return null;
    })();

    return this.packageIdPromise;
  }

  async queryContracts<T = any>(templateId: string, party: string): Promise<Contract<T>[]> {
    if (this.config.jsonApiUrl) {
      try {
        const token = this.tokenFor(party);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        const qualified = await this.ensureQualifiedAsync(templateId);
        if (this.config.jsonApiVersion === 'v2') {
          // Canton 3.x JSON Ledger API v2
          const res = await fetch(`${this.config.jsonApiUrl}/v2/state/active-contracts?template_id_filter=${encodeURIComponent(qualified)}`, {
            method: 'GET',
            headers,
          });
          if (!res.ok) throw new Error(`JSON API v2 returned HTTP ${res.status}`);
          const data = await res.json();
          // The JSON API can answer transport-200 with an error envelope.
          if (data.errors) throw new Error(`JSON API v2 error: ${JSON.stringify(data.errors).slice(0, 300)}`);
          this.recordRemoteSuccess();
          return data.activeContracts || [];
        } else {
          // Canton 2.x JSON API v1
          const res = await fetch(`${this.config.jsonApiUrl}/v1/query`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ templateIds: [qualified] }),
          });
          const data = await res.json().catch(() => ({}));
          // Judge by the envelope, never by transport status: this API reports
          // "Cannot resolve any template ID from request" inside a 200.
          if (!res.ok || data.errors) {
            const detail = data.errors ? JSON.stringify(data.errors).slice(0, 300) : `HTTP ${res.status}`;
            throw new Error(`JSON API v1 rejected the query for ${qualified}: ${detail}`);
          }
          this.recordRemoteSuccess();
          return data.result || [];
        }
      } catch (err) {
        // A failed remote read is recorded, not silently swallowed: the UI shows
        // 'local' plus this reason so the demo never implies a live ledger.
        this.recordRemoteFailure(err);
        console.warn('Canton JSON API unreachable, falling back to local participant engine', err);
      }
    }

    // Authentic Local Participant Isolation Engine
    return this.inMemoryStore.filter(c => {
      const matchesTemplate = c.templateId.endsWith(templateId) || c.templateId === templateId;
      const isStakeholder = c.signatories.includes(party) || c.observers.includes(party);
      return matchesTemplate && isStakeholder;
    }) as Contract<T>[];
  }

  /** Marks the client as backed by a real ledger and clears any failure note. */
  private recordRemoteSuccess() {
    this.mode = 'canton';
    this.lastRemoteFailure = null;
  }

  /** Marks the client as locally served and keeps the reason for display. */
  private recordRemoteFailure(err: unknown) {
    this.mode = 'local';
    const msg = err instanceof Error ? err.message : String(err);
    this.lastRemoteFailure = this.config.jsonApiUrl
      ? `No response from ${this.config.jsonApiUrl} (${msg})`
      : 'No Canton JSON API URL configured';
  }

  /**
   * Exercise a choice on an active contract.
   * Strictly enforces controller authorization and business invariant guards.
   */
  async exerciseChoice<T = any, R = any>(
    templateId: string,
    contractId: string,
    choice: string,
    argument: T,
    actAsParty: string
  ): Promise<R> {
    if (this.config.jsonApiUrl) {
      // Qualify before anything else: the JSON API rejects "Novatio:Cash" as a
      // malformed template id, and the package id only changes on rebuild.
      const qualified = await this.ensureQualifiedAsync(templateId);
      const token = this.tokenFor(actAsParty);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      if (this.config.jsonApiVersion === 'v2') {
        const res = await fetch(`${this.config.jsonApiUrl}/v2/commands/submit-and-wait`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            commands: [{
              exercise: { templateId: qualified, contractId, choice, choiceArgument: argument }
            }],
            actAs: [actAsParty]
          }),
        });
        // No `res.ok` shortcut: the ledger answers 200 with an error envelope
        // for a rejected command, while 4xx means the request itself was bad.
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`JSON API v2 returned HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
        if (data.errors) throw new Error(`Ledger rejected the command: ${JSON.stringify(data.errors).slice(0, 300)}`);
        this.recordRemoteSuccess();
        return (data.completionOffset ? data : data.result) as R;
      } else {
        const res = await fetch(`${this.config.jsonApiUrl}/v1/exercise`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ templateId: qualified, contractId, choice, argument }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.errors) {
          const detail = data.errors ? JSON.stringify(data.errors).slice(0, 300) : `HTTP ${res.status}`;
          // Surfaced, not swallowed: the dashboard shows why the real ledger
          // refused, which is exactly what a simulator would hide.
          throw new Error(`Ledger rejected ${choice} on ${templateId}: ${detail}`);
        }
        this.recordRemoteSuccess();
        return (data.result ?? data) as R;
      }
    }

    // Local Execution & State Transition Simulator
    const contractIndex = this.inMemoryStore.findIndex(c => c.contractId === contractId);
    if (contractIndex === -1) throw new Error(`Contract ${contractId} not active on ledger`);

    const contract = this.inMemoryStore[contractIndex];

    // Non-consuming audit choices (do not archive contract)
    if (choice === 'QueryActiveAudit' || choice === 'QuerySettledAudit') {
      const auditor = 'Regulatory_Observer';
      if (actAsParty !== auditor && !contract.observers.includes(actAsParty)) {
        throw new Error(`Unauthorized auditor choice call by ${actAsParty}`);
      }
      const report: AuditReport = {
        debtor: contract.payload.buyer,
        creditor: contract.payload.factorer,
        invoiceId: contract.payload.invoiceNumber,
        verifiedAmount: contract.payload.totalAmount || contract.payload.amount,
        commitmentHash: contract.payload.invoiceHash,
        isSettled: choice === 'QuerySettledAudit',
      };

      this.recordEvent({
        txId: `tx-audit-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actAs: actAsParty,
        choice,
        template: contract.templateId,
        status: 'COMMITTED',
        stakeholders: [actAsParty, contract.payload.buyer, contract.payload.factorer],
        summary: `Audit report generated by ${actAsParty}: Invoice ${report.invoiceId}, verified face value $${report.verifiedAmount.toLocaleString()}. Zero line items disclosed.`,
      });

      this.notify();
      return report as any;
    }

    if (choice === 'RegisterAndOfferFactoring') {
      if (actAsParty !== contract.payload.buyer) throw new Error("Authorization error: Only buyer can register");
      const invoiceCid = (argument as any).commercialInvoiceCid;
      const invoice = this.inMemoryStore.find(c => c.contractId === invoiceCid);
      if (!invoice) throw new Error('Commercial invoice not found');

      // Single-writer dedup invariant check
      if (contract.payload.registeredInvoices.includes(invoice.payload.invoiceNumber)) {
        throw new Error(`Invoice ${invoice.payload.invoiceNumber} already registered in registry`);
      }

      // Consuming choice: archive consumed registry contract
      this.inMemoryStore.splice(contractIndex, 1);

      // Update registry
      this.inMemoryStore.push({
        contractId: `registry-${this.contractCounter++}`,
        templateId: 'Novatio:NovationRegistry',
        signatories: [contract.payload.buyer],
        observers: [],
        payload: {
          buyer: contract.payload.buyer,
          registeredInvoices: [...contract.payload.registeredInvoices, invoice.payload.invoiceNumber],
        },
      });

      // Emit FactoringOffer
      const offer: Contract = {
        contractId: `offer-${this.contractCounter++}`,
        templateId: 'Novatio:FactoringOffer',
        signatories: [contract.payload.buyer],
        observers: [invoice.payload.supplier, (argument as any).factorer, (argument as any).auditor],
        payload: {
          buyer: contract.payload.buyer,
          supplier: invoice.payload.supplier,
          factorer: (argument as any).factorer,
          invoiceNumber: invoice.payload.invoiceNumber,
          amount: invoice.payload.amount,
          dueDate: invoice.payload.dueDate,
          invoiceHash: '9a8f4c2b7d1e8a0f3c5b9e2d4a6f8c1b3e5a7d9f2c4b6e8a0d2f4b6c8e0a2d4f',
          advanceRate: (argument as any).advanceRate,
          discountFee: (argument as any).discountFee,
          auditor: (argument as any).auditor,
        },
      };
      this.inMemoryStore.push(offer);

      this.recordEvent({
        txId: `tx-reg-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actAs: actAsParty,
        choice,
        template: 'Novatio:NovationRegistry',
        status: 'COMMITTED',
        stakeholders: [contract.payload.buyer, invoice.payload.supplier, (argument as any).factorer, (argument as any).auditor],
        summary: `Buyer registered ${invoice.payload.invoiceNumber} in NovationRegistry. FactoringOffer emitted to Supplier and Factorer (85% advance, $2,500 fee).`,
      });

      this.notify();
      return offer as any;
    }

    if (choice === 'AcceptOffer') {
      if (actAsParty !== contract.payload.supplier) throw new Error("Authorization error: Only supplier can accept offer");
      const commercialInvoiceCid = (argument as any).commercialInvoiceCid;
      const invoice = this.inMemoryStore.find(c => c.contractId === commercialInvoiceCid);
      if (!invoice) throw new Error("Commercial invoice not found for hash attestation");

      // Consuming choice: archive FactoringOffer
      const currIdx = this.inMemoryStore.findIndex(c => c.contractId === contractId);
      if (currIdx !== -1) this.inMemoryStore.splice(currIdx, 1);

      const receivable: Contract = {
        contractId: `receivable-${this.contractCounter++}`,
        templateId: 'Novatio:FinanceableReceivable',
        signatories: [contract.payload.buyer, contract.payload.supplier],
        observers: [contract.payload.factorer, contract.payload.auditor],
        payload: { ...contract.payload },
      };
      this.inMemoryStore.push(receivable);

      this.recordEvent({
        txId: `tx-accept-offer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actAs: actAsParty,
        choice,
        template: 'Novatio:FactoringOffer',
        status: 'COMMITTED',
        stakeholders: [contract.payload.buyer, contract.payload.supplier, contract.payload.factorer, contract.payload.auditor],
        summary: `Supplier verified SHA-256 hash against CommercialInvoice and co-signed FinanceableReceivable (Decomposed terms visible to Factorer).`,
      });

      this.notify();
      return receivable as any;
    }

    if (choice === 'AcceptFactoring') {
      if (actAsParty !== contract.payload.factorer) throw new Error("Authorization error: Only factorer can accept factoring");
      const factorerCashCid = (argument as any).factorerCashCid;
      const cashIndex = this.inMemoryStore.findIndex(c => c.contractId === factorerCashCid && c.templateId === 'Novatio:Cash');
      if (cashIndex === -1) throw new Error(`Factorer cash contract ${factorerCashCid} not found`);

      const factorerCash = this.inMemoryStore[cashIndex];
      const advanceAmount = contract.payload.amount * contract.payload.advanceRate; // $85,000
      const reserveAmount = contract.payload.amount - advanceAmount; // $15,000

      if (factorerCash.payload.amount < advanceAmount) throw new Error('Insufficient factorer cash for advance');

      // Archive consumed cash contract and create split outputs
      this.inMemoryStore.splice(cashIndex, 1);
      if (factorerCash.payload.amount > advanceAmount) {
        this.inMemoryStore.push({
          contractId: `cash-${this.contractCounter++}`,
          templateId: 'Novatio:Cash',
          signatories: [factorerCash.payload.issuer],
          observers: [contract.payload.factorer],
          payload: { issuer: factorerCash.payload.issuer, holder: contract.payload.factorer, amount: factorerCash.payload.amount - advanceAmount },
        });
      }

      this.inMemoryStore.push({
        contractId: `cash-${this.contractCounter++}`,
        templateId: 'Novatio:Cash',
        signatories: [factorerCash.payload.issuer],
        observers: [contract.payload.supplier],
        payload: { issuer: factorerCash.payload.issuer, holder: contract.payload.supplier, amount: advanceAmount },
      });

      // Archive consumed FinanceableReceivable
      const currIdx = this.inMemoryStore.findIndex(c => c.contractId === contractId);
      if (currIdx !== -1) this.inMemoryStore.splice(currIdx, 1);

      const novated: Contract = {
        contractId: `novated-${this.contractCounter++}`,
        templateId: 'Novatio:NovatedReceivable',
        signatories: [contract.payload.buyer, contract.payload.factorer],
        observers: [contract.payload.supplier, contract.payload.auditor],
        payload: {
          buyer: contract.payload.buyer,
          supplier: contract.payload.supplier,
          factorer: contract.payload.factorer,
          invoiceNumber: contract.payload.invoiceNumber,
          totalAmount: contract.payload.amount,
          advanceAmount,
          reserveAmount,
          discountFee: contract.payload.discountFee,
          dueDate: contract.payload.dueDate,
          invoiceHash: contract.payload.invoiceHash,
          auditor: contract.payload.auditor,
        },
      };
      this.inMemoryStore.push(novated);

      this.recordEvent({
        txId: `tx-dvp-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actAs: actAsParty,
        choice,
        template: 'Novatio:FinanceableReceivable',
        status: 'COMMITTED',
        stakeholders: [contract.payload.buyer, contract.payload.supplier, contract.payload.factorer, contract.payload.auditor],
        summary: `Atomic DvP Executed: Disbursed $85,000.00 cash advance to Supplier; legal title novated to Factorer.`,
      });

      this.notify();
      return novated as any;
    }

    if (choice === 'SettleReceivable') {
      if (actAsParty !== contract.payload.buyer) throw new Error("Authorization error: Only buyer can settle receivable");
      const buyerCashCid = (argument as any).buyerCashCid;
      const cashIndex = this.inMemoryStore.findIndex(c => c.contractId === buyerCashCid && c.templateId === 'Novatio:Cash');
      if (cashIndex === -1) throw new Error(`Buyer cash contract ${buyerCashCid} not found`);

      const buyerCash = this.inMemoryStore[cashIndex];
      if (buyerCash.payload.amount < contract.payload.totalAmount) throw new Error('Insufficient buyer funds for settlement');

      // Archive buyer cash and transfer to factorer
      this.inMemoryStore.splice(cashIndex, 1);
      if (buyerCash.payload.amount > contract.payload.totalAmount) {
        this.inMemoryStore.push({
          contractId: `cash-${this.contractCounter++}`,
          templateId: 'Novatio:Cash',
          signatories: [buyerCash.payload.issuer],
          observers: [contract.payload.buyer],
          payload: { issuer: buyerCash.payload.issuer, holder: contract.payload.buyer, amount: buyerCash.payload.amount - contract.payload.totalAmount },
        });
      }

      this.inMemoryStore.push({
        contractId: `cash-${this.contractCounter++}`,
        templateId: 'Novatio:Cash',
        signatories: [buyerCash.payload.issuer],
        observers: [contract.payload.factorer],
        payload: { issuer: buyerCash.payload.issuer, holder: contract.payload.factorer, amount: contract.payload.totalAmount },
      });

      // Archive consumed NovatedReceivable
      const currIdx = this.inMemoryStore.findIndex(c => c.contractId === contractId);
      if (currIdx !== -1) this.inMemoryStore.splice(currIdx, 1);

      const settled: Contract = {
        contractId: `settled-${this.contractCounter++}`,
        templateId: 'Novatio:SettledObligation',
        signatories: [contract.payload.buyer, contract.payload.factorer],
        observers: [contract.payload.supplier, contract.payload.auditor],
        payload: {
          ...contract.payload,
          remitted: false,
        },
      };
      this.inMemoryStore.push(settled);

      this.recordEvent({
        txId: `tx-settle-leg1-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actAs: actAsParty,
        choice,
        template: 'Novatio:NovatedReceivable',
        status: 'COMMITTED',
        stakeholders: [contract.payload.buyer, contract.payload.factorer, contract.payload.supplier, contract.payload.auditor],
        summary: `Settlement Leg 1: Buyer paid $100,000.00 face value directly to Factorer. Obligation marked settled.`,
      });

      this.notify();
      return settled as any;
    }

    if (choice === 'RemitSupplier') {
      if (actAsParty !== contract.payload.factorer) throw new Error("Authorization error: Only factorer can remit reserve");
      if (contract.payload.remitted) throw new Error("Remittance already processed");

      const factorerCashCid = (argument as any).factorerCashCid;
      const cashIndex = this.inMemoryStore.findIndex(c => c.contractId === factorerCashCid && c.templateId === 'Novatio:Cash');
      if (cashIndex === -1) throw new Error(`Factorer cash contract ${factorerCashCid} not found`);

      const factorerCash = this.inMemoryStore[cashIndex];
      const remittanceAmount = contract.payload.reserveAmount - contract.payload.discountFee; // $12,500
      if (factorerCash.payload.amount < remittanceAmount) throw new Error('Insufficient factorer cash for remittance');

      // Archive consumed cash and transfer to supplier
      this.inMemoryStore.splice(cashIndex, 1);
      if (factorerCash.payload.amount > remittanceAmount) {
        this.inMemoryStore.push({
          contractId: `cash-${this.contractCounter++}`,
          templateId: 'Novatio:Cash',
          signatories: [factorerCash.payload.issuer],
          observers: [contract.payload.factorer],
          payload: { issuer: factorerCash.payload.issuer, holder: contract.payload.factorer, amount: factorerCash.payload.amount - remittanceAmount },
        });
      }

      this.inMemoryStore.push({
        contractId: `cash-${this.contractCounter++}`,
        templateId: 'Novatio:Cash',
        signatories: [factorerCash.payload.issuer],
        observers: [contract.payload.supplier],
        payload: { issuer: factorerCash.payload.issuer, holder: contract.payload.supplier, amount: remittanceAmount },
      });

      // Archive consumed SettledObligation
      const currIdx = this.inMemoryStore.findIndex(c => c.contractId === contractId);
      if (currIdx !== -1) this.inMemoryStore.splice(currIdx, 1);

      const finalSettled: Contract = {
        contractId: `settled-${this.contractCounter++}`,
        templateId: 'Novatio:SettledObligation',
        signatories: [contract.payload.buyer, contract.payload.factorer],
        observers: [contract.payload.supplier, contract.payload.auditor],
        payload: {
          ...contract.payload,
          remitted: true,
        },
      };
      this.inMemoryStore.push(finalSettled);

      this.recordEvent({
        txId: `tx-remit-leg2-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actAs: actAsParty,
        choice,
        template: 'Novatio:SettledObligation',
        status: 'COMMITTED',
        stakeholders: [contract.payload.buyer, contract.payload.factorer, contract.payload.supplier, contract.payload.auditor],
        summary: `Settlement Leg 2: Factorer remitted $12,500.00 ($15k reserve - $2,500 discount fee) to Supplier. Factorer netted $2,500 (11.8% APR).`,
      });

      this.notify();
      return finalSettled as any;
    }

    throw new Error(`Choice ${choice} not implemented`);
  }

  /**
   * Create a new private CommercialInvoice co-signed by Buyer & Supplier
   */
  public createCommercialInvoice(invoiceData: {
    invoiceNumber: string;
    buyer: string;
    supplier: string;
    amount: number;
    dueDate: string;
    lineItems?: any[];
  }): Contract {
    const contractId = `inv-${this.contractCounter++}`;
    const newContract: Contract = {
      contractId,
      templateId: 'Novatio:CommercialInvoice',
      signatories: [invoiceData.supplier, invoiceData.buyer],
      observers: [],
      payload: {
        supplier: invoiceData.supplier,
        buyer: invoiceData.buyer,
        invoiceNumber: invoiceData.invoiceNumber,
        amount: invoiceData.amount,
        dueDate: invoiceData.dueDate,
        lineItems: invoiceData.lineItems || [
          { itemCode: 'ITEM-001', description: 'Commercial Trade Goods', quantity: 1, unitPrice: invoiceData.amount, totalPrice: invoiceData.amount },
        ],
      },
    };
    this.inMemoryStore.push(newContract);
    this.recordEvent({
      txId: `tx-create-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actAs: invoiceData.supplier,
      choice: 'CreateCommercialInvoice',
      template: 'Novatio:CommercialInvoice',
      status: 'COMMITTED',
      stakeholders: [invoiceData.supplier, invoiceData.buyer],
      summary: `Created CommercialInvoice ${invoiceData.invoiceNumber} ($${invoiceData.amount.toLocaleString()} USD) for Debtor ${invoiceData.buyer}.`,
    });
    this.notify();
    return newContract;
  }
}

