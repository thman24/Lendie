import { useState, useRef, useEffect } from "react";
import { supabase } from './supabase';

async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Geocoding request failed");
  const data = await res.json();
  if (!data.length) throw new Error("Address not found");
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const MAPS_API_KEY = 'AIzaSyB7lXQCgUs0NWHWX-8SScOfqY0MIq1y3EM';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function sendPushToUser(userId, { title, body, url, tag }) {
  if (!userId || userId === 'me') return;
  try {
    await fetch(`${SUPABASE_FUNCTIONS_URL}/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ userId, title, body, url, tag }),
    });
  } catch (e) {
    console.warn('[Push] send failed:', e.message);
  }
}

function PlacesAutocompleteInput({ placeholder, containerStyle, inputStyle, onAddressChange, onPlaceSelect }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef(null);

  const fetchSuggestions = async (input) => {
    if (!input.trim() || input.length < 2) { setSuggestions([]); return; }
    setFetching(true);
    try {
      const body = { input };
      console.log("[PlacesAC] POST autocomplete | key present:", !!MAPS_API_KEY, "| body:", body);
      const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": MAPS_API_KEY },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      console.log("[PlacesAC] response status:", res.status, "| body:", data);
      if (data.error) { console.error("[PlacesAC] autocomplete error:", data.error.message); setSuggestions([]); }
      else setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error("[PlacesAC] fetch error:", err);
      setSuggestions([]);
    }
    setFetching(false);
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    setOpen(true);
    onAddressChange(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 350);
  };

  const handleSelect = async (suggestion) => {
    const pred = suggestion.placePrediction;
    const displayText = pred.text?.text || pred.structuredFormat?.mainText?.text || "";
    setValue(displayText);
    setSuggestions([]);
    setOpen(false);
    onAddressChange(displayText);
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${pred.placeId}`, {
        headers: { "X-Goog-Api-Key": MAPS_API_KEY, "X-Goog-FieldMask": "formattedAddress,location" },
      });
      const data = await res.json();
      if (data.error) { console.error("[PlacesAC] details error:", data.error.message); return; }
      const lat = data.location?.latitude;
      const lng = data.location?.longitude;
      const addr = data.formattedAddress || displayText;
      console.log("[PlacesAC] details response:", { addr, lat, lng, raw: data });
      setValue(addr);
      onAddressChange(addr);
      console.log("[PlacesAC] called onAddressChange (resets lat/lng in parent)");
      if (lat != null && lng != null) {
        console.log("[PlacesAC] calling onPlaceSelect with:", { lat, lng });
        onPlaceSelect({ lat, lng });
      } else {
        console.error("[PlacesAC] no coordinates in response — location:", data.location);
      }
    } catch (err) {
      console.error("[PlacesAC] details fetch error:", err);
    }
  };

  const baseInputStyle = {
    width: "100%", padding: "11px 13px", borderRadius: 8,
    border: "1.5px solid #CDD0D4", background: "#F0F2F5",
    fontFamily: "inherit", fontSize: 14, outline: "none",
    boxSizing: "border-box", color: "#1C1E21",
  };

  return (
    <div style={{ position: "relative", ...containerStyle }}>
      <input
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        style={inputStyle || baseInputStyle}
        autoComplete="off"
      />
      {fetching && (
        <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:12, color:"#65676B", pointerEvents:"none" }}>…</div>
      )}
      {open && suggestions.length > 0 && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#fff", border:"1px solid #E4E6EB", borderRadius:8, zIndex:9999, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", maxHeight:220, overflowY:"auto", marginTop:4 }}>
          {suggestions.map((s, i) => {
            const pred = s.placePrediction;
            const main = pred.structuredFormat?.mainText?.text || pred.text?.text || "";
            const secondary = pred.structuredFormat?.secondaryText?.text || "";
            return (
              <div key={pred.placeId || i} onMouseDown={() => handleSelect(s)}
                style={{ padding:"10px 14px", cursor:"pointer", borderBottom: i < suggestions.length-1 ? "1px solid #F0F2F5" : "none", fontSize:13 }}>
                <div style={{ fontWeight:600, color:"#1C1E21" }}>{main}</div>
                {secondary && <div style={{ fontSize:11, color:"#65676B", marginTop:2 }}>{secondary}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- OWNERS -------------------------------------------------------------------
const OWNERS = {};


// ---------------------------------------------------------------
// DATA
// ---------------------------------------------------------------

const ALL_CATEGORIES = [
  { id:"all",          label:"All",          emoji:"-" },
  { id:"tools",        label:"Tools",        emoji:"🔧" },
  { id:"trailers",     label:"Trailers",     emoji:"🚛" },
  { id:"construction", label:"Equipment",    emoji:"🏗️" },
  { id:"kitchen",      label:"Kitchen",      emoji:"🍳" },
  { id:"garden",       label:"Garden",       emoji:"🌱" },
  { id:"outdoors",     label:"Outdoors",     emoji:"🏕️" },
  { id:"venues",       label:"Venues",       emoji:"🏛️" },
  { id:"party",        label:"Party",        emoji:"🎉" },
  { id:"tech",         label:"Tech",         emoji:"💻" },
];


const SEED_MESSAGES = [];


// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------


// Helper functions
function getDatesInRange(start, end) {
  if (!start || !end) return [];
  const dates = [];
  const d = new Date(start);
  const e = new Date(end);
  while (d <= e) {
    dates.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return dates;
}
function daysBetween(a, b) {
  if (!a) return 1;
  const d1 = new Date(a), d2 = new Date(b || a);
  return Math.max(1, Math.round((d2-d1)/(1000*60*60*24))+1);
}
function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d+'T00:00:00');
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[dt.getMonth()] + ' ' + dt.getDate();
}

// Toast
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background: toast.type==="error"?"#FA3E3E":"#00B894", color:"#fff", borderRadius:12, padding:"11px 20px", fontSize:13, fontWeight:700, zIndex:9999, boxShadow:"0 4px 20px rgba(0,0,0,0.2)", whiteSpace:"nowrap" }}>
      {toast.msg}
    </div>
  );
}

// StarRow
function StarRow({ rating, count, size=13 }) {
  if (!rating) return null;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
      {[1,2,3,4,5].map(s => <span key={s} style={{ color:s<=Math.round(rating)?"#F5A623":"#CDD0D4", fontSize:size }}>&#9733;</span>)}
      <span style={{ fontSize:size, color:"#65676B" }}>{rating} ({count})</span>
    </div>
  );
}

// RangeCalendar
function RangeCalendar({ booked=[], startDate, endDate, onRangeChange }) {
  const today = new Date(2026, 5, 2);
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const dim = new Date(year, month+1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const cells = [];
  for (let i=0; i<firstDay; i++) cells.push(null);
  for (let d=1; d<=dim; d++) cells.push(d);
  const pad = n => String(n).padStart(2,"0");
  const toKey = d => year + "-" + pad(month+1) + "-" + pad(d);
  const isPast = d => new Date(year, month, d) < today;
  const isBooked = d => booked.includes(toKey(d));
  const isStart = d => toKey(d) === startDate;
  const isEnd = d => toKey(d) === endDate;
  const inRange = d => {
    if (!startDate || !endDate) return false;
    const k = toKey(d);
    return k > startDate && k < endDate;
  };
  const handleDay = (e, d) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPast(d) || isBooked(d)) return;
    const scrollEl = e.currentTarget.closest('[style*="overflow"]');
    const savedTop = scrollEl ? scrollEl.scrollTop : 0;
    const k = toKey(d);
    if (!startDate || (startDate && endDate)) {
      onRangeChange(k, null);
    } else {
      if (k < startDate) onRangeChange(k, startDate);
      else onRangeChange(startDate, k);
    }
    if (scrollEl) requestAnimationFrame(() => { scrollEl.scrollTop = savedTop; });
  };
  return (
    <div style={{ background:"#F7F8FA", borderRadius:14, padding:14, border:"1px solid #E4E6EB", marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }} style={{ background:"#E4E6EB", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>&#8249;</button>
        <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>{MONTHS[month]} {year}</div>
        <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }} style={{ background:"#E4E6EB", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>&#8250;</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, textAlign:"center" }}>
        {DAYS.map(d => <div key={d} style={{ fontSize:10, color:"#8A8D91", fontWeight:700, paddingBottom:6 }}>{d}</div>)}
        {cells.map((d,i) => {
          if (!d) return <div key={i} />;
          const past=isPast(d), bkd=isBooked(d), s=isStart(d), en=isEnd(d), rng=inRange(d);
          return (
            <div key={i} onMouseDown={e=>e.preventDefault()} onClick={e=>handleDay(e,d)}
              title={bkd?"Already booked":undefined}
              style={{ borderRadius: s?"8px 0 0 8px": en?"0 8px 8px 0": rng?"0":"8px", padding:"7px 2px 5px", fontSize:12, fontWeight:(s||en)?700:500, cursor:past||bkd?"not-allowed":"pointer", background: s||en?"#00B894": rng?"#E8FBF6": bkd?"#DC2626":"transparent", color: s||en?"#fff": bkd?"#fff": past?"#CDD0D4":"#1C1E21", opacity:past?0.35:1, userSelect:"none", position:"relative", textDecoration:bkd?"line-through":"none" }}>
              {d}
              {bkd && <div style={{ fontSize:7, fontWeight:700, letterSpacing:0, lineHeight:1, marginTop:1, opacity:0.85 }}>BOOKED</div>}
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:12, marginTop:12, fontSize:11, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#00B894" }}/><span style={{ color:"#65676B" }}>Selected</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#E8FBF6", border:"1px solid #B2EFE3" }}/><span style={{ color:"#65676B" }}>Range</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#DC2626" }}/><span style={{ color:"#65676B" }}>Booked</span></div>
      </div>
    </div>
  );
}


// PhotoBrowserModal
function PhotoBrowserModal({ data, onClose }) {
  const [idx, setIdx] = useState(data ? (data.startIdx || 0) : 0);
  if (!data) return null;
  const all = [...(data.uploadedImages||[]).map(i=>({ t:"img", s:i.url })), ...(data.photos||[]).map(p=>({ t:"emoji", s:p }))];
  if (!all.length) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:900, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:16, overflow:"hidden", border:"1px solid #E4E6EB", maxWidth:380, width:"92%" }} onClick={e=>e.stopPropagation()}>
        <div style={{ height:280, display:"flex", alignItems:"center", justifyContent:"center", background:"#F0F2F5", position:"relative" }}>
          {all[idx].t==="img"
            ? <img src={all[idx].s} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
            : <span style={{ fontSize:80 }}>{all[idx].s}</span>}
          {all.length > 1 && (
            <div style={{ position:"absolute", bottom:10, left:0, right:0, display:"flex", justifyContent:"center", gap:6 }}>
              {all.map((_,i) => <div key={i} onClick={e=>{e.stopPropagation();setIdx(i);}} style={{ width:i===idx?20:8, height:8, borderRadius:4, background:i===idx?"#00B894":"rgba(255,255,255,0.6)", cursor:"pointer", transition:"all 0.2s" }}/>)}
            </div>
          )}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px" }}>
          <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.max(0,i-1));}} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, color:"#1C1E21" }} disabled={idx===0}>&larr;</button>
          <span style={{ fontSize:12, color:"#65676B", alignSelf:"center" }}>{idx+1} / {all.length}</span>
          <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.min(all.length-1,i+1));}} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, color:"#1C1E21" }} disabled={idx===all.length-1}>&rarr;</button>
        </div>
      </div>
    </div>
  );
}

// OwnerProfileModal
function OwnerProfileModal({ ownerId, allItems, onClose, onSelectItem, onMessage }) {
  if (!ownerId) return null;
  const owner = OWNERS[ownerId];
  if (!owner) return null;
  const owned = allItems.filter(i => i.ownerId === ownerId);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:700, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxHeight:"90dvh", overflowY:"auto", borderTop:"1px solid #E4E6EB" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <button onClick={onClose} style={{ background:"#F0F2F5", border:"none", borderRadius:10, width:34, height:34, cursor:"pointer", fontSize:18, color:"#65676B" }}>&larr;</button>
          <div style={{ fontSize:14, fontWeight:700, color:"#65676B" }}>Owner Profile</div>
          <div style={{ width:34 }}/>
        </div>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:60, marginBottom:8 }}>{owner.avatar}</div>
          <div style={{ fontSize:20, fontWeight:800, color:"#1C1E21" }}>{owner.name}</div>
          <div style={{ fontSize:12, color:"#65676B", marginBottom:6 }}>Member since {owner.joined}</div>
          <StarRow rating={owner.rating} count={owner.reviews} size={14}/>
          <div style={{ display:"flex", gap:6, justifyContent:"center", marginTop:10 }}>
            {owner.verified && <div style={{ background:"#E9F5E9", borderRadius:20, padding:"4px 10px", fontSize:11, color:"#31A24C", fontWeight:700 }}>Verified</div>}
            {owner.superhost && <div style={{ background:"#FFF8E1", borderRadius:20, padding:"4px 10px", fontSize:11, color:"#E87722", fontWeight:700 }}>Superhost</div>}
          </div>
        </div>
        <div style={{ background:"#F7F8FA", borderRadius:12, padding:"12px 14px", marginBottom:16, border:"1px solid #E4E6EB" }}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:6, color:"#1C1E21" }}>About</div>
          <div style={{ fontSize:13, color:"#65676B", lineHeight:1.6 }}>{owner.bio}</div>
        </div>
        <div style={{ fontWeight:700, fontSize:14, marginBottom:10, color:"#1C1E21" }}>{owner.name.split(" ")[0]}&#39;s Listings ({owned.length})</div>
        {owned.length === 0 && <div style={{ textAlign:"center", padding:20, color:"#65676B" }}>No listings</div>}
        {owned.map(item => (
          <div key={item.id} onClick={()=>{ onSelectItem(item); onClose(); }} style={{ display:"flex", gap:12, background:"#fff", borderRadius:12, border:"1px solid #E4E6EB", padding:"12px 14px", marginBottom:10, cursor:"pointer", alignItems:"center" }}>
            <div style={{ fontSize:28, minWidth:48, textAlign:"center", background:(item.color||"#eee")+"15", borderRadius:10, padding:"8px 0" }}>{item.emoji}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:13, color:"#1C1E21" }}>{item.title}</div>
              <div style={{ fontSize:11, color:"#65676B" }}>{item.category} &middot; {item.distance}mi</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#1C1E21" }}>${item.price}</div>
              <div style={{ fontSize:10, color:"#65676B" }}>/{item.priceUnit||"day"}</div>
            </div>
          </div>
        ))}
        <button onClick={()=>onMessage(owner)} style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginTop:10 }}>
          Message {owner.name.split(" ")[0]}
        </button>
        <button onClick={onClose} style={{ width:"100%", padding:"12px", borderRadius:8, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21", marginTop:8 }}>Close</button>
      </div>
    </div>
  );
}

// ItemDetailSheet - top-level component so hooks work correctly
function ItemDetailSheet({ item, requestSent, favorites, toggleFav, allItems, OWNERS, setOwnerProfileId, setPhotoBrowser, onDismiss, setPaymentModal, setPaymentStep, onConfirmBooking }) {
  const C = { muted:"#65676B", faint:"#8A8D91" };
  const CAT_MAP = { tools:"Tools", trailers:"Trailers", construction:"Equipment", kitchen:"Kitchen", garden:"Garden", outdoors:"Outdoors", venues:"Venues", party:"Party", tech:"Tech" };
  const sheetRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  useEffect(() => {
    setStartDate(null);
    setEndDate(null);
    setDragY(0);
    setDragX(0);
    setDragging(false);
  }, [item && item.id]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let sx=0, sy=0, sTop=0;
    const onStart = e => { sx=e.touches[0].clientX; sy=e.touches[0].clientY; sTop=el.scrollTop||0; setDragging(false); };
    const onMove = e => {
      const dy=e.touches[0].clientY-sy, dx=e.touches[0].clientX-sx;
      const atTop=sTop<=2;
      const goDown=atTop&&dy>8&&Math.abs(dy)>Math.abs(dx)*1.2;
      const goRight=dx>8&&Math.abs(dx)>Math.abs(dy)*1.2;
      if (goDown||goRight) {
        e.preventDefault();
        setDragging(true);
        setDragY(goDown?Math.max(0,dy):0);
        setDragX(goRight?Math.max(0,dx):0);
      }
    };
    const onEnd = () => {
      if (dragY>100||dragX>100) onDismiss();
      else { setDragY(0); setDragX(0); }
      setDragging(false);
    };
    el.addEventListener("touchstart", onStart, { passive:true });
    el.addEventListener("touchmove", onMove, { passive:false });
    el.addEventListener("touchend", onEnd, { passive:true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [item && item.id, dragY, dragX]);

  if (!item) return null;

  const owner = OWNERS[item.ownerId];
  const alreadySent = requestSent[item.id];
  const rangeBooked = startDate && getDatesInRange(startDate, endDate||startDate).some(d => item.booked && item.booked.includes(d));
  const n = daysBetween(startDate, endDate||startDate);
  const progress = Math.min(1, Math.max(dragY,dragX)/200);
  const allPhotos = [...(item.uploadedImages||[]).map(i=>({ t:"img", s:i.url })), ...(item.photos||[]).map(p=>({ t:"emoji", s:p }))];
  const deliveryAmenity = item.amenities && item.amenities.find(a => /delivery/i.test(a) && /\$\d+/.test(a));
  const hasDelivery = !!deliveryAmenity;

  const sheetStyle = {
    background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxHeight:"90dvh", overflowY:"auto", borderTop:"1px solid #E4E6EB", overscrollBehavior:"contain",
    transform: "translateY("+dragY+"px) translateX("+(dragX*0.35)+"px)",
    transition: dragging?"none":"transform 0.32s cubic-bezier(0.32,0.72,0,1), opacity 0.2s",
    animation: dragY===0&&dragX===0?"slideUp 0.32s cubic-bezier(0.32,0.72,0,1)":"none",
    opacity: 1 - progress*0.45,
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,"+(0.55-progress*0.2)+")", zIndex:200, display:"flex", alignItems:"flex-end" }} onClick={onDismiss}>
      <div ref={sheetRef} style={sheetStyle} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:5, borderRadius:3, background:"#CDD0D4", margin:"0 auto 16px" }}/>

        {allPhotos.length > 0 && (
          <div style={{ display:"flex", gap:8, overflowX:"auto", scrollbarWidth:"none", marginBottom:16 }}>
            {allPhotos.map((p,i) => (
              <div key={i} onClick={()=>setPhotoBrowser({ uploadedImages:item.uploadedImages||[], photos:item.photos||[], startIdx:i })}
                style={{ minWidth:i===0?175:95, height:i===0?140:90, borderRadius:12, overflow:"hidden", flexShrink:0, cursor:"pointer", background:"#F0F2F5", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
                {p.t==="img" ? <img src={p.s} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <span style={{ fontSize:i===0?52:32 }}>{p.s}</span>}
                {i===0 && allPhotos.length>1 && <div style={{ position:"absolute", bottom:6, right:6, background:"rgba(0,0,0,0.55)", borderRadius:6, padding:"3px 7px", fontSize:10, color:"#fff" }}>{allPhotos.length} photos</div>}
              </div>
            ))}
          </div>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
          <div style={{ fontSize:19, fontWeight:800, color:"#1C1E21", flex:1, marginRight:10 }}>{item.title}</div>
          <button onClick={()=>toggleFav(item.id)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer" }}>{favorites.includes(item.id)?"❤️":"🤍"}</button>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12, flexWrap:"wrap" }}>
          <span style={{ display:"inline-block", width:9, height:9, borderRadius:"50%", background:item.available?"#31A24C":"#FA3E3E" }}/>
          <span style={{ fontSize:13, fontWeight:600, color:item.available?"#31A24C":"#FA3E3E" }}>{item.available?"Available":"Unavailable"}</span>
          <span style={{ fontSize:13, color:"#65676B" }}>&middot; {item.distance}mi away</span>
          {(item.listingType==="sale"||item.listingType==="both") && (
            <span style={{ fontSize:11, fontWeight:700, color:"#E87722", background:"#FFF3E0", borderRadius:6, padding:"2px 7px", border:"1px solid #FFE0B2" }}>
              {item.listingType==="sale"?"For Sale":"Rent or Buy"}
            </span>
          )}
          {hasDelivery && <span style={{ fontSize:11, fontWeight:600, color:"#00B894", background:"#E8FBF6", borderRadius:6, padding:"2px 7px", border:"1px solid #B2EFE3" }}>Delivery avail.</span>}
        </div>

        {owner && (
          <div onClick={()=>setOwnerProfileId(item.ownerId)} style={{ display:"flex", alignItems:"center", gap:12, background:"#F7F8FA", borderRadius:12, padding:"12px 14px", marginBottom:16, cursor:"pointer", border:"1px solid #E4E6EB" }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:"#E4E6EB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{item.ownerAvatar||owner.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21", marginBottom:2 }}>{item.owner||owner.name}</div>
              <div style={{ fontSize:12, color:"#65676B" }}>
                {owner.verified && <span style={{ color:"#31A24C" }}>Verified &middot; </span>}
                {owner.responseTime}
              </div>
              {allItems.filter(x=>x.ownerId===item.ownerId&&x.id!==item.id).length > 0 && (
                <div style={{ fontSize:11, color:"#00B894", fontWeight:600, marginTop:2 }}>
                  +{allItems.filter(x=>x.ownerId===item.ownerId&&x.id!==item.id).length} other listings
                </div>
              )}
            </div>
            <div style={{ fontSize:12, color:"#00B894", fontWeight:700 }}>View ›</div>
          </div>
        )}

        {item.description && <div style={{ fontSize:13, color:"#65676B", lineHeight:1.7, marginBottom:14 }}>{item.description}</div>}

        {item.amenities && item.amenities.length > 0 && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontWeight:700, fontSize:13, color:"#1C1E21", marginBottom:8 }}>Included</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {item.amenities.map((a,i) => <div key={i} style={{ background:"#F0F2F5", borderRadius:8, padding:"5px 10px", fontSize:12, color:"#1C1E21", border:"1px solid #E4E6EB" }}>{a}</div>)}
            </div>
          </div>
        )}

        <div style={{ background:"#F7F8FA", borderRadius:12, padding:"13px 15px", marginBottom:14, border:"1px solid #E4E6EB", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            {item.listingType !== "sale" && (
              <>
                <div style={{ fontSize:10, color:"#8A8D91", marginBottom:3 }}>Rental price</div>
                <div style={{ fontSize:24, fontWeight:800, color:"#00B894" }}>
                  ${item.price}<span style={{ fontSize:12, color:"#8A8D91" }}>/{item.priceUnit||"day"}</span>
                </div>
              </>
            )}
            {item.listingType === "sale" && (
              <>
                <div style={{ fontSize:10, color:"#8A8D91", marginBottom:3 }}>Sale price</div>
                <div style={{ fontSize:24, fontWeight:800, color:"#E87722" }}>
                  ${item.price}<span style={{ fontSize:12, color:"#8A8D91" }}> firm</span>
                </div>
              </>
            )}
            {item.listingType === "both" && item.salePrice && (
              <div style={{ marginTop:6, paddingTop:6, borderTop:"1px solid #E4E6EB" }}>
                <div style={{ fontSize:10, color:"#8A8D91", marginBottom:2 }}>Or buy outright</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#E87722" }}>${item.salePrice} <span style={{ fontSize:11, fontWeight:400, color:"#8A8D91" }}>firm</span></div>
              </div>
            )}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10, color:"#8A8D91", marginBottom:3 }}>Category</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#1C1E21" }}>{CAT_MAP[item.category]||item.category}</div>
            {item.rating && <StarRow rating={item.rating} count={item.reviews} size={11}/>}
          </div>
        </div>

        {item.listingType==="sale" && item.available && (
          alreadySent === "pending"
            ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#FFF7ED", color:"#E87722", textAlign:"center", fontWeight:700, fontSize:15, marginBottom:10, border:"1px solid #FFE0B2" }}>⏳ Awaiting approval...</div>
            : alreadySent === "accepted"
            ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#E8FBF6", color:"#00B894", textAlign:"center", fontWeight:700, fontSize:15, marginBottom:10 }}>✅ Purchase Confirmed!</div>
            : <button style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#E87722", color:"#fff", marginBottom:10 }} onClick={()=>{ setPaymentModal({item,start:null,end:null}); setPaymentStep(1); }}>
                Buy Now — ${item.price}
              </button>
        )}

        {item.available && item.listingType!=="sale" && (
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21", marginBottom:10 }}>
              {item.category==="housing"?"Select check-in & check-out":"Select rental dates"}
            </div>
            <RangeCalendar booked={item.booked||[]} startDate={startDate} endDate={endDate} onRangeChange={(s,e)=>{ setStartDate(s); setEndDate(e); }}/>
            {startDate && !rangeBooked && (
              <div style={{ background:"#E8FBF6", borderRadius:10, padding:"11px 14px", margin:"10px 0", border:"1px solid #B2EFE3" }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#00B894" }}>
                  {formatDate(startDate)}{endDate&&endDate!==startDate?" to "+formatDate(endDate):""} &middot; {n} {item.category==="housing"?"night":"day"}{n>1?"s":""}
                </div>
              </div>
            )}
            {startDate && rangeBooked && (
              <div style={{ background:"#FEF2F2", borderRadius:10, padding:"12px 14px", margin:"10px 0", border:"1.5px solid #FCA5A5", display:"flex", gap:10, alignItems:"center" }}>
                <div style={{ fontSize:20, flexShrink:0 }}>🚫</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#DC2626" }}>These dates are already booked</div>
                  <div style={{ fontSize:12, color:"#EF4444", marginTop:2 }}>Please choose different dates on the calendar above</div>
                </div>
              </div>
            )}
            {alreadySent === "pending"
              ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#FFF7ED", color:"#E87722", textAlign:"center", fontWeight:700, fontSize:15, border:"1px solid #FFE0B2" }}>⏳ Awaiting owner approval...</div>
              : alreadySent === "accepted"
              ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#E8FBF6", color:"#00B894", textAlign:"center", fontWeight:700, fontSize:15 }}>✅ Booking Confirmed!</div>
              : <button
                  style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:(!startDate||rangeBooked)?"not-allowed":"pointer", background: rangeBooked?"#DC2626":"#00B894", color:"#fff", opacity:(!startDate||rangeBooked)?0.55:1 }}
                  onClick={()=>{ if(!rangeBooked) onConfirmBooking(startDate,endDate); }} disabled={!startDate||rangeBooked}>
                  {!startDate?"Select dates to continue":rangeBooked?"Already booked — select different dates":"Request "+n+" "+(item.category==="housing"?"night":"day")+(n>1?"s":"")}
                </button>
            }
            {item.listingType==="both" && item.salePrice && !alreadySent && (
              <button style={{ width:"100%", padding:"12px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer", background:"#E87722", color:"#fff", marginTop:8 }} onClick={()=>{ setPaymentModal({item,start:null,end:null}); setPaymentStep(1); }}>
                Or Buy Outright — ${item.salePrice}
              </button>
            )}
          </div>
        )}

        {!item.available && item.listingType!=="sale" && (
          <button style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"not-allowed", background:"#F0F2F5", color:"#8A8D91" }} disabled>Currently Unavailable</button>
        )}

        <div style={{ fontSize:11, color:"#8A8D91", textAlign:"center", margin:"14px 0 6px" }}>Swipe down or right to close</div>
        <button style={{ width:"100%", padding:"12px", borderRadius:8, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }} onClick={onDismiss}>Close</button>
      </div>
    </div>
  );
}

function BlockDatesModal({ listing, onClose, onSave }) {
  const today = new Date(2026, 5, 2);
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [blocked, setBlocked] = useState(listing.booked || []);
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const dim = new Date(year, month+1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const cells = [];
  for (let i=0;i<firstDay;i++) cells.push(null);
  for (let d=1;d<=dim;d++) cells.push(d);
  const pad = n => String(n).padStart(2,"0");
  const toKey = d => year+"-"+pad(month+1)+"-"+pad(d);
  const isPast = d => new Date(year,month,d) < today;
  const toggle = d => {
    if (isPast(d)) return;
    const k = toKey(d);
    setBlocked(prev => prev.includes(k) ? prev.filter(x=>x!==k) : [...prev,k]);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:400, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxWidth:430, margin:"0 auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:5, borderRadius:3, background:"#CDD0D4", margin:"0 auto 16px" }}/>
        <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21", marginBottom:4 }}>Block Dates</div>
        <div style={{ fontSize:13, color:"#65676B", marginBottom:16 }}>{listing.title} — tap dates to mark unavailable</div>
        <div style={{ background:"#F7F8FA", borderRadius:14, padding:14, border:"1px solid #E4E6EB", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }} style={{ background:"#E4E6EB", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>&#8249;</button>
            <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>{MONTHS[month]} {year}</div>
            <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }} style={{ background:"#E4E6EB", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>&#8250;</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, textAlign:"center" }}>
            {DAYS.map(d=><div key={d} style={{ fontSize:10, color:"#8A8D91", fontWeight:700, paddingBottom:6 }}>{d}</div>)}
            {cells.map((d,i)=>{
              if(!d) return <div key={i}/>;
              const past=isPast(d), blk=blocked.includes(toKey(d));
              return (
                <div key={i} onMouseDown={e=>e.preventDefault()} onClick={()=>toggle(d)}
                  style={{ borderRadius:8, padding:"8px 2px", fontSize:13, fontWeight:blk?700:500, cursor:past?"not-allowed":"pointer", background:blk?"#FA3E3E":"transparent", color:blk?"#fff":past?"#CDD0D4":"#1C1E21", opacity:past?0.4:1, userSelect:"none" }}>
                  {d}
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:14, marginTop:12, fontSize:11 }}>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#FA3E3E" }}/><span style={{ color:"#65676B" }}>Blocked</span></div>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#F0F2F5", border:"1px solid #E4E6EB" }}/><span style={{ color:"#65676B" }}>Available</span></div>
          </div>
        </div>
        <div style={{ fontSize:12, color:"#65676B", marginBottom:14, textAlign:"center" }}>{blocked.length} date{blocked.length!==1?"s":""} blocked</div>
        <button style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }} onClick={()=>onSave(blocked)}>Save availability</button>
        <button style={{ width:"100%", padding:"13px", borderRadius:12, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function ReviewModal({ booking, onClose, onSubmit }) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const active = hovered || stars;
  const handleSubmit = async () => {
    if (!stars) return;
    setSubmitting(true);
    await onSubmit(booking, stars, comment.trim());
    setSubmitting(false);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:600, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxWidth:430, margin:"0 auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:5, borderRadius:3, background:"#CDD0D4", margin:"0 auto 20px" }}/>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>{booking.item.emoji}</div>
          <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21" }}>How was {booking.item.title}?</div>
          <div style={{ fontSize:13, color:"#65676B", marginTop:4 }}>Rented from {booking.item.owner} · {booking.dateStr}</div>
        </div>
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:20 }}>
          {[1,2,3,4,5].map(s => (
            <span key={s}
              onMouseEnter={()=>setHovered(s)} onMouseLeave={()=>setHovered(0)}
              onClick={()=>setStars(s)}
              style={{ fontSize:40, cursor:"pointer", color: s<=active ? "#F5A623" : "#CDD0D4", transition:"color 0.1s" }}>
              &#9733;
            </span>
          ))}
        </div>
        {stars > 0 && (
          <div style={{ textAlign:"center", fontSize:13, color:"#65676B", marginBottom:16 }}>
            {["","Terrible","Poor","OK","Good","Excellent!"][stars]}
          </div>
        )}
        <textarea
          placeholder="Share your experience (optional)"
          value={comment}
          onChange={e=>setComment(e.target.value)}
          rows={3}
          style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid #E4E6EB", fontFamily:"inherit", fontSize:13, resize:"none", outline:"none", boxSizing:"border-box", color:"#1C1E21", marginBottom:16 }}
        />
        <button
          onClick={handleSubmit}
          disabled={!stars || submitting}
          style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:stars&&!submitting?"pointer":"not-allowed", background:"#00B894", color:"#fff", opacity:stars&&!submitting?1:0.45, marginBottom:10 }}>
          {submitting ? "Submitting…" : "Submit Review"}
        </button>
        <button onClick={onClose} style={{ width:"100%", padding:"13px", borderRadius:12, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }}>Cancel</button>
      </div>
    </div>
  );
}

function AddListingModal({ show, onClose, newListing, setNewListing, addImages, setAddImages, onSubmit, S, C, ALL_CATS, userId, onError }) {
  const [uploading, setUploading] = useState(0);

  if (!show) return null;

  const handleFiles = async (files) => {
    const imageFiles = Array.from(files || []).filter(f => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    for (const file of imageFiles) {
      const tempId = Date.now() + Math.random();
      setAddImages(p => [...p, { id: tempId, url: null }]);
      setUploading(n => n + 1);
      try {
        const rawExt = file.name.split('.').pop() || 'jpg';
        const ext = /^[a-z0-9]+$/i.test(rawExt) ? rawExt.toLowerCase() : 'jpg';
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('listing-images')
          .upload(path, file, { cacheControl: '3600', upsert: false });
        if (upErr) {
          console.error('Storage upload error:', upErr);
          const msg = upErr.message?.toLowerCase() || '';
          if (msg.includes('security policy') || upErr.statusCode === '403' || upErr.statusCode === 403) {
            onError?.('Storage not configured — run the SQL migration in Supabase', 'error');
          } else {
            onError?.(`Photo upload failed: ${upErr.message}`, 'error');
          }
          throw upErr;
        }
        const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
        setAddImages(p => p.map(img => img.id === tempId ? { id: tempId, url: data.publicUrl } : img));
      } catch {
        setAddImages(p => p.filter(img => img.id !== tempId));
      }
      setUploading(n => n - 1);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:4, color:"#1C1E21" }}>Create a Listing</div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>Photos get 3x more requests</div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>What do you want to do?</div>
          <div style={{ display:"flex", gap:8 }}>
            {[["rent","Rent it out"],["sale","Sell it"],["both","Rent & Sell"]].map(([val,label])=>(
              <button key={val} onClick={()=>setNewListing(n=>({...n,listingType:val}))}
                style={{ flex:1, padding:"10px 4px", borderRadius:10, border:newListing.listingType===val?"2px solid #00B894":"1.5px solid #E4E6EB", background:newListing.listingType===val?"#E8FBF6":"#fff", color:newListing.listingType===val?"#00B894":"#65676B", fontSize:11, fontWeight:newListing.listingType===val?700:500, cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>Photos</div>
          <label htmlFor="nr-photo-input" style={{ border:"2px dashed #B2EFE3", borderRadius:12, padding:"18px 14px", textAlign:"center", cursor:"pointer", background:"#F0F8FF", marginBottom:8, display:"block" }}>
            <div style={{ fontSize:32, marginBottom:4 }}>📸</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#00B894", marginBottom:2 }}>Tap to add photos</div>
            <div style={{ fontSize:11, color:C.muted }}>Camera, Gallery or Files</div>
            <input id="nr-photo-input" type="file" accept="image/*" multiple style={{ display:"none" }}
              onChange={e=>{ handleFiles(e.target.files); e.target.value=""; }}/>
          </label>
          {addImages.length > 0 && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {addImages.map((img,i) => (
                <div key={img.id} style={{ position:"relative", width:76, height:76 }}>
                  {img.url
                    ? <img src={img.url} alt="" style={{ width:76, height:76, borderRadius:10, objectFit:"cover", border:i===0?"2.5px solid #00B894":"1.5px solid #E4E6EB" }}/>
                    : <div style={{ width:76, height:76, borderRadius:10, background:"#F0F2F5", border:"1.5px solid #E4E6EB", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <div style={{ width:26, height:26, borderRadius:"50%", border:"3px solid #00B894", borderTopColor:"transparent", animation:"spin 0.75s linear infinite" }}/>
                      </div>
                  }
                  {img.url && i===0 && <div style={{ position:"absolute", top:3, left:3, background:"#00B894", borderRadius:5, padding:"2px 5px", fontSize:9, fontWeight:800, color:"#fff" }}>COVER</div>}
                  {img.url && <button onClick={()=>setAddImages(p=>p.filter(x=>x.id!==img.id))} style={{ position:"absolute", top:-5, right:-5, background:"#FA3E3E", border:"2px solid #fff", borderRadius:"50%", width:20, height:20, color:"#fff", fontSize:12, cursor:"pointer", fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center" }}>x</button>}
                </div>
              ))}
              <label htmlFor="nr-photo-input" style={{ width:76, height:76, borderRadius:10, border:"2px dashed #B2EFE3", background:"#F0F8FF", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                <span style={{ fontSize:20, color:"#00B894" }}>+</span>
                <span style={{ fontSize:9, fontWeight:700, color:"#00B894" }}>More</span>
              </label>
            </div>
          )}
        </div>

        <div style={{ borderTop:"1px solid #E4E6EB", marginBottom:14 }}/>

        <div style={{ marginBottom:14 }}>
          <label style={S.lbl}>Category</label>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
            {ALL_CATS.map(cat=>(
              <button key={cat.id} onClick={()=>setNewListing(n=>({...n,category:cat.id,emoji:cat.emoji}))}
                style={{ padding:"9px 4px", borderRadius:10, border:newListing.category===cat.id?"2px solid #00B894":"1.5px solid #E4E6EB", background:newListing.category===cat.id?"#E8FBF6":"#fff", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                <span style={{ fontSize:20 }}>{cat.emoji}</span>
                <span style={{ fontSize:9, fontWeight:newListing.category===cat.id?700:500, color:newListing.category===cat.id?"#00B894":"#65676B" }}>{cat.label}</span>
              </button>
            ))}
          </div>
          {newListing.category==="other" && <input style={{ ...S.inp, marginTop:8 }} placeholder="Describe category (e.g. Musical instruments)" autoComplete="off" value={newListing.otherCategory||""} onChange={e=>setNewListing(n=>({...n,otherCategory:e.target.value}))}/>}
        </div>

        <div style={S.fg}>
          <label style={S.lbl}>Name</label>
          <input style={S.inp} placeholder="e.g. Power Drill, Party Tent" autoComplete="off" autoCorrect="off" value={newListing.title} onChange={e=>setNewListing(n=>({...n,title:e.target.value}))}/>
        </div>
        {/* Rental price — shown for Rent and Both */}
        {newListing.listingType !== "sale" && (
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ ...S.fg, flex:2 }}>
              <label style={S.lbl}>Rental Price ($)</label>
              <input style={S.inp} type="number" placeholder="25" value={newListing.price} onChange={e=>setNewListing(n=>({...n,price:e.target.value}))}/>
            </div>
            <div style={{ ...S.fg, flex:2 }}>
              <label style={S.lbl}>Per</label>
              <select style={S.sel} value={newListing.priceUnit} onChange={e=>setNewListing(n=>({...n,priceUnit:e.target.value}))}>
                <option value="hour">Hour</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="night">Night</option>
              </select>
            </div>
          </div>
        )}
        {/* Sale price — for Sale only it uses the main price field; for Both it uses salePrice */}
        {newListing.listingType === "sale" && (
          <div style={S.fg}>
            <label style={S.lbl}>Sale Price ($)</label>
            <input style={S.inp} type="number" placeholder="e.g. 299" value={newListing.price} onChange={e=>setNewListing(n=>({...n,price:e.target.value}))}/>
          </div>
        )}
        {newListing.listingType === "both" && (
          <div style={S.fg}>
            <label style={S.lbl}>Sale Price ($) <span style={{ fontWeight:400, color:"#8A8D91" }}>— one-time purchase</span></label>
            <input style={S.inp} type="number" placeholder="e.g. 299" value={newListing.salePrice} onChange={e=>setNewListing(n=>({...n,salePrice:e.target.value}))}/>
          </div>
        )}
        <div style={S.fg}>
          <label style={S.lbl}>Description</label>
          <textarea style={{ ...S.inp, minHeight:70, resize:"vertical" }} placeholder="Describe the item, condition, included..." autoComplete="off" autoCorrect="off" value={newListing.description} onChange={e=>setNewListing(n=>({...n,description:e.target.value}))}/>
        </div>
        <div style={S.fg}>
          <label style={S.lbl}>Amenities (comma-separated)</label>
          <input style={S.inp} placeholder="WiFi, Parking, Tables..." autoComplete="off" autoCorrect="off" value={newListing.amenities} onChange={e=>setNewListing(n=>({...n,amenities:e.target.value}))}/>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>Delivery?</div>
          <div style={{ display:"flex", gap:8 }}>
            {[["no","No - pickup only"],["yes","Yes - I deliver"]].map(([val,label])=>(
              <button key={val} onClick={()=>setNewListing(n=>({...n,offersDelivery:val==="yes",deliveryFee:val==="no"?"":n.deliveryFee,deliveryRadius:val==="no"?"":n.deliveryRadius,deliveryLocationAddress:val==="no"?"":n.deliveryLocationAddress,lat:val==="no"?null:n.lat,lng:val==="no"?null:n.lng}))}
                style={{ flex:1, padding:"10px 8px", borderRadius:10, border:newListing.offersDelivery===(val==="yes")?"2px solid #00B894":"1.5px solid #E4E6EB", background:newListing.offersDelivery===(val==="yes")?"#E8FBF6":"#fff", color:newListing.offersDelivery===(val==="yes")?"#00B894":"#65676B", fontSize:12, fontWeight:newListing.offersDelivery===(val==="yes")?700:500, cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
          {newListing.offersDelivery && (
            <div style={{ marginTop:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:13, color:"#65676B" }}>Fee: $</span>
                  <input style={{ ...S.inp, width:80 }} type="number" placeholder="25" value={newListing.deliveryFee||""} onChange={e=>setNewListing(n=>({...n,deliveryFee:e.target.value}))}/>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:13, color:"#65676B" }}>Radius (mi):</span>
                  <input style={{ ...S.inp, width:70 }} type="number" placeholder="10" value={newListing.deliveryRadius||""} onChange={e=>setNewListing(n=>({...n,deliveryRadius:e.target.value}))}/>
                </div>
              </div>
              <div style={{ fontSize:12, fontWeight:600, color:"#1C1E21", marginBottom:6 }}>Your pickup / delivery origin address <span style={{ color:"#E74C3C" }}>*</span></div>
              <PlacesAutocompleteInput
                placeholder="e.g. 123 Main St, Brooklyn, NY"
                containerStyle={{ width:"100%" }}
                inputStyle={S.inp}
                onAddressChange={text => setNewListing(n=>({...n, deliveryLocationAddress: text, lat: null, lng: null}))}
                onPlaceSelect={({ lat, lng }) => { console.log("[AddListing] onPlaceSelect received:", { lat, lng }); setNewListing(n=>({...n, lat, lng})); }}
              />
              {newListing.lat ? (
                <div style={{ fontSize:11, color:"#00B894", marginTop:4 }}>✓ Location confirmed</div>
              ) : newListing.deliveryLocationAddress ? (
                <div style={{ fontSize:11, color:"#E87722", marginTop:4 }}>Select an address from the suggestions to confirm location</div>
              ) : null}
            </div>
          )}
        </div>
        <button style={{ ...S.pBtn, opacity:uploading>0?0.6:1, cursor:uploading>0?"not-allowed":"pointer" }} onClick={uploading>0?undefined:onSubmit} disabled={uploading>0}>
          {uploading>0 ? `Uploading ${uploading} photo${uploading>1?"s":""}…` : "Publish Listing"}
        </button>
        <button style={S.gBtn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Map helpers ───────────────────────────────────────────────────────────────

let _mapsPromise = null;
function loadGoogleMaps() {
  if (_mapsPromise) return _mapsPromise;
  _mapsPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }

    if (!MAPS_API_KEY || MAPS_API_KEY === 'undefined') {
      _mapsPromise = null;
      reject(new Error('Maps API key is not configured'));
      return;
    }

    // Global auth-failure hook — fires when key is invalid or domain not allowed
    window.gm_authFailure = () => {
      _mapsPromise = null;
      reject(new Error('Maps API key is invalid or not authorised for this domain'));
    };

    const cb = '__googleMapsReady';
    window[cb] = () => { delete window[cb]; resolve(); };

    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_API_KEY}&loading=async&callback=${cb}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => { _mapsPromise = null; reject(new Error('Maps script failed to load')); };
    document.head.appendChild(s);
  });
  return _mapsPromise;
}

function seededRand(seed) {
  const x = Math.sin(seed + 1) * 43758.5453;
  return x - Math.floor(x);
}

function privacyOffset(id, lat, lng) {
  const r1 = seededRand(id * 127.1);
  const r2 = seededRand(id * 311.7);
  const angle = r1 * 2 * Math.PI;
  const dist = 0.1 + r2 * 0.4; // 0.1–0.5 miles
  const dLat = (dist / 69) * Math.cos(angle);
  const dLng = (dist / (69 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
  return { lat: lat + dLat, lng: lng + dLng };
}

function makePriceIcon(price, priceUnit) {
  const label = `$${price}`;
  const w = Math.max(48, label.length * 9 + 22);
  const rh = 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="42">
    <rect x="1" y="1" width="${w - 2}" height="${rh - 2}" rx="8" fill="#00B894" stroke="white" stroke-width="2"/>
    <text x="${w / 2}" y="${rh / 2 + 5}" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="white" text-anchor="middle">${label}</text>
    <polygon points="${w / 2 - 6},${rh - 1} ${w / 2 + 6},${rh - 1} ${w / 2},41" fill="#00B894"/>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function MapView({ items, onSelectItem, centerCoords, radius, onRadiusChange, onMoveCenter, visible }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const circleRef = useRef(null);
  const centerMarkerRef = useRef(null);
  const prevRadiusRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState(null);

  // Trigger a resize event when the map becomes visible so tiles fill correctly
  useEffect(() => {
    if (visible && mapRef.current && window.google?.maps) {
      window.google.maps.event.trigger(mapRef.current, 'resize');
    }
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const center = centerCoords || { lat: 39.5, lng: -98.35 };
        mapRef.current = new window.google.maps.Map(containerRef.current, {
          center,
          zoom: centerCoords ? 12 : 4,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        });
        setLoading(false);
        setMapReady(true);
      })
      .catch(err => { if (!cancelled) { setMapError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => m.setMap(null));
      circleRef.current?.setMap(null);
      centerMarkerRef.current?.setMap(null);
    };
  }, []);

  // Price pin markers
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    const geoItems = items.filter(i => i.lat && i.lng);
    geoItems.forEach(item => {
      const pos = privacyOffset(item.id, item.lat, item.lng);
      const w = Math.max(48, String(`$${item.price}`).length * 9 + 22);
      const marker = new window.google.maps.Marker({
        position: pos,
        map: mapRef.current,
        icon: { url: makePriceIcon(item.price), scaledSize: new window.google.maps.Size(w, 42), anchor: new window.google.maps.Point(w / 2, 42) },
        title: item.title,
      });
      marker.addListener('click', () => onSelectItem(item));
      markersRef.current.push(marker);
    });
    if (geoItems.length > 1 && !centerCoords) {
      const bounds = new window.google.maps.LatLngBounds();
      markersRef.current.forEach(m => bounds.extend(m.getPosition()));
      mapRef.current.fitBounds(bounds, 80);
    }
  }, [mapReady, items]);

  // Search radius circle + draggable center marker
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    if (!centerCoords) {
      circleRef.current?.setMap(null);
      centerMarkerRef.current?.setMap(null);
      circleRef.current = null;
      centerMarkerRef.current = null;
      prevRadiusRef.current = null;
      return;
    }

    const center = centerCoords;
    const radiusMiles = radius || 5;
    const radiusMeters = radiusMiles * 1609.34;
    const radiusChanged = prevRadiusRef.current !== radiusMiles;
    const isFirst = !circleRef.current;
    prevRadiusRef.current = radiusMiles;

    if (circleRef.current) {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radiusMeters);
    } else {
      circleRef.current = new window.google.maps.Circle({
        map: mapRef.current,
        center,
        radius: radiusMeters,
        fillColor: '#00B894',
        fillOpacity: 0.12,
        strokeColor: '#00B894',
        strokeOpacity: 0.7,
        strokeWeight: 2,
        zIndex: 1,
      });
    }

    if (centerMarkerRef.current) {
      centerMarkerRef.current.setPosition(center);
    } else {
      centerMarkerRef.current = new window.google.maps.Marker({
        position: center,
        map: mapRef.current,
        draggable: true,
        zIndex: 10,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#00B894',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2.5,
        },
      });
      centerMarkerRef.current.addListener('drag', e => {
        circleRef.current?.setCenter(e.latLng);
      });
      centerMarkerRef.current.addListener('dragend', e => {
        onMoveCenter?.({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
    }

    if (isFirst || radiusChanged) {
      const bounds = circleRef.current.getBounds();
      if (bounds) mapRef.current.fitBounds(bounds, { top: 60, bottom: 100, left: 40, right: 40 });
    } else {
      mapRef.current.panTo(center);
    }
  }, [mapReady, centerCoords, radius]);

  if (mapError) return (
    <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#65676B', gap:8, padding:24 }}>
      <div style={{ fontSize:32 }}>🗺️</div>
      <div style={{ fontSize:14, fontWeight:700, color:'#1C1E21' }}>Map unavailable</div>
      <div style={{ fontSize:13, color:'#E87722', textAlign:'center' }}>{mapError}</div>
      <div style={{ marginTop:8, fontSize:12, color:'#8A8D91', fontFamily:'monospace' }}>key: {MAPS_API_KEY.slice(0,8)}…</div>
    </div>
  );

  return (
    <div style={{ position:'absolute', inset:0 }}>
      <div ref={containerRef} style={{ position:'absolute', inset:0 }}/>
      {loading && (
        <div style={{ position:'absolute', inset:0, background:'#F4F6F8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:'#65676B' }}>
          Loading map…
        </div>
      )}
      {!loading && (
        <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)', background:'rgba(255,255,255,0.96)', borderRadius:14, padding:'10px 14px', boxShadow:'0 2px 16px rgba(0,0,0,0.18)', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', zIndex:1, whiteSpace:'nowrap' }}>
          {!centerCoords ? (
            <div style={{ fontSize:12, color:'#65676B', fontWeight:500 }}>
              Set a search location to see radius
            </div>
          ) : (
            <>
              <div style={{ fontSize:11, color:'#65676B', textAlign:'center', marginBottom:7, fontWeight:600, letterSpacing:'0.01em' }}>Drag pin to move · tap to change radius</div>
              <div style={{ display:'flex', gap:5 }}>
                {[1, 2, 5, 10, 25].map(r => (
                  <button key={r} onClick={() => onRadiusChange?.(r)} style={{
                    background: radius===r ? '#00B894' : '#F0F2F5',
                    color: radius===r ? '#fff' : '#65676B',
                    border: 'none',
                    borderRadius: 20,
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: radius===r ? 700 : 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>{r}mi</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChatView({ activeConvo, setActiveConvo, chatMsg, setChatMsg, messages, setMessages, msgEndRef, user, onSend, isDesktop, profilePhotoUrl }) {
  if (!activeConvo) return null;
  const sendMsg = () => {
    if (!chatMsg.trim()) return;
    const text = chatMsg.trim();
    const newMsg = { mine:true, text, time:"Now" };
    setMessages(prev=>prev.map(m=>m.id===activeConvo.id?{...m,thread:[...(m.thread||m.messages||[]),newMsg],unread:false}:m));
    setActiveConvo(c=>({...c,thread:[...(c.thread||c.messages||[]),newMsg]}));
    setChatMsg("");
    if (user && onSend) onSend(text, activeConvo);
  };
  const containerStyle = isDesktop
    ? { display:"flex", flexDirection:"column", height:"calc(100vh - 64px)", background:"#fff", overflow:"hidden" }
    : { position:"fixed", inset:0, background:"#fff", zIndex:600, display:"flex", flexDirection:"column", maxWidth:430, margin:"0 auto" };

  const MyAvatar = () => profilePhotoUrl
    ? <img src={profilePhotoUrl} alt="" style={{ width:26, height:26, borderRadius:"50%", objectFit:"cover", flexShrink:0 }}/>
    : <div style={{ width:26, height:26, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:"#fff", fontWeight:700, flexShrink:0 }}>{(user?.user_metadata?.name||"Y")[0].toUpperCase()}</div>;

  const TheirAvatar = () => (
    activeConvo.avatarUrl
      ? <img src={activeConvo.avatarUrl} alt="" style={{ width:26, height:26, borderRadius:"50%", objectFit:"cover", flexShrink:0 }}/>
      : <div style={{ width:26, height:26, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>{activeConvo.avatar}</div>
  );

  return (
    <div style={containerStyle}>
      <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB", display:"flex", alignItems:"center", gap:12 }}>
        {!isDesktop && <button onClick={()=>setActiveConvo(null)} style={{ background:"#F0F2F5", border:"none", borderRadius:10, width:34, height:34, cursor:"pointer", fontSize:18 }}>&larr;</button>}
        <div style={{ width:38, height:38, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0, overflow:"hidden" }}>
          {activeConvo.avatarUrl ? <img src={activeConvo.avatarUrl} alt="" style={{ width:38, height:38, objectFit:"cover" }}/> : activeConvo.avatar}
        </div>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:"#1C1E21" }}>{activeConvo.from}</div>
          <div style={{ fontSize:12, color:"#65676B" }}>{activeConvo.item}</div>
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px", background:"#F0F2F5" }}>
        {(activeConvo.thread||activeConvo.messages||[]).map((m,i)=>(
          <div key={i} style={{ display:"flex", justifyContent:m.mine?"flex-end":"flex-start", alignItems:"flex-end", gap:6, marginBottom:10 }}>
            {!m.mine && <TheirAvatar/>}
            <div style={{ background:m.mine?"#00B894":"#fff", color:m.mine?"#fff":"#1C1E21", borderRadius:m.mine?"16px 16px 4px 16px":"16px 16px 16px 4px", padding:"10px 14px", fontSize:13, maxWidth:"75%", boxShadow:"0 1px 3px rgba(0,0,0,0.08)" }}>
              {m.text}
              <div style={{ fontSize:10, color:m.mine?"rgba(255,255,255,0.7)":"#8A8D91", marginTop:4, textAlign:"right" }}>{m.time}</div>
            </div>
            {m.mine && <MyAvatar/>}
          </div>
        ))}
        <div ref={msgEndRef}/>
      </div>
      <div style={{ background:"#fff", padding:"12px 16px", borderTop:"1px solid #E4E6EB", display:"flex", gap:8 }}>
        <input
          value={chatMsg}
          onChange={e=>setChatMsg(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&sendMsg()}
          placeholder="Message..."
          autoComplete="off"
          style={{ flex:1, background:"#F0F2F5", border:"none", borderRadius:24, padding:"10px 16px", fontSize:14, outline:"none", fontFamily:"inherit" }}
        />
        <button onClick={sendMsg} style={{ background:"#00B894", border:"none", borderRadius:"50%", width:42, height:42, color:"#fff", cursor:"pointer", fontSize:20, display:"flex", alignItems:"center", justifyContent:"center" }}>&#8593;</button>
      </div>
    </div>
  );
}

function dbToListing(row) {
  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    priceUnit: row.price_unit || 'day',
    category: (row.category === 'vehicles' || row.category === 'housing') ? 'other' : row.category,
    emoji: row.emoji || '📦',
    color: row.color,
    description: row.description || '',
    amenities: row.amenities || [],
    capacity: row.capacity,
    available: row.available,
    booked: row.booked || [],
    views: row.views || 0,
    requests: row.requests || 0,
    earnings: row.earnings || 0,
    rating: row.rating,
    reviews: row.reviews || 0,
    listingType: row.listing_type || 'rent',
    salePrice: row.sale_price ? Number(row.sale_price) : null,
    offersDelivery: row.offers_delivery || false,
    deliveryFee: row.delivery_fee,
    deliveryRadius: row.delivery_radius_miles,
    lat: row.lat ? Number(row.lat) : undefined,
    lng: row.lng ? Number(row.lng) : undefined,
    uploadedImages: row.uploaded_images || [],
    photos: row.photos || [],
  };
}

function listingToDb(listing) {
  return {
    title: listing.title,
    price: Number(listing.price),
    price_unit: listing.priceUnit || 'day',
    category: listing.category,
    emoji: listing.emoji || '📦',
    color: listing.color,
    description: listing.description || '',
    amenities: listing.amenities || [],
    capacity: listing.capacity || null,
    available: listing.available !== undefined ? listing.available : true,
    booked: listing.booked || [],
    views: listing.views || 0,
    requests: listing.requests || 0,
    earnings: listing.earnings || 0,
    rating: listing.rating || null,
    reviews: listing.reviews || 0,
    listing_type: listing.listingType || 'rent',
    sale_price: listing.salePrice ? Number(listing.salePrice) : null,
    offers_delivery: listing.offersDelivery || false,
    delivery_fee: listing.deliveryFee ? Number(listing.deliveryFee) : null,
    delivery_radius_miles: listing.deliveryRadius ? Number(listing.deliveryRadius) : null,
    lat: listing.lat || null,
    lng: listing.lng || null,
    uploaded_images: listing.uploadedImages || [],
    photos: listing.photos || [],
  };
}

function AuthModal({ show, initialMode = "login", onClose }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (show) { setMode(initialMode); setName(""); setEmail(""); setPassword(""); setError(""); setLoading(false); }
  }, [show, initialMode]);

  if (!show) return null;

  const submit = async () => {
    setError("");
    if (!email || !password) { setError("Email and password are required"); return; }
    if (mode === "signup" && !name.trim()) { setError("Name is required"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    if (mode === "login") {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password });
      if (e) { setError(e.message); setLoading(false); }
      else onClose();
    } else {
      const { error: e } = await supabase.auth.signUp({ email, password, options: { data: { name: name.trim() } } });
      if (e) { setError(e.message); }
      else setError("Check your email to confirm your account, then sign in.");
      setLoading(false);
    }
  };

  const inp = { width:"100%", background:"#F7F8FA", border:"1.5px solid #E4E6EB", borderRadius:12, padding:"14px 16px", color:"#1C1E21", fontFamily:"inherit", fontSize:15, outline:"none", boxSizing:"border-box" };
  const lbl = { fontSize:13, fontWeight:600, color:"#1C1E21", marginBottom:6, display:"block" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:800, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:"16px 16px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"92dvh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ background:"#00B894", padding:"18px 24px 22px", textAlign:"center", borderRadius:"16px 16px 0 0" }}>
          <div style={{ width:40, height:5, borderRadius:3, background:"rgba(255,255,255,0.35)", margin:"0 auto 14px" }}/>
          <div style={{ fontSize:26, fontWeight:900, color:"#fff", letterSpacing:-0.5, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>lendie</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", marginTop:4 }}>
            {mode==="login" ? "Welcome back!" : "Join thousands of neighbors sharing nearby"}
          </div>
        </div>
        <div style={{ padding:"20px 24px 48px" }}>
          <div style={{ display:"flex", background:"#F0F2F5", borderRadius:12, padding:4, marginBottom:20 }}>
            {[["login","Sign In"],["signup","Sign Up"]].map(([m,l])=>(
              <button key={m} onClick={()=>{ setMode(m); setError(""); }} style={{ flex:1, padding:"10px", borderRadius:9, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer", background:mode===m?"#00B894":"transparent", color:mode===m?"#fff":"#65676B", transition:"all 0.18s" }}>{l}</button>
            ))}
          </div>

          {mode==="signup" && (
            <div style={{ marginBottom:14 }}>
              <label style={lbl}>Your Name</label>
              <input style={inp} placeholder="e.g. Alex Johnson" value={name} onChange={e=>setName(e.target.value)} autoComplete="name"/>
            </div>
          )}

          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Email</label>
            <input style={inp} type="email" placeholder="you@email.com" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/>
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={lbl}>Password</label>
            <input style={inp} type="password" placeholder={mode==="signup"?"At least 6 characters":"Your password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==="signup"?"new-password":"current-password"} onKeyDown={e=>e.key==="Enter"&&submit()}/>
          </div>

          {error && (
            <div style={{ borderRadius:10, padding:"11px 14px", marginBottom:16, fontSize:13, border:"1px solid", ...(error.startsWith("Check")?{ background:"#E8FBF6", color:"#00A67E", borderColor:"#B2EFE3" }:{ background:"#FFF0F0", color:"#FA3E3E", borderColor:"#FFCDD2" }) }}>
              {error}
            </div>
          )}

          <button onClick={submit} disabled={loading} style={{ width:"100%", padding:"15px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:800, fontSize:16, cursor:loading?"not-allowed":"pointer", background:"#00B894", color:"#fff", opacity:loading?0.7:1, marginBottom:12 }}>
            {loading ? "…" : mode==="login" ? "Sign In" : "Create Account"}
          </button>

          <div style={{ textAlign:"center", fontSize:13, color:"#65676B" }}>
            {mode==="login" ? "New to Lendie? " : "Already have an account? "}
            <span onClick={()=>{ setMode(mode==="login"?"signup":"login"); setError(""); }} style={{ color:"#00B894", fontWeight:700, cursor:"pointer" }}>
              {mode==="login" ? "Sign Up" : "Sign In"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Lendie() {
  const [tab, setTab] = useState("browse");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [selectedItem, setSelectedItem] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [requestSent, setRequestSent] = useState({});
  const [bookingRequests, setBookingRequests] = useState([]);
  const [blockingDatesFor, setBlockingDatesFor] = useState(null);
  const [bookedOverrides, setBookedOverrides] = useState({});
  const [reviewingBooking, setReviewingBooking] = useState(null);
  const [reviewedBookings, setReviewedBookings] = useState({});
  const [listingRatings, setListingRatings] = useState({});
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentStep, setPaymentStep] = useState(1);
  const [wantsDelivery, setWantsDelivery] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCheck, setDeliveryCheck] = useState(null); // null | "checking" | "within" | "outside"
  const [deliveryCoords, setDeliveryCoords] = useState(null);
  const [cardNum, setCardNum] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [payMethod, setPayMethod] = useState("card");
  const [ownerProfileId, setOwnerProfileId] = useState(null);
  const [photoBrowser, setPhotoBrowser] = useState(null);
  const [myListings, setMyListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [addImages, setAddImages] = useState([]);
  const [showAddListing, setShowAddListing] = useState(false);
  const [newListing, setNewListing] = useState({ title:"", price:"", priceUnit:"day", salePrice:"", category:"tools", emoji:"🔧", description:"", amenities:"", capacity:"", listingType:"rent", offersDelivery:false, deliveryFee:"", deliveryRadius:"", deliveryLocationAddress:"", lat:null, lng:null });
  const [managingListing, setManagingListing] = useState(null);
  const [editingListing, setEditingListing] = useState(null);
  const [editImages, setEditImages] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const [draftMsg, setDraftMsg] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locationText, setLocationText] = useState("Current Location");
  const [resolvedLocation, setResolvedLocation] = useState("");
  const [gpsCoords, setGpsCoords] = useState(null);
  const [searchCoords, setSearchCoords] = useState(null);
  const [locationPickerKey, setLocationPickerKey] = useState(0);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);
  const [convoDeleteId, setConvoDeleteId] = useState(null);
  const [inboxEditMode, setInboxEditMode] = useState(false);
  const longPressRef = useRef(null);
  const longPressDidFire = useRef(false);
  const [radius, setRadius] = useState(5);
  const [sortBy, setSortBy] = useState("distance");
  const [listingTypeFilter, setListingTypeFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const msgEndRef = useRef(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState("login");
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(() => !!localStorage.getItem('lendie_banner_dismissed'));
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
    if (isStandalone || dismissedBanner) return;
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); setShowInstallBanner(true); };
    window.addEventListener('beforeinstallprompt', handler);
    // Also show for iOS (no beforeinstallprompt, detect Safari)
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isIOS && isSafari) setShowInstallBanner(true);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissedBanner]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load conversations + threads from Supabase when user auth state changes
  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }
    supabase.from('messages').select('*').order('created_at', { ascending: true }).then(({ data, error }) => {
      if (error) { console.error('[Messages] Load error:', error.message); return; }
      if (!data || data.length === 0) { setMessages([]); return; }
      const stored = (() => { try { return JSON.parse(localStorage.getItem('lendie_read') || '{}'); } catch { return {}; } })();
      const groups = {};
      data.forEach(row => {
        const cid = row.conversation_id;
        if (!cid) return;
        if (!groups[cid]) {
          groups[cid] = {
            id: new Date(row.created_at).getTime(),
            conversation_id: cid,
            from: row.is_mine ? (row.to_name || "Unknown") : (row.from_name || "Unknown"),
            fromId: cid,
            avatar: row.from_avatar || "🧑",
            item: row.listing_title || "",
            time: row.created_at,
            unread: false,
            thread: [],
            otherUserId: null,
          };
        }
        groups[cid].thread.push({ mine: row.is_mine, text: row.content, time: new Date(row.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) });
        if (!row.read && !row.is_mine && !stored[cid]) groups[cid].unread = true;
        groups[cid].id = new Date(row.created_at).getTime();
        groups[cid].time = row.created_at;
        // Derive other user's ID for push notifications
        if (!groups[cid].otherUserId) {
          if (row.from_user_id && row.from_user_id !== user.id) groups[cid].otherUserId = row.from_user_id;
          else if (row.to_user_id && row.to_user_id !== user.id) groups[cid].otherUserId = row.to_user_id;
        }
      });
      setMessages(Object.values(groups));
    });
  }, [user]);

  useEffect(() => {
    setProfilePhotoUrl(user?.user_metadata?.avatar_url || null);
  }, [user]);

  // Load notifications from Supabase on auth change
  useEffect(() => {
    if (!user) { setNotifications([]); return; }
    supabase.from('notifications').select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error('[Notif] load failed:', error.message); return; }
        if (data) setNotifications(data.map(row => ({
          id: row.id,
          icon: row.icon,
          text: row.text,
          sub: row.sub,
          time: row.time_label,
          unread: row.unread,
          type: row.type,
        })));
      });
  }, [user]);

  // Push notification subscription
  useEffect(() => {
    if (!user || !VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then(async sw => {
      try {
        let sub = await sw.pushManager.getSubscription();
        if (!sub) {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') return;
          sub = await sw.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }
        const json = sub.toJSON();
        await supabase.from('push_subscriptions').upsert(
          { user_id: user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
          { onConflict: 'user_id,endpoint' }
        );
      } catch (e) {
        console.warn('[Push] subscribe error:', e.message);
      }
    });
  }, [user]);

  // Load booking requests from DB (as renter or as owner)
  useEffect(() => {
    if (!user) { setBookingRequests([]); return; }
    supabase.from('booking_requests')
      .select('*')
      .or(`renter_id.eq.${user.id},owner_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error('[BookingReqs] load failed:', error.message); return; }
        if (!data || data.length === 0) return;
        setBookingRequests(data.map(row => ({
          id: row.id,
          dbId: row.id,
          item: row.item_json,
          start: row.start_date,
          end: row.end_date,
          dateStr: row.date_str,
          wantsDelivery: row.wants_delivery,
          deliveryAddress: row.delivery_address,
          deliveryFee: row.delivery_fee,
          renterName: row.renter_name,
          renterId: row.renter_id,
          status: row.status,
          time: new Date(row.created_at).toLocaleString(),
        })));
      });
  }, [user]);

  // Resolve actual city/neighborhood from browser geolocation
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lng } = pos.coords;
        setGpsCoords({ lat, lng });
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${MAPS_API_KEY}`);
        const data = await res.json();
        if (data.results?.[0]) {
          const comps = data.results[0].address_components || [];
          const neighborhood = comps.find(c => c.types.includes('neighborhood'))?.long_name;
          const sublocality  = comps.find(c => c.types.includes('sublocality_level_1') || c.types.includes('sublocality'))?.long_name;
          const locality     = comps.find(c => c.types.includes('locality'))?.long_name;
          const county       = comps.find(c => c.types.includes('administrative_area_level_2'))?.long_name;
          const state        = comps.find(c => c.types.includes('administrative_area_level_1'))?.short_name;
          const place = neighborhood || sublocality || locality || county || '';
          if (place) setResolvedLocation(place + (state ? ', ' + state : ''));
        }
      } catch {}
    }, () => {});
  }, []);

  const markConvoRead = (convo) => {
    setMessages(prev => prev.map(m => m.id === convo.id ? {...m, unread:false} : m));
    try {
      const r = JSON.parse(localStorage.getItem('lendie_read') || '{}');
      r[String(convo.id)] = true;
      localStorage.setItem('lendie_read', JSON.stringify(r));
    } catch {}
    if (convo.conversation_id) {
      supabase.from('messages').update({ read:true })
        .eq('conversation_id', convo.conversation_id).eq('is_mine', false)
        .then(({ error }) => { if (error) console.error('[Read]', error.message); });
    }
  };

  // Fetch and aggregate per-listing ratings from Supabase reviews table
  useEffect(() => {
    supabase.from('reviews').select('listing_id, rating').then(({ data }) => {
      if (!data || data.length === 0) return;
      const agg = {};
      data.filter(r => r.listing_id != null).forEach(r => {
        if (!agg[r.listing_id]) agg[r.listing_id] = { sum: 0, count: 0 };
        agg[r.listing_id].sum += Number(r.rating);
        agg[r.listing_id].count += 1;
      });
      const ratings = {};
      Object.entries(agg).forEach(([id, { sum, count }]) => {
        ratings[Number(id)] = { avg: Math.round(sum / count * 10) / 10, count, sum };
      });
      setListingRatings(ratings);
    });
  }, []);

  // Refresh selected listing from DB whenever one is opened, so lat/lng and other columns are current
  useEffect(() => {
    const id = selectedItem?.id;
    if (!id || typeof id !== 'number') return;
    supabase.from('listings').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error || !data) return;
      setSelectedItem(prev => {
        if (!prev || prev.id !== data.id) return prev;
        return { ...prev, ...dbToListing(data) };
      });
    });
  }, [selectedItem?.id]);

  useEffect(() => {
    if (!user) { setMyListings([]); setListingsLoading(false); return; }
    setListingsLoading(true);
    supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setMyListings(data.map(dbToListing));
        setListingsLoading(false);
      });
  }, [user?.id]);

  const requireAuth = (mode = "login") => {
    if (user) return true;
    setAuthModalMode(mode);
    setShowAuthModal(true);
    return false;
  };

  const showToast = (msg, type="success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };
  const toggleFav = id => setFavorites(f => f.includes(id) ? f.filter(x=>x!==id) : [...f,id]);

  const handleMapMoveCenter = ({ lat, lng }) => {
    setSearchCoords({ lat, lng });
    setLocationText("Locating…");
    loadGoogleMaps().then(() => {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          const comps = results[0].address_components || [];
          const city = (
            comps.find(c => c.types.includes('locality')) ||
            comps.find(c => c.types.includes('sublocality')) ||
            comps.find(c => c.types.includes('administrative_area_level_2')) ||
            comps.find(c => c.types.includes('administrative_area_level_1'))
          )?.long_name || results[0].formatted_address.split(',')[0] || 'Custom area';
          setLocationText(city);
        } else {
          setLocationText('Custom area');
        }
      });
    }).catch(() => setLocationText('Custom area'));
  };

  const handleProfilePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${user.id}/avatar.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (error) { showToast("Photo upload failed", "error"); return; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    await supabase.auth.updateUser({ data: { avatar_url: url } });
    setProfilePhotoUrl(url);
    showToast("Profile photo updated!");
  };

  const deleteConversation = async (convo) => {
    setMessages(prev => prev.filter(m => m.id !== convo.id));
    setConvoDeleteId(null);
    if (activeConvo?.id === convo.id) setActiveConvo(null);
    if (convo.conversation_id) {
      await supabase.from('messages').delete().eq('conversation_id', convo.conversation_id);
    }
  };

  const clearAllConversations = async () => {
    const dbConvos = messages.filter(m => m.conversation_id);
    setMessages([]);
    setInboxEditMode(false);
    setConvoDeleteId(null);
    for (const convo of dbConvos) {
      await supabase.from('messages').delete().eq('conversation_id', convo.conversation_id);
    }
  };

  const addNotification = (notif) => {
    const local = { ...notif, id: Date.now() };
    setNotifications(prev => [local, ...prev]);
    if (user) {
      supabase.from('notifications').insert({
        user_id: user.id,
        icon: notif.icon,
        text: notif.text,
        sub: notif.sub || '',
        time_label: notif.time || 'Just now',
        unread: true,
        type: notif.type || 'general',
      }).then(({ error }) => { if (error) console.error('[Notif] save failed:', error.message); });
    }
  };

  const pendingRequests = bookingRequests.filter(r=>r.status==="pending").length;
  const unreadMsgs = messages.filter(m=>m.unread).length + pendingRequests;
  const unreadNotifs = notifications.filter(n=>n.unread).length;

  const mergeBooked = (item) => {
    const extra = bookedOverrides[item.id];
    if (!extra || extra.length === 0) return item;
    return { ...item, booked: [...new Set([...(item.booked || []), ...extra])] };
  };
  const enrichRating = (item) => {
    const lr = listingRatings[item.id];
    if (!lr) return item;
    return { ...item, rating: lr.avg, reviews: lr.count };
  };
  const allItems = [
    ...myListings.map(l => enrichRating(mergeBooked({ ...l, owner:"You", ownerAvatar:"🧑", ownerId:"me", distance:0, reviews:l.reviews||0, uploadedImages:l.uploadedImages||[] })))
  ];

  const centerCoords = locationText === "Current Location" ? gpsCoords : searchCoords;

  const filtered = allItems.filter(item => {
    if (item.ownerId === "me" && !item.available) return false;
    if (showFavOnly && !favorites.includes(item.id)) return false;
    if (category!=="all" && category!=="everything" && item.category!==category) return false;
    if (search && !item.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (centerCoords && item.lat && item.lng) {
      const dist = haversineDistance(centerCoords.lat, centerCoords.lng, item.lat, item.lng);
      if (dist > radius) return false;
    }
    if (listingTypeFilter === "rent" && item.listingType === "sale") return false;
    if (listingTypeFilter === "buy" && item.listingType === "rent") return false;
    return true;
  }).sort((a,b) => {
    if (sortBy==="price") return a.price-b.price;
    if (sortBy==="rating") return (b.rating||0)-(a.rating||0);
    return a.distance-b.distance;
  });

  const C = { bg:"#F0F2F5", surface:"#FFFFFF", border:"#E4E6EB", accent:"#00B894", text:"#1C1E21", muted:"#65676B", faint:"#8A8D91" };
  const S = {
    app:{ fontFamily:"'Helvetica Neue',Arial,sans-serif", background: isDesktop ? "#fff" : C.bg, minHeight:"100vh", maxWidth: isDesktop ? "none" : 430, margin: isDesktop ? 0 : "0 auto", color:C.text, paddingBottom: isDesktop ? 0 : 84, paddingTop: isDesktop ? 64 : 0 },
    overlay:{ position:"fixed", inset:0, height:"100dvh", background:"rgba(0,0,0,0.55)", zIndex:300, display:"flex", alignItems:"flex-end" },
    sheet:{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px calc(40px + env(safe-area-inset-bottom, 0px))", width:"100%", maxHeight:"90dvh", overflowY:"auto", borderTop:"1px solid #E4E6EB", overscrollBehavior:"contain" },
    pBtn:{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 },
    gBtn:{ width:"100%", padding:"12px", borderRadius:8, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" },
    fg:{ marginBottom:14 },
    lbl:{ fontSize:12, fontWeight:600, color:C.text, marginBottom:6, display:"block" },
    inp:{ width:"100%", background:"#F0F2F5", border:"1.5px solid #CDD0D4", borderRadius:8, padding:"11px 13px", color:C.text, fontFamily:"inherit", fontSize:14, outline:"none", boxSizing:"border-box" },
    sel:{ width:"100%", background:"#F0F2F5", border:"1.5px solid #CDD0D4", borderRadius:8, padding:"11px 13px", color:C.text, fontFamily:"inherit", fontSize:14, outline:"none" },
    nav:{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, background:"#fff", borderTop:"1px solid #E4E6EB", display: isDesktop ? "none" : "flex", zIndex:100 },
  };
  const CAT_EMOJI_MAP = { tools:"🔧", trailers:"🚛", construction:"🏗️", kitchen:"🍳", garden:"🌱", outdoors:"🏕️", venues:"🏛️", party:"🎉", tech:"💻", other:"📦" };

  const handleAddListing = async () => {
    if (!newListing.title) { showToast("Enter a name for your listing","error"); return; }
    if (newListing.listingType !== "sale" && !newListing.price) { showToast("Enter a rental price","error"); return; }
    if (newListing.listingType === "sale" && !newListing.price) { showToast("Enter a sale price","error"); return; }
    if (newListing.listingType === "both" && !newListing.salePrice) { showToast("Enter a sale price","error"); return; }
    console.log("[AddListing] submit — lat:", newListing.lat, "lng:", newListing.lng, "offersDelivery:", newListing.offersDelivery);
    if (newListing.offersDelivery && (!newListing.lat || !newListing.lng)) { showToast("Select your delivery origin address from the suggestions","error"); return; }
    const colors = ["#F59E0B","#EC4899","#10B981","#3B82F6","#8B5CF6","#EF4444"];
    const amenArr = newListing.amenities ? newListing.amenities.split(",").map(a=>a.trim()).filter(Boolean) : [];
    if (newListing.offersDelivery && newListing.deliveryFee) amenArr.push("Delivery available (+$"+newListing.deliveryFee+")");
    const dbRow = {
      ...listingToDb({
        ...newListing, price: Number(newListing.price),
        color: colors[Math.floor(Math.random()*colors.length)],
        available: true, booked: [], views: 0, requests: 0, earnings: 0, rating: null, reviews: 0,
        amenities: amenArr, capacity: newListing.capacity ? Number(newListing.capacity) : null,
        photos: [newListing.emoji||"📦"], uploadedImages: addImages.filter(img => img.url),
      }),
      user_id: user?.id,
    };
    console.log("[AddListing] dbRow lat:", dbRow.lat, "lng:", dbRow.lng);
    const { data, error } = await supabase.from('listings').insert(dbRow).select().single();
    if (error) {
      console.error('[listings insert] error:', error);
      console.error('[listings insert] code:', error.code, '| status:', error.status);
      console.error('[listings insert] row sent:', JSON.stringify(dbRow, null, 2));
      showToast(error.message || "Failed to save listing", "error");
      return;
    }
    setMyListings(prev=>[dbToListing(data), ...prev]);
    setNewListing({ title:"", price:"", priceUnit:"day", category:"tools", emoji:"🔧", description:"", amenities:"", capacity:"", listingType:"rent", offersDelivery:false, deliveryFee:"", deliveryRadius:"", deliveryLocationAddress:"", lat:null, lng:null });
    setAddImages([]);
    setShowAddListing(false);
    showToast("Listing published!");
  };

  const handleEditSave = async () => {
    const { error } = await supabase.from('listings').update(listingToDb({...editingListing,uploadedImages:editImages})).eq('id', editingListing.id);
    if (error) { showToast("Failed to update","error"); return; }
    setMyListings(prev=>prev.map(l=>l.id===editingListing.id?{...l,...editingListing,uploadedImages:editImages}:l));
    setEditingListing(null);
    showToast("Listing updated!");
  };

  const handlePaymentConfirm = async () => {
    const { item, start, end } = paymentModal;
    const dateStr = formatDate(start) + (end && end !== start ? " - " + formatDate(end) : "");
    const req = {
      id: Date.now(),
      item,
      start, end, dateStr,
      wantsDelivery,
      deliveryAddress: wantsDelivery ? deliveryAddress : null,
      deliveryFee: wantsDelivery ? item.deliveryFee : null,
      renterName: user?.user_metadata?.name || "You",
      renterId: user?.id,
      status: "pending",
      time: "Just now",
    };
    setBookingRequests(prev => [...prev, req]);
    setRequestSent(r => ({...r, [item.id]: "pending"}));
    setPaymentModal(null); setPaymentStep(1); setWantsDelivery(false);
    setDeliveryAddress(""); setDeliveryCoords(null);
    setSelectedItem(null);
    showToast("Request sent! Waiting for owner approval.");
    addNotification({ icon:"⏳", text:"Request sent: "+item.title, sub:"Waiting for owner approval · "+dateStr, time:"Just now", type:"request" });
    setTab("messages");
    // Persist to DB and notify owner
    if (user && item.ownerId && item.ownerId !== 'me') {
      const { data } = await supabase.from('booking_requests').insert({
        renter_id: user.id,
        owner_id: item.ownerId,
        item_title: item.title,
        item_json: item,
        date_str: dateStr,
        start_date: start || null,
        end_date: end || null,
        wants_delivery: wantsDelivery,
        delivery_address: wantsDelivery ? deliveryAddress : null,
        delivery_fee: wantsDelivery ? (item.deliveryFee || null) : null,
        renter_name: user?.user_metadata?.name || "You",
        status: 'pending',
      }).select('id').single();
      if (data) setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, dbId: data.id } : r));
      sendPushToUser(item.ownerId, {
        title: 'New booking request',
        body: `${user?.user_metadata?.name || 'Someone'} wants to rent ${item.title}`,
        url: '/?tab=messages',
        tag: `booking-req-${data?.id || req.id}`,
      });
    }
  };

  const handleAcceptRequest = (req) => {
    setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:"accepted"} : r));
    setRequestSent(r => ({...r, [req.item.id]: "accepted"}));

    // Block the booked dates on the listing's calendar for all renters
    if (req.start) {
      const newDates = getDatesInRange(req.start, req.end || req.start);

      // Always update bookedOverrides so the calendar reflects the change immediately
      setBookedOverrides(prev => ({
        ...prev,
        [req.item.id]: [...new Set([...(prev[req.item.id] || []), ...newDates])],
      }));

      // For the owner's own listings: also persist to Supabase
      if (req.item.ownerId === "me") {
        setMyListings(prev => {
          const updated = prev.map(l => {
            if (l.id !== req.item.id) return l;
            return { ...l, booked: [...new Set([...(l.booked || []), ...newDates])] };
          });
          const listing = updated.find(l => l.id === req.item.id);
          if (listing) {
            supabase.from('listings')
              .update({ booked: listing.booked })
              .eq('id', listing.id)
              .then(({ error }) => {
                if (error) console.error('[Accept] Failed to save booked dates to Supabase:', error.message);
              });
          }
          return updated;
        });
      }

      // Also update selectedItem live if it's the same listing
      setSelectedItem(prev => {
        if (!prev || prev.id !== req.item.id) return prev;
        return { ...prev, booked: [...new Set([...(prev.booked || []), ...newDates])] };
      });
    }

    let autoText;
    if (req.wantsDelivery && req.deliveryAddress) {
      const feeStr = req.deliveryFee ? `$${req.deliveryFee}` : "no extra charge";
      autoText = `Your booking for "${req.item.title}" is confirmed! I'll deliver to ${req.deliveryAddress} (delivery fee: ${feeStr}). Please message me here to arrange payment and confirm the delivery time. Looking forward to it!`;
    } else {
      const pickupAddr = req.item.deliveryLocationAddress || req.item.location || "my address";
      autoText = `Your booking for "${req.item.title}" is confirmed! Pickup is at ${pickupAddr}. Please message me here to arrange payment and confirm a time. Looking forward to it!`;
    }
    const firstMsg = { mine: false, text: autoText, time: "Just now" };
    const ownerName = req.item.owner || "Owner";
    const ownerId = req.item.ownerId;
    const ownerAvatar = req.item.ownerAvatar || "🧑";

    // Update DB booking request status
    if (req.dbId) supabase.from('booking_requests').update({ status: 'accepted' }).eq('id', req.dbId);

    const existing = messages.find(m => m.fromId === ownerId && m.item === req.item.title);
    if (existing) {
      const updatedConvo = { ...existing, thread: [...(existing.thread || []), firstMsg], time: "Just now", unread: true };
      setMessages(prev => prev.map(m => m.id === existing.id ? updatedConvo : m));
      setActiveConvo(updatedConvo);
      if (existing.conversation_id) {
        supabase.from('messages').insert({
          conversation_id: existing.conversation_id,
          from_name: ownerName, from_avatar: ownerAvatar,
          to_name: user?.user_metadata?.name || "You",
          listing_title: req.item.title,
          content: autoText, is_mine: false, read: false,
          from_user_id: user?.id || null,
          to_user_id: req.renterId || null,
        }).then(({ error }) => { if (error) console.error('[Accept] Save msg failed:', error.message); });
      }
    } else {
      const convId = `conv_${Date.now()}`;
      const nm = { id: Date.now(), conversation_id: convId, from: ownerName, fromId: ownerId, otherUserId: req.renterId || null, avatar: ownerAvatar, item: req.item.title, sub: req.dateStr, time: "Just now", unread: true, thread: [firstMsg] };
      setMessages(prev => [...prev, nm]);
      setActiveConvo(nm);
      supabase.from('messages').insert({
        conversation_id: convId,
        from_name: ownerName, from_avatar: ownerAvatar,
        to_name: user?.user_metadata?.name || "You",
        listing_title: req.item.title,
        content: autoText, is_mine: false, read: false,
        from_user_id: user?.id || null,
        to_user_id: req.renterId || null,
      }).then(({ error }) => { if (error) console.error('[Accept] Save msg failed:', error.message); });
    }
    // Push notification to renter
    if (req.renterId && req.renterId !== user?.id) {
      sendPushToUser(req.renterId, {
        title: 'Booking accepted!',
        body: `Your request for ${req.item.title} on ${req.dateStr} has been confirmed`,
        url: '/?tab=messages',
        tag: `booking-accepted-${req.id}`,
      });
    }
    addNotification({ icon:"✅", text:"Booking confirmed: "+req.item.title, sub:req.dateStr, time:"Just now", type:"confirm" });
    setTab("messages");
  };

  const handleDeclineRequest = (req) => {
    setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:"declined"} : r));
    setRequestSent(r => ({...r, [req.item.id]: "declined"}));
    if (req.dbId) supabase.from('booking_requests').update({ status: 'declined' }).eq('id', req.dbId);
    if (req.renterId && req.renterId !== user?.id) {
      sendPushToUser(req.renterId, {
        title: 'Booking not available',
        body: `Your request for ${req.item.title} on ${req.dateStr} was declined`,
        url: '/?tab=messages',
        tag: `booking-declined-${req.id}`,
      });
    }
    addNotification({ icon:"❌", text:"Booking declined: "+req.item.title, sub:"The owner is unavailable for the requested dates", time:"Just now", type:"declined" });
    showToast("Booking request declined.");
  };

  const handleCancelRequest = (req) => {
    setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:"cancelled"} : r));
    setRequestSent(r => { const next = {...r}; delete next[req.item.id]; return next; });
    if (req.dbId) supabase.from('booking_requests').update({ status: 'cancelled' }).eq('id', req.dbId);
    if (req.item.ownerId && req.item.ownerId !== 'me') {
      sendPushToUser(req.item.ownerId, {
        title: 'Booking cancelled',
        body: `${req.renterName} cancelled their request for ${req.item.title}`,
        url: '/?tab=messages',
        tag: `booking-cancelled-${req.id}`,
      });
    }
    showToast("Booking request cancelled.");
  };

  const handleSendMessage = (text, convo) => {
    if (!convo?.conversation_id) return;
    supabase.from('messages').insert({
      conversation_id: convo.conversation_id,
      from_name: user?.user_metadata?.name || "You",
      from_avatar: "🧑",
      to_name: convo.from,
      listing_title: convo.item,
      content: text,
      is_mine: true,
      read: false,
      from_user_id: user?.id || null,
      to_user_id: convo.otherUserId || null,
    }).then(({ error }) => { if (error) console.error('[Chat] Save failed:', error.message); });
    if (convo.otherUserId) {
      sendPushToUser(convo.otherUserId, {
        title: `New message from ${user?.user_metadata?.name || 'Someone'}`,
        body: text.length > 80 ? text.slice(0, 77) + '…' : text,
        url: '/?tab=messages',
        tag: `msg-${convo.conversation_id}`,
      });
    }
  };

  const handleSubmitReview = async (booking, stars, comment) => {
    const reviewerName = user?.user_metadata?.name || booking.renterName || "Anonymous";
    // Only set listing_id for the owner's own Supabase listings; seed items use null (FK allows null)
    const listingId = booking.item.ownerId === "me" ? booking.item.id : null;
    const { error } = await supabase.from('reviews').insert({
      listing_id: listingId,
      reviewer_name: reviewerName,
      owner_name: booking.item.owner,
      rating: stars,
      comment: comment || null,
    });
    if (error) { showToast("Failed to save review", "error"); return; }
    // Update live ratings state
    if (listingId) {
      setListingRatings(prev => {
        const ex = prev[listingId] || { sum: 0, count: 0 };
        const newCount = ex.count + 1;
        const newSum = ex.sum + stars;
        return { ...prev, [listingId]: { avg: Math.round(newSum / newCount * 10) / 10, count: newCount, sum: newSum } };
      });
      // Also update selectedItem if it's this listing
      setSelectedItem(prev => prev?.id === listingId ? { ...prev, rating: Math.round((stars) / 1 * 10) / 10, reviews: (prev.reviews || 0) + 1 } : prev);
    }
    setReviewedBookings(prev => ({ ...prev, [booking.id]: true }));
    setReviewingBooking(null);
    showToast("Review submitted! Thank you.");
  };

  const TABS = [
    ["all","For you"],["everything","All"],["tools","Tools"],["trailers","Trailers"],["construction","Equipment"],
    ["kitchen","Kitchen"],["garden","Garden"],["outdoors","Outdoors"],["venues","Venues"],
    ["party","Party"],["tech","Tech"]
  ];
  const ALL_CATS = [
    {id:"tools",label:"Tools",emoji:"🔧"},{id:"trailers",label:"Trailers",emoji:"🚛"},
    {id:"construction",label:"Equipment",emoji:"🏗️"},{id:"kitchen",label:"Kitchen",emoji:"🍳"},
    {id:"garden",label:"Garden",emoji:"🌱"},{id:"outdoors",label:"Outdoors",emoji:"🏕️"},
    {id:"venues",label:"Venues",emoji:"🏛️"},{id:"party",label:"Party",emoji:"🎉"},
    {id:"tech",label:"Tech",emoji:"💻"},{id:"other",label:"Other",emoji:"📦"}
  ];

  const TypeFilterBar = () => (
    <div style={{ display:"flex", background:"#F0F2F5", borderRadius:12, padding:3, gap:2 }}>
      {[["all","All"],["rent","Rent"],["buy","Buy"]].map(([val,label]) => (
        <button key={val} onClick={()=>setListingTypeFilter(val)} style={{
          flex:1, padding:"8px 0", borderRadius:9, border:"none", fontFamily:"inherit",
          fontSize:14, fontWeight:listingTypeFilter===val ? 700 : 500,
          background: listingTypeFilter===val ? "#00B894" : "transparent",
          color: listingTypeFilter===val ? "#fff" : "#65676B",
          cursor:"pointer", transition:"background 0.15s, color 0.15s",
          boxShadow: listingTypeFilter===val ? "0 1px 4px rgba(0,184,148,0.25)" : "none",
        }}>{label}</button>
      ))}
    </div>
  );

  const CardGrid = () => (
    <div style={{ display:"grid", gridTemplateColumns: isDesktop ? "repeat(auto-fill, minmax(155px,1fr))" : "1fr 1fr", gap: isDesktop ? 10 : 3, padding: isDesktop ? 0 : 3, background: isDesktop ? "transparent" : "#E4E6EB" }}>
      {filtered.map(item => {
        const deliveryBadge = item.amenities && item.amenities.find(a=>/delivery/i.test(a));
        return (
          <div key={item.id} style={{ background:"#fff", overflow:"hidden", cursor:"pointer", position:"relative", borderRadius: isDesktop ? 14 : 0, boxShadow: isDesktop ? "0 2px 12px rgba(0,0,0,0.07)" : "none", transition:"box-shadow 0.15s" }} onClick={()=>setSelectedItem(item)}>
            <div style={{ background:(item.color||"#eee")+"15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, height:155, position:"relative", overflow:"hidden" }}>
              {item.uploadedImages && item.uploadedImages[0]
                ? <img src={item.uploadedImages[0].url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                : <span>{item.emoji}</span>}
              <div style={{ position:"absolute", top:8, left:8, width:10, height:10, borderRadius:"50%", background:item.available?"#31A24C":"#FA3E3E", border:"2px solid #fff" }}/>
              <button style={{ position:"absolute", top:8, right:8, background:"rgba(255,255,255,0.9)", border:"none", borderRadius:"50%", width:30, height:30, cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={e=>{e.stopPropagation();toggleFav(item.id);}}>
                {favorites.includes(item.id)?"❤️":"🤍"}
              </button>
            </div>
            <div style={{ padding:"8px 10px 12px" }}>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:1, color:"#1C1E21" }}>{item.title}</div>
              <div style={{ fontSize:11, color:"#65676B", marginBottom:3 }}>{item.owner||"You"} &middot; {item.distance===0?"Just listed":item.distance+"mi"}</div>
              {deliveryBadge && <div style={{ fontSize:10, fontWeight:600, color:"#00B894", background:"#E8FBF6", borderRadius:5, padding:"2px 6px", display:"inline-block", marginBottom:4, border:"1px solid #B2EFE3" }}>Delivery avail.</div>}
              {(item.listingType==="sale"||item.listingType==="both") && <div style={{ fontSize:10, fontWeight:700, color:"#E87722", background:"#FFF3E0", borderRadius:5, padding:"2px 6px", display:"inline-block", marginBottom:4, border:"1px solid #FFE0B2" }}>{item.listingType==="sale"?"For Sale":"Rent or Buy"}</div>}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                <div>
                  {item.listingType!=="sale" && <div><span style={{ fontSize:15, fontWeight:700, color:"#1C1E21" }}>${item.price}</span><span style={{ fontSize:9, color:"#8A8D91" }}>/{item.priceUnit||"day"}</span></div>}
                  {item.listingType==="sale" && <div><span style={{ fontSize:15, fontWeight:700, color:"#E87722" }}>${item.price}</span><span style={{ fontSize:9, color:"#8A8D91" }}> firm</span></div>}
                  {item.listingType==="both" && (
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ fontSize:15, fontWeight:700, color:"#1C1E21" }}>${item.price}</span><span style={{ fontSize:9, color:"#8A8D91" }}>/{item.priceUnit||"day"}</span>
                      {item.salePrice && <span style={{ fontSize:10, fontWeight:700, color:"#E87722", background:"#FFF3E0", borderRadius:5, padding:"1px 5px", border:"1px solid #FFE0B2" }}>Buy ${item.salePrice}</span>}
                    </div>
                  )}
                </div>
                {item.rating && <div style={{ fontSize:11, color:"#F5A623" }}>&#9733;{item.rating}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const PaymentModal = () => {
    if (!paymentModal) return null;
    const { item, start, end } = paymentModal;
    const delivAmn = item.amenities && item.amenities.find(a=>/delivery/i.test(a)&&/\$\d+/.test(a));
    const delivFee = (item.offersDelivery && item.deliveryFee) ? item.deliveryFee : (delivAmn ? parseInt(delivAmn.match(/\$(\d+)/)[1]) : null);
    const dismiss = () => { setPaymentModal(null); setPaymentStep(1); setWantsDelivery(false); setDeliveryAddress(""); setDeliveryCheck(null); setDeliveryCoords(null); };
    const runCheck = (coords) => {
      const ownerLat = item.lat ?? 40.7128;
      const ownerLng = item.lng ?? -74.006;
      const ownerRadius = item.deliveryRadius ?? 15;
      const dist = haversineDistance(ownerLat, ownerLng, coords.lat, coords.lng);
      const inRange = dist <= ownerRadius;
      setDeliveryCheck(inRange ? "within" : "outside");
      setWantsDelivery(inRange);
    };
    const handleAddressChange = (text) => { setDeliveryAddress(text); setDeliveryCheck(null); setDeliveryCoords(null); setWantsDelivery(false); };
    const handlePlaceSelect = (coords) => { setDeliveryCoords(coords); runCheck(coords); };
    return (
      <div style={{ ...S.overlay, zIndex:400 }} onClick={dismiss}>
        <div style={{ ...S.sheet, zIndex:401 }} onClick={e=>e.stopPropagation()}>
          <div>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <div style={{ fontSize:36, marginBottom:8 }}>{item.emoji}</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21" }}>{item.title}</div>
              <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{item.owner} &middot; {item.distance}mi away</div>
            </div>
            {start && (
              <div style={{ background:"#F7F8FA", borderRadius:12, padding:"12px 16px", marginBottom:14, border:"1px solid #E4E6EB", display:"flex", justifyContent:"space-between", fontSize:14 }}>
                <span style={{ color:C.muted }}>Dates</span>
                <span style={{ fontWeight:700, color:"#1C1E21" }}>{formatDate(start)}{end&&end!==start?" – "+formatDate(end):""}</span>
              </div>
            )}
            {delivFee && (
              <div style={{ background:"#F7F8FA", borderRadius:14, padding:"14px 16px", marginBottom:14, border:"1.5px solid #E4E6EB" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <div style={{ fontSize:24 }}>🚚</div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>Request Delivery</div>
                    <div style={{ fontSize:12, color:C.muted }}>Owner delivers within {item.deliveryRadius||15} mi · ${delivFee} fee</div>
                  </div>
                </div>
                <PlacesAutocompleteInput
                  placeholder="Enter delivery address or job site…"
                  containerStyle={{ width:"100%", marginBottom:6 }}
                  inputStyle={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid #E4E6EB", background:"#fff", fontFamily:"inherit", fontSize:13, outline:"none", boxSizing:"border-box", color:"#1C1E21" }}
                  onAddressChange={handleAddressChange}
                  onPlaceSelect={handlePlaceSelect}
                />
                {!deliveryCheck && (
                  <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Type your address and select from the suggestions</div>
                )}
                {deliveryCheck==="within" && (
                  <div style={{ marginTop:10, padding:"10px 12px", borderRadius:10, background:"#E8FBF6", border:"1.5px solid #00B894", fontSize:13, color:"#00B894", fontWeight:600 }}>
                    ✓ Address is within delivery range
                  </div>
                )}
                {deliveryCheck==="outside" && (
                  <div style={{ marginTop:10, padding:"10px 12px", borderRadius:10, background:"#FFF3F3", border:"1.5px solid #E74C3C", fontSize:13, color:"#E74C3C", fontWeight:600 }}>
                    Outside delivery area — owner delivers within {item.deliveryRadius||15} mi
                  </div>
                )}
              </div>
            )}
            <button
              style={{ ...S.pBtn, opacity:deliveryCheck==="outside"?0.4:1, cursor:deliveryCheck==="outside"?"not-allowed":"pointer" }}
              disabled={deliveryCheck==="outside"}
              onClick={handlePaymentConfirm}
            >
              Send Booking Request
            </button>
            <button style={S.gBtn} onClick={dismiss}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };


  const NotifPanel = () => {
    if (!showNotifs) return null;
    return (
      <div style={{ ...S.overlay, zIndex:500 }} onClick={()=>setShowNotifs(false)}>
        <div style={{ ...S.sheet, zIndex:501 }} onClick={e=>e.stopPropagation()}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21" }}>Notifications</div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              {notifications.length > 0 && <button onClick={()=>{ setNotifications([]); if(user) supabase.from('notifications').delete().eq('user_id',user.id).then(({error})=>{ if(error) console.error('[Notif] clear-all failed:',error.message); }); }} style={{ background:"none", border:"none", color:"#FA3E3E", fontSize:12, fontWeight:700, cursor:"pointer" }}>Clear all</button>}
              <button onClick={()=>{ setNotifications(prev=>prev.map(n=>({...n,unread:false}))); if(user) supabase.from('notifications').update({unread:false}).eq('user_id',user.id).then(({error})=>{ if(error) console.error('[Notif] mark-read failed:',error.message); }); }} style={{ background:"none", border:"none", color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer" }}>Mark all read</button>
            </div>
          </div>
          {notifications.length===0 && <div style={{ textAlign:"center", padding:"40px 20px", color:"#65676B" }}>No notifications</div>}
          {notifications.map(n=>(
            <div key={n.id} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:"1px solid #F0F2F5", alignItems:"flex-start" }}>
              <div style={{ width:42, height:42, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{n.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:n.unread?700:500, color:"#1C1E21" }}>{n.text}</div>
                <div style={{ fontSize:11, color:"#65676B", marginTop:2 }}>{n.sub}</div>
                <div style={{ fontSize:10, color:"#8A8D91", marginTop:2 }}>{n.time}</div>
              </div>
              <button onClick={()=>{ setNotifications(prev=>prev.filter(x=>x.id!==n.id)); if(user) supabase.from('notifications').delete().eq('id',n.id).then(({error})=>{ if(error) console.error('[Notif] delete failed:',error.message); }); }} style={{ background:"none", border:"none", color:"#CDD0D4", fontSize:18, cursor:"pointer", lineHeight:1, padding:"0 2px", flexShrink:0 }}>×</button>
            </div>
          ))}
          <button style={{ ...S.gBtn, marginTop:16 }} onClick={()=>setShowNotifs(false)}>Close</button>
        </div>
      </div>
    );
  };


  return (
    <div style={S.app}>
      <style>{`
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeInDown{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
        .lcard:hover{box-shadow:0 6px 24px rgba(0,0,0,0.12)!important;transform:translateY(-2px)}
        .lnav-btn:hover{background:#E8FBF6!important;color:#00B894!important}
      `}</style>

      {/* Desktop top navbar */}
      {isDesktop && (
        <header style={{ position:"fixed", top:0, left:0, right:0, height:64, background:"#fff", borderBottom:"1px solid #E4E6EB", zIndex:200, display:"flex", alignItems:"center" }}>
          <div style={{ width:"100%", padding:"0 10px", display:"flex", alignItems:"center", gap:0 }}>
            {/* Logo */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginRight:40, cursor:"pointer" }} onClick={()=>setTab("browse")}>
              <svg width="32" height="32" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius:8 }}>
                <rect width="512" height="512" rx="110" fill="#00B894"/>
                <rect x="112" y="82" width="92" height="268" rx="22" fill="white"/>
                <rect x="112" y="308" width="244" height="92" rx="22" fill="white"/>
                <circle cx="178" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
                <circle cx="256" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
                <circle cx="334" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
              </svg>
              <span style={{ fontSize:22, fontWeight:900, color:"#00B894", letterSpacing:-0.5 }}>Lendie</span>
            </div>
            {/* Nav links */}
            <nav style={{ display:"flex", gap:2, flex:1 }}>
              {[{id:"browse",label:"Browse"},{id:"listings",label:"My Items"},{id:"messages",label:"Inbox",badge:unreadMsgs},{id:"map",label:"Map"}].map(n=>(
                <button key={n.id} className="lnav-btn" onClick={()=>{ setTab(n.id); if(activeConvo&&n.id!=="messages") setActiveConvo(null); }}
                  style={{ position:"relative", background:tab===n.id?"#E8FBF6":"transparent", border:"none", borderRadius:8, padding:"8px 18px", cursor:"pointer", color:tab===n.id?"#00B894":"#65676B", fontWeight:tab===n.id?700:500, fontSize:14, fontFamily:"inherit", transition:"all 0.15s" }}>
                  {n.label}
                  {n.badge>0 && <span style={{ position:"absolute", top:4, right:6, background:"#FA3E3E", borderRadius:"50%", width:16, height:16, fontSize:9, display:"inline-flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:"#fff" }}>{n.badge}</span>}
                </button>
              ))}
            </nav>
            {/* Auth */}
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              {user ? (
                <>
                  <button style={{ background:"#F0F2F5", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:17 }} onClick={()=>setShowFavOnly(f=>!f)} title={showFavOnly?"Show all":"Favorites only"}>{showFavOnly?"❤️":"🤍"}</button>
                  <button style={{ position:"relative", background:"#F0F2F5", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:17 }} onClick={()=>setShowNotifs(true)}>
                    🔔{unreadNotifs>0&&<div style={{ position:"absolute", top:-1, right:-1, background:"#FA3E3E", borderRadius:"50%", width:14, height:14, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:900, border:"2px solid #fff" }}>{unreadNotifs}</div>}
                  </button>
                  <div onClick={()=>setTab("profile")} style={{ width:36, height:36, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#fff", fontWeight:800, cursor:"pointer", overflow:"hidden", flexShrink:0 }}>
                    {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" style={{ width:36, height:36, objectFit:"cover" }}/> : (user.user_metadata?.name||"L")[0].toUpperCase()}
                  </div>
                </>
              ) : (
                <>
                  <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ background:"transparent", border:"1px solid #CDD0D4", borderRadius:20, padding:"0 18px", height:36, fontSize:13, fontWeight:600, cursor:"pointer", color:"#1C1E21", fontFamily:"inherit" }}>Log in</button>
                  <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ background:"#00B894", border:"none", borderRadius:20, padding:"0 18px", height:36, fontSize:13, fontWeight:700, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Sign up</button>
                </>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Install / Add to Home Screen banner */}
      {showInstallBanner && !dismissedBanner && (
        <div style={{ position:"fixed", bottom: isDesktop ? "auto" : 84, top: isDesktop ? 64 : "auto", left:0, right:0, background:"#00B894", color:"#fff", zIndex:150, padding:"10px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,184,148,0.35)", animation:"fadeInDown 0.3s ease" }}>
          <svg width="28" height="28" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius:6, flexShrink:0 }}>
            <rect width="512" height="512" rx="110" fill="rgba(255,255,255,0.25)"/>
            <rect x="112" y="82" width="92" height="268" rx="22" fill="white"/>
            <rect x="112" y="308" width="244" height="92" rx="22" fill="white"/>
            <circle cx="178" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
            <circle cx="256" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
            <circle cx="334" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
          </svg>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:14 }}>Add Lendie to your home screen</div>
            <div style={{ fontSize:12, opacity:0.85 }}>
              {installPrompt ? "Install the app for the best experience" : "Tap Share → Add to Home Screen in Safari"}
            </div>
          </div>
          {installPrompt && (
            <button onClick={async()=>{ await installPrompt.prompt(); setInstallPrompt(null); setShowInstallBanner(false); }}
              style={{ background:"#fff", color:"#00B894", border:"none", borderRadius:8, padding:"8px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
              Install
            </button>
          )}
          <button onClick={()=>{ setShowInstallBanner(false); setDismissedBanner(true); localStorage.setItem('lendie_banner_dismissed','1'); }}
            style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.75)", fontSize:20, cursor:"pointer", padding:"0 4px", lineHeight:1 }}>✕</button>
        </div>
      )}

      {tab==="browse" && (
        <div style={{ background:"#fff", minHeight: isDesktop ? "auto" : "calc(100vh - 84px)" }}>
          <div style={{ display: isDesktop ? "none" : "block", background:"#fff", borderBottom:"1px solid #E4E6EB", position:"sticky", top:0, zIndex:50, willChange:"transform", transform:"translateZ(0)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px 8px" }}>
              <div style={{ fontSize:26, fontWeight:900, color:"#00B894", letterSpacing:-0.5, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>Lendie</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {user ? (
                  <>
                    <button style={{ background:"#F0F2F5", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:17 }} onClick={()=>setShowFavOnly(f=>!f)}>{showFavOnly?"❤️":"🤍"}</button>
                    <button style={{ position:"relative", background:"#F0F2F5", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:17 }} onClick={()=>setShowNotifs(true)}>
                      🔔{unreadNotifs>0&&<div style={{ position:"absolute", top:0, right:0, background:"#FA3E3E", borderRadius:"50%", width:14, height:14, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:900, border:"2px solid #fff" }}>{unreadNotifs}</div>}
                    </button>
                    <div onClick={()=>setTab("profile")} style={{ width:36, height:36, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#fff", fontWeight:800, cursor:"pointer", flexShrink:0, overflow:"hidden" }}>
                      {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" style={{ width:36, height:36, objectFit:"cover" }}/> : (user.user_metadata?.name||"L")[0].toUpperCase()}
                    </div>
                  </>
                ) : (
                  <>
                    <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ background:"#F0F2F5", border:"none", borderRadius:20, padding:"0 14px", height:34, fontSize:13, fontWeight:700, cursor:"pointer", color:"#1C1E21", fontFamily:"inherit" }}>Log in</button>
                    <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ background:"#00B894", border:"none", borderRadius:20, padding:"0 14px", height:34, fontSize:13, fontWeight:700, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Sign up</button>
                  </>
                )}
              </div>
            </div>
            <div style={{ padding:"0 14px 8px" }}>
              <div style={{ background:"#F0F2F5", borderRadius:50, display:"flex", alignItems:"center", padding:"9px 14px", gap:8 }}>
                <span style={{ color:"#65676B", fontSize:15 }}>🔍</span>
                <input style={{ flex:1, background:"none", border:"none", outline:"none", color:"#1C1E21", fontSize:14, fontFamily:"inherit" }} placeholder="Search Lendie — borrow, rent, buy nearby" value={search} autoComplete="off" autoCorrect="off" spellCheck="false" onClick={e=>e.stopPropagation()} onChange={e=>{ e.stopPropagation(); setSearch(e.target.value); }}/>
                {search&&<span onClick={()=>setSearch("")} style={{ cursor:"pointer", color:"#65676B", fontSize:14 }}>x</span>}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 14px 8px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer" }} onClick={()=>setShowLocationPicker(p=>!p)}>
                <span style={{ fontSize:13, color:"#00B894" }}>📍</span>
                <div style={{ display:"flex", flexDirection:"column", lineHeight:1.2 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:"#00B894" }}>
                    {locationText === "Current Location" && resolvedLocation ? resolvedLocation : locationText.split(",")[0]}
                  </span>
                  {locationText === "Current Location" && resolvedLocation && (
                    <span style={{ fontSize:10, color:"#65676B" }}>Current Location</span>
                  )}
                </div>
                <span style={{ fontSize:12, color:"#65676B" }}>&middot; {radius}mi</span>
                <span style={{ fontSize:11, color:"#65676B" }}>{showLocationPicker?"▲":"▼"}</span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>setViewMode("grid")} style={{ background:viewMode==="grid"?"#E8FBF6":"#F0F2F5", border:"none", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:viewMode==="grid"?700:500, color:viewMode==="grid"?"#00B894":"#65676B", cursor:"pointer" }}>Grid</button>
                <button onClick={()=>setSortBy(s=>s==="distance"?"price":s==="price"?"rating":"distance")} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:500, color:"#65676B", cursor:"pointer" }}>Sort: {sortBy}</button>
              </div>
            </div>
            <div style={{ display:"flex", borderTop:"1px solid #E4E6EB", overflowX:"auto", overflowY:"hidden", scrollbarWidth:"none", height:44, alignItems:"stretch", WebkitOverflowScrolling:"touch" }}>
              {TABS.map(([id,label])=>(
                <button key={id} onClick={()=>setCategory(id)} style={{ background:"transparent", border:"none", borderBottom:category===id?"3px solid #00B894":"3px solid transparent", height:44, padding:"0 14px", fontSize:13, fontWeight:category===id?700:500, color:category===id?"#00B894":"#65676B", cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, boxSizing:"border-box" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {showLocationPicker && (
            <div style={{ background:"#fff", borderBottom:"1px solid #E4E6EB", padding:"14px" }}>
              <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                <PlacesAutocompleteInput
                  key={locationPickerKey}
                  placeholder="City or address..."
                  containerStyle={{ flex:1 }}
                  inputStyle={{ width:"100%", background:"#F0F2F5", border:"none", borderRadius:8, padding:"10px 12px", color:"#1C1E21", fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
                  onAddressChange={text => setLocationText(text || "Current Location")}
                  onPlaceSelect={({ lat, lng }) => { setSearchCoords({ lat, lng }); setShowLocationPicker(false); }}
                />
                <button onClick={()=>{ setLocationText("Current Location"); setSearchCoords(null); setLocationPickerKey(k=>k+1); }} style={{ background:"#E8FBF6", border:"none", borderRadius:8, padding:"0 12px", color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>Use mine</button>
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <button onClick={()=>{ setLocationText("Current Location"); setSearchCoords(null); setLocationPickerKey(k=>k+1); }} style={{ background:locationText==="Current Location"?"#E8FBF6":"#F0F2F5", border:locationText==="Current Location"?"1px solid #00B894":"1px solid #E4E6EB", borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:locationText==="Current Location"?700:500, color:locationText==="Current Location"?"#00B894":"#65676B", cursor:"pointer" }}>
                    Current Location
                  </button>
                  {resolvedLocation && (
                    <span style={{ fontSize:10, color:"#65676B", marginTop:2 }}>{resolvedLocation}</span>
                  )}
                </div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#65676B" }}>Radius</span>
                <span style={{ fontSize:13, fontWeight:800, color:"#00B894" }}>{radius}mi</span>
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                {[1,2,5,10,20,25].map(r=>(
                  <button key={r} onClick={()=>setRadius(r)} style={{ background:radius===r?"#00B894":"#F0F2F5", border:"none", borderRadius:20, padding:"5px 0", fontSize:12, fontWeight:radius===r?700:500, color:radius===r?"#fff":"#65676B", cursor:"pointer", flex:1 }}>{r}mi</button>
                ))}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", borderTop:"1px solid #E4E6EB", paddingTop:12 }}>
                <div style={{ fontSize:12, color:"#65676B" }}><span style={{ fontWeight:700, color:"#1C1E21" }}>{filtered.length}</span> listings</div>
                <button onClick={()=>setShowLocationPicker(false)} style={{ background:"#00B894", border:"none", borderRadius:8, padding:"8px 18px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Done</button>
              </div>
            </div>
          )}
          {isDesktop ? (
            <div style={{ display:"flex", minHeight:"calc(100vh - 64px)" }}>
              {/* Sidebar — flush to left edge, full height */}
              <aside style={{ width:200, flexShrink:0, background:"#fff", borderRight:"1px solid #E4E6EB" }}>
                <div style={{ position:"sticky", top:64, overflowY:"auto", maxHeight:"calc(100vh - 64px)", padding:"16px 14px" }}>
                  <div style={{ marginBottom:16 }}>
                    <div style={{ background:"#F0F2F5", borderRadius:8, display:"flex", alignItems:"center", padding:"8px 12px", gap:8 }}>
                      <span style={{ color:"#65676B", fontSize:14 }}>🔍</span>
                      <input style={{ flex:1, background:"none", border:"none", outline:"none", color:"#1C1E21", fontSize:13, fontFamily:"inherit" }} placeholder="Search..." value={search} autoComplete="off" onChange={e=>setSearch(e.target.value)}/>
                      {search&&<span onClick={()=>setSearch("")} style={{ cursor:"pointer", color:"#65676B", fontSize:13 }}>✕</span>}
                    </div>
                  </div>
                  <div style={{ fontSize:10, fontWeight:700, color:"#8A8D91", textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Category</div>
                  {TABS.map(([id,label])=>(
                    <div key={id} onClick={()=>setCategory(id)} style={{ padding:"6px 8px", borderRadius:6, cursor:"pointer", background:category===id?"#E8FBF6":"transparent", color:category===id?"#00B894":"#65676B", fontWeight:category===id?700:400, fontSize:13, marginBottom:1, display:"flex", alignItems:"center", gap:7 }}>
                      <span style={{ fontSize:14 }}>{CAT_EMOJI_MAP[id]||"🏷️"}</span>{label}
                    </div>
                  ))}
                  <div style={{ borderTop:"1px solid #E4E6EB", margin:"14px 0 10px" }}/>
                  <div style={{ fontSize:10, fontWeight:700, color:"#8A8D91", textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Radius</div>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:14 }}>
                    {[1,2,5,10,25].map(r=>(
                      <button key={r} onClick={()=>setRadius(r)} style={{ background:radius===r?"#00B894":"#F0F2F5", border:"none", borderRadius:20, padding:"4px 9px", fontSize:12, fontWeight:radius===r?700:500, color:radius===r?"#fff":"#65676B", cursor:"pointer" }}>{r}mi</button>
                    ))}
                  </div>
                  <div style={{ fontSize:10, fontWeight:700, color:"#8A8D91", textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Sort by</div>
                  {[["distance","📍 Distance"],["price","💲 Price"],["rating","⭐ Rating"]].map(([val,lbl])=>(
                    <div key={val} onClick={()=>setSortBy(val)} style={{ padding:"6px 8px", borderRadius:6, cursor:"pointer", background:sortBy===val?"#E8FBF6":"transparent", color:sortBy===val?"#00B894":"#65676B", fontWeight:sortBy===val?700:400, fontSize:13, marginBottom:1 }}>
                      {lbl}
                    </div>
                  ))}
                  <div style={{ borderTop:"1px solid #E4E6EB", margin:"14px 0 8px" }}/>
                  <div style={{ fontSize:12, color:"#8A8D91" }}><span style={{ fontWeight:700, color:"#1C1E21", fontSize:14 }}>{filtered.length}</span> listings</div>
                </div>
              </aside>
              {/* Main grid — fills all remaining width */}
              <main style={{ flex:1, minWidth:0, padding:"16px 14px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21" }}>
                    {showFavOnly ? "Favorites" : category==="all" ? "Near you" : TABS.find(([id])=>id===category)?.[1] || category}
                  </div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontSize:13, color:"#00B894" }}>📍</span>
                    <span style={{ fontSize:13, fontWeight:600, color:"#00B894" }}>{locationText.split(",")[0]} · {radius}mi</span>
                    {user && <button style={{ background:"#F0F2F5", border:"none", borderRadius:"50%", width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:14 }} onClick={()=>setShowFavOnly(f=>!f)}>{showFavOnly?"❤️":"🤍"}</button>}
                  </div>
                </div>
                <div style={{ marginBottom:16 }}><TypeFilterBar/></div>
                {filtered.length===0
                  ? <div style={{ textAlign:"center", padding:"80px 20px", color:"#65676B", background:"#fff" }}>No listings found. Try adjusting the filters.</div>
                  : <CardGrid/>}
              </main>
            </div>
          ) : (
            <>
              <div style={{ background:"#fff", padding:"12px 14px 8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21" }}>Near you</div>
                <div style={{ fontSize:13, color:"#00B894", fontWeight:600, cursor:"pointer" }} onClick={()=>setShowLocationPicker(p=>!p)}>{locationText.split(",")[0]}, {radius}mi</div>
              </div>
              <div style={{ padding:"8px 12px 10px", background:"#fff" }}>
                <TypeFilterBar/>
              </div>
              {filtered.length===0
                ? <div style={{ textAlign:"center", padding:"50px 20px", color:"#65676B", background:"#fff" }}>No listings found</div>
                : <CardGrid/>}
            </>
          )}
        </div>
      )}

      {tab==="listings" && (
        <div style={{ background:"#fff", minHeight:"100vh", maxWidth: isDesktop ? 960 : "none", margin: isDesktop ? "0 auto" : 0 }}>
          <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#00B894" }}>My Listings</div>
            <button onClick={()=>{ if (requireAuth()) setShowAddListing(true); }} style={{ background:"#00B894", border:"none", borderRadius:8, padding:"8px 14px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>+ List item</button>
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px" }}>
              <div style={{ fontSize:48, marginBottom:16 }}>📦</div>
              <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21", marginBottom:8 }}>List your first item</div>
              <div style={{ fontSize:13, color:"#65676B", marginBottom:24, lineHeight:1.6 }}>Sign in to earn money by renting out tools, gear, and more to your neighbors.</div>
              <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }}>Get started</button>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"13px", borderRadius:12, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }}>Sign in</button>
            </div>
          )}
          {user && myListings.length===0 && <div style={{ textAlign:"center", padding:"50px 20px", color:"#65676B" }}>No listings yet. Tap + to add one!</div>}
          {user && myListings.map(l=>(
            <div key={l.id} onClick={()=>setSelectedItem({...l, owner:user.user_metadata?.name||"You", ownerAvatar:"🧑", ownerId:"me", distance:0, reviews:l.reviews||0, uploadedImages:l.uploadedImages||[]})} style={{ background:"#fff", margin:"0 0 2px", padding:"14px 16px", borderBottom:"1px solid #F0F2F5", cursor:"pointer" }}>
              <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                <div style={{ width:60, height:60, borderRadius:10, background:(l.color||"#eee")+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>
                  {l.uploadedImages&&l.uploadedImages[0] ? <img src={l.uploadedImages[0].url} alt="" style={{ width:60, height:60, borderRadius:10, objectFit:"cover" }}/> : l.emoji}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>{l.title}</div>
                  <div style={{ fontSize:12, color:"#65676B" }}>${l.price}/{l.priceUnit||"day"} &middot; {l.views||0} views &middot; {l.requests||0} requests</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, flexWrap:"wrap" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:l.available?"#31A24C":"#FA3E3E" }}/>
                      <span style={{ fontSize:11, color:l.available?"#31A24C":"#FA3E3E", fontWeight:600 }}>{l.available?"Live":"Paused"}</span>
                    </div>
                    {(l.booked||[]).filter(d=>d>="2026-06-02").length > 0 && (
                      <span style={{ fontSize:11, color:"#DC2626", fontWeight:600, background:"#FEF2F2", borderRadius:4, padding:"1px 6px", border:"1px solid #FCA5A5" }}>
                        {(l.booked||[]).filter(d=>d>="2026-06-02").length} date{(l.booked||[]).filter(d=>d>="2026-06-02").length!==1?"s":""} booked
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={(e)=>{ e.stopPropagation(); setBlockingDatesFor(l.id); }} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer", color:"#65676B" }}>Dates</button>
                  <button onClick={async(e)=>{ e.stopPropagation(); const next=!l.available; const{error}=await supabase.from('listings').update({available:next}).eq('id',l.id); if(!error)setMyListings(prev=>prev.map(x=>x.id===l.id?{...x,available:next}:x)); }} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer", color:"#65676B" }}>{l.available?"Pause":"Resume"}</button>
                  <button onClick={(e)=>{ e.stopPropagation(); setDeletingId(l.id); }} style={{ background:"#FFF0F0", border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer", color:"#FA3E3E" }}>Del</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==="messages" && isDesktop && (
        <div style={{ display:"flex", minHeight:"calc(100vh - 64px)" }}>
          {/* Desktop conversation list — flush to left */}
          <div style={{ width:280, flexShrink:0, background:"#fff", borderRight:"1px solid #E4E6EB", height:"calc(100vh - 64px)", overflowY:"auto", display:"flex", flexDirection:"column" }}>
            <div style={{ padding:"16px 16px 12px", borderBottom:"1px solid #E4E6EB", fontWeight:900, fontSize:18, color:"#00B894", flexShrink:0 }}>Messages</div>
            {!user && <div style={{ textAlign:"center", padding:"40px 20px", color:"#65676B", fontSize:13 }}>Sign in to view messages</div>}
            {user && [...messages].sort((a,b)=>{
              if(a.unread!==b.unread) return (b.unread?1:0)-(a.unread?1:0);
              const aNew=a.id>=1000,bNew=b.id>=1000;
              if(aNew&&bNew) return b.id-a.id;
              if(!aNew&&!bNew) return a.id-b.id;
              return aNew?-1:1;
            }).map(m=>(
              <div key={m.id}
                onMouseEnter={()=>setConvoDeleteId(m.id)}
                onMouseLeave={()=>setConvoDeleteId(null)}
                onClick={()=>{ setActiveConvo(m); markConvoRead(m); }}
                style={{ padding:"12px 16px", borderBottom:"1px solid #F0F2F5", display:"flex", gap:10, cursor:"pointer", alignItems:"center", background:activeConvo?.id===m.id?"#E8FBF6":"#fff", position:"relative" }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0, overflow:"hidden" }}>
                  {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width:44, height:44, objectFit:"cover" }}/> : m.avatar}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:m.unread?700:500, fontSize:13, color:"#1C1E21", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.from}</div>
                  <div style={{ fontSize:11, color:"#65676B", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.item}</div>
                </div>
                {convoDeleteId===m.id
                  ? <button onClick={e=>{ e.stopPropagation(); deleteConversation(m); }} style={{ background:"#FA3E3E", border:"none", borderRadius:6, padding:"4px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer", flexShrink:0 }}>Delete</button>
                  : m.unread && <div style={{ width:8, height:8, borderRadius:"50%", background:"#00B894", flexShrink:0 }}/>
                }
              </div>
            ))}
          </div>
          {/* Desktop chat panel (right) */}
          <div style={{ flex:1, minWidth:0 }}>
            {activeConvo
              ? <ChatView activeConvo={activeConvo} setActiveConvo={setActiveConvo} chatMsg={chatMsg} setChatMsg={setChatMsg} messages={messages} setMessages={setMessages} msgEndRef={msgEndRef} user={user} onSend={handleSendMessage} isDesktop={true} profilePhotoUrl={profilePhotoUrl}/>
              : <div style={{ height:"calc(100vh - 64px)", background:"#F4F6F8", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#65676B", gap:12 }}>
                  <div style={{ fontSize:48 }}>💬</div>
                  <div style={{ fontSize:16, fontWeight:700, color:"#1C1E21" }}>Select a conversation</div>
                  <div style={{ fontSize:13 }}>Choose from your messages on the left</div>
                </div>
            }
          </div>
        </div>
      )}

      {tab==="messages" && !activeConvo && !isDesktop && (
        <div style={{ background:"#fff", minHeight:"100vh" }}>
          <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#00B894" }}>Messages</div>
            {user && messages.length > 0 && (
              <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                {inboxEditMode && <button onClick={clearAllConversations} style={{ background:"none", border:"none", color:"#FA3E3E", fontSize:13, fontWeight:700, cursor:"pointer", padding:0 }}>Clear all</button>}
                <button onClick={()=>{ setInboxEditMode(e=>!e); setConvoDeleteId(null); }} style={{ background:"none", border:"none", color:"#00B894", fontSize:14, fontWeight:700, cursor:"pointer", padding:0 }}>
                  {inboxEditMode ? "Done" : "Edit"}
                </button>
              </div>
            )}
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px" }}>
              <div style={{ fontSize:48, marginBottom:16 }}>💬</div>
              <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21", marginBottom:8 }}>Your inbox</div>
              <div style={{ fontSize:13, color:"#65676B", marginBottom:24, lineHeight:1.6 }}>Sign in to message owners and manage your bookings.</div>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff" }}>Sign in</button>
            </div>
          )}
          {user && bookingRequests.filter(r=>r.status==="pending").length > 0 && (
            <div>
              <div style={{ padding:"10px 16px 6px", fontSize:11, fontWeight:700, color:"#E87722", letterSpacing:0.5, background:"#FFF7ED", borderBottom:"1px solid #FFE0B2" }}>PENDING BOOKING REQUESTS</div>
              {bookingRequests.filter(r=>r.status==="pending").map(req=>(
                <div key={req.id} style={{ background:"#fff", padding:"14px 16px", borderBottom:"1px solid #F0F2F5" }}>
                  <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                    <div style={{ width:50, height:50, borderRadius:12, background:(req.item.color||"#eee")+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{req.item.emoji}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>{req.item.title}</div>
                      <div style={{ fontSize:12, color:"#65676B" }}>{req.renterName} &middot; {req.dateStr}</div>
                      {req.wantsDelivery && req.deliveryAddress && (
                        <div style={{ fontSize:11, color:"#00B894", marginTop:2 }}>Delivery: {req.deliveryAddress}</div>
                      )}
                      <div style={{ display:"flex", gap:8, marginTop:10 }}>
                        <button onClick={()=>handleAcceptRequest(req)} style={{ flex:1, padding:"9px", borderRadius:8, border:"none", background:"#00B894", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Accept</button>
                        <button onClick={()=>handleDeclineRequest(req)} style={{ flex:1, padding:"9px", borderRadius:8, border:"1px solid #E4E6EB", background:"#fff", color:"#FA3E3E", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Decline</button>
                      </div>
                      <button onClick={()=>handleCancelRequest(req)} style={{ width:"100%", marginTop:8, padding:"7px", borderRadius:8, border:"none", background:"none", color:"#8A8D91", fontSize:12, cursor:"pointer", fontFamily:"inherit", textAlign:"center" }}>Cancel my request</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {user && messages.length===0 && bookingRequests.filter(r=>r.status==="pending").length===0 && <div style={{ textAlign:"center", padding:"50px 20px", color:"#65676B" }}>No messages yet</div>}
          {user && [...messages].sort((a, b) => {
            if (a.unread !== b.unread) return (b.unread ? 1 : 0) - (a.unread ? 1 : 0);
            const aNew = a.id >= 1000, bNew = b.id >= 1000;
            if (aNew && bNew) return b.id - a.id;
            if (!aNew && !bNew) return a.id - b.id;
            return aNew ? -1 : 1;
          }).map(m=>(
            <div key={m.id}
              style={{ background:"#fff", padding:"14px 16px", borderBottom:"1px solid #F0F2F5", display:"flex", gap:12, cursor:"pointer", alignItems:"center", userSelect:"none" }}
              onClick={()=>{ if(inboxEditMode) return; setActiveConvo(m); markConvoRead(m); }}
            >
              {inboxEditMode && (
                <button onClick={e=>{ e.stopPropagation(); deleteConversation(m); }} style={{ width:28, height:28, borderRadius:"50%", background:"#FA3E3E", border:"none", color:"#fff", fontSize:18, fontWeight:700, lineHeight:1, cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              )}
              <div style={{ width:50, height:50, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0, overflow:"hidden" }}>
                {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width:50, height:50, objectFit:"cover" }}/> : m.avatar}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:m.unread?700:500, fontSize:14, color:"#1C1E21" }}>{m.from}</div>
                <div style={{ fontSize:12, color:"#65676B", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.item}</div>
                <div style={{ fontSize:11, color:"#8A8D91" }}>{m.time}</div>
              </div>
              {!inboxEditMode && m.unread && <div style={{ width:10, height:10, borderRadius:"50%", background:"#00B894", flexShrink:0 }}/>}
            </div>
          ))}
        </div>
      )}

      <div style={{ position:"fixed", top: isDesktop ? 64 : 0, bottom: isDesktop ? 0 : 84, left:0, right:0, zIndex:10, visibility: tab==="map" ? "visible" : "hidden", pointerEvents: tab==="map" ? "auto" : "none" }}>
        <MapView
          items={allItems}
          centerCoords={centerCoords}
          radius={radius}
          onRadiusChange={setRadius}
          onMoveCenter={handleMapMoveCenter}
          onSelectItem={item => setSelectedItem(item)}
          visible={tab==="map"}
        />
      </div>

      {tab==="profile" && (
        <div style={{ maxWidth: isDesktop ? 900 : "none", margin: isDesktop ? "0 auto" : 0, padding: isDesktop ? "0 0 40px" : 0 }}>
          <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#00B894" }}>Profile</div>
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px" }}>
              <div style={{ width:80, height:80, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, margin:"0 auto 16px" }}>👤</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21", marginBottom:8 }}>Join Lendie</div>
              <div style={{ fontSize:13, color:"#65676B", marginBottom:28, lineHeight:1.6 }}>Sign up to list items, save favorites, and connect with neighbors.</div>
              <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }}>Create account</button>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"13px", borderRadius:12, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }}>Sign in</button>
            </div>
          )}
          {user && (
            <>
              <div style={{ background:"#fff", padding:"32px 16px 24px", textAlign:"center", borderBottom:"1px solid #E4E6EB" }}>
                <div style={{ position:"relative", width:80, height:80, margin:"0 auto 14px" }}>
                  <label style={{ cursor:"pointer", display:"block", width:80, height:80, borderRadius:"50%", overflow:"hidden" }}>
                    {profilePhotoUrl
                      ? <img src={profilePhotoUrl} alt="Profile" style={{ width:80, height:80, objectFit:"cover" }}/>
                      : <div style={{ width:80, height:80, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, color:"#fff", fontWeight:800 }}>
                          {(user.user_metadata?.name||"L")[0].toUpperCase()}
                        </div>
                    }
                    <input type="file" accept="image/*" style={{ display:"none" }} onChange={handleProfilePhotoUpload}/>
                  </label>
                  <div style={{ position:"absolute", bottom:0, right:0, background:"#00B894", borderRadius:"50%", width:26, height:26, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, border:"2px solid #fff", pointerEvents:"none" }}>📷</div>
                </div>
                <div style={{ fontSize:20, fontWeight:800, color:"#1C1E21" }}>{user.user_metadata?.name || "Lendie User"}</div>
                <div style={{ fontSize:13, color:"#65676B", marginTop:4 }}>{user.email}</div>
                <div style={{ fontSize:11, color:"#8A8D91", marginTop:4 }}>Tap photo to change</div>
              </div>
              <div style={{ display:"flex", gap:12, padding:16 }}>
                {[["Listings",myListings.length],["Saved",favorites.length],["Messages",messages.length]].map(([label,val])=>(
                  <div key={label} style={{ flex:1, background:"#F0F2F5", borderRadius:12, padding:"12px 8px", textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:"#00B894" }}>{val}</div>
                    <div style={{ fontSize:11, color:"#65676B", marginTop:2 }}>{label}</div>
                  </div>
                ))}
              </div>
              {myListings.length > 0 && (
                <div style={{ padding:"0 16px 16px" }}>
                  <div style={{ fontSize:15, fontWeight:800, color:"#1C1E21", marginBottom:12 }}>My Listings</div>
                  {myListings.map(l => (
                    <div key={l.id} onClick={()=>{ setSelectedItem({...l,owner:user.user_metadata?.name||"You",ownerAvatar:"🧑",ownerId:"me",distance:0}); setTab("browse"); }} style={{ display:"flex", gap:12, background:"#F7F8FA", borderRadius:12, border:"1px solid #E4E6EB", padding:"12px 14px", marginBottom:10, cursor:"pointer", alignItems:"center" }}>
                      <div style={{ width:48, height:48, borderRadius:10, background:(l.color||"#eee")+"15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0, overflow:"hidden" }}>
                        {l.uploadedImages?.[0] ? <img src={l.uploadedImages[0].url} alt="" style={{ width:48, height:48, objectFit:"cover" }}/> : l.emoji}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:13, color:"#1C1E21" }}>{l.title}</div>
                        <div style={{ fontSize:11, color:"#65676B" }}>${l.price}/{l.priceUnit||"day"}</div>
                      </div>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:l.available?"#31A24C":"#FA3E3E", flexShrink:0 }}/>
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const TODAY = "2026-06-02";
                const myRentals = bookingRequests.filter(r => r.status === "accepted").sort((a, b) => b.start > a.start ? 1 : -1);
                if (myRentals.length === 0) return null;
                return (
                  <div style={{ padding:"0 16px 16px" }}>
                    <div style={{ fontSize:15, fontWeight:800, color:"#1C1E21", marginBottom:12 }}>My Rentals</div>
                    {myRentals.map(req => {
                      const completed = (req.end || req.start) <= TODAY;
                      const reviewed = reviewedBookings[req.id];
                      return (
                        <div key={req.id} style={{ background:"#F7F8FA", borderRadius:12, border:"1px solid #E4E6EB", padding:"12px 14px", marginBottom:10 }}>
                          <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                            <div style={{ width:44, height:44, borderRadius:10, background:(req.item.color||"#eee")+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{req.item.emoji}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:700, fontSize:13, color:"#1C1E21" }}>{req.item.title}</div>
                              <div style={{ fontSize:11, color:"#65676B" }}>{req.item.owner} · {req.dateStr}</div>
                              {completed && !reviewed && (
                                <button onClick={()=>setReviewingBooking(req)}
                                  style={{ marginTop:8, padding:"6px 14px", borderRadius:8, border:"1.5px solid #00B894", background:"#fff", color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                  ★ Leave a review
                                </button>
                              )}
                              {completed && reviewed && (
                                <div style={{ marginTop:6, fontSize:11, color:"#31A24C", fontWeight:600 }}>✓ Review submitted</div>
                              )}
                              {!completed && (
                                <>
                                  <div style={{ marginTop:8, padding:"8px 10px", borderRadius:8, background:"#FFF7ED", border:"1px solid #FFE0B2", fontSize:11, color:"#E87722", fontWeight:600, lineHeight:1.5 }}>
                                    Contact the owner to arrange payment — Lendie payments coming soon!
                                  </div>
                                  <button
                                    onClick={()=>{
                                      const convo = messages.find(m => m.item === req.item.title);
                                      if (convo) { setActiveConvo(convo); markConvoRead(convo); }
                                      setTab("messages");
                                    }}
                                    style={{ marginTop:6, padding:"6px 14px", borderRadius:8, border:"none", background:"#00B894", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                    Message Owner
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <div style={{ padding:"0 16px 40px", display:"flex", flexDirection:"column", gap:10 }}>
                <button onClick={async()=>{ await supabase.auth.signOut(); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"1.5px solid #FA3E3E", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#FFF0F0", color:"#FA3E3E" }}>
                  Sign Out
                </button>
                <button onClick={()=>setShowDeleteAccountModal(true)} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:600, fontSize:13, cursor:"pointer", background:"none", color:"#8A8D91" }}>
                  Delete Account
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <ItemDetailSheet
        item={selectedItem}
        requestSent={requestSent}
        favorites={favorites}
        toggleFav={toggleFav}
        allItems={allItems}
        OWNERS={OWNERS}
        setOwnerProfileId={setOwnerProfileId}
        setPhotoBrowser={setPhotoBrowser}
        onDismiss={()=>setSelectedItem(null)}
        setPaymentModal={setPaymentModal}
        setPaymentStep={setPaymentStep}
        onConfirmBooking={(s,e)=>{
          if (!s) return;
          if (!requireAuth()) return;
          setPaymentModal({ item:selectedItem, start:s, end:e||s });
          setPaymentStep(1);
        }}
      />
      {PaymentModal()}
      {showDeleteAccountModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={()=>{ if(!deletingAccount) setShowDeleteAccountModal(false); }}>
          <div style={{ background:"#fff", borderRadius:18, padding:24, maxWidth:360, width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,0.18)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:36, textAlign:"center", marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21", textAlign:"center", marginBottom:10 }}>Delete your account?</div>
            <div style={{ fontSize:13, color:"#65676B", textAlign:"center", lineHeight:1.6, marginBottom:20 }}>
              This will permanently delete <strong>all your data</strong> — listings, bookings, messages, and reviews. <strong>This cannot be undone.</strong>
            </div>
            <button
              disabled={deletingAccount}
              onClick={async () => {
                if (!user) return;
                setDeletingAccount(true);
                try {
                  const uid = user.id;
                  await Promise.all([
                    supabase.from('listings').delete().eq('user_id', uid),
                    supabase.from('booking_requests').delete().or(`renter_id.eq.${uid},owner_id.eq.${uid}`),
                    supabase.from('messages').delete().or(`from_user_id.eq.${uid},to_user_id.eq.${uid}`),
                    supabase.from('notifications').delete().eq('user_id', uid),
                    supabase.from('push_subscriptions').delete().eq('user_id', uid),
                    supabase.from('reviews').delete().eq('user_id', uid),
                  ]);
                  await supabase.rpc('delete_current_user').catch(()=>{});
                  await supabase.auth.signOut();
                } catch(e) {
                  console.error('[DeleteAccount]', e);
                  showToast("Something went wrong. Please try again.", "error");
                  setDeletingAccount(false);
                  setShowDeleteAccountModal(false);
                }
              }}
              style={{ width:"100%", padding:"13px", borderRadius:10, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:deletingAccount?"not-allowed":"pointer", background:"#FA3E3E", color:"#fff", marginBottom:10, opacity:deletingAccount?0.6:1 }}
            >
              {deletingAccount ? "Deleting…" : "Yes, delete my account"}
            </button>
            <button
              disabled={deletingAccount}
              onClick={()=>setShowDeleteAccountModal(false)}
              style={{ width:"100%", padding:"12px", borderRadius:10, border:"1.5px solid #E4E6EB", fontFamily:"inherit", fontWeight:600, fontSize:15, cursor:"pointer", background:"#fff", color:"#1C1E21" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <AddListingModal
        show={showAddListing}
        onClose={()=>{ setShowAddListing(false); setAddImages([]); }}
        newListing={newListing}
        setNewListing={setNewListing}
        addImages={addImages}
        setAddImages={setAddImages}
        onSubmit={handleAddListing}
        S={S}
        C={C}
        ALL_CATS={ALL_CATS}
        userId={user?.id}
        onError={showToast}
      />
      {NotifPanel()}
      {!isDesktop && <ChatView
        activeConvo={activeConvo}
        setActiveConvo={setActiveConvo}
        chatMsg={chatMsg}
        setChatMsg={setChatMsg}
        messages={messages}
        setMessages={setMessages}
        msgEndRef={msgEndRef}
        user={user}
        onSend={handleSendMessage}
        isDesktop={false}
        profilePhotoUrl={profilePhotoUrl}
      />}
      <OwnerProfileModal
        ownerId={ownerProfileId}
        allItems={allItems}
        onClose={()=>setOwnerProfileId(null)}
        onSelectItem={item=>{ setSelectedItem(item); setOwnerProfileId(null); }}
        onMessage={owner=>{
          if (!requireAuth()) return;
          setOwnerProfileId(null);
          const ex = messages.find(m=>m.fromId===owner.id);
          if (ex) { setActiveConvo(ex); }
          else {
            const convId = `conv_${Date.now()}`;
            const nm = { id:Date.now(), conversation_id:convId, from:owner.name, fromId:owner.id, avatar:owner.avatar, item:"General inquiry", time:"Just now", unread:false, thread:[] };
            setMessages(prev=>[...prev,nm]); setActiveConvo(nm);
          }
          setTab("messages");
        }}
      />
      <PhotoBrowserModal data={photoBrowser} onClose={()=>setPhotoBrowser(null)}/>
      {blockingDatesFor && (() => {
        const listing = myListings.find(l => l.id === blockingDatesFor);
        if (!listing) return null;
        return (
          <BlockDatesModal
            listing={listing}
            onClose={()=>setBlockingDatesFor(null)}
            onSave={async(newBooked)=>{
              const{error}=await supabase.from('listings').update({booked:newBooked}).eq('id',listing.id);
              if(error){showToast("Failed to save dates","error");return;}
              setMyListings(prev=>prev.map(l=>l.id===listing.id?{...l,booked:newBooked}:l));
              setBlockingDatesFor(null);
              showToast("Availability updated!");
            }}
          />
        );
      })()}
      {deletingId && (
        <div style={S.overlay} onClick={()=>setDeletingId(null)}>
          <div style={{ ...S.sheet, maxHeight:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>Delete listing?</div>
            <div style={{ fontSize:13, color:"#65676B", marginBottom:20 }}>This cannot be undone.</div>
            <button style={{ ...S.pBtn, background:"#FA3E3E" }} onClick={async()=>{ const{error}=await supabase.from('listings').delete().eq('id',deletingId); if(!error){setMyListings(prev=>prev.filter(l=>l.id!==deletingId));setDeletingId(null);showToast("Listing deleted");}else{showToast("Failed to delete","error");} }}>Delete</button>
            <button style={S.gBtn} onClick={()=>setDeletingId(null)}>Cancel</button>
          </div>
        </div>
      )}
      {reviewingBooking && (
        <ReviewModal
          booking={reviewingBooking}
          onClose={()=>setReviewingBooking(null)}
          onSubmit={handleSubmitReview}
        />
      )}
      <AuthModal show={showAuthModal} initialMode={authModalMode} onClose={()=>setShowAuthModal(false)}/>
      <Toast toast={toast}/>

      {/* Desktop footer */}
      {isDesktop && (
        <footer style={{ background:"#fff", borderTop:"1px solid #E4E6EB", marginTop:40, padding:"24px 10px 16px" }}>
          <div style={{ display:"flex", gap:40, alignItems:"flex-start" }}>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <svg width="28" height="28" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius:6 }}>
                  <rect width="512" height="512" rx="110" fill="#00B894"/>
                  <rect x="112" y="82" width="92" height="268" rx="22" fill="white"/>
                  <rect x="112" y="308" width="244" height="92" rx="22" fill="white"/>
                  <circle cx="178" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
                  <circle cx="256" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
                  <circle cx="334" cy="448" r="27" fill="rgba(255,255,255,0.88)"/>
                </svg>
                <span style={{ fontSize:18, fontWeight:900, color:"#00B894" }}>Lendie</span>
              </div>
              <div style={{ fontSize:13, color:"#65676B", lineHeight:1.6, maxWidth:280 }}>Rent anything from your neighbors. Earn money from things you already own.</div>
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:"#1C1E21", marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Explore</div>
              {["Browse listings","My items","Messages","Map"].map((l,i)=>(
                <div key={l} onClick={()=>setTab(["browse","listings","messages","map"][i])} style={{ fontSize:13, color:"#65676B", marginBottom:6, cursor:"pointer" }}>{l}</div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:"#1C1E21", marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>For owners</div>
              {["List an item","Manage listings","Booking requests","Earnings"].map(l=>(
                <div key={l} onClick={()=>setTab("listings")} style={{ fontSize:13, color:"#65676B", marginBottom:6, cursor:"pointer" }}>{l}</div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:"#1C1E21", marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Get the app</div>
              <div style={{ background:"#00B894", color:"#fff", borderRadius:10, padding:"10px 16px", fontSize:13, fontWeight:700, cursor:"pointer", display:"inline-block", marginBottom:8 }} onClick={()=>setShowInstallBanner(true)}>
                📱 Add to Home Screen
              </div>
              <div style={{ fontSize:12, color:"#65676B" }}>Works on iOS & Android</div>
            </div>
          </div>
          <div style={{ margin:"20px 0 0", paddingTop:16, borderTop:"1px solid #E4E6EB", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:12, color:"#8A8D91" }}>© 2026 Lendie. Peer-to-peer rentals made simple.</div>
            <div style={{ fontSize:12, color:"#8A8D91" }}>Built with ❤️ for neighbors everywhere</div>
          </div>
        </footer>
      )}

      <nav style={S.nav}>
        {[
          {id:"browse", icon:"🏠", label:"Browse"},
          {id:"listings", icon:"📦", label:"My Items"},
          {id:"messages", icon:"💬", label:"Inbox", badge:unreadMsgs},
          {id:"map", icon:"🗺️", label:"Map"},
        ].map(n=>(
          <div key={n.id} onClick={()=>{ setTab(n.id); if(activeConvo&&n.id!=="messages") setActiveConvo(null); }} style={{ flex:1, padding:"10px 0 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer", color:tab===n.id?"#00B894":"#65676B", fontSize:9, fontWeight:tab===n.id?700:500, position:"relative" }}>
            <span style={{ fontSize:22 }}>{n.icon}</span>
            {n.label}
            {n.badge>0 && <div style={{ position:"absolute", top:5, right:"16%", background:"#FA3E3E", borderRadius:"50%", width:14, height:14, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:"#fff" }}>{n.badge}</div>}
          </div>
        ))}
      </nav>
    </div>
  );
}