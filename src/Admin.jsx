import { useState, useEffect, useCallback } from "react";
import { supabase } from './supabase';

const ADMIN_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';
const G  = '#00B894';
const BG = '#000';
const S1 = '#111';
const BD = '#222';
const TX = '#fff';
const MU = '#888';

export default function AdminPage() {
  const [authed, setAuthed]     = useState(null);
  const [openSections, setOpenSections] = useState({ overview: true });
  const [stats, setStats]       = useState({ users:0, listings:0, bookings:0, messages:0, reviews:0, reports:0 });
  const [users, setUsers]       = useState([]);
  const [listings, setListings] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [reports, setReports]   = useState([]);
  const [searches, setSearches] = useState({});
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
    const [lRes, bRes, mRes, rRes, rpRes] = await Promise.all([
      supabase.from('listings').select('*').order('created_at', { ascending: false }),
      supabase.from('booking_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('messages').select('id'),
      supabase.from('reviews').select('id'),
      supabase.from('reports').select('*').order('created_at', { ascending: false }),
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
    setListings(listingsData);
    setBookings(bookingsData);
    setUsers(usersArr);
    setReports(reportsData);
    setStats({
      users: usersArr.length,
      listings: listingsData.length,
      bookings: bookingsData.length,
      messages: (mRes.data || []).length,
      reviews: (rRes.data || []).length,
      reports: reportsData.filter(r => r.status === 'pending').length,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || user.id !== ADMIN_ID) { window.location.href = '/'; return; }
      setAuthed(true);
      loadAll();
    });
  }, [loadAll]);

  const deleteListing = async (id, title) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('listings').delete().eq('id', id);
    if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
    setListings(prev => prev.filter(l => l.id !== id));
    setStats(s => ({ ...s, listings: s.listings - 1 }));
    showToast('Listing deleted');
  };

  const toggleListingVisibility = async (id, currentlyAvailable) => {
    const next = !currentlyAvailable;
    const { error } = await supabase.from('listings').update({ available: next }).eq('id', id);
    if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
    setListings(prev => prev.map(l => l.id === id ? { ...l, available: next } : l));
    showToast(next ? 'Listing restored to browse' : 'Listing hidden from browse');
  };

  const cancelBooking = async (id) => {
    if (!window.confirm('Cancel this booking request?')) return;
    const { error } = await supabase.from('booking_requests').update({ status: 'cancelled' }).eq('id', id);
    if (error) { showToast('Cancel failed: ' + error.message, 'error'); return; }
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b));
    showToast('Booking cancelled');
  };

  const suspendUser = async (userId, name) => {
    if (!window.confirm(`Suspend ${name}? This will cancel all their pending requests.`)) return;
    const pending = bookings.filter(b => (b.renter_id === userId || b.owner_id === userId) && b.status === 'pending');
    const results = await Promise.all(pending.map(b => supabase.from('booking_requests').update({ status: 'cancelled' }).eq('id', b.id)));
    const failed = results.filter(r => r.error).length;
    if (failed > 0) { showToast(`${failed} cancel(s) failed`, 'error'); return; }
    setBookings(prev => prev.map(b =>
      (b.renter_id === userId || b.owner_id === userId) && b.status === 'pending' ? { ...b, status: 'cancelled' } : b
    ));
    showToast(`${name} suspended — ${pending.length} pending request(s) cancelled`);
  };

  const deleteUser = () => showToast('User deletion requires the Supabase dashboard (auth.users is not accessible via anon key)', 'error');

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

  const ActionBtn = ({ label, variant='default', onClick }) => {
    const c = variant === 'danger' ? '#FA3E3E' : variant === 'warn' ? '#E87722' : TX;
    return (
      <button onClick={onClick} style={{ padding:'4px 11px', borderRadius:6, border:`1px solid ${c}33`, background: c+'18', color: c, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
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

  const SearchInput = ({ sectionId, placeholder }) => (
    <input
      value={searches[sectionId] || ''}
      onChange={e => setQ(sectionId, e.target.value)}
      placeholder={placeholder}
      style={{ width:'100%', padding:'10px 14px', background: S1, border:`1px solid ${BD}`, borderRadius:8, color: TX, fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }}
    />
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
  const userName = (id) => (users.find(u => u.id === id)?.name) || (id ? id.slice(0, 8) + '…' : '—');
  const reportStatusMeta = (s) => s === 'pending' ? { c:'#FA3E3E', l:'Pending' } : s === 'reviewed' ? { c:'#00B894', l:'Reviewed' } : { c:'#8A8D91', l: s === 'dismissed' ? 'Dismissed' : (s || 'Unknown') };

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
              <SearchInput sectionId="users" placeholder="Search users…" />
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
                  {filteredUsers.map(u => (
                    <tr key={u.id} style={{ background: u.id === ADMIN_ID ? G+'0A' : 'transparent' }}>
                      <TD>
                        <div style={{ fontWeight:600 }}>{u.name}
                          {u.id === ADMIN_ID && <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:G, background: G+'22', borderRadius:4, padding:'1px 5px' }}>YOU</span>}
                        </div>
                      </TD>
                      <TD mono muted style={{ fontSize:11 }}>{u.id}</TD>
                      <TD>{u.listingCount}</TD>
                      <TD>{u.bookingCount}</TD>
                      <TD muted style={{ fontSize:11 }}>{u.joinedAt ? new Date(u.joinedAt).toLocaleDateString() : '—'}</TD>
                      <TD>
                        {u.id !== ADMIN_ID && (
                          <div style={{ display:'flex', gap:6 }}>
                            <ActionBtn label="Suspend" variant="warn" onClick={() => suspendUser(u.id, u.name)}/>
                            <ActionBtn label="Delete"  variant="danger" onClick={deleteUser}/>
                          </div>
                        )}
                      </TD>
                    </tr>
                  ))}
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
              <SearchInput sectionId="listings" placeholder="Search listings…" />
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
                      <span style={{ fontWeight:600 }}>{userName(r.reporter_id)}</span>
                      <span style={{ color:MU }}>reported</span>
                      <span style={{ fontWeight:600 }}>{userName(r.reported_user_id)}</span>
                    </div>
                    {/* Full details */}
                    {r.details && (
                      <div style={{ background:BG, border:`1px solid ${BD}`, borderRadius:8, padding:'10px 12px', fontSize:13, color:'#D1D1D6', lineHeight:1.5, marginBottom:12, whiteSpace:'pre-wrap', overflowWrap:'anywhere' }}>{r.details}</div>
                    )}
                    {/* Actions */}
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {r.status !== 'reviewed' && <ActionBtn label="✓ Mark Reviewed" onClick={() => updateReportStatus(r.id,'reviewed')}/>}
                      {r.status !== 'dismissed' && <ActionBtn label="Dismiss" variant="warn" onClick={() => updateReportStatus(r.id,'dismissed')}/>}
                      {r.reported_user_id && <ActionBtn label="View their listings" onClick={() => { setQ('listings', r.reported_user_id); setOpenSections(p => ({ ...p, listings: true, reports: false })); }}/>}
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
