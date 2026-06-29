import { Component } from 'react';
import { supabase } from './supabase';

// Best-effort crash logging to the error_logs table. Never throws — if logging
// itself fails (offline, RLS, etc.) we just swallow it.
export async function logError(message, stack, componentStack) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('error_logs').insert({
      user_id: user?.id ?? null,
      message: String(message || 'Unknown error').slice(0, 2000),
      stack: stack ? String(stack).slice(0, 6000) : null,
      component_stack: componentStack ? String(componentStack).slice(0, 6000) : null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
  } catch { /* logging is best-effort */ }
}

// Catch uncaught errors and unhandled promise rejections outside React's render
// tree so they're logged too. Call once at startup.
export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    logError(e.message || 'window.error', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    logError(r?.message || 'unhandledrejection', r?.stack);
  });
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[Lendie] render crash:', error, info?.componentStack);
    logError(error?.message || 'render crash', error?.stack, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const bg = dark ? '#000' : '#fff';
    const text = dark ? '#F2F2F7' : '#1C1E21';
    const muted = dark ? '#AEAEB2' : '#65676B';
    return (
      <div style={{ minHeight: '100dvh', background: bg, color: text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', textAlign: 'center' }}>
        <div style={{ fontSize: 30, fontWeight: 900, color: '#00B894', letterSpacing: -0.5, marginBottom: 16 }}>lendie</div>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>Something went wrong</div>
        <div style={{ fontSize: 14, color: muted, maxWidth: 320, lineHeight: 1.5, marginBottom: 24 }}>
          The app hit an unexpected error. Reloading usually fixes it. If it keeps happening, email support@lendie.app.
        </div>
        <button onClick={() => window.location.reload()} style={{ padding: '13px 28px', borderRadius: 12, border: 'none', background: '#00B894', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Reload Lendie
        </button>
      </div>
    );
  }
}
