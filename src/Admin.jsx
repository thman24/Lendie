import { useState, useEffect, useCallback } from "react";
import { supabase } from './supabase';

const ADMIN_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';
const G = '#00B894';

export default function AdminPage() {
  const [authed, setAuthed]     = useState(null); // null=loading, false=denied, true=ok
  const [section, setSection]   = useState('overview');
  const [stats, setStats]       = useState({ users:0, listings:0, bookings:0, messages:0, reviews:0 });
  const [users, setUsers]       = useState([]);
  const [listings, setListings] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [search, setSearch]     = useState('');
  const [toast, setToast]       = useState(null);
  const [loading, setLoading]   = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [lRes, bRes, mRes, rRes] = await Promise.all([
      supabase.from('listings').select('*').order('created_at', { ascending: false }),
      supabase.from('booking_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('messages').select('id'),
      supabase.from('reviews').select('id'),
    ]);

    const listingsData = lRes.data || [];
    const bookingsData = bRes.data || [];

    // Aggregate unique users from booking_requests (renter + owner sides)
    const usersMap = {};
    bookingsData.forEach(r => {
      if (r.renter_id) {
        if (!usersMap[r.renter_id]) {
          usersMap[r.renter_id] = { id: r.renter_id, name: r.renter_name || 'Unknown', listingCount: 0, bookingCount: 0, joinedAt: r.created_at };
        }
        usersMap[r.renter_id].bookingCount++;
      }
      if (r.owner_id && !usersMap[r.owner_id]) {
        usersMap[r.owner_id] = { id: r.owner_id, name: r.item_json?.owner || 'Unknown Owner', listingCount: 0, bookingCount: 0, joinedAt: r.created_at };
      }
    });
    listingsData.forEach(l => {
      if (!l.user_id) return;
      if (!usersMap[l.user_id]) {
        usersMap[l.user_id] = { id: l.user_id, name: l.owner_name || 'Unknown', listingCount: 0, bookingCount: 0, joinedAt: l.created_at };
      }
      usersMap[l.user_id].listingCount++;
    });

    const usersArr = Object.values(usersMap).sort((a, b) => a.name.localeCompare(b.name));

    setListings(listingsData);
    setBookings(bookingsData);
    setUsers(usersArr);
    setStats({
      users: usersArr.length,
      listings: listingsData.length,
      bookings: bookingsData.length,
      messages: (mRes.data || []).length,
      reviews: (rRes.data || []).length,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || user.id !== ADMIN_ID) {
        window.location.href = '/';
        return;
      }
      setAuthed(true);
      loadAll();
    });
  }, [loadAll]);

  // ─── Actions ───────────────────────────────────────────────────────────────

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
    const promises = pending.map(b => supabase.from('booking_requests').update({ status: 'cancelled' }).eq('id', b.id));
    const results = await Promise.all(promises);
    const failed = results.filter(r => r.error).length;
    if (failed > 0) { showToast(`${failed} cancel(s) failed`, 'error'); return; }
    setBookings(prev => prev.map(b =>
      (b.renter_id === userId || b.owner_id === userId) && b.status === 'pending'
        ? { ...b, status: 'cancelled' } : b
    ));
    showToast(`${name} suspended — ${pending.length} pending request(s) cancelled`);
  };

  const deleteUser = () => showToast('User deletion requires the Supabase dashboard (auth.users is not accessible via anon key)', 'error');

  // ─── Loading / auth guard ─────────────────────────────────────────────────

  if (authed === null) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'system-ui, sans-serif', color:'#65676B', fontSize:14 }}>
        Authenticating…
      </div>
    );
  }

  // ─── Shared sub-components (defined here so they close over state) ─────────

  const NAV = [
    { id:'overview', label:'Overview' },
    { id:'users',    label:'Users',    count: stats.users },
    { id:'listings', label:'Listings', count: stats.listings },
    { id:'bookings', label:'Bookings', count: stats.bookings },
    { id:'reports',  label:'Reports' },
  ];

  const q = search.toLowerCase().trim();
  const filteredUsers    = users.filter(u    => !q || u.name.toLowerCase().includes(q) || u.id.includes(q));
  const filteredListings = listings.filter(l => !q || l.title?.toLowerCase().includes(q) || l.owner_name?.toLowerCase().includes(q) || l.category?.toLowerCase().includes(q));
  const filteredBookings = bookings.filter(b => !q || b.renter_name?.toLowerCase().includes(q) || b.item_title?.toLowerCase().includes(q) || (b.item_json?.owner||'').toLowerCase().includes(q));

  const STATUS_COLORS = { pending:'#E87722', accepted:'#31A24C', declined:'#FA3E3E', cancelled:'#8A8D91', completed:'#1C1E21' };

  const StatusBadge = ({ status }) => (
    <span style={{ background:(STATUS_COLORS[status]||'#8A8D91')+'1A', color: STATUS_COLORS[status]||'#8A8D91', borderRadius:20, padding:'3px 9px', fontSize:11, fontWeight:700, display:'inline-block' }}>
      {status}
    </span>
  );

  const ActionBtn = ({ label, variant='default', onClick }) => {
    const styles = {
      default: { color:'#1C1E21', border:'1px solid #E4E6EB', bg:'#fff' },
      danger:  { color:'#FA3E3E', border:'1px solid #FA3E3E', bg:'#fff' },
      warn:    { color:'#E87722', border:'1px solid #E87722', bg:'#fff' },
    }[variant];
    return (
      <button onClick={onClick} style={{ padding:'4px 11px', borderRadius:6, border: styles.border, background: styles.bg, color: styles.color, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
        {label}
      </button>
    );
  };

  const TH = ({ children, w }) => (
    <th style={{ padding:'10px 14px', textAlign:'left', fontSize:10, fontWeight:700, color:'#8A8D91', textTransform:'uppercase', letterSpacing:0.7, whiteSpace:'nowrap', background:'#FAFAFA', borderBottom:'1px solid #E4E6EB', width: w }}>
      {children}
    </th>
  );

  const TD = ({ children, muted, mono, style: sx }) => (
    <td style={{ padding:'11px 14px', fontSize:13, color: muted ? '#8A8D91' : '#1C1E21', borderBottom:'1px solid #F5F5F5', verticalAlign:'middle', fontFamily: mono ? 'monospace' : 'inherit', ...sx }}>
      {children}
    </td>
  );

  const StatCard = ({ label, value, sub }) => (
    <div style={{ flex:1, minWidth:140, background:'#fff', borderRadius:12, border:'1px solid #E4E6EB', padding:'18px 22px' }}>
      <div style={{ fontSize:30, fontWeight:800, color: G, lineHeight:1 }}>{loading ? '…' : value}</div>
      <div style={{ fontSize:12, fontWeight:600, color:'#65676B', marginTop:6 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:'#8A8D91', marginTop:2 }}>{sub}</div>}
    </div>
  );

  const EmptyRow = ({ cols, message }) => (
    <tr><td colSpan={cols} style={{ padding:'40px 14px', textAlign:'center', color:'#8A8D91', fontSize:13 }}>{message}</td></tr>
  );

  const tableStyle = { width:'100%', borderCollapse:'collapse' };
  const tableWrap  = { background:'#fff', borderRadius:12, border:'1px solid #E4E6EB', overflow:'hidden' };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#F7F8FA', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside style={{ width:210, background:'#fff', borderRight:'1px solid #E4E6EB', display:'flex', flexDirection:'column', flexShrink:0, position:'sticky', top:0, height:'100vh' }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid #E4E6EB' }}>
          <a href="/" style={{ textDecoration:'none', display:'block' }}>
            <div style={{ fontSize:20, fontWeight:900, color:G, letterSpacing:-0.5 }}>Lendie</div>
            <div style={{ fontSize:10, color:'#8A8D91', marginTop:2, fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>Admin Dashboard</div>
          </a>
        </div>

        <nav style={{ padding:'10px 10px', flex:1 }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => { setSection(n.id); setSearch(''); }} style={{
              width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'9px 12px', borderRadius:8, border:'none', textAlign:'left', marginBottom:2,
              background: section === n.id ? G + '18' : 'transparent',
              color:      section === n.id ? G : '#65676B',
              fontWeight: section === n.id ? 700 : 500,
              fontSize:14, cursor:'pointer', fontFamily:'inherit', transition:'background 0.12s',
            }}>
              <span>{n.label}</span>
              {n.count > 0 && (
                <span style={{
                  background: section === n.id ? G : '#E4E6EB',
                  color:      section === n.id ? '#fff' : '#8A8D91',
                  borderRadius:20, padding:'1px 7px', fontSize:11, fontWeight:700, minWidth:22, textAlign:'center',
                }}>
                  {n.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding:'14px 20px', borderTop:'1px solid #E4E6EB' }}>
          <div style={{ fontSize:11, color:'#8A8D91', marginBottom:2 }}>Signed in as</div>
          <div style={{ fontSize:12, fontWeight:700, color:'#1C1E21' }}>Thomas Haman</div>
          <button onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')}
            style={{ marginTop:10, width:'100%', padding:'7px 0', borderRadius:8, border:'1px solid #E4E6EB', background:'#fff', color:'#FA3E3E', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main style={{ flex:1, padding:'28px 32px', overflowX:'auto', minWidth:0 }}>

        {/* Header row */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
          <h1 style={{ margin:0, fontSize:20, fontWeight:800, color:'#1C1E21', textTransform:'capitalize' }}>
            {section}
          </h1>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            {section !== 'overview' && section !== 'reports' && (
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${section}…`}
                style={{ padding:'8px 14px', borderRadius:8, border:'1px solid #E4E6EB', fontSize:13, outline:'none', width:220, fontFamily:'inherit', background:'#fff' }}
              />
            )}
            <button onClick={loadAll} style={{ padding:'8px 14px', borderRadius:8, border:'1px solid #E4E6EB', background:'#fff', color:'#65676B', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              ↺ Refresh
            </button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{ position:'fixed', top:20, right:24, background: toast.type === 'error' ? '#FA3E3E' : G, color:'#fff', padding:'11px 18px', borderRadius:10, fontSize:13, fontWeight:600, zIndex:9999, boxShadow:'0 4px 20px rgba(0,0,0,0.18)', maxWidth:400 }}>
            {toast.msg}
          </div>
        )}

        {/* ── OVERVIEW ────────────────────────────────────────────────── */}
        {section === 'overview' && (
          <div>
            <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:28 }}>
              <StatCard label="Users"            value={stats.users}    sub="unique from bookings & listings"/>
              <StatCard label="Listings"         value={stats.listings} sub="in database"/>
              <StatCard label="Booking Requests" value={stats.bookings} sub="all time"/>
              <StatCard label="Messages"         value={stats.messages} sub="in database"/>
              <StatCard label="Reviews"          value={stats.reviews}  sub="submitted"/>
            </div>

            <div style={tableWrap}>
              <div style={{ padding:'16px 20px', borderBottom:'1px solid #E4E6EB', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ fontWeight:700, fontSize:14, color:'#1C1E21' }}>Recent Booking Requests</div>
                <button onClick={() => setSection('bookings')} style={{ background:'none', border:'none', color:G, fontWeight:700, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>View all →</button>
              </div>
              <table style={tableStyle}>
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
                  {bookings.length === 0 && <EmptyRow cols={5} message="No booking requests yet"/>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── USERS ───────────────────────────────────────────────────── */}
        {section === 'users' && (
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead><tr>
                <TH w="25%">Name</TH>
                <TH w="35%">User ID</TH>
                <TH>Listings</TH>
                <TH>Bookings</TH>
                <TH>First Seen</TH>
                <TH>Actions</TH>
              </tr></thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id} style={{ background: u.id === ADMIN_ID ? G + '08' : 'transparent' }}>
                    <TD>
                      <div style={{ fontWeight:600 }}>{u.name}
                        {u.id === ADMIN_ID && <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:G, background: G+'18', borderRadius:4, padding:'1px 5px' }}>YOU</span>}
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
                {filteredUsers.length === 0 && <EmptyRow cols={6} message={q ? `No users matching "${q}"` : 'No users found — booking_requests table may be empty'}/>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── LISTINGS ────────────────────────────────────────────────── */}
        {section === 'listings' && (
          <div style={tableWrap}>
            <table style={tableStyle}>
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
                    <TD style={{ textTransform:'capitalize', color:'#65676B', fontSize:12 }}>{l.category}</TD>
                    <TD style={{ fontWeight:600 }}>${l.price}<span style={{ fontWeight:400, color:'#8A8D91', fontSize:11 }}>/{l.price_unit||'day'}</span></TD>
                    <TD>
                      {l.available
                        ? <span style={{ color:'#31A24C', fontWeight:700, fontSize:12 }}>● Active</span>
                        : <span style={{ color:'#FA3E3E', fontWeight:700, fontSize:12 }}>● Hidden</span>}
                    </TD>
                    <TD muted style={{ fontSize:11 }}>{l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}</TD>
                    <TD>
                      <div style={{ display:'flex', gap:6 }}>
                        <ActionBtn
                          label={l.available ? 'Hide' : 'Unhide'}
                          variant={l.available ? 'warn' : 'default'}
                          onClick={() => toggleListingVisibility(l.id, l.available)}
                        />
                        <ActionBtn label="Delete" variant="danger" onClick={() => deleteListing(l.id, l.title)}/>
                      </div>
                    </TD>
                  </tr>
                ))}
                {filteredListings.length === 0 && (
                  <EmptyRow cols={7} message={
                    q ? `No listings matching "${q}"`
                      : 'No listings in the database. Listings created through the app will appear here.'
                  }/>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── BOOKINGS ────────────────────────────────────────────────── */}
        {section === 'bookings' && (
          <div>
            {/* Status filter pills */}
            <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
              {['all','pending','accepted','cancelled','declined'].map(s => {
                const count = s === 'all' ? bookings.length : bookings.filter(b => b.status === s).length;
                return (
                  <button key={s} onClick={() => setSearch(s === 'all' ? '' : s)} style={{
                    padding:'5px 12px', borderRadius:20, border:'1px solid #E4E6EB', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:600,
                    background: (q === s || (s === 'all' && !q)) ? G : '#fff',
                    color:      (q === s || (s === 'all' && !q)) ? '#fff' : '#65676B',
                  }}>
                    {s.charAt(0).toUpperCase()+s.slice(1)} ({count})
                  </button>
                );
              })}
            </div>

            <div style={tableWrap}>
              <table style={tableStyle}>
                <thead><tr>
                  <TH w="20%">Item</TH>
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
                  {filteredBookings.length === 0 && <EmptyRow cols={7} message={q ? `No bookings matching "${q}"` : 'No booking requests found'}/>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── REPORTS ─────────────────────────────────────────────────── */}
        {section === 'reports' && (
          <div>
            <div style={{ background:'#FFF7ED', border:'1px solid #FFE0B2', borderRadius:10, padding:'12px 16px', marginBottom:20, fontSize:13, color:'#E87722', fontWeight:600 }}>
              Reports feature not yet built. This table is ready to populate when users can submit reports.
            </div>
            <div style={tableWrap}>
              <table style={tableStyle}>
                <thead><tr>
                  <TH>Reporter</TH>
                  <TH>Reported User</TH>
                  <TH>Reported Listing</TH>
                  <TH>Reason</TH>
                  <TH>Date</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </tr></thead>
                <tbody>
                  <EmptyRow cols={7} message="No reports submitted yet."/>
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
