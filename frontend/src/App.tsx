import React, { useState, useEffect } from 'react';
import { CantonLedgerClient } from './ledgerClient';
import { LandingPage } from './LandingPage';
import { Dashboard } from './Dashboard';
import './index.css';

const ledger = new CantonLedgerClient();

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
