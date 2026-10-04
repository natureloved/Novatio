import React, { useState, useEffect } from 'react';
import { CantonLedgerClient, LedgerClientConfig } from './ledgerClient';
import { LandingPage } from './LandingPage';
import { Dashboard } from './Dashboard';
import './index.css';

/**
 * Ledger wiring.
 *
 * The dashboard only talks to a real Canton Network node when a
 * runtime config exists at /novatio-canton/config.json (written by
 * scripts/canton-local.sh) or when VITE_LEDGER_URL is set at build
 * time. The runtime path keeps the bearer token out of the bundle:
 * the config file lives on the page origin, not in import.meta.env,
 * so Vite never embeds it. With neither source present the client
 * falls back to the bundled isolation engine and labels itself
 * SIMULATED — honest by default.
 */
async function buildLedgerConfig(): Promise<LedgerClientConfig> {
  const env = import.meta.env ?? {};
  const base: LedgerClientConfig = {
    jsonApiUrl: env.VITE_LEDGER_URL || undefined,
    jsonApiVersion: (env.VITE_LEDGER_API_VERSION === 'v2' ? 'v2' : 'v1'),
    authToken: env.VITE_LEDGER_JWT || undefined,
    packageId: env.VITE_LEDGER_PACKAGE_ID || undefined,
  };
  const runtime = await CantonLedgerClient.loadRuntimeConfig();
  // Runtime source wins when present, so a fresh start (config written
  // after the last build) overrides whatever the bundle says.
  return { ...base, ...runtime };
}

let _ledger: CantonLedgerClient | null = null;
let _ledgerReady: Promise<CantonLedgerClient> | null = null;

function getLedger(): Promise<CantonLedgerClient> {
  if (_ledgerReady) return _ledgerReady;
  _ledgerReady = buildLedgerConfig().then(cfg => {
    if (!_ledger) _ledger = new CantonLedgerClient(cfg);
    return _ledger;
  });
  return _ledgerReady;
}

interface ToastInfo {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'landing' | 'dashboard'>(() => {
    return window.location.hash === '#dashboard' ? 'dashboard' : 'landing';
  });
  const [toasts, setToasts] = useState<ToastInfo[]>([]);
  const [ledger, setLedger] = useState<CantonLedgerClient | null>(null);

  useEffect(() => {
    getLedger().then(setLedger);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#dashboard') {
        setViewMode('dashboard');
      } else if (
        window.location.hash === '' ||
        window.location.hash === '#landing' ||
        window.location.hash.startsWith('#problem') ||
        window.location.hash.startsWith('#capabilities') ||
        window.location.hash.startsWith('#model') ||
        window.location.hash.startsWith('#process') ||
        window.location.hash.startsWith('#cta')
      ) {
        setViewMode('landing');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const addToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const handleLaunchDashboard = () => {
    setViewMode('dashboard');
    window.location.hash = 'dashboard';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigateHome = () => {
    setViewMode('landing');
    window.location.hash = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div>
      {/* Toast Notification Container */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type === 'error' ? 'toast-error' : t.type === 'info' ? 'toast-info' : ''}`}>
            <span>{t.type === 'error' ? '✕' : t.type === 'info' ? 'ℹ' : '✓'}</span>
            <div>{t.message}</div>
          </div>
        ))}
      </div>

      {viewMode === 'landing' ? (
        <LandingPage
          onLaunchConsole={handleLaunchDashboard}
          addToast={addToast}
        />
      ) : !ledger ? (
        <div className="loading">Connecting to the ledger…</div>
      ) : (
        <Dashboard
          ledger={ledger}
          onNavigateHome={handleNavigateHome}
          addToast={addToast}
        />
      )}
    </div>
  );
};

export default App;
