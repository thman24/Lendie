import { useState, useEffect, useCallback } from "react";
import { supabase } from './supabase';

const ADMIN_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';
const G  = '#00B894';
const BG = '#000';
const S1 = '#111';
const BD = '#222';
const TX = '#fff';
const MU = '#888';

// Module-level so it isn't recreated on every render (which would drop input focus per keystroke).
function SearchInput({ value, onChange, placeholder }) {
  return (
    <input value={value} onChange={onChange} placeholder={placeholder}
      style={{ width:'100%', padding:'10px 14px', background:S1, border:`1px solid ${BD}`, borderRadius:8, color:TX, fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }}/>
  );
}

export default function AdminPage() {
  const [authed, setAuthed]     = useState(null);
  const [openSections, setOpenSections] = useState({ overview: true });
  const [stats, setStats]       = useState({ users:0, listings:0, bookings:0, messages:0, reviews:0, reports:0, flags:0 });
  const [users, setUsers]       = useState([]);
  const [listings, setListings] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [reports, setReports]   = useState([]);
  const [flags, setFlags]       = useState([]);
  const [adminId, setAdminId]   = useState(null);
  const [searches, setSearches] = useState({});
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [suspended, setSuspended] = useState({}); // userId -> banned_until ISO (or 'indefinite')
  const [isOwner, setIsOwner] = useState(false);
  const [adminsList, setAdminsList] = useState([]);
  const [toast, setToast]       = useState(null);
  const [loading, setLoading]   = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const isOpen = id => !!openSections[id];
  const toggle = id => setOpenSections(p => ({ ...p, [id]: !p[id] }));
  const getQ   = id => (searches[id] || '').toLowerCase().trim();
  const setQ   = (id, v) => setSearches(p => ({ ...p, [id]: v }));

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [lRes, bRes, mRes, rRes, rpRes, fRes] = await Promise.all([
      supabase.from('listings').select('*').order('created_at', { ascending: false }),
      supabase.from('booking_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('messages').select('id'),
      supabase.from('reviews').select('id'),
      supabase.from('reports').select('*').order('created_at', { ascending: false }),
      supabase.from('user_flags').select('*').order('created_at', { ascending: false }),
    ]);

    const listingsData = lRes.data || [];
    const bookingsData = bRes.data || [];

    const usersMap = {};
    bookingsData.forEach(r => {
      if (r.renter_id) {
        if (!usersMap[r.renter_id]) usersMap[r.renter_id] = { id: r.renter_id, name: r.renter_name || 'Unknown', listingCount: 0, bookingCount: 0, joinedAt: r.created_at };
        usersMap[r.renter_id].bookingCount++;
      }
      if (r.owner_id && !usersMap[r.owner_id]) usersMap[r.owner_id] = { id: r.owner_id, name: r.item_json?.owner || 'Unknown Owner', listingCount: 0, bookingCount: 0, joinedAt: r.created_at };
    });
    listingsData.forEach(l => {
      if (!l.user_id) return;
      if (!usersMap[l.user_id]) usersMap[l.user_id] = { id: l.user_id, name: l.owner_name || 'Unknown', listingCount: 0, bookingCount: 0, joinedAt: l.created_at };
      usersMap[l.user_id].listingCount++;
    });

    const usersArr = Object.values(usersMap).sort((a, b) => a.name.localeCompare(b.name));
    const reportsData = rpRes.data || [];
    const flagsData = fRes.data || [];
    setListings(listingsData);
    setBookings(bookingsData);
    setUsers(usersArr);
    setReports(reportsData);
    setFlags(flagsData);
    setStats({
      users: usersArr.length,
      listings: listingsData.length,
      bookings: bookingsData.length,
      messages: (mRes.data || []).length,
      reviews: (rRes.data || []).length,
      reports: reportsData.filter(r => r.status === 'pending').length,
      flags: flagsData.filter(f => f.status === 'pending').length,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = '/'; return; }
      let ok = user.id === ADMIN_ID;
      if (!ok) { const { data } = await supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle(); ok = !!data; }
      if (!ok) { window.location.href = '/'; return; }
      setIsOwner(user.id === ADMIN_ID);
      setAdminId(user.id);
      setAuthed(true);
      loadAll();
    });
  }, [loadAll]);

  const deleteListing = async (id, title) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    // .select() returns the affected rows — 0 rows means RLS blocked it, so we
    // surface a real error instead of falsely showing success.
    const { data, error } = await supabase.from('listings').delete().eq('id', id).select('id');
    if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
    if (!data || data.length === 0) { showToast("Couldn't delete — you don't have permission for this listing", 'error'); return; }
    setListings(prev => prev.filter(l => l.id !== id));
    setStats(s => ({ ...s, listings: s.listings - 1 }));
    showToast('Listing deleted');
  };

  const toggleListingVisibility = async (id, currentlyAvailable) => {
    const next = !currentlyAvailable;
    const { data, error } = await supabase.from('listings').update({ available: next }).eq('id', id).select('id');
    if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
    if (!data || data.length === 0) { showToast("Couldn't update — you don't have permission for this listing", 'error'); return; }
    setListings(prev => prev.map(l => l.id === id ? { ...l, available: next } : l));
    showToast(next ? 'Listing restored to browse' : 'Listing hidden from browse');
  };

  const cancelBooking = async (id) => {
    if (!window.confirm('Cancel this booking request?')) return;
    const { data, error } = await supabase.from('booking_requests').update({ status: 'cancelled' }).eq('id', id).select('id');
    if (error) { showToast('Cancel failed: ' + error.message, 'error'); return; }
    if (!data || data.length === 0) { showToast("Couldn't cancel — you don't have permission for this booking", 'error'); return; }
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b));
    showToast('Booking cancelled');
  };

  const callAdmin = async (fn, action, body = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not signed in');
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  };

  const loadSuspended = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-suspend-user`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }),
      });
      const json = await res.json();
      if (json.suspended) setSuspended(json.suspended);
    } catch (e) { console.error('[loadSuspended]', e); }
  }, []);

  const suspendUser = async (u) => {
    const input = window.prompt(`Suspend ${u.name} for how many DAYS?\n\nLeave blank for indefinite (until you reinstate them).`, '');
    if (input === null) return false;
    const trimmed = input.trim();
    const days = trimmed === '' ? null : Number(trimmed);
    if (trimmed !== '' && (!days || days <= 0)) { showToast('Enter a valid number of days', 'error'); return false; }
    try {
      const { bannedUntil } = await callAdmin('admin-suspend-user', 'suspend', { userId: u.id, durationHours: days ? days * 24 : null });
      setSuspended(prev => ({ ...prev, [u.id]: bannedUntil || 'indefinite' }));
      // Mirror the server: only hide currently-available listings, tag them so
      // unsuspend restores exactly these.
      setListings(prev => prev.map(l => l.user_id === u.id && l.available ? { ...l, available: false, hidden_by_suspension: true } : l));
      // Instant kick: if they're online, force-logout their open session now.
      try {
        const ch = supabase.channel(`account-${u.id}`);
        await new Promise(resolve => { ch.subscribe(s => { if (s === 'SUBSCRIBED') resolve(); }); setTimeout(resolve, 2500); });
        await ch.send({ type: 'broadcast', event: 'suspended', payload: {} });
        setTimeout(() => supabase.removeChannel(ch), 1500);
      } catch { /* best effort */ }
      // Notify the suspended user (in-app + email) so they know why. Best-effort.
      const notice = days ? `for ${days} day${days>1?'s':''}` : 'indefinitely';
      supabase.from('notifications').insert({
        user_id: u.id, icon: '⛔',
        text: 'Your account has been suspended',
        sub: `Your Lendie account has been suspended ${notice} following a review. Contact support if you believe this is a mistake.`,
        time_label: 'Just now', unread: true, type: 'general',
      }).then(({ error }) => { if (error) console.error('[suspend] notif failed:', error.message); });
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: u.id, subject: 'Your Lendie account has been suspended',
            html: `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">Account suspended</h2>
                   <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px">Your Lendie account has been suspended <strong>${notice}</strong> following a review of activity on your account.</p>
                   <p style="margin:0 0 6px;color:#65676B;font-size:14px">If you believe this was made in error, reply to this email and we'll take a look.</p>` }),
        }).catch(() => {});
      } catch { /* best effort */ }
      showToast(`${u.name} suspended${days ? ` for ${days} day${days>1?'s':''}` : ' indefinitely'}`);
      return true;
    } catch (e) { showToast(e.message || 'Suspend failed', 'error'); return false; }
  };

  // Resolve a review flag. 'actioned' = user was suspended off this flag.
  const updateFlagStatus = async (id, status) => {
    const { error } = await supabase.from('user_flags')
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: adminId }).eq('id', id);
    if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
    const next = flags.map(f => f.id === id ? { ...f, status } : f);
    setFlags(next);
    setStats(s => ({ ...s, flags: next.filter(f => f.status === 'pending').length }));
    showToast(status === 'actioned' ? 'User suspended · flag resolved' : status === 'dismissed' ? 'Flag dismissed' : 'Flag reopened');
  };

  // Suspend the flagged user, then mark the flag actioned only if it went through
  // (the suspend prompt may be cancelled).
  const suspendFromFlag = async (f) => {
    const ok = await suspendUser({ id: f.user_id, name: userName(f.user_id) });
    if (ok) updateFlagStatus(f.id, 'actioned');
  };

  const unsuspendUser = async (u) => {
    try {
      await callAdmin('admin-suspend-user', 'unsuspend', { userId: u.id });
      setSuspended(prev => { const n = { ...prev }; delete n[u.id]; return n; });
      // Mirror the server: restore only the listings we auto-hid at suspension.
      setListings(prev => prev.map(l => l.user_id === u.id && l.hidden_by_suspension ? { ...l, available: true, hidden_by_suspension: false } : l));
      showToast(`${u.name} reinstated`);
    } catch (e) { showToast(e.message || 'Reinstate failed', 'error'); }
  };

  useEffect(() => { if (authed) loadSuspended(); }, [authed, loadSuspended]);

  const loadAdmins = useCallback(async () => {
    try { const { admins } = await callAdmin('admin-access', 'list'); setAdminsList(admins || []); } catch (e) { console.error('[loadAdmins]', e); }
  }, []);
  useEffect(() => { if (authed && isOwner) loadAdmins(); }, [authed, isOwner, loadAdmins]);

  const addAdmin = async () => {
    const email = window.prompt("Grant admin access to which email?\n\nThey must already have a Lendie account.");
    if (!email || !email.trim()) return;
    try {
      const { admin: a } = await callAdmin('admin-access', 'add', { email: email.trim() });
      setAdminsList(prev => prev.some(x => x.user_id === a.user_id) ? prev : [...prev, { ...a, added_at: new Date().toISOString() }]);
      showToast(`${a.email} is now an admin`);
    } catch (e) { showToast(e.message || 'Failed to add admin', 'error'); }
  };
  const removeAdmin = async (a) => {
    if (!window.confirm(`Remove admin access from ${a.email || a.user_id}?`)) return;
    try {
      await callAdmin('admin-access', 'remove', { userId: a.user_id });
      setAdminsList(prev => prev.filter(x => x.user_id !== a.user_id));
      showToast('Admin access removed');
    } catch (e) { showToast(e.message || 'Failed to remove', 'error'); }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Permanently delete ${u.name}? This removes their account and all their listings, and cancels their pending bookings. This cannot be undone.`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { showToast('Not signed in', 'error'); return; }
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-delete-user`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setUsers(prev => prev.filter(x => x.id !== u.id));
      setListings(prev => prev.filter(l => l.user_id !== u.id));
      setStats(s => ({ ...s, users: Math.max(0, s.users - 1) }));
      showToast(`${u.name} deleted`);
    } catch (e) {
      showToast(e.message || 'Delete failed', 'error');
    }
  };

  const updateReportStatus = async (id, status) => {
    const { error } = await supabase.from('reports').update({ status }).eq('id', id);
    if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
    const next = reports.map(r => r.id === id ? { ...r, status } : r);
    setReports(next);
    setStats(s => ({ ...s, reports: next.filter(r => r.status === 'pending').length }));
    showToast(status === 'reviewed' ? 'Marked as reviewed' : status === 'dismissed' ? 'Report dismissed' : 'Report reopened');
  };

  if (authed === null) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background: BG, color: MU, fontFamily:'system-ui, sans-serif', fontSize:14 }}>
      Authenticating…
    </div>
  );

  // ─── Shared components ────────────────────────────────────────────────────

  const STATUS_COLORS = { pending:'#E87722', accepted:'#00B894', declined:'#FA3E3E', cancelled:'#555', completed:'#888' };

  const StatusBadge = ({ status }) => (
    <span style={{ background:(STATUS_COLORS[status]||'#555')+'33', color: STATUS_COLORS[status]||'#888', borderRadius:20, padding:'3px 9px', fontSize:11, fontWeight:700, display:'inline-block' }}>
      {status}
    </span>
  );

  const ActionBtn = ({ label, variant='default', color, onClick, solid }) => {
    // Note: colors must be 6-digit hex so the +alpha suffix stays valid.
    const c = color || (variant === 'danger' ? '#FA3E3E' : variant === 'warn' ? '#E87722' : variant === 'primary' ? '#00B894' : '#9AA0A6');
    return (
      <button onClick={onClick} style={{ padding:'5px 12px', borderRadius:8, border:`1px solid ${c}55`, background: solid ? c : c+'1F', color: solid ? '#fff' : c, fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
        {label}
      </button>
    );
  };

  const TH = ({ children, w }) => (
    <th style={{ padding:'10px 14px', textAlign:'left', fontSize:10, fontWeight:700, color: MU, textTransform:'uppercase', letterSpacing:0.7, whiteSpace:'nowrap', background: S1, borderBottom:`1px solid ${BD}`, width: w }}>
      {children}
    </th>
  );

  const TD = ({ children, muted, mono, style: sx }) => (
    <td style={{ padding:'11px 14px', fontSize:13, color: muted ? MU : TX, borderBottom:`1px solid ${BD}`, verticalAlign:'middle', fontFamily: mono ? 'monospace' : 'inherit', ...sx }}>
      {children}
    </td>
  );

  const Empty = ({ cols, msg }) => (
    <tr><td colSpan={cols} style={{ padding:'40px 14px', textAlign:'center', color: MU, fontSize:13 }}>{msg}</td></tr>
  );

  const SectionHeader = ({ id, label, badge }) => (
    <button onClick={() => toggle(id)} style={{
      width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'16px', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit',
      borderBottom: isOpen(id) ? `1px solid ${BD}` : 'none',
    }}>
      <span style={{ fontWeight:700, fontSize:15, color: TX }}>{label}</span>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        {badge > 0 && <span style={{ background: G, color:'#fff', borderRadius:20, padding:'2px 8px', fontSize:11, fontWeight:800 }}>{badge}</span>}
        <span style={{ color: MU, fontSize:20, lineHeight:1, display:'inline-block', transform: isOpen(id) ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>⌄</span>
      </div>
    </button>
  );

  const q_users    = getQ('users');
  const q_listings = getQ('listings');
  const q_bookings = getQ('bookings');
  const q_reports  = searches.reports || '';

  const filteredUsers    = users.filter(u => !q_users || u.name.toLowerCase().includes(q_users) || u.id.includes(q_users));
  const filteredListings = listings.filter(l => !q_listings || l.title?.toLowerCase().includes(q_listings) || l.owner_name?.toLowerCase().includes(q_listings));
  const filteredBookings = bookings.filter(b => {
    if (!q_bookings) return true;
    const statusFilter = ['pending','accepted','cancelled','declined','completed'];
    if (statusFilter.includes(q_bookings)) return b.status === q_bookings;
    return b.renter_name?.toLowerCase().includes(q_bookings) || b.item_title?.toLowerCase().includes(q_bookings);
  });
  const filteredReports = reports.filter(r => !q_reports || q_reports === 'all' || r.status === q_reports);
  // Pending flags first, then most-recently-updated.
  const sortedFlags = [...flags].sort((a, b) =>
    (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)
    || new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const userName = (id) => (users.find(u => u.id === id)?.name) || (id ? id.slice(0, 8) + '…' : '—');
  // Open a user's public profile in the main app (new tab so admin stays open).
  const openUser = (id, name) => { if (id) window.open(`/?owner=${encodeURIComponent(id)}&oname=${encodeURIComponent(name || '')}`, '_blank', 'noopener'); };
  const reportStatusMeta = (s) => s === 'pending' ? { c:'#FA3E3E', l:'Pending' } : s === 'reviewed' ? { c:'#00B894', l:'Reviewed' } : { c:'#8A8D91', l: s === 'dismissed' ? 'Dismissed' : (s || 'Unknown') };

  // Marketplace performance metrics derived from bookings + listings.
  const perf = (() => {
    const paid       = bookings.filter(b => b.payment_status === 'paid' || b.payment_status === 'cash');
    const cardPaid   = bookings.filter(b => b.payment_status === 'paid');
    const accepted   = bookings.filter(b => ['accepted','confirmed','completed'].includes(b.status)).length;
    const declined   = bookings.filter(b => b.status === 'declined').length;
    const cancelled  = bookings.filter(b => b.status === 'cancelled').length;
    // Card volume (GMV) = what renters were actually charged via Stripe.
    const cardVolume = cardPaid.reduce((s,b) => s + (b.stripe_amount_cents || 0), 0) / 100;
    // Platform fee = renter 8% + owner 4% = renterFee × 1.5 (owner fee is half the renter fee).
    const platformFees = cardPaid.reduce((s,b) => s + (b.renter_fee_cents || 0) * 1.5, 0) / 100;
    const decided    = accepted + declined;
    const acceptRate = decided > 0 ? Math.round(accepted / decided * 100) : null;
    const convRate   = bookings.length > 0 ? Math.round(paid.length / bookings.length * 100) : null;
    const cancelRate = bookings.length > 0 ? Math.round(cancelled / bookings.length * 100) : null;
    const avgValue   = cardPaid.length > 0 ? cardVolume / cardPaid.length : 0;
    return {
      activeListings: listings.filter(l => l.available).length,
      paidCount: paid.length,
      cardVolume, platformFees, acceptRate, convRate, cancelRate, avgValue,
    };
  })();

  // ─── Traction: the metrics that actually tell you the marketplace is working —
  // repeat behavior, velocity, and liquidity. A "transaction" = a booking that
  // reached a real deal (accepted/confirmed/completed, or paid/cash).
  const traction = (() => {
    const txns = bookings.filter(b =>
      ['accepted','confirmed','completed'].includes(b.status) ||
      ['paid','cash'].includes(b.payment_status));
    const countBy = (keyFn) => { const m = {}; txns.forEach(b => { const k = keyFn(b); if (k) m[k] = (m[k]||0)+1; }); return m; };
    const byRenter = countBy(b => b.renter_id);
    const byOwner  = countBy(b => b.owner_id);
    const byItem   = countBy(b => b.item_json?.id);
    const repeatCount = (m) => Object.values(m).filter(n => n >= 2).length;
    const uniqRenters = Object.keys(byRenter).length;
    const repeatRenters = repeatCount(byRenter);
    const now = Date.now(), D = 86400000;
    const at = (b) => new Date(b.created_at).getTime();
    const last30 = txns.filter(b => at(b) >= now - 30*D).length;
    const prev30 = txns.filter(b => at(b) >= now - 60*D && at(b) < now - 30*D).length;
    const typeOf = (b) => b.item_json?.listingType || (b.date_str === 'Purchase' ? 'sale' : String(b.date_str||'').startsWith('Offer') ? 'sale' : 'rent');
    const byType = countBy(typeOf);
    return {
      txns: txns.length,
      last30, prev30,
      growth: prev30 > 0 ? Math.round((last30 - prev30) / prev30 * 100) : null,
      uniqRenters,
      repeatRenters,
      repeatRate: uniqRenters > 0 ? Math.round(repeatRenters / uniqRenters * 100) : null,
      repeatProviders: repeatCount(byOwner),
      repeatItems: repeatCount(byItem),
      active30: new Set(txns.filter(b => at(b) >= now - 30*D).map(b => b.renter_id).filter(Boolean)).size,
      liquidity: listings.length > 0 ? Math.round(new Set(txns.map(b => b.item_json?.id).filter(Boolean)).size / listings.length * 100) : null,
      rent: byType.rent || 0, sale: byType.sale || 0, service: byType.service || 0,
    };
  })();

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ background: BG, minHeight:'100vh', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif', color: TX }}>

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:20, right:20, background: toast.type === 'error' ? '#FA3E3E' : G, color:'#fff', padding:'11px 18px', borderRadius:10, fontSize:13, fontWeight:600, zIndex:9999, boxShadow:'0 4px 20px rgba(0,0,0,0.5)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ position:'sticky', top:0, zIndex:40, background: BG, borderBottom:`1px solid ${BD}`, padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <a href="/" style={{ fontSize:18, fontWeight:900, color: G, textDecoration:'none', letterSpacing:-0.5 }}>← Lendie</a>
        <span style={{ fontSize:12, fontWeight:700, color: MU, textTransform:'uppercase', letterSpacing:1 }}>Admin</span>
        <button onClick={loadAll} disabled={loading} style={{ padding:'7px 14px', borderRadius:8, border:`1px solid ${BD}`, background: S1, color: TX, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          {loading ? '…' : '↺ Refresh'}
        </button>
      </div>

      {/* ── OVERVIEW ────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom:`1px solid ${BD}` }}>
        <SectionHeader id="overview" label="Overview" badge={null} />
        {isOpen('overview') && (
          <div style={{ padding:'0 0 16px' }}>
            <div style={{ display:'flex', overflowX:'auto', gap:0 }}>
              {[
                ['Users', stats.users],
                ['Listings', stats.listings],
                ['Bookings', stats.bookings],
                ['Messages', stats.messages],
                ['Reviews', stats.reviews],
                ['Pending Reports', stats.reports],
              ].map(([label, value]) => (
                <div key={label} style={{ flex:'0 0 auto', minWidth:130, padding:'18px 20px', borderRight:`1px solid ${BD}` }}>
                  <div style={{ fontSize:28, fontWeight:800, color: G, lineHeight:1 }}>{loading ? '…' : value}</div>
                  <div style={{ fontSize:12, color: MU, marginTop:6, fontWeight:600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ margin:'16px 16px 0' }}>
              <div style={{ fontWeight:700, fontSize:13, color: G, textTransform:'uppercase', letterSpacing:0.7, marginBottom:4 }}>⭐ Traction — what actually matters</div>
              <div style={{ fontSize:11, color: MU, marginBottom:10 }}>Repeat behavior + velocity are the signal that the marketplace is working. Chase these, not listing count.</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px,1fr))', gap:10 }}>
                {[
                  ['Repeat customers', loading ? '…' : `${traction.repeatRenters}`, traction.repeatRate==null ? 'buyers/renters with 2+ deals' : `${traction.repeatRate}% of ${traction.uniqRenters} came back`],
                  ['Repeat items', loading ? '…' : `${traction.repeatItems}`, 'listings booked 2+ times'],
                  ['Repeat providers', loading ? '…' : `${traction.repeatProviders}`, 'owners with 2+ deals (recurring)'],
                  ['Transactions', loading ? '…' : `${traction.txns}`, 'accepted/paid deals all-time'],
                  ['Last 30 days', loading ? '…' : `${traction.last30}`, traction.growth==null ? 'transactions this month' : `${traction.growth >= 0 ? '+' : ''}${traction.growth}% vs prior 30d`],
                  ['Active customers', loading ? '…' : `${traction.active30}`, 'transacted in last 30d'],
                  ['Liquidity', loading ? '…' : (traction.liquidity==null?'—':`${traction.liquidity}%`), 'of listings ever booked'],
                  ['Rent / Sale / Service', loading ? '…' : `${traction.rent} / ${traction.sale} / ${traction.service}`, 'transactions by type'],
                ].map(([label, value, hint]) => (
                  <div key={label} style={{ border:`1px solid ${label.startsWith('Repeat') ? G+'66' : BD}`, borderRadius:10, padding:'12px 14px', background: label.startsWith('Repeat') ? G+'0F' : 'transparent' }}>
                    <div style={{ fontSize:22, fontWeight:800, color: G, lineHeight:1 }}>{value}</div>
                    <div style={{ fontSize:12, color: MU, marginTop:5, fontWeight:600 }}>{label}</div>
                    {hint && <div style={{ fontSize:10.5, color: MU, opacity:0.75, marginTop:2 }}>{hint}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ margin:'16px 16px 0' }}>
              <div style={{ fontWeight:700, fontSize:13, color: MU, textTransform:'uppercase', letterSpacing:0.7, marginBottom:10 }}>Performance</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px,1fr))', gap:10 }}>
                {[
                  ['Active Listings', loading ? '…' : perf.activeListings, null],
                  ['Paid Transactions', loading ? '…' : perf.paidCount, null],
                  ['Card Volume', loading ? '…' : `$${perf.cardVolume.toFixed(2)}`, 'Total charged via Stripe'],
                  ['Platform Fees', loading ? '…' : `$${perf.platformFees.toFixed(2)}`, 'Renter 8% + owner 4%'],
                  ['Avg Order', loading ? '…' : `$${perf.avgValue.toFixed(2)}`, 'Per paid card order'],
                  ['Accept Rate', loading ? '…' : (perf.acceptRate==null?'—':`${perf.acceptRate}%`), 'Accepted ÷ decided'],
                  ['Conversion', loading ? '…' : (perf.convRate==null?'—':`${perf.convRate}%`), 'Paid ÷ all requests'],
                  ['Cancel Rate', loading ? '…' : (perf.cancelRate==null?'—':`${perf.cancelRate}%`), 'Cancelled ÷ all requests'],
                ].map(([label, value, hint]) => (
                  <div key={label} style={{ border:`1px solid ${BD}`, borderRadius:10, padding:'12px 14px' }}>
                    <div style={{ fontSize:22, fontWeight:800, color: G, lineHeight:1 }}>{value}</div>
                    <div style={{ fontSize:12, color: MU, marginTop:5, fontWeight:600 }}>{label}</div>
                    {hint && <div style={{ fontSize:10.5, color: MU, opacity:0.7, marginTop:2 }}>{hint}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ margin:'16px', overflowX:'auto' }}>
              <div style={{ fontWeight:700, fontSize:13, color: MU, textTransform:'uppercase', letterSpacing:0.7, marginBottom:10 }}>Recent Bookings</div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  <TH>Item</TH><TH>Renter</TH><TH>Owner</TH><TH>Dates</TH><TH>Status</TH>
                </tr></thead>
                <tbody>
                  {bookings.slice(0, 8).map(b => (
                    <tr key={b.id}>
                      <TD><span style={{ fontWeight:600 }}>{b.item_title}</span></TD>
                      <TD>{b.renter_name}</TD>
                      <TD muted>{b.item_json?.owner || '—'}</TD>
                      <TD muted>{b.date_str}</TD>
                      <TD><StatusBadge status={b.status}/></TD>
                    </tr>
                  ))}
                  {bookings.length === 0 && <Empty cols={5} msg="No booking requests yet" />}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── USERS ───────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom:`1px solid ${BD}` }}>
        <SectionHeader id="users" label="Users" badge={stats.users} />
        {isOpen('users') && (
          <div>
            <div style={{ padding:'12px 16px' }}>
              <SearchInput value={searches.users || ""} onChange={e => setQ("users", e.target.value)} placeholder="Search users…" />
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  <TH w="22%">Name</TH>
                  <TH w="32%">User ID</TH>
                  <TH>Listings</TH>
                  <TH>Bookings</TH>
                  <TH>First Seen</TH>
                  <TH>Actions</TH>
                </tr></thead>
                <tbody>
                  {filteredUsers.map(u => {
                    const expanded = expandedUserId === u.id;
                    const uListings   = listings.filter(l => l.user_id === u.id);
                    const asRenter    = bookings.filter(b => b.renter_id === u.id);
                    const asOwner     = bookings.filter(b => b.owner_id === u.id);
                    const allBookings = [...asRenter.map(b=>({...b,_role:'renter'})), ...asOwner.map(b=>({...b,_role:'owner'}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
                    const repAgainst  = reports.filter(r => r.reported_user_id === u.id);
                    const repBy       = reports.filter(r => r.reporter_id === u.id);
                    const Block = ({ title, count, children }) => (
                      <div>
                        <div style={{ fontSize:11, fontWeight:700, color:MU, textTransform:'uppercase', letterSpacing:0.6, marginBottom:6 }}>{title}{count!=null?` (${count})`:''}</div>
                        {children}
                      </div>
                    );
                    const Line = ({ left, right }) => (
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, padding:'7px 10px', background:S1, border:`1px solid ${BD}`, borderRadius:8, marginBottom:6, fontSize:13 }}>
                        <span style={{ color:TX, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{left}</span>
                        <span style={{ color:MU, fontSize:12, whiteSpace:'nowrap', flexShrink:0 }}>{right}</span>
                      </div>
                    );
                    const None = () => <div style={{ fontSize:12, color:MU, padding:'2px 0 4px' }}>None</div>;
                    return [
                      <tr key={u.id} style={{ background: expanded ? G+'12' : (u.id === ADMIN_ID ? G+'0A' : 'transparent') }}>
                        <TD>
                          <div style={{ fontWeight:600, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                            <span onClick={() => openUser(u.id, u.name)} style={{ color:G, cursor:'pointer', textDecoration:'underline', textDecorationColor:G+'66' }} title="Open profile">{u.name}</span>
                            {u.id === ADMIN_ID && <span style={{ fontSize:10, fontWeight:700, color:G, background: G+'22', borderRadius:4, padding:'1px 5px' }}>YOU</span>}
                            {suspended[u.id] && <span style={{ fontSize:10, fontWeight:700, color:'#FA3E3E', background:'#FA3E3E22', borderRadius:4, padding:'1px 5px' }} title={suspended[u.id] !== 'indefinite' ? `Until ${new Date(suspended[u.id]).toLocaleString()}` : 'Until reinstated'}>SUSPENDED{suspended[u.id] !== 'indefinite' ? ` · til ${new Date(suspended[u.id]).toLocaleDateString()}` : ''}</span>}
                          </div>
                        </TD>
                        <TD mono muted style={{ fontSize:11 }}><span onClick={() => openUser(u.id, u.name)} style={{ cursor:'pointer', textDecoration:'underline', textDecorationColor:'#555' }} title="Open profile">{u.id}</span></TD>
                        <TD>{u.listingCount}</TD>
                        <TD>{u.bookingCount}</TD>
                        <TD muted style={{ fontSize:11 }}>{u.joinedAt ? new Date(u.joinedAt).toLocaleDateString() : '—'}</TD>
                        <TD>
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                            <ActionBtn label={expanded ? 'Hide' : 'Details'} variant="primary" solid={expanded} onClick={() => setExpandedUserId(expanded ? null : u.id)}/>
                            {u.id !== ADMIN_ID && (suspended[u.id]
                              ? <ActionBtn label="Reinstate" variant="primary" onClick={() => unsuspendUser(u)}/>
                              : <ActionBtn label="Suspend" variant="warn" onClick={() => suspendUser(u)}/>)}
                            {u.id !== ADMIN_ID && <ActionBtn label="Delete"  variant="danger" onClick={() => deleteUser(u)}/>}
                          </div>
                        </TD>
                      </tr>,
                      expanded ? (
                        <tr key={u.id + '_d'}>
                          <td colSpan={6} style={{ padding:0, background:BG, borderBottom:`2px solid ${G}44` }}>
                            <div style={{ padding:'12px 16px 18px', display:'flex', flexDirection:'column', gap:16 }}>
                              {repAgainst.length > 0 && <div style={{ fontSize:12, fontWeight:700, color:'#FA3E3E', background:'#FA3E3E18', border:'1px solid #FA3E3E44', borderRadius:8, padding:'7px 11px' }}>⚠️ {repAgainst.length} report{repAgainst.length>1?'s':''} filed against this user</div>}
                              <Block title="Listings" count={uListings.length}>
                                {uListings.length === 0 ? <None/> : uListings.map(l => (
                                  <Line key={l.id} left={l.title} right={`$${l.price}${l.listing_type!=='sale'?`/${l.price_unit||'day'}`:''} · ${l.available?'Live':'Hidden'}`}/>
                                ))}
                              </Block>
                              <Block title="Bookings" count={allBookings.length}>
                                {allBookings.length === 0 ? <None/> : allBookings.slice(0,10).map(b => (
                                  <Line key={b.id+b._role} left={b.item_title || 'Booking'} right={`as ${b._role} · ${b.date_str || '—'} · ${b.status}`}/>
                                ))}
                                {allBookings.length > 10 && <div style={{ fontSize:12, color:MU }}>+{allBookings.length-10} more</div>}
                              </Block>
                              <Block title="Reports" count={`${repAgainst.length} against · ${repBy.length} by`}>
                                {repAgainst.length === 0 && repBy.length === 0 ? <None/> : <>
                                  {repAgainst.map(r => <Line key={'a'+r.id} left={`${r.reason} (against)`} right={`by ${userName(r.reporter_id)} · ${r.status}`}/>)}
                                  {repBy.map(r => <Line key={'b'+r.id} left={`${r.reason} (filed by them)`} right={`vs ${userName(r.reported_user_id)} · ${r.status}`}/>)}
                                </>}
                              </Block>
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                  {filteredUsers.length === 0 && <Empty cols={6} msg={q_users ? `No users matching "${q_users}"` : 'No users found'} />}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── LISTINGS ────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom:`1px solid ${BD}` }}>
        <SectionHeader id="listings" label="Listings" badge={stats.listings} />
        {isOpen('listings') && (
          <div>
            <div style={{ padding:'12px 16px' }}>
              <SearchInput value={searches.listings || ""} onChange={e => setQ("listings", e.target.value)} placeholder="Search listings…" />
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  <TH w="22%">Title</TH>
                  <TH>Owner</TH>
                  <TH>Category</TH>
                  <TH>Price</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH>Actions</TH>
                </tr></thead>
                <tbody>
                  {filteredListings.map(l => (
                    <tr key={l.id}>
                      <TD><span style={{ fontWeight:600 }}>{l.title}</span></TD>
                      <TD muted>{l.owner_name || '—'}</TD>
                      <TD style={{ textTransform:'capitalize', color: MU, fontSize:12 }}>{l.category}</TD>
                      <TD style={{ fontWeight:600 }}>${l.price}<span style={{ fontWeight:400, color: MU, fontSize:11 }}>/{l.price_unit||'day'}</span></TD>
                      <TD>
                        {l.available
                          ? <span style={{ color:'#00B894', fontWeight:700, fontSize:12 }}>● Active</span>
                          : <span style={{ color:'#FA3E3E', fontWeight:700, fontSize:12 }}>● Hidden</span>}
                      </TD>
                      <TD muted style={{ fontSize:11 }}>{l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}</TD>
                      <TD>
                        <div style={{ display:'flex', gap:6 }}>
                          <ActionBtn label={l.available ? 'Hide' : 'Unhide'} variant={l.available ? 'warn' : 'default'} onClick={() => toggleListingVisibility(l.id, l.available)}/>
                          <ActionBtn label="Delete" variant="danger" onClick={() => deleteListing(l.id, l.title)}/>
                        </div>
                      </TD>
                    </tr>
                  ))}
                  {filteredListings.length === 0 && <Empty cols={7} msg={q_listings ? `No listings matching "${q_listings}"` : 'No listings found'} />}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── BOOKINGS ────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom:`1px solid ${BD}` }}>
        <SectionHeader id="bookings" label="Bookings" badge={stats.bookings} />
        {isOpen('bookings') && (
          <div>
            <div style={{ padding:'12px 16px', display:'flex', gap:8, flexWrap:'wrap' }}>
              {['all','pending','accepted','cancelled','declined'].map(s => {
                const count = s === 'all' ? bookings.length : bookings.filter(b => b.status === s).length;
                const active = (s === 'all' && !searches.bookings) || searches.bookings === s;
                return (
                  <button key={s} onClick={() => setQ('bookings', s === 'all' ? '' : s)} style={{
                    padding:'5px 12px', borderRadius:20, border:`1px solid ${active ? G : BD}`,
                    background: active ? G : S1, color: active ? '#fff' : MU,
                    fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                  }}>
                    {s.charAt(0).toUpperCase()+s.slice(1)} ({count})
                  </button>
                );
              })}
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  <TH w="18%">Item</TH>
                  <TH>Renter</TH>
                  <TH>Owner</TH>
                  <TH>Dates</TH>
                  <TH>Requested</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </tr></thead>
                <tbody>
                  {filteredBookings.map(b => (
                    <tr key={b.id}>
                      <TD><span style={{ fontWeight:600 }}>{b.item_title}</span></TD>
                      <TD>{b.renter_name}</TD>
                      <TD muted>{b.item_json?.owner || '—'}</TD>
                      <TD muted style={{ fontSize:12 }}>{b.date_str || '—'}</TD>
                      <TD muted style={{ fontSize:11 }}>{b.created_at ? new Date(b.created_at).toLocaleDateString() : '—'}</TD>
                      <TD><StatusBadge status={b.status}/></TD>
                      <TD>
                        {b.status !== 'cancelled' && b.status !== 'declined' && (
                          <ActionBtn label="Cancel" variant="danger" onClick={() => cancelBooking(b.id)}/>
                        )}
                      </TD>
                    </tr>
                  ))}
                  {filteredBookings.length === 0 && <Empty cols={7} msg="No bookings found" />}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── FLAGS (auto-suspension review queue) ────────────────────────────── */}
      <div style={{ borderBottom:`1px solid ${BD}` }}>
        <SectionHeader id="flags" label="Flags" badge={stats.flags} />
        {isOpen('flags') && (
          <div style={{ padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ padding:'12px 0 0', fontSize:12, color:MU, lineHeight:1.5 }}>
              Auto-raised when a user cancels their 3rd committed booking within 120 days — tracked separately for their renter and owner sides. Review the pattern, then suspend or dismiss.
            </div>
            {sortedFlags.map(f => {
              const pending = f.status === 'pending';
              const sm = f.status === 'pending' ? { c:'#FA3E3E', l:'Pending' } : f.status === 'actioned' ? { c:'#00B894', l:'Suspended' } : { c:'#8A8D91', l:'Dismissed' };
              const ev = Array.isArray(f.evidence) ? f.evidence : [];
              return (
                <div key={f.id} style={{ background:S1, border:`1px solid ${pending ? '#FA3E3E55' : BD}`, borderRadius:12, padding:'14px 16px' }}>
                  {/* Top: who + role + status */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700, color:TX, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <span style={{ cursor:'pointer', color:G, textDecoration:'underline', textDecorationColor:G+'66' }} onClick={() => openUser(f.user_id, userName(f.user_id))}>{userName(f.user_id)}</span>
                        <span style={{ background:(f.role==='owner'?'#E87722':'#0984E3')+'22', color:f.role==='owner'?'#E87722':'#0984E3', borderRadius:5, padding:'1px 7px', fontSize:11, fontWeight:700, textTransform:'capitalize' }}>as {f.role}</span>
                      </div>
                      <div style={{ fontSize:12, color:MU, marginTop:3 }}>
                        <strong style={{ color:'#FA3E3E' }}>{f.count}</strong> committed cancellations in {f.window_days} days · flagged {new Date(f.created_at).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})}
                      </div>
                    </div>
                    <span style={{ background:sm.c+'22', color:sm.c, borderRadius:20, padding:'4px 11px', fontSize:11, fontWeight:800, whiteSpace:'nowrap', flexShrink:0 }}>{sm.l}</span>
                  </div>
                  {/* Evidence: the offending bookings */}
                  {ev.length > 0 && (
                    <div style={{ background:BG, border:`1px solid ${BD}`, borderRadius:8, padding:'8px 12px', marginBottom:12, display:'flex', flexDirection:'column', gap:6 }}>
                      {ev.map((e, i) => (
                        <div key={i} style={{ fontSize:12, color:'#D1D1D6', display:'flex', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
                          <span style={{ fontWeight:600, overflowWrap:'anywhere' }}>{e.item || 'Listing'}{e.date_str ? ` · ${e.date_str}` : ''}</span>
                          <span style={{ color:MU, whiteSpace:'nowrap' }}>{e.cancelled_at ? new Date(e.cancelled_at).toLocaleDateString([],{month:'short',day:'numeric'}) : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Actions */}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {pending && <ActionBtn label="⛔ Suspend user" variant="danger" solid onClick={() => suspendFromFlag(f)}/>}
                    <ActionBtn label="View their listings" variant="primary" onClick={() => { setQ('listings', f.user_id); setOpenSections(p => ({ ...p, listings: true, flags: false })); }}/>
                    {pending && <ActionBtn label="Dismiss" onClick={() => updateFlagStatus(f.id,'dismissed')}/>}
                    {!pending && <ActionBtn label="Reopen" onClick={() => updateFlagStatus(f.id,'pending')}/>}
                  </div>
                </div>
              );
            })}
            {flags.length === 0 && <div style={{ padding:'24px 16px', textAlign:'center', color:MU, fontSize:13 }}>No flags — no one has hit the cancellation threshold</div>}
          </div>
        )}
      </div>

      {/* ── REPORTS ─────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom:`1px solid ${BD}` }}>
        <SectionHeader id="reports" label="Reports" badge={stats.reports} />
        {isOpen('reports') && (
          <div>
            <div style={{ padding:'12px 16px', display:'flex', gap:8, flexWrap:'wrap' }}>
              {['all','pending','reviewed','dismissed'].map(f => {
                const active = (f === 'all' && !q_reports) || q_reports === f;
                return (
                  <button key={f} onClick={() => setQ('reports', f === 'all' ? '' : f)} style={{
                    padding:'5px 12px', borderRadius:20, border:`1px solid ${active ? G : BD}`,
                    background: active ? G : S1, color: active ? '#fff' : MU,
                    fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', textTransform:'capitalize',
                  }}>{f}</button>
                );
              })}
            </div>
            <div style={{ padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:12 }}>
              {filteredReports.map(r => {
                const sm = reportStatusMeta(r.status);
                return (
                  <div key={r.id} style={{ background:S1, border:`1px solid ${r.status==='pending' ? '#FA3E3E55' : BD}`, borderRadius:12, padding:'14px 16px' }}>
                    {/* Top: reason + status */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
                      <div>
                        <div style={{ fontSize:15, fontWeight:700, color:TX }}>{r.reason || 'Report'}</div>
                        <div style={{ fontSize:12, color:MU, marginTop:2, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <span style={{ background:G+'22', color:G, borderRadius:5, padding:'1px 7px', fontSize:11, fontWeight:700, textTransform:'capitalize' }}>{r.context}</span>
                          <span>{new Date(r.created_at).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})}</span>
                        </div>
                      </div>
                      <span style={{ background:sm.c+'22', color:sm.c, borderRadius:20, padding:'4px 11px', fontSize:11, fontWeight:800, whiteSpace:'nowrap', flexShrink:0 }}>{sm.l}</span>
                    </div>
                    {/* Who reported whom */}
                    <div style={{ fontSize:13, color:TX, marginBottom:8, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span onClick={() => openUser(r.reporter_id, userName(r.reporter_id))} style={{ fontWeight:600, color:G, cursor:'pointer', textDecoration:'underline', textDecorationColor:G+'66' }}>{userName(r.reporter_id)}</span>
                      <span style={{ color:MU }}>reported</span>
                      <span onClick={() => openUser(r.reported_user_id, userName(r.reported_user_id))} style={{ fontWeight:600, color: r.reported_user_id ? G : MU, cursor: r.reported_user_id ? 'pointer' : 'default', textDecoration: r.reported_user_id ? 'underline' : 'none', textDecorationColor:G+'66' }}>{userName(r.reported_user_id)}</span>
                    </div>
                    {/* Full details */}
                    {r.details && (
                      <div style={{ background:BG, border:`1px solid ${BD}`, borderRadius:8, padding:'10px 12px', fontSize:13, color:'#D1D1D6', lineHeight:1.5, marginBottom:12, whiteSpace:'pre-wrap', overflowWrap:'anywhere' }}>{r.details}</div>
                    )}
                    {/* Actions */}
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {r.status !== 'reviewed' && <ActionBtn label="✓ Mark Reviewed" variant="primary" solid onClick={() => updateReportStatus(r.id,'reviewed')}/>}
                      {r.reported_user_id && <ActionBtn label="View their listings" variant="primary" onClick={() => { setQ('listings', r.reported_user_id); setOpenSections(p => ({ ...p, listings: true, reports: false })); }}/>}
                      {r.status !== 'dismissed' && <ActionBtn label="Dismiss" onClick={() => updateReportStatus(r.id,'dismissed')}/>}
                      {r.status !== 'pending' && <ActionBtn label="Reopen" onClick={() => updateReportStatus(r.id,'pending')}/>}
                    </div>
                  </div>
                );
              })}
              {filteredReports.length === 0 && <div style={{ padding:'24px 16px', textAlign:'center', color:MU, fontSize:13 }}>{reports.length === 0 ? 'No reports submitted yet' : 'No reports in this filter'}</div>}
            </div>
          </div>
        )}
      </div>

      {/* ── ACCESS (owner only) ─────────────────────────────────────────────── */}
      {isOwner && (
        <div style={{ borderBottom:`1px solid ${BD}` }}>
          <SectionHeader id="access" label="Admin Access" badge={adminsList.length + 1} />
          {isOpen('access') && (
            <div style={{ padding:'12px 16px 18px', display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ fontSize:12, color:MU }}>People who can open this admin page. Add someone by the email on their Lendie account.</div>
              {/* Owner */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', background:S1, border:`1px solid ${BD}`, borderRadius:10 }}>
                <div style={{ fontSize:13, color:TX, fontWeight:600 }}>You (owner)</div>
                <span style={{ fontSize:11, fontWeight:700, color:G, background:G+'22', borderRadius:5, padding:'2px 8px' }}>Owner · permanent</span>
              </div>
              {/* Granted admins */}
              {adminsList.map(a => (
                <div key={a.user_id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, padding:'10px 12px', background:S1, border:`1px solid ${BD}`, borderRadius:10 }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, color:TX, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.email || a.user_id}</div>
                    <div style={{ fontSize:11, color:MU }}>Admin · added {a.added_at ? new Date(a.added_at).toLocaleDateString() : ''}</div>
                  </div>
                  <ActionBtn label="Remove" variant="danger" onClick={() => removeAdmin(a)}/>
                </div>
              ))}
              <div><ActionBtn label="+ Add admin" variant="primary" solid onClick={addAdmin}/></div>
            </div>
          )}
        </div>
      )}

      {/* Sign out footer */}
      <div style={{ padding:'20px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontSize:12, color: MU }}>Signed in as <span style={{ color: TX, fontWeight:700 }}>Thomas Haman</span></div>
        <button onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')}
          style={{ padding:'7px 16px', borderRadius:8, border:'1px solid #FA3E3E33', background:'#FA3E3E18', color:'#FA3E3E', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
