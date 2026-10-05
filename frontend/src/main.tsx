import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
// The wordmark typeface, self-hosted. Imported once, at the entry, so every
// brand lockup in the app renders with the same face.
import './brand/wordmark.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
