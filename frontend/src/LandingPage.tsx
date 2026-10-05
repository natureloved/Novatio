import React, { useState } from 'react';
import { NovatioMark } from './brand/NovatioMark';

// ─── Canonical facility terms ──────────────────────────────────────────────────
// Single source of truth for the reference facility used in both the hero snapshot
// and the interactive modeller's "Baseline" preset. These are the terms evaluated
// end-to-end in daml/Tests/NovatioTest.daml ($85,000 advance, $2,500 fee, $12,500
// remittance), so if this file and the Daml suite ever disagree the tests fail
// before a user can be shown a wrong number.
const REFERENCE_FACE_VALUE = 100000;   // $100,000 invoice face
const REFERENCE_ADVANCE_RATE = 85;     // 85% advance
const REFERENCE_DISCOUNT_RATE = 2.5;   // flat 2.5% of face, not annualised
const REFERENCE_TENOR = 90;            // 90-day tenor

// Derived once, at module scope, so the hero snapshot and modeller cannot drift.
const refAdvance = REFERENCE_FACE_VALUE * (REFERENCE_ADVANCE_RATE / 100);
const refFee = REFERENCE_FACE_VALUE * (REFERENCE_DISCOUNT_RATE / 100);
const refYieldTenor = (refFee / refAdvance) * 100;                  // 2.9411...
const refYieldPA = refYieldTenor * (360 / REFERENCE_TENOR);         // 11.764...

const fmtRefPct = (n: number): string => n.toFixed(2);
const fmtRefPA = (n: number): string => n.toFixed(1);

interface LandingPageProps {
  onLaunchConsole: () => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLaunchConsole, addToast }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Facility Modeller State — defaults are the canonical reference terms above,
  // so the interactive model opens on exactly the facility the tests evaluate.
  const [modellerFaceValue, setModellerFaceValue] = useState<number>(REFERENCE_FACE_VALUE);
  const [modellerAdvanceRate, setModellerAdvanceRate] = useState<number>(REFERENCE_ADVANCE_RATE);
  const [modellerDiscountRate, setModellerDiscountRate] = useState<number>(REFERENCE_DISCOUNT_RATE);
  const [modellerTenor, setModellerTenor] = useState<number>(REFERENCE_TENOR);
  const [activePreset, setActivePreset] = useState<string>('baseline');

  // Facility Modeller Calculations
  //
  // Convention matches the Daml contract and docs/BUSINESS-BRIEF.md: the discount
  // fee is a FLAT percentage of invoice face value, deducted from the reserve at
  // maturity (2.5% of $100k = $2,500), exactly as `FinanceableReceivable.discountFee`
  // is used in Novatio.daml. Yield is derived from that fee, never hardcoded.
  const calcAdvance = modellerFaceValue * (modellerAdvanceRate / 100);
  const calcFee = modellerFaceValue * (modellerDiscountRate / 100);
  const calcReserve = modellerFaceValue - calcAdvance;
  // Remittance = reserve minus the flat fee, as `RemitSupplier` computes on-ledger.
  const calcRemittance = calcReserve - calcFee;
  // Supplier total = advance + remittance (effective cost of capital).
  const calcSupplierTotal = calcAdvance + calcRemittance;
  // Quarterly yield on deployed capital, annualised for display.
  const calcYieldTenor = calcAdvance > 0 ? (calcFee / calcAdvance) * 100 : 0;
  const calcYieldPA = calcAdvance > 0 ? calcYieldTenor * (360 / modellerTenor) : 0;

  const setPreset = (name: string, v: number, a: number, r: number, d: number) => {
    setActivePreset(name);
    setModellerFaceValue(v);
    setModellerAdvanceRate(a);
    setModellerDiscountRate(r);
    setModellerTenor(d);
  };

  const fmtUSD = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

  return (
    <div>
      {/* TOP NAVIGATION */}
      <nav className="top">
        <div className="wrap nav-in">
          <div className="brand">
            <NovatioMark size={30} />
            <span className="wordmark" style={{ fontSize: '20px', color: 'var(--ink)' }}>Novatio</span>
          </div>

          {/* Desktop Nav Links */}
          <div className="nav-links">
            <a href="#problem">Problem</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#model">Financial Model</a>
            <a href="#process">Process</a>
            <button 
              onClick={onLaunchConsole}
              style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 600, cursor: 'pointer', font: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              Protocol Dashboard ★
            </button>
          </div>

          <div className="nav-actions">
            <button onClick={onLaunchConsole} className="cta-btn nav-cta-desktop">
              Launch Protocol Console
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            </button>

            {/* Mobile Menu Hamburger Button */}
            <button
              className={`mobile-menu-btn ${isMobileMenuOpen ? 'open' : ''}`}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle navigation menu"
              aria-expanded={isMobileMenuOpen}
            >
              <span className="bar"></span>
              <span className="bar"></span>
              <span className="bar"></span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="mobile-nav-drawer">
            <div className="mobile-nav-links">
              <a href="#problem" onClick={() => setIsMobileMenuOpen(false)}>
                <span className="mobile-nav-idx">01</span> Problem & Friction
              </a>
              <a href="#capabilities" onClick={() => setIsMobileMenuOpen(false)}>
                <span className="mobile-nav-idx">02</span> Core Capabilities
              </a>
              <a href="#model" onClick={() => setIsMobileMenuOpen(false)}>
                <span className="mobile-nav-idx">03</span> Facility Modeller
              </a>
              <a href="#process" onClick={() => setIsMobileMenuOpen(false)}>
                <span className="mobile-nav-idx">04</span> Protocol Process
              </a>
              <button 
                onClick={() => { setIsMobileMenuOpen(false); onLaunchConsole(); }} 
                style={{ textAlign: 'left', background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 600, padding: '8px 0', font: 'inherit', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span className="mobile-nav-idx">05</span> Protocol Dashboard ★
              </button>
            </div>
            <div className="mobile-nav-footer">
              <button
                className="cta-btn"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => { setIsMobileMenuOpen(false); onLaunchConsole(); }}
              >
                Launch Protocol Console
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* HERO SECTION */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Institutional Trade Finance · Canton Network</span>
            <h1 className="serif">Private receivables, <em>publicly verifiable</em> settlement.</h1>
            <p className="lede">
              Novatio is a Real-World Asset protocol built natively on Canton with Daml, giving suppliers immediate liquidity without exposing line items or margins, eliminating double-financing, and removing counterparty default risk.
            </p>
            <div className="hero-actions">
              <button onClick={onLaunchConsole} className="cta-btn">
                Launch Protocol Console
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              </button>
              <a href="#model" className="btn-ghost">Model a facility</a>
            </div>
          </div>

          <div className="hero-card">
            <h4>Live Facility Snapshot</h4>
            <div className="kv"><span>Invoice reference</span><span className="mono">INV-2026-001</span></div>
            <div className="kv"><span>Face value</span><span className="mono">$ 100,000.00</span></div>
            <div className="kv"><span>Advance rate</span><span className="mono">85.0%</span></div>
            <div className="kv"><span>Cash disbursed (T+0)</span><span className="mono" style={{ color: 'var(--accent)' }}>$ 85,000.00</span></div>
            <div className="kv"><span>Discount fee (90d)</span><span className="mono" style={{ color: 'var(--gold)' }}>$ 2,500.00</span></div>
            <div className="kv"><span>Factorer net yield</span><span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>+ {fmtRefPct(refYieldTenor)}% / {REFERENCE_TENOR}d ({fmtRefPA(refYieldPA)}% p.a.)</span></div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '18px', flexWrap: 'wrap' }}>
              <span className="badge"><span className="dot"></span>Atomic DvP settled</span>
              <span className="badge">ISO 20022 · pacs.008</span>
              <span className="badge">Daml 2.10 / Canton 3.x</span>
            </div>
          </div>
        </div>
      </header>

      {/* PROBLEMS SECTION */}
      <section id="problem">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <span className="eyebrow">The friction</span>
              <h2 className="serif" style={{ marginTop: '12px' }}>
                Three failures that keep trade finance <em style={{ fontStyle: 'italic', color: 'var(--gold)' }}>manual, opaque, and risky.</em>
              </h2>
            </div>
            <p>The $3 Trillion global trade finance gap is not a capital problem, it is a data-confidentiality and verification problem. Novatio resolves all three at the protocol layer.</p>
          </div>

          <div className="problems">
            <div className="problem">
              <div className="num">01</div>
              <span className="x">✕</span>
              <h3>NDA-leaking disclosures</h3>
              <p>Traditional factoring forces suppliers to expose line items, wholesale margins, and customer lists to financiers, breaching corporate NDAs and destroying competitive moats.</p>
            </div>
            <div className="problem">
              <div className="num">02</div>
              <span className="x">✕</span>
              <h3>Double-financing fraud</h3>
              <p>The exact same receivable is pledged to multiple lenders across siloed ledgers (Greensill Capital pattern). Detection occurs only after default, with losses borne by the factorer.</p>
            </div>
            <div className="problem">
              <div className="num">03</div>
              <span className="x">✕</span>
              <h3>Settlement & counterparty risk</h3>
              <p>Cash and legal title move on different rails and timelines. Principal is at risk between T+0 advance and final payment, with no atomic execution guarantee.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CAPABILITIES SECTION */}
      <section id="capabilities">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <span className="eyebrow">Core capabilities</span>
              <h2 className="serif" style={{ marginTop: '12px' }}>
                Six primitives, enforced by <em style={{ fontStyle: 'italic', color: 'var(--gold)' }}>Daml on Canton.</em>
              </h2>
            </div>
            <p>Each capability is a deterministic, contract-level guarantee, not an operational promise. Privacy is scoped; verification is cryptographic; settlement is atomic.</p>
          </div>

          <div className="features">
            <div className="feature">
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
              </div>
              <h3>Contract decomposition</h3>
              <p>Invoices are split into discrete, independently financeable obligations: line items and margins stay private to the supplier while obligations are verifiable to the factorer.</p>
              <span className="tag">Privacy-preserving</span>
            </div>
            <div className="feature">
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2 L4 6 V12 C4 17 8 21 12 22 C16 21 20 17 20 12 V6 Z"/><path d="M9 12 L11 14 L15 10"/>
                </svg>
              </div>
              <h3>Single-writer deduplication</h3>
              <p>Canton's sub-partition model guarantees one authoritative writer per receivable via NovationRegistry. The same obligation cannot be pledged twice: by construction, not by audit.</p>
              <span className="tag">Anti-fraud</span>
            </div>
            <div className="feature">
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/><path d="M8 12 L11 15 L16 9"/>
                </svg>
              </div>
              <h3>Atomic DvP advances</h3>
              <p>Delivery versus payment is enforced in a single Daml choice: the receivable moves only if the cash leg settles, and vice versa. No orphaned state.</p>
              <span className="tag">T+0 certainty</span>
            </div>
            <div className="feature">
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7 H20"/><path d="M4 17 H20"/><path d="M7 7 V17"/><path d="M17 7 V17"/>
                </svg>
              </div>
              <h3>Two-legged settlement</h3>
              <p>Advance and maturity legs are modeled as coupled contracts with a shared settlement hash. Either both complete or neither does, removing principal gap risk.</p>
              <span className="tag">Risk removal</span>
            </div>
            <div className="feature">
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7"/><path d="M21 21 L16 16"/>
                </svg>
              </div>
              <h3>Scoped auditing</h3>
              <p>Regulators and auditors see only the fields they are entitled to, never the full contract graph: the commitment hash lets them anchor a FinanceableReceivable to its CommercialInvoice without reading it.</p>
              <span className="tag">Compliance-grade</span>
            </div>
            <div className="feature">
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4 H20 V20 H4 Z"/><path d="M4 9 H20"/><path d="M9 4 V20"/>
                </svg>
              </div>
              <h3>ISO 20022 mapping</h3>
              <p>Settled obligations are exported as ISO 20022 pacs.008 messages carrying the on-chain commitment hash, so treasury and back-office systems receive the same payment instruction the ledger recorded.</p>
              <span className="tag">Interoperable</span>
            </div>
          </div>
        </div>
      </section>

      {/* FINANCIAL MODEL SECTION */}
      <section id="model">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <span className="eyebrow">Unit economics</span>
              <h2 className="serif" style={{ marginTop: '12px' }}>
                Transparent returns for <em style={{ fontStyle: 'italic', color: 'var(--gold)' }}>both sides of the book.</em>
              </h2>
            </div>
            <p>Suppliers receive immediate working capital. Factorers earn risk-adjusted yields on short-duration, privately-underwritten receivables. Adjust the parameters to model a facility.</p>
          </div>

          <div className="fin">
            {/* Control panel */}
            <div className="fin-panel">
              <h3>Facility modeller</h3>
              <p className="sub">Indicative returns, subject to underwriting and tenor.</p>

              <div className="preset">
                <button 
                  className={activePreset === 'baseline' ? 'active' : ''} 
                  onClick={() => setPreset('baseline', REFERENCE_FACE_VALUE, REFERENCE_ADVANCE_RATE, REFERENCE_DISCOUNT_RATE, REFERENCE_TENOR)}
                >
                  $100K · 90d (HackCanton Model)
                </button>
                <button 
                  className={activePreset === '250k' ? 'active' : ''} 
                  onClick={() => setPreset('250k', 250000, 80, 3.5, 45)}
                >
                  $250K · 45d
                </button>
                <button 
                  className={activePreset === '1.25m' ? 'active' : ''} 
                  onClick={() => setPreset('1.25m', 1250000, 85, 2.5, 60)}
                >
                  $1.25M · 60d
                </button>
                <button 
                  className={activePreset === '5m' ? 'active' : ''} 
                  onClick={() => setPreset('5m', 5000000, 90, 1.8, 90)}
                >
                  $5M · 90d
                </button>
              </div>

              <div className="slider-row">
                <label>
                  <span>Invoice face value</span>
                  <b className="mono">{fmtUSD(modellerFaceValue)}</b>
                </label>
                <input 
                  type="range" 
                  min="50000" 
                  max="10000000" 
                  step="25000" 
                  value={modellerFaceValue}
                  onChange={e => { setModellerFaceValue(+e.target.value); setActivePreset(''); }}
                />
              </div>

              <div className="slider-row">
                <label>
                  <span>Advance rate</span>
                  <b className="mono">{modellerAdvanceRate}%</b>
                </label>
                <input 
                  type="range" 
                  min="50" 
                  max="95" 
                  step="1" 
                  value={modellerAdvanceRate}
                  onChange={e => { setModellerAdvanceRate(+e.target.value); setActivePreset(''); }}
                />
              </div>

              <div className="slider-row">
                <label>
                  <span>Discount fee rate</span>
                  <b className="mono">{modellerDiscountRate.toFixed(2)}% flat</b>
                </label>
                <input 
                  type="range" 
                  min="0.5" 
                  max="6.0" 
                  step="0.05" 
                  value={modellerDiscountRate}
                  onChange={e => { setModellerDiscountRate(+e.target.value); setActivePreset(''); }}
                />
              </div>

              <div className="slider-row">
                <label>
                  <span>Tenor (days)</span>
                  <b className="mono">{modellerTenor} days</b>
                </label>
                <input 
                  type="range" 
                  min="15" 
                  max="180" 
                  step="1" 
                  value={modellerTenor}
                  onChange={e => { setModellerTenor(+e.target.value); setActivePreset(''); }}
                />
              </div>

              <div className="calc-out">
                <div className="calc-box">
                  <div className="lbl">Supplier receives (T+0)</div>
                  <div className="val mono">{fmtUSD(calcAdvance)}</div>
                  <div className="delta">Immediate liquidity · no line-item disclosure</div>
                </div>
                <div className="calc-box accent">
                  <div className="lbl">Factorer Net Yield</div>
                  <div className="val mono">{calcYieldTenor.toFixed(2)}%<small>/{modellerTenor}d</small></div>
                  <div className="delta">+ {fmtUSD(calcFee)} · {calcYieldPA.toFixed(1)}% annualised</div>
                </div>
                <div className="calc-box">
                  <div className="lbl">Discount fee</div>
                  <div className="val mono">{fmtUSD(calcFee)}</div>
                  <div className="delta">Deducted at maturity settlement</div>
                </div>
                <div className="calc-box">
                  <div className="lbl">Reserve balance</div>
                  <div className="val mono">{fmtUSD(calcReserve - calcFee)}</div>
                  <div className="delta">Returned to supplier on settlement</div>
                </div>
              </div>
            </div>

            {/* Settlement flow */}
            <div className="settle">
              <h3>Two-legged settlement</h3>
              <p className="sub">Coupled contracts with a shared settlement hash. Either both legs complete, or neither does.</p>

              <div className="legs">
                <div className="leg">
                  <div className="leg-title">Leg A · <b>Advance</b></div>
                  <ul>
                    <li><span>Trigger</span><span>T+0</span></li>
                    <li><span>Cash to supplier</span><span className="mono">{fmtUSD(calcAdvance)}</span></li>
                    <li><span>Receivable → factorer</span><span>Atomic</span></li>
                    <li><span>Reserve held</span><span className="mono">{fmtUSD(calcReserve)}</span></li>
                    <li><span>DvP guarantee</span><span style={{ color: 'var(--accent)' }}>Enforced</span></li>
                  </ul>
                </div>
                <div className="arrow">
                  <svg width="36" height="20" viewBox="0 0 36 20" fill="none">
                    <path d="M1 10 H33 M25 3 L33 10 L25 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="leg leg-b">
                  <div className="leg-title">Leg B · <b>Maturity</b></div>
                  <ul>
                    <li><span>Trigger</span><span>T+{modellerTenor}</span></li>
                    <li><span>Buyer pays face</span><span className="mono">{fmtUSD(modellerFaceValue)}</span></li>
                    <li><span>Fee to factorer</span><span className="mono" style={{ color: 'var(--gold-soft)' }}>{fmtUSD(calcFee)}</span></li>
                    <li><span>Reserve to supplier</span><span className="mono">{fmtUSD(calcReserve - calcFee)}</span></li>
                    <li><span>ISO 20022</span><span>pacs.008</span></li>
                  </ul>
                </div>
              </div>

              <div style={{ marginTop: '24px', padding: '18px', background: 'var(--paper-2)', borderRadius: '10px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" style={{ flexShrink: 0, marginTop: '2px' }}>
                  <circle cx="12" cy="12" r="9"/><path d="M12 8 V12 M12 16 V16.01"/>
                </svg>
                <div style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
                  <b style={{ color: 'var(--ink)' }}>Canton sub-partitions</b> ensure a receivable has exactly one authoritative writer — its buyer's NovationRegistry. Against that buyer, double-financing is structurally impossible, not merely detected: the registry's consuming choice makes the second pledge fail at the authorisation stage.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROCESS FLOW SECTION */}
      <section id="process">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <span className="eyebrow">Protocol flow</span>
              <h2 className="serif" style={{ marginTop: '12px' }}>
                From invoice to <em style={{ fontStyle: 'italic', color: 'var(--gold)' }}>settled receivable</em> in five atomic steps.
              </h2>
            </div>
            <p>Every step is a Daml transaction with deterministic outcomes and scoped visibility for each participant.</p>
          </div>

          <div className="flow">
            <div className="flow-step">
              <div className="n">Step 01</div>
              <h4>Ingest & decompose</h4>
              <p>Supplier uploads invoice. Daml template decomposes obligations while line items remain strictly private to buyer and supplier.</p>
            </div>
            <div className="flow-step">
              <div className="n">Step 02</div>
              <h4>Dedup & register</h4>
              <p>Single-writer authorization registers the receivable on Canton. A global uniqueness hash prevents double-financing.</p>
            </div>
            <div className="flow-step">
              <div className="n">Step 03</div>
              <h4>Factorer underwrites</h4>
              <p>Factorer views scoped fields (amount, tenor, obligor rating) and extends facility terms. No NDA-sensitive data is exposed.</p>
            </div>
            <div className="flow-step">
              <div className="n">Step 04</div>
              <h4>Atomic DvP advance</h4>
              <p>Cash and receivable move in a single transaction. Supplier receives T+0 liquidity; factorer holds the receivable on-ledger.</p>
            </div>
            <div className="flow-step">
              <div className="n">Step 05</div>
              <h4>Maturity & release</h4>
              <p>Buyer settles face value. Fee flows to factorer, reserve to supplier. pacs.008 emitted. Contract archives deterministically.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PROTOCOL CONSOLE TEASER SECTION */}
      <section style={{ background: 'var(--paper-2)', padding: '72px 0' }}>
        <div className="wrap" style={{ textAlign: 'center', maxWidth: '820px' }}>
          <span className="eyebrow" style={{ color: 'var(--gold)' }}>Live Protocol Testbed</span>
          <h2 className="serif" style={{ fontSize: '36px', margin: '14px 0 16px' }}>
            Ready to test on Canton Network?
          </h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: '15px', lineHeight: 1.6, marginBottom: '28px' }}>
            Switch between Buyer, Supplier, Factorer, and Auditor nodes in our dedicated Institutional Protocol Console. Verify sub-transaction privacy, single-writer deduplication invariants, and atomic DvP cash settlement in real time.
          </p>
          <button 
            onClick={onLaunchConsole}
            className="cta-btn"
            style={{ fontSize: '14px', padding: '12px 28px' }}
          >
            Open Institutional Protocol Dashboard →
          </button>
        </div>
      </section>

      {/* CTA SECTION */}
      <section id="cta" style={{ borderBottom: 'none' }}>
        <div className="wrap">
          <div className="cta-block">
            <span className="eyebrow" style={{ color: 'var(--gold-soft)' }}>For institutions · banks · factors</span>
            <h2 className="serif" style={{ marginTop: '16px' }}>Bring your receivables <em>on-chain</em> without bringing your counterparties' data.</h2>
            <p>Novatio is currently onboarding institutional factorers, corporate treasury teams, and regulated lending desks. Request a private briefing and facility sizing session.</p>
            <button onClick={onLaunchConsole} className="cta-btn">
              Explore Live Protocol Dashboard
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="wrap foot-in">
          <div className="mark">
            <NovatioMark size={22} />
            <span className="wordmark">Novatio</span>
            <span style={{ color: 'var(--gold)', fontWeight: 400 }}>Protocol</span>
          </div>
          <div className="foot-links">
            <a href="#problem">Problem</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#model">Financial Model</a>
            <a href="#process">Process</a>
            <button onClick={onLaunchConsole} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>
              Protocol Dashboard
            </button>
          </div>
          <div>Built on Canton · Daml 2.10 / 3.x · © Novatio 2026</div>
        </div>
      </footer>
    </div>
  );
};
