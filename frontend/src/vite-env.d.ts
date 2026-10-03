/// <reference types="vite/client" />

// Typed environment surface for the Novatio frontend.
//
// The participant endpoint is intentionally OPTIONAL and defaults to the local
// in-browser simulation. Anything that reads `VITE_LEDGER_URL` must treat an
// unset value as "no Canton node configured", never as a reason to guess a URL.
//
// DOM injection is not possible here (Vite inlines these at build time), so
// production values come from the deploy environment, not from this file.
interface ImportMetaEnv {
  /** JSON Ledger API base URL, e.g. http://localhost:7575 */
  readonly VITE_LEDGER_URL?: string;
  /** JSON Ledger API version: v1 (legacy /v1/query) or v2 (submit-and-wait) */
  readonly VITE_LEDGER_API_VERSION?: 'v1' | 'v2';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
