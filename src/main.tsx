import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './pwa.ts';

createRoot(document.getElementById('root')!).render(<App />);

// Chrome only exposes this event when the manifest, icons and SW all pass its
// installability checks. Keep the deferred prompt available to the app UI.

/**
 * Service worker registration — enables "Add to home screen" / install as app and
 * receives Web Push notifications. It is also registered in development so that
 * push can be tested on localhost (a secure context).
 * Failures are ignored: the app works fine without it.
 */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] Service worker registration failed:', err);
    });
  });
}
