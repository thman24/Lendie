import { useState, useRef, useEffect, useMemo } from "react";
import { Bell, LayoutGrid, Wrench, Truck, Hammer, Utensils, Leaf, Compass, Building2, Sparkles, Monitor, Package, MapPin, Camera, Heart, Search, Tag, ChevronDown, Star, Pencil, MessageCircle, CheckCircle2, XCircle, RotateCcw, Clock, ShoppingCart, DollarSign, Inbox, PartyPopper, Ban, CreditCard } from "lucide-react";
import { supabase } from './supabase';

// Soft-launch switch: when true, card payments are OFF (cash only) — the build
// tree-shakes the Stripe key out entirely, so users see "card coming soon" and
// the Payouts dashboard is hidden. To enable card payments: set this to false
// AND add the LIVE VITE_STRIPE_PUBLISHABLE_KEY in Vercel.
const CASH_ONLY_LAUNCH = true;
const STRIPE_KEY = CASH_ONLY_LAUNCH ? '' : (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');
const OWNER_ID = '8f7af82b-b44e-436f-995a-530eb24925e8';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

// Maps a notification's legacy emoji (and falls back on its type) to a clean
// Lucide icon + brand color, so the bell panel looks native instead of using
// the OS emoji glyphs.
const NOTIF_ICON_MAP = {
  "✅": { Icon: CheckCircle2, color: "#00B894" },
  "🎉": { Icon: PartyPopper,  color: "#00B894" },
  "💰": { Icon: DollarSign,   color: "#00B894" },
  "💸": { Icon: DollarSign,   color: "#00B894" },
  "❌": { Icon: XCircle,      color: "#FA3E3E" },
  "↩️": { Icon: RotateCcw,    color: "#007AFF" },
  "⏳": { Icon: Clock,        color: "#E87722" },
  "🛒": { Icon: ShoppingCart, color: "#E87722" },
  "🧰": { Icon: Wrench,       color: "#7B61FF" },
  "📬": { Icon: Inbox,        color: "#007AFF" },
};
function NotifIcon({ emoji, type, dark }) {
  let m = NOTIF_ICON_MAP[emoji];
  if (!m) {
    if (type === 'declined' || type === 'cancel') m = { Icon: XCircle, color: "#FA3E3E" };
    else if (type === 'request') m = { Icon: Bell, color: "#E87722" };
    else m = { Icon: CheckCircle2, color: "#00B894" };
  }
  const I = m.Icon;
  return (
    <div style={{ width:34, height:34, borderRadius:"50%", background: m.color + (dark ? "26" : "1F"), display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <I size={18} strokeWidth={2} color={m.color} />
    </div>
  );
}

function CatIcon({ id, size=14, strokeWidth=1.75 }) {
  const map = { all:LayoutGrid, tools:Wrench, trailers:Truck, construction:Hammer, kitchen:Utensils, garden:Leaf, outdoors:Compass, venues:Building2, party:Sparkles, tech:Monitor, other:Package,
    svc_lawn:Leaf, svc_clean:Sparkles, svc_move:Truck, svc_handy:Hammer, svc_tech:Monitor, svc_venue:Building2, svc_other:Package };
  const Icon = map[id] || Tag;
  return <Icon size={size} strokeWidth={strokeWidth}/>;
}

// Service categories (listingType === 'service'). Kept separate from item
// categories so the rent/buy taxonomy stays clean; ids are svc_-prefixed to
// avoid colliding with item category ids in the shared category filter.
const SERVICE_CATS = [
  { id:"svc_lawn",  label:"Lawn & Yard",   emoji:"🌿", icon:Leaf },
  { id:"svc_clean", label:"Cleaning",      emoji:"🧽", icon:Sparkles },
  { id:"svc_move",  label:"Moving & Labor",emoji:"📦", icon:Truck },
  { id:"svc_handy", label:"Handyman",      emoji:"🛠️", icon:Hammer },
  { id:"svc_tech",  label:"Tech Help",     emoji:"💻", icon:Monitor },
  { id:"svc_venue", label:"Venues",        emoji:"🏛️", icon:Building2 },
  { id:"svc_other", label:"Other",         emoji:"🧰", icon:Package },
];
const SERVICE_CAT_LABELS = { svc_lawn:"Lawn & Yard", svc_clean:"Cleaning", svc_move:"Moving & Labor", svc_handy:"Handyman", svc_tech:"Tech Help", svc_venue:"Venues", svc_other:"Other" };
// How a service's price unit reads on cards/detail.
const SERVICE_UNIT_LABEL = { hour:"hr", visit:"visit", job:"job" };

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

// Human-friendly distance label. Returns null when distance is unknown (no
// viewer location or no listing coordinates) so callers can hide it rather than
// print a misleading "0 mi away".
function formatDistance(d) {
  if (d == null || isNaN(d)) return null;
  if (d < 0.1) return "Near you";
  if (d < 10) return `${d.toFixed(1)} mi away`;
  return `${Math.round(d)} mi away`;
}

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const VAPID_PUBLIC_KEY = 'BApnfC-Tg2ygXMqneDuuD9-KOwWHJjUa5W7Na4dJwF7KQKkDKjnsdwQKvb-CQ9NW7x0mRuS-ErUKur3LgdQeUI0';

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function broadcastMessage(targetUserId, payload) {
  if (!targetUserId || targetUserId === 'me') return;
  const ch = supabase.channel(`inbox-${targetUserId}`);
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      ch.send({ type: 'broadcast', event: 'new_message', payload });
      setTimeout(() => supabase.removeChannel(ch), 2000);
    }
  });
}

async function sendPushToUser(userId, { title, body, url, tag }) {
  if (!userId || userId === 'me') return;
  try {
    await supabase.functions.invoke('send-push', { body: { userId, title, body, url, tag } });
  } catch (e) {
    console.warn('[Push] send failed:', e.message);
  }
}

async function sendEmail(userId, subject, html) {
  if (!userId || userId === 'me') return;
  try {
    await supabase.functions.invoke('send-email', { body: { userId, subject, html } });
  } catch (e) {
    console.warn('[Email] send failed:', e.message);
  }
}

// Downscale + bake EXIF orientation before upload — raw phone photos are 5-10MB
// and display sideways-cropped otherwise. Falls back to the original on any failure.
async function downscaleImage(file, maxDim = 1600, quality = 0.82) {
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    // img dimensions are EXIF-oriented in modern browsers, so drawing bakes the rotation
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

// Small image for cards/lists; falls back to the full image for older listings
// (uploaded before thumbnails existed) or when the thumb upload was skipped.
const thumbSrc = (img) => img?.thumb || img?.url || null;

const emailBtn = (label, url = 'https://www.lendie.app') =>
  `<a href="${url}" style="display:inline-block;background:#00B894;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">${label}</a>`;

function PlacesAutocompleteInput({ placeholder, containerStyle, inputStyle, onAddressChange, onPlaceSelect, darkMode: _darkMode }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef(null);
  const darkMode = _darkMode || false;
  const C = darkMode ? { bg:'#1C1C1E', border:'#2C2C2E', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { bg:'#fff', border:'#E4E6EB', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };

  const fetchSuggestions = async (input) => {
    if (!input.trim() || input.length < 2) { setSuggestions([]); return; }
    setFetching(true);
    try {
      const body = { input };
      const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": MAPS_API_KEY },
        body: JSON.stringify(body),
      });
      const data = await res.json();
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
      setValue(addr);
      onAddressChange(addr);
      if (lat != null && lng != null) {
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
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    fontFamily: "inherit", fontSize: 14, outline: "none",
    boxSizing: "border-box", color: C.text,
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
        <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:12, color:C.muted, pointerEvents:"none" }}>…</div>
      )}
      {open && suggestions.length > 0 && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, zIndex:9999, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", maxHeight:220, overflowY:"auto", marginTop:4 }}>
          {suggestions.map((s, i) => {
            const pred = s.placePrediction;
            const main = pred.structuredFormat?.mainText?.text || pred.text?.text || "";
            const secondary = pred.structuredFormat?.secondaryText?.text || "";
            return (
              <div key={pred.placeId || i} onMouseDown={() => handleSelect(s)}
                style={{ padding:"10px 14px", cursor:"pointer", borderBottom: i < suggestions.length-1 ? `1px solid ${darkMode ? '#2C2C2E' : '#F0F2F5'}` : "none", fontSize:13 }}>
                <div style={{ fontWeight:600, color:C.text }}>{main}</div>
                {secondary && <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{secondary}</div>}
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
  { id:"party",        label:"Party",        emoji:"🎉" },
  { id:"tech",         label:"Tech",         emoji:"💻" },
];

// Browse category grid (with Lucide icons). Module-scope so it can't land in a
// temporal dead zone when referenced by the `filtered` memo during render.
const ALL_CATS = [
  {id:"tools",label:"Tools",emoji:"🔧",icon:Wrench},{id:"trailers",label:"Trailers",emoji:"🚛",icon:Truck},
  {id:"construction",label:"Equipment",emoji:"🏗️",icon:Hammer},{id:"kitchen",label:"Kitchen",emoji:"🍳",icon:Utensils},
  {id:"garden",label:"Garden",emoji:"🌱",icon:Leaf},{id:"outdoors",label:"Outdoors",emoji:"🏕️",icon:Compass},
  {id:"party",label:"Party",emoji:"🎉",icon:Sparkles},
  {id:"tech",label:"Tech",emoji:"💻",icon:Monitor},{id:"other",label:"Other",emoji:"📦",icon:Package}
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

// Date fragment for automated messages — purchases and offers have no dates,
// so phrases like "on Purchase" never appear
function reqWhen(dateStr, prefix = ' on ') {
  if (!dateStr || dateStr === 'Purchase' || dateStr.startsWith('Offer')) return '';
  return prefix + dateStr;
}

// Turn http(s) URLs in free text into tappable links (keeps surrounding text).
function linkify(text, linkColor = "#00B894") {
  if (!text) return text;
  return String(text).split(/(https?:\/\/[^\s]+)/g).map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      // Trailing sentence punctuation usually isn't part of the URL.
      const trail = (part.match(/[.,;:!?)\]]+$/) || [''])[0];
      const url = trail ? part.slice(0, -trail.length) : part;
      return (
        <span key={i}>
          <a href={url} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ color:linkColor, textDecoration:"underline", overflowWrap:"anywhere", wordBreak:"break-word" }}>{url}</a>{trail}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// Known emoji that system/auto messages prefix their text with. In chat we
// strip the leading glyph and render a matching inline Lucide icon instead, so
// bubbles look native rather than showing OS emoji art.
const CHAT_EMOJI = {
  "✅": { Icon: CheckCircle2, color: "#00B894" },
  "💸": { Icon: DollarSign,   color: "#00B894" },
  "🎉": { Icon: PartyPopper,  color: "#00B894" },
  "🧰": { Icon: Wrench,       color: "#7B61FF" },
  "🛒": { Icon: ShoppingCart, color: "#E87722" },
  "🚫": { Icon: Ban,          color: "#FA3E3E" },
  "❌": { Icon: XCircle,      color: "#FA3E3E" },
  "↩️": { Icon: RotateCcw,    color: "#007AFF" },
};
// Render a chat message: pull a leading known emoji into an inline Lucide icon,
// then linkify the rest. `mine` tints the icon white so it stays visible on the
// green sent bubble.
function renderMsg(text, mine) {
  if (!text) return text;
  let str = String(text), lead = null;
  for (const e of Object.keys(CHAT_EMOJI)) {
    if (str.startsWith(e)) { lead = e; str = str.slice(e.length).replace(/^\s+/, ""); break; }
  }
  const meta = lead ? CHAT_EMOJI[lead] : null;
  const linkColor = mine ? "#EAF7F2" : "#00B894";
  const iconColor = mine ? "#EAF7F2" : meta?.color;
  const I = meta?.Icon;
  return (
    <>
      {I && <I size={15} strokeWidth={2.25} color={iconColor} style={{ display:"inline", verticalAlign:"-2.5px", marginRight:5 }} />}
      {linkify(str, linkColor)}
    </>
  );
}

// Noun for a transaction in user-facing copy: service / offer / purchase / rental.
function txNoun(req) {
  if (req?.item?.listingType === 'service') return 'service';
  if (req?.dateStr === 'Purchase') return 'purchase';
  if (req?.dateStr === 'Offer' || req?.dateStr?.startsWith('Offer')) return 'offer';
  return 'rental';
}

// A transaction is "past" — and can no longer be cancelled or refunded — once it
// has been completed, or (for rentals) once its last date is before today.
// Dateless transactions (sales/services) are only "past" when marked completed.
function isPastTransaction(req) {
  if (!req) return false;
  if (req.status === 'completed') return true;
  const lastDay = req.end || req.start; // rentals carry dates; sales/services don't
  if (lastDay) {
    const today = new Date().toISOString().slice(0, 10);
    if (String(lastDay).slice(0, 10) < today) return true;
  }
  return false;
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
function StarRow({ rating, count, size=13, darkMode }) {
  if (!rating) return null;
  const emptyClr = darkMode ? "#48484A" : "#CDD0D4";
  const textClr  = darkMode ? "#AEAEB2" : "#65676B";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
      {[1,2,3,4,5].map(s => <span key={s} style={{ color:s<=Math.round(rating)?"#F5A623":emptyClr, fontSize:size }}>&#9733;</span>)}
      <span style={{ fontSize:size, color:textClr }}>{rating} ({count})</span>
    </div>
  );
}

// RangeCalendar
function RangeCalendar({ booked=[], startDate, endDate, onRangeChange, darkMode }) {
  const rc = darkMode
    ? { bg:"#1C1C1E", border:"#2C2C2E", text:"#F2F2F7", muted:"#8E8E93", navBg:"#2C2C2E", pastClr:"#48484A", dayHdr:"#636366" }
    : { bg:"#fff", border:"#E4E6EB", text:"#1C1E21", muted:"#65676B", navBg:"#F0F2F5", pastClr:"#CDD0D4", dayHdr:"#8A8D91" };
  const today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
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
    <div style={{ background:rc.bg, borderRadius:14, padding:14, border:`1px solid ${rc.border}`, marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }} style={{ background:rc.navBg, border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16, color:rc.text }}>&#8249;</button>
        <div style={{ fontWeight:700, fontSize:14, color:rc.text }}>{MONTHS[month]} {year}</div>
        <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }} style={{ background:rc.navBg, border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16, color:rc.text }}>&#8250;</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, textAlign:"center" }}>
        {DAYS.map(d => <div key={d} style={{ fontSize:10, color:rc.dayHdr, fontWeight:700, paddingBottom:6 }}>{d}</div>)}
        {cells.map((d,i) => {
          if (!d) return <div key={i} />;
          const past=isPast(d), bkd=isBooked(d), s=isStart(d), en=isEnd(d), rng=inRange(d);
          return (
            <div key={i} onMouseDown={e=>e.preventDefault()} onClick={e=>handleDay(e,d)}
              title={bkd?"Already booked":undefined}
              style={{ borderRadius: s?"8px 0 0 8px": en?"0 8px 8px 0": rng?"0":"8px", padding:"7px 2px 5px", fontSize:12, fontWeight:(s||en)?700:500, cursor:past||bkd?"not-allowed":"pointer", background: s||en?"#00B894": rng?(darkMode?"#00B89430":"#E8FBF6"): bkd?"#DC2626":"transparent", color: s||en?"#fff": bkd?"#fff": past?rc.pastClr:rc.text, opacity:past?0.35:1, userSelect:"none", position:"relative", textDecoration:bkd?"line-through":"none" }}>
              {d}
              {bkd && <div style={{ fontSize:7, fontWeight:700, letterSpacing:0, lineHeight:1, marginTop:1, opacity:0.85 }}>BOOKED</div>}
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:12, marginTop:12, fontSize:11, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#00B894" }}/><span style={{ color:rc.muted }}>Selected</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:darkMode?"#00B89430":"#E8FBF6", border:`1px solid ${darkMode?"#00B89460":"#B2EFE3"}` }}/><span style={{ color:rc.muted }}>Range</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#DC2626" }}/><span style={{ color:rc.muted }}>Booked</span></div>
      </div>
    </div>
  );
}


// PhotoBrowserModal
function PhotoBrowserModal({ data, onClose, darkMode }) {
  const card = darkMode ? "#1C1C1E" : "#fff";
  const border = darkMode ? "#2C2C2E" : "#E4E6EB";
  const text = darkMode ? "#F2F2F7" : "#1C1E21";
  const muted = darkMode ? "#AEAEB2" : "#65676B";
  const [idx, setIdx] = useState(data ? (data.startIdx || 0) : 0);
  if (!data) return null;
  const imgs = (data.uploadedImages||[]).map(i=>({ t:"img", s:i.url }));
  const all = imgs.length > 0 ? imgs : (data.photos||[]).map(p=>({ t:"emoji", s:p }));
  if (!all.length) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:900, display:"flex", alignItems:"center", justifyContent:"center", padding:16, boxSizing:"border-box" }} onClick={onClose}>
      {/* Close button — top right */}
      <button onClick={onClose} style={{ position:"absolute", top:14, right:16, width:40, height:40, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.5)", color:"#fff", fontSize:22, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2 }}>×</button>
      <div style={{ background:card, borderRadius:16, overflow:"hidden", border:`1px solid ${border}`, width:"100%", maxWidth:1000, maxHeight:"94vh", display:"flex", flexDirection:"column" }} onClick={e=>e.stopPropagation()}>
        <div style={{ flex:1, minHeight:0, display:"flex", alignItems:"center", justifyContent:"center", background:"#000", position:"relative" }}>
          {all[idx].t==="img"
            ? <img src={all[idx].s} alt="" style={{ maxWidth:"100%", maxHeight:"100%", width:"auto", height:"auto", objectFit:"contain", display:"block" }}/>
            : <span style={{ fontSize:140 }}>{all[idx].s}</span>}
          {all.length > 1 && (
            <div style={{ position:"absolute", bottom:12, left:0, right:0, display:"flex", justifyContent:"center", gap:6 }}>
              {all.map((_,i) => <div key={i} onClick={e=>{e.stopPropagation();setIdx(i);}} style={{ width:i===idx?20:8, height:8, borderRadius:4, background:i===idx?"#00B894":"rgba(255,255,255,0.6)", cursor:"pointer", transition:"all 0.2s" }}/>)}
            </div>
          )}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px", borderTop:`1px solid ${border}`, flexShrink:0 }}>
          <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.max(0,i-1));}} style={{ background:"none", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, fontSize:18, color:text, opacity:idx===0?0.3:1 }} disabled={idx===0}>&larr;</button>
          <span style={{ fontSize:13, color:muted }}>{idx+1} / {all.length}</span>
          <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.min(all.length-1,i+1));}} style={{ background:"none", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, fontSize:18, color:text, opacity:idx===all.length-1?0.3:1 }} disabled={idx===all.length-1}>&rarr;</button>
        </div>
      </div>
    </div>
  );
}

// StripePaymentModal — activates when VITE_STRIPE_PUBLISHABLE_KEY is set
function StripePaymentModal({ paymentModal, user, wantsDelivery, deliveryAddress, onDismiss, onSuccess, C, S }) {
  const [stripe, setStripe] = useState(null);
  const [elements, setElements] = useState(null);
  const [cardError, setCardError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [tosChecked, setTosChecked] = useState(false);
  const cardRef = useRef(null);
  const cardMounted = useRef(false);

  // Load Stripe.js once
  useEffect(() => {
    if (!STRIPE_KEY) return;
    if (window.Stripe) { setStripe(window.Stripe(STRIPE_KEY)); return; }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => setStripe(window.Stripe(STRIPE_KEY));
    document.head.appendChild(script);
  }, []);

  // Mount card element when stripe is ready and modal is open
  useEffect(() => {
    if (!stripe || !paymentModal || !cardRef.current || cardMounted.current) return;
    const els = stripe.elements();
    const card = els.create('card', {
      style: { base: { fontSize: '16px', color: '#1C1E21', fontFamily: "'Helvetica Neue', Arial, sans-serif", '::placeholder': { color: '#8A8D91' } } },
    });
    card.mount(cardRef.current);
    card.on('change', e => setCardError(e.error ? e.error.message : ''));
    setElements(els);
    cardMounted.current = true;
    return () => { card.unmount(); cardMounted.current = false; };
  }, [stripe, paymentModal]);

  if (!paymentModal) return null;
  const { item, start, end } = paymentModal;
  const isPurchase = paymentModal.purchase || !start;

  // Delayed charge: rentals / dated services more than 24h out save the card now
  // (no charge) and get charged 24h before the rental day. Sales, undated
  // services, and last-minute bookings charge immediately at this step.
  const SCHEDULE_LEAD_MS = 24 * 60 * 60 * 1000;
  const chargeAtMs = start ? new Date(`${start}T00:00:00Z`).getTime() - SCHEDULE_LEAD_MS : 0;
  const willSchedule = !isPurchase && !!start && chargeAtMs > Date.now();
  const chargeDateLabel = willSchedule ? new Date(chargeAtMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;

  // Calculate breakdown client-side (item was loaded from DB, server re-validates on pay)
  const days = start && end ? Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1) : 1;
  const unitMul = { hour: 1, day: days, night: days, week: Math.ceil(days / 7) };
  // A flat agreed amount (service quote or accepted offer) overrides the per-unit math.
  const flatPrice = paymentModal.offerPrice != null ? Number(paymentModal.offerPrice) : null;
  const rentalTotal = flatPrice != null ? flatPrice : item.price * (unitMul[item.priceUnit || 'day'] ?? days);
  const deliveryTotal = (flatPrice == null && wantsDelivery && item.deliveryFee) ? Number(item.deliveryFee) : 0;
  const serviceFee = Math.round(rentalTotal * 0.08 * 100) / 100;
  const grandTotal = rentalTotal + deliveryTotal + serviceFee;
  const fmt = n => `$${Number(n).toFixed(2)}`;

  const handlePay = async () => {
    if (!stripe || !elements || processing || !tosChecked) return;
    setProcessing(true);
    setCardError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      // Delayed-charge path: save the card via a SetupIntent — no money moves now.
      // The charge-due-bookings cron charges it 24h before the rental day.
      if (willSchedule) {
        const sRes = await fetch(`${SUPABASE_URL}/functions/v1/create-setup-intent`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            listingId: item.id, startDate: start, endDate: end,
            wantsDelivery, deliveryAddress: wantsDelivery ? deliveryAddress : null,
            existingBookingId: paymentModal?.existingBookingId ?? null,
          }),
        });
        const { clientSecret, bookingDbId, chargeAt, breakdown: bd, error: fnErr } = await sRes.json();
        if (fnErr) throw new Error(fnErr);
        const cardEl = elements.getElement('card');
        const { error: setupErr, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
          payment_method: { card: cardEl, billing_details: { name: user.user_metadata?.name || user.email } },
        });
        if (setupErr) throw new Error(setupErr.message);
        if (setupIntent && setupIntent.status !== 'succeeded' && setupIntent.status !== 'processing') {
          throw new Error('Could not save your card. Please try again or use a different card.');
        }
        onSuccess({ bookingDbId, scheduled: true, chargeAt, amountCents: bd?.amountCents ?? Math.round(grandTotal * 100) });
        return;
      }

      // Server fetches authoritative price from DB and creates the booking record atomically
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-intent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: item.id, startDate: start, endDate: end,
          wantsDelivery, deliveryAddress: wantsDelivery ? deliveryAddress : null,
          existingBookingId: paymentModal?.existingBookingId ?? null,
        }),
      });
      const { clientSecret, bookingDbId, breakdown: bd, error: fnErr } = await res.json();
      if (fnErr) throw new Error(fnErr);

      const cardElement = elements.getElement('card');
      const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement, billing_details: { name: user.user_metadata?.name || user.email } },
      });
      if (stripeErr) throw new Error(stripeErr.message);
      // Only treat the payment as done if Stripe actually confirms it. 'succeeded'
      // is the normal card outcome; 'processing' settles via webhook. Anything else
      // (e.g. requires_action that didn't resolve) is not a completed payment.
      if (paymentIntent && paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
        throw new Error('Payment could not be completed. Please try again or use a different card.');
      }

      onSuccess({ bookingDbId, amountCents: bd?.amountCents ?? Math.round(grandTotal * 100) });
    } catch (e) {
      setCardError(e.message || 'Payment failed');
      setProcessing(false);
    }
  };

  const canPay = stripe && tosChecked && !processing;

  return (
    <div style={{ ...S.overlay, zIndex:400 }} onClick={onDismiss}>
      <div style={{ ...S.sheet, zIndex:401 }} onClick={e=>e.stopPropagation()}>
        <div style={{ textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:32, marginBottom:6 }}>{item.emoji}</div>
          <div style={{ fontSize:17, fontWeight:800, color:C.text }}>{item.title}</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{item.owner}</div>
        </div>

        {/* Price breakdown */}
        <div style={{ background:C.surface || C.card, borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:13, border:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ color:C.muted }}>{flatPrice != null ? (isPurchase && !start ? "Price" : "Agreed price") : `Rental (${days} day${days!==1?"s":""})`}</span>
            <span style={{ fontWeight:600, color:C.text }}>{fmt(rentalTotal)}</span>
          </div>
          {deliveryTotal > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <span style={{ color:C.muted }}>Delivery</span>
              <span style={{ fontWeight:600, color:C.text }}>{fmt(deliveryTotal)}</span>
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ color:C.muted }}>Service fee (8%)</span>
            <span style={{ fontWeight:600, color:C.text }}>{fmt(serviceFee)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
            <span style={{ fontWeight:700, color:C.text }}>Total</span>
            <span style={{ fontWeight:800, color:"#00B894", fontSize:15 }}>{fmt(grandTotal)}</span>
          </div>
        </div>

        {/* Stripe card element */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:600, color:C.text, marginBottom:6 }}>Card details</div>
          <div ref={cardRef} style={{ border:"1.5px solid #CDD0D4", borderRadius:8, padding:"12px 13px", background:"#fff" }}/>
          {cardError && <div style={{ fontSize:12, color:"#FA3E3E", marginTop:6 }}>{cardError}</div>}
        </div>

        {/* Terms of service */}
        <label style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:14, cursor:"pointer" }}>
          <input
            type="checkbox"
            checked={tosChecked}
            onChange={e => setTosChecked(e.target.checked)}
            style={{ marginTop:2, accentColor:"#00B894", width:16, height:16, cursor:"pointer", flexShrink:0 }}
          />
          <span style={{ fontSize:12, color:C.muted, lineHeight:1.5 }}>
            I agree to Lendie's terms. {willSchedule
              ? <>I authorize Lendie to securely save this card and charge {fmt(grandTotal)} on <strong style={{ color:C.text }}>{chargeDateLabel}</strong> (24 hours before my rental). I can cancel <strong style={{ color:C.text }}>free of charge</strong> any time before then; after that the 8% service fee is non-refundable.</>
              : isPurchase
              ? "The 8% service fee is non-refundable if you cancel a purchase."
              : "The 8% service fee is non-refundable if you cancel."}
          </span>
        </label>

        {willSchedule && (
          <div style={{ fontSize:12, color:"#00B894", background:"#E8FBF6", border:"1px solid #B2EFE3", borderRadius:10, padding:"10px 12px", marginBottom:14, lineHeight:1.5, textAlign:"center" }}>
            💳 <strong>You won't be charged today.</strong> Your card is saved and {fmt(grandTotal)} will be charged on <strong>{chargeDateLabel}</strong> — cancel free any time before then.
          </div>
        )}

        <div style={{ fontSize:11, color:C.muted, marginBottom:14, textAlign:"center", lineHeight:1.5 }}>
          🔒 Payments securely processed by <strong style={{ color:C.text }}>Stripe</strong>. Your card details are never seen or stored by Lendie.
        </div>

        <button
          onClick={handlePay}
          disabled={!canPay}
          style={{ ...S.pBtn, opacity: canPay ? 1 : 0.5, cursor: canPay ? "pointer" : "not-allowed" }}
        >
          {processing ? "Processing…" : willSchedule ? `Save card — charged ${chargeDateLabel}` : `Pay ${fmt(grandTotal)}`}
        </button>
        <button style={S.gBtn} onClick={onDismiss}>Back</button>
      </div>
    </div>
  );
}

// ReportModal
function ReportModal({ target, user, onClose, darkMode }) {
  const REASONS = ["Spam", "Harassment", "Scam or fraud", "Inappropriate content", "Fake listing", "Other"];
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const C = darkMode ? { bg:'#000000', card:'#1C1C1E', border:'#2C2C2E', borderFaint:'#242426', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { bg:'#fff', card:'#fff', border:'#E4E6EB', borderFaint:'#F0F2F5', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  if (!target) return null;
  const handleSubmit = async () => {
    if (!reason) return;
    setSubmitting(true);
    await supabase.from('reports').insert({
      reporter_id: user.id,
      reported_user_id: target.reportedUserId || null,
      reported_listing_id: target.reportedListingId || null,
      context: target.context || 'profile',
      reason,
      details: details.trim() || null,
    });
    setSubmitting(false);
    setDone(true);
    setTimeout(onClose, 1500);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:800, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:C.card, borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxHeight:"90dvh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        {done ? (
          <div style={{ textAlign:"center", padding:"24px 0" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Report submitted</div>
            <div style={{ fontSize:13, color:C.muted, marginTop:6 }}>We'll review this and take action if needed.</div>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight:800, color:C.text }}>Report {target.reportedName}</div>
              <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:C.muted, lineHeight:1 }}>×</button>
            </div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:14 }}>What's the issue?</div>
            {REASONS.map(r => (
              <div key={r} onClick={() => setReason(r)} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:10, border:"1.5px solid " + (reason === r ? "#00B894" : C.border), background: reason === r ? "#E8FBF6" : C.card, marginBottom:8, cursor:"pointer" }}>
                <div style={{ width:18, height:18, borderRadius:"50%", border:"2px solid " + (reason === r ? "#00B894" : C.border), background: reason === r ? "#00B894" : C.card, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  {reason === r && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }}/>}
                </div>
                <span style={{ fontSize:14, color:C.text, fontWeight: reason === r ? 600 : 400 }}>{r}</span>
              </div>
            ))}
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="Additional details (optional)"
              maxLength={500}
              rows={3}
              style={{ width:"100%", borderRadius:10, border:`1.5px solid ${C.border}`, padding:"10px 12px", fontSize:13, fontFamily:"inherit", resize:"none", outline:"none", marginTop:8, boxSizing:"border-box", background:C.inputBg, color:C.text }}
            />
            <button
              onClick={handleSubmit}
              disabled={!reason || submitting}
              style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor: reason && !submitting ? "pointer" : "not-allowed", background: reason ? "#00B894" : C.border, color: reason ? "#fff" : C.faint, marginTop:12 }}
            >
              {submitting ? "Submitting…" : "Submit Report"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// OwnerProfileModal
function OwnerProfileModal({ ownerId, allItems, onClose, onSelectItem, onMessage, user, onReport, isBlocked, onBlock, onUnblock, darkMode, fallbackName }) {
  const C = darkMode ? { bg:'#000000', card:'#1C1C1E', border:'#2C2C2E', borderFaint:'#242426', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { bg:'#fff', card:'#fff', border:'#E4E6EB', borderFaint:'#F0F2F5', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  if (!ownerId) return null;
  const owned = allItems.filter(i => i.ownerId === ownerId);
  const first = owned[0];
  const ownerName = first?.owner || fallbackName || 'Neighbor';
  const firstName = ownerName.split(" ")[0];
  const ownerAvatar = first?.ownerAvatar || '👽';
  const ownerAvatarUrl = first?.ownerAvatarUrl || null;
  const totalReviews = owned.reduce((s, i) => s + (i.reviews || 0), 0);
  const avgRating = totalReviews > 0
    ? Math.round(owned.reduce((s, i) => s + (i.rating || 0) * (i.reviews || 0), 0) / totalReviews * 10) / 10
    : null;
  const owner = { id: ownerId, name: ownerName, avatar: ownerAvatar, avatarUrl: ownerAvatarUrl };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:700, display:"flex", alignItems:"flex-end", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }} onClick={onClose}>
      <div style={{ background:C.card, borderRadius:"24px 24px 0 0", width:"100%", maxHeight:"92dvh", overflowY:"auto", overscrollBehavior:"contain" }} onClick={e=>e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ display:"flex", justifyContent:"center", paddingTop:12, paddingBottom:4 }}>
          <div style={{ width:36, height:4, borderRadius:2, background: darkMode?"#3A3A3C":"#D1D1D6" }}/>
        </div>

        {/* Hero section */}
        <div style={{ padding:"16px 20px 20px", textAlign:"center", borderBottom:`0.5px solid ${C.borderFaint}` }}>
          {/* Avatar */}
          <div style={{ position:"relative", display:"inline-block", marginBottom:12 }}>
            <div style={{ width:88, height:88, borderRadius:"50%", background: darkMode?"#2C2C2E":"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, overflow:"hidden", border:`3px solid ${darkMode?"#2C2C2E":"#fff"}`, boxShadow:`0 0 0 3px #00B894` }}>
              {ownerAvatarUrl
                ? <img src={ownerAvatarUrl} alt="" style={{ width:88, height:88, objectFit:"cover" }}/>
                : <span>{ownerAvatar}</span>}
            </div>
          </div>
          <div style={{ fontSize:22, fontWeight:700, color:C.text, marginBottom:4, letterSpacing:-0.3 }}>{ownerName}</div>
          {avgRating
            ? <div style={{ display:"flex", justifyContent:"center", marginBottom:4 }}><StarRow rating={avgRating} count={totalReviews} size={14} darkMode={darkMode}/></div>
            : <div style={{ fontSize:13, color:C.faint, marginBottom:4 }}>No reviews yet</div>}
          <div style={{ fontSize:13, color:C.faint }}>{owned.length} listing{owned.length!==1?"s":""} · Lendie member</div>
        </div>

        {/* Action buttons — icon + label, like iOS contact page */}
        <div style={{ display:"flex", justifyContent:"center", gap:16, padding:"20px 24px 16px", borderBottom:`0.5px solid ${C.borderFaint}` }}>
          {/* Message */}
          <button onClick={()=>onMessage(owner)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", padding:0 }}>
            <div style={{ width:56, height:56, borderRadius:"50%", background:"#007AFF", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 12px rgba(0,122,255,0.35)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </div>
            <span style={{ fontSize:12, color:"#007AFF", fontWeight:500 }}>Message</span>
          </button>
          {/* Block/Unblock */}
          {user && ownerId !== 'me' && (
            <button onClick={()=>{ isBlocked?(onUnblock&&onUnblock()):(onBlock&&onBlock()); }} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", padding:0 }}>
              <div style={{ width:56, height:56, borderRadius:"50%", background: darkMode?"#2C2C2E":"#F2F2F7", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isBlocked?"#30D158":"#FA3E3E"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              </div>
              <span style={{ fontSize:12, color:isBlocked?"#30D158":"#FA3E3E", fontWeight:500 }}>{isBlocked?"Unblock":"Block"}</span>
            </button>
          )}
          {/* Report */}
          {user && ownerId !== 'me' && (
            <button onClick={()=>onReport&&onReport()} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", padding:0 }}>
              <div style={{ width:56, height:56, borderRadius:"50%", background: darkMode?"#2C2C2E":"#F2F2F7", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              </div>
              <span style={{ fontSize:12, color:C.faint, fontWeight:500 }}>Report</span>
            </button>
          )}
        </div>

        {/* Listings */}
        <div style={{ padding:"16px 16px 8px" }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.faint, textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>{firstName}'s Listings</div>
          {owned.length === 0 && <div style={{ padding:"16px", textAlign:"center", color:C.faint, fontSize:13 }}>No public listings yet</div>}
          {owned.map((item, idx) => (
            <div key={item.id} onClick={()=>{ onSelectItem(item); onClose(); }}
              style={{ display:"flex", gap:12, alignItems:"center", padding:"12px 14px", cursor:"pointer", background:C.card, borderRadius:14, marginBottom:8, boxShadow: darkMode?"0 1px 6px rgba(0,0,0,0.3)":"0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)" }}>
              {/* Thumbnail */}
              <div style={{ width:52, height:52, borderRadius:12, background:(item.color||"#00B894")+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, overflow:"hidden", flexShrink:0 }}>
                {item.uploadedImages?.[0]?.url
                  ? <img src={thumbSrc(item.uploadedImages[0])} alt="" style={{ width:52, height:52, objectFit:"cover" }}/>
                  : item.emoji}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:15, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
                <div style={{ fontSize:13, color:C.faint, marginTop:2 }}>{formatDistance(item.distance) || "Distance unavailable"}</div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:16, fontWeight:700, color:C.text }}>${item.price}</div>
                <div style={{ fontSize:11, color:C.faint }}>/{item.priceUnit||"day"}</div>
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </div>

        {/* Close */}
        <div style={{ padding:"8px 16px 40px" }}>
          <button onClick={onClose} style={{ width:"100%", padding:"14px", borderRadius:14, border:`1.5px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:16, cursor:"pointer", background:"none", color:C.text }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ItemDetailSheet - top-level component so hooks work correctly
function ItemDetailSheet({ item, bookingRequests, user, favorites, toggleFav, allItems, OWNERS, setOwnerProfileId, setPhotoBrowser, onDismiss, setPaymentModal, setPaymentStep, onConfirmBooking, onBuyRequest, onMakeOfferRequest, onServiceRequest, isDesktop, darkMode }) {
  const C = darkMode ? { bg:'#000000', card:'#1C1C1E', border:'#2C2C2E', borderFaint:'#242426', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { bg:'#fff', card:'#fff', border:'#E4E6EB', borderFaint:'#F0F2F5', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  const CAT_MAP = { tools:"Tools", trailers:"Trailers", construction:"Equipment", kitchen:"Kitchen", garden:"Garden", outdoors:"Outdoors", venues:"Venues", party:"Party", tech:"Tech", ...SERVICE_CAT_LABELS };
  const isService = item?.listingType === "service";
  const svcUnit = SERVICE_UNIT_LABEL[item?.priceUnit] || item?.priceUnit || "hr";
  const sheetRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [wantsDelivery, setWantsDelivery] = useState(false);
  const [showOfferEntry, setShowOfferEntry] = useState(false);
  const [offerEntry, setOfferEntry] = useState("");
  const [photoIdx, setPhotoIdx] = useState(0);
  const carouselRef = useRef(null);

  useEffect(() => {
    setStartDate(null);
    setEndDate(null);
    setWantsDelivery(false);
    setShowOfferEntry(false);
    setOfferEntry("");
    setDragY(0);
    setDragX(0);
    setDragging(false);
    setPhotoIdx(0);
    if (carouselRef.current) carouselRef.current.scrollLeft = 0;
  }, [item && item.id]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    // Track the live drag offsets in locals (not state) so the listeners can be
    // bound ONCE per open. Previously dragY/dragX were in the deps, which tore
    // down & rebound the listeners every frame and reset the gesture mid-swipe.
    let sx=0, sy=0, sTop=0, curDy=0, curDx=0;
    const onStart = e => { sx=e.touches[0].clientX; sy=e.touches[0].clientY; sTop=el.scrollTop||0; curDy=0; curDx=0; setDragging(false); };
    const onMove = e => {
      const dy=e.touches[0].clientY-sy, dx=e.touches[0].clientX-sx;
      const atTop=sTop<=2;
      // Horizontal swipes inside the photo carousel page through photos, not dismiss the sheet
      const inCarousel = e.target.closest && e.target.closest('[data-photo-carousel]');
      const goDown=atTop&&dy>8&&Math.abs(dy)>Math.abs(dx)*1.2;
      const goRight=!inCarousel&&dx>8&&Math.abs(dx)>Math.abs(dy)*1.2;
      if (goDown||goRight) {
        e.preventDefault();
        setDragging(true);
        curDy = goDown?Math.max(0,dy):0;
        curDx = goRight?Math.max(0,dx):0;
        setDragY(curDy);
        setDragX(curDx);
      }
    };
    const onEnd = () => {
      if (curDy>100||curDx>100) onDismiss();
      else { setDragY(0); setDragX(0); }
      curDy=0; curDx=0;
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
  }, [item && item.id]);

  if (!item) return null;

  const myActiveRequests = (bookingRequests || []).filter(r =>
    r.item?.id === item.id &&
    r.renterId === user?.id &&
    r.status !== 'cancelled' &&
    r.status !== 'declined' &&
    // Ignore a card checkout that was started but never paid — the Edge Function
    // pre-creates the booking (status 'pending', payment_status 'pending') before
    // charging, so it must not mark the item booked until payment succeeds.
    !(r.status === 'pending' && r.payment_status && r.payment_status !== 'paid')
  );
  // For sale items, block if any active request exists.
  // For rent items, only block if selected dates overlap an existing booking's dates.
  const myRequest = myActiveRequests.find(r => {
    if (!startDate) return false;
    // A prior request only blocks the exact dates it holds. Requests with no
    // stored dates (e.g. legacy service bookings) never conflict, so a past
    // booking can't permanently lock a rental/service out of being re-booked.
    if (!r.start && !r.end) return false;
    const selDates = getDatesInRange(startDate, endDate || startDate);
    const reqDates = getDatesInRange(r.start, r.end || r.start);
    return selDates.some(d => reqDates.includes(d));
  });
  const alreadySent = myRequest?.status;
  // Any active request at all (used for sale items)
  const anyActiveRequest = myActiveRequests[0];
  const rangeBooked = startDate && getDatesInRange(startDate, endDate||startDate).some(d => item.booked && item.booked.includes(d));
  // Own listing whether it carries the "me" marker or the raw user id
  const isMine = item.ownerId === "me" || (user?.id && item.ownerId === user.id);
  const n = daysBetween(startDate, endDate||startDate);
  const progress = Math.min(1, Math.max(dragY,dragX)/200);
  const uploadedImgs = (item.uploadedImages||[]).map(i=>({ t:"img", s:i.url }));
  const allPhotos = uploadedImgs.length > 0 ? uploadedImgs : (item.photos||[]).map(p=>({ t:"emoji", s:p }));
  const deliveryAmenity = item.amenities && item.amenities.find(a => /delivery/i.test(a) && /\$\d+/.test(a));
  const hasDelivery = !!deliveryAmenity;

  const sheetStyle = isDesktop
    ? { background:C.card, borderRadius:16, padding:"28px 28px 36px", width:"100%", maxWidth:620, maxHeight:"90vh", overflowY:"auto", overflowX:"hidden", overscrollBehavior:"contain", position:"relative", boxShadow:"0 8px 40px rgba(0,0,0,0.22)" }
    : { background:C.card, borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxHeight:"90dvh", overflowY:"auto", overflowX:"hidden", borderTop:`1px solid ${C.border}`, overscrollBehavior:"contain",
        transform: "translateY("+dragY+"px) translateX("+(dragX*0.35)+"px)",
        transition: dragging?"none":"transform 0.32s cubic-bezier(0.32,0.72,0,1), opacity 0.2s",
        animation: dragY===0&&dragX===0?"slideUp 0.32s cubic-bezier(0.32,0.72,0,1)":"none",
        opacity: 1 - progress*0.45 };

  return (
    <div style={{ position:"fixed", inset:0, background: isDesktop ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,"+(0.55-progress*0.2)+")", zIndex:200, display:"flex", alignItems: isDesktop ? "center" : "flex-end", justifyContent: isDesktop ? "center" : "flex-start", padding: isDesktop ? 20 : 0 }} onClick={onDismiss}>
      <div ref={sheetRef} style={sheetStyle} onClick={e=>e.stopPropagation()}>
        {isDesktop
          ? <button onClick={onDismiss} style={{ position:"absolute", top:16, right:16, background:C.card, border:"none", borderRadius:"50%", width:32, height:32, cursor:"pointer", fontSize:20, display:"flex", alignItems:"center", justifyContent:"center", color:C.muted }}>×</button>
          : <div style={{ width:40, height:5, borderRadius:3, background:"#CDD0D4", margin:"0 auto 16px" }}/>}

        {allPhotos.length > 0 && (
          <div style={{ marginBottom:16 }}>
            {/* Photo carousel — swipe through on mobile, tap to open full-screen */}
            <div style={{ position:"relative", marginBottom: allPhotos.length>1 ? 8 : 0 }}>
              <div ref={carouselRef} data-photo-carousel="1"
                onScroll={e=>{ const w = e.currentTarget.clientWidth || 1; const i = Math.round(e.currentTarget.scrollLeft / w); if (i !== photoIdx) setPhotoIdx(Math.min(allPhotos.length-1, Math.max(0, i))); }}
                style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory", borderRadius:12, scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
                {allPhotos.map((p,i)=>(
                  <div key={i} onClick={()=>setPhotoBrowser({ uploadedImages:item.uploadedImages||[], photos:item.photos||[], startIdx:i })}
                    style={{ minWidth:"100%", width:"100%", height:220, scrollSnapAlign:"start", scrollSnapStop:"always", background:C.borderFaint, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}>
                    {p.t==="img"
                      ? <img src={p.s} alt="" draggable={false} style={{ width:"100%", height:"100%", objectFit:"contain", background:C.borderFaint }}/>
                      : <span style={{ fontSize:72 }}>{p.s}</span>}
                  </div>
                ))}
              </div>
              {allPhotos.length>1 && (
                <>
                  <div style={{ position:"absolute", bottom:8, right:8, background:"rgba(0,0,0,0.55)", borderRadius:6, padding:"3px 8px", fontSize:11, color:"#fff", fontWeight:600, pointerEvents:"none" }}>{photoIdx+1} / {allPhotos.length}</div>
                  <div style={{ position:"absolute", bottom:10, left:"50%", transform:"translateX(-50%)", display:"flex", gap:5, pointerEvents:"none" }}>
                    {allPhotos.map((_,i)=>(
                      <div key={i} style={{ width:6, height:6, borderRadius:"50%", background: i===photoIdx ? "#fff" : "rgba(255,255,255,0.45)", boxShadow:"0 0 2px rgba(0,0,0,0.4)", transition:"background 0.15s" }}/>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Thumbnail strip — tap to jump the carousel */}
            {allPhotos.length > 1 && (
              <div style={{ display:"flex", gap:6, overflowX:"auto", scrollbarWidth:"none" }}>
                {allPhotos.map((p,i) => (
                  <div key={i} onClick={()=>{ const el = carouselRef.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior:"smooth" }); }}
                    style={{ width:72, minWidth:72, maxWidth:72, height:72, borderRadius:8, overflow:"hidden", flexShrink:0, cursor:"pointer", background:C.borderFaint, display:"flex", alignItems:"center", justifyContent:"center", border: i===photoIdx ? "2px solid #00B894" : "2px solid transparent", boxSizing:"border-box" }}>
                    {p.t==="img" ? <img src={p.s} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <span style={{ fontSize:28 }}>{p.s}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
          <div style={{ fontSize:19, fontWeight:800, color:C.text, flex:1, marginRight:10, textTransform:"capitalize" }}>{item.title}</div>
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            <button onClick={()=>{
              const url = `${window.location.origin}/?item=${item.id}`;
              if (navigator.share) { navigator.share({ title: item.title, text: `Check out this listing on Lendie: ${item.title}`, url }); }
              else { navigator.clipboard?.writeText(url); }
            }} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 6px", lineHeight:1, display:"flex", alignItems:"center", gap:5, color:C.text }} title="Share listing">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
              <span style={{ fontSize:13, fontWeight:600 }}>Share</span>
            </button>
            <button onClick={()=>toggleFav(item.id)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer" }}>{favorites.includes(item.id)?"❤️":"🤍"}</button>
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12, flexWrap:"wrap" }}>
          <span style={{ display:"inline-block", width:9, height:9, borderRadius:"50%", background:item.available?"#31A24C":"#FA3E3E" }}/>
          <span style={{ fontSize:13, fontWeight:600, color:item.available?"#31A24C":"#FA3E3E" }}>{item.available?"Available":"Unavailable"}</span>
          {formatDistance(item.distance) && <span style={{ fontSize:13, color:C.muted }}>&middot; {formatDistance(item.distance)}</span>}
          {isService && (
            <span style={{ fontSize:11, fontWeight:700, color:"#7B61FF", background:"#F0EDFF", borderRadius:6, padding:"2px 7px", border:"1px solid #DAD2FF" }}>
              Service
            </span>
          )}
          {!isService && (item.listingType==="rent"||item.listingType==="both") && (
            <span style={{ fontSize:11, fontWeight:700, color:"#00B894", background:"#E8FBF6", borderRadius:6, padding:"2px 7px", border:"1px solid #B2EFE3" }}>
              Rent
            </span>
          )}
          {(item.listingType==="sale"||item.listingType==="both") && (
            <span style={{ fontSize:11, fontWeight:700, color:"#E87722", background:"#FFF3E0", borderRadius:6, padding:"2px 7px", border:"1px solid #FFE0B2" }}>
              Sale
            </span>
          )}
          {hasDelivery && !isService && <span style={{ fontSize:11, fontWeight:600, color:"#00B894", background:"#E8FBF6", borderRadius:6, padding:"2px 7px", border:"1px solid #B2EFE3" }}>Delivery avail.</span>}
        </div>

        {item.ownerId && !isMine && (
          <div onClick={()=>setOwnerProfileId(item.ownerId)} style={{ display:"flex", alignItems:"center", gap:12, background:C.card, borderRadius:12, padding:"12px 14px", marginBottom:16, cursor:"pointer", border:`1px solid ${C.border}` }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:darkMode ? '#2C2C2E' : '#E4E6EB', display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0, overflow:"hidden" }}>
              {item.ownerAvatarUrl
                ? <img src={item.ownerAvatarUrl} alt="" style={{ width:44, height:44, objectFit:"cover" }}/>
                : <span>{item.ownerAvatar || '👽'}</span>}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                <span style={{ fontWeight:700, fontSize:14, color:C.text }}>{item.owner || 'Neighbor'}</span>
              </div>
              {(() => {
                const ownerListings = allItems.filter(x => x.ownerId === item.ownerId && x.reviews > 0);
                const totalReviews = ownerListings.reduce((s, x) => s + (x.reviews || 0), 0);
                const avgRating = totalReviews > 0
                  ? Math.round(ownerListings.reduce((s, x) => s + (x.rating || 0) * (x.reviews || 0), 0) / totalReviews * 10) / 10
                  : null;
                return avgRating ? <StarRow rating={avgRating} count={totalReviews} size={12} darkMode={darkMode}/> : null;
              })()}
              {allItems.filter(x=>x.ownerId===item.ownerId&&x.id!==item.id).length > 0 && (
                <div style={{ fontSize:11, color:"#00B894", fontWeight:600, marginTop:2 }}>
                  +{allItems.filter(x=>x.ownerId===item.ownerId&&x.id!==item.id).length} other listings
                </div>
              )}
            </div>
            <div style={{ fontSize:12, color:"#00B894", fontWeight:700 }}>View ›</div>
          </div>
        )}

        {item.description && <div style={{ fontSize:13, color:C.muted, lineHeight:1.7, marginBottom:14, overflowWrap:"anywhere", wordBreak:"break-word", whiteSpace:"pre-wrap" }}>{linkify(item.description)}</div>}

        {item.amenities && item.amenities.length > 0 && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontWeight:700, fontSize:13, color:C.text, marginBottom:8 }}>Included</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {item.amenities.map((a,i) => <div key={i} style={{ background:C.card, borderRadius:8, padding:"5px 10px", fontSize:12, color:C.text, border:`1px solid ${C.border}` }}>{a}</div>)}
            </div>
          </div>
        )}

        <div style={{ background:C.card, borderRadius:12, padding:"13px 15px", marginBottom:14, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            {isService && (
              <>
                <div style={{ fontSize:10, color:C.faint, marginBottom:3 }}>Starting price</div>
                <div style={{ fontSize:24, fontWeight:800, color:"#7B61FF" }}>
                  <span style={{ fontSize:13, color:C.faint, fontWeight:600 }}>from </span>${item.price}<span style={{ fontSize:12, color:C.faint }}>/{svcUnit}</span>
                </div>
                <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>Final price agreed with the provider</div>
              </>
            )}
            {!isService && item.listingType !== "sale" && (
              <>
                <div style={{ fontSize:10, color:C.faint, marginBottom:3 }}>Rental price</div>
                <div style={{ fontSize:24, fontWeight:800, color:"#00B894" }}>
                  ${item.price}<span style={{ fontSize:12, color:C.faint }}>/{item.priceUnit||"day"}</span>
                </div>
              </>
            )}
            {!isService && item.listingType === "sale" && (
              <>
                <div style={{ fontSize:10, color:C.faint, marginBottom:3 }}>Sale price</div>
                <div style={{ fontSize:24, fontWeight:800, color:"#00B894" }}>
                  ${item.price}
                </div>
              </>
            )}
            {item.listingType === "both" && item.salePrice && (
              <div style={{ marginTop:6, paddingTop:6, borderTop:`1px solid ${C.border}` }}>
                <div style={{ fontSize:10, color:C.faint, marginBottom:2 }}>Or buy outright</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#00B894" }}>${item.salePrice}</div>
              </div>
            )}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10, color:C.faint, marginBottom:3 }}>Category</div>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{CAT_MAP[item.category]||item.category}</div>
            {item.rating && <StarRow rating={item.rating} count={item.reviews} size={11} darkMode={darkMode}/>}
          </div>
        </div>

        {isMine && (
          <div style={{ padding:"14px", borderRadius:10, background:C.card, textAlign:"center", fontWeight:600, fontSize:13, color:C.muted, border:`1px solid ${C.border}` }}>
            📦 This is your listing — manage it from My Items
          </div>
        )}

        {!isMine && isService && (
          !item.available
            ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:C.card, color:C.faint, textAlign:"center", fontWeight:700, fontSize:15, marginBottom:10, border:`1px solid ${C.border}` }}>This service is currently unavailable</div>
            : <div>
                {/* A prior request only holds the exact date it was made for — you can
                    always book this service again on a different date (alreadySent is
                    date-aware), so a past/accepted booking never blocks re-booking. */}
                <div style={{ fontWeight:700, fontSize:14, color:C.text, marginBottom:10 }}>Choose a date</div>
                <RangeCalendar booked={item.booked||[]} startDate={startDate} endDate={endDate} onRangeChange={(s,e)=>{ setStartDate(s); setEndDate(e); }} darkMode={darkMode}/>
                {startDate && !rangeBooked && alreadySent !== "pending" && alreadySent !== "accepted" && (
                  <div style={{ background:"#F0EDFF", borderRadius:10, padding:"11px 14px", margin:"10px 0", border:"1px solid #DAD2FF" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#7B61FF" }}>{formatDate(startDate)}{endDate&&endDate!==startDate?" to "+formatDate(endDate):""}</div>
                  </div>
                )}
                {startDate && rangeBooked && (
                  <div style={{ background:"#FEF2F2", borderRadius:10, padding:"12px 14px", margin:"10px 0", border:"1.5px solid #FCA5A5" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#DC2626" }}>That date isn't available — pick another</div>
                  </div>
                )}
                {startDate && !rangeBooked && alreadySent === "pending" && (
                  <div style={{ background:"#F0EDFF", borderRadius:10, padding:"11px 14px", margin:"10px 0", border:"1px solid #DAD2FF" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#7B61FF" }}>⏳ You've already requested this date — pick another to book again</div>
                  </div>
                )}
                {startDate && !rangeBooked && alreadySent === "accepted" && (
                  <div style={{ background:"#E8FBF6", borderRadius:10, padding:"11px 14px", margin:"10px 0", border:"1px solid #B2EFE3" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#00B894" }}>✅ Booked for this date — arrange details in Messages, or pick another to book again</div>
                  </div>
                )}
                {(() => {
                  const svcBlocked = alreadySent === "pending" || alreadySent === "accepted";
                  const disabled = !startDate || rangeBooked || svcBlocked;
                  return (
                    <button disabled={disabled} onClick={()=>{ if(startDate&&!rangeBooked&&!svcBlocked) onServiceRequest&&onServiceRequest(item, startDate, endDate); }}
                      style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:disabled?"not-allowed":"pointer", background: rangeBooked?"#DC2626":"#7B61FF", color:"#fff", opacity:disabled?0.55:1, marginBottom:10 }}>
                      {!startDate ? "Select a date to continue" : rangeBooked ? "Date unavailable — pick another" : svcBlocked ? "Already booked for this date" : `Request Service — $${item.price}/${svcUnit}`}
                    </button>
                  );
                })()}
              </div>
        )}

        {!isMine && !isService && item.listingType==="sale" && !item.available && (
          <div style={{ width:"100%", padding:"14px", borderRadius:8, background:C.card, color:C.faint, textAlign:"center", fontWeight:700, fontSize:15, marginBottom:10, border:`1px solid ${C.border}` }}>This item is no longer available</div>
        )}
        {!isMine && item.listingType==="sale" && item.available && (
          anyActiveRequest?.status === "pending"
            ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#FFF7ED", color:"#E87722", textAlign:"center", fontWeight:700, fontSize:15, marginBottom:10, border:"1px solid #FFE0B2" }}>⏳ Request sent — check your messages</div>
            : anyActiveRequest?.status === "accepted"
            ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#E8FBF6", color:"#00B894", textAlign:"center", fontWeight:700, fontSize:15, marginBottom:10 }}>✅ Confirmed — complete payment in Messages</div>
            : <>
                <div style={{ display:"flex", gap:8, marginBottom:showOfferEntry?8:10 }}>
                  <button style={{ flex:1, padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff" }} onClick={()=>onBuyRequest&&onBuyRequest(item)}>
                    Buy — ${item.price}
                  </button>
                  <button style={{ flex:1, padding:"14px", borderRadius:8, border:"1.5px solid #00B894", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:showOfferEntry?"#00B894":"transparent", color:showOfferEntry?"#fff":"#00B894" }} onClick={()=>setShowOfferEntry(v=>!v)}>
                    Make Offer
                  </button>
                </div>
                {showOfferEntry && (
                  <div style={{ background: darkMode?"#0D2E26":"#E8FBF6", border:"1.5px solid #00B894", borderRadius:10, padding:"12px 14px", marginBottom:10 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:"#00B894", marginBottom:8 }}>Your offer for "{item.title}"</div>
                    <div style={{ display:"flex", gap:8 }}>
                      <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", background:C.bg, border:`1.5px solid ${C.border}`, borderRadius:22, padding:"9px 14px" }}>
                        <span style={{ color:"#00B894", fontWeight:700, marginRight:4, fontSize:16 }}>$</span>
                        <input value={offerEntry} onChange={e=>setOfferEntry(e.target.value.replace(/[^0-9.]/g,""))} onKeyDown={e=>{ if(e.key==="Enter"&&offerEntry) { onMakeOfferRequest&&onMakeOfferRequest(item,parseFloat(offerEntry)); }}} placeholder="Enter amount" type="number" autoFocus style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:16, fontFamily:"inherit", color:C.text, fontWeight:700 }}/>
                      </div>
                      <button disabled={!offerEntry} onClick={()=>onMakeOfferRequest&&onMakeOfferRequest(item,parseFloat(offerEntry))} style={{ padding:"12px 18px", flexShrink:0, borderRadius:22, border:"none", background:offerEntry?"#00B894":"#CCC", color:"#fff", fontSize:14, fontWeight:700, cursor:offerEntry?"pointer":"default", fontFamily:"inherit" }}>
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </>
        )}

        {!isMine && !isService && item.available && item.listingType!=="sale" && (
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:C.text, marginBottom:10 }}>
              {item.category==="housing"?"Select check-in & check-out":"Select rental dates"}
            </div>
            <RangeCalendar booked={item.booked||[]} startDate={startDate} endDate={endDate} onRangeChange={(s,e)=>{ setStartDate(s); setEndDate(e); }} darkMode={darkMode}/>
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
            {hasDelivery && startDate && !rangeBooked && (
              <div onClick={()=>setWantsDelivery(v=>!v)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:C.card, borderRadius:10, padding:"11px 14px", marginBottom:10, border:`1px solid ${C.border}`, cursor:"pointer" }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:13, color:C.text }}>Request delivery</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:1 }}>{deliveryAmenity}</div>
                </div>
                <div style={{ width:44, height:26, borderRadius:13, background:wantsDelivery?"#00B894":"#CDD0D4", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                  <div style={{ position:"absolute", top:3, left:wantsDelivery?20:3, width:20, height:20, borderRadius:"50%", background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.3)", transition:"left 0.2s" }}/>
                </div>
              </div>
            )}
            {alreadySent === "pending"
              ? <>
                  <div style={{ padding:"11px 14px", borderRadius:8, background:"#FFF7ED", color:"#E87722", fontWeight:600, fontSize:13, border:"1px solid #FFE0B2", marginBottom:8, textAlign:"center" }}>⏳ Request sent — check your messages</div>
                  <button style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:(!startDate||rangeBooked)?"not-allowed":"pointer", background: rangeBooked?"#DC2626":"#00B894", color:"#fff", opacity:(!startDate||rangeBooked)?0.55:1 }} onClick={()=>{ if(!rangeBooked&&startDate) onConfirmBooking(startDate,endDate,wantsDelivery); }} disabled={!startDate||rangeBooked}>
                    {!startDate?"Select new dates to request again":rangeBooked?"Already booked — select different dates":"Request "+n+" "+(item.category==="housing"?"night":"day")+(n>1?"s":"")}
                  </button>
                </>
              : alreadySent === "accepted"
              ? <div style={{ padding:"11px 14px", borderRadius:8, background:"#E8FBF6", color:"#00B894", fontWeight:600, fontSize:13, border:"1px solid #B2EFE3", textAlign:"center" }}>✅ Owner approved — complete payment in Messages</div>
              : <button
                  style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:(!startDate||rangeBooked)?"not-allowed":"pointer", background: rangeBooked?"#DC2626":"#00B894", color:"#fff", opacity:(!startDate||rangeBooked)?0.55:1 }}
                  onClick={()=>{ if(!rangeBooked&&startDate) onConfirmBooking(startDate,endDate,wantsDelivery); }} disabled={!startDate||rangeBooked}>
                  {!startDate?"Select dates to continue":rangeBooked?"Already booked — select different dates":"Request "+n+" "+(item.category==="housing"?"night":"day")+(n>1?"s":"")}
                </button>
            }
          </div>
        )}

        {!isMine && item.available && item.listingType==="both" && item.salePrice && (
          <>
            <div style={{ display:"flex", gap:8, marginTop:8, marginBottom:showOfferEntry?8:0 }}>
              <button style={{ flex:1, padding:"12px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer", background:"#00B894", color:"#fff" }} onClick={()=>onBuyRequest&&onBuyRequest(item)}>
                Buy — ${item.salePrice}
              </button>
              <button style={{ flex:1, padding:"12px", borderRadius:8, border:"1.5px solid #00B894", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer", background:showOfferEntry?"#00B894":"transparent", color:showOfferEntry?"#fff":"#00B894" }} onClick={()=>setShowOfferEntry(v=>!v)}>
                Make Offer
              </button>
            </div>
            {showOfferEntry && (
              <div style={{ background: darkMode?"#0D2E26":"#E8FBF6", border:"1.5px solid #00B894", borderRadius:10, padding:"12px 14px", marginTop:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:"#E87722", marginBottom:8 }}>Your offer for "{item.title}"</div>
                <div style={{ display:"flex", gap:8 }}>
                  <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", background:C.bg, border:`1.5px solid ${C.border}`, borderRadius:22, padding:"9px 14px" }}>
                    <span style={{ color:"#00B894", fontWeight:700, marginRight:4, fontSize:16 }}>$</span>
                    <input value={offerEntry} onChange={e=>setOfferEntry(e.target.value.replace(/[^0-9.]/g,""))} onKeyDown={e=>{ if(e.key==="Enter"&&offerEntry) { onMakeOfferRequest&&onMakeOfferRequest(item,parseFloat(offerEntry)); }}} placeholder="Enter amount" type="number" autoFocus style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:16, fontFamily:"inherit", color:C.text, fontWeight:700 }}/>
                  </div>
                  <button disabled={!offerEntry} onClick={()=>onMakeOfferRequest&&onMakeOfferRequest(item,parseFloat(offerEntry))} style={{ padding:"12px 18px", flexShrink:0, borderRadius:22, border:"none", background:offerEntry?"#00B894":"#CCC", color:"#fff", fontSize:14, fontWeight:700, cursor:offerEntry?"pointer":"default", fontFamily:"inherit" }}>
                    Send
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {!isMine && !isService && !item.available && item.listingType!=="sale" && (
          <button style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"not-allowed", background:C.card, color:C.faint }} disabled>Currently Unavailable</button>
        )}

        {!isDesktop && <div style={{ fontSize:11, color:C.faint, textAlign:"center", margin:"14px 0 6px" }}>Swipe down or right to close</div>}
        <button style={{ width:"100%", padding:"12px", borderRadius:8, border:`1px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:C.card, color:C.text, marginTop: isDesktop ? 14 : 0 }} onClick={onDismiss}>Close</button>
      </div>
    </div>
  );
}

function BlockDatesModal({ listing, lockedDates = [], onClose, onSave, darkMode }) {
  const lockedSet = new Set(lockedDates);
  const C = darkMode ? { bg:'#000000', card:'#1C1C1E', border:'#2C2C2E', borderFaint:'#242426', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { bg:'#fff', card:'#fff', border:'#E4E6EB', borderFaint:'#F0F2F5', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  const today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
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
    // Dates held by an active booking can't be freed here — doing so would
    // double-book the renter who already reserved them.
    if (lockedSet.has(k)) return;
    setBlocked(prev => prev.includes(k) ? prev.filter(x=>x!==k) : [...prev,k]);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:400, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:C.card, borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxWidth:430, margin:"0 auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:5, borderRadius:3, background:C.border, margin:"0 auto 16px" }}/>
        <div style={{ fontSize:17, fontWeight:800, color:C.text, marginBottom:4 }}>Block Dates</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>{listing.title} — tap dates to mark unavailable</div>
        <div style={{ background:C.card, borderRadius:14, padding:14, border:`1px solid ${C.border}`, marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }} style={{ background:darkMode ? '#2C2C2E' : '#E4E6EB', border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16, color:C.text }}>&#8249;</button>
            <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{MONTHS[month]} {year}</div>
            <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }} style={{ background:darkMode ? '#2C2C2E' : '#E4E6EB', border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16, color:C.text }}>&#8250;</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, textAlign:"center" }}>
            {DAYS.map(d=><div key={d} style={{ fontSize:10, color:C.faint, fontWeight:700, paddingBottom:6 }}>{d}</div>)}
            {cells.map((d,i)=>{
              if(!d) return <div key={i}/>;
              const k=toKey(d), past=isPast(d), locked=lockedSet.has(k), blk=blocked.includes(k);
              return (
                <div key={i} onMouseDown={e=>e.preventDefault()} onClick={()=>toggle(d)}
                  title={locked?"Booked by a renter — can't be unblocked":undefined}
                  style={{ borderRadius:8, padding:"8px 2px", fontSize:13, fontWeight:(blk||locked)?700:500, cursor:past?"not-allowed":locked?"not-allowed":"pointer", background:locked?"#8E8E93":blk?"#FA3E3E":"transparent", color:(blk||locked)?"#fff":past?C.border:C.text, opacity:past?0.4:1, userSelect:"none" }}>
                  {d}
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:14, marginTop:12, fontSize:11, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#FA3E3E" }}/><span style={{ color:C.muted }}>Blocked</span></div>
            {lockedSet.size>0 && <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#8E8E93" }}/><span style={{ color:C.muted }}>Booked</span></div>}
            <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:C.card, border:`1px solid ${C.border}` }}/><span style={{ color:C.muted }}>Available</span></div>
          </div>
        </div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:14, textAlign:"center" }}>{blocked.length} date{blocked.length!==1?"s":""} blocked</div>
        <button style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }} onClick={()=>onSave([...new Set([...blocked, ...lockedDates])])}>Save availability</button>
        <button style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:C.card, color:C.text }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function ReviewModal({ booking, onClose, onSubmit, darkMode }) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const C = darkMode ? { bg:'#000000', card:'#1C1C1E', border:'#2C2C2E', borderFaint:'#242426', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { bg:'#fff', card:'#fff', border:'#E4E6EB', borderFaint:'#F0F2F5', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  const active = hovered || stars;
  const handleSubmit = async () => {
    if (!stars) return;
    setSubmitting(true);
    await onSubmit(booking, stars, comment.trim());
    setSubmitting(false);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:600, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:C.card, borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxWidth:430, margin:"0 auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:5, borderRadius:3, background:C.border, margin:"0 auto 20px" }}/>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>{booking.item.emoji}</div>
          <div style={{ fontSize:17, fontWeight:800, color:C.text }}>How was {booking.item.title}?</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Rented from {booking.item.owner} · {booking.dateStr}</div>
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
          <div style={{ textAlign:"center", fontSize:13, color:C.muted, marginBottom:16 }}>
            {["","Terrible","Poor","OK","Good","Excellent!"][stars]}
          </div>
        )}
        <textarea
          placeholder="Share your experience (optional)"
          value={comment}
          onChange={e=>setComment(e.target.value)}
          rows={3}
          style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1.5px solid ${C.border}`, fontFamily:"inherit", fontSize:13, resize:"none", outline:"none", boxSizing:"border-box", color:C.text, background:C.inputBg, marginBottom:16 }}
        />
        <button
          onClick={handleSubmit}
          disabled={!stars || submitting}
          style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:stars&&!submitting?"pointer":"not-allowed", background:"#00B894", color:"#fff", opacity:stars&&!submitting?1:0.45, marginBottom:10 }}>
          {submitting ? "Submitting…" : "Submit Review"}
        </button>
        <button onClick={onClose} style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:C.card, color:C.text }}>Cancel</button>
      </div>
    </div>
  );
}

function AddListingModal({ show, onClose, newListing, setNewListing, addImages, setAddImages, onSubmit, S, C, ALL_CATS, userId, onError, submitting, darkMode }) {
  const [uploading, setUploading] = useState(0);
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());

  if (!show) return null;

  const CAL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const CAL_DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const calToday = new Date(); calToday.setHours(0,0,0,0);
  const calDim = new Date(calYear, calMonth+1, 0).getDate();
  const calFirstDay = new Date(calYear, calMonth, 1).getDay();
  const calCells = [];
  for (let i=0;i<calFirstDay;i++) calCells.push(null);
  for (let d=1;d<=calDim;d++) calCells.push(d);
  const calPad = n => String(n).padStart(2,"0");
  const calToKey = d => `${calYear}-${calPad(calMonth+1)}-${calPad(d)}`;
  const isCalPast = d => new Date(calYear, calMonth, d) < calToday;
  const toggleCalDate = d => {
    if (isCalPast(d)) return;
    const k = calToKey(d);
    setNewListing(n => ({ ...n, booked: (n.booked||[]).includes(k) ? (n.booked||[]).filter(x=>x!==k) : [...(n.booked||[]), k] }));
  };

  const handleFiles = async (files) => {
    const imageFiles = Array.from(files || []).filter(f => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    for (const file of imageFiles) {
      const tempId = Date.now() + Math.random();
      setAddImages(p => [...p, { id: tempId, url: null }]);
      setUploading(n => n + 1);
      try {
        const processed = await downscaleImage(file);
        const isJpeg = processed !== file;
        const rawExt = file.name.split('.').pop() || 'jpg';
        const ext = isJpeg ? 'jpg' : (/^[a-z0-9]+$/i.test(rawExt) ? rawExt.toLowerCase() : 'jpg');
        const base = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `${base}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('listing-images')
          // 1-year cache — paths are unique per upload, so the image never changes.
          // Keeps browsers from re-downloading on every visit (big egress saver).
          .upload(path, processed, { cacheControl: '31536000', upsert: false, contentType: isJpeg ? 'image/jpeg' : file.type });
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
        // Also upload a small (~400px) thumbnail for browse cards / list views, so
        // the grid doesn't download the full-res image just to show it tiny. The
        // full image still loads on tap/zoom. Best-effort — falls back to full url.
        let thumbUrl;
        try {
          const thumbBlob = await downscaleImage(file, 400, 0.7);
          if (thumbBlob && thumbBlob !== file) {
            const tPath = `${base}-thumb.jpg`;
            const { error: tErr } = await supabase.storage.from('listing-images')
              .upload(tPath, thumbBlob, { cacheControl: '31536000', upsert: false, contentType: 'image/jpeg' });
            if (!tErr) thumbUrl = supabase.storage.from('listing-images').getPublicUrl(tPath).data.publicUrl;
          }
        } catch { /* thumbnail is optional */ }
        setAddImages(p => p.map(img => img.id === tempId ? { id: tempId, url: data.publicUrl, thumb: thumbUrl } : img));
      } catch {
        setAddImages(p => p.filter(img => img.id !== tempId));
      }
      setUploading(n => n - 1);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:4, color:C.text }}>Create a Listing</div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>Photos get 3x more requests</div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:8 }}>What do you want to do?</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
            {[["rent","Rent it out"],["sale","Sell it"],["both","Rent & Sell"],["service","Offer a service"]].map(([val,label])=>(
              <button key={val} onClick={()=>setNewListing(n=>({
                ...n,
                listingType:val,
                // Switch the taxonomy/units to match the type so the form stays coherent.
                ...(val==="service"
                  ? { category:(SERVICE_CATS.some(c=>c.id===n.category)?n.category:"svc_lawn"), emoji:(SERVICE_CATS.find(c=>c.id===n.category)?.emoji||"🌿"), priceUnit:(["hour","visit","job"].includes(n.priceUnit)?n.priceUnit:"hour") }
                  : (n.listingType==="service" ? { category:"tools", emoji:"🔧", priceUnit:"day" } : {})),
              }))}
                style={{ padding:"10px 4px", borderRadius:10, border:newListing.listingType===val?"2px solid #00B894":`1.5px solid ${C.border}`, background:newListing.listingType===val?(darkMode?"#0D2E26":"#E8FBF6"):C.card, color:newListing.listingType===val?"#00B894":C.muted, fontSize:11, fontWeight:newListing.listingType===val?700:500, cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:8 }}>Photos</div>
          <label htmlFor="nr-photo-input" style={{ border:`2px dashed ${darkMode?"#00B89460":"#B2EFE3"}`, borderRadius:12, padding:"18px 14px", textAlign:"center", cursor:"pointer", background: darkMode?"#0D1F1C":"#F0FFF8", marginBottom:8, display:"block" }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:6 }}><Camera size={32} strokeWidth={1.5} color="#00B894"/></div>
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
                    : <div style={{ width:76, height:76, borderRadius:10, background:C.card, border:`1.5px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <div style={{ width:26, height:26, borderRadius:"50%", border:"3px solid #00B894", borderTopColor:"transparent", animation:"spin 0.75s linear infinite" }}/>
                      </div>
                  }
                  {img.url && i===0 && <div style={{ position:"absolute", top:3, left:3, background:"#00B894", borderRadius:5, padding:"2px 5px", fontSize:9, fontWeight:800, color:"#fff" }}>COVER</div>}
                  {img.url && <button onClick={()=>setAddImages(p=>p.filter(x=>x.id!==img.id))} style={{ position:"absolute", top:-5, right:-5, background:"#FA3E3E", border:"2px solid #fff", borderRadius:"50%", width:20, height:20, color:"#fff", fontSize:12, cursor:"pointer", fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center" }}>x</button>}
                </div>
              ))}
              <label htmlFor="nr-photo-input" style={{ width:76, height:76, borderRadius:10, border:`2px dashed ${darkMode?"#00B89460":"#B2EFE3"}`, background: darkMode?"#0D1F1C":"#F0FFF8", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                <span style={{ fontSize:20, color:"#00B894" }}>+</span>
                <span style={{ fontSize:9, fontWeight:700, color:"#00B894" }}>More</span>
              </label>
            </div>
          )}
        </div>

        <div style={{ borderTop:`1px solid ${C.border}`, marginBottom:14 }}/>

        <div style={{ marginBottom:14 }}>
          <label style={S.lbl}>Category</label>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
            {(newListing.listingType==="service" ? SERVICE_CATS : ALL_CATS).map(cat=>{
              const sel = newListing.category===cat.id;
              return (
                <button key={cat.id} onClick={()=>setNewListing(n=>({...n,category:cat.id,emoji:cat.emoji}))}
                  style={{ padding:"9px 4px", borderRadius:10, border:sel?"none":`1px solid ${C.border}`, background:sel?"#00B894":"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                  <cat.icon size={20} strokeWidth={1.5} color={sel?"#fff":C.muted}/>
                  <span style={{ fontSize:9, fontWeight:sel?700:500, color:sel?"#fff":C.muted }}>{cat.label}</span>
                </button>
              );
            })}
          </div>
          {(newListing.category==="other"||newListing.category==="svc_other") && <input style={{ ...S.inp, marginTop:8 }} placeholder={newListing.listingType==="service"?"Describe the service (e.g. Pet sitting)":"Describe category (e.g. Musical instruments)"} autoComplete="off" value={newListing.otherCategory||""} onChange={e=>setNewListing(n=>({...n,otherCategory:e.target.value}))}/>}
        </div>

        <div style={S.fg}>
          <label style={S.lbl}>{newListing.listingType==="service" ? "Service name" : "Name"}</label>
          <input style={S.inp} placeholder={newListing.listingType==="service" ? "e.g. Lawn Mowing, Gutter Cleaning" : "e.g. Power Drill, Party Tent"} autoComplete="off" autoCorrect="off" value={newListing.title} onChange={e=>setNewListing(n=>({...n,title:e.target.value}))}/>
        </div>
        {/* Service price + unit — services only */}
        {newListing.listingType === "service" && (
          <>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ ...S.fg, flex:2 }}>
              <label style={S.lbl}>Starting price ($)</label>
              <input style={S.inp} type="number" placeholder="40" value={newListing.price} onChange={e=>setNewListing(n=>({...n,price:e.target.value}))}/>
            </div>
            <div style={{ ...S.fg, flex:2 }}>
              <label style={S.lbl}>Per</label>
              <select style={S.sel} value={newListing.priceUnit} onChange={e=>setNewListing(n=>({...n,priceUnit:e.target.value}))}>
                <option value="job">Job</option>
                <option value="hour">Hour</option>
                <option value="visit">Visit</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize:11, color:"#7B61FF", marginTop:-4, marginBottom:10 }}>💬 A starting estimate — you'll confirm the final price with the customer in chat before they pay.</div>
          </>
        )}
        {/* Rental price — shown for Rent and Both */}
        {newListing.listingType !== "sale" && newListing.listingType !== "service" && (
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ ...S.fg, flex:2 }}>
              <label style={S.lbl}>Rental Price ($)</label>
              <input style={S.inp} type="number" placeholder="25" value={newListing.price} onChange={e=>setNewListing(n=>({...n,price:e.target.value}))}/>
              {!newListing.price && newListing.category && (() => {
                const suggest = {tools:"$15–30",trailers:"$50–100",construction:"$75–150",kitchen:"$20–40",garden:"$10–25",outdoors:"$20–50",venues:"$100–500",party:"$30–75",tech:"$25–60",other:"$15–30"};
                const s = suggest[newListing.category];
                return s ? <div style={{ fontSize:11, color:"#00B894", marginTop:4 }}>💡 Suggested daily rate for {newListing.category}: {s}</div> : null;
              })()}
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
        {(() => {
          const unit = newListing.priceUnit || 'day';
          const net = v => (Number(v) > 0 ? Number(v) * 0.96 : null);
          const isBoth = newListing.listingType === 'both';
          const isSale = newListing.listingType === 'sale';
          const isService = newListing.listingType === 'service';
          const rentNet = net(newListing.price);
          const saleNet = net(isBoth ? newListing.salePrice : newListing.price);
          let payout = null;
          if (isBoth) {
            const parts = [];
            if (rentNet) parts.push(`~$${rentNet.toFixed(2)}/${unit} renting`);
            if (saleNet) parts.push(`~$${saleNet.toFixed(2)} on a sale`);
            if (parts.length) payout = `You'll receive ${parts.join(' · ')}`;
          } else if (isSale) {
            if (rentNet) payout = `You'll receive ~$${rentNet.toFixed(2)} per sale`;
          } else if (isService) {
            if (rentNet) payout = `You'll receive ~$${rentNet.toFixed(2)}/${unit} on the agreed price`;
          } else if (rentNet) {
            payout = `You'll receive ~$${rentNet.toFixed(2)}/${unit}`;
          }
          return (
            <div style={{ display:"flex", alignItems:"flex-start", gap:7, background: darkMode?"#0D2E26":"#E8FBF6", border:`1px solid ${darkMode?"#1E4A3E":"#B2EFE3"}`, borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
              <DollarSign size={15} strokeWidth={2.25} color="#00B894" style={{ flexShrink:0, marginTop:1 }}/>
              <div style={{ fontSize:12, color:C.muted, lineHeight:1.45 }}>
                {payout
                  ? <><strong style={{ color:"#00B894", fontSize:13 }}>{payout}</strong> on card payments, after Lendie's 4% fee.</>
                  : <>On card payments, Lendie keeps a <strong style={{ color:C.text }}>4% service fee</strong> from your payout.</>}
              </div>
            </div>
          );
        })()}
        <div style={S.fg}>
          <label style={S.lbl}>Description</label>
          <textarea style={{ ...S.inp, minHeight:70, resize:"vertical" }} placeholder={newListing.listingType==="service" ? "Describe the service, what's included, your experience..." : "Describe the item, condition, included..."} autoComplete="off" autoCorrect="off" value={newListing.description} onChange={e=>setNewListing(n=>({...n,description:e.target.value}))}/>
        </div>
        <div style={S.fg}>
          <label style={S.lbl}>{newListing.listingType==="service" ? "Service area" : "Item location"} <span style={{ fontWeight:400, color:"#8A8D91" }}>— optional, defaults to your current location</span></label>
          <PlacesAutocompleteInput
            placeholder="e.g. 123 Main St, Washington DC"
            containerStyle={{ width:"100%" }}
            inputStyle={S.inp}
            onAddressChange={text => setNewListing(n=>({...n, listingLocationAddress:text, listingLat:null, listingLng:null}))}
            onPlaceSelect={({ lat, lng }) => setNewListing(n=>({...n, listingLat:lat, listingLng:lng}))}
          />
          {newListing.listingLat
            ? <div style={{ fontSize:11, color:"#00B894", marginTop:4 }}>✓ Location confirmed</div>
            : newListing.listingLocationAddress
              ? <div style={{ fontSize:11, color:"#E87722", marginTop:4 }}>Select an address from the suggestions to confirm location</div>
              : <div style={{ fontSize:11, color:"#8A8D91", marginTop:4 }}>Leave blank to use your current location</div>
          }
        </div>
        <div style={S.fg}>
          <label style={S.lbl}>{newListing.listingType==="service" ? "What's included (comma-separated)" : "Amenities (comma-separated)"}</label>
          <input style={S.inp} placeholder={newListing.listingType==="service" ? "Supplies, equipment, cleanup..." : "WiFi, Parking, Tables..."} autoComplete="off" autoCorrect="off" value={newListing.amenities} onChange={e=>setNewListing(n=>({...n,amenities:e.target.value}))}/>
        </div>
        {newListing.listingType !== "service" && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:8 }}>Delivery?</div>
          <div style={{ display:"flex", gap:8 }}>
            {[["no","No - pickup only"],["yes","Yes - I deliver"]].map(([val,label])=>(
              <button key={val} onClick={()=>setNewListing(n=>({...n,offersDelivery:val==="yes",deliveryFee:val==="no"?"":n.deliveryFee,deliveryRadius:val==="no"?"":n.deliveryRadius}))}
                style={{ flex:1, padding:"10px 8px", borderRadius:10, border:newListing.offersDelivery===(val==="yes")?"2px solid #00B894":`1.5px solid ${C.border}`, background:newListing.offersDelivery===(val==="yes")?(darkMode?"#0D2E26":"#E8FBF6"):C.card, color:newListing.offersDelivery===(val==="yes")?"#00B894":C.muted, fontSize:12, fontWeight:newListing.offersDelivery===(val==="yes")?700:500, cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
          {newListing.offersDelivery && (
            <div style={{ marginTop:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:13, color:C.muted }}>Fee: $</span>
                  <input style={{ ...S.inp, width:80 }} type="number" placeholder="25" value={newListing.deliveryFee||""} onChange={e=>setNewListing(n=>({...n,deliveryFee:e.target.value}))}/>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:13, color:C.muted }}>Radius (mi):</span>
                  <input style={{ ...S.inp, width:70 }} type="number" placeholder="10" value={newListing.deliveryRadius||""} onChange={e=>setNewListing(n=>({...n,deliveryRadius:e.target.value}))}/>
                </div>
              </div>
              <div style={{ fontSize:11, color:"#8A8D91", marginTop:4 }}>Delivery originates from the item location entered above.</div>
            </div>
          )}
        </div>
        )}
        {/* Block unavailable dates — rentals & services */}
        {newListing.listingType !== "sale" && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:2 }}>Block unavailable dates <span style={{ fontWeight:400, color:C.faint }}>— optional</span></div>
            <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>{newListing.listingType==="service" ? "Tap dates when you're not available" : "Tap dates when this item won't be available"}</div>
            <div style={{ background:C.card, borderRadius:14, padding:14, border:`1px solid ${C.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1); }} style={{ background:darkMode ? '#2C2C2E' : '#E4E6EB', border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16, color:C.text }}>&#8249;</button>
                <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{CAL_MONTHS[calMonth]} {calYear}</div>
                <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1); }} style={{ background:darkMode ? '#2C2C2E' : '#E4E6EB', border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16, color:C.text }}>&#8250;</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, textAlign:"center" }}>
                {CAL_DAYS.map(d=><div key={d} style={{ fontSize:10, color:C.faint, fontWeight:700, paddingBottom:6 }}>{d}</div>)}
                {calCells.map((d,i)=>{
                  if (!d) return <div key={i}/>;
                  const past = isCalPast(d), blk = (newListing.booked||[]).includes(calToKey(d));
                  return (
                    <div key={i} onMouseDown={e=>e.preventDefault()} onClick={()=>toggleCalDate(d)}
                      style={{ borderRadius:8, padding:"8px 2px", fontSize:13, fontWeight:blk?700:500, cursor:past?"not-allowed":"pointer", background:blk?"#FA3E3E":"transparent", color:blk?"#fff":past?C.border:C.text, opacity:past?0.4:1, userSelect:"none" }}>
                      {d}
                    </div>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:14, marginTop:12, fontSize:11 }}>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#FA3E3E" }}/><span style={{ color:C.muted }}>Blocked</span></div>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:C.card, border:`1px solid ${C.border}` }}/><span style={{ color:C.muted }}>Available</span></div>
              </div>
            </div>
            {(newListing.booked||[]).length > 0 && (
              <div style={{ fontSize:12, color:C.muted, marginTop:8, textAlign:"center" }}>
                {(newListing.booked||[]).length} date{(newListing.booked||[]).length!==1?"s":""} blocked
              </div>
            )}
          </div>
        )}
        {newListing.listingType !== "service" && (
          <label style={{ display:"flex", alignItems:"flex-start", gap:9, margin:"6px 2px 14px", cursor:"pointer" }}>
            <input type="checkbox" checked={!!newListing.attested} onChange={e=>setNewListing(n=>({...n, attested:e.target.checked}))} style={{ marginTop:2, accentColor:"#00B894", width:16, height:16, flexShrink:0, cursor:"pointer" }}/>
            <span style={{ fontSize:12, color:C.muted, lineHeight:1.5 }}>
              I confirm this item is <strong style={{ color:C.text }}>as described and functioning as designed</strong>, and I understand Lendie is <strong style={{ color:C.text }}>not liable for items lost or damaged</strong> during a rental or sale, per the <a href="/terms.html" target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ color:"#00B894", textDecoration:"underline" }}>Terms of Service</a>.
            </span>
          </label>
        )}
        {(() => {
          const attestOk = newListing.listingType === "service" || !!newListing.attested;
          const blocked = uploading>0 || submitting || !attestOk;
          return (
            <button style={{ ...S.pBtn, opacity:blocked?0.6:1, cursor:blocked?"not-allowed":"pointer" }} onClick={blocked?undefined:onSubmit} disabled={blocked}>
              {uploading>0 ? `Uploading ${uploading} photo${uploading>1?"s":""}…` : submitting ? "Publishing…" : !attestOk ? "Confirm the box above to publish" : "Publish Listing"}
            </button>
          );
        })()}
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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_API_KEY}&callback=${cb}`;
    s.async = true;
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

function MapView({ items, onSelectItem, centerCoords, radius, onRadiusChange, onMoveCenter, visible, darkMode }) {
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

  const mv = darkMode
    ? { card:'rgba(28,28,30,0.97)', text:'#AEAEB2', title:'#F2F2F7', btn:'#2C2C2E', btnBorder:'#3A3A3C', loadBg:'#000' }
    : { card:'rgba(255,255,255,0.97)', text:'#65676B', title:'#1C1E21', btn:'#fff', btnBorder:'#E4E6EB', loadBg:'#fff' };

  if (mapError) return (
    <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:mv.text, gap:8, padding:24 }}>
      <div style={{ fontSize:32 }}>🗺️</div>
      <div style={{ fontSize:14, fontWeight:700, color:mv.title }}>Map unavailable</div>
      <div style={{ fontSize:13, color:'#E87722', textAlign:'center' }}>{mapError}</div>
      <div style={{ marginTop:8, fontSize:12, color:mv.text, fontFamily:'monospace' }}>key: {MAPS_API_KEY.slice(0,8)}…</div>
    </div>
  );

  return (
    <div style={{ position:'absolute', inset:0 }}>
      <div ref={containerRef} style={{ position:'absolute', inset:0 }}/>
      {loading && (
        <div style={{ position:'absolute', inset:0, background:mv.loadBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:mv.text }}>
          Loading map…
        </div>
      )}
      {!loading && (
        <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)', background:mv.card, borderRadius:14, padding:'10px 14px', boxShadow:'0 2px 16px rgba(0,0,0,0.18)', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', zIndex:1, whiteSpace:'nowrap' }}>
          {!centerCoords ? (
            <div style={{ fontSize:12, color:mv.text, fontWeight:500 }}>
              Set a search location to see radius
            </div>
          ) : (
            <>
              <div style={{ fontSize:11, color:mv.text, textAlign:'center', marginBottom:7, fontWeight:600, letterSpacing:'0.01em' }}>Drag pin to move · tap to change radius</div>
              <div style={{ display:'flex', gap:5 }}>
                {[2, 5, 10, 25, 50].map(r => (
                  <button key={r} onClick={() => onRadiusChange?.(r)} style={{
                    background: radius===r ? '#00B894' : mv.btn,
                    border: radius===r ? 'none' : `1px solid ${mv.btnBorder}`,
                    color: radius===r ? '#fff' : mv.text,
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

function ChatView({ activeConvo, setActiveConvo, chatMsg, setChatMsg, messages, setMessages, msgEndRef, user, onSend, isDesktop, profilePhotoUrl, onReport, isBlocked, onBlock, onUnblock, darkMode, bookingRequests, onAccept, onDecline, onCheckout, onCancelRequest, onOwnerCancel, onAcceptOffer, onDeclineOffer, allItems }) {
  if (!activeConvo) return null;
  const [showMenu, setShowMenu] = useState(false);
  const bg        = darkMode ? "#000000" : "#ffffff";
  // Header + input bar sit one shade above the conversation area so they read as
  // distinct layers instead of blending into the message background.
  const headerBg  = darkMode ? "#1A1A1C" : "#F2F3F5";
  const border    = darkMode ? "#2C2C2E" : "#E4E6EB";
  const textPrimary = darkMode ? "#F2F2F7" : "#1C1E21";
  const textMuted   = darkMode ? "#AEAEB2" : "#65676B";
  const receivedBg  = darkMode ? "#2C2C2E" : "#E9E9EB";
  const sentBg      = "#00B894";
  // The message field pill sits one shade above the input bar.
  const inputBg     = darkMode ? "#2C2C2E" : "#FFFFFF";
  const inputBorder = darkMode ? "#3A3A3C" : "#E4E6EB";

  // Typing indicator state
  const [otherTyping, setOtherTyping] = useState(false);
  const typingTimeout = useRef(null);
  const typingChannel = useRef(null);

  useEffect(() => {
    if (!activeConvo?.conversation_id || !user?.id) return;
    const ch = supabase.channel(`typing-${activeConvo.conversation_id}`);
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.userId === user.id) return;
      setOtherTyping(true);
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => setOtherTyping(false), 2500);
    }).subscribe();
    typingChannel.current = ch;
    return () => {
      supabase.removeChannel(ch);
      clearTimeout(typingTimeout.current);
      setOtherTyping(false);
    };
  }, [activeConvo?.conversation_id, user?.id]);

  const broadcastTyping = () => {
    typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: user?.id } });
  };

  // Auto-scroll to bottom when conversation opens or thread grows
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [activeConvo?.id]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConvo?.thread?.length]);

  const sendMsg = () => {
    if (!chatMsg.trim()) return;
    const text = chatMsg.trim();
    const newMsg = { mine:true, text, time:"Now", created_at: new Date().toISOString() };
    setMessages(prev=>prev.map(m=>m.id===activeConvo.id?{...m,thread:[...(m.thread||m.messages||[]),newMsg],unread:false}:m));
    setActiveConvo(c=>({...c,thread:[...(c.thread||c.messages||[]),newMsg]}));
    setChatMsg("");
    if (user && onSend) onSend(text, activeConvo);
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const [imgUploading, setImgUploading] = useState(false);
  const photoInputRef = useRef(null);
  const sendImage = async (file) => {
    if (!file || !file.type.startsWith('image/') || !activeConvo || !user?.id) return;
    setImgUploading(true);
    try {
      const processed = await downscaleImage(file);
      const isJpeg = processed !== file;
      const ext = isJpeg ? 'jpg' : ((file.name.split('.').pop() || 'jpg').toLowerCase());
      const path = `${user.id}/chat-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('listing-images').upload(path, processed, { cacheControl: '31536000', upsert: false, contentType: isJpeg ? 'image/jpeg' : file.type });
      if (upErr) throw upErr;
      const url = supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
      const newMsg = { mine:true, text:'', image:url, time:"Now", created_at:new Date().toISOString() };
      setMessages(prev=>prev.map(m=>m.id===activeConvo.id?{...m,thread:[...(m.thread||m.messages||[]),newMsg],unread:false}:m));
      setActiveConvo(c=>({...c,thread:[...(c.thread||c.messages||[]),newMsg]}));
      if (onSend) onSend('', activeConvo, url);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      console.error('[Chat] image upload failed:', e?.message || e);
    }
    setImgUploading(false);
  };

  const containerStyle = isDesktop
    ? { display:"flex", flexDirection:"column", height:"calc(100vh - 64px)", background:bg, overflow:"hidden" }
    : { position:"fixed", inset:0, background:bg, zIndex:600, display:"flex", flexDirection:"column", maxWidth:430, margin:"0 auto", boxSizing:"border-box" };

  const myAvatarUrl = profilePhotoUrl || user?.user_metadata?.avatar_url || null;
  const AvatarSmall = ({ mine }) => {
    if (mine) return myAvatarUrl
      ? <img src={myAvatarUrl} alt="" style={{ width:28, height:28, borderRadius:"50%", objectFit:"cover", flexShrink:0 }}/>
      : <div style={{ width:28, height:28, borderRadius:"50%", background:"#007AFF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>👽</div>;
    return activeConvo.avatarUrl
      ? <img src={activeConvo.avatarUrl} alt="" style={{ width:28, height:28, borderRadius:"50%", objectFit:"cover", flexShrink:0 }}/>
      : <div style={{ width:28, height:28, borderRadius:"50%", background: darkMode?"#2C2C2E":"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>👽</div>;
  };

  // Pending booking request linked to this conversation (owner sees this)
  const pendingReq = bookingRequests?.find(r =>
    r.status === 'pending' &&
    r.ownerId === user?.id &&
    r.renterId === activeConvo.otherUserId &&
    r.item?.title === activeConvo.item
  );
  const [includeDelivery, setIncludeDelivery] = useState(!!pendingReq?.wantsDelivery);
  useEffect(() => { setIncludeDelivery(!!pendingReq?.wantsDelivery); }, [pendingReq?.wantsDelivery]);
  // Provider's final price for a service request — pre-filled with the listing's starting price.
  const [quotePrice, setQuotePrice] = useState("");
  useEffect(() => { setQuotePrice(pendingReq?.item?.listingType === "service" ? String(pendingReq?.item?.price ?? "") : ""); }, [pendingReq?.id, pendingReq?.item?.listingType, pendingReq?.item?.price]);

  // Accepted booking for renter side — only show checkout after owner explicitly confirmed delivery terms
  // Never show checkout if there is any pending request still waiting for owner approval
  const hasPendingReq = bookingRequests?.some(r =>
    r.status === 'pending' &&
    r.renterId === user?.id &&
    r.item?.title === activeConvo.item &&
    r.ownerId === activeConvo.otherUserId
  );
  const acceptedReq = hasPendingReq ? null : bookingRequests?.find(r =>
    r.status === 'accepted' &&
    r.payment_status === 'delivery_confirmed' &&
    r.renterId === user?.id &&
    r.item?.title === activeConvo.item &&
    r.ownerId === activeConvo.otherUserId
  );
  // Owner side of an accepted booking — lets the provider cancel after accepting/quoting.
  const ownerAcceptedReq = bookingRequests?.find(r =>
    r.status === 'accepted' &&
    r.ownerId === user?.id &&
    r.renterId === activeConvo.otherUserId &&
    r.item?.title === activeConvo.item
  );

  // Offer state — detect from thread content (always reliable, no booking request dependency)
  const [showOfferInput, setShowOfferInput] = useState(false);
  const [offerInputAmt, setOfferInputAmt] = useState("");
  const thread = activeConvo.thread || activeConvo.messages || [];
  // True if there are any offer messages in this conversation
  const hasOfferInThread = thread.some(m => /💸 Offer: \$\d/.test(m.text));
  // Latest offer from the other person
  const latestReceivedOffer = [...thread].reverse().find(m => !m.mine && /💸 Offer: \$\d/.test(m.text));
  const latestReceivedAmt = latestReceivedOffer ? parseFloat(latestReceivedOffer.text.match(/💸 Offer: \$(\d+(?:\.\d+)?)/)?.[1]) : null;
  // Booking request checks (may lag behind — use thread as primary signal)
  const hasActiveOffer = hasOfferInThread || bookingRequests?.some(r =>
    (r.dateStr === "Offer" || r.dateStr?.startsWith("Offer")) && r.status === "pending" &&
    r.item?.title === activeConvo.item &&
    (r.ownerId === user?.id || r.renterId === user?.id)
  );
  const isOfferOwner = bookingRequests?.some(r =>
    r.dateStr === "Offer" && r.status === "pending" &&
    r.ownerId === user?.id &&
    r.item?.title === activeConvo.item
  );
  // Offers only apply to items being bought — hide offer UI when the listing is
  // rental-only, or when this chat is about a rental booking (even on rent-or-buy listings)
  const convoListing = allItems?.find(l => l.title === activeConvo.item);
  // Any rental request ever exchanged in this thread makes it a rental conversation —
  // declined/cancelled history still counts, so the offer button never pops back in
  const rentalChat = bookingRequests?.some(r =>
    r.item?.title === activeConvo.item &&
    r.dateStr !== "Offer" && r.dateStr !== "Purchase" &&
    (r.renterId === activeConvo.otherUserId || r.ownerId === activeConvo.otherUserId)
  );
  const offerable = !rentalChat && !!convoListing &&
    (convoListing.listingType === "sale" || convoListing.listingType === "both");

  const sendOffer = () => {
    const amt = parseFloat(offerInputAmt);
    if (!amt || amt <= 0) return;
    const text = `💸 Offer: $${amt}`;
    const newMsg = { mine: true, text, time: "Now", created_at: new Date().toISOString() };
    setMessages(prev => prev.map(m => m.id === activeConvo.id ? { ...m, thread: [...(m.thread || []), newMsg], unread: false } : m));
    setActiveConvo(c => ({ ...c, thread: [...(c.thread || []), newMsg] }));
    setOfferInputAmt("");
    setShowOfferInput(false);
    if (user && onSend) onSend(text, activeConvo);
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div style={containerStyle}>
      {/* Header — Apple Messages style */}
      <div style={{ background:headerBg, backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderBottom:`0.5px solid ${border}`, display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 0 8px", position:"relative", flexShrink:0 }}>
        {/* Back button */}
        {!isDesktop && (
          <button onClick={()=>setActiveConvo(null)} style={{ position:"absolute", left:8, bottom:10, display:"flex", alignItems:"center", gap:2, background:"none", border:"none", color:"#00B894", fontSize:16, fontWeight:400, cursor:"pointer", padding:"4px 8px" }}>
            <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8 1L1 8l7 7" stroke="#00B894" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>
        )}
        {/* Avatar + name stacked */}
        <div style={{ width:40, height:40, borderRadius:"50%", background: darkMode?"#2C2C2E":"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, overflow:"hidden", marginBottom:4 }}>
          {activeConvo.avatarUrl ? <img src={activeConvo.avatarUrl} alt="" style={{ width:40, height:40, objectFit:"cover" }}/> : "👽"}
        </div>
        <div style={{ fontWeight:600, fontSize:14, color:textPrimary, textAlign:"center" }}>{activeConvo.from}</div>
        {/* Menu */}
        {user && activeConvo.otherUserId && (
          <div style={{ position:"absolute", right:12, bottom:10 }}>
            {showMenu && <div style={{ position:"fixed", inset:0, zIndex:99 }} onClick={()=>setShowMenu(false)}/>}
            <button onClick={()=>setShowMenu(m=>!m)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:textMuted, padding:"4px 8px", lineHeight:1, letterSpacing:"1.5px", fontWeight:900 }}>···</button>
            {showMenu && (
              <div style={{ position:"absolute", right:0, top:"100%", background: darkMode?"#1C1C1E":"#fff", borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,0.28)", border:`1px solid ${border}`, zIndex:200, minWidth:160, overflow:"hidden" }}>
                <button onClick={()=>{ setShowMenu(false); onReport&&onReport(); }} style={{ width:"100%", padding:"13px 16px", textAlign:"left", border:"none", background:"none", cursor:"pointer", fontSize:14, color:textPrimary, fontFamily:"inherit" }}>🚩 Report</button>
                <div style={{ height:"0.5px", background:border }}/>
                <button onClick={()=>{ setShowMenu(false); isBlocked?(onUnblock&&onUnblock()):(onBlock&&onBlock()); }} style={{ width:"100%", padding:"13px 16px", textAlign:"left", border:"none", background:"none", cursor:"pointer", fontSize:14, color:isBlocked?"#30D158":"#FA3E3E", fontFamily:"inherit" }}>
                  {isBlocked?"✓ Unblock":"🚫 Block"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Message thread */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px 8px", background:bg, display:"flex", flexDirection:"column" }}>
        {thread.length===0 && (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:textMuted, gap:6 }}>
            <div style={{ fontSize:40 }}>{activeConvo.avatar || "💬"}</div>
            <div style={{ fontSize:14, fontWeight:500, color:textPrimary }}>{activeConvo.from}</div>
            <div style={{ fontSize:13 }}>Send a message to get started</div>
          </div>
        )}
        {thread.map((m,i)=>{
          const prev = thread[i-1];
          const showAvatar = !m.mine && (i===0 || prev?.mine !== false);
          const groupFirst = i===0 || prev?.mine !== m.mine;
          const groupLast  = i===thread.length-1 || thread[i+1]?.mine !== m.mine;
          const br = m.mine
            ? `18px 18px ${groupLast?5:18}px 18px`
            : `18px 18px 18px ${groupLast?5:18}px`;
          const offerMatch = m.text?.match(/💸 Offer: \$(\d+(?:\.\d+)?)/);
          const isOfferMsg = !!offerMatch;
          const offerAmt = isOfferMsg ? parseFloat(offerMatch[1]) : null;
          return (
            <div key={i} style={{ display:"flex", flexDirection:m.mine?"row-reverse":"row", alignItems:"flex-end", gap:6, marginBottom:groupLast?10:2 }}>
              <div style={{ width:28, flexShrink:0, alignSelf:"flex-end" }}>
                {!m.mine && showAvatar && <AvatarSmall mine={false}/>}
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:m.mine?"flex-end":"flex-start", maxWidth:"75%" }}>
                {isOfferMsg ? (
                  <div style={{ background: darkMode ? "#1F1F21" : "#F6FBF9", border:`1px solid ${darkMode ? "#2E4A40" : "#CDEFE2"}`, borderRadius:16, padding:"11px 13px", minWidth:200 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:"#00B894", textTransform:"uppercase", letterSpacing:"0.7px", marginBottom:2 }}>Offer</div>
                    <div style={{ fontSize:24, fontWeight:800, color:textPrimary, marginBottom: m.mine ? 2 : 9 }}>${offerAmt}</div>
                    {!m.mine && (
                      <div style={{ display:"flex", gap:6 }}>
                        <button onClick={()=>onDeclineOffer&&onDeclineOffer()} style={{ flex:1, padding:"8px 0", borderRadius:9, border:`1px solid ${border}`, background:"transparent", color:textMuted, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                          Decline
                        </button>
                        <button onClick={()=>setShowOfferInput(true)} style={{ flex:1, padding:"8px 0", borderRadius:9, border:"1px solid #00B894", background:"transparent", color:"#00B894", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                          Counter
                        </button>
                        <button onClick={()=>onAcceptOffer&&onAcceptOffer(offerAmt)} style={{ flex:1.1, padding:"8px 0", borderRadius:9, border:"none", background:"#00B894", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                          Accept
                        </button>
                      </div>
                    )}
                    {m.mine && <div style={{ fontSize:12, color:textMuted, marginTop:2 }}>Awaiting response…</div>}
                  </div>
                ) : m.image ? (
                  <div style={{ display:"flex", flexDirection:"column", alignItems:m.mine?"flex-end":"flex-start", gap: (m.text && m.text !== "📷 Photo") ? 4 : 0 }}>
                    <a href={m.image} target="_blank" rel="noopener noreferrer" style={{ display:"block" }}>
                      <img src={m.image} alt="" style={{ maxWidth:"100%", maxHeight:260, borderRadius:14, objectFit:"cover", display:"block", border:`1px solid ${border}` }}/>
                    </a>
                    {m.text && m.text !== "📷 Photo" && (
                      <div style={{ background:m.mine?sentBg:receivedBg, color:m.mine?"#fff":textPrimary, borderRadius:br, padding:"9px 13px", fontSize:15, lineHeight:1.4, wordBreak:"break-word", whiteSpace:"pre-wrap" }}>
                        {renderMsg(m.text, m.mine)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ background:m.mine?sentBg:receivedBg, color:m.mine?"#fff":textPrimary, borderRadius:br, padding:"9px 13px", fontSize:15, lineHeight:1.4, wordBreak:"break-word", whiteSpace:"pre-wrap" }}>
                    {renderMsg(m.text, m.mine)}
                  </div>
                )}
                {groupLast && <div style={{ fontSize:11, color:textMuted, marginTop:3 }}>{m.time}</div>}
              </div>
            </div>
          );
        })}
        {otherTyping && (
          <div style={{ display:"flex", alignItems:"flex-end", gap:6, marginBottom:10 }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background: darkMode?"#2C2C2E":"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0, overflow:"hidden" }}>
              {activeConvo.avatarUrl ? <img src={activeConvo.avatarUrl} alt="" style={{width:28,height:28,objectFit:"cover"}}/> : "👽"}
            </div>
            <div style={{ background:receivedBg, borderRadius:"18px 18px 18px 5px", padding:"10px 14px", display:"flex", gap:5, alignItems:"center" }}>
              {[0,1,2].map(i=>(<div key={i} style={{ width:7, height:7, borderRadius:"50%", background:textMuted, animation:"typingDot 1.2s infinite", animationDelay:`${i*0.2}s` }}/>))}
            </div>
            <style>{`@keyframes typingDot{0%,60%,100%{transform:translateY(0);opacity:0.4}30%{transform:translateY(-5px);opacity:1}}`}</style>
          </div>
        )}
        <div ref={msgEndRef}/>
      </div>

      {/* Checkout card — visible to renter after owner accepts */}
      {ownerAcceptedReq && !pendingReq && (
        <div style={{ background: darkMode?"#1C1C1E":"#F2F2F7", borderTop:`0.5px solid ${border}`, padding:"8px 14px", display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <span style={{ fontSize:10.5, fontWeight:700, color:"#00B894", textTransform:"uppercase", letterSpacing:"0.4px", whiteSpace:"nowrap", display:"inline-flex", alignItems:"center", gap:4 }}><CheckCircle2 size={13} strokeWidth={2.5} color="#00B894"/>Accepted</span>
          <span style={{ flex:1, fontSize:13, color:textPrimary, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {ownerAcceptedReq.item?.title}
            {ownerAcceptedReq.dateStr && ownerAcceptedReq.dateStr!=="Purchase" && !ownerAcceptedReq.dateStr?.startsWith("Offer") && <span style={{ color:textMuted, fontWeight:400 }}> · {ownerAcceptedReq.dateStr}</span>}
          </span>
          {isPastTransaction(ownerAcceptedReq)
            ? <span style={{ fontSize:11, color:textMuted, flexShrink:0, whiteSpace:"nowrap" }}>Ended</span>
            : <button onClick={()=>{ const paid = ownerAcceptedReq.payment_status==='paid'; if(window.confirm(`Cancel this ${ownerAcceptedReq.item?.listingType==='service'?'service':'booking'}? The customer will be notified${paid?' and refunded':''}.`)) onOwnerCancel&&onOwnerCancel(ownerAcceptedReq); }} style={{ padding:"6px 12px", borderRadius:9, border:"1px solid #FA3E3E", background:"transparent", color:"#FA3E3E", fontSize:12.5, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
              Cancel
            </button>}
        </div>
      )}

      {acceptedReq && !pendingReq && (
        <div style={{ background: darkMode?"#1C1C1E":"#F2F2F7", borderTop:`0.5px solid ${border}`, padding:"8px 14px", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:7, marginBottom:7, flexWrap:"wrap" }}>
            <span style={{ fontSize:10.5, fontWeight:700, color:"#00B894", textTransform:"uppercase", letterSpacing:"0.4px", whiteSpace:"nowrap", display:"inline-flex", alignItems:"center", gap:4 }}><CreditCard size={13} strokeWidth={2.25} color="#00B894"/>Payment</span>
            <span style={{ fontSize:13, fontWeight:600, color:textPrimary }}>
              {acceptedReq.item?.title}
              {acceptedReq.dateStr && acceptedReq.dateStr!=="Purchase" && !acceptedReq.dateStr?.startsWith("Offer") && <span style={{ color:textMuted, fontWeight:400 }}> · {acceptedReq.dateStr}</span>}
            </span>
          </div>
          <div style={{ background: darkMode?"#2C2C2E":"#fff", borderRadius:10, padding:"8px 10px", marginBottom:8, border:`0.5px solid ${border}` }}>
            {(() => {
              const isService = acceptedReq.item?.listingType === "service";
              const isOfferType = acceptedReq.dateStr?.startsWith("Offer:");
              const offerPrice = isOfferType ? parseInt(acceptedReq.dateStr.split(":")[1]) : null;
              const isPurchase = acceptedReq.dateStr === "Purchase";
              // Services charge the agreed flat quote (never multiplied by dates).
              const nights = !isService && !isPurchase && !isOfferType && acceptedReq.start && acceptedReq.end
                ? Math.max(1, Math.ceil((new Date(acceptedReq.end) - new Date(acceptedReq.start)) / 86400000) + 1)
                : 1;
              const rate = isService
                ? (acceptedReq.quotedCents != null ? acceptedReq.quotedCents/100 : (Number(acceptedReq.item?.price) || 0))
                : offerPrice || (isPurchase
                ? (Number(acceptedReq.item?.salePrice) || Number(acceptedReq.item?.price) || 0)
                : (Number(acceptedReq.item?.price) || 0));
              const unit = acceptedReq.item?.priceUnit || 'day';
              const rental = rate * nights;
              const delivery = acceptedReq.wantsDelivery ? (Number(acceptedReq.deliveryFee) || 0) : 0;
              const total = rental + delivery;
              // Card adds an 8% service fee; show the all-in card price when card is available.
              const serviceFee = Math.round(rental * 0.08 * 100) / 100;
              const allIn = Math.round((total + serviceFee) * 100) / 100;
              const cardAvailable = !!STRIPE_KEY;
              const baseLabel = isService ? "Agreed" : offerPrice ? "Offer" : isPurchase ? "Price" : `${nights} ${unit}${nights>1?'s':''}`;
              return (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                    <span style={{ fontSize:13, fontWeight:700, color:textPrimary }}>Total</span>
                    <span style={{ fontSize:16, fontWeight:800, color:textPrimary }}>${(cardAvailable ? allIn : total).toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize:11, color:textMuted, marginTop:2 }}>
                    {baseLabel} ${rental.toFixed(2)}{delivery > 0 ? ` + $${delivery.toFixed(2)} delivery` : ""}{cardAvailable ? ` + 8% fee $${serviceFee.toFixed(2)} · cash $${total.toFixed(2)}` : ""}
                  </div>
                </>
              );
            })()}
          </div>
          {isPastTransaction(acceptedReq) ? (
            <div style={{ width:"100%", padding:"10px 0", textAlign:"center", fontSize:13, color:textMuted, fontWeight:600 }}>This request has expired.</div>
          ) : (
            <>
              <button onClick={()=>onCheckout&&onCheckout(acceptedReq)} style={{ width:"100%", padding:"10px 0", borderRadius:10, border:"none", background:"#00B894", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer" }}>
                Checkout →
              </button>
              {onCancelRequest && (
                <button onClick={()=>{ if(window.confirm("Cancel this request? The other person will be notified and the date freed up.")) onCancelRequest(acceptedReq); }} style={{ width:"100%", padding:"6px 0", marginTop:2, borderRadius:10, border:"none", background:"transparent", color:"#FA3E3E", fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                  Cancel request
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Pending booking request card — visible to owner only */}
      {pendingReq && (
        <div style={{ background: darkMode?"#1C1C1E":"#F2F2F7", borderTop:`0.5px solid ${border}`, padding:"8px 14px", flexShrink:0 }}>
          {/* Compact header + title + date on one line */}
          <div style={{ display:"flex", alignItems:"baseline", gap:7, marginBottom:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:10.5, fontWeight:700, color: pendingReq.item?.listingType==="service" ? "#7B61FF" : "#00B894", textTransform:"uppercase", letterSpacing:"0.4px", whiteSpace:"nowrap" }}>
              {pendingReq.dateStr==="Purchase" ? "Purchase" : pendingReq.dateStr==="Offer" ? "Offer" : pendingReq.item?.listingType==="service" ? "Service" : "Rental"}
            </span>
            <span style={{ fontSize:13, color:textPrimary, fontWeight:600 }}>
              {pendingReq.item?.title}
              {pendingReq.dateStr && pendingReq.dateStr!=="Offer" && pendingReq.dateStr!=="Purchase" && <span style={{ color:textMuted, fontWeight:400 }}> · {pendingReq.dateStr}</span>}
              {pendingReq.dateStr==="Purchase" && <span style={{ color:textMuted, fontWeight:400 }}> · ${pendingReq.item?.salePrice || pendingReq.item?.price}</span>}
            </span>
          </div>
          {pendingReq.wantsDelivery && pendingReq.dateStr!=="Offer" && pendingReq.item?.listingType!=="service" && (
            <button onClick={()=>setIncludeDelivery(v=>!v)} style={{ display:"flex", alignItems:"center", gap:8, background:"none", border:"none", cursor:"pointer", padding:"2px 0", marginBottom:6 }}>
              <div style={{ width:34, height:19, borderRadius:10, background:includeDelivery?"#00B894": darkMode?"#3A3A3C":"#C7C7CC", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                <div style={{ position:"absolute", top:2, left:includeDelivery?17:2, width:15, height:15, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }}/>
              </div>
              <span style={{ fontSize:12, color:textMuted }}>
                📦 Include delivery{pendingReq.deliveryFee ? ` (+$${pendingReq.deliveryFee})` : ""}
              </span>
            </button>
          )}
          {pendingReq.dateStr === "Offer" ? (
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>onDeclineOffer&&onDeclineOffer()} style={{ flex:1, padding:"8px 0", borderRadius:9, border:"none", background: darkMode?"#3A3A3C":"#E4E6EB", color:textPrimary, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Decline
              </button>
              <button onClick={()=>setShowOfferInput(true)} style={{ flex:1, padding:"8px 0", borderRadius:9, border:"1px solid #00B894", background:"transparent", color:"#00B894", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                Counter
              </button>
              {latestReceivedAmt && (
                <button onClick={()=>onAcceptOffer&&onAcceptOffer(latestReceivedAmt)} style={{ flex:1.2, padding:"8px 0", borderRadius:9, border:"none", background:"#00B894", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                  Accept ${latestReceivedAmt}
                </button>
              )}
            </div>
          ) : pendingReq.item?.listingType === "service" ? (
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ display:"flex", alignItems:"center", background: darkMode?"#2C2C2E":"#fff", border:`1.5px solid ${border}`, borderRadius:9, padding:"7px 8px", width:74, flexShrink:0 }}>
                <span style={{ color:"#7B61FF", fontWeight:700, marginRight:2, fontSize:15 }}>$</span>
                <input value={quotePrice} onChange={e=>setQuotePrice(e.target.value.replace(/[^0-9.]/g,""))} placeholder={String(pendingReq.item?.price||"")} type="number" style={{ width:"100%", minWidth:0, background:"none", border:"none", outline:"none", fontSize:15, fontFamily:"inherit", color:textPrimary, fontWeight:700 }}/>
              </div>
              <button onClick={()=>onDecline&&onDecline(pendingReq)} style={{ flex:1, padding:"8px 0", borderRadius:9, border:"none", background: darkMode?"#3A3A3C":"#E4E6EB", color:textPrimary, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Decline
              </button>
              <button onClick={()=>{ const amt = parseFloat(quotePrice || pendingReq.item?.price || 0); if(!amt) return; onAccept&&onAccept({...pendingReq, quotedAmount: amt}); }} style={{ flex:1.7, padding:"8px 0", borderRadius:9, border:"none", background:"#7B61FF", color:"#fff", fontSize:12.5, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                Send quote of ${quotePrice || pendingReq.item?.price || ""}
              </button>
            </div>
          ) : (
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>onDecline&&onDecline(pendingReq)} style={{ flex:1, padding:"8px 0", borderRadius:9, border:"none", background: darkMode?"#3A3A3C":"#E4E6EB", color:textPrimary, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Decline
              </button>
              <button onClick={()=>onAccept&&onAccept({...pendingReq, wantsDelivery: includeDelivery})} style={{ flex:1, padding:"8px 0", borderRadius:9, border:"none", background:"#00B894", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Accept
              </button>
            </div>
          )}
        </div>
      )}


      {/* Offer input panel */}
      {showOfferInput && (
        <div style={{ background: darkMode?"#1C1C1E":"#F6FBF9", borderTop:`1px solid ${darkMode ? "#2E4A40" : "#CDEFE2"}`, padding:"10px 14px", flexShrink:0 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#00B894", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.5px" }}>{latestReceivedAmt ? "Counter offer" : "Submit an offer"}</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ flex:1, display:"flex", alignItems:"center", background: darkMode?"#2C2C2E":"#fff", border:"1.5px solid #00B894", borderRadius:22, padding:"8px 14px" }}>
              <span style={{ color:"#00B894", fontWeight:700, marginRight:4 }}>$</span>
              <input
                value={offerInputAmt}
                onChange={e=>setOfferInputAmt(e.target.value.replace(/[^0-9.]/g,""))}
                onKeyDown={e=>e.key==="Enter"&&sendOffer()}
                placeholder="Enter amount"
                type="number"
                autoFocus
                style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:16, fontFamily:"inherit", color:textPrimary, fontWeight:700 }}
              />
            </div>
            <button onClick={sendOffer} disabled={!offerInputAmt} style={{ padding:"0 18px", borderRadius:22, border:"none", background:offerInputAmt?"#00B894":"#CCC", color:"#fff", fontSize:14, fontWeight:700, cursor:offerInputAmt?"pointer":"default", fontFamily:"inherit" }}>
              Send
            </button>
            <button onClick={()=>setShowOfferInput(false)} style={{ padding:"0 12px", borderRadius:22, border:`1px solid ${border}`, background:"none", color:textMuted, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input bar — iMessage style */}
      <div style={{ background:headerBg, backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderTop:`0.5px solid ${border}`, padding:"10px 12px", paddingBottom:"max(10px, env(safe-area-inset-bottom))", display:"flex", gap:8, alignItems:"flex-end", flexShrink:0 }}>
        <input ref={photoInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{ const f=e.target.files?.[0]; if(f) sendImage(f); e.target.value=""; }}/>
        <button onClick={()=>!imgUploading&&photoInputRef.current?.click()} title="Send a photo" style={{ width:34, height:34, borderRadius:"50%", border:"none", background:"transparent", color:"#00B894", cursor:imgUploading?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginBottom:3 }}>
          {imgUploading
            ? <div style={{ width:18, height:18, borderRadius:"50%", border:"2.5px solid #00B894", borderTopColor:"transparent", animation:"spin 0.75s linear infinite" }}/>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
        </button>
        {!showOfferInput && offerable && (
          <button onClick={()=>setShowOfferInput(true)} style={{ height:34, padding:"0 14px", borderRadius:22, border:"1.5px solid #00B894", background:"transparent", color:"#00B894", fontSize:13, fontWeight:700, cursor:"pointer", flexShrink:0, marginBottom:3, fontFamily:"inherit", whiteSpace:"nowrap" }}>
            {latestReceivedAmt ? "Counter" : "Offer"}
          </button>
        )}
        <div style={{ flex:1, background:inputBg, border:"1.5px solid #00B894", borderRadius:22, padding:"9px 14px", display:"flex", alignItems:"center", minHeight:40 }}>
          <input
            value={chatMsg}
            onChange={e=>{ setChatMsg(e.target.value); broadcastTyping(); }}
            onKeyDown={e=>e.key==="Enter"&&sendMsg()}
            placeholder="Message"
            autoComplete="off"
            style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:15, fontFamily:"inherit", color:textPrimary }}
          />
        </div>
        <button onClick={sendMsg} disabled={!chatMsg.trim()} style={{ width:34, height:34, borderRadius:"50%", border:"none", background:chatMsg.trim()?"#00B894":"transparent", color:chatMsg.trim()?"#fff":textMuted, cursor:chatMsg.trim()?"pointer":"default", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"background 0.15s", marginBottom:3 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
        </button>
      </div>
    </div>
  );
}

// Browse-card photo carousel — swipe on touch, arrows on tap/click, without opening the listing
function CardPhotoCarousel({ item }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef(null);
  const imgs = (item.uploadedImages || []).filter(i => i?.url);
  if (imgs.length === 0) return <span>{item.emoji}</span>;
  const shown = Math.min(idx, imgs.length - 1);
  const go = (e, dir) => {
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const next = (shown + dir + imgs.length) % imgs.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };
  const arrowStyle = side => ({
    position:"absolute", top:"50%", transform:"translateY(-50%)", [side]:6,
    width:26, height:26, borderRadius:"50%", border:"none", cursor:"pointer",
    background:"rgba(255,255,255,0.85)", color:"#1C1E21", fontSize:16, fontWeight:700,
    display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
    boxShadow:"0 1px 4px rgba(0,0,0,0.18)", padding:0, fontFamily:"inherit",
  });
  return (
    <>
      <div ref={ref} data-photo-carousel="1"
        onScroll={e=>{ const w = e.currentTarget.clientWidth || 1; const i = Math.round(e.currentTarget.scrollLeft / w); if (i !== idx) setIdx(Math.min(imgs.length-1, Math.max(0, i))); }}
        style={{ position:"absolute", inset:0, display:"flex", overflowX:"auto", scrollSnapType:"x mandatory", scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
        {imgs.map((im,i)=>(
          <img key={i} src={thumbSrc(im)} alt="" draggable={false} style={{ width:"100%", height:"100%", objectFit:"cover", scrollSnapAlign:"start", scrollSnapStop:"always", flexShrink:0 }}/>
        ))}
      </div>
      {imgs.length > 1 && (
        <>
          <button className="card-arrow" onClick={e=>go(e,-1)} style={arrowStyle("left")}>‹</button>
          <button className="card-arrow" onClick={e=>go(e,1)} style={arrowStyle("right")}>›</button>
          <div style={{ position:"absolute", bottom:7, left:"50%", transform:"translateX(-50%)", display:"flex", gap:4, pointerEvents:"none" }}>
            {imgs.map((_,i)=>(
              <div key={i} style={{ width:5, height:5, borderRadius:"50%", background: i===shown ? "#fff" : "rgba(255,255,255,0.5)", boxShadow:"0 0 2px rgba(0,0,0,0.4)", transition:"background 0.15s" }}/>
            ))}
          </div>
        </>
      )}
    </>
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
    ownerName: row.owner_name || null,
    ownerAvatarUrl: row.owner_avatar_url || null,
    ownerId: row.user_id || null,
    conditionAttestedAt: row.condition_attested_at || null,
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
    owner_avatar_url: listing.ownerAvatarUrl || null,
    // Legal record: timestamp the owner's condition/liability attestation at
    // publish/edit time. Re-stamped each time they re-confirm the box.
    condition_attested_at: listing.attested
      ? new Date().toISOString()
      : (listing.conditionAttestedAt || null),
  };
}

function AuthModal({ show, initialMode = "login", onClose, darkMode }) {
  const C = darkMode ? { bg:'#000000', card:'#1C1C1E', border:'#2C2C2E', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { bg:'#fff', card:'#fff', border:'#E4E6EB', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (show) { setMode(initialMode); setName(""); setEmail(""); setPassword(""); setError(""); setSuccessMsg(""); setLoading(false); setAgreed(false); }
  }, [show, initialMode]);

  if (!show) return null;

  const goMode = (m) => { setMode(m); setError(""); setSuccessMsg(""); };

  const submit = async () => {
    setError(""); setSuccessMsg("");
    setLoading(true);

    if (mode === "forgot") {
      if (!email) { setError("Enter your email address"); setLoading(false); return; }
      const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      setLoading(false);
      if (e) setError(e.message);
      else setSuccessMsg("Reset link sent! Check your email — including your spam/junk folder — and click the link to set a new password.");
      return;
    }

    if (!email || !password) { setError("Email and password are required"); setLoading(false); return; }
    if (mode === "signup" && !name.trim()) { setError("Name is required"); setLoading(false); return; }
    if (mode === "signup" && !agreed) { setError("Please confirm you're 18+ and agree to the Terms & Privacy Policy"); setLoading(false); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); setLoading(false); return; }

    if (mode === "login") {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password });
      if (e) { setError(e.message); setLoading(false); }
      else onClose();
    } else {
      const { error: e } = await supabase.auth.signUp({
        email, password,
        // Record terms/age consent on the account as a legal acceptance record.
        options: { data: { name: name.trim(), terms_accepted_at: new Date().toISOString(), terms_version: '2026-06-29', age_confirmed_18: true }, emailRedirectTo: window.location.origin },
      });
      setLoading(false);
      if (e) setError(e.message);
      else setSuccessMsg("Account created! Check your email for a confirmation link before signing in — if you don't see it, check your spam/junk folder.");
    }
  };

  const signInWithProvider = (provider) =>
    supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });

  const inp = { width:"100%", background:C.inputBg, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"14px 16px", color:C.text, fontFamily:"inherit", fontSize:15, outline:"none", boxSizing:"border-box" };
  const lbl = { fontSize:13, fontWeight:600, color:C.text, marginBottom:6, display:"block" };

  const headerSub = mode === "login" ? "Welcome back!" : mode === "signup" ? "Join thousands of neighbors sharing nearby" : "Reset your password";

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:800, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:C.card, borderRadius:"16px 16px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"92dvh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ background:"#00B894", padding:"18px 24px 22px", textAlign:"center", borderRadius:"16px 16px 0 0" }}>
          <div style={{ width:40, height:5, borderRadius:3, background:"rgba(255,255,255,0.35)", margin:"0 auto 14px" }}/>
          <div style={{ fontSize:26, fontWeight:900, color:"#fff", letterSpacing:-0.5, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>lendie</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", marginTop:4 }}>{headerSub}</div>
        </div>
        <div style={{ padding:"20px 24px 48px" }}>
          {mode !== "forgot" && (
            <div style={{ display:"flex", background:C.card, borderRadius:12, padding:4, marginBottom:20 }}>
              {[["login","Sign In"],["signup","Sign Up"]].map(([m,l])=>(
                <button key={m} onClick={()=>goMode(m)} style={{ flex:1, padding:"10px", borderRadius:9, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer", background:mode===m?"#00B894":"transparent", color:mode===m?"#fff":C.muted, transition:"all 0.18s" }}>{l}</button>
              ))}
            </div>
          )}

          {mode === "signup" && (
            <div style={{ marginBottom:14 }}>
              <label style={lbl}>Your Name</label>
              <input style={inp} placeholder="e.g. Alex Johnson" value={name} onChange={e=>setName(e.target.value)} autoComplete="name"/>
            </div>
          )}

          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Email</label>
            <input style={inp} type="email" placeholder="you@email.com" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" onKeyDown={e=>e.key==="Enter"&&submit()}/>
          </div>

          {mode !== "forgot" && (
            <div style={{ marginBottom: mode === "login" ? 8 : 20 }}>
              <label style={lbl}>Password</label>
              <input style={inp} type="password" placeholder={mode==="signup"?"At least 6 characters":"Your password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==="signup"?"new-password":"current-password"} onKeyDown={e=>e.key==="Enter"&&submit()}/>
            </div>
          )}

          {mode === "login" && (
            <div style={{ textAlign:"right", marginBottom:20 }}>
              <span onClick={()=>goMode("forgot")} style={{ fontSize:12, color:"#00B894", fontWeight:600, cursor:"pointer" }}>Forgot your password?</span>
            </div>
          )}

          {error && (
            <div style={{ borderRadius:10, padding:"11px 14px", marginBottom:16, fontSize:13, border:"1px solid", background:"#FFF0F0", color:"#FA3E3E", borderColor:"#FFCDD2" }}>
              {error}
            </div>
          )}
          {successMsg && (
            <div style={{ borderRadius:10, padding:"11px 14px", marginBottom:16, fontSize:13, border:"1px solid", background:"#E8FBF6", color:"#00A67E", borderColor:"#B2EFE3" }}>
              {successMsg}
            </div>
          )}

          {mode === "signup" && (
            <label style={{ display:"flex", alignItems:"flex-start", gap:9, marginBottom:16, cursor:"pointer" }}>
              <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{ marginTop:2, accentColor:"#00B894", width:16, height:16, flexShrink:0, cursor:"pointer" }}/>
              <span style={{ fontSize:12, color:C.muted, lineHeight:1.5 }}>
                I am <strong style={{ color:C.text }}>18 or older</strong> and agree to Lendie's <a href="/terms.html" target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ color:"#00B894", textDecoration:"underline" }}>Terms of Service</a> and <a href="/privacy.html" target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ color:"#00B894", textDecoration:"underline" }}>Privacy Policy</a>.
              </span>
            </label>
          )}

          <button onClick={submit} disabled={loading || (mode==="signup" && !agreed)} style={{ width:"100%", padding:"15px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:800, fontSize:16, cursor:(loading || (mode==="signup" && !agreed))?"not-allowed":"pointer", background:"#00B894", color:"#fff", opacity:(loading || (mode==="signup" && !agreed))?0.6:1, marginBottom:12 }}>
            {loading ? "…" : mode==="login" ? "Sign In" : mode==="signup" ? "Create Account" : "Send Reset Link"}
          </button>

          {/* Social logins (Google / Apple / Facebook) hidden until OAuth providers are
              verified & public-ready. Facebook app exists but is dev-mode only pending
              Meta business verification; Google/Apple not yet configured. Restore this
              block (and re-enable providers in Supabase) to bring social login back. */}
          {false && mode !== "forgot" && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"4px 0 16px" }}>
                <div style={{ flex:1, height:1, background:C.border }}/>
                <span style={{ fontSize:12, color:C.faint, fontWeight:500, whiteSpace:"nowrap" }}>or continue with</span>
                <div style={{ flex:1, height:1, background:C.border }}/>
              </div>
              <div style={{ display:"flex", gap:10, marginBottom:20 }}>
                {/* Google */}
                <button onClick={()=>signInWithProvider("google")} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"11px 0", borderRadius:12, border:`1.5px solid ${C.border}`, background:C.card, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600, color:C.text }}>
                  <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Google
                </button>
                {/* Apple */}
                <button onClick={()=>signInWithProvider("apple")} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"11px 0", borderRadius:12, border:"1.5px solid #E4E6EB", background:"#000", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600, color:"#fff" }}>
                  <svg width="16" height="16" viewBox="0 0 814 1000" fill="#fff"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.3-162-39.3c-76.5 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663.8 0 543.1c0-207.8 134.7-317.5 267.1-317.5 77.8 0 142.3 51.3 189.5 51.3 44.6 0 119.2-54.7 204.7-54.7zm-90.9-186.3c37.1-44.6 64-105.6 64-166.6 0-8.3-.6-16.7-2-24.4-60.6 2.3-132.3 40.4-176.4 91.7-33.8 38.5-65.4 99.5-65.4 161.8 0 9 1.4 18 2 21 3.5.6 9 1.4 14.5 1.4 54.1 0 120.6-36.4 163.3-84.9z"/></svg>
                  Apple
                </button>
                {/* Facebook */}
                <button onClick={()=>signInWithProvider("facebook")} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"11px 0", borderRadius:12, border:"1.5px solid #1877F2", background:"#1877F2", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600, color:"#fff" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  Facebook
                </button>
              </div>
            </>
          )}

          {mode === "forgot" ? (
            <div style={{ textAlign:"center", fontSize:13, color:C.muted }}>
              <span onClick={()=>goMode("login")} style={{ color:"#00B894", fontWeight:700, cursor:"pointer" }}>← Back to Sign In</span>
            </div>
          ) : (
            <div style={{ textAlign:"center", fontSize:13, color:C.muted }}>
              {mode==="login" ? "New to Lendie? " : "Already have an account? "}
              <span onClick={()=>goMode(mode==="login"?"signup":"login")} style={{ color:"#00B894", fontWeight:700, cursor:"pointer" }}>
                {mode==="login" ? "Sign Up" : "Sign In"}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PasswordResetModal({ show, onDone, darkMode }) {
  const _C = darkMode ? { card:'#1C1C1E', border:'#2C2C2E', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { card:'#fff', border:'#E4E6EB', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (!show) return null;

  const submit = async () => {
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    const { error: e } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (e) { setError(e.message); return; }
    setDone(true);
    setTimeout(onDone, 2000);
  };

  const inp = { width:"100%", background:_C.inputBg, border:`1.5px solid ${_C.border}`, borderRadius:12, padding:"14px 16px", color:_C.text, fontFamily:"inherit", fontSize:15, outline:"none", boxSizing:"border-box" };
  const lbl = { fontSize:13, fontWeight:600, color:_C.text, marginBottom:6, display:"block" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:900, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:_C.card, borderRadius:18, padding:28, maxWidth:380, width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize:32, textAlign:"center", marginBottom:12 }}>🔑</div>
        <div style={{ fontSize:19, fontWeight:800, color:_C.text, textAlign:"center", marginBottom:6 }}>Set a new password</div>
        <div style={{ fontSize:13, color:_C.muted, textAlign:"center", marginBottom:22 }}>Choose a strong password for your Lendie account.</div>

        {done ? (
          <div style={{ borderRadius:10, padding:"14px", background:"#E8FBF6", color:"#00A67E", border:"1px solid #B2EFE3", fontSize:14, fontWeight:600, textAlign:"center" }}>
            ✓ Password updated! Signing you in…
          </div>
        ) : (
          <>
            <div style={{ marginBottom:14 }}>
              <label style={lbl}>New Password</label>
              <input style={inp} type="password" placeholder="At least 6 characters" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password"/>
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={lbl}>Confirm Password</label>
              <input style={inp} type="password" placeholder="Same password again" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" onKeyDown={e=>e.key==="Enter"&&submit()}/>
            </div>
            {error && (
              <div style={{ borderRadius:10, padding:"11px 14px", marginBottom:16, fontSize:13, background:"#FFF0F0", color:"#FA3E3E", border:"1px solid #FFCDD2" }}>{error}</div>
            )}
            <button onClick={submit} disabled={loading} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:800, fontSize:15, cursor:loading?"not-allowed":"pointer", background:"#00B894", color:"#fff", opacity:loading?0.7:1 }}>
              {loading ? "Updating…" : "Update Password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SecurityModal({ show, user, onClose, darkMode }) {
  const _C = darkMode ? { card:'#1C1C1E', border:'#2C2C2E', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93', inputBg:'#2C2C2E' } : { card:'#fff', border:'#E4E6EB', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91', inputBg:'#fff' };
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busyName, setBusyName] = useState(false);
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  const [nameMsg, setNameMsg] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");

  // Start each open with a clean slate (component stays mounted between opens)
  useEffect(() => {
    if (show) { setNewName(user?.user_metadata?.name || ""); setNewEmail(""); setPw(""); setPw2(""); setNameMsg(""); setNameErr(""); setEmailMsg(""); setEmailErr(""); setPwMsg(""); setPwErr(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  const updateName = async () => {
    setNameErr(""); setNameMsg("");
    const n = newName.trim();
    if (n.length < 2) { setNameErr("Name must be at least 2 characters"); return; }
    if (n === (user?.user_metadata?.name || "")) { setNameErr("That's already your display name"); return; }
    setBusyName(true);
    const { error } = await supabase.auth.updateUser({ data: { name: n } });
    if (!error && user?.id) {
      // Propagate to existing listings so they show the new name right away.
      await supabase.from('listings').update({ owner_name: n }).eq('user_id', user.id);
    }
    setBusyName(false);
    if (error) { setNameErr(error.message); return; }
    setNameMsg("Display name updated.");
  };

  const updateEmail = async () => {
    setEmailErr(""); setEmailMsg("");
    const e = newEmail.trim();
    if (!e || !e.includes("@")) { setEmailErr("Enter a valid email address"); return; }
    if (e.toLowerCase() === (user?.email || "").toLowerCase()) { setEmailErr("That's already your email"); return; }
    setBusyEmail(true);
    const { error } = await supabase.auth.updateUser({ email: e }, { emailRedirectTo: window.location.origin });
    setBusyEmail(false);
    if (error) { setEmailErr(error.message); return; }
    setEmailMsg("Confirmation sent — check both your current and new inboxes to finish the change.");
    setNewEmail("");
  };

  const updatePassword = async () => {
    setPwErr(""); setPwMsg("");
    if (pw.length < 6) { setPwErr("Password must be at least 6 characters"); return; }
    if (pw !== pw2) { setPwErr("Passwords don't match"); return; }
    setBusyPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusyPw(false);
    if (error) { setPwErr(error.message); return; }
    setPwMsg("Password updated.");
    setPw(""); setPw2("");
  };

  const inp = { width:"100%", background:_C.inputBg, border:`1.5px solid ${_C.border}`, borderRadius:12, padding:"13px 15px", color:_C.text, fontFamily:"inherit", fontSize:15, outline:"none", boxSizing:"border-box" };
  const lbl = { fontSize:13, fontWeight:600, color:_C.text, marginBottom:6, display:"block" };
  const okBox = { borderRadius:10, padding:"11px 14px", marginTop:12, fontSize:13, background:"#E8FBF6", color:"#00A67E", border:"1px solid #B2EFE3" };
  const errBox = { borderRadius:10, padding:"11px 14px", marginTop:12, fontSize:13, background:"#FFF0F0", color:"#FA3E3E", border:"1px solid #FFCDD2" };
  const btn = (busy) => ({ width:"100%", marginTop:14, padding:"13px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:800, fontSize:15, cursor:busy?"not-allowed":"pointer", background:"#00B894", color:"#fff", opacity:busy?0.7:1 });

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:900, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={onClose}>
      <div style={{ background:_C.card, borderRadius:18, padding:24, maxWidth:400, width:"100%", maxHeight:"90dvh", overflowY:"auto", boxShadow:"0 8px 40px rgba(0,0,0,0.18)" }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:19, fontWeight:800, color:_C.text, textAlign:"center", marginBottom:4 }}>Login & Security</div>
        <div style={{ fontSize:12, color:_C.muted, textAlign:"center", marginBottom:20 }}>Signed in as {user?.email}</div>

        {/* Display name */}
        <div style={{ fontSize:13, fontWeight:800, color:_C.muted, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10 }}>Display Name</div>
        <label style={lbl}>The name shown on your listings and messages</label>
        <input style={inp} type="text" placeholder="Your name" value={newName} onChange={e=>setNewName(e.target.value)} autoComplete="name" onKeyDown={e=>e.key==="Enter"&&updateName()}/>
        {nameErr && <div style={errBox}>{nameErr}</div>}
        {nameMsg && <div style={okBox}>{nameMsg}</div>}
        <button onClick={updateName} disabled={busyName} style={btn(busyName)}>{busyName ? "Saving…" : "Update Name"}</button>

        <div style={{ height:1, background:_C.border, margin:"22px 0" }}/>

        {/* Change email */}
        <div style={{ fontSize:13, fontWeight:800, color:_C.muted, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10 }}>Change Email</div>
        <label style={lbl}>New email address</label>
        <input style={inp} type="email" placeholder="you@email.com" value={newEmail} onChange={e=>setNewEmail(e.target.value)} autoComplete="email"/>
        {emailErr && <div style={errBox}>{emailErr}</div>}
        {emailMsg && <div style={okBox}>{emailMsg}</div>}
        <button onClick={updateEmail} disabled={busyEmail} style={btn(busyEmail)}>{busyEmail ? "Sending…" : "Update Email"}</button>

        <div style={{ height:1, background:_C.border, margin:"22px 0" }}/>

        {/* Change password */}
        <div style={{ fontSize:13, fontWeight:800, color:_C.muted, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10 }}>Change Password</div>
        <label style={lbl}>New password</label>
        <input style={inp} type="password" placeholder="At least 6 characters" value={pw} onChange={e=>setPw(e.target.value)} autoComplete="new-password"/>
        <div style={{ height:10 }}/>
        <label style={lbl}>Confirm new password</label>
        <input style={inp} type="password" placeholder="Same password again" value={pw2} onChange={e=>setPw2(e.target.value)} autoComplete="new-password" onKeyDown={e=>e.key==="Enter"&&updatePassword()}/>
        {pwErr && <div style={errBox}>{pwErr}</div>}
        {pwMsg && <div style={okBox}>{pwMsg}</div>}
        <button onClick={updatePassword} disabled={busyPw} style={btn(busyPw)}>{busyPw ? "Updating…" : "Update Password"}</button>

        <button onClick={onClose} style={{ width:"100%", marginTop:18, padding:"12px", borderRadius:12, border:`1.5px solid ${_C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:15, cursor:"pointer", background:_C.card, color:_C.text }}>Close</button>
      </div>
    </div>
  );
}

export default function Lendie() {
  const [tab, setTab] = useState("browse");
  // Bottom nav hides on scroll-down, reappears on scroll-up (FB-style).
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  useEffect(() => { setNavHidden(false); }, [tab]);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const last = lastScrollYRef.current;
      if (y < 24) setNavHidden(false);
      else if (y > last + 6) setNavHidden(true);
      else if (y < last - 6) setNavHidden(false);
      lastScrollYRef.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [selectedItem, setSelectedItem] = useState(null);
  const viewedItemIds = useRef(new Set());
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lendie_favorites') || '[]'); } catch { return []; }
  });
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [requestSent, setRequestSent] = useState({});
  const [bookingRequests, setBookingRequests] = useState([]);
  const [blockingDatesFor, setBlockingDatesFor] = useState(null);
  const [bookedOverrides, setBookedOverrides] = useState({});
  const [reviewingBooking, setReviewingBooking] = useState(null);
  const [reviewedBookings, setReviewedBookings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lendie_reviewed') || '{}'); } catch { return {}; }
  });
  const [openSections, setOpenSections] = useState({});
  const [earningsRange, setEarningsRange] = useState('all'); // all | year | month | week
  const [adminOpenSections, setAdminOpenSections] = useState({ stats: true });
  const [listingRatings, setListingRatings] = useState({});
  const [paymentModal, setPaymentModal] = useState(null);
  const [showStripeModal, setShowStripeModal] = useState(false);
  const [paymentStep, setPaymentStep] = useState(1);
  const [connectStatus, setConnectStatus] = useState(null);
  const [wantsDelivery, setWantsDelivery] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCheck, setDeliveryCheck] = useState(null); // null | "checking" | "within" | "outside"
  const [deliveryCoords, setDeliveryCoords] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('lendie_dark') === 'true'; } catch { return false; }
  });
  const [cardNum, setCardNum] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [payMethod, setPayMethod] = useState("card");
  const [ownerProfileId, setOwnerProfileId] = useState(null);
  const [ownerProfileName, setOwnerProfileName] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [photoBrowser, setPhotoBrowser] = useState(null);
  const [myListings, setMyListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [publicListings, setPublicListings] = useState([]);
  const [addImages, setAddImages] = useState([]);
  const addImagesRef = useRef([]);
  useEffect(() => { addImagesRef.current = addImages; }, [addImages]);
  const [showAddListing, setShowAddListing] = useState(false);
  const [newListing, setNewListing] = useState({ title:"", price:"", priceUnit:"day", salePrice:"", category:"tools", emoji:"🔧", description:"", amenities:"", capacity:"", listingType:"rent", offersDelivery:false, deliveryFee:"", deliveryRadius:"", listingLocationAddress:"", listingLat:null, listingLng:null });
  const [managingListing, setManagingListing] = useState(null);
  const [editingListing, setEditingListing] = useState(null);
  const [editImages, setEditImages] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const activeConvoRef = useRef(null);
  const [draftMsg, setDraftMsg] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [notifications, setNotifications] = useState([]);
  // Read/hidden state for bell items derived from booking data (no DB row to track them)
  const [notifLocalState, setNotifLocalState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lendie_notif_state') || '{}'); } catch { return {}; }
  });
  const setNotifKeyState = (keys, val) => setNotifLocalState(prev => {
    const next = { ...prev };
    (Array.isArray(keys) ? keys : [keys]).forEach(k => { next[k] = val; });
    try { localStorage.setItem('lendie_notif_state', JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });
  const [showNotifs, setShowNotifs] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locationText, setLocationText] = useState(() => localStorage.getItem('lendie_loc_text') || "Current Location");
  const [resolvedLocation, setResolvedLocation] = useState("");
  const [gpsCoords, setGpsCoords] = useState(null);
  const [searchCoords, setSearchCoords] = useState(() => { try { return JSON.parse(localStorage.getItem('lendie_loc_coords')); } catch { return null; } });
  const [locationPickerKey, setLocationPickerKey] = useState(0);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);
  const [convoDeleteId, setConvoDeleteId] = useState(null);
  const [inboxEditMode, setInboxEditMode] = useState(false);
  // Conversations the current user has hidden from their own inbox (per-user delete).
  const [hiddenConvoIds, setHiddenConvoIds] = useState(() => new Set());
  const hiddenConvoIdsRef = useRef(hiddenConvoIds);
  useEffect(() => { hiddenConvoIdsRef.current = hiddenConvoIds; }, [hiddenConvoIds]);
  const [inboxFilter, setInboxFilter] = useState("all");
  const longPressRef = useRef(null);
  const longPressDidFire = useRef(false);
  const seenMsgIdsRef = useRef(new Set());
  const [radius, setRadius] = useState(() => Number(localStorage.getItem('lendie_radius')) || 50);
  useEffect(() => { localStorage.setItem('lendie_radius', String(radius)); }, [radius]);
  const [recentLocations, setRecentLocations] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lendie_recent_locs') || '[]'); } catch { return []; }
  });
  const pendingLocLabel = useRef("");
  const [sortBy, setSortBy] = useState("distance");
  const [listingTypeFilter, setListingTypeFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const msgEndRef = useRef(null);
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    if (user.id === OWNER_ID) { setIsAdmin(true); return; }
    supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle().then(({ data }) => setIsAdmin(!!data));
  }, [user]);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState("login");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('lendie_onboarded'));
  const [onboardStep, setOnboardStep] = useState(0);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(() => !!localStorage.getItem('lendie_banner_dismissed'));
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [profileSubTab, setProfileSubTab] = useState("profile");
  const [pullY, setPullY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const pullStartY = useRef(0);
  const pullStartScroll = useRef(0);
  const [notifPermission, setNotifPermission] = useState(() => typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [togglingPush, setTogglingPush] = useState(false);
  const [blocks, setBlocks] = useState([]);
  const [reportModal, setReportModal] = useState(null);

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
      // Detect email confirmation landing (token_hash in URL)
      const params = new URLSearchParams(window.location.search);
      if (session && params.get('token_hash') && params.get('type') === 'email') {
        showToast('Email confirmed! Welcome to Lendie 🎉');
        window.history.replaceState({}, '', window.location.pathname);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'PASSWORD_RECOVERY') {
        setShowPasswordReset(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Instant force-logout: admin broadcasts on the user's account channel when suspended.
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`account-${user.id}`)
      .on('broadcast', { event: 'suspended' }, async () => {
        await supabase.auth.signOut();
        setUser(null);
        alert('Your Lendie account has been suspended.');
        window.location.reload();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [user]);

  // Deep links: ?tab=messages (push notification taps) and ?item=<id> (shared listings)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ["browse","listings","messages","map","profile"].includes(tabParam)) {
      setTab(tabParam);
      params.delete('tab');
      window.history.replaceState({}, '', window.location.pathname + (params.toString() ? '?' + params.toString() : ''));
    }
    // ?owner=<id>&oname=<name> — opens a user's profile (used by the admin page).
    const ownerParam = params.get('owner');
    if (ownerParam) {
      setOwnerProfileId(ownerParam);
      const oname = params.get('oname');
      if (oname) { try { setOwnerProfileName(decodeURIComponent(oname)); } catch { setOwnerProfileName(oname); } }
      params.delete('owner'); params.delete('oname');
      window.history.replaceState({}, '', window.location.pathname + (params.toString() ? '?' + params.toString() : ''));
    }
    // Notification taps while the app is already open arrive as SW messages
    const onSwMessage = (e) => {
      if (e.data?.type !== 'navigate' || !e.data.url) return;
      try {
        const target = new URLSearchParams(new URL(e.data.url, window.location.origin).search).get('tab');
        if (target && ["browse","listings","messages","map","profile"].includes(target)) setTab(target);
      } catch { /* malformed url */ }
    };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onSwMessage);
  }, []);
  const itemDeepLinkDone = useRef(false);

  // Load conversations + threads from Supabase when user auth state changes
  useEffect(() => {
    if (!user) {
      setMessages([]);
      setHiddenConvoIds(new Set());
      return;
    }
    // Conversations this user has hidden from their inbox
    supabase.from('hidden_conversations').select('conversation_id').eq('user_id', user.id)
      .then(({ data }) => { if (data) setHiddenConvoIds(new Set(data.map(r => r.conversation_id))); });
    supabase.from('messages').select('*').order('created_at', { ascending: true }).then(({ data, error }) => {
      if (error) { console.error('[Messages] Load error:', error.message); return; }
      if (!data || data.length === 0) { setMessages([]); return; }
      const stored = (() => { try { return JSON.parse(localStorage.getItem('lendie_read') || '{}'); } catch { return {}; } })();

      // Pass 1: group by conversation_id, collect rows, derive other person's name/id
      const byConv = {};
      data.forEach(row => {
        const cid = row.conversation_id;
        if (!cid) return;
        if (!byConv[cid]) byConv[cid] = { cid, rows: [], otherUserId: null, from: null, avatarUrl: null, item: row.listing_title || "", latestTime: row.created_at };
        byConv[cid].rows.push(row);
        byConv[cid].latestTime = row.created_at;
        // The other person's name: if I sent → to_name; if they sent → from_name
        const otherName = row.from_user_id === user.id ? row.to_name : row.from_name;
        const otherId   = row.from_user_id === user.id ? row.to_user_id : row.from_user_id;
        // Grab avatar URL from rows where the other person sent (their from_avatar is their photo)
        const otherAvatarUrl = row.from_user_id !== user.id ? (row.from_avatar || null) : null;
        if (otherName && !byConv[cid].from) byConv[cid].from = otherName;
        if (otherId && !byConv[cid].otherUserId) byConv[cid].otherUserId = otherId;
        // Store avatarUrl if it's a real URL (not an emoji)
        if (otherAvatarUrl && otherAvatarUrl.length > 10 && !byConv[cid].avatarUrl) byConv[cid].avatarUrl = otherAvatarUrl;
      });

      // Pass 2: merge conversations with the same otherUserId into one thread
      const merged = {};
      Object.values(byConv).forEach(conv => {
        // Key by person+listing so separate items with the same person stay separate threads
        const groupKey = conv.otherUserId ? `${conv.otherUserId}:${conv.item || ''}` : conv.cid;
        if (!merged[groupKey]) {
          merged[groupKey] = {
            id: new Date(conv.latestTime).getTime(),
            conversation_id: conv.cid,
            from: conv.from || "Unknown",
            fromId: conv.otherUserId || conv.cid,
            avatarUrl: conv.avatarUrl || null,
            item: conv.item,
            time: conv.latestTime,
            unread: false,
            thread: [],
            otherUserId: conv.otherUserId || null,
          };
        }
        // Use the most recent conversation_id for sending new messages
        if (conv.latestTime >= merged[groupKey].time) {
          merged[groupKey].conversation_id = conv.cid;
          merged[groupKey].time = conv.latestTime;
          merged[groupKey].id = new Date(conv.latestTime).getTime();
        }
        // Carry forward avatarUrl if we found one
        if (conv.avatarUrl && !merged[groupKey].avatarUrl) merged[groupKey].avatarUrl = conv.avatarUrl;
        conv.rows.forEach(row => {
          merged[groupKey].thread.push({ mine: row.from_user_id === user.id, text: row.content, image: row.image_url || null, time: new Date(row.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), created_at: row.created_at, db_id: row.id });
          const storedKey = conv.otherUserId ? `${conv.otherUserId}:${conv.item || ''}` : groupKey;
          const storedVal = stored[storedKey] || stored[conv.cid];
          // stored value is now an ISO timestamp; old entries were boolean true (treat as "already read but unknown when")
          const alreadyReadByTimestamp = typeof storedVal === 'string' && row.created_at <= storedVal;
          if (!row.read && row.from_user_id !== user.id && !alreadyReadByTimestamp) merged[groupKey].unread = true;
        });
      });

      // Pass 3: merge any remaining conversations with the same from-name + item
      // (handles old rows where to_user_id was never stored)
      const final = {};
      const nameToKey = {}; // "name:item" → final key already stored
      Object.values(merged).forEach(conv => {
        const nameKey = ((conv.from || "").toLowerCase().trim()) + ':' + (conv.item || '');
        const finalKey = conv.otherUserId ? `${conv.otherUserId}:${conv.item || ''}` : null;
        if (finalKey) {
          if (!final[finalKey]) {
            final[finalKey] = conv;
          } else {
            final[finalKey].thread.push(...conv.thread);
            if (conv.time > final[finalKey].time) {
              final[finalKey].conversation_id = conv.conversation_id;
              final[finalKey].time = conv.time;
              final[finalKey].id = conv.id;
            }
            if (conv.unread) final[finalKey].unread = true;
          }
          if (nameKey) nameToKey[nameKey] = finalKey;
        } else {
          // No user ID — try to match an existing group by name+item
          const existingKey = nameKey && nameToKey[nameKey];
          if (existingKey && final[existingKey]) {
            final[existingKey].thread.push(...conv.thread);
            if (conv.time > final[existingKey].time) {
              final[existingKey].conversation_id = conv.conversation_id;
              final[existingKey].time = conv.time;
              final[existingKey].id = conv.id;
            }
            if (conv.unread) final[existingKey].unread = true;
          } else {
            const fallbackKey = nameKey || conv.conversation_id;
            if (!final[fallbackKey]) {
              final[fallbackKey] = conv;
              if (nameKey) nameToKey[nameKey] = fallbackKey;
            } else {
              final[fallbackKey].thread.push(...conv.thread);
              if (conv.time > final[fallbackKey].time) {
                final[fallbackKey].conversation_id = conv.conversation_id;
                final[fallbackKey].time = conv.time;
                final[fallbackKey].id = conv.id;
              }
              if (conv.unread) final[fallbackKey].unread = true;
            }
          }
        }
      });

      Object.values(final).forEach(m => m.thread.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)));
      const convList = Object.values(final);

      // Fallback 1: look up listing owner_avatar_url for conversations missing an avatar
      const missingAvatarTitles = [...new Set(convList.filter(c => !c.avatarUrl && c.item).map(c => c.item))];
      const applyAvatars = (list) => {
        // Fallback 2: look up from_avatar from any message sent by the other user (exclude self)
        const missingUserIds = [...new Set(list.filter(c => !c.avatarUrl && c.otherUserId && c.otherUserId !== user?.id).map(c => c.otherUserId))];
        if (missingUserIds.length > 0) {
          supabase.from('messages').select('from_user_id, from_avatar').in('from_user_id', missingUserIds).not('from_avatar', 'is', null).limit(200).then(({ data: avatarMsgs }) => {
            if (!avatarMsgs) { setMessages(list); seenMsgIdsRef.current = new Set(); return; }
            const avatarByUser = {};
            avatarMsgs.forEach(r => { if (r.from_avatar && !avatarByUser[r.from_user_id]) avatarByUser[r.from_user_id] = r.from_avatar; });
            setMessages(list.map(c => (!c.avatarUrl && c.otherUserId && avatarByUser[c.otherUserId]) ? { ...c, avatarUrl: avatarByUser[c.otherUserId] } : c));
            seenMsgIdsRef.current = new Set();
          });
        } else {
          setMessages(list);
          seenMsgIdsRef.current = new Set();
        }
      };
      if (missingAvatarTitles.length > 0) {
        supabase.from('listings').select('title, user_id, owner_avatar_url').in('title', missingAvatarTitles).then(({ data: listings }) => {
          const enriched = !listings ? convList : convList.map(c => {
            if (c.avatarUrl || !c.item) return c;
            const match = listings.find(l => l.title === c.item && l.user_id === c.otherUserId);
            return match?.owner_avatar_url ? { ...c, avatarUrl: match.owner_avatar_url } : c;
          });
          applyAvatars(enriched);
        });
      } else {
        applyAvatars(convList);
      }
    });
  }, [user]);

  useEffect(() => {
    setProfilePhotoUrl(user?.user_metadata?.avatar_url || null);
  }, [user]);

  // Keep activeConvoRef in sync for use inside poll closures
  useEffect(() => { activeConvoRef.current = activeConvo; }, [activeConvo]);

  // Eagerly fetch the other person's avatar when a conversation is opened and avatarUrl is missing
  useEffect(() => {
    if (!activeConvo || activeConvo.avatarUrl || !activeConvo.otherUserId || !user) return;
    const otherId = activeConvo.otherUserId;
    const convId = activeConvo.conversation_id;
    // First try listing's owner_avatar_url
    supabase.from('listings').select('owner_avatar_url').eq('user_id', otherId).not('owner_avatar_url', 'is', null).limit(1).then(({ data: ld }) => {
      const url = ld?.[0]?.owner_avatar_url;
      if (url) {
        setActiveConvo(prev => prev?.conversation_id === convId && !prev.avatarUrl ? { ...prev, avatarUrl: url } : prev);
        setMessages(prev => prev.map(m => m.otherUserId === otherId && !m.avatarUrl ? { ...m, avatarUrl: url } : m));
        return;
      }
      // Then try any message they sent with a from_avatar
      supabase.from('messages').select('from_avatar').eq('from_user_id', otherId).not('from_avatar', 'is', null).limit(1).then(({ data: md }) => {
        const msgUrl = md?.[0]?.from_avatar;
        if (msgUrl) {
          setActiveConvo(prev => prev?.conversation_id === convId && !prev.avatarUrl ? { ...prev, avatarUrl: msgUrl } : prev);
          setMessages(prev => prev.map(m => m.otherUserId === otherId && !m.avatarUrl ? { ...m, avatarUrl: msgUrl } : m));
          return;
        }
        // Final fallback: check the avatars storage bucket directly
        supabase.storage.from('avatars').list(otherId, { limit: 1 }).then(({ data: files }) => {
          if (!files?.length) return;
          const { data: fileData } = supabase.storage.from('avatars').getPublicUrl(`${otherId}/${files[0].name}`);
          const storageUrl = fileData?.publicUrl;
          if (!storageUrl) return;
          setActiveConvo(prev => prev?.conversation_id === convId && !prev.avatarUrl ? { ...prev, avatarUrl: storageUrl } : prev);
          setMessages(prev => prev.map(m => m.otherUserId === otherId && !m.avatarUrl ? { ...m, avatarUrl: storageUrl } : m));
        });
      });
    });
  }, [activeConvo?.conversation_id, activeConvo?.otherUserId]);

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
          createdAt: row.created_at,
        })));
      });
  }, [user]);

  // Realtime subscriptions — keep messages, booking requests, and notifications live
  useEffect(() => {
    if (!user) return;

    // Unified handler for all incoming message delivery paths
    const seenMsgIds = seenMsgIdsRef.current;
    const sessionStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const handleIncomingMsg = (row) => {
      if (!row || row.from_user_id === user.id) return;
      // A new message resurfaces a conversation the user had hidden.
      if (row.conversation_id && hiddenConvoIdsRef.current.has(row.conversation_id)) {
        setHiddenConvoIds(prev => { const next = new Set(prev); next.delete(row.conversation_id); return next; });
        supabase.from('hidden_conversations').delete().eq('user_id', user.id).eq('conversation_id', row.conversation_id)
          .then(({ error }) => { if (error) console.error('[Inbox] unhide failed:', error.message); });
      }
      const newMsg = { mine: false, text: row.content, image: row.image_url || null, time: new Date(row.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), created_at: row.created_at, db_id: row.id };
      setMessages(prev => {
        // Match by conversation_id first, then by sender+item so the same two people
        // never end up with two threads about the same listing
        let idx = prev.findIndex(m => m.conversation_id === row.conversation_id);
        if (idx < 0 && row.from_user_id && row.listing_title) idx = prev.findIndex(m => m.otherUserId === row.from_user_id && m.item === row.listing_title);
        if (idx >= 0) {
          const existing = prev[idx];
          if ((existing.thread || []).some(t => t.db_id === row.id || (t.text === row.content && Math.abs(new Date(t.created_at || 0) - new Date(row.created_at)) < 5000))) return prev;
          const updated = [...prev];
          const avatarUrl = row.from_avatar?.length > 10 ? row.from_avatar : existing.avatarUrl;
          updated[idx] = { ...existing, avatarUrl, item: existing.item || row.listing_title || '', thread: [...(existing.thread || []), newMsg], time: row.created_at, unread: true };
          return updated;
        }
        return [...prev, { id: Date.now(), conversation_id: row.conversation_id, from: row.from_name || 'Someone', fromId: row.from_user_id, otherUserId: row.from_user_id, avatarUrl: row.from_avatar?.length > 10 ? row.from_avatar : null, item: row.listing_title || '', time: row.created_at, unread: true, thread: [newMsg] }];
      });
      setActiveConvo(prev => {
        const matches = prev && (prev.conversation_id === row.conversation_id || (row.from_user_id && row.listing_title && prev.otherUserId === row.from_user_id && prev.item === row.listing_title));
        if (!matches) return prev;
        if ((prev.thread || []).some(t => t.db_id === row.id || (t.text === row.content && Math.abs(new Date(t.created_at || 0) - new Date(row.created_at)) < 5000))) return prev;
        const avatarUrl = row.from_avatar?.length > 10 ? row.from_avatar : prev.avatarUrl;
        return { ...prev, avatarUrl, thread: [...(prev.thread || []), newMsg] };
      });
    };

    // Primary: postgres_changes fires instantly when a row is inserted
    const msgRtChannel = supabase.channel(`msg-rt-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_user_id=eq.${user.id}` }, ({ new: row }) => {
        if (!row?.id || seenMsgIdsRef.current.has(row.id)) return;
        seenMsgIdsRef.current.add(row.id);
        handleIncomingMsg(row);
      })
      .subscribe();

    // Fast path: broadcast sent by the sender immediately on send
    const msgChannel = supabase.channel(`inbox-${user.id}`)
      .on('broadcast', { event: 'new_message' }, ({ payload }) => {
        if (!payload?.conversation_id || !payload?.content) return;
        const row = { ...payload };
        if (row.id && seenMsgIdsRef.current.has(row.id)) return;
        if (row.id) seenMsgIdsRef.current.add(row.id);
        handleIncomingMsg(row);
      })
      .subscribe();

    // Fallback poll every 5s — catches anything missed by the above
    const pollMessages = async () => {
      // Poll 1: all messages addressed to me in the last 5 minutes
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('to_user_id', user.id)
        .neq('from_user_id', user.id)
        .gte('created_at', sessionStart)
        .order('created_at', { ascending: true });
      (data || []).forEach(row => {
        if (seenMsgIdsRef.current.has(row.id)) return;
        seenMsgIdsRef.current.add(row.id);
        handleIncomingMsg(row);
      });

      // Poll 2: also query the currently open conversation by its ID — catches messages
      // even when to_user_id is null or not matching (belt-and-suspenders)
      const openConvId = activeConvoRef.current?.conversation_id;
      if (openConvId) {
        const { data: convData } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', openConvId)
          .neq('from_user_id', user.id)
          .gte('created_at', sessionStart)
          .order('created_at', { ascending: true });
        (convData || []).forEach(row => {
          if (seenMsgIdsRef.current.has(row.id)) return;
          seenMsgIdsRef.current.add(row.id);
          handleIncomingMsg(row);
        });
      }

      // Poll 3: notifications — same belt-and-suspenders path as messages, so the
      // bell never depends on the realtime publication being configured
      const { data: notifRows } = await supabase
        .from('notifications').select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (notifRows?.length) {
        setNotifications(prev => {
          const fresh = notifRows.filter(row => !prev.some(n => n.id === row.id || (n.unread && n.text === row.text && (n.sub || '') === (row.sub || ''))));
          if (fresh.length === 0) return prev;
          return [...fresh.map(row => ({ id: row.id, icon: row.icon, text: row.text, sub: row.sub, time: row.time_label, unread: row.unread, type: row.type, createdAt: row.created_at })), ...prev];
        });
      }
    };
    pollMessages();
    const msgPoll = setInterval(pollMessages, 5000);

    // Re-poll immediately when tab becomes visible again (catches missed messages while in background)
    const onVisible = () => { if (document.visibilityState === 'visible') pollMessages(); };
    document.addEventListener('visibilitychange', onVisible);

    // Booking requests: re-fetch on any change
    const reqChannel = supabase.channel(`rt-booking-reqs-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_requests' }, (payload) => {
        const row = payload.new || payload.old;
        if (!row || (row.renter_id !== user.id && row.owner_id !== user.id)) return;
        supabase.from('booking_requests').select('*').or(`renter_id.eq.${user.id},owner_id.eq.${user.id}`).order('created_at', { ascending: false }).then(({ data }) => {
          if (data) setBookingRequests(data.map(r => ({
            id: r.id, dbId: r.id, item: r.item_json, start: r.start_date, end: r.end_date,
            dateStr: r.date_str, wantsDelivery: r.wants_delivery, deliveryAddress: r.delivery_address,
            deliveryFee: r.delivery_fee, renterName: r.renter_name, renterId: r.renter_id,
            ownerId: r.owner_id, status: r.status, payment_status: r.payment_status,
            stripe_amount_cents: r.stripe_amount_cents, time: new Date(r.created_at).toLocaleString(),
            createdAt: r.created_at,
            payout_amount_cents: r.payout_amount_cents, payout_status: r.payout_status,
            payout_release_at: r.payout_release_at, payout_released_at: r.payout_released_at,
            renter_fee_cents: r.renter_fee_cents, quotedCents: r.quoted_cents,
          })));
        });
      })
      .subscribe();

    // Notifications: prepend new ones instantly
    const notifChannel = supabase.channel(`rt-notifs-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        const row = payload.new;
        setNotifications(prev => {
          // Skip exact id matches and the local echo of our own addNotification insert
          if (prev.some(n => n.id === row.id || (n.unread && n.text === row.text && (n.sub || '') === (row.sub || '')))) return prev;
          return [{ id: row.id, icon: row.icon, text: row.text, sub: row.sub, time: row.time_label, unread: row.unread, type: row.type, createdAt: row.created_at }, ...prev];
        });
      })
      .subscribe();

    return () => {
      clearInterval(msgPoll);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(msgRtChannel);
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(reqChannel);
      supabase.removeChannel(notifChannel);
    };
  }, [user?.id]);

  // Push notification subscription — check existing sub on login
  useEffect(() => {
    if (!user || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then(async sw => {
      try {
        const sub = await sw.pushManager.getSubscription();
        if (sub) {
          setPushEnabled(true);
          const json = sub.toJSON();
          await supabase.from('push_subscriptions').delete().eq('user_id', user.id);
          await supabase.from('push_subscriptions').insert({ user_id: user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
        }
      } catch (e) {
        console.warn('[Push] check error:', e.message);
      }
    });
  }, [user]);

  async function togglePushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      showToast("Push notifications are not supported on this browser.", "error");
      return;
    }
    setTogglingPush(true);
    try {
      const sw = await navigator.serviceWorker.ready;
      if (pushEnabled) {
        const sub = await sw.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          if (user) await supabase.from('push_subscriptions').delete().eq('user_id', user.id);
        }
        setPushEnabled(false);
        showToast("Push notifications disabled.");
      } else {
        const perm = await Notification.requestPermission();
        setNotifPermission(perm);
        if (perm !== 'granted') {
          showToast("Please allow notifications in your browser settings.", "error");
          setTogglingPush(false);
          return;
        }
        if (!VAPID_PUBLIC_KEY) {
          showToast("Push notifications are not configured yet.", "error");
          setTogglingPush(false);
          return;
        }
        const sub = await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        const json = sub.toJSON();
        if (user) {
          await supabase.from('push_subscriptions').delete().eq('user_id', user.id);
          const { error: insertErr } = await supabase.from('push_subscriptions').insert({ user_id: user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
          if (insertErr) console.error('[Push] save failed:', insertErr.message);
        }
        setPushEnabled(true);
        showToast("Push notifications enabled!");
      }
    } catch (e) {
      console.warn('[Push] toggle error:', e.message);
      showToast("Something went wrong. Try again.", "error");
    }
    setTogglingPush(false);
  }

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
          ownerId: row.owner_id,
          status: row.status,
          payment_status: row.payment_status,
          stripe_amount_cents: row.stripe_amount_cents,
          time: new Date(row.created_at).toLocaleString(),
          createdAt: row.created_at,
          payout_amount_cents: row.payout_amount_cents,
          payout_status: row.payout_status,
          payout_release_at: row.payout_release_at,
          payout_released_at: row.payout_released_at,
          renter_fee_cents: row.renter_fee_cents,
          quotedCents: row.quoted_cents,
        })));
      });
  }, [user]);

  // Track location permission so we can nudge users who haven't enabled it
  const [locPromptState, setLocPromptState] = useState(null); // 'granted' | 'prompt' | 'denied' | null
  const [locBannerDismissed, setLocBannerDismissed] = useState(() => sessionStorage.getItem('lendie_loc_banner') === '1');
  useEffect(() => {
    navigator.permissions?.query({ name: 'geolocation' }).then(s => {
      setLocPromptState(s.state);
      s.onchange = () => setLocPromptState(s.state);
    }).catch(() => {});
  }, []);

  // Approximate location from the user's IP address — the reliable fallback when
  // browser GPS is blocked or unavailable (very common on desktop / when macOS
  // Location Services is off for the browser). City-level accuracy, no OS
  // permission required. Tries two free HTTPS providers for resilience.
  const ipLocate = async (interactive = false) => {
    const tryOne = async (url, pick) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const c = pick(await r.json());
        return (c && Number(c.lat) && Number(c.lng)) ? c : null;
      } catch { return null; }
    };
    const c = await tryOne('https://ipapi.co/json/', d => ({ lat: d.latitude, lng: d.longitude, place: [d.city, d.region_code].filter(Boolean).join(', ') }))
           || await tryOne('https://ipwho.is/', d => (d && d.success === false ? null : { lat: d.latitude, lng: d.longitude, place: [d.city, d.region_code || d.region].filter(Boolean).join(', ') }));
    if (c) {
      setGpsCoords({ lat: Number(c.lat), lng: Number(c.lng) });
      setLocPromptState('granted');
      if (c.place) setResolvedLocation(c.place);
      if (interactive) showToast(c.place ? `Approximate location — ${c.place}` : 'Approximate location set');
      return true;
    }
    return false;
  };

  // Resolve the viewer's location. Tries precise browser GPS first, then falls
  // back to IP-based location so "Use mine" works even when the OS blocks GPS.
  // `interactive` = the user explicitly clicked "Use mine" (vs the silent attempt
  // on mount), so we surface progress/result toasts.
  const requestLocation = (interactive = false) => {
    if (!navigator.geolocation) {
      if (interactive) showToast('Getting your location…');
      ipLocate(interactive).then(ok => { if (!ok && interactive) showToast("Couldn't detect your location — enter your city with the 📍 pin.", 'error'); });
      return;
    }
    if (interactive) showToast('Getting your location…');
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lng } = pos.coords;
        setGpsCoords({ lat, lng });
        setLocPromptState('granted');
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
          if (interactive) showToast(place ? `Location set — ${place}${state ? ', ' + state : ''}` : 'Location set');
        } else if (interactive) {
          showToast('Location set');
        }
      } catch { if (interactive) showToast('Location set'); }
    }, async err => {
      if (err.code === 1) setLocPromptState('denied');
      // Browser GPS failed — fall back to approximate IP-based location so
      // "Use mine" still works without any OS permission.
      const ok = await ipLocate(interactive);
      if (!ok && interactive) {
        showToast("Couldn't detect your location automatically — enter your city with the 📍 pin instead.", 'error');
      }
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  };
  useEffect(() => { requestLocation(); }, []);

  // Persist search location across app closes — reopening returns to the last area viewed
  useEffect(() => {
    if (locationText === "Current Location") {
      localStorage.removeItem('lendie_loc_text');
      localStorage.removeItem('lendie_loc_coords');
    } else {
      localStorage.setItem('lendie_loc_text', locationText);
      if (searchCoords) localStorage.setItem('lendie_loc_coords', JSON.stringify(searchCoords));
    }
  }, [locationText, searchCoords]);

  const markConvoRead = (convo) => {
    setMessages(prev => prev.map(m => m.id === convo.id ? {...m, unread:false} : m));
    try {
      const r = JSON.parse(localStorage.getItem('lendie_read') || '{}');
      const nowIso = new Date().toISOString();
      if (convo.otherUserId) r[`${convo.otherUserId}:${convo.item || ''}`] = nowIso;
      if (convo.conversation_id) r[convo.conversation_id] = nowIso;
      localStorage.setItem('lendie_read', JSON.stringify(r));
    } catch {}
    if (convo.conversation_id) {
      supabase.from('messages').update({ read:true })
        .eq('conversation_id', convo.conversation_id).neq('from_user_id', user.id)
        .then(({ error }) => { if (error) console.error('[Read]', error.message); });
    }
  };

  // Auto-mark conversation as read whenever it becomes active
  useEffect(() => {
    if (activeConvo) markConvoRead(activeConvo);
  }, [activeConvo?.id]);

  // Increment view counter once per session when a listing is opened
  useEffect(() => {
    if (!selectedItem?.id || typeof selectedItem.id !== 'number') return;
    if (selectedItem.ownerId === 'me') return;
    if (viewedItemIds.current.has(selectedItem.id)) return;
    viewedItemIds.current.add(selectedItem.id);
    supabase.from('listings').update({ views: (selectedItem.views || 0) + 1 }).eq('id', selectedItem.id).then(({ error }) => { if (error) console.error('[Views] update failed:', error.message); });
    setMyListings(prev => prev.map(l => l.id === selectedItem.id ? { ...l, views: (l.views || 0) + 1 } : l));
  }, [selectedItem?.id]);

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
  }, [user?.id, refreshTick]);

  // Fetch all listings for browse view — no user filter so every listing is visible
  // (Supabase RLS must have a SELECT policy with USING (true) for this to work for guests)
  useEffect(() => {
    supabase.from('listings').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error('[Listings] fetch error:', error.message); return; }
        if (!data) return;
        setPublicListings(data.map(row => ({
          ...dbToListing(row),
          owner: row.owner_name || 'Neighbor',
          ownerAvatar: '👽',
          ownerId: row.user_id || ('anon-' + (row.owner_name || 'unknown').toLowerCase().replace(/\s+/g, '-')),
          distance: 0,
        })));
      });
  }, [user?.id, refreshTick]);

  useEffect(() => {
    if (!user) { setBlocks([]); return; }
    supabase.from('blocks').select('blocked_id').eq('blocker_id', user.id)
      .then(({ data }) => { if (data) setBlocks(data.map(r => r.blocked_id)); });
  }, [user?.id]);

  useEffect(() => {
    try { localStorage.setItem('lendie_dark', darkMode); } catch {}
    document.body.style.background = darkMode ? '#000000' : '';
    document.documentElement.style.background = darkMode ? '#000000' : '';
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
  }, [darkMode]);

  // Load Stripe Connect status when user is on profile tab
  useEffect(() => {
    if (!STRIPE_KEY || !user) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-connect-status`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (!data.error) setConnectStatus(data);
      } catch {}
    });
  }, [user?.id, tab === 'profile']);

  // Handle return from Stripe Connect onboarding
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_connected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      setTab('profile');
      showToast('Stripe account connected! Checking verification status…');
      // Re-fetch connect status after a brief delay for Stripe to propagate
      setTimeout(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/get-connect-status`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const data = await res.json();
          if (!data.error) {
            setConnectStatus(data);
            if (data.chargesEnabled) showToast('Payouts are now active!');
            else showToast('Verification pending — Stripe may email you to complete setup.');
          }
        } catch {}
      }, 2000);
    } else if (params.get('stripe_refresh') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      setTab('profile');
      showToast('Payout setup incomplete — please try again.');
    }
  }, []);

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
  const blockUser = async (userId) => {
    if (!user || !userId) return;
    const { error } = await supabase.from('blocks').insert({ blocker_id: user.id, blocked_id: userId });
    if (!error) { setBlocks(prev => [...prev, userId]); showToast('User blocked'); }
  };
  const unblockUser = async (userId) => {
    if (!user || !userId) return;
    await supabase.from('blocks').delete().eq('blocker_id', user.id).eq('blocked_id', userId);
    setBlocks(prev => prev.filter(id => id !== userId));
    showToast('User unblocked');
  };
  const openReport = (reportedUserId, reportedName, context = 'profile', reportedListingId = null) =>
    setReportModal({ reportedUserId, reportedName, context, reportedListingId });

  const toggleFav = id => {
    const adding = !favorites.includes(id);
    const next = adding ? [...favorites, id] : favorites.filter(x => x !== id);
    setFavorites(next);
    try { localStorage.setItem('lendie_favorites', JSON.stringify(next)); } catch {}
    // Sync to the DB for signed-in users so favorites follow them across the
    // website, the installed app, and other devices.
    if (user?.id) {
      if (adding) supabase.from('user_favorites').upsert({ user_id: user.id, listing_id: id }, { onConflict: 'user_id,listing_id' }).then(({ error }) => { if (error) console.error('[fav] add failed:', error.message); });
      else supabase.from('user_favorites').delete().eq('user_id', user.id).eq('listing_id', id).then(({ error }) => { if (error) console.error('[fav] remove failed:', error.message); });
    }
  };

  // On sign-in, pull favorites from the DB and merge with any saved locally (e.g.
  // while logged out), so they sync across the website, the installed app, and
  // other devices. Local-only favorites are pushed up to the DB.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('user_favorites').select('listing_id').eq('user_id', user.id);
      if (error || cancelled) return;
      const dbIds = (data || []).map(r => Number(r.listing_id));
      let local = [];
      try { local = JSON.parse(localStorage.getItem('lendie_favorites') || '[]'); } catch {}
      const merged = [...new Set([...local, ...dbIds])];
      const localOnly = local.filter(id => !dbIds.includes(id));
      if (localOnly.length) {
        await supabase.from('user_favorites').upsert(localOnly.map(listing_id => ({ user_id: user.id, listing_id })), { onConflict: 'user_id,listing_id' });
      }
      if (cancelled) return;
      try { localStorage.setItem('lendie_favorites', JSON.stringify(merged)); } catch {}
      setFavorites(merged);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

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
    e.target.value = '';
    showToast("Uploading...");
    const processed = await downscaleImage(file, 512);
    const isJpeg = processed !== file;
    const ext = isJpeg ? 'jpg' : (file.type === 'image/png' ? 'png' : 'jpg');
    const path = `${user.id}/avatar.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, processed, { upsert: true, cacheControl: '31536000', contentType: isJpeg ? 'image/jpeg' : file.type });
    if (error) { showToast("Upload failed: " + error.message, "error"); return; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    const { error: updateErr } = await supabase.auth.updateUser({ data: { avatar_url: url } });
    if (updateErr) { showToast("Saved photo but couldn't update profile", "error"); return; }
    setProfilePhotoUrl(url);
    // Propagate new avatar to all listings so other users see it immediately
    supabase.from('listings').update({ owner_avatar_url: url }).eq('user_id', user.id).then(({ error }) => { if (error) console.error('[Avatar] listing sync failed:', error.message); });
    showToast("Profile photo updated!");
  };

  const deleteConversation = async (convo) => {
    setConvoDeleteId(null);
    // Hide for this user only — don't delete the shared messages (which would
    // also wipe the thread for the other person).
    if (convo.conversation_id && user) {
      setHiddenConvoIds(prev => new Set(prev).add(convo.conversation_id));
      const { error } = await supabase.from('hidden_conversations')
        .insert({ user_id: user.id, conversation_id: convo.conversation_id });
      if (error && error.code !== '23505') { // ignore "already hidden"
        console.error('[Inbox] hide failed:', error.message);
        showToast('Failed to delete conversation', 'error');
        setHiddenConvoIds(prev => { const next = new Set(prev); next.delete(convo.conversation_id); return next; });
        return;
      }
    } else {
      // Local-only convo with no server id — just drop it from state.
      setMessages(prev => prev.filter(m => m.id !== convo.id));
    }
    if (activeConvo?.id === convo.id) setActiveConvo(null);
  };

  const clearAllConversations = async () => {
    const ids = [...new Set(visibleMessages.map(m => m.conversation_id).filter(Boolean))];
    setInboxEditMode(false);
    setConvoDeleteId(null);
    // Drop ephemeral local-only convos (no server id) outright.
    setMessages(prev => prev.filter(m => m.conversation_id));
    if (!user || ids.length === 0) return;
    setHiddenConvoIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    const { error } = await supabase.from('hidden_conversations')
      .upsert(ids.map(conversation_id => ({ user_id: user.id, conversation_id })), { onConflict: 'user_id,conversation_id' });
    if (error) console.error('[Inbox] clear-all hide failed:', error.message);
  };

  const addNotification = (notif) => {
    const local = { ...notif, id: Date.now(), createdAt: new Date().toISOString() };
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
      }).select('id, created_at').single().then(({ data, error }) => {
        if (error) { console.error('[Notif] save failed:', error.message); return; }
        // Adopt the DB id so realtime/poll echoes dedupe by id instead of text
        if (data) setNotifications(prev => prev.map(n => n.id === local.id ? { ...n, id: data.id, createdAt: data.created_at } : n));
      });
    }
  };

  const visibleMessages = useMemo(() => messages.filter(m => (!m.otherUserId || !blocks.includes(m.otherUserId)) && !(m.conversation_id && hiddenConvoIds.has(m.conversation_id))), [messages, blocks, hiddenConvoIds]);
  // Most-recent-activity timestamp for a conversation — used to sort the inbox so
  // the newest message is always at the top.
  const convoTs = (m) => {
    const last = m.thread?.length ? m.thread[m.thread.length - 1] : null;
    const t = last?.created_at || m.time;
    const parsed = t ? new Date(t).getTime() : NaN;
    return isNaN(parsed) ? (m.id || 0) : parsed;
  };

  // Incoming requests on my listings, surfaced in the inbox
  const ownerPendingReqs = bookingRequests.filter(r=>r.ownerId===user?.id && r.status==="pending" && r.dateStr!=="Offer");
  const pendingReqForConvo = m => ownerPendingReqs.find(r=>r.renterId===m.otherUserId && r.item?.title===m.item);
  // A conversation is about a listing — show that item's photo as the avatar so
  // multiple threads with the same person stay distinguishable.
  const convoThumb = (m) => {
    if (!m?.item) return null;
    const listing = allItems?.find(l => l.title === m.item)
      || bookingRequests.find(r => r.item?.title === m.item)?.item;
    if (!listing) return null;
    const url = thumbSrc(listing.uploadedImages?.[0]);
    const emoji = !url ? (listing.photos?.find(p => typeof p === 'string' && !p.startsWith('http')) || listing.emoji || null) : null;
    return { url, emoji };
  };
  const orphanOwnerReqs = ownerPendingReqs.filter(r=>!visibleMessages.some(m=>m.otherUserId===r.renterId && m.item===r.item?.title));
  // Badge counts inbox rows needing attention — a convo with a pending request is one row, not two
  const unreadMsgs = visibleMessages.filter(m => m.unread || pendingReqForConvo(m)).length + orphanOwnerReqs.length;

  // Bell items derived straight from booking data — works exactly like the inbox,
  // with no dependency on cross-user notification writes or realtime delivery
  const derivedNotifs = useMemo(() => {
    if (!user) return [];
    const items = [];
    for (const r of bookingRequests) {
      if (!r.dbId) continue;
      const base = { createdAt: r.createdAt, time: r.createdAt ? new Date(r.createdAt).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Recently' };
      if (r.ownerId === user.id && r.status === 'pending') {
        if (r.dateStr === 'Offer') items.push({ key:`offer-${r.dbId}`, icon:'💸', text:`New offer: ${r.item?.title}`, sub:`${r.renterName} made an offer`, type:'request', ...base });
        else if (r.dateStr === 'Purchase') items.push({ key:`buy-${r.dbId}`, icon:'🛒', text:`New purchase request: ${r.item?.title}`, sub:`${r.renterName} wants to buy`, type:'request', ...base });
        else items.push({ key:`req-${r.dbId}`, icon:'📬', text:`New request: ${r.item?.title}`, sub:`${r.renterName} wants to rent${reqWhen(r.dateStr, ' · ')}`, type:'request', ...base });
      }
      if (r.renterId === user.id && (r.status === 'accepted' || r.status === 'confirmed')) {
        items.push({ key:`acc-${r.dbId}`, icon:'✅', text:`Accepted: ${r.item?.title}`, sub:`Your request was accepted${reqWhen(r.dateStr, ' · ')}`, type:'confirm', ...base });
      }
      if (r.renterId === user.id && r.status === 'declined') {
        items.push({ key:`dec-${r.dbId}`, icon:'❌', text:`Declined: ${r.item?.title}`, sub:`Your request${reqWhen(r.dateStr, ' for ')} was declined`, type:'declined', ...base });
      }
    }
    return items;
  }, [bookingRequests, user?.id]);

  const bellItems = useMemo(() => {
    // Derived and stored items never describe the same event (derived covers
    // request/accept/decline; stored covers everything else) — no cross-filtering
    const derived = derivedNotifs
      .filter(d => notifLocalState[d.key] !== 'hidden')
      .map(d => ({ id: d.key, derived: true, icon: d.icon, text: d.text, sub: d.sub, time: d.time, type: d.type, unread: notifLocalState[d.key] !== 'read', createdAt: d.createdAt }));
    return [...derived, ...notifications].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [derivedNotifs, notifications, notifLocalState]);
  const unreadNotifs = bellItems.filter(n=>n.unread).length;

  // Opening the notification tray counts as viewing everything in it — mark all
  // as read so the bell badge clears, mirroring how opening a conversation
  // auto-marks it read. Clicking an individual notification still navigates.
  useEffect(() => {
    if (!showNotifs) return;
    const derivedKeys = derivedNotifs
      .filter(d => notifLocalState[d.key] !== 'read' && notifLocalState[d.key] !== 'hidden')
      .map(d => d.key);
    if (derivedKeys.length) setNotifKeyState(derivedKeys, 'read');
    if (notifications.some(n => n.unread)) {
      setNotifications(prev => prev.map(n => n.unread ? { ...n, unread: false } : n));
      if (user) supabase.from('notifications').update({ unread:false }).eq('user_id', user.id).eq('unread', true)
        .then(({ error }) => { if (error) console.error('[Notif] view-all read failed:', error.message); });
    }
  }, [showNotifs]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRequestConvo = async (req) => {
    let convo = messages.find(m => m.otherUserId === req.renterId && m.item === req.item?.title);
    if (!convo) {
      const { data: rows } = await supabase.from('messages').select('*')
        .eq('listing_title', req.item?.title)
        .or(`from_user_id.eq.${req.renterId},to_user_id.eq.${req.renterId}`)
        .order('created_at', { ascending: true });
      if (rows && rows.length > 0) {
        const convId = rows[0].conversation_id;
        const thread = rows.map(r => ({ mine: r.from_user_id === user?.id, text: r.content, image: r.image_url || null, time: new Date(r.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), created_at: r.created_at }));
        const avatarUrl = rows.find(r => r.from_user_id === req.renterId)?.from_avatar || null;
        convo = { id: new Date(rows[rows.length-1].created_at).getTime(), conversation_id: convId, from: req.renterName, fromId: req.renterId, otherUserId: req.renterId, avatarUrl, item: req.item?.title||'', sub: req.dateStr, time: rows[rows.length-1].created_at, unread: false, thread };
        setMessages(prev => { const ex = prev.find(m => m.otherUserId === req.renterId && m.item === req.item?.title); return ex ? prev.map(m => m === ex ? convo : m) : [...prev, convo]; });
      } else {
        convo = { id: Date.now(), conversation_id: `conv_req_${req.dbId||req.id}`, from: req.renterName, fromId: req.renterId, otherUserId: req.renterId, item: req.item?.title||'', sub: req.dateStr, time:"Just now", unread:false, thread:[] };
        setMessages(prev=>[...prev, convo]);
      }
    } else { markConvoRead(convo); }
    setActiveConvo(convo);
    setTab('messages');
  };

  const centerCoords = locationText === "Current Location" ? gpsCoords : searchCoords;

  const allItems = useMemo(() => {
    const myIds = new Set(myListings.map(l => l.id));
    const blockedSet = new Set(blocks);
    const merge = item => {
      // An override is the authoritative booked list (fresh from the server or a local booking)
      const extra = bookedOverrides[item.id];
      return extra ? { ...item, booked: extra } : item;
    };
    const enrich = item => {
      const lr = listingRatings[item.id];
      const base = lr ? { ...item, rating: lr.avg, reviews: lr.count } : item;
      // Real distance from the viewer's location (GPS or the searched location).
      // null when we can't compute it (no location set, or the listing has no
      // coordinates) so the UI hides it instead of showing a misleading "0 mi".
      const distance = (centerCoords && base.lat && base.lng)
        ? haversineDistance(centerCoords.lat, centerCoords.lng, base.lat, base.lng)
        : null;
      return { ...base, distance };
    };
    return [
      ...myListings.map(l => enrich(merge({ ...l, owner:"You", ownerAvatar:"🧑", ownerId:"me", reviews:l.reviews||0, uploadedImages:l.uploadedImages||[] }))),
      ...publicListings
        .filter(l => !myIds.has(l.id) && !blockedSet.has(l.ownerId))
        .map(l => enrich(merge({ ...l, reviews:l.reviews||0, uploadedImages:l.uploadedImages||[] }))),
    ];
  }, [myListings, publicListings, bookedOverrides, listingRatings, blocks, centerCoords]);

  // Refresh availability whenever a listing detail opens — booked dates change
  // owner-side (accepts, blocked dates), so renters need a fresh read mid-session
  useEffect(() => {
    const id = selectedItem?.id;
    if (!id || typeof id !== 'number') return;
    supabase.from('listings').select('booked, available').eq('id', id).single().then(({ data, error }) => {
      if (error || !data) return;
      setBookedOverrides(prev => ({ ...prev, [id]: data.booked || [] }));
      setSelectedItem(prev => prev?.id === id ? { ...prev, booked: data.booked || [], available: data.available } : prev);
    });
  }, [selectedItem?.id]);

  // Open a shared listing once the catalog has loaded (?item=<id>)
  useEffect(() => {
    if (itemDeepLinkDone.current || allItems.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get('item');
    if (!itemId) { itemDeepLinkDone.current = true; return; }
    const item = allItems.find(l => String(l.id) === itemId);
    if (item) {
      setSelectedItem(item);
      itemDeepLinkDone.current = true;
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [allItems]);

  const filtered = useMemo(() => allItems.filter(item => {
    // Sold or paused listings leave the marketplace for everyone
    if (!item.available) return false;
    if (showFavOnly && !favorites.includes(item.id)) return false;
    if (category!=="all" && category!=="everything" && item.category!==category) return false;
    if (search) {
      const q = search.toLowerCase();
      const catLabel = ALL_CATS.find(c => c.id === item.category)?.label?.toLowerCase() || '';
      if (!item.title.toLowerCase().includes(q) && !item.description?.toLowerCase().includes(q) && !catLabel.includes(q)) return false;
    }
    // Distance filter — only when we have a real center point (GPS or a searched
    // location). With a center, a listing must have coordinates AND fall within
    // the radius; listings with no coordinates can't be confirmed in range, so
    // they're excluded rather than leaking in. With no center we can't measure
    // distance at all, so nothing is filtered and the UI prompts for a location
    // instead of pretending the results are "near you".
    if (centerCoords) {
      if (!item.lat || !item.lng) return false;
      const dist = haversineDistance(centerCoords.lat, centerCoords.lng, item.lat, item.lng);
      if (dist > radius) return false;
    }
    if (listingTypeFilter === "rent" && (item.listingType === "sale" || item.listingType === "service")) return false;
    if (listingTypeFilter === "buy" && (item.listingType === "rent" || item.listingType === "service")) return false;
    if (listingTypeFilter === "services" && item.listingType !== "service") return false;
    return true;
  }).sort((a,b) => {
    if (sortBy==="price") return a.price-b.price;
    if (sortBy==="price-desc") return b.price-a.price;
    if (sortBy==="rating") return (b.rating||0)-(a.rating||0);
    if (sortBy==="newest") return (b.id||0)-(a.id||0);
    // Unknown distances sort last so listings without coordinates don't jump to the top.
    return (a.distance ?? Infinity) - (b.distance ?? Infinity);
  }), [allItems, showFavOnly, favorites, category, search, centerCoords, radius, listingTypeFilter, sortBy]);

  const C = darkMode ? {
    bg: '#000000', card: '#1C1C1E', surface: '#1C1C1E', border: '#2C2C2E', borderFaint: '#242426',
    text: '#F2F2F7', muted: '#AEAEB2', faint: '#8E8E93', accent: '#00B894',
    inputBg: '#2C2C2E', chip: '#2C2C2E', chipText: '#EBEBF5', searchBg: '#1C1C1E',
  } : {
    bg: '#fff', card: '#fff', surface: '#fff', border: '#E4E6EB', borderFaint: '#F0F2F5',
    text: '#1C1E21', muted: '#65676B', faint: '#8A8D91', accent: '#00B894',
    inputBg: '#fff', chip: '#fff', chipText: '#1C1E21', searchBg: '#F0F2F5',
  };
  const S = {
    app:{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif", background:C.bg, minHeight:"100dvh", width:"100%", maxWidth: isDesktop ? "none" : 430, margin: isDesktop ? 0 : "0 auto", color:C.text, paddingBottom: isDesktop ? 0 : "calc(56px + env(safe-area-inset-bottom, 0px))", paddingTop: isDesktop ? 64 : 0 },
    overlay:{ position:"fixed", inset:0, height:"100dvh", background:"rgba(0,0,0,0.65)", zIndex:300, display:"flex", alignItems:"flex-end" },
    sheet:{ background:C.card, borderRadius:"20px 20px 0 0", padding:"20px 16px calc(40px + env(safe-area-inset-bottom, 0px))", width:"100%", maxHeight:"90dvh", overflowY:"auto", borderTop:`1px solid ${C.border}`, overscrollBehavior:"contain" },
    pBtn:{ width:"100%", padding:"15px", borderRadius:14, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:16, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10, letterSpacing:0.1 },
    gBtn:{ width:"100%", padding:"13px", borderRadius:14, border:`1.5px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:15, cursor:"pointer", background:C.card, color:C.text },
    fg:{ marginBottom:14 },
    lbl:{ fontSize:12, fontWeight:600, color:C.text, marginBottom:6, display:"block", letterSpacing:0.2, textTransform:"uppercase" },
    inp:{ width:"100%", background:C.inputBg, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 14px", color:C.text, fontFamily:"inherit", fontSize:15, outline:"none", boxSizing:"border-box" },
    sel:{ width:"100%", background:C.inputBg, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 14px", color:C.text, fontFamily:"inherit", fontSize:15, outline:"none" },
    nav:{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, background: darkMode ? "rgba(24,25,26,0.96)" : "rgba(255,255,255,0.96)", backdropFilter:"blur(20px) saturate(180%)", WebkitBackdropFilter:"blur(20px) saturate(180%)", borderTop:`1px solid ${darkMode?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.07)"}`, boxShadow:"0 -1px 0 rgba(0,0,0,0.04)", display: isDesktop ? "none" : "flex", zIndex:100, paddingBottom:"env(safe-area-inset-bottom, 0px)" },
  };
  const CAT_EMOJI_MAP = { tools:"🔧", trailers:"🚛", construction:"🏗️", kitchen:"🍳", garden:"🌱", outdoors:"🏕️", venues:"🏛️", party:"🎉", tech:"💻", other:"📦" };

  const [submittingListing, setSubmittingListing] = useState(false);
  // Open the create form with a clean slate — never leak photos/fields from a previous listing
  const openNewListing = () => {
    setEditingListing(null);
    setNewListing({ title:"", price:"", priceUnit:"day", salePrice:"", category:"tools", emoji:"🔧", description:"", amenities:"", capacity:"", listingType:"rent", offersDelivery:false, deliveryFee:"", deliveryRadius:"", listingLocationAddress:"", listingLat:null, listingLng:null });
    setAddImages([]);
    setShowAddListing(true);
  };
  const handleAddListing = async () => {
    if (submittingListing) return;
    if (!newListing.title) { showToast("Enter a name for your listing","error"); return; }
    if (newListing.listingType === "service" && !newListing.price) { showToast("Enter a service price","error"); return; }
    if (newListing.listingType !== "sale" && newListing.listingType !== "service" && !newListing.price) { showToast("Enter a rental price","error"); return; }
    if (newListing.listingType === "sale" && !newListing.price) { showToast("Enter a sale price","error"); return; }
    if (newListing.listingType === "both" && !newListing.salePrice) { showToast("Enter a sale price","error"); return; }
    if (newListing.listingType !== "service" && !newListing.attested) { showToast("Please confirm the item condition box","error"); return; }
    setSubmittingListing(true);
    const finalLat = newListing.listingLat || gpsCoords?.lat || null;
    const finalLng = newListing.listingLng || gpsCoords?.lng || null;
    const colors = ["#F59E0B","#EC4899","#10B981","#3B82F6","#8B5CF6","#EF4444"];
    const amenArr = newListing.amenities ? newListing.amenities.split(",").map(a=>a.trim()).filter(Boolean) : [];
    if (newListing.offersDelivery && newListing.deliveryFee) amenArr.push("Delivery available (+$"+newListing.deliveryFee+")");
    const dbRow = {
      ...listingToDb({
        ...newListing, price: Number(newListing.price),
        lat: finalLat, lng: finalLng,
        color: colors[Math.floor(Math.random()*colors.length)],
        available: true, booked: newListing.booked || [], views: 0, requests: 0, earnings: 0, rating: null, reviews: 0,
        amenities: amenArr, capacity: newListing.capacity ? Number(newListing.capacity) : null,
        uploadedImages: addImagesRef.current.filter(img => img.url),
        photos: addImagesRef.current.filter(img => img.url).length > 0 ? [] : [newListing.emoji||"📦"],
      }),
      user_id: user?.id,
      owner_name: user?.user_metadata?.name || user?.email?.split('@')[0] || 'Lender',
      owner_avatar_url: user?.user_metadata?.avatar_url || null,
    };
    const { data, error } = await supabase.from('listings').insert(dbRow).select().single();
    if (error) {
      console.error('[listings insert] error:', error);
      console.error('[listings insert] code:', error.code, '| status:', error.status);
      console.error('[listings insert] row sent:', JSON.stringify(dbRow, null, 2));
      showToast(error.message || "Failed to save listing", "error");
      setSubmittingListing(false);
      return;
    }
    setMyListings(prev=>[dbToListing(data), ...prev]);
    setNewListing({ title:"", price:"", priceUnit:"day", salePrice:"", category:"tools", emoji:"🔧", description:"", amenities:"", capacity:"", listingType:"rent", offersDelivery:false, deliveryFee:"", deliveryRadius:"", listingLocationAddress:"", listingLat:null, listingLng:null });
    setAddImages([]);
    setShowAddListing(false);
    setSubmittingListing(false);
    setTab("listings");
    showToast("Listing published!");
  };

  const [submittingEdit, setSubmittingEdit] = useState(false);
  const handleEditSave = async () => {
    if (submittingEdit) return;
    if (newListing.listingType !== "service" && !newListing.attested) { showToast("Please confirm the item condition box","error"); return; }
    setSubmittingEdit(true);
    const savedImages = addImagesRef.current.filter(img => img.url);
    const photos = savedImages.length > 0 ? [] : (newListing.photos?.length ? newListing.photos : [newListing.emoji||"📦"]);
    const { error } = await supabase.from('listings').update(listingToDb({...newListing,uploadedImages:savedImages,photos})).eq('id', editingListing.id);
    if (error) { setSubmittingEdit(false); showToast("Failed to update","error"); return; }
    setMyListings(prev=>prev.map(l=>l.id===editingListing.id?{...l,...newListing,uploadedImages:savedImages}:l));
    setEditingListing(null);
    setAddImages([]);
    setShowAddListing(false);
    setSubmittingEdit(false);
    setTab("listings");
    showToast("Listing updated!");
  };

  // Send a message about a listing, always reusing the existing thread between these
  // two users for this item — never forks a second conversation
  const sendItemMessage = (otherId, otherName, otherAvatarUrl, itemTitle, sub, text) => {
    const msgObj = { mine: true, text, time: "Just now", created_at: new Date().toISOString() };
    const existing = messages.find(m => m.otherUserId === otherId && m.item === itemTitle);
    let convo;
    if (existing) {
      convo = { ...existing, thread: [...(existing.thread || []), msgObj], time: "Just now", sub: sub || existing.sub };
      setMessages(prev => prev.map(m => m.id === existing.id ? convo : m));
    } else {
      convo = { id: Date.now(), conversation_id: `conv_${Date.now()}`, from: otherName, fromId: otherId, otherUserId: otherId, avatarUrl: otherAvatarUrl || null, item: itemTitle, sub, time: "Just now", unread: false, thread: [msgObj] };
      setMessages(prev => prev.find(m => m.otherUserId === otherId && m.item === itemTitle) ? prev : [...prev, convo]);
    }
    setActiveConvo(convo);
    const myName = user?.user_metadata?.name || 'Someone';
    supabase.from('messages').insert({
      conversation_id: convo.conversation_id, from_name: myName, from_avatar: profilePhotoUrl || null,
      to_name: otherName, listing_title: itemTitle, content: text, read: false,
      from_user_id: user.id, to_user_id: otherId,
    }).then(({ error }) => { if (error) console.error('[Chat] auto-msg failed:', error.message); });
    broadcastMessage(otherId, { conversation_id: convo.conversation_id, listing_title: itemTitle, content: text, from_user_id: user.id, from_name: myName, from_avatar: profilePhotoUrl || null, created_at: new Date().toISOString() });
    return convo;
  };

  const handlePaymentConfirm = async (stripeData = null) => {
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
      // Stripe bookings are pre-created by the Edge Function. Scheduled bookings
      // saved a card but haven't been charged yet.
      ...(stripeData?.bookingDbId ? { dbId: stripeData.bookingDbId, payment_status: stripeData.scheduled ? 'scheduled' : 'paid', stripe_amount_cents: stripeData.amountCents, ...(stripeData.chargeAt ? { charge_at: stripeData.chargeAt } : {}) } : {}),
    };
    setBookingRequests(prev => [...prev, req]);
    setRequestSent(r => ({...r, [item.id]: "pending"}));
    setPaymentModal(null); setShowStripeModal(false); setPaymentStep(1); setWantsDelivery(false);
    setDeliveryAddress(""); setDeliveryCoords(null); setDeliveryCheck(null);
    setSelectedItem(null);
    if (stripeData?.bookingDbId && stripeData.scheduled) {
      const when = stripeData.chargeAt ? new Date(stripeData.chargeAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'before your rental';
      showToast(`Card saved! You'll be charged on ${when}.`);
      addNotification({ icon: "💳", text: "Card saved: " + item.title, sub: `Charged on ${when} · cancel free until then`, time: "Just now", type: "payment" });
    } else if (stripeData?.bookingDbId) {
      showToast("Payment confirmed! You're all set.");
      addNotification({ icon: "✅", text: "Payment confirmed: " + item.title, sub: "Booking secured" + (dateStr ? " · " + dateStr : ""), time: "Just now", type: "payment" });
    } else {
      showToast("Request sent! Waiting for owner approval.");
      addNotification({ icon: "⏳", text:"Request sent: "+item.title, sub:"Waiting for owner approval · "+dateStr, time:"Just now", type:"request" });
    }
    setTab("messages");

    if (stripeData?.bookingDbId) {
      // Webhook sends "Payment received" to the owner — only push for fresh (non-chat) payments
      if (!stripeData.scheduled && !paymentModal?.existingBookingId && item.ownerId && item.ownerId !== 'me') {
        const renterName = user?.user_metadata?.name || 'Someone';
        sendPushToUser(item.ownerId, {
          title: '💰 Payment received',
          body: `${renterName} paid for ${item.title}${dateStr ? ' · ' + dateStr : ''}`,
          url: '/?tab=messages',
          tag: `booking-req-${stripeData.bookingDbId}`,
        });
      }
    } else if (user && item.ownerId && item.ownerId !== 'me') {
      // Non-Stripe path: insert booking to DB
      const { data, error: insertErr } = await supabase.from('booking_requests').insert({
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
      if (insertErr) { console.error('[BookingRequest] insert error:', insertErr.message); return; }
      if (data) setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, dbId: data.id } : r));
      const renterName = user?.user_metadata?.name || 'Someone';

      sendPushToUser(item.ownerId, {
        title: 'New rental request',
        body: `${renterName} wants to rent ${item.title}`,
        url: '/?tab=messages',
        tag: `booking-req-${data?.id || req.id}`,
      });
      sendEmail(item.ownerId, `New rental request — ${item.title}`,
        `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">📬 New rental request</h2>
         <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px"><strong>${renterName}</strong> wants to rent <strong>${item.title}</strong>.</p>
         <p style="margin:0 0 20px;color:#65676B;font-size:14px">Dates: ${dateStr || 'To be arranged'}</p>
         ${emailBtn('Accept or Decline')}`
      );
    }

    // Auto-create or continue the chat thread — both payment paths,
    // so the request always lands in the owner's inbox as a conversation
    if (user && item.ownerId && item.ownerId !== 'me') {
      let initialText;
      if (paymentModal?.existingBookingId) {
        // Already in conversation — just confirm payment
        initialText = `✅ Payment confirmed!`;
      } else if (stripeData?.bookingDbId) {
        initialText = `Hi! I've paid and would like to rent "${item.title}"`;
        if (dateStr) initialText += ` for ${dateStr}`;
        if (wantsDelivery && deliveryAddress) {
          initialText += `.\n\nI'm hoping for delivery to ${deliveryAddress} — let me know if that works and we can figure out the timing and details!`;
        } else if (wantsDelivery) {
          initialText += `. I'd love delivery if possible — let me know and we can work out the details!`;
        } else {
          initialText += `. Let me know if you have any questions!`;
        }
      } else {
        initialText = `Hi! I'd like to rent "${item.title}"`;
        if (dateStr) initialText += ` for ${dateStr}`;
        if (wantsDelivery && deliveryAddress) {
          initialText += `.\n\nI'm hoping for delivery to ${deliveryAddress} — let me know if that works and we can figure out the timing and details!`;
        } else if (wantsDelivery) {
          initialText += `. I'd love delivery if possible — let me know and we can work out the details!`;
        } else {
          initialText += `. Let me know if you have any questions!`;
        }
      }
      sendItemMessage(item.ownerId, item.owner || "Owner", item.ownerAvatarUrl, item.title, dateStr, initialText);
    }
  };

  const handleAcceptRequest = async (req) => {
    // Warn if these dates overlap a booking that's already accepted or confirmed
    if (req.start) {
      const reqDates = getDatesInRange(req.start, req.end || req.start);
      const conflict = bookingRequests.some(r =>
        r.id !== req.id && r.item?.title === req.item?.title &&
        (r.status === 'accepted' || r.status === 'confirmed') && r.start &&
        getDatesInRange(r.start, r.end || r.start).some(d => reqDates.includes(d))
      );
      if (conflict && !window.confirm("You've already accepted another transaction that overlaps these dates. Accept this one anyway?")) return;
    }
    const isServiceReq = req.item?.listingType === "service";
    const quotedCents = isServiceReq && req.quotedAmount ? Math.round(req.quotedAmount * 100) : null;
    if (req.dbId) {
      const update = { status: 'accepted', payment_status: 'delivery_confirmed', wants_delivery: !!req.wantsDelivery };
      if (quotedCents != null) update.quoted_cents = quotedCents;
      const { error } = await supabase.from('booking_requests').update(update).eq('id', req.dbId);
      if (error) { showToast('Failed to accept request', 'error'); return; }
    }
    setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:"accepted", payment_status:"delivery_confirmed", wantsDelivery: !!req.wantsDelivery, ...(quotedCents != null ? { quotedCents } : {})} : r));
    setRequestSent(r => ({...r, [req.item.id]: "accepted"}));

    // Sold items come off the market once the sale is agreed
    if (req.dateStr === "Purchase" && typeof req.item?.id === 'number') {
      supabase.from('listings').update({ available: false }).eq('id', req.item.id).then(({ error }) => { if (error) console.error('[Sold] pause failed:', error.message); });
      setMyListings(prev => prev.map(l => l.id === req.item.id ? { ...l, available: false } : l));
    }

    // Block the booked dates on the listing calendar — must happen owner-side,
    // since only the listing owner can write to the listing (RLS)
    if (req.start && typeof req.item?.id === 'number') {
      const newDates = getDatesInRange(req.start, req.end || req.start);
      supabase.from('listings').select('booked').eq('id', req.item.id).single().then(({ data }) => {
        const merged = [...new Set([...(data?.booked || []), ...newDates])];
        supabase.from('listings').update({ booked: merged }).eq('id', req.item.id).then(({ error }) => { if (error) console.error('[Accept] block dates failed:', error.message); });
        setMyListings(prev => prev.map(l => l.id === req.item.id ? { ...l, booked: merged } : l));
        setBookedOverrides(prev => ({ ...prev, [req.item.id]: merged }));
      });
    }

    let autoText;
    if (isServiceReq) {
      const priceStr = quotedCents != null ? `$${(quotedCents/100).toFixed(2)}` : `$${req.item?.price}`;
      autoText = `Quoted ${priceStr} for "${req.item?.title}"${req.dateStr && req.dateStr !== "Service" ? ` on ${req.dateStr}` : ""}. Go ahead and complete payment to lock it in!`;
    } else if (req.dateStr === "Purchase") {
      autoText = `Sale confirmed! Let's arrange payment and handoff.`;
    } else if (req.wantsDelivery) {
      const feeStr = req.deliveryFee ? ` (delivery fee: $${req.deliveryFee})` : "";
      autoText = `Approved! Delivery is all arranged${feeStr} — go ahead and complete payment and we'll see you then!`;
    } else {
      autoText = `Approved! Let's arrange payment and handoff.`;
    }
    const firstMsg = { mine: true, text: autoText, time: "Just now", created_at: new Date().toISOString() };
    const ownerName = req.item.owner || "Owner";
    const ownerId = req.item.ownerId;
    const ownerAvatarUrl = req.item.ownerAvatarUrl || user?.user_metadata?.avatar_url || null;
    const ownerAvatar = ownerAvatarUrl || "👽";

    const existing = messages.find(m => m.item === req.item.title && (m.otherUserId === req.renterId || m.fromId === req.renterId));
    if (existing) {
      const updatedConvo = { ...existing, thread: [...(existing.thread || []), firstMsg], time: "Just now", unread: true };
      setMessages(prev => prev.map(m => m.id === existing.id ? updatedConvo : m));
      setActiveConvo(updatedConvo);
      if (existing.conversation_id) {
        supabase.from('messages').insert({
          conversation_id: existing.conversation_id,
          from_name: ownerName, from_avatar: ownerAvatarUrl,
          to_name: req.renterName || "Renter",
          listing_title: req.item.title,
          content: autoText, is_mine: false, read: false,
          from_user_id: user?.id || null,
          to_user_id: req.renterId || null,
        }).then(({ error }) => { if (error) console.error('[Accept] Save msg failed:', error.message); });
        if (req.renterId) broadcastMessage(req.renterId, { conversation_id: existing.conversation_id, listing_title: req.item.title, content: autoText, from_user_id: user?.id, from_name: ownerName, from_avatar: ownerAvatarUrl, created_at: new Date().toISOString() });
      }
    } else {
      const convId = `conv_${Date.now()}`;
      const nm = { id: Date.now(), conversation_id: convId, from: ownerName, fromId: ownerId, otherUserId: req.renterId || null, avatarUrl: ownerAvatarUrl, item: req.item.title, sub: req.dateStr, time: "Just now", unread: true, thread: [firstMsg] };
      setMessages(prev => [...prev, nm]);
      setActiveConvo(nm);
      supabase.from('messages').insert({
        conversation_id: convId,
        from_name: ownerName, from_avatar: ownerAvatarUrl,
        to_name: user?.user_metadata?.name || "You",
        listing_title: req.item.title,
        content: autoText, is_mine: false, read: false,
        from_user_id: user?.id || null,
        to_user_id: req.renterId || null,
      }).then(({ error }) => { if (error) console.error('[Accept] Save msg failed:', error.message); });
      if (req.renterId) broadcastMessage(req.renterId, { conversation_id: convId, listing_title: req.item.title, content: autoText, from_user_id: user?.id, from_name: ownerName, from_avatar: ownerAvatarUrl, created_at: new Date().toISOString() });
    }
    // Push + email to renter
    if (req.renterId && req.renterId !== user?.id) {
      sendPushToUser(req.renterId, {
        title: 'Request accepted!',
        body: `Your request for ${req.item.title}${reqWhen(req.dateStr)} has been accepted`,
        url: '/?tab=messages',
        tag: `booking-accepted-${req.id}`,
      });
      sendEmail(req.renterId, `Request accepted — ${req.item.title}`,
        `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">✅ Your request was accepted!</h2>
         <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px">Your request for <strong>${req.item.title}</strong> has been accepted. Head to your messages to finish up.</p>
         ${reqWhen(req.dateStr) ? `<p style="margin:0 0 20px;color:#65676B;font-size:14px">Dates: ${req.dateStr}</p>` : ''}
         ${emailBtn('Message the Owner')}`
      );
    }
    addNotification({ icon:"✅", text:"Accepted: "+req.item.title, sub:"You confirmed "+req.renterName+"'s request"+reqWhen(req.dateStr, ' · '), time:"Just now", type:"confirm" });
    // Renter's bell entry is derived from the booking status — no insert needed
    setTab("messages");
  };

  const handleAcceptOffer = async (offerAmount) => {
    // Works for both sides: seller accepting buyer's offer, or buyer accepting seller's counter
    if (!activeConvo || !offerAmount) return;
    const newDateStr = `Offer:${offerAmount}`;
    // Reuse ANY live offer record for this conversation (pending or a prior
    // counter/accept) so re-accepting never creates duplicates.
    let req = bookingRequests?.find(r =>
      (r.dateStr === "Offer" || r.dateStr?.startsWith("Offer:")) &&
      r.status !== "declined" && r.status !== "cancelled" &&
      r.item?.title === activeConvo?.item &&
      (r.ownerId === user?.id || r.renterId === user?.id) &&
      (r.ownerId === activeConvo?.otherUserId || r.renterId === activeConvo?.otherUserId)
    );
    // Resolve listing + parties from the existing record first (works even if the
    // listing was paused and dropped from the public list), else the public listing.
    const listing = req?.item || allItems?.find(l => l.title === activeConvo?.item);
    if (!listing) { showToast('Could not find this listing', 'error'); return; }
    const ownerId = req?.ownerId || listing.ownerId;
    const renterId = req?.renterId || ((user?.id === ownerId) ? activeConvo?.otherUserId : user?.id);
    const renterName = req?.renterName || ((renterId === user?.id) ? (user?.user_metadata?.name || 'Buyer') : (activeConvo?.from || 'Buyer'));
    if (!ownerId || !renterId) { showToast('Failed to accept offer', 'error'); return; }
    if (req?.dbId) {
      const { error } = await supabase.from('booking_requests').update({ status: 'accepted', payment_status: 'delivery_confirmed', date_str: newDateStr }).eq('id', req.dbId);
      if (error) { showToast('Failed to accept offer', 'error'); return; }
      setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'accepted', payment_status: 'delivery_confirmed', dateStr: newDateStr } : r));
      req = { ...req, status: 'accepted', payment_status: 'delivery_confirmed', dateStr: newDateStr };
    } else {
      const { data, error } = await supabase.from('booking_requests').insert({
        renter_id: renterId, owner_id: ownerId, item_title: listing.title, item_json: listing,
        date_str: newDateStr, start_date: null, end_date: null,
        status: 'accepted', payment_status: 'delivery_confirmed', renter_name: renterName,
      }).select('id').single();
      if (error || !data) { console.error('[AcceptOffer] create failed:', error?.message); showToast('Failed to accept offer', 'error'); return; }
      req = { id: data.id, dbId: data.id, item: listing, dateStr: newDateStr, status: 'accepted', payment_status: 'delivery_confirmed', renterId, ownerId, renterName };
      setBookingRequests(prev => [...prev, req]);
    }
    const isOwner = req.ownerId === user?.id;
    // Seller accepting an offer takes the item off the market
    if (isOwner && typeof req.item?.id === 'number') {
      supabase.from('listings').update({ available: false }).eq('id', req.item.id).then(({ error }) => { if (error) console.error('[Sold] pause failed:', error.message); });
      setMyListings(prev => prev.map(l => l.id === req.item.id ? { ...l, available: false } : l));
    }
    const myName = user?.user_metadata?.name || (isOwner ? 'The owner' : 'Buyer');
    const otherId = isOwner ? req.renterId : req.ownerId;
    const convId = activeConvo?.conversation_id;
    const createdAt = new Date().toISOString();
    const acceptText = isOwner
      ? `Offer of $${offerAmount} accepted! Let's arrange payment and handoff.`
      : `Counter offer of $${offerAmount} accepted! I'll complete payment now.`;
    const acceptMsgObj = { mine: true, text: acceptText, time: 'Just now', created_at: createdAt };
    setMessages(prev => prev.map(m => m.conversation_id === convId ? { ...m, thread: [...(m.thread || []), acceptMsgObj] } : m));
    setActiveConvo(prev => prev?.conversation_id === convId ? { ...prev, thread: [...(prev.thread || []), acceptMsgObj] } : prev);
    if (convId && otherId) {
      supabase.from('messages').insert({ conversation_id: convId, from_name: myName, from_avatar: profilePhotoUrl || null, to_name: isOwner ? req.renterName : (req.item?.owner || 'Seller'), listing_title: req.item?.title, content: acceptText, read: false, from_user_id: user?.id, to_user_id: otherId }).then(({ error }) => { if (error) console.error('[AcceptOffer] msg failed:', error.message); });
      broadcastMessage(otherId, { conversation_id: convId, listing_title: req.item?.title, content: acceptText, from_user_id: user?.id, from_name: myName, from_avatar: profilePhotoUrl || null, created_at: createdAt });
    }
    if (otherId) {
      // Buyer's bell entry is derived from booking status; the seller (no derived entry for accepted) still gets a stored one
      if (!isOwner) supabase.from('notifications').insert({ user_id: otherId, icon: '✅', text: `Offer accepted: ${req.item?.title}`, sub: `$${offerAmount} agreed — buyer completing payment`, time_label: 'Just now', unread: true, type: 'confirm' }).then(({ error }) => { if (error) console.error('[AcceptOffer] notif failed:', error.message); });
      sendPushToUser(otherId, { title: 'Offer accepted!', body: `$${offerAmount} offer on ${req.item?.title} was accepted`, url: '/?tab=messages', tag: `offer-accepted-${req.dbId || req.id}` });
    }
    // Seller accepting records its own entry; a buyer accepting a counter already
    // gets the derived "Accepted" item — don't add a second one
    if (isOwner) addNotification({ icon: '✅', text: `Offer accepted: ${req.item?.title}`, sub: `$${offerAmount}`, time: 'Just now', type: 'confirm' });
  };

  const handleDeclineOffer = async () => {
    // Mirror handleAcceptOffer's request lookup — works for either side of a negotiation.
    const req = bookingRequests?.find(r =>
      r.dateStr === "Offer" && r.status === "pending" &&
      r.item?.title === activeConvo?.item &&
      (r.ownerId === user?.id || r.renterId === user?.id) &&
      (r.ownerId === activeConvo?.otherUserId || r.renterId === activeConvo?.otherUserId)
    );
    const isOwner = req ? req.ownerId === user?.id : true;
    const otherId = req ? (isOwner ? req.renterId : req.ownerId) : activeConvo?.otherUserId;
    if (req?.dbId) {
      const { error } = await supabase.from('booking_requests').update({ status: 'declined' }).eq('id', req.dbId);
      if (error) { showToast('Failed to decline offer', 'error'); return; }
      setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'declined' } : r));
    }
    const myName = user?.user_metadata?.name || 'Someone';
    const itemTitle = activeConvo?.item || req?.item?.title || 'this item';
    const convId = activeConvo?.conversation_id;
    const createdAt = new Date().toISOString();
    const declineText = `I'll have to pass on the offer for "${itemTitle}". Thanks anyway!`;
    const declineMsgObj = { mine: true, text: declineText, time: 'Just now', created_at: createdAt };
    setMessages(prev => prev.map(m => m.conversation_id === convId ? { ...m, thread: [...(m.thread || []), declineMsgObj] } : m));
    setActiveConvo(prev => prev?.conversation_id === convId ? { ...prev, thread: [...(prev.thread || []), declineMsgObj] } : prev);
    if (convId && otherId) {
      supabase.from('messages').insert({ conversation_id: convId, from_name: myName, from_avatar: profilePhotoUrl || null, to_name: activeConvo?.from, listing_title: itemTitle, content: declineText, read: false, from_user_id: user?.id, to_user_id: otherId }).then(({ error }) => { if (error) console.error('[DeclineOffer] msg failed:', error.message); });
      broadcastMessage(otherId, { conversation_id: convId, listing_title: itemTitle, content: declineText, from_user_id: user?.id, from_name: myName, from_avatar: profilePhotoUrl || null, created_at: createdAt });
      sendPushToUser(otherId, { title: 'Offer declined', body: `Your offer on ${itemTitle} was declined`, url: '/?tab=messages', tag: `offer-declined-${req?.dbId || Date.now()}` });
    }
    showToast('Offer declined');
  };

  const handleDirectBookingRequest = async (item, start, end, wantsDelivery = false) => {
    if (!user || !item?.ownerId || item.ownerId === 'me') return;
    const dateStr = formatDate(start) + (end && end !== start ? " - " + formatDate(end) : "");
    const req = { id: Date.now(), item, start, end, dateStr, wantsDelivery, deliveryAddress: null, deliveryFee: wantsDelivery ? (item.deliveryFee || null) : null, renterName: user?.user_metadata?.name || "You", renterId: user?.id, status: "pending", time: "Just now" };
    setBookingRequests(prev => [...prev, req]);
    setRequestSent(r => ({...r, [item.id]: "pending"}));
    showToast("Request sent! Check your messages.");
    addNotification({ icon:"⏳", text:"Request sent: "+item.title, sub:"Waiting for owner approval · "+dateStr, time:"Just now", type:"request" });
    setTab("messages");

    const { data, error: insertErr } = await supabase.from('booking_requests').insert({
      renter_id: user.id, owner_id: item.ownerId, item_title: item.title, item_json: item,
      date_str: dateStr, start_date: start || null, end_date: end || null,
      wants_delivery: wantsDelivery, delivery_fee: wantsDelivery ? (item.deliveryFee || null) : null,
      renter_name: user?.user_metadata?.name || "You", status: 'pending',
    }).select('id').single();
    if (insertErr) { console.error('[BookingRequest] insert error:', insertErr.message); return; }
    if (data) setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, dbId: data.id } : r));

    const renterName = user?.user_metadata?.name || 'Someone';
    const initialText = wantsDelivery
      ? `Hi! I'd like to rent "${item.title}" for ${dateStr}. I'm hoping for delivery — let me know if that works and we can sort out the details!`
      : `Hi! I'd like to rent "${item.title}" for ${dateStr}. When and where works for pickup?`;
    sendItemMessage(item.ownerId, item.owner || "Owner", item.ownerAvatarUrl, item.title, dateStr, initialText);

    sendPushToUser(item.ownerId, { title: 'New rental request', body: `${renterName} wants to rent ${item.title}`, url: '/?tab=messages', tag: `booking-req-${data?.id || req.id}` });
    sendEmail(item.ownerId, `New rental request — ${item.title}`,
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">📬 New rental request</h2>
       <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px"><strong>${renterName}</strong> wants to rent <strong>${item.title}</strong>.</p>
       <p style="margin:0 0 20px;color:#65676B;font-size:14px">Dates: ${dateStr || 'To be arranged'}</p>
       ${emailBtn('Accept or Decline')}`
    );
  };

  const handleBuyRequest = async (item) => {
    if (!requireAuth()) return;
    if (!item?.ownerId || item.ownerId === 'me') return;
    const salePrice = item.salePrice || item.price;
    const req = { id: Date.now(), item, start: null, end: null, dateStr: "Purchase", wantsDelivery: false, renterName: user?.user_metadata?.name || "You", renterId: user?.id, status: "pending", time: "Just now" };
    setBookingRequests(prev => [...prev, req]);
    setRequestSent(r => ({...r, [item.id]: "pending"}));
    showToast("Purchase request sent! Check your messages.");
    addNotification({ icon:"🛒", text:"Purchase request sent: "+item.title, sub:"Waiting for seller to confirm", time:"Just now", type:"request" });
    setTab("messages");

    const { data, error: insertErr } = await supabase.from('booking_requests').insert({
      renter_id: user.id, owner_id: item.ownerId, item_title: item.title, item_json: item,
      date_str: "Purchase", start_date: null, end_date: null,
      wants_delivery: false, delivery_fee: null,
      renter_name: user?.user_metadata?.name || "You", status: "pending",
    }).select('id').single();
    if (insertErr) { console.error('[BuyRequest] insert error:', insertErr.message); return; }
    if (data) setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, dbId: data.id } : r));

    const buyerName = user?.user_metadata?.name || 'Someone';
    const initialText = `Hi! I'd like to buy your "${item.title}" for $${salePrice}. Is it still available?`;
    sendItemMessage(item.ownerId, item.owner || "Owner", item.ownerAvatarUrl, item.title, "Purchase", initialText);
    sendPushToUser(item.ownerId, { title: 'New purchase request', body: `${buyerName} wants to buy ${item.title}`, url: '/?tab=messages', tag: `buy-req-${data?.id || req.id}` });
    sendEmail(item.ownerId, `New purchase request — ${item.title}`,
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">🛒 New purchase request</h2>
       <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px"><strong>${buyerName}</strong> wants to buy <strong>${item.title}</strong> for <strong>$${salePrice}</strong>.</p>
       ${emailBtn('Accept or Decline')}`
    );
  };

  const handleServiceRequest = async (item, start = null, end = null) => {
    if (!requireAuth()) return;
    if (!item?.ownerId || item.ownerId === 'me') return;
    const unit = SERVICE_UNIT_LABEL[item.priceUnit] || item.priceUnit || 'hr';
    const dateStr = start ? (end && end !== start ? `${formatDate(start)} – ${formatDate(end)}` : formatDate(start)) : "Service";
    const reqId = Date.now();
    const req = { id: reqId, item, start: start || null, end: end || null, dateStr, wantsDelivery: false, renterName: user?.user_metadata?.name || "You", renterId: user?.id, ownerId: item.ownerId, status: "pending", time: "Just now" };
    setBookingRequests(prev => [...prev, req]);
    setRequestSent(r => ({...r, [item.id]: "pending"}));
    showToast("Service request sent! Check your messages.");
    addNotification({ icon:"🧰", text:"Service request sent: "+item.title, sub:"Waiting for provider to confirm", time:"Just now", type:"request" });
    setTab("messages");

    const { data, error: insertErr } = await supabase.from('booking_requests').insert({
      renter_id: user.id, owner_id: item.ownerId, item_title: item.title, item_json: item,
      date_str: dateStr, start_date: start || null, end_date: end || null,
      wants_delivery: false, delivery_fee: null,
      renter_name: user?.user_metadata?.name || "You", status: "pending",
    }).select('id').single();
    if (insertErr) { console.error('[ServiceRequest] insert error:', insertErr.message); return; }
    if (data) setBookingRequests(prev => prev.map(r => r.id === reqId ? { ...r, dbId: data.id } : r));

    const requesterName = user?.user_metadata?.name || 'Someone';
    const whenText = start ? ` for ${dateStr}` : '';
    const initialText = `Hi! I'd like to book your "${item.title}" service ($${item.price}/${unit})${whenText}. Are you available?`;
    sendItemMessage(item.ownerId, item.owner || "Provider", item.ownerAvatarUrl, item.title, "Service", initialText);
    sendPushToUser(item.ownerId, { title: 'New service request', body: `${requesterName} wants to book ${item.title}${whenText}`, url: '/?tab=messages', tag: `svc-req-${data?.id || reqId}` });
    sendEmail(item.ownerId, `New service request — ${item.title}`,
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">🧰 New service request</h2>
       <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px"><strong>${requesterName}</strong> wants to book your <strong>${item.title}</strong> service ($${item.price}/${unit})${whenText}.</p>
       ${emailBtn('Accept or Decline')}`
    );
  };

  const handleMakeOfferRequest = async (item, offerAmount) => {
    if (!requireAuth()) return;
    if (!item?.ownerId || item.ownerId === 'me') return;

    // Build everything synchronously so the chat opens immediately
    const buyerName = user?.user_metadata?.name || 'Someone';
    const offerText = `💸 Offer: $${offerAmount}`;
    const reqId = Date.now();
    const req = { id: reqId, item, start: null, end: null, dateStr: "Offer", wantsDelivery: false, renterName: buyerName, renterId: user?.id, ownerId: item.ownerId, status: "pending", time: "Just now" };

    setBookingRequests(prev => [...prev, req]);
    setRequestSent(r => ({...r, [item.id]: "pending"}));
    sendItemMessage(item.ownerId, item.owner || "Owner", item.ownerAvatarUrl, item.title, "Offer", offerText);
    showToast("Offer sent!");
    setTab("messages");

    // Persist async
    const { data } = await supabase.from('booking_requests').insert({
      renter_id: user.id, owner_id: item.ownerId, item_title: item.title, item_json: item,
      date_str: "Offer", start_date: null, end_date: null,
      wants_delivery: false, delivery_fee: null,
      renter_name: buyerName, status: "pending",
    }).select('id').single();
    if (data) setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, dbId: data.id } : r));

    sendPushToUser(item.ownerId, { title: `New offer: $${offerAmount}`, body: `${buyerName} offered $${offerAmount} for ${item.title}`, url: '/?tab=messages', tag: `offer-req-${data?.id || req.id}` });
    sendEmail(item.ownerId, `New offer — ${item.title}`,
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">💸 New offer received</h2>
       <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px"><strong>${buyerName}</strong> offered <strong>$${offerAmount}</strong> for <strong>${item.title}</strong>.</p>
       ${emailBtn('Accept or Counter')}`
    );
  };

  const handleChatCheckout = (req) => {
    setActiveConvo(null);
    setWantsDelivery(!!req.wantsDelivery);
    setDeliveryAddress(req.deliveryAddress || "");
    setDeliveryCheck(req.wantsDelivery ? "within" : null);
    const isOffer = req.dateStr?.startsWith("Offer:");
    const isService = req.item?.listingType === "service";
    const offerPrice = isOffer
      ? parseInt(req.dateStr.split(":")[1])
      : (isService && req.quotedCents != null ? req.quotedCents / 100 : null);
    // Services charge a flat agreed amount — treat like a purchase so the
    // breakdown never multiplies by nights.
    setPaymentModal({ item: req.item, start: req.start, end: req.end, purchase: req.dateStr === "Purchase" || isOffer || isService, offerPrice, existingBookingId: req.dbId });
    setPaymentStep(1);
  };

  const handleDeclineRequest = async (req) => {
    if (req.dbId) {
      const { error } = await supabase.from('booking_requests').update({ status: 'declined' }).eq('id', req.dbId);
      if (error) { showToast('Failed to decline request', 'error'); return; }
    }
    setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:"declined"} : r));
    setRequestSent(r => ({...r, [req.item.id]: "declined"}));
    const ownerName = user?.user_metadata?.name || 'The owner';
    const ownerAvatarUrl = profilePhotoUrl || user?.user_metadata?.avatar_url || null;
    if (req.renterId && req.renterId !== user?.id) {
      sendPushToUser(req.renterId, {
        title: 'Request declined',
        body: `Your request for ${req.item.title}${reqWhen(req.dateStr)} was declined`,
        url: '/?tab=messages',
        tag: `booking-declined-${req.id}`,
      });
      sendEmail(req.renterId, `Request declined — ${req.item.title}`,
        `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">❌ Request declined</h2>
         <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px">Unfortunately your request for <strong>${req.item.title}</strong>${reqWhen(req.dateStr) ? ` on <strong>${req.dateStr}</strong>` : ''} was declined.</p>
         <p style="margin:0 0 20px;color:#65676B;font-size:14px">${reqWhen(req.dateStr) ? 'The owner may be unavailable for those dates. Try different dates or browse similar items.' : 'Browse similar items on Lendie.'}</p>
         ${emailBtn('Browse Lendie')}`
      );
      // Renter's bell entry is derived from the booking status — no insert needed
      // Always send a decline message in chat — find existing convo or create one
      const isOfferReq = req.dateStr === 'Offer' || req.dateStr?.startsWith('Offer');
      const declineText = req.dateStr === 'Purchase'
        ? `Unfortunately I'm unable to accept your purchase request for "${req.item.title}". Sorry about that!`
        : isOfferReq
        ? `Unfortunately I can't accept your offer for "${req.item.title}". Sorry about that!`
        : req.item?.listingType === 'service'
        ? `Unfortunately I'm unable to take your service request for "${req.item.title}"${reqWhen(req.dateStr)}. Sorry about that!`
        : `Unfortunately I'm unable to accept your rental request for "${req.item.title}"${reqWhen(req.dateStr)}. The dates may already be taken — feel free to try different dates!`;
      const convo = messages.find(m => (m.otherUserId === req.renterId || m.fromId === req.renterId) && m.item === req.item.title);
      const convId = convo?.conversation_id || `conv_req_${req.dbId || req.id}`;
      const createdAt = new Date().toISOString();
      supabase.from('messages').insert({
        conversation_id: convId,
        from_name: ownerName, from_avatar: ownerAvatarUrl,
        to_name: req.renterName,
        listing_title: req.item.title,
        content: declineText,
        read: false,
        from_user_id: user?.id,
        to_user_id: req.renterId,
      }).then(({ error }) => { if (error) console.error('[Decline] msg failed:', error.message); });
      broadcastMessage(req.renterId, { conversation_id: convId, listing_title: req.item?.title, content: declineText, from_user_id: user?.id, from_name: ownerName, from_avatar: ownerAvatarUrl, created_at: createdAt });
      const declineMsgObj = { mine: true, text: declineText, time: 'Just now', created_at: createdAt };
      if (convo) {
        setMessages(prev => prev.map(m => m.id === convo.id ? { ...m, thread: [...(m.thread || []), declineMsgObj] } : m));
        setActiveConvo(prev => prev?.conversation_id === convId ? { ...prev, thread: [...(prev.thread || []), declineMsgObj] } : prev);
      } else {
        const nm = { id: Date.now(), conversation_id: convId, from: req.renterName || 'Renter', fromId: req.renterId, otherUserId: req.renterId, item: req.item.title, time: createdAt, unread: false, thread: [declineMsgObj] };
        setMessages(prev => [...prev, nm]);
      }
    }
    addNotification({ icon:"❌", text:"Declined: "+req.item.title, sub:"You declined "+req.renterName+"'s request", time:"Just now", type:"declined" });
    showToast("Request declined.");
  };

  const daysUntilStart = (req) => {
    if (!req.start) return Infinity;
    const start = new Date(req.start);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((start - today) / (1000 * 60 * 60 * 24));
  };

  const handleCancelRequest = async (req) => {
    if (isPastTransaction(req)) { showToast("This transaction has ended and can no longer be cancelled.", 'error'); return; }
    if (req.dbId) {
      const { error } = await supabase.from('booking_requests').update({ status: 'cancelled', cancelled_by: user?.id, cancellation_reason: 'renter_cancelled' }).eq('id', req.dbId);
      if (error) { showToast('Failed to cancel transaction', 'error'); return; }
    }
    setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:"cancelled"} : r));
    setRequestSent(r => { const next = {...r}; delete next[req.item.id]; return next; });
    // Free the dates locally for instant feedback — the DB trigger
    // (free_booked_dates_on_cancel) does the authoritative server-side release,
    // since renters can't UPDATE listings under RLS.
    if (req.start && req.item?.id != null) {
      const freed = getDatesInRange(req.start, req.end || req.start);
      setBookedOverrides(prev => {
        const cur = prev[req.item.id];
        if (!cur) return prev;
        return { ...prev, [req.item.id]: cur.filter(d => !freed.includes(d)) };
      });
      setSelectedItem(prev => prev?.id === req.item.id ? { ...prev, booked: (prev.booked || []).filter(d => !freed.includes(d)) } : prev);
    }
    const renterName = req.renterName || user?.user_metadata?.name || 'The renter';
    const renterAvatarUrl = profilePhotoUrl || user?.user_metadata?.avatar_url || null;
    if (req.item.ownerId && req.item.ownerId !== 'me') {
      sendPushToUser(req.item.ownerId, {
        title: 'Transaction cancelled',
        body: `${renterName} cancelled their request for ${req.item.title}`,
        url: '/?tab=messages',
        tag: `booking-cancelled-${req.id}`,
      });
      sendEmail(req.item.ownerId, `Transaction cancelled — ${req.item.title}`,
        `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">📋 Transaction cancelled</h2>
         <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px"><strong>${renterName}</strong> has cancelled their request for <strong>${req.item.title}</strong>.</p>
         <p style="margin:0 0 20px;color:#65676B;font-size:14px">${reqWhen(req.dateStr) ? `Dates: ${req.dateStr} — your` : 'Your'} item is now available again.</p>
         ${emailBtn('View My Listings')}`
      );
      supabase.from('notifications').insert({
        user_id: req.item.ownerId,
        icon: '❌',
        text: `Transaction cancelled: ${req.item.title}`,
        sub: `${renterName} cancelled their request${reqWhen(req.dateStr, ' for ')}`,
        time_label: 'Just now',
        unread: true,
        type: 'cancel',
      }).then(({ error }) => { if (error) console.error('[Cancel] notif failed:', error.message); });
      // Always send a cancel message in chat — find existing convo or create one
      const cancelText = `I've had to cancel my ${txNoun(req)} request for "${req.item.title}"${reqWhen(req.dateStr)}. Sorry for any inconvenience!`;
      const convo = messages.find(m => (m.otherUserId === req.item.ownerId || m.fromId === req.item.ownerId) && m.item === req.item.title);
      const convId = convo?.conversation_id || `conv_req_${req.dbId || req.id}`;
      const createdAt = new Date().toISOString();
      supabase.from('messages').insert({
        conversation_id: convId,
        from_name: renterName, from_avatar: renterAvatarUrl,
        to_name: req.item.owner,
        listing_title: req.item.title,
        content: cancelText,
        read: false,
        from_user_id: user?.id,
        to_user_id: req.item.ownerId,
      }).then(({ error }) => { if (error) console.error('[Cancel] msg failed:', error.message); });
      broadcastMessage(req.item.ownerId, { conversation_id: convId, listing_title: req.item?.title, content: cancelText, from_user_id: user?.id, from_name: renterName, from_avatar: renterAvatarUrl, created_at: createdAt });
      const cancelMsgObj = { mine: true, text: cancelText, time: 'Just now', created_at: createdAt };
      if (convo) {
        setMessages(prev => prev.map(m => m.id === convo.id ? { ...m, thread: [...(m.thread || []), cancelMsgObj] } : m));
        setActiveConvo(prev => prev?.conversation_id === convId ? { ...prev, thread: [...(prev.thread || []), cancelMsgObj] } : prev);
      } else {
        const nm = { id: Date.now(), conversation_id: convId, from: req.item.owner || 'Owner', fromId: req.item.ownerId, otherUserId: req.item.ownerId, item: req.item.title, time: createdAt, unread: false, thread: [cancelMsgObj] };
        setMessages(prev => [...prev, nm]);
      }
    }
    addNotification({ icon:"❌", text:"Cancelled: "+req.item.title, sub:"You cancelled your request · "+(req.dateStr||''), time:"Just now", type:"cancel" });
    showToast("Transaction cancelled.");
  };

  const handleOwnerCancelBooking = async (req) => {
    if (isPastTransaction(req)) { showToast("This transaction has ended and can no longer be cancelled or refunded.", 'error'); return; }
    const isPaid = req.payment_status === 'paid';
    if (isPaid && req.dbId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      showToast("Processing refund…");
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/create-refund`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: req.dbId }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'cancelled', payment_status: 'refunded' } : r));
      } catch (e) {
        showToast(e.message || 'Refund failed', 'error');
        return;
      }
    } else {
      if (req.dbId) {
        const { error } = await supabase.from('booking_requests').update({ status: 'cancelled', cancelled_by: user?.id, cancellation_reason: 'owner_cancelled' }).eq('id', req.dbId);
        if (error) { showToast('Failed to cancel transaction', 'error'); return; }
      }
      setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:"cancelled"} : r));
    }
    // Free up the dates this booking held
    if (req.start && typeof req.item?.id === 'number') {
      const cancelDates = getDatesInRange(req.start, req.end || req.start);
      supabase.from('listings').select('booked').eq('id', req.item.id).single().then(({ data }) => {
        const remaining = (data?.booked || []).filter(d => !cancelDates.includes(d));
        supabase.from('listings').update({ booked: remaining }).eq('id', req.item.id).then(({ error }) => { if (error) console.error('[OwnerCancel] unblock failed:', error.message); });
        setMyListings(prev => prev.map(l => l.id === req.item.id ? { ...l, booked: remaining } : l));
        setBookedOverrides(prev => ({ ...prev, [req.item.id]: remaining }));
      });
    }
    const itemTitle = req.item?.title || 'your item';
    const ownerName = user?.user_metadata?.name || 'The owner';
    if (req.renterId) {
      // In-app notification
      supabase.from('notifications').insert({
        user_id: req.renterId,
        icon: '❌',
        text: `Transaction cancelled: ${itemTitle}`,
        sub: `${ownerName} cancelled your ${txNoun(req)}${reqWhen(req.dateStr, ' for ')}`,
        time_label: 'Just now',
        unread: true,
        type: 'cancel',
      }).then(({ error }) => { if (error) console.error('[OwnerCancel] notif failed:', error.message); });
      // Always send a chat message — find existing convo or create one
      const cancelMsg = `Sorry, I've had to cancel your ${txNoun(req)} for "${itemTitle}"${reqWhen(req.dateStr, ' (')}${reqWhen(req.dateStr) ? ')' : ''}. Please reach out if you have any questions.`;
      const ownerAvatarUrl = profilePhotoUrl || user?.user_metadata?.avatar_url || null;
      const convo = messages.find(m => (m.otherUserId === req.renterId || m.fromId === req.renterId) && m.item === itemTitle);
      const convId = convo?.conversation_id || `conv_req_${req.dbId || req.id}`;
      const createdAt = new Date().toISOString();
      supabase.from('messages').insert({
        conversation_id: convId,
        from_name: ownerName, from_avatar: ownerAvatarUrl,
        to_name: req.renterName,
        listing_title: itemTitle,
        content: cancelMsg,
        read: false,
        from_user_id: user?.id,
        to_user_id: req.renterId,
      }).then(({ error }) => { if (error) console.error('[OwnerCancel] msg failed:', error.message); });
      broadcastMessage(req.renterId, { conversation_id: convId, listing_title: req.item?.title, content: cancelMsg, from_user_id: user?.id, from_name: ownerName, from_avatar: ownerAvatarUrl, created_at: createdAt });
      const cancelMsgObj = { mine: true, text: cancelMsg, time: 'Just now', created_at: createdAt };
      if (convo) {
        setMessages(prev => prev.map(m => m.id === convo.id ? { ...m, thread: [...(m.thread || []), cancelMsgObj] } : m));
        setActiveConvo(prev => prev?.conversation_id === convId ? { ...prev, thread: [...(prev.thread || []), cancelMsgObj] } : prev);
      } else {
        const nm = { id: Date.now(), conversation_id: convId, from: req.renterName || 'Renter', fromId: req.renterId, otherUserId: req.renterId, item: itemTitle, time: createdAt, unread: false, thread: [cancelMsgObj] };
        setMessages(prev => [...prev, nm]);
      }
      addNotification({ icon:"❌", text:"Cancelled: "+itemTitle, sub:"You cancelled "+req.renterName+"'s transaction"+(isPaid?" — refund issued":"")+reqWhen(req.dateStr, ' · '), time:"Just now", type:"cancel" });
      sendPushToUser(req.renterId, {
        title: 'Transaction cancelled',
        body: isPaid ? `${ownerName} cancelled your transaction for ${itemTitle} — a refund has been issued` : `${ownerName} cancelled the transaction for ${itemTitle}`,
        url: '/?tab=messages',
        tag: `owner-cancelled-${req.id}`,
      });
      sendEmail(req.renterId, `Transaction cancelled — ${itemTitle}`,
        `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">📋 Transaction cancelled</h2>
         <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px">Unfortunately <strong>${ownerName}</strong> has cancelled your ${txNoun(req)} for <strong>${itemTitle}</strong>.</p>
         ${isPaid ? `<p style="margin:0 0 6px;color:#00B894;font-size:15px;font-weight:600">↩️ A full refund has been issued to your original payment method.</p>` : ''}
         ${reqWhen(req.dateStr) ? `<p style="margin:0 0 20px;color:#65676B;font-size:14px">Dates: ${req.dateStr}</p>` : ''}
         ${emailBtn('Browse Listings')}`
      );
    }
    showToast(isPaid ? "Transaction cancelled — refund issued to renter." : "Transaction cancelled — they've been notified.");
  };

  const handleRefundRequest = async (req) => {
    if (!req.dbId) return;
    if (isPastTransaction(req)) { showToast("This transaction has ended and can no longer be refunded.", 'error'); return; }
    // Mirror the server's gentle refund policy so the renter sees the real
    // numbers before confirming: once a booking has been charged, a renter/buyer
    // cancel refunds everything except the 8% service fee. (Cancellations before
    // the card is charged are free and never reach this refund path.)
    const total = (req.stripe_amount_cents || 0) / 100;
    const fee = (req.renter_fee_cents || 0) / 100;
    const keepFee = fee > 0;
    const refundAmt = keepFee ? Math.max(0, total - fee) : total;
    const confirmMsg = keepFee
      ? `Cancel this ${txNoun(req)}? The 8% service fee ($${fee.toFixed(2)}) is non-refundable — you'll be refunded $${refundAmt.toFixed(2)} of $${total.toFixed(2)}.`
      : `Cancel this ${txNoun(req)}? You'll be refunded in full ($${total.toFixed(2)}).`;
    if (!window.confirm(confirmMsg)) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    showToast("Processing refund…");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: req.dbId }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setBookingRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'cancelled', payment_status: 'refunded' } : r));
      setRequestSent(r => { const next = {...r}; delete next[req.item?.id]; return next; });
      const refundedAmt = ((json.refundedCents ?? 0) / 100).toFixed(2);
      const feeKept = (json.feeKeptCents ?? 0) > 0;
      showToast(`Transaction cancelled — $${refundedAmt} refunded to your card`);
      addNotification({ icon:"↩️", text:"Refund issued: "+req.item?.title, sub:`$${refundedAmt} credited within 5-10 business days${feeKept ? ' (service fee non-refundable)' : ''}`, time:"Just now", type:"payment" });
    } catch (e) {
      showToast(e.message || 'Refund failed', 'error');
    }
  };

  const setupStripeConnect = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    showToast('Opening Stripe setup…');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-connect-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      const { url, error } = await res.json();
      if (error) { showToast(error, 'error'); return; }
      window.location.href = url;
    } catch (e) {
      showToast(e.message || 'Could not open Stripe setup', 'error');
    }
  };

  const openStripeDashboard = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-stripe-dashboard-link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const { url, error } = await res.json();
      if (error) { showToast(error, 'error'); return; }
      window.open(url, '_blank');
    } catch (e) {
      showToast(e.message || 'Could not open dashboard', 'error');
    }
  };

  const handleSendMessage = (text, convo, imageUrl = null) => {
    if (!convo?.conversation_id) return;
    if (!text && !imageUrl) return;
    const msgCreatedAt = new Date().toISOString();
    const senderName = user?.user_metadata?.name || 'Someone';
    // Image-only messages get a placeholder body so conversation previews and
    // push notifications read sensibly ("📷 Photo").
    const body = text || (imageUrl ? '📷 Photo' : '');

    // Resolve recipient ID — same priority chain as handleDirectBookingRequest
    let toUserId = convo.otherUserId || null;
    if (!toUserId) {
      // Try booking requests matching this conversation's item
      const req = bookingRequests.find(r => r.item?.title === convo.item);
      if (req) toUserId = req.renterId === user?.id ? (req.ownerId || null) : (req.renterId || null);
    }
    if (!toUserId && convo.fromId && convo.fromId !== user?.id) {
      toUserId = convo.fromId; // last resort: fromId if it's not me
    }

    // Persist resolved ID so future sends in this conversation work too
    if (toUserId && !convo.otherUserId) {
      setActiveConvo(prev => prev?.conversation_id === convo.conversation_id ? { ...prev, otherUserId: toUserId } : prev);
      setMessages(prev => prev.map(m => m.conversation_id === convo.conversation_id ? { ...m, otherUserId: toUserId } : m));
    }

    supabase.from('messages').insert({
      conversation_id: convo.conversation_id,
      from_name: senderName,
      from_avatar: profilePhotoUrl || user?.user_metadata?.avatar_url || null,
      to_name: convo.from,
      listing_title: convo.item,
      content: body,
      image_url: imageUrl,
      is_mine: true,
      read: false,
      from_user_id: user?.id || null,
      to_user_id: toUserId,
    }).then(({ error }) => { if (error) console.error('[Chat] Save failed:', error.message); });

    if (toUserId) {
      broadcastMessage(toUserId, { conversation_id: convo.conversation_id, listing_title: convo.item, content: body, image_url: imageUrl, from_user_id: user?.id, from_name: senderName, from_avatar: profilePhotoUrl || user?.user_metadata?.avatar_url || null, created_at: msgCreatedAt });
      const preview = body.length > 80 ? body.slice(0, 77) + '…' : body;
      sendPushToUser(toUserId, { title: `New message from ${senderName}`, body: preview, url: '/?tab=messages', tag: `msg-${convo.conversation_id}` });
      const threadLen = convo.thread?.length || 0;
      if (threadLen <= 1) {
        sendEmail(toUserId, `New message from ${senderName} — ${convo.item}`,
          `<h2 style="margin:0 0 12px;font-size:20px;color:#1C1E21">💬 New message</h2>
           <p style="margin:0 0 6px;color:#3A3B3C;font-size:15px"><strong>${senderName}</strong> sent you a message about <strong>${convo.item}</strong>:</p>
           <blockquote style="margin:0 0 20px;padding:12px 16px;background:#f4f4f5;border-left:4px solid #00B894;border-radius:0 8px 8px 0;color:#3A3B3C;font-size:14px;font-style:italic">${preview}</blockquote>
           ${emailBtn('Reply in Lendie')}`
        );
      }
    }
  };

  const handleSubmitReview = async (booking, stars, comment) => {
    const reviewerName = user?.user_metadata?.name || booking.renterName || "Anonymous";
    // Link review to listing when it has a numeric DB id (not a seed/demo item)
    const listingId = typeof booking.item.id === 'number' ? booking.item.id : null;
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
      setSelectedItem(prev => {
        if (!prev || prev.id !== listingId) return prev;
        const newCount = (prev.reviews || 0) + 1;
        const newSum = (prev.rating || 0) * (prev.reviews || 0) + stars;
        return { ...prev, rating: Math.round(newSum / newCount * 10) / 10, reviews: newCount };
      });
    }
    setReviewedBookings(prev => {
      const next = { ...prev, [booking.id]: true };
      try { localStorage.setItem('lendie_reviewed', JSON.stringify(next)); } catch { /* storage full/blocked */ }
      return next;
    });
    setReviewingBooking(null);
    showToast("Review submitted! Thank you.");
    // Let the owner know they got a review
    const ownerUserId = booking.item?.ownerId;
    if (ownerUserId && ownerUserId !== 'me' && ownerUserId !== user?.id) {
      supabase.from('notifications').insert({
        user_id: ownerUserId, icon: '⭐',
        text: `New ${stars}-star review: ${booking.item.title}`,
        sub: comment ? `"${comment.slice(0, 80)}"` : `${reviewerName} left a review`,
        time_label: 'Just now', unread: true, type: 'review',
      }).then(({ error }) => { if (error) console.error('[Review] notif failed:', error.message); });
      sendPushToUser(ownerUserId, { title: 'New review ⭐', body: `${reviewerName} left a ${stars}-star review on ${booking.item.title}`, url: '/?tab=listings', tag: `review-${booking.id}` });
    }
  };

  const TABS = [
    ["all","For you"],["everything","All"],["tools","Tools"],["trailers","Trailers"],["construction","Equipment"],
    ["kitchen","Kitchen"],["garden","Garden"],["outdoors","Outdoors"],
    ["party","Party"],["tech","Tech"],["other","Other"]
  ];

  // Category pills swap between item and service taxonomies based on the active tab.
  const ITEM_PILLS = [["all","All"],["tools","Tools"],["trailers","Trailers"],["construction","Equipment"],["kitchen","Kitchen"],["garden","Garden"],["outdoors","Outdoors"],["party","Party"],["tech","Tech"],["other","Other"]];
  const SERVICE_PILLS = [["all","All"],["svc_lawn","Lawn & Yard"],["svc_clean","Cleaning"],["svc_move","Moving"],["svc_handy","Handyman"],["svc_tech","Tech Help"],["svc_venue","Venues"],["svc_other","Other"]];
  const catPills = listingTypeFilter === "services" ? SERVICE_PILLS : ITEM_PILLS;

  const TypeFilterBar = () => (
    <div style={{ display:"flex", background: darkMode ? "#2C2C2E" : "#F0F2F5", borderRadius:10, padding:3 }}>
      {[["all","All"],["rent","Rent"],["buy","Buy"],["services","Services"]].map(([val,label]) => (
        <button key={val} onClick={()=>{ setListingTypeFilter(val); setCategory("all"); }} style={{
          flex:1, padding:"7px 0", borderRadius:7, border:"none", fontFamily:"inherit",
          fontSize:13, fontWeight:listingTypeFilter===val ? 700 : 500,
          background: listingTypeFilter===val ? "#00B894" : "transparent",
          color: listingTypeFilter===val ? "#fff" : C.muted,
          cursor:"pointer",
        }}>{label}</button>
      ))}
    </div>
  );

  const CategoryPills = () => (
    <div style={{ display:"flex", gap:8, overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch", paddingBottom:2 }}>
      {catPills.map(([id,label])=>(
        <button key={id} onClick={()=>setCategory(id)} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:5, padding:"6px 13px", borderRadius:20, border:"none", background: category===id ? "#00B894" : C.chip, color: category===id ? "#fff" : C.chipText, fontSize:13, fontWeight: category===id ? 700 : 400, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", boxShadow: category===id?"0 2px 8px rgba(0,184,148,0.3)":"none" }}>
          <CatIcon id={id} size={14}/>{label}
        </button>
      ))}
    </div>
  );

  const CardGrid = () => (
    <div style={{ display:"grid", gridTemplateColumns: isDesktop ? "repeat(auto-fill, minmax(210px,1fr))" : "1fr 1fr", gap: isDesktop ? 20 : 10, padding: isDesktop ? 0 : "10px 10px 6px", background: "transparent" }}>
      {filtered.map(item => (
        <div key={item.id} style={{ background:C.card, overflow:"hidden", cursor:"pointer", position:"relative", borderRadius:14, boxShadow: darkMode ? "0 1px 6px rgba(0,0,0,0.3)" : "0 1px 8px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)" }} onClick={()=>setSelectedItem(item)}>
          {/* Photo area */}
          <div style={{ background:(item.color||"#eee")+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:52, aspectRatio:"1 / 1", width:"100%", position:"relative", overflow:"hidden" }}>
            <CardPhotoCarousel item={item}/>
            <button style={{ position:"absolute", top:8, right:8, background:"rgba(255,255,255,0.9)", border:"none", borderRadius:"50%", width:34, height:34, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", boxShadow:"0 1px 4px rgba(0,0,0,0.12)" }} onClick={e=>{e.stopPropagation();toggleFav(item.id);}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill={favorites.includes(item.id)?"#FF3B5C":"none"} stroke={favorites.includes(item.id)?"#FF3B5C":"#65676B"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
            <div style={{ position:"absolute", bottom:8, left:8, display:"flex", gap:5 }}>
              {(item.listingType==="service"
                ? [{ label:"Service", bg:"#7B61FF" }]
                : [
                    ...(item.listingType==="rent"||item.listingType==="both" ? [{ label:"Rent", bg:"#00B894" }] : []),
                    ...(item.listingType==="sale"||item.listingType==="both" ? [{ label:"Sale", bg:"#E87722" }] : []),
                  ]
              ).map(b=>(
                <div key={b.label} style={{ background:b.bg, borderRadius:6, padding:"3px 8px", fontSize:10, fontWeight:700, color:"#fff", letterSpacing:0.2 }}>
                  {b.label}
                </div>
              ))}
            </div>
          </div>
          {/* Info */}
          <div style={{ padding:"10px 12px 12px" }}>
            <div style={{ fontWeight:600, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textTransform:"capitalize", marginBottom:3, letterSpacing:-0.1 }}>{item.title}</div>
            <div style={{ fontWeight:800, fontSize:15, color:C.text, marginBottom:2 }}>
              {item.listingType==="service"
                ? <><span style={{ fontSize:11, fontWeight:600, color:C.faint }}>from </span>${item.price}<span style={{ fontSize:11, fontWeight:400, color:C.faint }}>/{SERVICE_UNIT_LABEL[item.priceUnit]||item.priceUnit||"hr"}</span></>
                : item.listingType==="sale"
                ? <>${item.price}</>
                : item.listingType==="both" && item.salePrice
                ? <>${item.price}<span style={{ fontSize:11, fontWeight:400, color:C.faint }}>/{item.priceUnit||"day"}</span><span style={{ fontSize:11, fontWeight:700, color:"#E87722" }}> · Buy ${item.salePrice}</span></>
                : <>${item.price}<span style={{ fontSize:11, fontWeight:400, color:C.faint }}>/{item.priceUnit||"day"}</span></>}
            </div>
            {formatDistance(item.distance) && <div style={{ fontSize:11, color:C.faint }}>{formatDistance(item.distance)}</div>}
          </div>
        </div>
      ))}
    </div>
  );

  const PaymentModal = () => {
    if (!paymentModal) return null;
    const { item, start, end } = paymentModal;
    const delivAmn = item.amenities && item.amenities.find(a=>/delivery/i.test(a)&&/\$\d+/.test(a));
    const delivFee = (item.offersDelivery && item.deliveryFee && item.lat && item.lng) ? item.deliveryFee : null;
    const dismiss = () => { setPaymentModal(null); setPaymentStep(1); setWantsDelivery(false); setDeliveryAddress(""); setDeliveryCheck(null); setDeliveryCoords(null); };
    const runCheck = (coords) => {
      if (!item.lat || !item.lng) {
        setDeliveryCheck("within");
        setWantsDelivery(true);
        return;
      }
      const ownerRadius = item.deliveryRadius ?? 15;
      const dist = haversineDistance(item.lat, item.lng, coords.lat, coords.lng);
      const inRange = dist <= ownerRadius;
      setDeliveryCheck(inRange ? "within" : "outside");
      setWantsDelivery(inRange);
    };
    const handleAddressChange = (text) => { setDeliveryAddress(text); setDeliveryCheck(null); setDeliveryCoords(null); setWantsDelivery(false); };
    const handlePlaceSelect = (coords) => { setDeliveryCoords(coords); runCheck(coords); };
    const isPurchase = paymentModal.purchase || false;
    const offerPrice = paymentModal.offerPrice || null;
    const nights = !isPurchase && start && end ? Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1) : 1;
    const rate = offerPrice || (isPurchase ? (Number(item.salePrice) || Number(item.price) || 0) : (Number(item.price) || 0));
    const unit = item.priceUnit || 'day';
    const rental = rate * nights;
    const delivery = wantsDelivery ? (Number(item.deliveryFee) || 0) : 0;
    const total = rental + delivery;
    // Card payments add an 8% service fee (cash is off-platform, no fee). Show the
    // all-in card price up front so renters/buyers aren't surprised at the card step.
    const serviceFee = Math.round(rental * 0.08 * 100) / 100;
    const allIn = Math.round((total + serviceFee) * 100) / 100;
    const cardAvailable = !!STRIPE_KEY;

    return (
      <div style={{ ...S.overlay, zIndex:400 }} onClick={dismiss}>
        <div style={{ ...S.sheet, zIndex:401 }} onClick={e=>e.stopPropagation()}>
          <div>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              {(() => {
                const t = thumbSrc(item.uploadedImages?.[0]);
                return t
                  ? <img src={t} alt="" style={{ width:64, height:64, borderRadius:14, objectFit:"cover", marginBottom:8, display:"inline-block", verticalAlign:"middle" }}/>
                  : <div style={{ fontSize:36, marginBottom:8 }}>{item.emoji}</div>;
              })()}
              <div style={{ fontSize:18, fontWeight:800, color:C.text }}>{item.title}</div>
              <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{item.owner}</div>
            </div>
            {start && (
              <div style={{ background:C.card, borderRadius:12, padding:"12px 16px", marginBottom:14, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", fontSize:14 }}>
                <span style={{ color:C.muted }}>Dates</span>
                <span style={{ fontWeight:700, color:C.text }}>{formatDate(start)}{end&&end!==start?" – "+formatDate(end):""}</span>
              </div>
            )}
            {/* Price breakdown */}
            <div style={{ background:C.card, borderRadius:12, padding:"12px 16px", marginBottom:16, border:`1px solid ${C.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:C.muted, marginBottom:6 }}>
                {offerPrice ? <span>Accepted offer</span> : isPurchase ? <span>Sale price</span> : <span>${rate}/{unit} × {nights} {unit}{nights>1?'s':''}</span>}
                <span style={{ color:C.text }}>${rental}</span>
              </div>
              {delivery > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:C.muted, marginBottom:6 }}>
                  <span>📦 Delivery</span>
                  <span style={{ color:C.text }}>${delivery}</span>
                </div>
              )}
              {cardAvailable && (
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:C.muted, marginBottom:6 }}>
                  <span>Service fee (8%)</span>
                  <span style={{ color:C.text }}>${serviceFee.toFixed(2)}</span>
                </div>
              )}
              <div style={{ height:"0.5px", background:C.border, margin:"8px 0" }}/>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:15, fontWeight:700, color:C.text }}>
                <span>Total</span>
                <span>${(cardAvailable ? allIn : total).toFixed(2)}</span>
              </div>
              {cardAvailable && (
                <div style={{ fontSize:11, color:C.faint, marginTop:6, textAlign:"right" }}>
                  Card total shown. Cash payment is ${total.toFixed(2)} (no service fee).
                </div>
              )}
            </div>
            {/* Payment method */}
            <div style={{ fontWeight:700, fontSize:13, color:C.text, marginBottom:10 }}>Select payment method</div>
            {STRIPE_KEY ? (
              <button style={{ width:"100%", padding:"14px", borderRadius:10, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8 }} onClick={() => setShowStripeModal(true)}>
                <CreditCard size={17} strokeWidth={2.25}/>Pay with Card · ${allIn.toFixed(2)}
              </button>
            ) : (
              <button disabled style={{ width:"100%", padding:"14px", borderRadius:10, border:`1px dashed ${C.border}`, fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"default", background:C.card, color:C.faint, marginBottom:10, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                <CreditCard size={17} strokeWidth={2.25}/>Credit/debit payments coming soon
              </button>
            )}
            <button
              style={{ width:"100%", padding:"14px", borderRadius:10, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#007AFF", color:"#fff", marginBottom:10, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8 }}
              onClick={async () => {
                dismiss();
                const reqs = bookingRequests.filter(r => r.item?.title === item.title && r.renterId === user?.id && r.status === 'accepted');
                const req = reqs[0];
                if (req?.dbId) {
                  await supabase.from('booking_requests').update({ status: 'confirmed', payment_status: 'cash' }).eq('id', req.dbId);
                  setBookingRequests(prev => prev.map(r => r.dbId === req.dbId ? {...r, status:'confirmed', payment_status:'cash'} : r));
                }
                // Reflect the booking locally — the listing's booked dates were already
                // blocked server-side by the owner at accept time (renters can't write listings)
                if (req?.start) {
                  const newDates = getDatesInRange(req.start, req.end || req.start);
                  setBookedOverrides(prev => ({ ...prev, [req.item.id]: [...new Set([...(req.item.booked || []), ...(prev[req.item.id] || []), ...newDates])] }));
                }
                const noun = "Transaction";
                const whenSub = start ? " · " + formatDate(start) : "";
                showToast(`${noun} confirmed! Arrange cash payment with the owner.`);
                addNotification({ icon:"✅", text:`${noun} confirmed: `+item.title, sub:"Cash payment agreed"+whenSub, time:"Just now", type:"confirm" });
                // Record the confirmation in the chat thread so the deal history stays in one place
                const ownerUserId = req?.ownerId || item.ownerId;
                if (ownerUserId && ownerUserId !== 'me') {
                  sendItemMessage(ownerUserId, item.owner || "Owner", item.ownerAvatarUrl, item.title, req?.dateStr,
                    isPurchase ? `✅ Transaction confirmed — I'll pay cash at handoff. ($${total})` : `✅ Transaction confirmed — I'll pay cash at pickup. ($${total})`);
                  supabase.from('notifications').insert({ user_id: ownerUserId, icon:"✅", text:"Payment confirmed: "+item.title, sub:"Renter will pay cash"+whenSub, time_label:"Just now", unread:true, type:"confirm" }).then(({ error }) => { if (error) console.error('[CashConfirm] notif failed:', error.message); });
                  sendPushToUser(ownerUserId, { title:`${noun} confirmed!`, body:`${user?.user_metadata?.name||'Renter'} confirmed cash payment for ${item.title}`, url:'/?tab=messages', tag:`confirmed-${req?.dbId || item.id}` });
                }
              }}
            >
              <DollarSign size={17} strokeWidth={2.25}/>Pay with Cash · ${total.toFixed(2)}
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
            <div style={{ fontSize:17, fontWeight:800, color:C.text }}>Notifications</div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              {bellItems.length > 0 && <button onClick={()=>{
                setNotifKeyState(derivedNotifs.map(d=>d.key), 'hidden');
                setNotifications([]);
                if(user) supabase.from('notifications').delete().eq('user_id',user.id).then(({error})=>{ if(error) console.error('[Notif] clear-all failed:',error.message); });
              }} style={{ background:"none", border:"none", color:"#FA3E3E", fontSize:12, fontWeight:700, cursor:"pointer" }}>Clear all</button>}
              <button onClick={()=>{
                setNotifKeyState(derivedNotifs.map(d=>d.key), 'read');
                setNotifications(prev=>prev.map(n=>({...n,unread:false})));
                if(user) supabase.from('notifications').update({unread:false}).eq('user_id',user.id).then(({error})=>{ if(error) console.error('[Notif] mark-read failed:',error.message); });
              }} style={{ background:"none", border:"none", color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer" }}>Mark all read</button>
            </div>
          </div>
          {bellItems.length===0 && <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted }}>No notifications</div>}
          {bellItems.map(n=>(
            <div key={n.id}
              onClick={()=>{
                // Mark as read
                if (n.derived) setNotifKeyState(n.id, 'read');
                else {
                  setNotifications(prev=>prev.map(x=>x.id===n.id?{...x,unread:false}:x));
                  if(user && n.id) supabase.from('notifications').update({unread:false}).eq('id',n.id).then(({error})=>{ if(error) console.error('[Notif] read failed:',error.message); });
                }
                // Navigate to relevant tab
                setTab('messages');
                setShowNotifs(false);
              }}
              style={{ display:"flex", gap:11, padding:"11px 12px", borderBottom:`1px solid ${C.borderFaint}`, alignItems:"flex-start", cursor:"pointer", background: n.unread ? (darkMode ? "rgba(0,184,148,0.15)" : "rgba(0,184,148,0.09)") : "transparent" }}>
              <NotifIcon emoji={n.icon} type={n.type} dark={darkMode} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:n.unread?700:500, color:C.text }}>{n.text}</div>
                <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{n.sub}</div>
                <div style={{ fontSize:10, color:C.faint, marginTop:2 }}>{n.time}</div>
              </div>
              <button onClick={e=>{ e.stopPropagation();
                if (n.derived) setNotifKeyState(n.id, 'hidden');
                else {
                  setNotifications(prev=>prev.filter(x=>x.id!==n.id));
                  if(user) supabase.from('notifications').delete().eq('id',n.id).then(({error})=>{ if(error) console.error('[Notif] delete failed:',error.message); });
                }
              }} style={{ background:"none", border:"none", color:"#CDD0D4", fontSize:18, cursor:"pointer", lineHeight:1, padding:"0 2px", flexShrink:0 }}>×</button>
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
        .lcard:hover{box-shadow:0 6px 24px rgba(0,0,0,0.18)!important;transform:translateY(-2px)}
        @media (hover: none), (pointer: coarse) { .card-arrow { display: none !important } }
        .lnav-btn:hover{background:${darkMode ? '#3A3B3C' : '#E8FBF6'}!important;color:#00B894!important}
      `}</style>

      {/* Desktop top navbar */}
      {isDesktop && (
        <header style={{ position:"fixed", top:0, left:0, right:0, height:64, background: darkMode ? "rgba(24,25,26,0.96)" : "rgba(255,255,255,0.96)", backdropFilter:"blur(20px) saturate(180%)", WebkitBackdropFilter:"blur(20px) saturate(180%)", borderBottom:`1px solid ${darkMode?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.07)"}`, zIndex:200, display:"flex", alignItems:"center" }}>
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
                  style={{ position:"relative", background:tab===n.id?(darkMode?"#00B894":"#E8FBF6"):"transparent", border:"none", borderRadius:8, padding:"8px 18px", cursor:"pointer", color:tab===n.id?(darkMode?"#fff":"#00B894"):"#8A8D91", fontWeight:tab===n.id?700:500, fontSize:14, fontFamily:"inherit", transition:"all 0.15s" }}>
                  {n.label}
                  {n.badge>0 && <span style={{ position:"absolute", top:4, right:6, background:"#FA3E3E", borderRadius:"50%", width:16, height:16, fontSize:9, display:"inline-flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:"#fff" }}>{n.badge}</span>}
                </button>
              ))}
            </nav>
            {/* Auth */}
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              {user ? (
                <>
                  <button style={{ background:"transparent", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }} onClick={()=>setShowFavOnly(f=>!f)} title={showFavOnly?"Show all":"Favorites only"}><Heart size={18} strokeWidth={1.75} color={showFavOnly?"#FA3E3E":C.muted} fill={showFavOnly?"#FA3E3E":"none"}/></button>
                  <button style={{ position:"relative", background:"transparent", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }} onClick={()=>setShowNotifs(true)}>
                    <Bell size={18} strokeWidth={1.75} color={C.text}/>
                    {unreadNotifs>0&&<div style={{ position:"absolute", top:-1, right:-1, background:"#FA3E3E", borderRadius:"50%", minWidth:16, height:16, padding:"0 4px", fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:900, border:"2px solid #fff", boxSizing:"border-box" }}>{unreadNotifs}</div>}
                  </button>
                  <div onClick={()=>setTab("profile")} style={{ width:36, height:36, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#fff", fontWeight:800, cursor:"pointer", overflow:"hidden", flexShrink:0 }}>
                    {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" style={{ width:36, height:36, objectFit:"cover" }}/> : "👽"}
                  </div>
                </>
              ) : (
                <>
                  <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:20, padding:"0 18px", height:36, fontSize:13, fontWeight:600, cursor:"pointer", color:C.text, fontFamily:"inherit" }}>Log in</button>
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

      {(isPulling || isRefreshing) && !isDesktop && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:300, display:"flex", justifyContent:"center", alignItems:"flex-start", paddingTop: Math.max(8, pullY - 8), pointerEvents:"none", transition: isPulling ? "none" : "padding-top 0.3s ease" }}>
          <div style={{ background:"#00B894", borderRadius:20, padding:"7px 16px", display:"flex", alignItems:"center", gap:7, color:"#fff", fontSize:13, fontWeight:700, boxShadow:"0 2px 12px rgba(0,184,148,0.4)", opacity: pullY > 16 || isRefreshing ? 1 : 0, transition:"opacity 0.15s, transform 0.15s", transform: `scale(${isRefreshing ? 1 : Math.min(pullY / 58, 1)})` }}>
            {isRefreshing
              ? <><span style={{ display:"inline-block", animation:"spin 0.8s linear infinite" }}>↻</span> Refreshing…</>
              : <>{pullY >= 58 ? "↑ Release to refresh" : "↓ Pull to refresh"}</>}
          </div>
        </div>
      )}

      {tab==="browse" && (
        <div
          style={{ background:C.bg, minHeight: isDesktop ? "auto" : "calc(100vh - 84px)", animation:"tabFadeIn 0.2s ease" }}
          onTouchStart={e => {
            pullStartY.current = e.touches[0].clientY;
            pullStartScroll.current = window.scrollY;
          }}
          onTouchMove={e => {
            if (isRefreshing || isDesktop) return;
            if (pullStartScroll.current > 10) return;
            const delta = e.touches[0].clientY - pullStartY.current;
            if (delta > 4) {
              setIsPulling(true);
              setPullY(Math.min(delta * 0.45, 80));
            }
          }}
          onTouchEnd={() => {
            if (pullY >= 58 && !isRefreshing) {
              setIsRefreshing(true);
              setRefreshTick(t => t + 1);
              setTimeout(() => setIsRefreshing(false), 1200);
            }
            setIsPulling(false);
            setPullY(0);
          }}
        >
          <div style={{ display: isDesktop ? "none" : "block", background: darkMode ? "rgba(24,25,26,0.96)" : "rgba(255,255,255,0.96)", backdropFilter:"blur(20px) saturate(180%)", WebkitBackdropFilter:"blur(20px) saturate(180%)", borderBottom:`1px solid ${darkMode?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.07)"}`, position:"sticky", top:0, zIndex:50 }} onClick={e=>e.stopPropagation()}>
            {/* Top bar: logo + user actions */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 14px 8px" }}>
              <div style={{ fontSize:26, fontWeight:900, color:"#00B894", letterSpacing:-0.8 }}>Lendie</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {user ? (
                  <>
                    <button style={{ position:"relative", background:"transparent", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }} onClick={()=>setShowNotifs(true)}>
                      <Bell size={18} strokeWidth={1.75} color={C.text}/>
                      {unreadNotifs>0&&<div style={{ position:"absolute", top:-1, right:-1, background:"#FA3E3E", borderRadius:"50%", minWidth:16, height:16, padding:"0 4px", fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:900, border:"2px solid #fff", boxSizing:"border-box" }}>{unreadNotifs}</div>}
                    </button>
                    <div onClick={()=>setTab("profile")} style={{ width:36, height:36, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#fff", fontWeight:800, cursor:"pointer", flexShrink:0, overflow:"hidden" }}>
                      {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" style={{ width:36, height:36, objectFit:"cover" }}/> : "👽"}
                    </div>
                  </>
                ) : (
                  <>
                    <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ background:C.chip, border:"none", borderRadius:20, padding:"0 14px", height:34, fontSize:13, fontWeight:700, cursor:"pointer", color:C.text, fontFamily:"inherit" }}>Log in</button>
                    <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ background:"#00B894", border:"none", borderRadius:20, padding:"0 14px", height:34, fontSize:13, fontWeight:700, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Sign up</button>
                  </>
                )}
              </div>
            </div>
            {/* Search bar — prominent, always visible */}
            <div style={{ padding:"0 12px 10px" }}>
              <div style={{ background: darkMode ? "#2C2D2E" : "#F0F2F5", borderRadius:14, display:"flex", alignItems:"center", padding:"10px 14px", gap:10, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input style={{ flex:1, background:"none", border:"none", outline:"none", color:C.text, fontSize:15, fontFamily:"inherit" }} placeholder="Search Lendie..." value={search} autoComplete="off" autoCorrect="off" spellCheck="false" onClick={e=>e.stopPropagation()} onChange={e=>{ e.stopPropagation(); setSearch(e.target.value); }}/>
                {search && <div onClick={()=>setSearch("")} style={{ cursor:"pointer", width:20, height:20, borderRadius:"50%", background:"#8A8D91", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>}
              </div>
            </div>
            {/* Location + sort row */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 12px 8px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer" }} onClick={()=>setShowLocationPicker(p=>!p)}>
                <MapPin size={13} strokeWidth={2} color="#00B894"/>
                <span style={{ fontSize:13, fontWeight:600, color:"#00B894" }}>
                  {locationText === "Current Location" && resolvedLocation ? resolvedLocation : locationText.split(",")[0]}
                </span>
                <span style={{ fontSize:12, color:"#8A8D91" }}>· {radius}mi {showLocationPicker?"▲":"▼"}</span>
              </div>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ background:C.chip, border:"none", borderRadius:8, padding:"5px 8px", fontSize:12, color:C.muted, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
                <option value="distance">Nearest</option>
                <option value="price">Price ↑</option>
                <option value="price-desc">Price ↓</option>
                <option value="rating">Top Rated</option>
                <option value="newest">Newest</option>
              </select>
            </div>
            {/* Rent / Buy / All filter */}
            <div style={{ padding:"0 12px 8px" }}>
              {TypeFilterBar()}
            </div>
            {/* Category pills — horizontally scrollable */}
            <div style={{ padding:"0 12px 10px", overflowX:"auto", scrollbarWidth:"none", display:"flex", gap:7, WebkitOverflowScrolling:"touch" }}>
              {catPills.map(([id,label])=>(
                <button key={id} onClick={()=>setCategory(id)} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:5, padding:"6px 14px", borderRadius:20, border:"none", background: category===id?"#00B894":C.chip, color: category===id?"#fff":C.chipText, fontSize:13, fontWeight: category===id?700:500, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", transition:"all 0.15s", boxShadow: category===id?"0 2px 8px rgba(0,184,148,0.3)":"none" }}>
                  <CatIcon id={id} size={13}/>{label}
                </button>
              ))}
            </div>
          </div>
          {/* Location nudge — shown until location is on or a custom area is chosen */}
          {!gpsCoords && !locBannerDismissed && locPromptState !== 'granted' && locationText === "Current Location" && (
            <div style={{ display:"flex", alignItems:"center", gap:10, background: darkMode ? "#0D2E26" : "#E8FBF6", borderBottom:`1px solid ${C.border}`, padding:"10px 14px" }}>
              <span style={{ fontSize:18 }}>📍</span>
              <div style={{ flex:1, fontSize:12.5, color:C.text, lineHeight:1.4 }}>
                {locPromptState === 'denied'
                  ? <><b>Location is off.</b> Enable it for Lendie in your browser or phone settings to see items near you.</>
                  : <><b>See what's nearby.</b> Turn on location to find items closest to you.</>}
              </div>
              {locPromptState !== 'denied' && (
                <button onClick={()=>requestLocation(true)} style={{ background:"#00B894", color:"#fff", border:"none", borderRadius:10, padding:"8px 14px", fontSize:12.5, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>Enable</button>
              )}
              <button onClick={()=>{ setLocBannerDismissed(true); sessionStorage.setItem('lendie_loc_banner','1'); }} style={{ background:"none", border:"none", color:C.faint, fontSize:18, cursor:"pointer", padding:"0 2px", lineHeight:1, flexShrink:0 }}>×</button>
            </div>
          )}
          {showLocationPicker && (
            <div style={{ background:C.card, borderBottom:`1px solid ${C.border}`, padding:"14px" }}>
              <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                <div style={{ flex:1, background: darkMode ? "#2C2D2E" : "#F0F2F5", borderRadius:14, display:"flex", alignItems:"center", padding:"0 14px", gap:10, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  <PlacesAutocompleteInput
                    key={locationPickerKey}
                    placeholder="City or address..."
                    containerStyle={{ flex:1 }}
                    inputStyle={{ width:"100%", background:"none", border:"none", padding:"11px 0", color:C.text, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
                    onAddressChange={text => { setLocationText(text || "Current Location"); pendingLocLabel.current = text || ""; }}
                    onPlaceSelect={({ lat, lng }) => {
                      setSearchCoords({ lat, lng });
                      setShowLocationPicker(false);
                      const label = pendingLocLabel.current || locationText;
                      if (label && label !== "Current Location") {
                        setRecentLocations(prev => {
                          const next = [{ label, coords:{ lat, lng } }, ...prev.filter(l=>l.label!==label)].slice(0,3);
                          try { localStorage.setItem('lendie_recent_locs', JSON.stringify(next)); } catch {}
                          return next;
                        });
                      }
                    }}
                  />
                </div>
                <button onClick={()=>{ setLocationText("Current Location"); setSearchCoords(null); setLocationPickerKey(k=>k+1); requestLocation(true); }} style={{ background:"#E8FBF6", border:"none", borderRadius:12, padding:"0 14px", color:"#00B894", fontSize:13, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>Use mine</button>
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
                <button onClick={()=>{ setLocationText("Current Location"); setSearchCoords(null); setLocationPickerKey(k=>k+1); requestLocation(true); }} style={{ background:locationText==="Current Location"?"#E8FBF6":"transparent", border:locationText==="Current Location"?"1px solid #00B894":`1px solid ${C.border}`, borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:locationText==="Current Location"?700:500, color:locationText==="Current Location"?"#00B894":C.muted, cursor:"pointer" }}>
                  📍 Current
                </button>
                {recentLocations.map(loc=>(
                  <button key={loc.label} onClick={()=>{ setLocationText(loc.label); setSearchCoords(loc.coords); setShowLocationPicker(false); }}
                    style={{ background:locationText===loc.label?"#E8FBF6":"transparent", border:locationText===loc.label?"1px solid #00B894":`1px solid ${C.border}`, borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:locationText===loc.label?700:500, color:locationText===loc.label?"#00B894":C.muted, cursor:"pointer", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {loc.label.split(",")[0]}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                <span style={{ fontSize:13, fontWeight:600, color:C.text }}>Search radius</span>
                <select value={radius} onChange={e=>setRadius(Number(e.target.value))} style={{ background:C.chip, border:`1px solid ${C.border}`, borderRadius:10, padding:"7px 12px", fontSize:14, color:C.text, cursor:"pointer", fontFamily:"inherit", outline:"none", fontWeight:600 }}>
                  {[2,5,10,25,50].map(r=><option key={r} value={r}>{r} miles</option>)}
                </select>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
                <div style={{ fontSize:12, color:C.muted }}><span style={{ fontWeight:700, color:C.text }}>{filtered.length}</span> listings</div>
                <button onClick={()=>setShowLocationPicker(false)} style={{ background:"#00B894", border:"none", borderRadius:8, padding:"8px 18px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Done</button>
              </div>
            </div>
          )}
          {isDesktop ? (
            <div style={{ maxWidth:1200, margin:"0 auto", padding:"16px 24px", minHeight:"calc(100vh - 64px)" }}>
              {/* Title + location row */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:18, fontWeight:800, color:C.text }}>
                  {showFavOnly ? "Favorites" : category==="all" ? (centerCoords ? "Near you" : "Browse all") : TABS.find(([id])=>id===category)?.[1] || category}
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer" }} onClick={()=>setShowLocationPicker(p=>!p)}>
                    <span style={{ fontSize:13, color:"#00B894" }}>📍</span>
                    <span style={{ fontSize:13, fontWeight:600, color:"#00B894" }}>
                      {locationText === "Current Location" && resolvedLocation ? resolvedLocation : locationText.split(",")[0]}
                    </span>
                    <span style={{ fontSize:13, color:"#00B894" }}>· {radius}mi</span>
                    <span style={{ fontSize:11, color:"#65676B" }}>{showLocationPicker ? "▲" : "▼"}</span>
                  </div>
                </div>
              </div>
              {/* Search + radius + sort row */}
              <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:160, background:C.searchBg, borderRadius:10, display:"flex", alignItems:"center", padding:"8px 12px", gap:8 }}>
                  <Search size={14} strokeWidth={2} color={C.faint}/>
                  <input style={{ flex:1, background:"none", border:"none", outline:"none", color:C.text, fontSize:13, fontFamily:"inherit" }} placeholder="Search..." value={search} autoComplete="off" onChange={e=>setSearch(e.target.value)}/>
                  {search && <span onClick={()=>setSearch("")} style={{ cursor:"pointer", color:C.faint, fontSize:13 }}>✕</span>}
                </div>
                <select value={radius} onChange={e=>setRadius(Number(e.target.value))} style={{ background:C.chip, border:`1px solid ${C.border}`, borderRadius:10, padding:"7px 12px", fontSize:13, color:C.text, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
                  {[2,5,10,25,50].map(r=><option key={r} value={r}>{r} mi</option>)}
                </select>
                <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ background:C.chip, border:`1px solid ${C.border}`, borderRadius:10, padding:"7px 12px", fontSize:13, color:C.text, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
                  <option value="distance">Nearest</option>
                  <option value="price">Price ↑</option>
                  <option value="price-desc">Price ↓</option>
                  <option value="rating">Top Rated</option>
                  <option value="newest">Newest</option>
                </select>
                <div style={{ fontSize:12, color:C.faint, whiteSpace:"nowrap" }}><span style={{ fontWeight:700, color:C.text }}>{filtered.length}</span> listings</div>
              </div>
              {/* No center point → we can't apply the distance radius. Be honest about
                  it and prompt for a location instead of showing everything as "near you". */}
              {!centerCoords && (
                <div style={{ display:"flex", alignItems:"center", gap:12, background: darkMode ? "#0D2E26" : "#E8FBF6", border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 16px", marginBottom:14, flexWrap:"wrap" }}>
                  <span style={{ fontSize:18 }}>📍</span>
                  <div style={{ flex:1, minWidth:220, fontSize:13, color:C.text, lineHeight:1.45 }}>
                    <b>Set your location to filter by distance.</b> We can't tell what's near you yet, so we're showing listings from <b>all areas</b> — the {radius} mi radius isn't being applied.{locPromptState === 'denied' ? ' Location is blocked in your browser; enable it in settings, or enter a place below.' : ''}
                  </div>
                  {locPromptState !== 'denied' && (
                    <button onClick={()=>requestLocation(true)} style={{ background:"#00B894", color:"#fff", border:"none", borderRadius:10, padding:"8px 14px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>Enable location</button>
                  )}
                  <button onClick={()=>setShowLocationPicker(true)} style={{ background:"transparent", color:"#00B894", border:"1px solid #00B894", borderRadius:10, padding:"8px 14px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>Enter a place</button>
                </div>
              )}
              <div style={{ marginBottom:16 }}>{CategoryPills()}</div>
              <div style={{ marginBottom:16 }}>{TypeFilterBar()}</div>
              {filtered.length===0
                ? <div style={{ textAlign:"center", padding:"80px 20px", color:"#65676B" }}>No listings found. Try adjusting the filters.</div>
                : CardGrid()}
            </div>
          ) : (
            <>
              {filtered.length===0
                ? <div style={{ textAlign:"center", padding:"60px 20px", color:C.muted, background:C.bg }}>
                    <div style={{ fontSize:36, marginBottom:10 }}>🔍</div>
                    <div style={{ fontWeight:700, color:"#1C1E21", marginBottom:4 }}>No listings found</div>
                    <div style={{ fontSize:13 }}>Try a different category or location</div>
                  </div>
                : CardGrid()}
            </>
          )}
        </div>
      )}

      {tab==="listings" && (
        <div style={{ background:C.bg, minHeight:"100vh", animation:"tabFadeIn 0.2s ease" }}>
          {/* Header */}
          <div style={{ background:C.bg, borderBottom:`1px solid ${C.border}`, position:"sticky", top: isDesktop ? 64 : 0, zIndex:40 }}>
            <div style={{ padding:"14px 16px 12px", textAlign:"center" }}>
              <div style={{ fontSize:20, fontWeight:900, color:C.text }}>My Items</div>
            </div>
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px", background:C.card, margin:12, borderRadius:16 }}>
              <div style={{ marginBottom:16, display:"flex", justifyContent:"center" }}><Package size={48} strokeWidth={1.25} color={C.border}/></div>
              <div style={{ fontSize:17, fontWeight:800, color:C.text, marginBottom:8 }}>List your first item</div>
              <div style={{ fontSize:13, color:C.muted, marginBottom:24, lineHeight:1.6 }}>Sign in to earn money by renting out tools, gear, and more to your neighbors.</div>
              <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }}>Get started</button>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:C.card, color:C.text }}>Sign in</button>
            </div>
          )}

          {user && (()=>{
            const TODAY = new Date().toISOString().slice(0,10);
            const endOf = r => r.end || r.start || '';
            const myAccepted    = bookingRequests.filter(r=>r.renterId===user.id&&(r.status==="accepted"||r.status==="confirmed"));
            const activeRentals = myAccepted.filter(r=>endOf(r)>=TODAY);
            const pastRentals   = myAccepted.filter(r=>endOf(r)<TODAY);
            const pendingMine   = bookingRequests.filter(r=>r.renterId===user.id&&r.status==="pending");
            // Bookings other people have on MY listings — owner side
            const upcomingBookings = bookingRequests.filter(r=>r.ownerId===user.id&&(r.status==="accepted"||r.status==="confirmed")&&endOf(r)>=TODAY);
            const savedItems    = allItems.filter(i=>favorites.includes(i.id));
            const toggleSec = id => setOpenSections(prev=>({...prev,[id]:!prev[id]}));
            const isOpen = id => openSections[id] === undefined ? id==="mylistings" : !!openSections[id];
            const rowStyle = { display:"flex", gap:12, alignItems:"flex-start", padding:"12px 16px", borderBottom:`1px solid ${C.borderFaint}`, background:C.bg };
            const emptyStyle = { padding:"16px", fontSize:13, color:C.faint, textAlign:"center", background:C.bg };
            const Thumb = ({item:it}) => {
              const live = allItems.find(l=>l.id===it?.id);
              const imgUrl = thumbSrc(live?.uploadedImages?.[0]) || thumbSrc(it?.uploadedImages?.[0]);
              return (
                <div style={{ width:44, height:44, borderRadius:10, background:(it?.color||"#eee")+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0, overflow:"hidden" }}>
                  {imgUrl ? <img src={imgUrl} alt="" style={{width:44,height:44,objectFit:"cover"}}/> : (live?.emoji||it?.emoji)}
                </div>
              );
            };
            const SecHeader = ({id, label, count, accent}) => (
              <div onClick={()=>toggleSec(id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", cursor:"pointer", userSelect:"none", background:C.bg }}>
                <span style={{ flex:1, fontWeight:700, fontSize:14, color:C.text }}>{label}</span>
                {count>0 && <span style={{ background:accent+"18", color:accent, borderRadius:20, padding:"2px 9px", fontSize:12, fontWeight:700 }}>{count}</span>}
                <ChevronDown size={16} color="#8A8D91" style={{ transform:isOpen(id)?"rotate(180deg)":"none", transition:"transform 0.2s" }}/>
              </div>
            );
            return (
              <div style={{ display:"flex", flexDirection:"column" }}>

                {/* My Listings — open by default */}
                <div style={{ borderBottom:`1px solid ${C.border}` }}>
                  <SecHeader id="mylistings" label="My Listings" count={myListings.length} accent="#00B894"/>
                  {isOpen("mylistings") && (
                    <div>
                      {myListings.length===0 ? (
                        <div style={{ padding:16 }}>
                          <button onClick={openNewListing} style={{ width:"100%", background:"#00B894", border:"none", borderRadius:16, padding:"32px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:8, color:"#fff" }}>
                            <span style={{ fontSize:36, lineHeight:1 }}>+</span>
                            <span style={{ fontSize:16, fontWeight:800 }}>New Listing</span>
                            <span style={{ fontSize:12, opacity:0.85 }}>Tap to list your first item</span>
                          </button>
                        </div>
                      ) : (
                        <div style={{ display:"grid", gridTemplateColumns: isDesktop ? "repeat(auto-fill, minmax(210px,1fr))" : "1fr 1fr", gap: isDesktop ? 16 : 10, padding:"10px 10px 6px" }}>
                          {myListings.map(l=>(
                            <div key={l.id} style={{ background:C.card, borderRadius:14, overflow:"hidden", cursor:"pointer", boxShadow: darkMode?"0 1px 6px rgba(0,0,0,0.3)":"0 1px 8px rgba(0,0,0,0.07),0 0 0 1px rgba(0,0,0,0.04)" }} onClick={()=>setManagingListing(l)}>
                              <div style={{ background:(l.color||"#eee")+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, height:160, position:"relative", overflow:"hidden" }}>
                                {l.uploadedImages?.[0] ? <img src={thumbSrc(l.uploadedImages[0])} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span>{l.emoji}</span>}
                                <div style={{ position:"absolute", top:8, left:8, display:"flex", alignItems:"center", gap:4, background:"rgba(255,255,255,0.92)", backdropFilter:"blur(4px)", borderRadius:10, padding:"2px 8px" }}>
                                  <div style={{ width:6, height:6, borderRadius:"50%", background:l.available?"#31A24C":"#FA3E3E" }}/>
                                  <span style={{ fontSize:10, fontWeight:700, color:l.available?"#31A24C":"#FA3E3E" }}>{l.available?"Live":"Paused"}</span>
                                </div>
                              </div>
                              <div style={{ padding:"10px 10px 8px" }}>
                                <div style={{ fontWeight:600, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>{l.title}</div>
                                <div style={{ fontWeight:800, fontSize:14, color:C.text, marginBottom:2 }}>${l.price}{l.listingType!=="sale" && <span style={{ fontSize:10, fontWeight:400, color:"#8A8D91" }}>/{l.priceUnit||"day"}</span>}</div>
                                <div style={{ fontSize:11, color:"#8A8D91" }}>{l.views||0} views · {l.requests||0} requests</div>
                              </div>
                              <div style={{ display:"flex", gap:4, padding:"0 8px 10px" }} onClick={e=>e.stopPropagation()}>
                                <button onClick={e=>{ e.stopPropagation(); setEditingListing(l); setNewListing(l); setAddImages(l.uploadedImages||[]); setShowAddListing(true); }} style={{ flex:1, background:darkMode?"#2C2D2E":"#F0F2F5", border:"none", borderRadius:8, padding:"6px 0", fontSize:11, fontWeight:600, cursor:"pointer", color:C.muted, fontFamily:"inherit" }}>Edit</button>
                                <button onClick={async e=>{ e.stopPropagation(); const next=!l.available; const{error}=await supabase.from('listings').update({available:next}).eq('id',l.id); if(!error)setMyListings(prev=>prev.map(x=>x.id===l.id?{...x,available:next}:x)); }} style={{ flex:1, background:darkMode?"#2C2D2E":"#F0F2F5", border:"none", borderRadius:8, padding:"6px 0", fontSize:11, fontWeight:600, cursor:"pointer", color:C.muted, fontFamily:"inherit" }}>{l.available?"Pause":"Resume"}</button>
                                <button onClick={e=>{ e.stopPropagation(); setDeletingId(l.id); }} style={{ flex:1, background:"#FFF0F0", border:"none", borderRadius:8, padding:"6px 0", fontSize:11, fontWeight:600, cursor:"pointer", color:"#FA3E3E", fontFamily:"inherit" }}>Delete</button>
                              </div>
                            </div>
                          ))}
                          <div onClick={openNewListing} style={{ background:"transparent", borderRadius:14, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, height:220, cursor:"pointer", color:"#00B894", border:"2px dashed #00B89440" }}>
                            <div style={{ width:48, height:48, borderRadius:"50%", background:"#00B89420", display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:26, lineHeight:1 }}>+</span></div>
                            <span style={{ fontSize:13, fontWeight:700 }}>New Listing</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Upcoming Bookings — people renting MY items */}
                <div style={{ borderBottom:`1px solid ${C.border}` }}>
                  <SecHeader id="upcoming" label="Upcoming Transactions" count={upcomingBookings.length} accent="#007AFF"/>
                  {isOpen("upcoming") && <div>
                    {upcomingBookings.length===0
                      ? <div style={emptyStyle}>No upcoming transactions on your listings</div>
                      : upcomingBookings.map(req=>(
                        <div key={req.id} style={rowStyle}>
                          <Thumb item={req.item}/>
                          <div style={{ flex:1 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                              <span style={{ fontWeight:700, fontSize:13, color:C.text }}>{req.item?.title}</span>
                              <span style={{ fontSize:10, fontWeight:700, color:req.status==="confirmed"?"#007AFF":"#00B894", background:req.status==="confirmed"?"#E8F0FF":"#E8FBF6", borderRadius:6, padding:"1px 6px" }}>{req.status==="confirmed"?"Confirmed":"Accepted"}</span>
                              {req.payment_status==='paid' && <span style={{ fontSize:10, fontWeight:700, color:"#00B894", background:"#E8FBF6", borderRadius:6, padding:"1px 6px" }}>💳 Paid</span>}
                            </div>
                            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{req.renterName}{reqWhen(req.dateStr, ' · ')}{req.wantsDelivery ? ' · 📦 Delivery' : ''}</div>
                            <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
                              <button onClick={()=>{ openRequestConvo(req); }} style={{ padding:"5px 12px", borderRadius:8, border:"none", background:"#00B894", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Message Renter</button>
                              {req.status==="confirmed" && endOf(req)<=TODAY && (
                                <button onClick={async()=>{ const svc=req.item?.listingType==="service"; if(!window.confirm(`Mark ${req.renterName}'s ${svc?"service as complete":"rental as returned"}?`)) return; if(req.dbId) await supabase.from('booking_requests').update({status:'completed'}).eq('id',req.dbId); setBookingRequests(prev=>prev.map(r=>r.id===req.id?{...r,status:'completed'}:r)); showToast(svc?"Marked as complete!":"Marked as returned!"); }} style={{ padding:"5px 12px", borderRadius:8, border:"1.5px solid #00B894", background:C.bg, color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{req.item?.listingType==="service"?"✓ Complete":"✓ Returned"}</button>
                              )}
                              <button onClick={()=>{ const isPaid=req.payment_status==='paid'; if(!window.confirm(`Cancel ${req.renterName}'s transaction${reqWhen(req.dateStr, ' for ')}?${isPaid?' A full refund will be issued to them.':' They will be notified.'}`)) return; handleOwnerCancelBooking(req); }} style={{ padding:"5px 12px", borderRadius:8, border:"1px solid #FA3E3E", background:C.bg, color:"#FA3E3E", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{req.payment_status==='paid' ? 'Cancel & Refund' : 'Cancel'}</button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>}
                </div>

                {/* Currently Renting */}
                <div style={{ borderBottom:`1px solid ${C.border}` }}>
                  <SecHeader id="active" label="Current Transactions" count={activeRentals.length} accent="#00B894"/>
                  {isOpen("active") && <div>
                    {activeRentals.length===0
                      ? <div style={emptyStyle}>No active rentals</div>
                      : activeRentals.map(req=>{
                        const days = daysUntilStart(req);
                        const canCancel = days > 3;
                        return (
                        <div key={req.id} style={rowStyle}>
                          <Thumb item={req.item}/>
                          <div style={{ flex:1 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                              <span style={{ fontWeight:700, fontSize:13, color:C.text }}>{req.item?.title}</span>
                              {req.status==="confirmed" && <span style={{ fontSize:10, fontWeight:700, color:"#007AFF", background:"#E8F0FF", borderRadius:6, padding:"1px 6px" }}>Upcoming</span>}
                            </div>
                            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{req.item?.owner} · {req.dateStr}</div>
                            <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
                              <button onClick={()=>{ const c=messages.find(m=>m.item===req.item?.title); if(c){setActiveConvo(c);markConvoRead(c);} setTab("messages"); }} style={{ padding:"5px 12px", borderRadius:8, border:"none", background:"#00B894", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Message Owner</button>
                              {canCancel
                                ? <button onClick={()=>req.payment_status==='paid' ? handleRefundRequest(req) : handleCancelRequest(req)} style={{ padding:"5px 12px", borderRadius:8, border:"1px solid #FA3E3E", background:C.bg, color:"#FA3E3E", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{req.payment_status==='paid' ? 'Cancel & Get Refund' : 'Cancel'}</button>
                                : req.start
                                  ? <span style={{ fontSize:11, color:C.faint, alignSelf:"center" }}>Can't cancel within 3 days of start</span>
                                  : null}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                  </div>}
                </div>

                {/* Past Rentals */}
                <div style={{ borderBottom:`1px solid ${C.border}` }}>
                  <SecHeader id="past" label="Past Transactions" count={pastRentals.length} accent="#65676B"/>
                  {isOpen("past") && <div>
                    {pastRentals.length===0
                      ? <div style={emptyStyle}>No past transactions yet</div>
                      : pastRentals.map(req=>{
                        const reviewed = reviewedBookings[req.id];
                        return (
                          <div key={req.id} style={rowStyle}>
                            <Thumb item={req.item}/>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:700, fontSize:13, color:C.text }}>{req.item?.title}</div>
                              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{req.item?.owner} · {req.dateStr}</div>
                              {reviewed
                                ? <div style={{ marginTop:6, fontSize:11, color:"#31A24C", fontWeight:600 }}>✓ Review submitted</div>
                                : <button onClick={()=>setReviewingBooking(req)} style={{ marginTop:8, padding:"5px 12px", borderRadius:8, border:"1.5px solid #00B894", background:C.bg, color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:4 }}><Star size={12} strokeWidth={2}/>Leave a review</button>
                              }
                            </div>
                          </div>
                        );
                      })}
                  </div>}
                </div>

                {/* Saved Listings */}
                <div style={{ borderBottom:`1px solid ${C.border}` }}>
                  <SecHeader id="saved" label="Saved Listings" count={savedItems.length} accent="#E87722"/>
                  {isOpen("saved") && <div>
                    {savedItems.length===0
                      ? <div style={emptyStyle}>No saved listings yet — tap ❤️ on any listing to save it</div>
                      : savedItems.map(item=>(
                        <div key={item.id} onClick={()=>setSelectedItem(item)} style={{ ...rowStyle, cursor:"pointer" }}>
                          <Thumb item={item}/>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:700, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
                            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{item.owner!=="You"?item.owner:"Your listing"} · {
                              item.listingType==="sale" ? `$${item.price}`
                              : item.listingType==="service" ? `from $${item.price}/${SERVICE_UNIT_LABEL[item.priceUnit]||item.priceUnit||"hr"}`
                              : item.listingType==="both" && item.salePrice ? `$${item.price}/${item.priceUnit||"day"} · Buy $${item.salePrice}`
                              : `$${item.price}/${item.priceUnit||"day"}`
                            }</div>
                          </div>
                          <button onClick={e=>{ e.stopPropagation(); toggleFav(item.id); }} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", padding:"4px 6px", flexShrink:0 }}>❤️</button>
                        </div>
                      ))}
                  </div>}
                </div>

                {/* Pending Approval — requests you sent as renter */}
                <div style={{ borderBottom:`1px solid ${C.border}` }}>
                  <SecHeader id="pending" label="Pending Approval" count={pendingMine.length} accent="#E87722"/>
                  {isOpen("pending") && <div>
                    {pendingMine.length===0
                      ? <div style={emptyStyle}>No pending requests</div>
                      : pendingMine.map(req=>(
                        <div key={req.id} style={rowStyle}>
                          <Thumb item={req.item}/>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:13, color:C.text }}>{req.item?.title}</div>
                            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{req.item?.owner} · {req.dateStr}</div>
                            <div style={{ fontSize:11, color:"#E87722", fontWeight:600, marginTop:2 }}>Awaiting owner acceptance</div>
                            {req.payment_status==='paid'
                              ? <button onClick={()=>handleRefundRequest(req)} style={{ marginTop:8, padding:"5px 12px", borderRadius:8, border:"1px solid #FA3E3E", background:C.bg, color:"#FA3E3E", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Cancel & Get Refund</button>
                              : <button onClick={()=>handleCancelRequest(req)} style={{ marginTop:8, padding:"5px 12px", borderRadius:8, border:"1px solid #FA3E3E", background:C.bg, color:"#FA3E3E", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Cancel Request</button>
                            }
                          </div>
                        </div>
                      ))}
                  </div>}
                </div>

              </div>
            );
          })()}

          {/* (Manage sub-tab removed — booking management is now in the listing detail sheet) */}
          {false && (()=>{
            if (myListings.length === 0) return (
              <div style={{ textAlign:"center", padding:"80px 32px" }}>
                <div style={{ width:80, height:80, borderRadius:"50%", background:darkMode?"#1C1C1E":"#F2F2F7", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}><Package size={38} strokeWidth={1.5} color="#00B894"/></div>
                <div style={{ fontWeight:700, fontSize:20, color:C.text, marginBottom:8 }}>No Listings Yet</div>
                <div style={{ fontSize:15, color:C.muted, lineHeight:1.5 }}>Add a listing and it will appear here.</div>
              </div>
            );
            return (
              <div style={{ display:"flex", flexDirection:"column", paddingBottom:20 }}>
                {myListings.map(listing => {
                  const bookings = bookingsByTitle[listing.title] || [];
                  const imgUrl = thumbSrc(listing.uploadedImages?.[0]);
                  return (
                    <div key={listing.id} style={{ margin:"12px 16px 0", borderRadius:14, border:`1px solid ${C.border}`, overflow:"hidden", background:C.card }}>
                      {/* Item header */}
                      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderBottom:`1px solid ${C.border}`, background:C.bg }}>
                        <div style={{ width:40, height:40, borderRadius:10, background:(listing.color||"#00B894")+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0, overflow:"hidden" }}>
                          {imgUrl ? <img src={imgUrl} alt="" style={{width:40,height:40,objectFit:"cover"}}/> : listing.emoji}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:14, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{listing.title}</div>
                          <div style={{ fontSize:11, color: listing.available ? "#31A24C" : "#FA3E3E", fontWeight:600, marginTop:1 }}>{listing.available ? "Available" : "Unavailable"}</div>
                        </div>
                        <div style={{ fontSize:11, color:C.muted, flexShrink:0 }}>{bookings.length > 0 ? `${bookings.length} booking${bookings.length>1?"s":""}` : "No bookings"}</div>
                      </div>
                      {/* Empty state */}
                      {bookings.length === 0 && (
                        <div style={{ padding:"14px 16px", fontSize:13, color:C.faint, textAlign:"center" }}>No active transactions</div>
                      )}
                      {/* Bookings list */}
                      {bookings.map(req => {
                        const days = daysUntilStart(req);
                        const isPending = req.status === 'pending';
                        const isConfirmed = req.status === 'confirmed';
                        const statusColor = isPending ? "#E87722" : isConfirmed ? "#007AFF" : "#00B894";
                        const statusLabel = isPending ? "Pending" : isConfirmed ? "Confirmed" : "Accepted";
                        return (
                          <div key={req.id} style={{ padding:"12px 14px", borderBottom:`1px solid ${C.borderFaint}` }}>
                            <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:700, fontSize:13, color:C.text }}>{req.renterName}</div>
                                <div style={{ fontSize:12, color:C.muted, marginTop:1 }}>📅 {req.dateStr || "Dates TBD"}</div>
                                <div style={{ fontSize:12, marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                                  {req.wantsDelivery
                                    ? <span style={{ color:"#00B894", fontWeight:600 }}>📦 Delivery</span>
                                    : <span style={{ color:C.muted }}>🤝 Pickup</span>}
                                  <span style={{ color:statusColor, fontWeight:600, fontSize:11, background:statusColor+"18", borderRadius:6, padding:"1px 6px" }}>{statusLabel}</span>
                                </div>
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                              {isConfirmed && (
                                <button onClick={async () => {
                                  const svc = item?.listingType === "service";
                                  if (!window.confirm(`Mark ${req.renterName}'s ${svc ? `${item?.title} service as complete` : `rental of ${item?.title} as returned`}?`)) return;
                                  if (req.dbId) await supabase.from('booking_requests').update({ status: 'completed' }).eq('id', req.dbId);
                                  setBookingRequests(prev => prev.map(r => r.id === req.id ? {...r, status:'completed'} : r));
                                  showToast(svc ? "Marked as complete!" : "Marked as returned — item is available again!");
                                }} style={{ padding:"5px 12px", borderRadius:8, border:"none", background:"#00B894", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                  {item?.listingType === "service" ? "✓ Mark Complete" : "✓ Mark Returned"}
                                </button>
                              )}
                              {!isPending && !isPastTransaction(req) && (
                                <button onClick={()=>{ const isPaid=req.payment_status==='paid'; if(!window.confirm(`Cancel ${req.renterName}'s transaction?${isPaid?' A full refund will be issued to them.':' They will be notified.'}`)) return; handleOwnerCancelBooking(req); }} style={{ padding:"5px 12px", borderRadius:8, border:"1px solid #FA3E3E", background:C.bg, color:"#FA3E3E", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                  {req.payment_status==='paid' ? 'Cancel & Refund' : 'Cancel'}
                                </button>
                              )}
                              <button onClick={async ()=>{
                                let convo = messages.find(m => m.otherUserId === req.renterId && m.item === req.item?.title);
                                if (!convo) {
                                  const { data: rows } = await supabase.from('messages').select('*').eq('listing_title', req.item?.title).or(`from_user_id.eq.${req.renterId},to_user_id.eq.${req.renterId}`).order('created_at', { ascending: true });
                                  if (rows && rows.length > 0) {
                                    const convId = rows[0].conversation_id;
                                    const thread = rows.map(r => ({ mine: r.from_user_id === user?.id, text: r.content, image: r.image_url || null, time: new Date(r.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), created_at: r.created_at }));
                                    convo = { id: Date.now(), conversation_id: convId, from: req.renterName, fromId: req.renterId, otherUserId: req.renterId, avatarUrl: rows.find(r => r.from_user_id === req.renterId)?.from_avatar || null, item: req.item?.title||'', sub: req.dateStr, time: rows[rows.length-1].created_at, unread: false, thread };
                                    setMessages(prev => { const ex = prev.find(m => m.otherUserId === req.renterId && m.item === req.item?.title); return ex ? prev.map(m => m === ex ? convo : m) : [...prev, convo]; });
                                  } else {
                                    convo = { id: Date.now(), conversation_id: `conv_req_${req.dbId||req.id}`, from: req.renterName, fromId: req.renterId, otherUserId: req.renterId, item: req.item?.title||'', sub: req.dateStr, time:"Just now", unread:false, thread:[] };
                                    setMessages(prev=>[...prev, convo]);
                                  }
                                } else { markConvoRead(convo); }
                                setActiveConvo(convo);
                              }} style={{ padding:"5px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                Message
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {tab==="messages" && isDesktop && (
        <div style={{ display:"flex", minHeight:"calc(100vh - 64px)", animation:"tabFadeIn 0.2s ease" }}>
          {/* Desktop conversation list — flush to left */}
          <div style={{ width:280, flexShrink:0, background:C.bg, borderRight:`1px solid ${C.border}`, height:"calc(100vh - 64px)", overflowY:"auto", display:"flex", flexDirection:"column" }}>
            <div style={{ padding:"16px 16px 12px", borderBottom:`1px solid ${C.border}`, fontWeight:900, fontSize:18, color:"#00B894", flexShrink:0 }}>Messages</div>
            {!user && <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted, fontSize:13 }}>Sign in to view messages</div>}
            {user && orphanOwnerReqs.map(req=>(
              <div key={`req-${req.id}`} onClick={()=>openRequestConvo(req)}
                style={{ padding:"12px 16px", borderBottom:`1px solid ${C.borderFaint}`, display:"flex", gap:10, cursor:"pointer", alignItems:"center", background:C.card }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"#FFF4E6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>👽</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{req.renterName}</div>
                  <div style={{ fontSize:11, color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{req.item?.title}</div>
                </div>
                <span style={{ fontSize:10, fontWeight:700, color:"#E87722", background:"#FFF4E6", borderRadius:6, padding:"1px 6px", flexShrink:0 }}>Request</span>
              </div>
            ))}
            {user && [...visibleMessages].sort((a,b)=>convoTs(b)-convoTs(a)).map(m=>(
              <div key={m.id}
                onMouseEnter={()=>setConvoDeleteId(m.id)}
                onMouseLeave={()=>setConvoDeleteId(null)}
                onClick={()=>{ setActiveConvo(m); markConvoRead(m); }}
                style={{ padding:"12px 16px", borderBottom:`1px solid ${C.borderFaint}`, display:"flex", gap:10, cursor:"pointer", alignItems:"center", background:activeConvo?.id===m.id?(darkMode?"#0D2E26":"#E8FBF6"):C.card, position:"relative" }}>
                {(() => { const t = convoThumb(m); return (
                <div style={{ width:44, height:44, borderRadius:12, background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0, overflow:"hidden" }}>
                  {t?.url ? <img src={t.url} alt="" style={{ width:44, height:44, objectFit:"cover" }}/>
                    : t?.emoji ? t.emoji
                    : m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width:44, height:44, borderRadius:"50%", objectFit:"cover" }}/> : "👽"}
                </div>
                ); })()}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:m.unread?700:600, fontSize:13.5, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.item || m.from}</div>
                  {m.item && <div style={{ fontSize:11.5, color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:1 }}>{m.from}</div>}
                </div>
                {convoDeleteId===m.id
                  ? <button onClick={e=>{ e.stopPropagation(); deleteConversation(m); }} style={{ background:"#FA3E3E", border:"none", borderRadius:6, padding:"4px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer", flexShrink:0 }}>Delete</button>
                  : pendingReqForConvo(m)
                    ? <span style={{ fontSize:10, fontWeight:700, color:"#E87722", background:"#FFF4E6", borderRadius:6, padding:"1px 6px", flexShrink:0 }}>Request</span>
                    : m.unread && <div style={{ width:8, height:8, borderRadius:"50%", background:"#00B894", flexShrink:0 }}/>
                }
              </div>
            ))}
          </div>
          {/* Desktop chat panel (right) */}
          <div style={{ flex:1, minWidth:0 }}>
            {activeConvo
              ? <ChatView activeConvo={activeConvo} setActiveConvo={setActiveConvo} chatMsg={chatMsg} setChatMsg={setChatMsg} messages={messages} setMessages={setMessages} msgEndRef={msgEndRef} user={user} onSend={handleSendMessage} isDesktop={true} profilePhotoUrl={profilePhotoUrl} onReport={()=>openReport(activeConvo?.otherUserId, activeConvo?.from, 'message')} isBlocked={blocks.includes(activeConvo?.otherUserId)} onBlock={()=>blockUser(activeConvo?.otherUserId)} onUnblock={()=>unblockUser(activeConvo?.otherUserId)} darkMode={darkMode} bookingRequests={bookingRequests} onAccept={handleAcceptRequest} onDecline={handleDeclineRequest} onCheckout={handleChatCheckout} onCancelRequest={handleCancelRequest} onOwnerCancel={handleOwnerCancelBooking} onAcceptOffer={handleAcceptOffer} onDeclineOffer={handleDeclineOffer} allItems={allItems}/>
              : <div style={{ height:"calc(100vh - 64px)", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:C.muted, gap:12 }}>
                  <MessageCircle size={52} strokeWidth={1.5} color={C.faint}/>
                  <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Select a conversation</div>
                  <div style={{ fontSize:13 }}>Choose from your messages on the left</div>
                </div>
            }
          </div>
        </div>
      )}

      {tab==="messages" && !activeConvo && !isDesktop && (
        <div style={{ background:C.bg, minHeight:"100vh", animation:"tabFadeIn 0.2s ease" }}>
          {/* Apple Messages-style header */}
          <div style={{ background: darkMode?"rgba(0,0,0,0.95)":"rgba(255,255,255,0.95)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderBottom:`0.5px solid ${C.borderFaint}`, position:"sticky", top:0, zIndex:40, paddingTop: "env(safe-area-inset-top,0px)" }}>
            <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", padding:"12px 16px 8px", position:"relative" }}>
              <div style={{ position:"absolute", left:0, right:0, textAlign:"center", fontSize:20, fontWeight:900, color:C.text, pointerEvents:"none" }}>Messages</div>
              <div style={{ display:"flex", gap:10, alignItems:"center", paddingBottom:4 }}>
                {user && inboxEditMode && <button onClick={clearAllConversations} style={{ background:"none", border:"none", color:"#FA3E3E", fontSize:15, fontWeight:600, cursor:"pointer", padding:0 }}>Clear</button>}
                {user && visibleMessages.length > 0 && (
                  <button onClick={()=>{ setInboxEditMode(e=>!e); setConvoDeleteId(null); }} style={{ background:"none", border:"none", color:"#007AFF", fontSize:15, fontWeight:600, cursor:"pointer", padding:0 }}>
                    {inboxEditMode ? "Done" : "Edit"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {!user && (
            <div style={{ padding:"60px 24px 40px", textAlign:"center" }}>
              <div style={{ width:72, height:72, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}><MessageCircle size={34} strokeWidth={1.5} color="#00B894"/></div>
              <div style={{ fontSize:20, fontWeight:700, color:C.text, marginBottom:8 }}>Your Messages</div>
              <div style={{ fontSize:15, color:C.muted, marginBottom:28, lineHeight:1.6 }}>Sign in to message owners and manage your transactions.</div>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:14, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:16, cursor:"pointer", background:"#007AFF", color:"#fff" }}>Sign In</button>
            </div>
          )}

          {user && visibleMessages.length===0 && orphanOwnerReqs.length===0 && (
            <div style={{ textAlign:"center", padding:"80px 32px" }}>
              <div style={{ width:80, height:80, borderRadius:"50%", background: darkMode?"#1C1C1E":"#F2F2F7", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}><MessageCircle size={38} strokeWidth={1.5} color="#00B894"/></div>
              <div style={{ fontWeight:700, fontSize:20, color:C.text, marginBottom:8 }}>No Messages</div>
              <div style={{ fontSize:15, color:C.muted, lineHeight:1.5 }}>Browse listings and contact owners to start a conversation.</div>
            </div>
          )}

          {/* Conversation list — Apple Messages style */}
          {user && (visibleMessages.length > 0 || orphanOwnerReqs.length > 0) && (
            <div style={{ background:C.bg }}>
              {/* Incoming requests without a conversation yet */}
              {orphanOwnerReqs.map(req=>(
                <div key={`req-${req.id}`} onClick={()=>{ if(!inboxEditMode) openRequestConvo(req); }} style={{ position:"relative", background:C.bg, display:"flex", alignItems:"center", cursor:"pointer", paddingRight:16 }}>
                  <div style={{ width:20, flexShrink:0, display:"flex", justifyContent:"center" }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:"#E87722" }}/>
                  </div>
                  <div style={{ width:52, height:52, borderRadius:"50%", background: darkMode?"#2C2C2E":"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0, overflow:"hidden", marginRight:12 }}>👽</div>
                  <div style={{ flex:1, minWidth:0, paddingTop:13, paddingBottom:13, borderBottom:`0.5px solid ${C.borderFaint}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:3 }}>
                      <div style={{ fontWeight:600, fontSize:17, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, marginRight:8 }}>{req.renterName}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:"#E87722", background:"#FFF4E6", borderRadius:6, padding:"1px 6px" }}>Request</span>
                        <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </div>
                    <div style={{ fontSize:15, color:C.muted, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{req.item?.title} · {req.dateStr}</div>
                  </div>
                </div>
              ))}
              {[...visibleMessages].sort((a,b)=>convoTs(b)-convoTs(a)).map((m,idx,arr)=>{
                const timeStr = typeof m.time==="string"&&m.time.includes("T")
                  ? new Date(m.time).toLocaleDateString([],{month:"short",day:"numeric"})
                  : m.time;
                const lastText = m.thread?.[m.thread.length-1]?.text || m.from || "";
                const isLast = idx===arr.length-1;
                const hasPendingReq = !!pendingReqForConvo(m);
                return (
                  <div key={m.id} style={{ position:"relative", background:C.bg, display:"flex", alignItems:"center", cursor:"pointer", userSelect:"none", paddingRight:16 }}
                    onClick={()=>{ if(inboxEditMode) return; setActiveConvo(m); markConvoRead(m); }}>
                    {inboxEditMode && (
                      <button onClick={e=>{ e.stopPropagation(); deleteConversation(m); }}
                        style={{ width:28, height:28, borderRadius:"50%", background:"#FA3E3E", border:"none", color:"#fff", fontSize:20, lineHeight:"28px", textAlign:"center", cursor:"pointer", flexShrink:0, marginLeft:12 }}>−</button>
                    )}
                    {/* Unread dot */}
                    <div style={{ width:20, flexShrink:0, display:"flex", justifyContent:"center" }}>
                      {(m.unread||hasPendingReq) && <div style={{ width:10, height:10, borderRadius:"50%", background:hasPendingReq?"#E87722":"#007AFF" }}/>}
                    </div>
                    {/* Avatar — item photo for listing threads */}
                    {(() => { const t = convoThumb(m); return (
                    <div style={{ width:52, height:52, borderRadius:14, background: darkMode?"#2C2C2E":"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0, overflow:"hidden", marginRight:12 }}>
                      {t?.url ? <img src={t.url} alt="" style={{ width:52, height:52, objectFit:"cover" }}/>
                        : t?.emoji ? t.emoji
                        : m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width:52, height:52, borderRadius:"50%", objectFit:"cover" }}/> : "👽"}
                    </div>
                    ); })()}
                    {/* Text block — border starts here like iPhone */}
                    <div style={{ flex:1, minWidth:0, paddingTop:13, paddingBottom:13, borderBottom: isLast ? "none" : `0.5px solid ${C.borderFaint}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:3 }}>
                        <div style={{ fontWeight:(m.unread||hasPendingReq)?600:400, fontSize:17, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, marginRight:8 }}>{m.item || m.from}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                          {hasPendingReq && <span style={{ fontSize:11, fontWeight:700, color:"#E87722", background:"#FFF4E6", borderRadius:6, padding:"1px 6px" }}>Request</span>}
                          <span style={{ fontSize:13, color:C.faint }}>{timeStr}</span>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                      </div>
                      <div style={{ fontSize:15, color:C.muted, fontWeight:m.unread?600:400, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{lastText}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ position:"fixed", top: isDesktop ? 64 : 0, bottom: isDesktop ? 0 : 84, left:0, right:0, zIndex:10, visibility: tab==="map" ? "visible" : "hidden", pointerEvents: tab==="map" ? "auto" : "none" }}>
        <MapView
          items={filtered}
          centerCoords={centerCoords}
          radius={radius}
          onRadiusChange={setRadius}
          onMoveCenter={handleMapMoveCenter}
          onSelectItem={item => setSelectedItem(item)}
          visible={tab==="map"}
          darkMode={darkMode}
        />
      </div>

      {tab==="profile" && (
        <div style={{ width:"100%", background:C.bg, minHeight:"100dvh", animation:"tabFadeIn 0.2s ease" }}>
          <div style={{ background:C.bg, padding:"14px 16px 0", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#00B894", paddingBottom:12 }}>Profile</div>
            {user && (
              <div style={{ display:"flex", gap:0 }}>
                {[["profile","Profile"],["settings","Settings"],...(isAdmin?[["admin","⚙️ Admin"]]:[])]
                  .map(([key,label])=>(
                  <button key={key} onClick={()=>setProfileSubTab(key)} style={{ flex:1, padding:"8px 0", background:"none", border:"none", fontFamily:"inherit", fontWeight:700, fontSize:13, cursor:"pointer", color:profileSubTab===key?"#00B894":C.muted, borderBottom:profileSubTab===key?"2.5px solid #00B894":"2.5px solid transparent", transition:"all 0.15s" }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px" }}>
              <div style={{ width:80, height:80, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, margin:"0 auto 16px" }}>👤</div>
              <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:8 }}>Join Lendie</div>
              <div style={{ fontSize:13, color:C.muted, marginBottom:28, lineHeight:1.6 }}>Sign up to list items, save favorites, and connect with neighbors.</div>
              <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }}>Create account</button>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:C.card, color:C.text }}>Sign in</button>
            </div>
          )}
          {user && profileSubTab === "settings" && (
            <div style={{ display:"flex", flexDirection:"column" }}>
              {/* Appearance */}
              <div style={{ borderBottom:`1px solid ${C.border}` }}>
                <div style={{ padding:"14px 16px", background:C.bg }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#00B894", textTransform:"uppercase", letterSpacing:"0.5px", textAlign:"center" }}>Appearance</div>
                </div>
                <div style={{ padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", background:C.bg }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Dark Mode</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{darkMode ? "Dark theme enabled" : "Light theme enabled"}</div>
                  </div>
                  <button
                    onClick={() => setDarkMode(d => !d)}
                    style={{ flexShrink:0, width:50, height:28, borderRadius:14, border:"none", cursor:"pointer", background: darkMode ? "#00B894" : "#CDD0D4", position:"relative", transition:"background 0.2s" }}
                  >
                    <span style={{ position:"absolute", top:3, left: darkMode ? 25 : 3, width:22, height:22, borderRadius:"50%", background:"#fff", boxShadow:"0 1px 4px rgba(0,0,0,0.2)", transition:"left 0.2s" }}/>
                  </button>
                </div>
              </div>
              {/* Notifications */}
              <div style={{ borderBottom:`1px solid ${C.border}` }}>
                <div style={{ padding:"14px 16px", background:C.bg }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#00B894", textTransform:"uppercase", letterSpacing:"0.5px", textAlign:"center" }}>Notifications</div>
                </div>
                <div style={{ padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", background:C.bg }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Push Notifications</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:2, lineHeight:1.4 }}>
                      {notifPermission === 'denied'
                        ? "Blocked in browser settings — allow them in Site Settings to enable."
                        : pushEnabled
                          ? "You'll get notified about transactions and messages."
                          : "Get notified about transactions and messages."}
                    </div>
                  </div>
                  <button
                    disabled={togglingPush || notifPermission === 'denied'}
                    onClick={togglePushNotifications}
                    style={{
                      flexShrink:0, width:50, height:28, borderRadius:14, border:"none", cursor: notifPermission==='denied'||togglingPush ? "not-allowed" : "pointer",
                      background: pushEnabled ? "#00B894" : "#CDD0D4",
                      position:"relative", transition:"background 0.2s", opacity: notifPermission==='denied' ? 0.5 : 1,
                    }}
                  >
                    <span style={{ position:"absolute", top:3, left: pushEnabled ? 25 : 3, width:22, height:22, borderRadius:"50%", background:"#fff", boxShadow:"0 1px 4px rgba(0,0,0,0.2)", transition:"left 0.2s" }}/>
                  </button>
                </div>
              </div>
              {/* Account */}
              <div style={{ borderBottom:`1px solid ${C.border}` }}>
                <div style={{ padding:"14px 16px", background:C.bg }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#00B894", textTransform:"uppercase", letterSpacing:"0.5px", textAlign:"center" }}>Account</div>
                </div>
                <div style={{ padding:"4px 0", background:C.bg }}>
                  <button onClick={()=>setShowSecurityModal(true)} style={{ width:"100%", padding:"14px 16px", textAlign:"left", background:"none", border:"none", fontFamily:"inherit", fontWeight:600, fontSize:15, cursor:"pointer", color:C.text }}>
                    Login & Security
                  </button>
                  <div style={{ height:1, background:C.borderFaint, margin:"0 16px" }}/>
                  <button onClick={async()=>{ await supabase.auth.signOut(); }} style={{ width:"100%", padding:"14px 16px", textAlign:"left", background:"none", border:"none", fontFamily:"inherit", fontWeight:600, fontSize:15, cursor:"pointer", color:"#FA3E3E" }}>
                    Sign Out
                  </button>
                  <div style={{ height:1, background:C.borderFaint, margin:"0 16px" }}/>
                  <button onClick={()=>setShowDeleteAccountModal(true)} style={{ width:"100%", padding:"14px 16px", textAlign:"left", background:"none", border:"none", fontFamily:"inherit", fontWeight:600, fontSize:15, cursor:"pointer", color:C.faint }}>
                    Delete Account
                  </button>
                </div>
              </div>
            </div>
          )}
          {user && profileSubTab === "profile" && (
            <>
              {/* Avatar + name */}
              <div style={{ background:C.bg, padding:"32px 16px 24px", textAlign:"center", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ position:"relative", width:80, height:80, margin:"0 auto 14px" }}>
                  <label style={{ cursor:"pointer", display:"block", width:80, height:80, borderRadius:"50%", overflow:"hidden" }}>
                    {profilePhotoUrl
                      ? <img src={profilePhotoUrl} alt="Profile" style={{ width:80, height:80, objectFit:"cover" }}/>
                      : <div style={{ width:80, height:80, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44 }}>
                          👽
                        </div>
                    }
                    <input type="file" accept="image/*" style={{ display:"none" }} onChange={handleProfilePhotoUpload}/>
                  </label>
                  <div style={{ position:"absolute", bottom:0, right:0, background:"#00B894", borderRadius:"50%", width:26, height:26, display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid #fff", pointerEvents:"none" }}><Camera size={13} strokeWidth={2} color="#fff"/></div>
                </div>
                <div style={{ fontSize:20, fontWeight:800, color:C.text }}>{user.user_metadata?.name || "Lendie User"}</div>
                <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{user.email}</div>
                {(() => {
                  const totalReviews = myListings.reduce((s, l) => s + (l.reviews || 0), 0);
                  const avgRating = totalReviews > 0
                    ? Math.round(myListings.reduce((s, l) => s + (l.rating || 0) * (l.reviews || 0), 0) / totalReviews * 10) / 10
                    : null;
                  return avgRating
                    ? <div style={{ marginTop:6, display:"flex", justifyContent:"center" }}><StarRow rating={avgRating} count={totalReviews} size={14} darkMode={darkMode}/></div>
                    : <div style={{ fontSize:11, color:C.faint, marginTop:6 }}>No reviews yet</div>;
                })()}
                <div style={{ fontSize:11, color:"#8A8D91", marginTop:4 }}>Tap photo to change</div>
              </div>
              {/* Performance stats */}
              {(()=>{
                const totalViews = myListings.reduce((s,l)=>s+(l.views||0),0);
                const totalRentals = bookingRequests.filter(r=>r.ownerId===user.id&&r.status==="accepted").length;
                const totalReviews = myListings.reduce((s,l)=>s+(l.reviews||0),0);
                const avgRating = totalReviews>0 ? (myListings.reduce((s,l)=>s+(l.rating||0)*(l.reviews||0),0)/totalReviews).toFixed(1) : null;
                const stats = [
                  ["Views", totalViews],
                  ["Rentals", totalRentals],
                  [avgRating ? "Rating" : "Reviews", avgRating ? `${avgRating}★` : totalReviews],
                ];
                return (
                  <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, background:C.bg }}>
                    {stats.map(([label,val],i,arr)=>(
                      <div key={label} style={{ flex:1, padding:"14px 8px", textAlign:"center", borderRight:i<arr.length-1?`1px solid ${C.border}`:"none" }}>
                        <div style={{ fontSize:22, fontWeight:800, color:"#00B894" }}>{val}</div>
                        <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {/* Accordion activity sections */}
              {(()=>{
                return (
                  <div style={{ display:"flex", flexDirection:"column" }}>

                    {/* Payouts — only visible when Stripe is configured */}
                    {STRIPE_KEY && (()=>{
                      // toggleSec/isOpen are scoped to the My Items IIFE above, not here —
                      // redefine locally so the (now-active) Payouts accordion doesn't ReferenceError.
                      const toggleSec = id => setOpenSections(prev=>({...prev,[id]:!prev[id]}));
                      const isOpen = id => openSections[id] === undefined ? id==="mylistings" : !!openSections[id];
                      const myPaid = bookingRequests.filter(r => r.ownerId === user.id && r.payment_status === 'paid');
                      // Prefer the exact stored owner cut; fall back to the legacy
                      // approximation (4% owner fee out of an 8%-loaded total) for
                      // bookings paid before payout_amount_cents was recorded.
                      // Legacy fallback for rows missing payout_amount_cents. The charge is
                      // rental×1.08 + delivery; the owner gets rental×0.96 + delivery, so the
                      // delivery must pass through whole (not shrunk by the rental fee ratio).
                      const ownerShare = r => {
                        const c = r.stripe_amount_cents || 0;
                        const delivCents = r.wantsDelivery ? Math.round((Number(r.deliveryFee) || 0) * 100) : 0;
                        const rentalLoaded = Math.max(0, c - delivCents);
                        return Math.round(rentalLoaded * 0.96 / 1.08) + delivCents;
                      };
                      const payoutOf = r => (r.payout_amount_cents != null ? r.payout_amount_cents : ownerShare(r));
                      // Start of the selected period (calendar week starts Monday).
                      const rangeStart = (() => {
                        if (earningsRange === 'all') return 0;
                        const d = new Date();
                        if (earningsRange === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
                        else if (earningsRange === 'month') d.setDate(1);
                        else if (earningsRange === 'year') d.setMonth(0, 1);
                        d.setHours(0, 0, 0, 0);
                        return d.getTime();
                      })();
                      // "Earned" = payouts that actually left to the owner, dated by
                      // when the transfer was released (the true paid-out date).
                      const payoutDate = r => r.payout_released_at || r.payout_release_at || r.createdAt;
                      const earned = myPaid.filter(r => r.payout_status === 'released' && new Date(payoutDate(r)).getTime() >= rangeStart);
                      const totalCents = earned.reduce((s, r) => s + payoutOf(r), 0);
                      // Funds still held in the platform balance, not yet transferred.
                      const pendingRows = myPaid.filter(r => r.payout_status === 'pending');
                      const pendingCents = pendingRows.reduce((s, r) => s + payoutOf(r), 0);
                      const nextRelease = pendingRows.map(r => r.payout_release_at).filter(Boolean).sort()[0];
                      // Per-transaction pending breakdown; hpad matches the surrounding container's padding.
                      const pendingItems = (hpad) => pendingRows.map(r => (
                        <div key={r.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:`10px ${hpad}px`, borderBottom:`1px solid ${C.borderFaint}` }}>
                          <div style={{ minWidth:0, marginRight:10 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.item?.title || "Rental"}</div>
                            <div style={{ fontSize:11, color:C.muted, marginTop:1 }}>{r.payout_release_at ? `Releases ${new Date(r.payout_release_at).toLocaleDateString(undefined,{month:"short",day:"numeric"})}` : (r.dateStr && r.dateStr!=="Purchase" && !r.dateStr?.startsWith("Offer") ? r.dateStr : "Awaiting release")}</div>
                          </div>
                          <div style={{ fontSize:14, fontWeight:700, color:"#E87722", flexShrink:0 }}>${(payoutOf(r) / 100).toFixed(2)}</div>
                        </div>
                      ));
                      const RANGES = [['week','Week'],['month','Month'],['year','Year'],['all','All']];
                      const connectBadge = connectStatus?.chargesEnabled
                        ? { label:"Connected", bg:"#00B89418", color:"#00B894" }
                        : connectStatus?.connected
                          ? { label:"Pending", bg:"#E8772218", color:"#E87722" }
                          : { label:"Not set up", bg: darkMode ? "#3A3B3C" : "#F0F2F5", color:C.muted };
                      return (
                        <div style={{ borderBottom:`1px solid ${C.border}` }}>
                          <div onClick={()=>toggleSec("payouts")} style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", cursor:"pointer", userSelect:"none", background:C.bg }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontWeight:700, fontSize:14, color:C.text }}>Payouts</div>
                              {pendingCents > 0 && (
                                <div style={{ fontSize:11.5, color:"#E87722", fontWeight:600, marginTop:2 }}>
                                  ${(pendingCents / 100).toFixed(2)} pending{nextRelease ? ` · releases ${new Date(nextRelease).toLocaleDateString(undefined,{month:"short",day:"numeric"})}` : ""}
                                </div>
                              )}
                            </div>
                            <span style={{ background:connectBadge.bg, color:connectBadge.color, borderRadius:20, padding:"2px 9px", fontSize:12, fontWeight:700, flexShrink:0 }}>{connectBadge.label}</span>
                            <ChevronDown size={16} color="#8A8D91" style={{ transform:isOpen("payouts")?"rotate(180deg)":"none", transition:"transform 0.2s", flexShrink:0 }}/>
                          </div>
                          {isOpen("payouts") && (
                            <div>
                              {connectStatus?.chargesEnabled ? (
                                <>
                                  <div style={{ padding:"16px", borderBottom:`1px solid ${C.borderFaint}`, background:C.bg }}>
                                    {/* Time-range filter */}
                                    <div style={{ display:"flex", gap:4, background: darkMode ? "#2C2C2E" : "#F0F2F5", borderRadius:9, padding:3, marginBottom:14 }}>
                                      {RANGES.map(([val,label]) => (
                                        <button key={val} onClick={()=>setEarningsRange(val)}
                                          style={{ flex:1, padding:"6px 0", borderRadius:7, border:"none", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer", background: earningsRange===val ? (darkMode ? "#1C1C1E" : "#fff") : "transparent", color: earningsRange===val ? "#00B894" : C.muted, boxShadow: earningsRange===val ? "0 1px 2px rgba(0,0,0,0.12)" : "none", transition:"all 0.12s" }}>
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                    <div style={{ fontSize:11, color:C.muted, marginBottom:4, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.4px" }}>{earningsRange==='all'?'Total earned':earningsRange==='year'?'Earned this year':earningsRange==='month'?'Earned this month':'Earned this week'}</div>
                                    <div style={{ fontSize:28, fontWeight:900, color:"#00B894" }}>${(totalCents / 100).toFixed(2)}</div>
                                    <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{earned.length} payout{earned.length !== 1 ? "s" : ""} · after platform fee</div>
                                  </div>
                                  {/* Pending payouts — held in escrow until 24h after each rental begins */}
                                  {pendingCents > 0 && (
                                    <>
                                      <div style={{ padding:"14px 16px 8px", background:C.bg, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                                        <div>
                                          <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Pending payouts</div>
                                          <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                                            {pendingRows.length} booking{pendingRows.length !== 1 ? "s" : ""}{nextRelease ? ` · next releases ${new Date(nextRelease).toLocaleDateString(undefined,{month:"short",day:"numeric"})}` : ""}
                                          </div>
                                        </div>
                                        <div style={{ fontSize:16, fontWeight:800, color:"#E87722" }}>${(pendingCents / 100).toFixed(2)}</div>
                                      </div>
                                      <div style={{ background:C.bg }}>{pendingItems(16)}</div>
                                    </>
                                  )}
                                  {earned.slice(0, 5).map(r => (
                                    <div key={r.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"11px 16px", borderBottom:`1px solid ${C.borderFaint}`, background:C.bg }}>
                                      <div>
                                        <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{r.item?.title || "Rental"}</div>
                                        <div style={{ fontSize:11, color:C.muted, marginTop:1 }}>Paid out {new Date(payoutDate(r)).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</div>
                                      </div>
                                      <div style={{ fontSize:14, fontWeight:700, color:"#00B894" }}>+${(payoutOf(r) / 100).toFixed(2)}</div>
                                    </div>
                                  ))}
                                  {earned.length === 0 && <div style={{ padding:"14px 16px", fontSize:13, color:C.faint, textAlign:"center", background:C.bg }}>No payouts {earningsRange==='all'?'yet':'in this period'}</div>}
                                  <button onClick={openStripeDashboard} style={{ width:"100%", padding:"13px 16px", textAlign:"center", background:"none", border:"none", fontFamily:"inherit", fontSize:13, color:"#00B894", fontWeight:700, cursor:"pointer" }}>
                                    View Stripe Dashboard →
                                  </button>
                                </>
                              ) : (
                                <div style={{ padding:"16px", background:C.bg }}>
                                  {pendingCents > 0 && (
                                    <div style={{ display:"flex", alignItems:"center", gap:8, background: darkMode?"#3A2A12":"#FFF4E6", border:`1px solid ${darkMode?"#5A3A12":"#FFE0B2"}`, borderRadius:10, padding:"11px 12px", marginBottom:14 }}>
                                      <DollarSign size={16} strokeWidth={2.25} color="#E87722" style={{ flexShrink:0 }}/>
                                      <div style={{ fontSize:12.5, color:C.text, lineHeight:1.4 }}><strong style={{ color:"#E87722" }}>${(pendingCents / 100).toFixed(2)}</strong> is waiting for you — finish setup to receive it.</div>
                                    </div>
                                  )}
                                  {pendingCents > 0 && (
                                    <div style={{ marginBottom:14 }}>
                                      <div style={{ fontSize:11, color:C.muted, marginBottom:2, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.4px" }}>Pending breakdown</div>
                                      {pendingItems(0)}
                                    </div>
                                  )}
                                  <div style={{ fontSize:13, color:C.muted, lineHeight:1.6, marginBottom:14 }}>
                                    {connectStatus?.connected
                                      ? "Complete your Stripe verification to start receiving payments directly to your bank or debit card."
                                      : "Connect a bank account or debit card to receive payments. Stripe handles all verification and transfers."}
                                  </div>
                                  <button onClick={setupStripeConnect} style={{ width:"100%", padding:"12px", borderRadius:10, border:"none", background:"#00B894", color:"#fff", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                                    {connectStatus?.connected ? "Continue Setup" : "Set Up Payouts"}
                                  </button>
                                  <div style={{ fontSize:11, color:C.faint, lineHeight:1.5, marginTop:10, textAlign:"center" }}>
                                    Payouts are securely powered by <strong style={{ color:C.muted }}>Stripe</strong>. Lendie never sees your bank details. By continuing you agree to Stripe's <a href="https://stripe.com/connect-account/legal" target="_blank" rel="noopener noreferrer" style={{ color:"#00B894", textDecoration:"underline" }}>Connected Account Agreement</a>.
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                );
              })()}
              {/* Sign out */}
              <div style={{ display:"flex", flexDirection:"column", paddingBottom:40 }}>
                <button onClick={async()=>{ await supabase.auth.signOut(); }} style={{ width:"100%", padding:"16px", border:"none", borderBottom:`1px solid ${C.border}`, fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:C.bg, color:"#FA3E3E" }}>Sign Out</button>
                <button onClick={()=>{ const subject=encodeURIComponent('Lendie Feedback'); const body=encodeURIComponent(`\n\n— Sent from ${user?.email||'Lendie'} · v${typeof __BUILD_TS__ !== 'undefined' ? __BUILD_TS__ : 'dev'}`); window.location.href=`mailto:support@lendie.app?subject=${subject}&body=${body}`; }} style={{ width:"100%", padding:"16px", border:"none", borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:C.bg, color:"#00B894" }}>Give Feedback</button>
                <button onClick={()=>setShowDeleteAccountModal(true)} style={{ width:"100%", padding:"14px", border:"none", fontFamily:"inherit", fontWeight:600, fontSize:13, cursor:"pointer", background:C.bg, color:"#8A8D91" }}>Delete Account</button>
                <div style={{ display:"flex", justifyContent:"center", gap:16, paddingTop:12 }}>
                  <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:C.muted, textDecoration:"none" }}>Privacy Policy</a>
                  <span style={{ fontSize:12, color:C.borderFaint }}>·</span>
                  <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:C.muted, textDecoration:"none" }}>Terms of Service</a>
                </div>
                <div style={{ textAlign:"center", fontSize:11, color:C.faint, paddingTop:8 }}>Version {typeof __BUILD_TS__ !== 'undefined' ? __BUILD_TS__ : 'dev'}</div>
                <button onClick={async()=>{
                  showToast('Checking for updates…');
                  try {
                    const reg = await navigator.serviceWorker?.getRegistration();
                    await reg?.update();
                    setTimeout(()=>showToast("You're on the latest version"), 4000);
                  } catch { showToast('Update check failed', 'error'); }
                }} style={{ background:"none", border:"none", color:"#00B894", fontSize:12, fontWeight:600, cursor:"pointer", padding:"6px 0", fontFamily:"inherit" }}>Check for updates</button>
              </div>
            </>
          )}
          {user && profileSubTab === "admin" && isAdmin && (()=>{
            const totalListings = allItems.length;
            const activeListings = allItems.filter(x=>!x.hidden).length;
            const pendingReqs = bookingRequests.filter(r=>r.status==="pending").length;
            const totalReqs = bookingRequests.length;
            const recentListings = [...allItems].sort((a,b)=>(b.id||0)-(a.id||0)).slice(0,20);
            const recentBookings = [...bookingRequests].sort((a,b)=>b.id-a.id).slice(0,20);
            const aToggle = id => setAdminOpenSections(p=>({...p,[id]:!p[id]}));
            const aOpen = id => !!adminOpenSections[id];
            const AdminSection = ({ id, label, badge, children }) => (
              <div style={{ borderBottom:`1px solid ${C.border}` }}>
                <button onClick={()=>aToggle(id)} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                  <span style={{ fontWeight:700, fontSize:15, color:C.text }}>{label}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    {badge > 0 && <span style={{ background:"#00B894", color:"#fff", borderRadius:20, padding:"2px 8px", fontSize:11, fontWeight:800 }}>{badge}</span>}
                    <span style={{ color:C.muted, fontSize:20, lineHeight:1, display:"inline-block", transform:aOpen(id)?"rotate(180deg)":"rotate(0deg)", transition:"transform 0.2s" }}>⌄</span>
                  </div>
                </button>
                {aOpen(id) && <div style={{ borderTop:`1px solid ${C.border}` }}>{children}</div>}
              </div>
            );
            return (
              <div style={{ display:"flex", flexDirection:"column" }}>
                <AdminSection id="stats" label="Stats">
                  <div style={{ display:"flex", overflowX:"auto" }}>
                    {[
                      ["Total Listings", totalListings, "#00B894"],
                      ["Active", activeListings, "#3498DB"],
                      ["Pending Requests", pendingReqs, "#E87722"],
                      ["Total Bookings", totalReqs, "#9B59B6"],
                    ].map(([label,val,color])=>(
                      <div key={label} style={{ flex:"0 0 auto", minWidth:120, padding:"16px", borderRight:`1px solid ${C.border}` }}>
                        <div style={{ fontSize:26, fontWeight:900, color, lineHeight:1 }}>{val}</div>
                        <div style={{ fontSize:11, color:C.muted, fontWeight:600, marginTop:6 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </AdminSection>

                <AdminSection id="listings" label="Listings" badge={totalListings}>
                  {recentListings.map(item=>(
                    <div key={item.id} style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:36, height:36, borderRadius:8, background:(item.color||"#888")+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
                        {item.uploadedImages?.[0]?.url ? <img src={thumbSrc(item.uploadedImages[0])} alt="" style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }}/> : item.emoji}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
                        <div style={{ fontSize:11, color:C.muted }}>{item.owner} · ${item.price}/day{item.hidden?" · HIDDEN":""}</div>
                      </div>
                      <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                        <button onClick={async()=>{
                          await supabase.from('listings').update({ hidden: !item.hidden }).eq('id', item.id);
                          setMyListings(prev=>prev.map(l=>l.id===item.id?{...l,hidden:!l.hidden}:l));
                          showToast(item.hidden?"Listing visible":"Listing hidden");
                        }} style={{ fontSize:11, padding:"4px 10px", borderRadius:6, border:`1px solid ${C.border}`, background:"none", color:C.muted, cursor:"pointer", fontFamily:"inherit" }}>
                          {item.hidden?"Show":"Hide"}
                        </button>
                        <button onClick={async()=>{
                          if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
                          await supabase.from('listings').delete().eq('id', item.id);
                          setMyListings(prev=>prev.filter(l=>l.id!==item.id));
                          showToast("Listing deleted");
                        }} style={{ fontSize:11, padding:"4px 10px", borderRadius:6, border:"1px solid #FA3E3E44", background:"#FA3E3E18", color:"#FA3E3E", cursor:"pointer", fontFamily:"inherit" }}>Delete</button>
                      </div>
                    </div>
                  ))}
                  {recentListings.length === 0 && <div style={{ padding:24, textAlign:"center", color:C.muted, fontSize:13 }}>No listings yet</div>}
                </AdminSection>

                <AdminSection id="bookings" label="Bookings" badge={pendingReqs}>
                  {recentBookings.length === 0 && <div style={{ padding:24, textAlign:"center", color:C.muted, fontSize:13 }}>No bookings yet</div>}
                  {recentBookings.map(req=>(
                    <div key={req.id} style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{req.item?.title}</div>
                        <div style={{ fontSize:11, color:C.muted }}>{req.renterName} · {req.dateStr}</div>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:req.status==="accepted"?"#00B894":req.status==="pending"?"#E87722":req.status==="declined"?"#FA3E3E":"#888", background:req.status==="accepted"?"#00B89422":req.status==="pending"?"#E8772222":req.status==="declined"?"#FA3E3E22":"#88888822", borderRadius:20, padding:"3px 9px", flexShrink:0 }}>
                        {req.status}
                      </span>
                    </div>
                  ))}
                </AdminSection>
              </div>
            );
          })()}
        </div>
      )}

      <ItemDetailSheet
        item={selectedItem}
        bookingRequests={bookingRequests}
        user={user}
        favorites={favorites}
        toggleFav={toggleFav}
        allItems={allItems}
        OWNERS={OWNERS}
        setOwnerProfileId={setOwnerProfileId}
        setPhotoBrowser={setPhotoBrowser}
        onDismiss={()=>setSelectedItem(null)}
        setPaymentModal={setPaymentModal}
        setPaymentStep={setPaymentStep}
        isDesktop={isDesktop}
        darkMode={darkMode}
        onConfirmBooking={(s,e,delivery)=>{
          if (!s) return;
          if (!requireAuth()) return;
          handleDirectBookingRequest(selectedItem, s, e||s, !!delivery);
          setSelectedItem(null);
        }}
        onBuyRequest={(item)=>{ setSelectedItem(null); handleBuyRequest(item); }}
        onMakeOfferRequest={(item, amt)=>{ setSelectedItem(null); handleMakeOfferRequest(item, amt); }}
        onServiceRequest={(item, s, e)=>{ setSelectedItem(null); handleServiceRequest(item, s, e); }}
      />

      {/* Listing management sheet — opens when owner taps their own listing */}
      {managingListing && (()=>{
        const l = managingListing;
        const imgUrl = thumbSrc(l.uploadedImages?.[0]);
        const listingBookings = bookingRequests.filter(r => r.ownerId === user?.id && r.item?.title === l.title && r.status !== 'cancelled' && r.status !== 'declined' && r.status !== 'completed' && !(r.status === 'pending' && r.payment_status && r.payment_status !== 'paid'));
        const C2 = darkMode ? { bg:'#000', card:'#1C1C1E', border:'#2C2C2E', borderFaint:'#242426', text:'#F2F2F7', muted:'#AEAEB2', faint:'#8E8E93' } : { bg:'#fff', card:'#fff', border:'#E4E6EB', borderFaint:'#F0F2F5', text:'#1C1E21', muted:'#65676B', faint:'#8A8D91' };
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:200, display:"flex", alignItems:"flex-end" }} onClick={()=>setManagingListing(null)}>
            <div style={{ background:C2.card, borderRadius:"16px 16px 0 0", width:"100%", maxHeight:"90dvh", overflowY:"auto", padding:"20px 16px 48px" }} onClick={e=>e.stopPropagation()}>
              <div style={{ width:40, height:5, borderRadius:3, background:"#CDD0D4", margin:"0 auto 16px" }}/>
              {/* Header */}
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:16 }}>
                <div style={{ width:52, height:52, borderRadius:12, background:(l.color||"#00B894")+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0, overflow:"hidden" }}>
                  {imgUrl ? <img src={imgUrl} alt="" style={{width:52,height:52,objectFit:"cover"}}/> : l.emoji}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:800, fontSize:17, color:C2.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.title}</div>
                  <div style={{ fontSize:12, color: l.available ? "#31A24C" : "#FA3E3E", fontWeight:600, marginTop:2 }}>{l.available ? "● Live" : "● Paused"} · ${l.price}{l.listingType!=="sale" ? `/${l.priceUnit||"day"}` : ""}</div>
                </div>
              </div>
              {/* Actions */}
              <div style={{ display:"flex", gap:8, marginBottom:20 }}>
                <button onClick={()=>{ setEditingListing(l); setNewListing(l); setAddImages(l.uploadedImages||[]); setShowAddListing(true); setManagingListing(null); }} style={{ flex:1, padding:"10px 0", borderRadius:10, border:`1px solid ${C2.border}`, background:C2.card, color:C2.text, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Edit</button>
                <button onClick={async()=>{ const next=!l.available; const{error}=await supabase.from('listings').update({available:next}).eq('id',l.id); if(!error){setMyListings(prev=>prev.map(x=>x.id===l.id?{...x,available:next}:x)); setManagingListing(p=>({...p,available:next}));} }} style={{ flex:1, padding:"10px 0", borderRadius:10, border:`1px solid ${C2.border}`, background:C2.card, color:C2.text, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{l.available?"Pause":"Resume"}</button>
                <button onClick={()=>{ setDeletingId(l.id); setManagingListing(null); }} style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:"#FFF0F0", color:"#FA3E3E", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Delete</button>
              </div>
              {/* Bookings */}
              <div style={{ fontWeight:700, fontSize:14, color:C2.text, marginBottom:10 }}>Transactions</div>
              {listingBookings.length === 0
                ? <div style={{ padding:"20px", textAlign:"center", fontSize:13, color:C2.faint, background:C2.bg, borderRadius:12 }}>No active transactions</div>
                : listingBookings.map(req => {
                    const isPending = req.status === 'pending';
                    const isConfirmed = req.status === 'confirmed';
                    const statusColor = isPending ? "#E87722" : isConfirmed ? "#007AFF" : "#00B894";
                    const statusLabel = isPending ? "Pending" : isConfirmed ? "Confirmed" : "Accepted";
                    return (
                      <div key={req.id} style={{ background:C2.bg, borderRadius:12, padding:"12px 14px", marginBottom:8, border:`1px solid ${C2.border}` }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:14, color:C2.text }}>{req.renterName}</div>
                            <div style={{ fontSize:12, color:C2.muted, marginTop:1 }}>📅 {req.dateStr || "Dates TBD"}</div>
                            <div style={{ display:"flex", gap:6, marginTop:4, alignItems:"center" }}>
                              <span style={{ fontSize:12, color:req.wantsDelivery?"#00B894":C2.muted }}>{req.wantsDelivery?"📦 Delivery":"🤝 Pickup"}</span>
                              <span style={{ fontSize:11, fontWeight:700, color:statusColor, background:statusColor+"18", borderRadius:6, padding:"1px 6px" }}>{statusLabel}</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {isConfirmed && (()=>{
                            const isSale = req.dateStr === "Purchase" || req.dateStr?.startsWith("Offer");
                            const isSvc = req.item?.listingType === "service";
                            return (
                              <button onClick={async()=>{
                                if(!window.confirm(isSvc ? `Mark ${req.renterName}'s service as complete?` : isSale ? `Mark ${req.renterName}'s purchase as complete?` : `Mark ${req.renterName}'s rental as returned?`)) return;
                                if(req.dbId) await supabase.from('booking_requests').update({status:'completed'}).eq('id',req.dbId);
                                setBookingRequests(prev=>prev.map(r=>r.id===req.id?{...r,status:'completed'}:r));
                                if (req.renterId && req.renterId !== user?.id) {
                                  supabase.from('notifications').insert({ user_id: req.renterId, icon:"🎉", text: (isSvc?"Service complete: ":isSale?"Purchase complete: ":"Rental complete: ")+req.item?.title, sub:"Thanks for using Lendie — leave a review in My Items!", time_label:"Just now", unread:true, type:"confirm" }).then(({ error }) => { if (error) console.error('[Complete] notif failed:', error.message); });
                                  sendPushToUser(req.renterId, { title: isSvc?"Service complete!":isSale?"Purchase complete!":"Rental complete!", body:`${req.item?.title} — leave a review on Lendie`, url:'/?tab=listings', tag:`completed-${req.dbId||req.id}` });
                                }
                                showToast((isSale||isSvc) ? "Marked as complete!" : "Marked as returned!");
                                setManagingListing(null);
                              }} style={{ padding:"7px 14px", borderRadius:8, border:"none", background:"#00B894", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{isSale?"✓ Mark Complete":"✓ Mark Returned"}</button>
                            );
                          })()}
                          {!isPending && !isPastTransaction(req) && (
                            <button onClick={()=>{ const isPaid=req.payment_status==='paid'; if(!window.confirm(`Cancel ${req.renterName}'s transaction?${isPaid?' A full refund will be issued to them.':' They will be notified.'}`)) return; handleOwnerCancelBooking(req); setManagingListing(null); }} style={{ padding:"7px 14px", borderRadius:8, border:"1px solid #FA3E3E", background:C2.card, color:"#FA3E3E", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{req.payment_status==='paid' ? 'Cancel & Refund' : 'Cancel'}</button>
                          )}
                          <button onClick={()=>{ let convo=messages.find(m=>m.otherUserId===req.renterId&&m.item===req.item?.title); if(!convo){convo={id:Date.now(),conversation_id:`conv_req_${req.dbId||req.id}`,from:req.renterName,fromId:req.renterId,otherUserId:req.renterId,avatar:'👽',item:req.item?.title||'',sub:req.dateStr,time:"Just now",unread:false,thread:[]};setMessages(prev=>[...prev,convo]);}else{markConvoRead(convo);} setActiveConvo(convo); setManagingListing(null); }} style={{ padding:"7px 14px", borderRadius:8, border:`1px solid ${C2.border}`, background:C2.card, color:C2.text, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Message</button>
                        </div>
                      </div>
                    );
                  })
              }
              <button onClick={()=>setManagingListing(null)} style={{ width:"100%", marginTop:16, padding:"13px", borderRadius:12, border:`1px solid ${C2.border}`, fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:C2.card, color:C2.text }}>Close</button>
            </div>
          </div>
        );
      })()}

      {PaymentModal()}
      {STRIPE_KEY && showStripeModal && paymentModal && (
        <StripePaymentModal
          paymentModal={paymentModal}
          user={user}
          wantsDelivery={wantsDelivery}
          deliveryAddress={deliveryAddress}
          deliveryCheck={deliveryCheck}
          onDismiss={() => setShowStripeModal(false)}
          onSuccess={(stripeData) => handlePaymentConfirm(stripeData)}
          C={C}
          S={S}
        />
      )}
      {showDeleteAccountModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={()=>{ if(!deletingAccount) setShowDeleteAccountModal(false); }}>
          <div style={{ background:C.card, borderRadius:18, padding:24, maxWidth:360, width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,0.18)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:36, textAlign:"center", marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:18, fontWeight:800, color:C.text, textAlign:"center", marginBottom:10 }}>Delete your account?</div>
            <div style={{ fontSize:13, color:C.muted, textAlign:"center", lineHeight:1.6, marginBottom:20 }}>
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
              style={{ width:"100%", padding:"12px", borderRadius:10, border:`1.5px solid ${C.border}`, fontFamily:"inherit", fontWeight:600, fontSize:15, cursor:"pointer", background:C.card, color:C.text }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <AddListingModal
        show={showAddListing}
        onClose={()=>{ setShowAddListing(false); setAddImages([]); setEditingListing(null); }}
        newListing={newListing}
        setNewListing={setNewListing}
        addImages={addImages}
        setAddImages={setAddImages}
        onSubmit={editingListing ? handleEditSave : handleAddListing}
        S={S}
        C={C}
        ALL_CATS={ALL_CATS}
        userId={user?.id}
        onError={showToast}
        submitting={submittingListing}
        darkMode={darkMode}
      />
      {NotifPanel()}
      {!isDesktop && activeConvo && <ChatView
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
        onReport={()=>openReport(activeConvo?.otherUserId, activeConvo?.from, 'message')}
        isBlocked={blocks.includes(activeConvo?.otherUserId)}
        onBlock={()=>blockUser(activeConvo?.otherUserId)}
        onUnblock={()=>unblockUser(activeConvo?.otherUserId)}
        darkMode={darkMode}
        bookingRequests={bookingRequests}
        onAccept={handleAcceptRequest}
        onDecline={handleDeclineRequest}
        onCheckout={handleChatCheckout}
        onCancelRequest={handleCancelRequest}
        onOwnerCancel={handleOwnerCancelBooking}
        onAcceptOffer={handleAcceptOffer}
        onDeclineOffer={handleDeclineOffer}
        allItems={allItems}
      />}
      <OwnerProfileModal
        ownerId={ownerProfileId}
        allItems={allItems}
        fallbackName={ownerProfileName}
        onClose={()=>{ setOwnerProfileId(null); setOwnerProfileName(null); }}
        onSelectItem={item=>{ setSelectedItem(item); setOwnerProfileId(null); setOwnerProfileName(null); }}
        user={user}
        onReport={()=>{ const owned=allItems.filter(i=>i.ownerId===ownerProfileId); const name=owned[0]?.owner||'Unknown'; openReport(ownerProfileId?.startsWith('anon-')?null:ownerProfileId, name, 'profile'); }}
        isBlocked={blocks.includes(ownerProfileId)}
        onBlock={()=>blockUser(ownerProfileId)}
        onUnblock={()=>unblockUser(ownerProfileId)}
        darkMode={darkMode}
        onMessage={owner=>{
          if (!requireAuth()) return;
          setOwnerProfileId(null);
          const ex = messages.find(m=>m.fromId===owner.id || m.otherUserId===owner.id || (m.from||"").toLowerCase()===( owner.name||"").toLowerCase());
          if (ex) { setActiveConvo(ex); }
          else {
            const convId = `conv_${Date.now()}`;
            const nm = { id:Date.now(), conversation_id:convId, from:owner.name, fromId:owner.id, otherUserId:owner.id, avatar:owner.avatar, avatarUrl:owner.avatarUrl||null, item:"General inquiry", time:"Just now", unread:false, thread:[] };
            setMessages(prev=>[...prev,nm]); setActiveConvo(nm);
          }
          setTab("messages");
        }}
      />
      <PhotoBrowserModal data={photoBrowser} onClose={()=>setPhotoBrowser(null)} darkMode={darkMode}/>
      {reportModal && user && <ReportModal target={reportModal} user={user} onClose={()=>setReportModal(null)} darkMode={darkMode}/>}
      {blockingDatesFor && (() => {
        const listing = myListings.find(l => l.id === blockingDatesFor);
        if (!listing) return null;
        // Dates held by an active booking (owner-accepted or paid) must never be
        // freed by the owner — that would double-book the renter. Derive them
        // from bookingRequests so they're locked in the calendar.
        const lockedDates = [...new Set(
          bookingRequests
            .filter(r => r.ownerId === user?.id && r.item?.id === listing.id
              && ((r.status === 'accepted' || r.status === 'confirmed') || r.payment_status === 'paid')
              && r.status !== 'cancelled' && r.status !== 'declined')
            .flatMap(r => getDatesInRange(r.start, r.end || r.start))
        )];
        return (
          <BlockDatesModal
            listing={listing}
            lockedDates={lockedDates}
            onClose={()=>setBlockingDatesFor(null)}
            darkMode={darkMode}
            onSave={async(newBooked)=>{
              // Re-union locked dates as a final guard, independent of the modal UI
              const safeBooked=[...new Set([...newBooked, ...lockedDates])];
              const{error}=await supabase.from('listings').update({booked:safeBooked}).eq('id',listing.id);
              if(error){showToast("Failed to save dates","error");return;}
              setMyListings(prev=>prev.map(l=>l.id===listing.id?{...l,booked:safeBooked}:l));
              setBlockingDatesFor(null);
              showToast("Availability updated!");
            }}
          />
        );
      })()}
      {deletingId && (()=>{
        const delListing = myListings.find(l => l.id === deletingId);
        const activeCount = bookingRequests.filter(r =>
          r.ownerId === user?.id && r.item?.title === delListing?.title &&
          (r.status === 'pending' || r.status === 'accepted' || r.status === 'confirmed')
        ).length;
        return (
        <div style={S.overlay} onClick={()=>setDeletingId(null)}>
          <div style={{ ...S.sheet, maxHeight:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>Delete listing?</div>
            {activeCount > 0 && (
              <div style={{ fontSize:13, color:"#E87722", fontWeight:600, background:"#FFF7ED", border:"1px solid #FFE0B2", borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
                ⚠️ This listing has {activeCount} active transaction{activeCount>1?"s":""}. Cancel {activeCount>1?"them":"it"} first so people aren't left hanging.
              </div>
            )}
            <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>This cannot be undone.</div>
            <button style={{ ...S.pBtn, background:"#FA3E3E" }} onClick={async()=>{ const{error}=await supabase.from('listings').delete().eq('id',deletingId); if(!error){setMyListings(prev=>prev.filter(l=>l.id!==deletingId));setDeletingId(null);showToast("Listing deleted");}else{showToast("Failed to delete","error");} }}>Delete</button>
            <button style={S.gBtn} onClick={()=>setDeletingId(null)}>Cancel</button>
          </div>
        </div>
        );
      })()}
      {reviewingBooking && (
        <ReviewModal
          booking={reviewingBooking}
          onClose={()=>setReviewingBooking(null)}
          onSubmit={handleSubmitReview}
          darkMode={darkMode}
        />
      )}
      <AuthModal show={showAuthModal} initialMode={authModalMode} onClose={()=>setShowAuthModal(false)} darkMode={darkMode}/>
      <PasswordResetModal show={showPasswordReset} onDone={()=>{ setShowPasswordReset(false); showToast('Password updated! You\'re now signed in.'); }} darkMode={darkMode}/>
      <SecurityModal show={showSecurityModal} user={user} onClose={()=>setShowSecurityModal(false)} darkMode={darkMode}/>

      {showOnboarding && !user && (()=>{
        const steps = [
          { icon:"🗺️", title:"Browse items near you", desc:"Discover tools, gear, and more listed by neighbors in your area." },
          { icon:"📦", title:"List what you own", desc:"Earn money from things sitting in your garage. Create a listing in minutes." },
          { icon:"💬", title:"Book & chat", desc:"Request dates, pay securely, and message the owner — all in one place." },
        ];
        const s = steps[onboardStep];
        const isLast = onboardStep === steps.length - 1;
        const finish = () => { localStorage.setItem('lendie_onboarded','1'); setShowOnboarding(false); };
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:C.card, borderRadius:20, padding:"36px 28px 28px", maxWidth:360, width:"100%", textAlign:"center", boxShadow:"0 8px 40px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize:56, marginBottom:16, lineHeight:1 }}>{s.icon}</div>
              <div style={{ fontSize:20, fontWeight:800, color:C.text, marginBottom:8, letterSpacing:-0.3 }}>{s.title}</div>
              <div style={{ fontSize:15, color:C.muted, lineHeight:1.55, marginBottom:28 }}>{s.desc}</div>
              <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:28 }}>
                {steps.map((_,i)=>(
                  <div key={i} style={{ width: i===onboardStep?24:8, height:8, borderRadius:4, background: i===onboardStep?"#00B894":C.border, transition:"width 0.2s" }}/>
                ))}
              </div>
              <button onClick={isLast ? finish : ()=>setOnboardStep(onboardStep+1)} style={{ width:"100%", background:"#00B894", color:"#fff", border:"none", borderRadius:12, padding:"14px 0", fontSize:16, fontWeight:700, cursor:"pointer", marginBottom:10 }}>
                {isLast ? "Get started" : "Next"}
              </button>
              <button onClick={finish} style={{ background:"none", border:"none", color:C.muted, fontSize:13, cursor:"pointer", padding:"4px 0" }}>Skip</button>
            </div>
          </div>
        );
      })()}

      <Toast toast={toast}/>

      {/* Desktop footer */}
      {isDesktop && (
        <footer style={{ background: darkMode ? "#000" : C.card, borderTop:`1px solid ${C.border}`, marginTop:40, padding:"24px 10px 16px" }}>
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
              <div style={{ fontSize:13, color:C.muted, lineHeight:1.6, maxWidth:280 }}>Rent anything from your neighbors. Earn money from things you already own.</div>
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Explore</div>
              {["Browse listings","My items","Messages","Map"].map((l,i)=>(
                <div key={l} onClick={()=>setTab(["browse","listings","messages","map"][i])} style={{ fontSize:13, color:C.muted, marginBottom:6, cursor:"pointer" }}>{l}</div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>For owners</div>
              {["List an item","Manage listings","Booking requests","Earnings"].map(l=>(
                <div key={l} onClick={()=>setTab("listings")} style={{ fontSize:13, color:C.muted, marginBottom:6, cursor:"pointer" }}>{l}</div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Get the app</div>
              <div style={{ background:"#00B894", color:"#fff", borderRadius:10, padding:"10px 16px", fontSize:13, fontWeight:700, cursor:"pointer", display:"inline-block", marginBottom:8 }} onClick={()=>setShowInstallBanner(true)}>
                📱 Add to Home Screen
              </div>
              <div style={{ fontSize:12, color:C.muted }}>Works on iOS & Android</div>
            </div>
          </div>
          <div style={{ margin:"20px 0 0", paddingTop:16, borderTop:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
            <div style={{ fontSize:12, color:C.faint }}>© 2026 Lendie. Peer-to-peer rentals made simple.</div>
            <div style={{ display:"flex", gap:16, alignItems:"center" }}>
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:C.faint, textDecoration:"none" }}>Privacy Policy</a>
              <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:C.faint, textDecoration:"none" }}>Terms of Service</a>
            </div>
          </div>
        </footer>
      )}

      <nav style={{ ...S.nav, transform: navHidden ? "translate(-50%, 120%)" : "translateX(-50%)", transition:"transform 0.28s ease" }}>
        {[
          {id:"browse", label:"Browse", icon:(active)=><svg width="22" height="22" viewBox="0 0 24 24" fill={active?"#00B894":"none"} stroke={active?"#00B894":"#8A8D91"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>},
          {id:"listings", label:"My Items", icon:(active)=><Package size={22} strokeWidth={2} color={active?"#00B894":"#8A8D91"} fill={active?"#00B89420":"none"}/>},
          {id:"messages", label:"Inbox", badge:unreadMsgs, icon:(active)=><svg width="22" height="22" viewBox="0 0 24 24" fill={active?"#00B894":"none"} stroke={active?"#00B894":"#8A8D91"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>},
          {id:"map", label:"Map", icon:(active)=><svg width="22" height="22" viewBox="0 0 24 24" fill={active?"#00B894":"none"} stroke={active?"#00B894":"#8A8D91"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3" fill={active?"#fff":"none"}/></svg>},
        ].map(n=>{
          const active = tab===n.id;
          return (
            <div key={n.id} onClick={()=>{ setTab(n.id); if(activeConvo&&n.id!=="messages") setActiveConvo(null); }} style={{ flex:1, paddingTop:8, paddingBottom:6, display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer", color:active?"#00B894":"#8A8D91", position:"relative", transition:"color 0.18s" }}>
              <div style={{ transform:active?"scale(1.08)":"scale(1)", transition:"transform 0.18s cubic-bezier(0.34,1.56,0.64,1)" }}>
                {n.icon(active)}
              </div>
              <span style={{ fontSize:10, fontWeight:active?700:400, letterSpacing:0.15, transition:"font-weight 0.18s" }}>{n.label}</span>
              {n.badge>0 && <div style={{ position:"absolute", top:6, right:"18%", background:"#FA3E3E", borderRadius:"50%", minWidth:15, height:15, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:"#fff", padding:"0 3px", boxSizing:"border-box", border:"1.5px solid white" }}>{n.badge}</div>}
            </div>
          );
        })}
      </nav>
    </div>
  );
}