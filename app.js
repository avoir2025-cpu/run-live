import { CAT, analyze, routeOf, etaAt, fmtPace, fmtHMS, fmtClock, fmtAgo, parseHMS, gunTime, hav } from './calc.js';
import { ROUTES } from './routes.js';
import { SB_URL, SB_KEY } from './config.js';

const TEAM = new URLSearchParams(location.search).get('t') || 'tc2026';
const K = k => `rl_${TEAM}_${k}`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(K(k))); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(K(k), JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(K(k)); } catch { } },
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ERR = {
  bad_code: '團體代碼不對', bib_taken: '這個號碼已經有人加入。如果是你本人，請用下面的「換手機登入」',
  bad_bib: '號碼布只能是英文或數字，最多 8 碼', bad_nick: '暱稱要 1 到 16 個字', bad_pin: 'PIN 要 4 位數字',
  no_bib: '找不到這個號碼，請確認是否已加入', locked: 'PIN 錯太多次被鎖住，請找管理者重設',
  bad_token: '登入已失效，請重新登入', bad_target: '目標時間不合理（15 分鐘到 8 小時之間）',
  bad_finish: '完賽時間不合理', bad_admin: '管理碼不對', team_full: '人數已滿', bad_cat: '組別不對',
};
async function rpc(fn, args) {
  const r = await fetch(SB_URL + fn, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(ERR[j?.message] || j?.message || `連線錯誤 ${r.status}`); e.code = j?.message; throw e; }
  return j;
}

// ---------- 狀態 ----------
const S = {
  code: store.get('code'), token: store.get('token'), me: store.get('me'),
  team: null, runners: [], pts: new Map(), since: null, filter: store.get('filter') || 'all',
  cheer: 'finish', online: false, lastPoll: 0, tab: 'map', adminCode: null,
};
const Q = { list: store.get('queue') || [], sending: false, lastSent: store.get('lastSent') };
const GEO = { watchId: null, lastT: 0, last: null, acc: null, err: null, wake: null };

// ---------- 小工具 ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200);
}
function confirmBox(msg, yes = '確定') {
  const d = $('#dlg'); $('#dlg-msg').textContent = msg; $('#dlg-yes').textContent = yes;
  d.showModal();
  return new Promise(res => {
    const done = v => { d.close(); $('#dlg-yes').onclick = $('#dlg-no').onclick = null; res(v); };
    $('#dlg-yes').onclick = () => done(true); $('#dlg-no').onclick = () => done(false);
    d.oncancel = () => done(false);
  });
}
const catName = c => CAT[c]?.name || c;
const hmOf = s => s ? `${Math.floor(s / 3600)}:${String(Math.round(s % 3600 / 60)).padStart(2, '0')}` : '';

// ---------- 開場 ----------
async function boot() {
  if (!S.code) return showGate();
  try {
    await poll(true);
  } catch (e) {
    if (e.code === 'bad_code') { store.del('code'); S.code = null; return showGate('代碼已更換，請重新輸入'); }
    toast('連不上伺服器，稍後會自動重試');
  }
  showApp();
  if (S.token) {
    rpc('runlive_me', { p_token: S.token }).then(me => { S.me = me; store.set('me', me); renderMe(); })
      .catch(e => { if (e.code === 'bad_token') { logoutLocal(); toast('這支手機的登入已失效（可能在別支手機登入過）'); } });
  }
  if (store.get('sharing') && S.token) startShare(true);
  if (store.get('wake')) setWake(true);
}

function showGate(msg) {
  $('#gate').hidden = false; $('#app').hidden = true;
  if (TEAM !== 'tc2026') $('#gate-sub').textContent = `場次：${TEAM}`;
  if (msg) toast(msg);
  $('#gate-form').onsubmit = async ev => {
    ev.preventDefault();
    const code = $('#gate-code').value.trim().toLowerCase();
    try {
      const st = await rpc('runlive_state', { p_team: TEAM, p_code: code, p_since: null });
      S.code = code; store.set('code', code);
      applyState(st, true);
      $('#gate').hidden = true;
      showApp();
      setTab(S.me ? 'map' : 'me');
    } catch (e) { toast(e.message); }
  };
}

let mapReady = false;
function showApp() {
  $('#gate').hidden = true; $('#app').hidden = false;
  if (!mapReady) { initMap(); mapReady = true; }
  renderFilters(); renderCheerOptions(); renderAll();
  setTab(S.tab);
  if (!S.me && !store.get('watcher')) setTab('me');
}

// ---------- 分頁 ----------
document.querySelectorAll('nav.tabs [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function setTab(tab) {
  S.tab = tab;
  for (const v of ['map', 'list', 'me']) $(`#view-${v}`).hidden = v !== tab;
  document.querySelectorAll('nav.tabs [data-tab]').forEach(b => b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (tab === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
  if (tab === 'me') renderMe();
  if (tab === 'list') renderList();
}

// ---------- 同步 ----------
function applyState(st, full) {
  S.team = st.team; S.runners = st.runners; S.since = st.now; S.online = true; S.lastPoll = Date.now();
  if (full) S.pts = new Map();
  for (const p of st.points) {
    let arr = S.pts.get(p.r); if (!arr) S.pts.set(p.r, arr = []);
    if (!arr.length || arr[arr.length - 1].t < p.t) arr.push(p);
    else if (!arr.some(x => x.t === p.t)) { arr.push(p); arr.sort((a, b) => a.t - b.t); }
    if (arr.length > 600) arr.splice(0, arr.length - 600);
  }
  const ids = new Set(S.runners.map(r => r.id));
  for (const id of S.pts.keys()) if (!ids.has(id)) S.pts.delete(id);
  if (S.me) { const m = S.runners.find(r => r.id === S.me.id); if (m) { S.me = { ...S.me, ...m }; store.set('me', S.me); } }
  $('#team-name').textContent = S.team?.name || '跑團 Live';
}
async function poll(full = false) {
  const st = await rpc('runlive_state', { p_team: TEAM, p_code: S.code, p_since: full ? null : S.since });
  applyState(st, full);
  renderAll();
}
setInterval(() => {
  if (document.visibilityState !== 'visible' || !S.code || $('#app').hidden) return;
  poll(Date.now() - S.lastPoll > 10 * 60e3).catch(() => { S.online = false; renderNet(); });
}, 20000);
setInterval(() => { if (!$('#app').hidden) renderAll(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (store.get('wake')) setWake(true);
  flush(); if (S.code && !$('#app').hidden) poll(Date.now() - S.lastPoll > 10 * 60e3).catch(() => { });
});
addEventListener('online', () => { flush(); poll().catch(() => { }); });

function renderNet() {
  const d = $('#net-dot'), t = $('#net-text');
  if (!navigator.onLine) { d.className = 'dot off'; t.textContent = '離線'; return; }
  d.className = 'dot' + (S.online ? ' on' : ' off');
  t.textContent = S.online ? `更新 ${fmtClock(S.lastPoll)}` : '連線中斷';
}

// ---------- 分析 ----------
let AN = new Map();
function analyzeAll() {
  const now = Date.now();
  AN = new Map();
  for (const r of S.runners) {
    let pts = S.pts.get(r.id) || [];
    if (S.me && r.id === S.me.id && Q.list.length) {
      const seen = new Set(pts.map(p => p.t));
      pts = [...pts, ...Q.list.filter(p => !seen.has(p.t))].sort((a, b) => a.t - b.t);
    }
    try { AN.set(r.id, analyze(r, pts, S.team?.config, now)); } catch (e) { console.error(e); }
  }
}
function renderAll() {
  analyzeAll(); renderNet(); renderClock();
  if (mapReady) renderMap();
  if (S.tab === 'list') renderList();
  if (S.tab === 'me') renderShareStatus();
}
function renderClock() {
  const cfg = S.team?.config; if (!cfg) return;
  const gun = gunTime(cfg, 'full'), now = Date.now();
  const line = now < gun - 12 * 3600e3 ? `比賽日 ${cfg.date}` : now < gun ? `全馬 ${fmtClock(gun)} 起跑` : `全馬已跑 ${fmtHMS((now - gun) / 1000)}`;
  $('#clock-line').textContent = line;
}

// ---------- 篩選 ----------
function renderFilters() {
  const cats = ['all', ...Object.keys(CAT).filter(c => S.runners.some(r => r.cat === c))];
  if (!cats.includes(S.filter)) S.filter = 'all';
  const html = cats.map(c => `<button type="button" class="chip" data-f="${c}" aria-pressed="${S.filter === c}">${c === 'all' ? '全部' : catName(c)}</button>`).join('');
  document.querySelectorAll('[data-filter]').forEach(el => el.innerHTML = html);
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-f]'); if (!b) return;
  S.filter = b.dataset.f; store.set('filter', S.filter);
  renderFilters(); renderAll(); if (S.tab === 'list') renderList(); fitAll();
});
const shown = r => S.filter === 'all' || r.cat === S.filter;

// ---------- 地圖 ----------
let map, routeLayers = {}, markers = new Map(), myFixMarker;
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([24.205, 120.665], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  for (const [cat, r] of Object.entries(ROUTES)) {
    const g = L.layerGroup();
    L.polyline(r.pts, { color: CAT[cat].color, weight: 5, opacity: .45 }).addTo(g);
    const rt = routeOf(cat);
    for (let km = 5; km * 1000 < r.len; km += 5) {
      const i = rt.cum.findIndex(d => d >= km * 1000);
      L.marker(r.pts[i], { icon: L.divIcon({ className: '', html: `<span class="km" style="color:${CAT[cat].color}">${km}K</span>`, iconSize: null }), interactive: false }).addTo(g);
    }
    routeLayers[cat] = g;
  }
  L.marker(ROUTES.full.pts[0], { icon: L.divIcon({ className: '', html: '<span class="sf">起終點</span>', iconSize: null }), interactive: false, zIndexOffset: -100 }).addTo(map);
  $('#btn-fit').onclick = fitAll;
  $('#btn-me').onclick = () => {
    const a = S.me && AN.get(S.me.id);
    const ll = GEO.last ? [GEO.last.la, GEO.last.lo] : a?.pos;
    if (ll) map.setView(ll, 15); else toast(S.me ? '還沒有你的定位，請到「我」開始分享' : '你還沒加入跑者');
  };
  setTimeout(fitAll, 300);
}
function fitAll() {
  if (!map) return;
  const ll = [];
  for (const r of S.runners) { if (!shown(r)) continue; const a = AN.get(r.id); if (a?.pos) ll.push(a.pos); }
  if (S.filter !== 'all' && ROUTES[S.filter] && !ll.length) ll.push(...ROUTES[S.filter].pts);
  if (ll.length >= 2) map.fitBounds(L.latLngBounds(ll).pad(0.2), { maxZoom: 16 });
  else if (ll.length === 1) map.setView(ll[0], 15);
  else map.fitBounds(L.latLngBounds(ROUTES.full.pts).pad(0.05));
}
function renderMap() {
  const useRoute = S.team?.config?.useRoute !== false;
  for (const [cat, g] of Object.entries(routeLayers)) {
    const on = useRoute && (S.filter === 'all' ? S.runners.some(r => r.cat === cat) || cat === 'full' : S.filter === cat);
    if (on && !map.hasLayer(g)) g.addTo(map); else if (!on && map.hasLayer(g)) g.remove();
  }
  const keep = new Set();
  for (const r of S.runners) {
    const a = AN.get(r.id);
    if (!a?.pos || !shown(r)) continue;
    keep.add(r.id);
    const isMe = S.me && r.id === S.me.id;
    const cls = ['pin', a.estimated && a.status !== 'finished' ? 'est' : '', isMe ? 'me' : '', a.status === 'finished' ? 'done' : ''].join(' ');
    const html = `<div class="${cls}" style="--c:${CAT[r.cat].color}"><b>${esc(r.nick)}</b><i></i></div>`;
    let m = markers.get(r.id);
    if (!m) {
      m = L.marker(a.pos, { icon: L.divIcon({ className: '', html, iconSize: null }), zIndexOffset: isMe ? 1000 : 0 }).addTo(map);
      m.bindPopup('', { maxWidth: 260 });
      m.on('popupopen', () => m.setPopupContent(popupHtml(r.id)));
      markers.set(r.id, m);
    } else {
      m.setLatLng(a.pos);
      if (m._html !== html) m.setIcon(L.divIcon({ className: '', html, iconSize: null }));
      if (m.isPopupOpen()) m.setPopupContent(popupHtml(r.id));
    }
    m._html = html;
  }
  for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id); }
}
function statusText(a) {
  switch (a.status) {
    case 'waiting': return '還沒起跑';
    case 'nofix': return '沒有定位，依目標配速推算';
    case 'stale': return `訊號 ${fmtAgo(a.age)}，位置為推算`;
    case 'finished': return a.official ? `完賽 ${fmtHMS(a.finishSec)}` : `抵達終點（GPS 約 ${fmtHMS(a.finishSec)}）`;
    default: return a.estimated ? `跑步中（${fmtAgo(a.age)}定位，現為推算）` : '跑步中';
  }
}
function popupHtml(id) {
  const r = S.runners.find(x => x.id === id), a = AN.get(id);
  if (!r || !a) return '';
  const cheer = S.cheer === 'finish' ? null : cheerKm(r.cat), e = cheer != null && a.status !== 'finished' ? etaAt(a, cheer) : null;
  return `<div class="pop"><b>${esc(r.nick)}</b> <span style="color:#6b7280">#${esc(r.bib)}・${catName(r.cat)}</span>
  <div class="g">
    <span>狀態</span><span>${statusText(a)}</span>
    <span>距離</span><span>${(a.dNow / 1000).toFixed(1)} / ${(a.len / 1000).toFixed(1)} km</span>
    <span>配速</span><span>${fmtPace(a.pace)} /km</span>
    ${a.status !== 'finished' ? `<span>預估完賽</span><span>${fmtClock(a.etaFinish)}（${fmtHMS((a.etaFinish - a.start) / 1000)}）</span>` : ''}
    ${e ? `<span>${cheerLabel()}</span><span>${e.passed ? '已經過' : fmtClock(e.t)}</span>` : ''}
    <span>最後定位</span><span>${fmtAgo(a.age)}</span>
  </div></div>`;
}

// ---------- 名單 ----------
function renderCheerOptions() {
  const opts = [['finish', '終點'], ...[5, 10, 15, 20, 21.1, 25, 30, 35, 40].map(k => [String(k), `${k} K`]), ['custom', '自訂公里數']];
  $('#cheer').innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('#cheer').value = S.cheer;
  $('#cheer').onchange = () => { S.cheer = $('#cheer').value; $('#cheer-km').hidden = S.cheer !== 'custom'; renderList(); };
  $('#cheer-km').oninput = () => renderList();
}
function cheerKm(cat) {
  const len = CAT[cat].len / 1000;
  if (S.cheer === 'finish') return len;
  const k = S.cheer === 'custom' ? parseFloat($('#cheer-km').value) : parseFloat(S.cheer);
  if (!isFinite(k) || k > len) return null;
  return k;
}
const cheerLabel = () => S.cheer === 'finish' ? '到終點' : `到 ${S.cheer === 'custom' ? $('#cheer-km').value : S.cheer}K`;
function renderList() {
  const el = $('#list');
  if (!S.runners.length) { el.innerHTML = '<p class="empty">還沒有人加入。到「我」分頁加入跑者吧！</p>'; return; }
  let html = '';
  for (const cat of Object.keys(CAT)) {
    const rs = S.runners.filter(r => r.cat === cat && shown(r));
    if (!rs.length) continue;
    rs.sort((x, y) => { const a = AN.get(x.id), b = AN.get(y.id); return (b?.dNow || 0) - (a?.dNow || 0) || (a?.etaFinish || 0) - (b?.etaFinish || 0); });
    html += `<h3 class="group-h">${catName(cat)}（${rs.length} 人）</h3>`;
    for (const r of rs) {
      const a = AN.get(r.id); if (!a) continue;
      const k = S.cheer === 'finish' ? null : cheerKm(cat), e = k != null && a.status !== 'finished' ? etaAt(a, k) : null;
      const pct = Math.min(100, a.dNow / a.len * 100);
      html += `<button type="button" class="runner" data-rid="${r.id}" style="--c:${CAT[cat].color}">
        <div class="r1"><b>${esc(r.nick)}</b><span class="bib">#${esc(r.bib)}</span><span class="st ${a.status}">${a.status === 'finished' ? (a.official ? '完賽' : '抵達') : a.status === 'waiting' ? '未起跑' : a.status === 'running' && !a.estimated ? '跑步中' : '推算中'}</span></div>
        <div class="prog"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="r3">${a.status === 'finished' ? `🏁 ${fmtHMS(a.finishSec)}${a.official ? '' : '（GPS）'}` : `${(a.dNow / 1000).toFixed(1)} km・${fmtPace(a.pace)}/km・預估完賽 <b>${fmtClock(a.etaFinish)}</b>`}</div>
        <div class="r4">${a.status === 'finished' ? (a.official ? '正式成績' : 'GPS 估計，等本人填正式成績') : statusText(a)}${r.target_sec ? `・目標 ${hmOf(r.target_sec)}` : ''}</div>
        ${e ? `<div class="cheer">${cheerLabel()}：${e.passed ? '已經過' : `約 ${fmtClock(e.t)}`}</div>` : ''}
      </button>`;
    }
  }
  el.innerHTML = html || '<p class="empty">這個組別還沒有人</p>';
}
$('#list').addEventListener('click', ev => {
  const b = ev.target.closest('[data-rid]'); if (!b) return;
  setTab('map');
  const m = markers.get(b.dataset.rid), a = AN.get(b.dataset.rid);
  if (m && a?.pos) { map.setView(a.pos, 15); setTimeout(() => m.openPopup(), 100); } else toast('這位跑者還沒有位置');
});

// ---------- 定位分享 ----------
function startShare(silent) {
  if (!('geolocation' in navigator)) { toast('這支手機的瀏覽器不支援定位'); return; }
  if (GEO.watchId != null) return;
  GEO.err = null;
  GEO.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
  store.set('sharing', true);
  if (!silent) toast('開始分享定位');
  renderMe();
}
function stopShare() {
  if (GEO.watchId != null) navigator.geolocation.clearWatch(GEO.watchId);
  GEO.watchId = null; store.set('sharing', false); flush(); renderMe();
}
function onPos(p) {
  const { latitude: la, longitude: lo, accuracy: a } = p.coords;
  const t = Math.round(p.timestamp || Date.now());
  GEO.acc = a; GEO.err = null;
  if (a > 100) { renderShareStatus(); return; }
  const moved = GEO.last ? hav(GEO.last.la, GEO.last.lo, la, lo) : Infinity;
  if (t - GEO.lastT < 10000 && moved < 30) { renderShareStatus(); return; }
  GEO.lastT = t;
  GEO.last = { t, la: +la.toFixed(6), lo: +lo.toFixed(6), a: Math.round(a) };
  Q.list.push(GEO.last);
  if (Q.list.length > 3000) Q.list.splice(0, Q.list.length - 3000);
  store.set('queue', Q.list);
  renderShareStatus();
  if (Q.list.length >= 3 || !Q.lastSent || Date.now() - Q.lastSent > 15000) flush();
}
function onPosErr(e) {
  GEO.err = e.code === 1 ? '定位權限被拒絕：請到手機設定允許這個網站使用位置' : e.code === 3 ? '定位逾時，繼續嘗試中' : '暫時抓不到定位';
  if (e.code === 1) { navigator.geolocation.clearWatch(GEO.watchId); GEO.watchId = null; store.set('sharing', false); renderMe(); }
  renderShareStatus();
}
async function flush() {
  if (Q.sending || !Q.list.length || !S.token || !navigator.onLine) return;
  Q.sending = true;
  try {
    while (Q.list.length) {
      const batch = Q.list.slice(0, 300);
      await rpc('runlive_push', { p_token: S.token, p_points: batch });
      Q.list.splice(0, batch.length);
      Q.lastSent = Date.now(); store.set('lastSent', Q.lastSent); store.set('queue', Q.list);
    }
  } catch (e) {
    if (e.code === 'bad_token') { logoutLocal(); toast('登入失效，請重新登入'); }
  } finally { Q.sending = false; renderShareStatus(); }
}
setInterval(flush, 15000);

async function setWake(on) {
  store.set('wake', on);
  if (on) {
    if (!('wakeLock' in navigator)) { toast('這支手機不支援螢幕常亮，請到手機設定把自動鎖定時間調長'); store.set('wake', false); renderMe(); return; }
    try {
      if (!GEO.wake) { GEO.wake = await navigator.wakeLock.request('screen'); GEO.wake.addEventListener('release', () => { GEO.wake = null; renderShareStatus(); }); }
    } catch { /* 頁面不在前景時會失敗，回到前景再試 */ }
  } else if (GEO.wake) { await GEO.wake.release().catch(() => { }); GEO.wake = null; }
  renderMe();
}

// ---------- 我 ----------
function renderShareStatus() {
  const el = $('#share-status'); if (!el) return;
  const parts = [];
  if (GEO.watchId != null) parts.push(GEO.acc != null ? `GPS 精度約 ${Math.round(GEO.acc)} 公尺` : '等待 GPS 中…');
  if (GEO.last) parts.push(`最後定位 ${fmtClock(GEO.last.t)}`);
  parts.push(Q.lastSent ? `上次上傳 ${fmtClock(Q.lastSent)}` : '尚未上傳');
  if (Q.list.length) parts.push(`待傳 ${Q.list.length} 點（有網路就會補傳）`);
  if (store.get('wake')) parts.push(GEO.wake ? '螢幕常亮中' : '螢幕常亮（回到這頁時生效）');
  el.textContent = parts.join('・');
  const er = $('#share-err'); if (er) { er.textContent = GEO.err || ''; er.hidden = !GEO.err; }
}

function renderMe() {
  const el = $('#me'); if (!el) return;
  if (!S.me) { el.innerHTML = joinHtml(); bindJoin(); return; }
  const m = S.me, a = AN.get(m.id), cfg = S.team?.config;
  const gun = gunTime(cfg, m.cat);
  const sharing = GEO.watchId != null;
  el.innerHTML = `
  <div class="card">
    <h2>${esc(m.nick)} <span style="color:#6b7280;font-weight:500">#${esc(m.bib)}・${catName(m.cat)}</span></h2>
    <p>${m.target_sec ? `目標 ${hmOf(m.target_sec)}・` : ''}槍聲 ${fmtClock(gun)}${m.start_at ? `・自己記錄出發 ${fmtClock(Date.parse(m.start_at))}` : ''}</p>
    ${a ? `<p>${statusText(a)}${a.status !== 'finished' && a.status !== 'waiting' ? `・${(a.dNow / 1000).toFixed(1)} km・預估完賽 ${fmtClock(a.etaFinish)}` : ''}</p>` : ''}
  </div>

  <div class="card">
    <h2>📍 分享我的位置</h2>
    <p>開著這一頁時，你的位置會傳給團員看。<b>鎖螢幕或切到別的 App 會暫停</b>，之後打開這頁就會繼續，沒網路時存在手機裡，有網路再補傳。</p>
    <div class="big-toggle"><button type="button" class="btn ${sharing ? 'dark' : 'primary'}" id="btn-share">${sharing ? '停止分享' : '開始分享定位'}</button></div>
    <p class="status-line" id="share-status"></p>
    <p class="warnbox" id="share-err" hidden></p>
    <label class="big-toggle" style="margin-top:12px;font-size:15px"><input type="checkbox" id="chk-wake" ${store.get('wake') ? 'checked' : ''} style="inline-size:22px;block-size:22px"> 螢幕常亮模式（手機放臂套全程定位，很耗電，建議帶行動電源）</label>
    <p class="status-line">位置只有輸入團體代碼的人看得到，賽後一週刪除。</p>
  </div>

  <div class="card">
    <h2>⏱️ 起跑與完賽</h2>
    <p>預設用大會槍聲時間計算。排在後面的分區，過起跑線時按一下，預估會更準。</p>
    <div class="btns">
      <button type="button" class="btn primary" id="btn-go">我過起跑線了</button>
      ${m.start_at ? '<button type="button" class="btn ghost" id="btn-go-clear">改回槍聲時間</button>' : ''}
    </div>
    <div class="field" style="margin-top:14px">
      <label for="in-finish">大會正式成績（晶片時間）</label>
      <div class="row2"><input id="in-finish" type="text" inputmode="numeric" placeholder="例如 4:12:33" value="${m.finish_sec ? fmtHMS(m.finish_sec) : ''}"><button type="button" class="btn dark" id="btn-finish" style="flex:0 0 auto">儲存</button></div>
      <span class="hint">填了之後名單和完賽圖卡都會用這個時間。成績在大會公告後可以再改。</span>
    </div>
    <a class="btn ghost block" href="card.html${TEAM !== 'tc2026' ? `?t=${encodeURIComponent(TEAM)}` : ''}" style="display:flex;align-items:center;justify-content:center;text-decoration:none;color:inherit;margin-top:6px">🖼️ 做完賽圖卡</a>
  </div>

  <div class="card">
    <h2>✏️ 我的資料</h2>
    <div class="field"><label for="ed-nick">暱稱</label><input id="ed-nick" type="text" maxlength="16" value="${esc(m.nick)}"></div>
    <div class="row2">
      <div class="field"><label for="ed-cat">組別</label><select id="ed-cat">${Object.entries(CAT).map(([k, c]) => `<option value="${k}" ${k === m.cat ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
      <div class="field"><label for="ed-target">目標時間</label><input id="ed-target" type="text" inputmode="numeric" placeholder="4:30" value="${hmOf(m.target_sec)}"></div>
    </div>
    <button type="button" class="btn dark" id="btn-save">儲存資料</button>
    <div class="field" style="margin-top:16px"><label for="ed-pin">改 PIN（4 位數字）</label>
      <div class="pw"><input id="ed-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"><button type="button" class="btn ghost" data-eye="ed-pin">顯示</button><button type="button" class="btn dark" id="btn-pin">更新</button></div>
      <span class="hint">換手機時用號碼布＋PIN 登入。忘記 PIN 請找管理者重設。</span></div>
  </div>

  <div class="card">
    <div class="btns" style="margin-top:0">
      <button type="button" class="btn ghost" id="btn-logout">登出這支手機</button>
      <button type="button" class="btn danger" id="btn-delete">刪除我的資料</button>
    </div>
  </div>
  ${adminHtml()}`;
  bindMe(); bindAdmin(); renderShareStatus();
}

function joinHtml() {
  return `
  <div class="card">
    <h2>🏃 我要跑（第一次加入）</h2>
    <form id="f-join">
      <div class="row2">
        <div class="field"><label for="j-bib">號碼布</label><input id="j-bib" type="text" inputmode="numeric" autocapitalize="characters" maxlength="8" required></div>
        <div class="field"><label for="j-cat">組別</label><select id="j-cat">${Object.entries(CAT).map(([k, c]) => `<option value="${k}">${c.name}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="j-nick">暱稱（地圖上顯示）</label><input id="j-nick" type="text" maxlength="16" required></div>
      <div class="field"><label for="j-target">目標完賽時間（選填）</label><input id="j-target" type="text" inputmode="numeric" placeholder="例如 4:30"><span class="hint">還沒有定位時，用這個配速推算位置。</span></div>
      <div class="field"><label for="j-pin">自訂 4 位數 PIN</label>
        <div class="pw"><input id="j-pin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="new-password" required><button type="button" class="btn ghost" data-eye="j-pin">顯示</button></div>
        <span class="hint">換手機時用號碼布＋PIN 登入。</span></div>
      <button class="btn primary block" type="submit">加入</button>
    </form>
  </div>
  <div class="card">
    <h2>📱 我已經加入過（換手機登入）</h2>
    <form id="f-login">
      <div class="row2">
        <div class="field"><label for="l-bib">號碼布</label><input id="l-bib" type="text" inputmode="numeric" maxlength="8" required></div>
        <div class="field"><label for="l-pin">PIN</label><div class="pw"><input id="l-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" required><button type="button" class="btn ghost" data-eye="l-pin">顯示</button></div></div>
      </div>
      <button class="btn dark block" type="submit">登入</button>
      <p class="status-line">登入後，舊手機會自動登出。忘記 PIN 請找管理者重設。</p>
    </form>
  </div>
  <div class="card">
    <h2>📣 我是加油團（只看不跑）</h2>
    <p>直接看地圖和名單，不用加入。</p>
    <button type="button" class="btn ghost block" id="btn-watch">看大家跑到哪</button>
  </div>
  ${adminHtml()}`;
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-eye]'); if (!b) return;
  const i = document.getElementById(b.dataset.eye);
  i.type = i.type === 'password' ? 'text' : 'password';
  b.textContent = i.type === 'password' ? '顯示' : '隱藏';
});

function setLogin(res) {
  S.token = res.token; store.set('token', res.token);
  const { token, ...me } = res; S.me = me; store.set('me', me); store.del('watcher');
}
function logoutLocal() {
  stopShare(); S.token = null; S.me = null; store.del('token'); store.del('me'); Q.list = []; store.set('queue', []); renderMe();
}

function bindJoin() {
  $('#f-join').onsubmit = async ev => {
    ev.preventDefault();
    const tgt = $('#j-target').value.trim();
    const target_sec = tgt ? parseHMS(tgt) : null;
    if (tgt && !target_sec) return toast('目標時間格式像 4:30（4 小時 30 分）');
    try {
      const res = await rpc('runlive_join', { p_team: TEAM, p_code: S.code, p_bib: $('#j-bib').value.trim(), p_nick: $('#j-nick').value.trim(), p_cat: $('#j-cat').value, p_target_sec: target_sec, p_pin: $('#j-pin').value.trim() });
      setLogin(res); toast('加入成功！'); await poll(true); renderFilters(); renderMe();
    } catch (e) { toast(e.message); }
  };
  $('#f-login').onsubmit = async ev => {
    ev.preventDefault();
    try {
      const res = await rpc('runlive_login', { p_team: TEAM, p_code: S.code, p_bib: $('#l-bib').value.trim(), p_pin: $('#l-pin').value.trim() });
      if (res.error) return toast(`PIN 不對，還可以試 ${res.left} 次`);
      setLogin(res); toast('登入成功'); await poll(true); renderMe();
    } catch (e) { toast(e.message); }
  };
  $('#btn-watch').onclick = () => { store.set('watcher', true); setTab('map'); fitAll(); };
}

async function update(patch, okMsg) {
  try { const me = await rpc('runlive_update', { p_token: S.token, p_patch: patch }); S.me = { ...S.me, ...me }; store.set('me', S.me); toast(okMsg); await poll(); renderMe(); renderFilters(); }
  catch (e) { toast(e.message); if (e.code === 'bad_token') logoutLocal(); }
}
function bindMe() {
  $('#btn-share').onclick = () => GEO.watchId != null ? stopShare() : startShare();
  $('#chk-wake').onchange = ev => setWake(ev.target.checked);
  $('#btn-go').onclick = () => update({ start_at: new Date().toISOString() }, `已記錄出發時間 ${fmtClock(Date.now())}`);
  $('#btn-go-clear') && ($('#btn-go-clear').onclick = () => update({ start_at: null }, '改回槍聲時間'));
  $('#btn-finish').onclick = () => {
    const v = $('#in-finish').value.trim();
    if (!v) return update({ finish_sec: null }, '已清除完賽成績');
    const s = parseHMS(v); if (!s) return toast('格式像 4:12:33');
    update({ finish_sec: s }, `已儲存完賽成績 ${fmtHMS(s)}`);
  };
  $('#btn-save').onclick = () => {
    const tgt = $('#ed-target').value.trim(), s = tgt ? parseHMS(tgt) : null;
    if (tgt && !s) return toast('目標時間格式像 4:30');
    update({ nick: $('#ed-nick').value.trim(), cat: $('#ed-cat').value, target_sec: s }, '資料已更新');
  };
  $('#btn-pin').onclick = () => {
    const p = $('#ed-pin').value.trim(); if (!/^\d{4}$/.test(p)) return toast('PIN 要 4 位數字');
    update({ pin: p }, 'PIN 已更新');
  };
  $('#btn-logout').onclick = async () => { if (await confirmBox('登出後要用號碼布＋PIN 才能登入回來。確定登出這支手機？', '登出')) logoutLocal(); };
  $('#btn-delete').onclick = async () => {
    if (!await confirmBox('會刪除你的暱稱、號碼和所有定位紀錄，無法復原。確定刪除？', '刪除')) return;
    try { await rpc('runlive_delete_me', { p_token: S.token }); logoutLocal(); await poll(true); toast('已刪除你的資料'); } catch (e) { toast(e.message); }
  };
}

// ---------- 管理者 ----------
function adminHtml() {
  return `<details class="admin" ${S.adminCode ? 'open' : ''}><summary>管理者</summary><div id="adm">${S.adminCode ? '' : `
    <div class="row2"><input id="adm-code" type="password" autocomplete="off" placeholder="管理碼"><button type="button" class="btn dark" id="adm-go" style="flex:0 0 auto">進入</button></div>`}</div></details>`;
}
function bindAdmin() {
  const go = $('#adm-go');
  if (go) go.onclick = () => { S.adminCode = $('#adm-code').value.trim(); loadAdmin(); };
  if (S.adminCode) loadAdmin();
}
async function admin(action, args = {}) { return rpc('runlive_admin', { p_team: TEAM, p_admin_code: S.adminCode, p_action: action, p_args: args }); }
async function loadAdmin() {
  const box = $('#adm'); if (!box) return;
  let d;
  try { d = await admin('list'); } catch (e) { S.adminCode = null; toast(e.message); renderMe(); return; }
  const cfg = d.team.config || {};
  box.innerHTML = `
    <div class="card" style="margin-top:8px">
      <h2>場次設定</h2>
      <div class="field"><label for="ad-name">名稱</label><input id="ad-name" type="text" value="${esc(d.team.name)}"></div>
      <div class="field"><label for="ad-date">比賽日期</label><input id="ad-date" type="date" value="${esc(cfg.date || '')}"></div>
      <div class="grid2">${Object.entries(CAT).map(([k, c]) => `<div class="field"><label for="ad-s-${k}">${c.name}起跑</label><input id="ad-s-${k}" type="time" value="${esc(cfg.starts?.[k] || '')}"></div>`).join('')}</div>
      <label class="big-toggle" style="font-size:14px"><input type="checkbox" id="ad-route" ${cfg.useRoute !== false ? 'checked' : ''} style="inline-size:22px;block-size:22px"> 用大會路線對位（練跑不在賽道上時關掉）</label>
      <div class="btns"><button type="button" class="btn dark" id="ad-save">儲存設定</button></div>
      <div class="field" style="margin-top:14px"><label for="ad-code">更換團體代碼</label><div class="row2"><input id="ad-code" type="text" autocomplete="off" placeholder="至少 4 碼"><button type="button" class="btn ghost" id="ad-code-go" style="flex:0 0 auto">更換</button></div><span class="hint">換了之後，大家要重新輸入新代碼。</span></div>
    </div>
    <div class="card"><h2>跑者（${d.runners.length}）</h2>
      ${d.runners.map(r => `<div class="adm-row"><span><b>${esc(r.nick)}</b> #${esc(r.bib)}・${catName(r.cat)}<br><small style="color:#6b7280">${r.pings} 點・最後 ${r.last ? fmtClock(Date.parse(r.last)) : '—'}${r.failed ? `・PIN 錯 ${r.failed} 次` : ''}</small></span>
        <button type="button" class="btn ghost" data-pin="${esc(r.bib)}">重設 PIN</button><button type="button" class="btn danger" data-rm="${esc(r.bib)}">移除</button></div>`).join('') || '<p>還沒有人</p>'}
      <div class="btns"><button type="button" class="btn danger" id="ad-clear">清除全部定位紀錄</button></div>
    </div>`;
  $('#ad-save').onclick = async () => {
    const starts = {}; for (const k of Object.keys(CAT)) { const v = $(`#ad-s-${k}`).value; if (v) starts[k] = v.slice(0, 5); }
    const config = { ...cfg, date: $('#ad-date').value, starts, useRoute: $('#ad-route').checked };
    try { await admin('set_config', { config, name: $('#ad-name').value.trim() }); toast('設定已儲存'); await poll(true); loadAdmin(); } catch (e) { toast(e.message); }
  };
  $('#ad-code-go').onclick = async () => {
    const c = $('#ad-code').value.trim().toLowerCase(); if (c.length < 4) return toast('代碼至少 4 碼');
    if (!await confirmBox(`團體代碼改成「${c}」？大家都要重新輸入。`, '更換')) return;
    try { await admin('set_view_code', { code: c }); S.code = c; store.set('code', c); toast('代碼已更換'); } catch (e) { toast(e.message); }
  };
  $('#ad-clear').onclick = async () => {
    if (!await confirmBox('清除這個場次所有人的定位紀錄（跑者名單保留），無法復原。', '清除')) return;
    try { const r = await admin('clear_points'); toast(`已清除 ${r.cleared} 點`); await poll(true); loadAdmin(); } catch (e) { toast(e.message); }
  };
  box.onclick = async ev => {
    const rm = ev.target.closest('[data-rm]'), pin = ev.target.closest('[data-pin]');
    if (rm) {
      if (!await confirmBox(`移除 #${rm.dataset.rm} 和他的定位紀錄？`, '移除')) return;
      try { await admin('remove', { bib: rm.dataset.rm }); toast('已移除'); await poll(true); loadAdmin(); } catch (e) { toast(e.message); }
    }
    if (pin) {
      const p = String(Math.floor(1000 + Math.random() * 9000));
      if (!await confirmBox(`把 #${pin.dataset.pin} 的 PIN 重設為 ${p}？（請把新 PIN 告訴本人，他舊手機會被登出）`, '重設')) return;
      try { await admin('reset_pin', { bib: pin.dataset.pin, pin: p }); toast(`已重設，新 PIN：${p}`); loadAdmin(); } catch (e) { toast(e.message); }
    }
  };
}

boot();
