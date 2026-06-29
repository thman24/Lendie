import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import AdminPage from './Admin.jsx'
import ErrorBoundary, { installGlobalErrorHandlers } from './ErrorBoundary.jsx'

// Log uncaught errors / promise rejections (outside React's render tree).
installGlobalErrorHandlers()

// Register immediately and re-check often (on focus + every 5 min) so installed
// PWAs pick up new deploys without users having to force-quit the app
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => registration.update().catch(() => {});
    setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
})

// The SW uses skipWaiting + clientsClaim, so when a new version takes control,
// reload once to swap the running app onto the new bundle
if ('serviceWorker' in navigator) {
  // Only reload when an *existing* controller is replaced — not on first install
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

const isAdminRoute = window.location.pathname.startsWith('/admin');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      {isAdminRoute ? <AdminPage /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
