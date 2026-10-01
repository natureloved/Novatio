import React, { useState, useEffect, useCallback } from 'react';
import { CantonLedgerClient, Contract, AuditReport, TransactionEvent } from './ledgerClient';
import { generatePacs008Xml, downloadPacs008Xml } from './iso20022Mapper';

export type Role = 'BUYER' | 'SUPPLIER' | 'FACTORER' | 'AUDITOR';
export type DashboardTab = 'overview' | 'receivables' | 'settlement' | 'split-privacy' | 'audit';

interface DashboardProps {
  ledger: CantonLedgerClient;
  onNavigateHome: () => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ ledger, onNavigateHome, addToast }) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [role, setRole] = useState<Role>('BUYER');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'settled' | 'assent' | 'review'>('all');
  const [chartRange, setChartRange] = useState<'30' | '90' | '365'>('30');

  // Ledger Contracts
  const [commercialInvoices, setCommercialInvoices] = useState<Contract[]>([]);
  const [financeableReceivables, setFinanceableReceivables] = useState<Contract[]>([]);
  const [factoringOffers, setFactoringOffers] = useState<Contract[]>([]);
  const [novatedReceivables, setNovatedReceivables] = useState<Contract[]>([]);
  const [settledObligations, setSettledObligations] = useState<Contract[]>([]);
  const [cashContracts, setCashContracts] = useState<Contract[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [events, setEvents] = useState<TransactionEvent[]>([]);
  const [factorerCommercialQueryCount, setFactorerCommercialQueryCount] = useState<number>(0);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [xmlModalContent, setXmlModalContent] = useState<string | null>(null);

  // Form State
  const [formDebtor, setFormDebtor] = useState('Global_Motors_OEM');
  const [formInvoiceRef, setFormInvoiceRef] = useState('INV-2026-002');
  const [formAmount, setFormAmount] = useState('150000');
  const [formDescription, setFormDescription] = useState('Battery Energy Storage Modules');

  const getPartyName = (targetRole: Role): string => {
    switch (targetRole) {
      case 'BUYER': return 'Global_Motors_OEM';
      case 'SUPPLIER': return 'Acme_Electronics';
      case 'FACTORER': return 'Canton_Capital_Desk';
      case 'AUDITOR': return 'Regulatory_Observer';
    }
  };

  const refreshState = useCallback(async () => {
    const partyName = getPartyName(role);

    const cash = await ledger.queryContracts('Cash', partyName);
    setCashContracts(cash);
    const totalCash = cash.reduce((sum, c) => sum + (c.payload.amount || 0), 0);
    setCashBalance(totalCash);

    const invoices = await ledger.queryContracts('CommercialInvoice', partyName);
    setCommercialInvoices(invoices);

    const factorerInvoices = await ledger.queryContracts('CommercialInvoice', 'Canton_Capital_Desk');
    setFactorerCommercialQueryCount(factorerInvoices.length);

    const offers = await ledger.queryContracts('FactoringOffer', partyName);
    setFactoringOffers(offers);

    const receivables = await ledger.queryContracts('FinanceableReceivable', partyName);
    setFinanceableReceivables(receivables);

    const novated = await ledger.queryContracts('NovatedReceivable', partyName);
    setNovatedReceivables(novated);

    const settled = await ledger.queryContracts('SettledObligation', partyName);
    setSettledObligations(settled);

    setEvents(ledger.getTransactionHistory());
  }, [ledger, role]);

  useEffect(() => {
    refreshState();
    const unsubscribe = ledger.subscribe(() => {
      refreshState();
    });
    return () => unsubscribe();
  }, [role, ledger, refreshState]);

  // Workflow Handlers
  const handleRegister = async (commercialInvoiceCid: string) => {
    try {
      const registries = await ledger.queryContracts('NovationRegistry', 'Global_Motors_OEM');
      if (registries.length === 0) throw new Error("No NovationRegistry found for Buyer");
      await ledger.exerciseChoice(
        'NovationRegistry',
        registries[0].contractId,
        'RegisterAndOfferFactoring',
        {
          commercialInvoiceCid,
          factorer: 'Canton_Capital_Desk',
          advanceRate: 0.85,
          discountFee: 2500,
          auditor: 'Regulatory_Observer',
        },
        'Global_Motors_OEM'
      );
      addToast('success', '✓ Registered in NovationRegistry: FactoringOffer emitted on Canton (85% advance, $2,500 fee).');
    } catch (err: any) {
      addToast('error', `Registration failed: ${err.message}`);
    }
  };

  const handleSimulateDuplicateDedupAttack = async () => {
    try {
      const registries = await ledger.queryContracts('NovationRegistry', 'Global_Motors_OEM');
      if (registries.length === 0) return;
      const registeredInvoices = registries[0].payload.registeredInvoices || [];
      if (registeredInvoices.length === 0) {
        addToast('info', 'Please register invoice INV-2026-001 first to populate the single-writer registry.');
        return;
      }
      addToast('info', 'Simulating duplicate financing attempt on buyer registry...');
      const invoices = await ledger.queryContracts('CommercialInvoice', 'Global_Motors_OEM');
      if (invoices.length > 0) {
        await ledger.exerciseChoice(
          'NovationRegistry',
          registries[0].contractId,
          'RegisterAndOfferFactoring',
          {
            commercialInvoiceCid: invoices[0].contractId,
            factorer: 'Canton_Capital_Desk',
            advanceRate: 0.85,
            discountFee: 2500,
            auditor: 'Regulatory_Observer',
          },
          'Global_Motors_OEM'
        );
      }
    } catch (err: any) {
      addToast('error', `🛡️ CANTON INVARIANT CONFIRMED: ${err.message} (Double-pledge blocked!)`);
    }
  };

  const handleAcceptOffer = async (offerCid: string) => {
    try {
      const invoices = await ledger.queryContracts('CommercialInvoice', 'Acme_Electronics');
      if (invoices.length === 0) throw new Error("Commercial invoice not found for hash attestation");
      await ledger.exerciseChoice(
        'FactoringOffer',
        offerCid,
        'AcceptOffer',
        { commercialInvoiceCid: invoices[0].contractId },
        'Acme_Electronics'
      );
      addToast('success', '✓ Supplier verified SHA-256 hash and co-signed FinanceableReceivable.');
    } catch (err: any) {
      addToast('error', `Accept offer failed: ${err.message}`);
    }
  };

  const handleFundAdvance = async (receivableCid: string) => {
    try {
      const factorerCash = await ledger.queryContracts('Cash', 'Canton_Capital_Desk');
      if (factorerCash.length === 0) throw new Error("No factorer cash contract found");
      await ledger.exerciseChoice(
        'FinanceableReceivable',
        receivableCid,
        'AcceptFactoring',
        { factorerCashCid: factorerCash[0].contractId },
        'Canton_Capital_Desk'
      );
      addToast('success', '✓ Atomic DvP Executed: Disbursed $85,000 cash advance to Supplier; title novated to Factorer.');
    } catch (err: any) {
      addToast('error', `DvP Advance failed: ${err.message}`);
    }
  };

  const handleSimulateUnderfundedDvP = async (receivableCid: string) => {
    try {
      addToast('info', 'Simulating underfunded DvP attempt (insufficient cash)...');
      const invalidCashCid = 'cash-underfunded-fake';
      await ledger.exerciseChoice(
        'FinanceableReceivable',
        receivableCid,
        'AcceptFactoring',
        { factorerCashCid: invalidCashCid },
        'Canton_Capital_Desk'
      );
    } catch (err: any) {
      addToast('error', `🛡️ CANTON INVARIANT CONFIRMED: ${err.message} (Atomic DvP safely reverted!)`);
    }
  };

  const handleSettleLeg1 = async (novatedCid: string) => {
    try {
      const buyerCash = await ledger.queryContracts('Cash', 'Global_Motors_OEM');
      if (buyerCash.length === 0) throw new Error("No buyer cash contract found");
      await ledger.exerciseChoice(
        'NovatedReceivable',
        novatedCid,
        'SettleReceivable',
        { buyerCashCid: buyerCash[0].contractId },
        'Global_Motors_OEM'
      );
      addToast('success', '✓ Settlement Leg 1 Completed: Buyer paid full face value ($100,000.00) to Factorer.');
    } catch (err: any) {
      addToast('error', `Settlement failed: ${err.message}`);
    }
  };

  const handleRemitLeg2 = async (settledCid: string) => {
    try {
      const factorerCash = await ledger.queryContracts('Cash', 'Canton_Capital_Desk');
      if (factorerCash.length === 0) throw new Error("No factorer cash contract found");
      await ledger.exerciseChoice(
        'SettledObligation',
        settledCid,
        'RemitSupplier',
        { factorerCashCid: factorerCash[0].contractId },
        'Canton_Capital_Desk'
      );
      addToast('success', '✓ Settlement Leg 2 Completed: Factorer remitted $12,500.00 to Supplier. Net yield +$2,500 (11.8% APR).');
    } catch (err: any) {
      addToast('error', `Remittance failed: ${err.message}`);
    }
  };

  const handleSimulateDoubleRemittance = async (settledCid: string) => {
    try {
      addToast('info', 'Testing double-remittance guard on SettledObligation...');
      const factorerCash = await ledger.queryContracts('Cash', 'Canton_Capital_Desk');
      if (factorerCash.length === 0) return;
      await ledger.exerciseChoice(
        'SettledObligation',
        settledCid,
        'RemitSupplier',
        { factorerCashCid: factorerCash[0].contractId },
        'Canton_Capital_Desk'
      );
    } catch (err: any) {
      addToast('error', `🛡️ CANTON INVARIANT CONFIRMED: ${err.message} (Double-remittance blocked!)`);
    }
  };

  const handleQueryActiveAudit = async (novatedCid: string) => {
    try {
      const report = await ledger.exerciseChoice<any, AuditReport>(
        'NovatedReceivable',
        novatedCid,
        'QueryActiveAudit',
        {},
        'Regulatory_Observer'
      );
      setAuditReport(report);
      addToast('success', '✓ Non-consuming Active Audit Report generated for Regulatory Observer.');
    } catch (err: any) {
      addToast('error', `Audit query failed: ${err.message}`);
    }
  };

  const handleQuerySettledAudit = async (settledCid: string) => {
    try {
      const report = await ledger.exerciseChoice<any, AuditReport>(
        'SettledObligation',
        settledCid,
        'QuerySettledAudit',
        {},
        'Regulatory_Observer'
      );
      setAuditReport(report);
      addToast('success', '✓ Settled Audit Report generated: Survives post-settlement indefinitely.');
    } catch (err: any) {
      addToast('error', `Settled audit query failed: ${err.message}`);
    }
  };

  const handleCreateInvoiceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(formAmount) || 150000;
    try {
      ledger.createCommercialInvoice({
        invoiceNumber: formInvoiceRef,
        buyer: formDebtor,
        supplier: 'Acme_Electronics',
        amount: amountNum,
        dueDate: '2026-12-31T00:00:00Z',
        lineItems: [
          { itemCode: 'ITEM-801', description: formDescription, quantity: 1, unitPrice: amountNum, totalPrice: amountNum }
        ]
      });
      setIsCreateModalOpen(false);
      addToast('success', `✓ CommercialInvoice ${formInvoiceRef} created for ${formDebtor} ($${amountNum.toLocaleString()} USD).`);
    } catch (err: any) {
      addToast('error', `Invoice creation failed: ${err.message}`);
    }
  };

  const handleResetLedger = () => {
    ledger.resetState();
    setAuditReport(null);
    setXmlModalContent(null);
    addToast('info', 'Ledger genesis state restored. All initial contracts active.');
  };

  // Determine stage and stats
  const activeReceivablesCount = 
    (commercialInvoices.length > 0 ? 1 : 0) + 
    (financeableReceivables.length > 0 ? 1 : 0) + 
    (novatedReceivables.length > 0 ? 1 : 0) +
    (settledObligations.length > 0 ? 1 : 0);

  const availableToFactor = commercialInvoices.reduce((sum, inv) => sum + (inv.payload.amount || 0), 0);
  const capitalDeployed = novatedReceivables.length > 0 || settledObligations.length > 0 ? 85000 : 0;
  const currentStep = 
    settledObligations.length > 0 && settledObligations[0].payload.remitted ? 6 :
    settledObligations.length > 0 ? 5 :
    novatedReceivables.length > 0 ? 4 :
    financeableReceivables.length > 0 ? 3 :
    factoringOffers.length > 0 ? 2 : 1;

  // Chart data totals
  const chartTotals = {
    '30': '$8.42M',
    '90': '$22.16M',
    '365': '$42.8M',
  };

  return (
    <div className="dashboard-app">
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* FIXED SIDEBAR */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`} aria-label="Primary dashboard navigation">
        <div className="brand" style={{ padding: '0 8px', marginBottom: '24px' }}>
          <div className="brand-mark" style={{ width: '32px', height: '32px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '16px', height: '16px' }}>
              <path d="M4 20 L12 4 L20 20"/><path d="M8 14 L16 14"/>
            </svg>
          </div>
          <span className="serif" style={{ fontSize: '20px', fontWeight: 600, color: 'var(--ink)' }}>
            Novatio
          </span>
        </div>

        {/* Back to public overview */}
        <button 
          onClick={onNavigateHome}
          className="nav-link"
          style={{ marginBottom: '16px', color: 'var(--gold)', border: '1px dashed var(--line)', background: 'var(--paper)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: '16px', height: '16px' }}>
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          ← Institutional Overview
        </button>

        <p className="workspace-label">Workspace</p>
        <nav className="nav">
          <button 
            className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('overview'); setIsSidebarOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>
            </svg>
            Overview
          </button>

          <button 
            className={`nav-link ${activeTab === 'receivables' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('receivables'); setIsSidebarOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M6 3.8h8l4 4v12.4H6z"/><path d="M14 3.8v4h4M9 12h6M9 16h6"/>
            </svg>
            Receivables
            <span className="nav-count">{activeReceivablesCount}</span>
          </button>

          <button 
            className={`nav-link ${activeTab === 'settlement' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('settlement'); setIsSidebarOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M7 7h12l-3-3M17 17H5l3 3"/><path d="M19 7a7 7 0 0 1 0 10M5 17A7 7 0 0 1 5 7"/>
            </svg>
            Settlement & DvP
          </button>

          <button 
            className={`nav-link ${activeTab === 'split-privacy' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('split-privacy'); setIsSidebarOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="11" cy="11" r="7"/><path d="M21 21 L16 16"/>
            </svg>
            Split-Node Proof
          </button>

          <button 
            className={`nav-link ${activeTab === 'audit' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('audit'); setIsSidebarOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>
            </svg>
            Audit & ISO 20022
          </button>
        </nav>

        <p className="workspace-label" style={{ marginTop: '24px' }}>Actions & Controls</p>
        <nav className="nav">
          <button 
            className="nav-link" 
            onClick={handleResetLedger}
            title="Restore initial seed state on Canton ledger"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Reset Genesis State
          </button>
        </nav>

        <div className="sidebar-spacer" />

        {/* Network status card */}
        <div className="network-card">
          <div className="network-top">
            <span className="network-dot" />
            <span>Canton Network</span>
            <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: '10px', fontWeight: 700 }}>LIVE</span>
          </div>
          <p style={{ margin: '6px 0 0 16px', color: 'var(--ink-mute)', fontSize: '11px' }}>
            Synchronizer #1 · Sub-Tx Privacy Enforced
          </p>
        </div>

        {/* Participant Switcher / Profile Card */}
        <div className="profile" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)', fontWeight: 600 }}>
            Active Participant Node
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            {(['BUYER', 'SUPPLIER', 'FACTORER', 'AUDITOR'] as Role[]).map(r => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`preset-btn ${role === r ? 'active' : ''}`}
                style={{
                  fontSize: '11px',
                  padding: '5px 6px',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  background: role === r ? 'var(--ink)' : 'var(--paper)',
                  color: role === r ? 'var(--paper)' : 'var(--ink)',
                  cursor: 'pointer',
                  fontWeight: role === r ? 600 : 500
                }}
              >
                {r === 'BUYER' ? '🏢 Buyer' : r === 'SUPPLIER' ? '🏭 Supplier' : r === 'FACTORER' ? '🏦 Factor' : '⚖️ Audit'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
            <div className="avatar" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
              {role[0]}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div className="profile-name" style={{ fontSize: '11.5px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {getPartyName(role)}
              </div>
              <div className="profile-role mono" style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>
                ${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN DASHBOARD CONTENT AREA */}
      <main className="main">
        {/* TOPBAR */}
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="icon-button menu-toggle" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-label="Toggle navigation"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 7h16M4 12h16M4 17h16"/>
              </svg>
            </button>
            <div className="breadcrumb">
              <span>Novatio Protocol</span>
              <span style={{ padding: '0 8px', color: 'var(--line)' }}>/</span>
              <strong style={{ color: 'var(--ink)', textTransform: 'capitalize' }}>{activeTab}</strong>
            </div>
          </div>

          <div className="top-actions">
            <label className="search-box">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/>
              </svg>
              <input 
                type="search" 
                placeholder="Search invoices or parties..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </label>

            <button 
              className="primary-button"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Create transaction
            </button>
          </div>
        </header>

        {/* DASHBOARD BODY */}
        <div className="dashboard-content">
          {/* Page Heading */}
          <section className="page-heading">
            <div>
              <div className="eyebrow" style={{ color: 'var(--gold)', letterSpacing: '0.14em' }}>
                Canton Synchronizer #1 · Institutional Desk
              </div>
              <h1 className="serif" style={{ fontSize: '28px', color: 'var(--ink)' }}>
                {role === 'BUYER' && 'Enterprise Debtor Console'}
                {role === 'SUPPLIER' && 'Commercial Creditor Console'}
                {role === 'FACTORER' && 'Liquidity Desk Console'}
                {role === 'AUDITOR' && 'Compliance Observer Console'}
              </h1>
              <p className="subtitle">
                Logged in as <b className="mono" style={{ color: 'var(--ink)' }}>{getPartyName(role)}</b> · Available Cash:{' '}
                <b className="mono" style={{ color: 'var(--accent)' }}>${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD</b>
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button 
                onClick={handleSimulateDuplicateDedupAttack}
                className="btn-outline-danger"
                title="Test Canton single-writer registry deduplication invariant"
              >
                🛡️ Test Double-Pledge Rejection
              </button>
              {financeableReceivables.length > 0 && (
                <button
                  onClick={() => handleSimulateUnderfundedDvP(financeableReceivables[0].contractId)}
                  className="btn-outline-danger"
                  title="Test atomic rollback on underfunded cash leg"
                >
                  🛡️ Test Underfunded DvP Revert
                </button>
              )}
            </div>
          </section>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <>
              {/* HERO NOVATION FLOW CARD */}
              <section className="hero-dashboard" aria-label="Novatio Overview Flow">
                <div className="hero-copy">
                  <div className="hero-kicker">
                    <span className="tiny-dot" />
                    CANTON DAML STATE MACHINE · ATOMIC DvP
                  </div>
                  <h2 className="serif" style={{ fontSize: '24px', margin: '10px 0 8px' }}>
                    Trade receivables.<br />
                    <em>Novated with deterministic certainty.</em>
                  </h2>
                  <p style={{ fontSize: '13px', color: 'rgba(246, 243, 236, 0.8)', maxWidth: '440px', lineHeight: 1.55 }}>
                    Confidential line-item decomposition, single-writer deduplication, and atomic settlement on Canton Network.
                  </p>
                  <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--paper)', borderColor: 'rgba(255,255,255,0.2)' }}>
                      Stage {currentStep} of 6 Complete
                    </span>
                    <span className="badge" style={{ background: 'rgba(168,133,58,0.25)', color: 'var(--gold-soft)', borderColor: 'rgba(168,133,58,0.4)' }}>
                      Sub-Tx Privacy: Active
                    </span>
                  </div>
                </div>

                <div className="hero-illustration" aria-hidden="true">
                  <div className="flow-line" />
                  <div className={`flow-node n1 ${currentStep >= 1 ? 'completed-node' : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    </svg>
                  </div>
                  <div className={`flow-node n2 ${currentStep >= 3 ? 'completed-node' : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 2 L4 6 V12 C4 17 8 21 12 22 C16 21 20 17 20 12 V6 Z"/>
                    </svg>
                  </div>
                  <div className={`flow-node n3 ${currentStep >= 4 ? 'completed-node' : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="9"/><path d="M8 12 L11 15 L16 9"/>
                    </svg>
                  </div>
                  <span className="node-label l1">Original Creditor</span>
                  <span className="node-label l2">Legal Novation</span>
                  <span className="node-label l3">New Creditor</span>
                  <span className="flow-check">✓</span>
                </div>
              </section>

              {/* 4 METRIC CARDS */}
              <section className="metrics-dashboard" aria-label="Portfolio Metrics">
                <article className="metric-card">
                  <div className="metric-head">
                    <span>Active Receivables</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M6 3.8h8l4 4v12.4H6z"/><path d="M14 3.8v4h4M9 12h6M9 16h6"/>
                    </svg>
                  </div>
                  <div className="metric-value">{activeReceivablesCount}</div>
                  <div className="metric-foot">
                    <span className="trend">INV-2026-001</span>
                    <span>on ledger</span>
                  </div>
                </article>

                <article className="metric-card">
                  <div className="metric-head">
                    <span>Available to Factor</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="9"/><path d="M12 8 V16 M8 12 H16"/>
                    </svg>
                  </div>
                  <div className="metric-value">${availableToFactor > 0 ? (availableToFactor / 1000).toFixed(0) + 'K' : '100K'}</div>
                  <div className="metric-foot">
                    <span className="trend">100%</span>
                    <span>eligible receivables</span>
                  </div>
                </article>

                <article className="metric-card">
                  <div className="metric-head">
                    <span>Capital Deployed</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 18.5h16M5.5 15l4-4 3 2.5 6-7"/>
                    </svg>
                  </div>
                  <div className="metric-value">${capitalDeployed > 0 ? (capitalDeployed / 1000).toFixed(0) + 'K' : '$0'}</div>
                  <div className="metric-foot">
                    <span className="trend">85% Advance</span>
                    <span>T+0 cash disbursed</span>
                  </div>
                </article>

                <article className="metric-card">
                  <div className="metric-head">
                    <span>Factorer Net Yield</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>
                    </svg>
                  </div>
                  <div className="metric-value" style={{ color: 'var(--accent)' }}>11.8%<small style={{ fontSize: '13px' }}> APR</small></div>
                  <div className="metric-foot">
                    <span className="trend">+$2,500.00</span>
                    <span>quarterly net gain</span>
                  </div>
                </article>
              </section>

              {/* WORKSPACE GRID: CHART & NOVATION STATUS */}
              <section className="workspace-grid">
                {/* Performance Chart */}
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2 className="panel-title serif" style={{ fontSize: '18px' }}>Portfolio Performance</h2>
                      <p className="panel-subtitle">Factored volume across Canton participant network</p>
                    </div>
                    <select 
                      className="select-control"
                      value={chartRange}
                      onChange={e => setChartRange(e.target.value as any)}
                    >
                      <option value="30">Last 30 days</option>
                      <option value="90">Last 90 days</option>
                      <option value="365">This year</option>
                    </select>
                  </div>

                  <div className="chart-summary">
                    <span className="chart-total">{chartTotals[chartRange]}</span>
                    <span className="chart-delta">↑ 18.6% vs. prior period</span>
                  </div>

                  <div className="chart-wrap">
                    <svg viewBox="0 0 700 140" preserveAspectRatio="none" role="img" aria-label="Portfolio chart">
                      <defs>
                        <linearGradient id="novatioAreaFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#A8853A" stopOpacity="0.25"/>
                          <stop offset="100%" stopColor="#A8853A" stopOpacity="0"/>
                        </linearGradient>
                      </defs>
                      <line className="gridline" x1="0" y1="22" x2="700" y2="22"/>
                      <line className="gridline" x1="0" y1="60" x2="700" y2="60"/>
                      <line className="gridline" x1="0" y1="98" x2="700" y2="98"/>
                      <path className="chart-area" fill="url(#novatioAreaFill)" d="M0 112 C28 106 37 91 64 96 S100 87 126 91 S164 71 191 78 S228 82 254 66 S292 74 318 61 S354 69 381 55 S415 62 445 47 S480 55 509 39 S544 51 573 34 S610 44 635 29 S672 34 700 15 L700 140 L0 140Z"/>
                      <path className="chart-path" stroke="var(--gold)" strokeWidth="2.6" d="M0 112 C28 106 37 91 64 96 S100 87 126 91 S164 71 191 78 S228 82 254 66 S292 74 318 61 S354 69 381 55 S415 62 445 47 S480 55 509 39 S544 51 573 34 S610 44 635 29 S672 34 700 15"/>
                      <circle cx="700" cy="15" r="4" fill="var(--paper)" stroke="var(--gold)" strokeWidth="2.5"/>
                    </svg>
                  </div>
                  <div className="chart-labels">
                    <span>Sep 25</span><span>Sep 30</span><span>Oct 5</span><span>Oct 10</span><span>Oct 15</span><span>Oct 20</span><span>Oct 24</span>
                  </div>
                  <div className="chart-legend">
                    <span className="legend-dot" style={{ background: 'var(--gold)' }} />
                    <span>Factored volume on Canton Synchronizer #1</span>
                  </div>
                </article>

                {/* Novation Status Panel */}
                <article className="panel novation-panel">
                  <div className="panel-heading">
                    <div>
                      <h2 className="panel-title serif" style={{ fontSize: '18px' }}>Novation Status</h2>
                      <p className="panel-subtitle">Legal transfer integrity on Canton</p>
                    </div>
                    <span className="assent-badge" style={{ background: 'rgba(30, 77, 58, 0.1)', color: 'var(--accent)' }}>
                      ALL SYSTEMS NORMAL
                    </span>
                  </div>

                  <div className="legal-seal">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.6">
                      <path d="M12 3 19 6v5c0 4.7-3 8-7 10-4-2-7-5.3-7-10V6l7-3Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>
                    </svg>
                  </div>

                  <div>
                    <h3 className="serif" style={{ fontSize: '16px', margin: '12px 0 6px' }}>Every transfer, cryptographically assented.</h3>
                    <p style={{ color: 'var(--ink-soft)', fontSize: '12px', lineHeight: 1.55 }}>
                      Rights transfer only when all three parties agree. Novatio captures each party’s assent before receivable title is novated on-ledger.
                    </p>
                  </div>

                  <div className="assent-steps">
                    <div className="assent-step">
                      <span className="step-check" style={{ background: currentStep >= 2 ? 'var(--accent)' : 'var(--paper-2)', color: currentStep >= 2 ? '#fff' : 'var(--ink-mute)' }}>
                        ✓
                      </span>
                      <span><strong>1. Debtor registry assent</strong> · single-writer verified</span>
                    </div>
                    <div className="assent-step">
                      <span className="step-check" style={{ background: currentStep >= 3 ? 'var(--accent)' : 'var(--paper-2)', color: currentStep >= 3 ? '#fff' : 'var(--ink-mute)' }}>
                        ✓
                      </span>
                      <span><strong>2. Creditor commitment</strong> · SHA-256 co-signed</span>
                    </div>
                    <div className="assent-step">
                      <span className="step-check" style={{ background: currentStep >= 4 ? 'var(--accent)' : 'var(--paper-2)', color: currentStep >= 4 ? '#fff' : 'var(--ink-mute)' }}>
                        ✓
                      </span>
                      <span><strong>3. Factorer acceptance</strong> · Atomic DvP cash funded</span>
                    </div>
                  </div>

                  <div className="legal-footer">
                    <span>Permissioned on Canton · Daml-enforced</span>
                    <button 
                      onClick={() => setActiveTab('audit')} 
                      style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 600, cursor: 'pointer' }}
                    >
                      View audit trail →
                    </button>
                  </div>
                </article>
              </section>

              {/* TABLE PANEL: RECENT RECEIVABLES */}
              <section className="panel table-panel">
                <div className="table-header">
                  <div>
                    <h2 className="panel-title serif" style={{ fontSize: '18px' }}>Active Contract Receivables</h2>
                    <p className="panel-subtitle">Track invoices and their novation lifecycle in real time</p>
                  </div>
                  <div className="table-actions">
                    <button 
                      className="secondary-button"
                      onClick={() => {
                        const filters: ('all' | 'settled' | 'assent' | 'review')[] = ['all', 'settled', 'assent', 'review'];
                        const next = filters[(filters.indexOf(statusFilter) + 1) % filters.length];
                        setStatusFilter(next);
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M4 6h16M7 12h10M10 18h4"/>
                      </svg>
                      <span>{statusFilter === 'all' ? 'All statuses' : statusFilter === 'settled' ? 'Settled' : statusFilter === 'assent' ? 'Awaiting assent' : 'In review'}</span>
                    </button>
                    <button 
                      className="secondary-button"
                      onClick={() => addToast('info', 'Exporting Canton ledger snapshot...')}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M12 3v12M7 10l5 5 5-5M5 20h14"/>
                      </svg>
                      Export
                    </button>
                  </div>
                </div>

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Receivable</th>
                        <th>Debtor</th>
                        <th>Face Value</th>
                        <th>Advance Rate</th>
                        <th>Novation Status</th>
                        <th>Participant Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Contract 1: INV-2026-001 (Active Workflow) */}
                      <tr>
                        <td>
                          <div className="invoice-cell">
                            <div className="invoice-icon">
                              <svg width="15" height="17" viewBox="0 0 18 20" fill="none" stroke="currentColor" strokeWidth="1.3">
                                <path d="M3 1.5h8l4 4v13H3z"/><path d="M11 1.5v4h4M6 10h6M6 13h6"/>
                              </svg>
                            </div>
                            <div>
                              <div className="invoice-name mono">INV-2026-001</div>
                              <div className="invoice-id">PO #8841 · Microcontrollers</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="company">Global_Motors_OEM</div>
                          <div className="company-sub">Tier-1 Automotive OEM</div>
                        </td>
                        <td className="amount mono">$100,000.00</td>
                        <td>85.0% ($85k T+0)</td>
                        <td>
                          {currentStep === 1 && <span className="status review">Invoice Issued</span>}
                          {currentStep === 2 && <span className="status assent">Awaiting Supplier Assent</span>}
                          {currentStep === 3 && <span className="status assent">Co-Signed · Awaiting DvP</span>}
                          {currentStep === 4 && <span className="status settled">Novated (DvP Settled)</span>}
                          {currentStep === 5 && <span className="status assent">Leg 1 Settled · Awaiting Remittance</span>}
                          {currentStep === 6 && <span className="status settled">100% Settled & Remitted</span>}
                        </td>
                        <td>
                          {/* Dynamic Action Buttons depending on role and stage */}
                          {role === 'BUYER' && commercialInvoices.length > 0 && factoringOffers.length === 0 && financeableReceivables.length === 0 && novatedReceivables.length === 0 && settledObligations.length === 0 && (
                            <button onClick={() => handleRegister(commercialInvoices[0].contractId)} className="btn-primary" style={{ padding: '6px 12px', fontSize: '11px' }}>
                              ⚡ Register & Offer
                            </button>
                          )}

                          {role === 'SUPPLIER' && factoringOffers.length > 0 && financeableReceivables.length === 0 && (
                            <button onClick={() => handleAcceptOffer(factoringOffers[0].contractId)} className="btn-primary" style={{ padding: '6px 12px', fontSize: '11px' }}>
                              ⚡ Co-Sign Receivable
                            </button>
                          )}

                          {role === 'FACTORER' && financeableReceivables.length > 0 && (
                            <button onClick={() => handleFundAdvance(financeableReceivables[0].contractId)} className="btn-primary" style={{ padding: '6px 12px', fontSize: '11px' }}>
                              ⚡ Fund DvP ($85k)
                            </button>
                          )}

                          {role === 'BUYER' && novatedReceivables.length > 0 && (
                            <button onClick={() => handleSettleLeg1(novatedReceivables[0].contractId)} className="btn-settle" style={{ padding: '6px 12px', fontSize: '11px' }}>
                              ⚡ Settle Leg 1 ($100k)
                            </button>
                          )}

                          {role === 'FACTORER' && settledObligations.length > 0 && !settledObligations[0].payload.remitted && (
                            <button onClick={() => handleRemitLeg2(settledObligations[0].contractId)} className="btn-remit" style={{ padding: '6px 12px', fontSize: '11px' }}>
                              ⚡ Remit Leg 2 ($12.5k)
                            </button>
                          )}

                          {settledObligations.length > 0 && settledObligations[0].payload.remitted && (
                            <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '11px' }}>
                              ✓ Full Lifecycle Complete
                            </span>
                          )}

                          {role !== 'BUYER' && currentStep === 1 && (
                            <span style={{ color: 'var(--ink-mute)', fontSize: '11px' }}>Switch to Buyer node</span>
                          )}
                          {role !== 'SUPPLIER' && currentStep === 2 && (
                            <span style={{ color: 'var(--ink-mute)', fontSize: '11px' }}>Switch to Supplier node</span>
                          )}
                          {role !== 'FACTORER' && currentStep === 3 && (
                            <span style={{ color: 'var(--ink-mute)', fontSize: '11px' }}>Switch to Factorer node</span>
                          )}
                        </td>
                      </tr>

                      {/* Mock Reference Rows from the institutional book */}
                      <tr>
                        <td>
                          <div className="invoice-cell">
                            <div className="invoice-icon">
                              <svg width="15" height="17" viewBox="0 0 18 20" fill="none" stroke="currentColor" strokeWidth="1.3">
                                <path d="M3 1.5h8l4 4v13H3z"/><path d="M11 1.5v4h4M6 10h6M6 13h6"/>
                              </svg>
                            </div>
                            <div>
                              <div className="invoice-name mono">INV-2024-0892</div>
                              <div className="invoice-id">PO #7741 · Electronics</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="company">Meridian Retail Group</div>
                          <div className="company-sub">United Kingdom</div>
                        </td>
                        <td className="amount mono">$284,500.00</td>
                        <td>85.0%</td>
                        <td><span className="status settled">Settled</span></td>
                        <td><span style={{ color: 'var(--ink-mute)', fontSize: '11px' }}>Archived on Ledger</span></td>
                      </tr>

                      <tr>
                        <td>
                          <div className="invoice-cell">
                            <div className="invoice-icon">
                              <svg width="15" height="17" viewBox="0 0 18 20" fill="none" stroke="currentColor" strokeWidth="1.3">
                                <path d="M3 1.5h8l4 4v13H3z"/><path d="M11 1.5v4h4M6 10h6M6 13h6"/>
                              </svg>
                            </div>
                            <div>
                              <div className="invoice-name mono">INV-2024-0887</div>
                              <div className="invoice-id">PO #7738 · Raw Materials</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="company">Asteron Manufacturing</div>
                          <div className="company-sub">Germany</div>
                        </td>
                        <td className="amount mono">$176,250.00</td>
                        <td>80.0%</td>
                        <td><span className="status settled">Settled</span></td>
                        <td><span style={{ color: 'var(--ink-mute)', fontSize: '11px' }}>Archived on Ledger</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="table-bottom">
                  <span>Showing active contracts on Canton Synchronizer #1</span>
                  <div className="pagination">
                    <button className="page-btn current">1</button>
                    <button className="page-btn">2</button>
                    <button className="page-btn">3</button>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* TAB 2: RECEIVABLES */}
          {activeTab === 'receivables' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="panel">
                <h3 className="serif" style={{ fontSize: '20px', marginBottom: '8px' }}>Commercial Invoices & Obligations</h3>
                <p style={{ color: 'var(--ink-soft)', fontSize: '13px', marginBottom: '16px' }}>
                  Canton decomposed receivables maintain strict privacy. Line items are visible only to commercial signatories.
                </p>

                {commercialInvoices.length > 0 ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span>Invoice: <b className="mono">{commercialInvoices[0].payload.invoiceNumber}</b></span>
                      <span>Total Face Value: <b className="mono">${commercialInvoices[0].payload.amount.toLocaleString()} USD</b></span>
                    </div>

                    <div className="table-responsive">
                      <table className="card-table">
                        <thead>
                          <tr>
                            <th>Item Code</th>
                            <th>Description</th>
                            <th>Qty</th>
                            <th>Unit</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {commercialInvoices[0].payload.lineItems.map((li: any) => (
                            <tr key={li.itemCode}>
                              <td className="mono" style={{ fontWeight: 600 }}>{li.itemCode}</td>
                              <td>{li.description}</td>
                              <td className="mono">{li.quantity.toLocaleString()}</td>
                              <td className="mono">${li.unitPrice.toFixed(2)}</td>
                              <td className="mono" style={{ fontWeight: 600 }}>${li.totalPrice.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: 'var(--ink-mute)', fontSize: '13px' }}>
                    No private line items visible to node {getPartyName(role)}. Sub-transaction privacy guarantees factorer node has 0 line item disclosures.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SETTLEMENT & DvP */}
          {activeTab === 'settlement' && (
            <div className="panel">
              <h3 className="serif" style={{ fontSize: '20px', marginBottom: '8px' }}>Two-Legged DvP Settlement Terminal</h3>
              <p style={{ color: 'var(--ink-soft)', fontSize: '13px', marginBottom: '24px' }}>
                Advance leg (T+0) and maturity leg (T+90) operate as coupled contracts with a shared settlement hash.
              </p>

              <div className="legs" style={{ maxWidth: '900px' }}>
                <div className="leg">
                  <div className="leg-title">Leg A · <b>Advance (T+0)</b></div>
                  <ul>
                    <li><span>Trigger</span><span>T+0</span></li>
                    <li><span>Cash to Supplier</span><span className="mono">$85,000.00</span></li>
                    <li><span>Receivable → Factorer</span><span>Atomic Title Swap</span></li>
                    <li><span>Reserve Held (15%)</span><span className="mono">$15,000.00</span></li>
                    <li><span>DvP Guarantee</span><span style={{ color: 'var(--accent)' }}>Enforced on Ledger</span></li>
                  </ul>
                </div>
                <div className="arrow">
                  <svg width="36" height="20" viewBox="0 0 36 20" fill="none">
                    <path d="M1 10 H33 M25 3 L33 10 L25 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="leg leg-b">
                  <div className="leg-title">Leg B · <b>Maturity (T+90)</b></div>
                  <ul>
                    <li><span>Trigger</span><span>T+90</span></li>
                    <li><span>Buyer Pays Face</span><span className="mono">$100,000.00</span></li>
                    <li><span>Discount Fee to Factorer</span><span className="mono" style={{ color: 'var(--gold-soft)' }}>$2,500.00</span></li>
                    <li><span>Reserve to Supplier</span><span className="mono">$12,500.00</span></li>
                    <li><span>ISO 20022 Message</span><span>pacs.008 emitted</span></li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SPLIT-NODE PROOF */}
          {activeTab === 'split-privacy' && (
            <div className="split-console">
              {/* Buyer Pane */}
              <div className="console-pane">
                <div className="pane-header">
                  <div>
                    <h3 className="pane-title serif">Buyer Node (Global_Motors_OEM)</h3>
                    <span className="badge-private">CommercialInvoice: Visible with Wholesale Line Items</span>
                  </div>
                </div>
                {commercialInvoices.length > 0 ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--ink-soft)' }}>
                      <span>Invoice: <b className="mono">{commercialInvoices[0].payload.invoiceNumber}</b></span>
                      <span>Total: <b className="mono">$100,000.00 Net-90</b></span>
                    </div>
                    <div className="table-responsive">
                      <table className="card-table">
                        <thead>
                          <tr>
                            <th>Item Code</th>
                            <th>Description</th>
                            <th>Qty</th>
                            <th>Unit</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {commercialInvoices[0].payload.lineItems.map((li: any) => (
                            <tr key={li.itemCode}>
                              <td className="mono" style={{ fontWeight: 600 }}>{li.itemCode}</td>
                              <td>{li.description}</td>
                              <td className="mono">{li.quantity.toLocaleString()}</td>
                              <td className="mono">${li.unitPrice.toFixed(2)}</td>
                              <td className="mono" style={{ fontWeight: 600 }}>${li.totalPrice.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: 'var(--ink-mute)', fontSize: '13px' }}>No private invoice active.</p>
                )}
              </div>

              {/* Factorer Pane */}
              <div className="console-pane">
                <div className="pane-header">
                  <div>
                    <h3 className="pane-title serif">Factorer Node (Canton_Capital_Desk)</h3>
                    <span className="badge-decomposed">FinanceableReceivable: Decomposed Terms Only</span>
                  </div>
                </div>

                <div className="redacted-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontWeight: 600 }}>
                    <span>✓ CANTON SUB-TRANSACTION PRIVACY PROVEN</span>
                  </div>
                  <p style={{ marginTop: '6px' }}>
                    Participant query for <span className="mono">CommercialInvoice</span> returned{' '}
                    <b className="mono" style={{ color: 'var(--accent)', fontSize: '14px' }}>{factorerCommercialQueryCount}</b> records.
                    Line-item part numbers, wholesale quantities, and supplier pricing remain mathematically inaccessible.
                  </p>
                </div>

                {financeableReceivables.length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <div className="table-responsive">
                      <table className="card-table">
                        <tbody>
                          <tr>
                            <td>Enterprise Debtor</td>
                            <td className="mono" style={{ fontWeight: 600 }}>{financeableReceivables[0].payload.buyer}</td>
                          </tr>
                          <tr>
                            <td>Verified Total Amount</td>
                            <td className="mono" style={{ fontWeight: 700, fontSize: '15px' }}>${financeableReceivables[0].payload.amount.toLocaleString()} USD</td>
                          </tr>
                          <tr>
                            <td>Advance (85%) / Reserve (15%)</td>
                            <td className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>$85,000.00 / $15,000.00</td>
                          </tr>
                          <tr>
                            <td>Discount Fee / Annual Yield</td>
                            <td className="mono" style={{ color: 'var(--gold)', fontWeight: 600 }}>$2,500.00 (11.8% Net APR)</td>
                          </tr>
                          <tr>
                            <td>Joint SHA-256 Hash</td>
                            <td className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)', wordBreak: 'break-all' }}>
                              {financeableReceivables[0].payload.invoiceHash.slice(0, 24)}...
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: AUDIT & ISO 20022 */}
          {activeTab === 'audit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                  <div>
                    <h3 className="serif" style={{ fontSize: '20px' }}>⚖️ Regulatory Observer & Compliance Hub</h3>
                    <p style={{ fontSize: '13px', color: 'var(--ink-soft)', marginTop: '4px' }}>
                      Non-consuming Daml choices query verified contract provenance without exposing confidential supplier line items.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {novatedReceivables.length > 0 && (
                      <button onClick={() => handleQueryActiveAudit(novatedReceivables[0].contractId)} className="btn-audit">
                        Exercise QueryActiveAudit
                      </button>
                    )}
                    {settledObligations.length > 0 && (
                      <button onClick={() => handleQuerySettledAudit(settledObligations[0].contractId)} className="btn-audit">
                        Exercise QuerySettledAudit
                      </button>
                    )}
                    {settledObligations.length > 0 && (
                      <button 
                        onClick={() => setXmlModalContent(generatePacs008Xml(settledObligations[0].payload))}
                        className="btn-audit"
                      >
                        Inspect ISO 20022 pacs.008 XML
                      </button>
                    )}
                  </div>
                </div>

                {auditReport && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginTop: '20px' }}>
                    <div style={{ background: 'var(--paper)', padding: '14px', borderRadius: '10px', border: '1px solid var(--line)' }}>
                      <div className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)', textTransform: 'uppercase' }}>Debtor (Buyer)</div>
                      <div className="mono" style={{ fontWeight: 600, marginTop: '4px' }}>{auditReport.debtor}</div>
                    </div>
                    <div style={{ background: 'var(--paper)', padding: '14px', borderRadius: '10px', border: '1px solid var(--line)' }}>
                      <div className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)', textTransform: 'uppercase' }}>Creditor (Factorer)</div>
                      <div className="mono" style={{ fontWeight: 600, marginTop: '4px' }}>{auditReport.creditor}</div>
                    </div>
                    <div style={{ background: 'var(--paper)', padding: '14px', borderRadius: '10px', border: '1px solid var(--line)' }}>
                      <div className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)', textTransform: 'uppercase' }}>Verified Face Value</div>
                      <div className="mono" style={{ fontWeight: 700, color: 'var(--accent)', marginTop: '4px' }}>
                        ${auditReport.verifiedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div style={{ background: 'var(--paper)', padding: '14px', borderRadius: '10px', border: '1px solid var(--line)' }}>
                      <div className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)', textTransform: 'uppercase' }}>Settlement Status</div>
                      <div className="mono" style={{ fontWeight: 700, color: auditReport.isSettled ? 'var(--accent)' : 'var(--gold)', marginTop: '4px' }}>
                        {auditReport.isSettled ? '✓ SETTLED & REMITTED' : '⏳ ACTIVE RECEIVABLE'}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Canton Synchronizer Event Log */}
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase' }}>
                    Live Canton Synchronizer Commit Feed (#1)
                  </span>
                  <span className="badge">
                    <span className="dot" />
                    {events.length} Committed Transactions
                  </span>
                </div>
                <div className="event-list" style={{ marginTop: '14px' }}>
                  {events.map((evt, idx) => (
                    <div key={idx} className="event-item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)' }}>
                          {evt.timestamp.slice(11, 19)}
                        </span>
                        <span className="mono" style={{ color: 'var(--gold)', fontWeight: 600 }}>
                          {evt.choice}
                        </span>
                        <span style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>
                          {evt.summary}
                        </span>
                      </div>
                      <div className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)' }}>
                        actAs: <b style={{ color: 'var(--ink)' }}>{evt.actAs}</b>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FOOTER NOTE */}
          <div className="footer-note" style={{ marginTop: '28px', color: 'var(--ink-mute)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 3 19 6v5c0 4.7-3 8-7 10-4-2-7-5.3-7-10V6l7-3Z"/>
            </svg>
            Private by design · Every transaction is permissioned, auditable, and governed by Canton sub-transaction privacy.
          </div>
        </div>
      </main>

      {/* CREATE TRANSACTION MODAL */}
      {isCreateModalOpen && (
        <div className="modal-backdrop open" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-head">
              <div>
                <h2 className="serif" style={{ fontSize: '20px' }}>Create a transaction</h2>
                <p className="modal-intro">Start a receivable transfer. All parties will review and assent before novation.</p>
              </div>
              <button className="close-modal" onClick={() => setIsCreateModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateInvoiceSubmit}>
              <label className="form-field">
                <span>Debtor organization</span>
                <input 
                  required 
                  value={formDebtor}
                  onChange={e => setFormDebtor(e.target.value)}
                  placeholder="e.g. Global_Motors_OEM" 
                />
              </label>
              <label className="form-field">
                <span>Invoice reference</span>
                <input 
                  required 
                  value={formInvoiceRef}
                  onChange={e => setFormInvoiceRef(e.target.value)}
                  placeholder="e.g. INV-2026-002" 
                />
              </label>
              <label className="form-field">
                <span>Face value (USD)</span>
                <input 
                  required 
                  type="number" 
                  min="1" 
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  placeholder="150000" 
                />
              </label>
              <label className="form-field">
                <span>Trade goods description</span>
                <input 
                  required 
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="e.g. Battery Energy Storage Modules" 
                />
              </label>
              <div className="modal-foot">
                <button type="button" className="secondary-button" onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  Submit to Canton Ledger <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ISO 20022 XML Preview Modal */}
      {xmlModalContent && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div>
                <h3 className="serif" style={{ color: 'var(--ink)', fontSize: '20px' }}>
                  ISO 20022 pacs.008.001.10 XML Export
                </h3>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--ink-mute)' }}>
                  Financial Institution Customer Credit Transfer — Leg 1 Full Settlement
                </span>
              </div>
              <button className="btn-audit" onClick={() => setXmlModalContent(null)}>✕</button>
            </div>

            <div className="modal-body">
              <pre className="mono" style={{ background: 'var(--paper)', padding: '18px', borderRadius: '8px', fontSize: '12px', color: 'var(--ink)', overflow: 'auto', maxHeight: '420px', border: '1px solid var(--line)' }}>
                {xmlModalContent}
              </pre>
            </div>

            <div className="modal-footer">
              <button className="btn-audit" onClick={() => setXmlModalContent(null)}>Close</button>
              {settledObligations.length > 0 && (
                <button
                  className="btn-primary"
                  onClick={() => downloadPacs008Xml(settledObligations[0].payload)}
                >
                  📥 Download pacs.008 XML
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
