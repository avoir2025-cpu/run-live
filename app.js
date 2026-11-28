import { CAT, ROUTES, loadRoutes, analyze, routeOf, etaAt, passesAt, fmtPace, fmtHMS, fmtClock, fmtAgo, parseHMS, gunTime, hav, bindTimeInput, limitOf } from './calc.js?v=10';
import { SB_URL, SB_KEY } from './config.js';
import { lineOn, lineToken, resumeLine, lineCall, tokenFresh } from './line.js?v=3';

// ---------- 基本 ----------
const qs = new URLSearchParams(location.search);
// LINE 登入回來時，參數會被包進 liff.state（例如 ?liff.state=%3Ft%3Dtcu2027&code=…），要拆開來讀
const liffState = qs.get('liff.state');
const TEAM = qs.get('t') || (liffState ? new URLSearchParams(liffState.slice(liffState.indexOf('?') + 1)).get('t') : '') || '';
const K = k => `rl_${TEAM}_${k}`;
// 跨場次共用（團體代碼、上次看的賽事）
const G = {
  get(k) { try { return JSON.parse(localStorage.getItem('rl__' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('rl__' + k, JSON.stringify(v)); } catch { } },
};
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(K(k))); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(K(k), JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(K(k)); } catch { } },
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initial = s => { const a = Array.from(String(s || '?').trim()); const c = a[0] || '?'; if (c.charCodeAt(0) < 128) return c.toUpperCase(); return a.length >= 3 ? a.slice(-2).join('') : a.join(''); };
const catName = c => CAT[c]?.name || c;
const catVar = c => ({ full: '--full', half: '--half', '12k': '--k12', '10k': '--k10', '5k': '--k5', '3k5': '--k35', '3k': '--k3' }[c] || '--k5');
const cvar = c => `var(${catVar(c)})`;
const hm = s => s ? `${Math.floor(s / 3600)}:${String(Math.round(s % 3600 / 60)).padStart(2, '0')}` : '';
const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  run: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="14" cy="4.5" r="2"/><path d="M7 21l3-6 3 2v5M10 15l1-5 4 2 3-1M11 10l-3 1-2 3"/></svg>',
  cheer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  me: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>',
  tap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11V5a2 2 0 0 1 4 0v6M13 10a2 2 0 0 1 4 0v2M17 11a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-3-5a2 2 0 0 1 3-2l2 2"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
};

const ERR = {
  bad_code: '團體代碼不對', bib_taken: '這個號碼布已經有人登記了', nick_taken: '這個暱稱已經有人用了，換一個吧',
  bad_bib: '號碼布只能是英文或數字，最多 8 碼', bad_nick: '暱稱要 1 到 12 個字', bad_pin: 'PIN 要 4 位數字',
  no_runner: '找不到這位跑者', locked: 'PIN 錯太多次被鎖住了，請跑團管理者幫你重設',
  bad_token: '登入已失效，請重新登入', bad_target: '目標時間不合理', bad_finish: '完賽時間不合理',
  bad_admin: '管理碼不對', team_full: '人數已滿', bad_cat: '請選組別', bad_code_len: '代碼至少 4 碼',
};
async function rpc(fn, args) {
  let r;
  try { r = await fetch(SB_URL + fn, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); }
  catch { const e = new Error('網路不穩，請稍後再試'); e.code = 'net'; throw e; }
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(ERR[j?.message] || '伺服器忙碌，請稍後再試'); e.code = j?.message; throw e; }
  return j;
}

// 群組連結帶代碼：#k=代碼（不會送到伺服器），讀完就從網址拿掉
{
  const m = location.hash.match(/k=([^&]+)/);
  if (m) { const c = decodeURIComponent(m[1]).trim().toLowerCase(); G.set('code', c); if (TEAM) store.set('code', c); history.replaceState(null, '', location.pathname + location.search); }
}
// LINE 內建瀏覽器：建議外開
if (/\bLine\//i.test(navigator.userAgent)) {
  $('#line-tip').hidden = false;
  const u = new URL(location.href); u.searchParams.set('openExternalBrowser', '1');
  const code = (TEAM && store.get('code')) || G.get('code'); if (code) u.hash = 'k=' + encodeURIComponent(code);
  $('#line-open').href = u.toString();
}

// ---------- 狀態 ----------
const S = {
  code: (TEAM && store.get('code')) || G.get('code'), token: store.get('token'), me: store.get('me'), watcher: store.get('watcher'),
  team: null, runners: [], pts: new Map(), since: null, online: false, lastPoll: 0,
  filter: store.get('filter') || 'all', cheer: store.get('cheer') || { type: 'finish' },
  tab: 'live', sel: null, picking: false, adminCode: null, expanded: false,
  follow: new Set(store.get('follow') || []),
};
const Q = { list: store.get('queue') || [], sending: false, lastSent: store.get('lastSent') };
const GEO = { watchId: null, lastT: 0, last: null, acc: null, err: null, wake: null };

// ---------- 小工具 ----------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
function confirmBox(msg, yes = '確定') {
  const d = $('#dlg-confirm'); $('#dlg-msg').textContent = msg; $('#dlg-yes').textContent = yes; d.showModal();
  return new Promise(res => {
    const done = v => { if (d.open) d.close(); res(v); };
    $('#dlg-yes').onclick = () => done(true); $('#dlg-no').onclick = () => done(false); d.oncancel = () => done(false);
  });
}
function openSheet(title, html, bind) {
  const d = $('#dlg-sheet'); $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html;
  if (!d.open) d.showModal();
  bind?.($('#sheet-body'));
}
const closeSheet = () => { const d = $('#dlg-sheet'); if (d.open) d.close(); };
$('#sheet-close').onclick = closeSheet;
$('#dlg-sheet').addEventListener('click', ev => { if (ev.target === ev.currentTarget) closeSheet(); });
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-eye]'); if (!b) return;
  const i = document.getElementById(b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password';
  b.textContent = i.type === 'password' ? '顯示' : '隱藏';
});
const pinField = (id, label, hint, ac = 'new-password') => `<div class="field"><label for="${id}">${label}</label>
  <div class="row"><input class="grow" id="${id}" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="${ac}" enterkeyhint="done"><button type="button" class="btn ghost" data-eye="${id}">顯示</button></div>
  ${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;

// 比賽階段
function phase(cat) {
  const cfg = S.team?.config; if (!cfg) return 'pre';
  const gun = gunTime(cfg, cat), now = Date.now(), lim = limitOf(cfg, cat) * 1000;
  if (now < gun - 90 * 60e3) return 'pre';
  if (now <= gun + lim + 60 * 60e3) return 'race';
  return 'post';
}

// ---------- 賽事選單 ----------
async function showPicker() {
  $('#boot').hidden = true; $('#gate').hidden = true; $('#app').hidden = true;
  const el = $('#onboard'); el.hidden = false;
  el.innerHTML = `<div class="ob"><div class="ob-top"><div class="logo sm"><span class="pulse"></span>跑團 <b>LIVE</b></div></div><h1>選擇賽事</h1><p class="lead">每場賽事有自己的地圖和名單。</p><div id="ev-list"><p class="note">載入中…</p></div></div>`;
  let evs = [];
  try { evs = await rpc('runlive_events', {}); }
  catch (e) { $('#ev-list').innerHTML = `<p class="note">${esc(e.message)}</p><button type="button" class="btn dark" id="ev-retry">再試一次</button>`; $('#ev-retry').onclick = showPicker; return; }
  const last = G.get('last'), now = Date.now();
  const card = e => {
    const gun = Date.parse(`${e.date}T${(e.starts && Object.values(e.starts).sort()[0]) || '06:00'}:00+08:00`);
    const days = Math.ceil((gun - now) / 86400e3);
    const when = isNaN(gun) ? '' : now > gun + 12 * 3600e3 ? '已結束' : days > 1 ? `還有 ${days} 天` : days === 1 ? '明天' : '今天';
    const dt = e.date ? Date.parse(e.date + 'T12:00:00+08:00') : NaN;
    const d = isNaN(dt) ? '' : new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Taipei' }).format(dt);
    const wd = isNaN(dt) ? '' : new Intl.DateTimeFormat('zh-TW', { weekday: 'short', timeZone: 'Asia/Taipei' }).format(dt);
    return `<button type="button" class="ev ${e.practice ? 'practice' : ''}" data-ev="${esc(e.slug)}">
      <span class="ev-date"><b>${esc(d)}</b><small>${esc(wd)}</small><small>${esc(when)}</small></span>
      <span class="ev-main"><b>${esc(e.name)}</b><span>${(e.cats || []).map(c => `<i class="tag">${catName(c)}</i>`).join('')}${e.runners ? `<i class="tag">${e.runners} 人加入</i>` : ''}${e.slug === last ? '<i class="tag last">上次看的</i>' : ''}</span></span>
      ${'<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'}</button>`;
  };
  const races = evs.filter(e => !e.practice), prac = evs.filter(e => e.practice);
  $('#ev-list').innerHTML = (races.map(card).join('') || '<p class="note">目前沒有賽事</p>') +
    (prac.length ? `<div class="grp" style="margin-top:22px">練習</div>${prac.map(card).join('')}` : '');
  $('#ev-list').onclick = ev => { const b = ev.target.closest('[data-ev]'); if (b) location.href = '?t=' + encodeURIComponent(b.dataset.ev); };
}

// ---------- 開場 ----------
async function boot() {
  if (!TEAM) return showPicker();
  G.set('last', TEAM);
  if (!S.code) return showGate();
  try { await poll(true); }
  catch (e) {
    if (e.code === 'bad_code') { store.del('code'); S.code = null; return showGate('這場賽事的代碼不一樣，請輸入'); }
    toast('連不上伺服器，稍後會自動重試');
  }
  await loadRoutes(TEAM, S.team?.config?.routes);
  if (S.token) {
    rpc('runlive_me', { p_token: S.token }).then(me => { S.me = me; store.set('me', me); renderAll(); })
      .catch(e => { if (e.code === 'bad_token') { logoutLocal(); toast('這支手機已登出（可能在別支手機登入過）'); } });
  }
  const lr = lineOn() ? await resumeLine(TEAM) : null;
  if (lr) await onLine(lr);
  else if (S.me || S.watcher) showApp(); else showOnboard('role');
  if (store.get('sharing') && S.token) startShare(true);
  if (store.get('wake')) setWake(true);
}

function showGate(msg) {
  $('#boot').hidden = true;
  $('#gate').hidden = false; $('#app').hidden = true; $('#onboard').hidden = true;
  rpc('runlive_events', {}).then(evs => { const e = evs.find(x => x.slug === TEAM); if (e) $('#gate-sub').textContent = `${e.name}・${e.date}`; }).catch(() => { });
  $('#gate-switch').onclick = () => { location.href = './'; };
  if (msg) toast(msg);
  $('#gate-form').onsubmit = async ev => {
    ev.preventDefault();
    const code = $('#gate-code').value.trim().toLowerCase();
    try {
      const st = await rpc('runlive_state', { p_team: TEAM, p_code: code, p_since: null });
      S.code = code; store.set('code', code); G.set('code', code); applyState(st, true);
      await loadRoutes(TEAM, S.team?.config?.routes);
      $('#gate').hidden = true;
      if (S.me || S.watcher) showApp(); else showOnboard('role');
    } catch (e) { toast(e.message); }
  };
  setTimeout(() => $('#gate-code').focus(), 50);
}

// ---------- 新手流程 ----------
const J = { cat: null, nick: '', bib: '', target: null, pick: null, line: null };

// ---------- 用 LINE 登入／綁定 ----------
// from：join（加入第一步按的）／login（換手機畫面按的）／bind（我頁按的）
async function lineGo(from) {
  if (from === 'join') saveJ1Now();
  const extra = { from, J: from === 'join' ? { cat: J.cat, nick: J.nick, bib: J.bib } : null };
  try { const t = await lineToken(from, TEAM, extra); await onLine({ intent: from, extra, idToken: t }); }
  catch (e) { toast(e.message); }
}
async function onLine(p) {
  const from = p.extra?.from || p.intent;
  if (p.extra?.J) Object.assign(J, p.extra.J);
  const fallback = () => from === 'bind' ? (showApp(), setTab('me')) : S.me ? showApp() : showOnboard(from === 'login' ? 'login' : from === 'join' ? 'join1' : 'role');
  if (p.error) { toast(p.error); return fallback(); }
  try {
    if (from === 'bind') {
      await lineCall('bind', { id_token: p.idToken, token: S.token });
      S.me = { ...S.me, line: true }; store.set('me', S.me); toast('已綁定 LINE，換手機直接用 LINE 登入');
      showApp(); setTab('me'); return;
    }
    const res = await lineCall('login', { id_token: p.idToken, team: TEAM, code: S.code });
    if (res.bound) {
      const { bound, ...rest } = res; setLogin(rest); toast(`歡迎回來，${res.nick}`);
      await poll(true).catch(() => { }); return showApp();
    }
    if (from === 'login') { toast('這個 LINE 還沒綁定。請點你的名字用 PIN 登入，之後到「我」綁定 LINE'); return showOnboard('login'); }
    J.line = p.idToken;
    if (!J.nick) J.nick = res.nick || res.name || '';
    toast(res.nick ? `已連結 LINE，暱稱沿用「${res.nick}」` : '已連結 LINE，選組別就能加入');
    showOnboard('join1');
  } catch (e) { toast(e.message); fallback(); }
}
function saveJ1Now() { const n = $('#o-nick'), b = $('#o-bib'); if (n) J.nick = n.value.trim(); if (b) J.bib = b.value.trim(); }
const lineBtn = (from, label) => lineOn() ? `<button type="button" class="btn line block lg" data-line="${from}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8.1-6C21.4 14.3 22 12.7 22 11c0-4.4-4.5-8-10-8z"/></svg>${label}</button>` : '';
const TARGETS = {
  full: ['3:30', '4:00', '4:30', '5:00', '5:30', '6:00'], half: ['1:45', '2:00', '2:15', '2:30', '2:45', '3:00'],
  '12k': ['1:00', '1:10', '1:20', '1:30', '1:45', '2:00'],
  '10k': ['0:50', '1:00', '1:10', '1:20', '1:30', '1:45'], '5k': ['0:25', '0:30', '0:35', '0:40', '0:50', '1:00'],
  '3k5': ['0:20', '0:25', '0:30', '0:35', '0:45', '0:55'], '3k': ['0:15', '0:18', '0:20', '0:25', '0:30', '0:40'],
};
function showOnboard(step) {
  $('#boot').hidden = true;
  $('#gate').hidden = true; $('#app').hidden = true;
  const el = $('#onboard'); el.hidden = false;
  const top = (back, n) => `<div class="ob-top">${back ? `<button type="button" class="ob-back" data-go="${back}">← 上一步</button>` : '<button type="button" class="ob-back" data-go="picker">← 換賽事</button>'}
    ${n ? `<div class="ob-steps"><i class="${n >= 1 ? 'on' : ''}"></i><i class="${n >= 2 ? 'on' : ''}"></i></div>` : ''}</div>`;
  let h = '';
  if (step === 'role') {
    h = `${top()}<h1>${esc(S.team?.name || '跑團 LIVE')}</h1><p class="lead">比賽當天看大家跑到哪、幾點會到。</p>
      <button type="button" class="role main" data-go="join1"><span class="ic">${ICON.run}</span><span><b>我要跑</b><span>加入地圖，比賽時分享位置</span></span></button>
      <button type="button" class="role" data-go="watch"><span class="ic">${ICON.cheer}</span><span><b>我是加油團</b><span>不用加入，直接看</span></span></button>
      <p style="text-align:center;margin-top:18px;color:var(--mute)">已經加入過了？<button type="button" class="linkbtn" data-go="login">換手機登入</button></p>`;
  } else if (step === 'join1') {
    h = `${top('role', 1)}<h1>加入跑團地圖</h1><p class="lead">地圖和名單上會顯示你的暱稱。</p>
      ${J.line ? '<p class="line-ok">✓ 已連結 LINE，換手機直接用 LINE 登入，不用設 PIN</p>' : lineOn() ? `${lineBtn('join', '用 LINE 加入（換手機免 PIN）')}<p class="or"><span>或直接填</span></p>` : ''}
      <div class="field"><span class="lbl">組別</span><div class="opts" id="o-cat">${offered().map(([k, c]) => `<button type="button" class="opt" data-cat="${k}" aria-pressed="${J.cat === k}">${c.name}<small>${+(c.len / 1000).toFixed(1)} km</small></button>`).join('')}</div></div>
      <div class="field"><label for="o-nick">暱稱</label><input id="o-nick" type="text" maxlength="12" autocomplete="nickname" enterkeyhint="next" value="${esc(J.nick)}"></div>
      <div class="field"><label for="o-bib">號碼布（選填）</label><input id="o-bib" type="text" inputmode="numeric" maxlength="8" enterkeyhint="done" value="${esc(J.bib)}"><span class="hint">大會物資約賽前一週寄到，收到再補也可以。</span></div>
      <button type="button" class="btn primary block lg" id="o-next">下一步</button>`;
  } else if (step === 'join2') {
    const list = TARGETS[J.cat] || [];
    h = `${top('join1', 2)}<h1>${J.line ? '目標時間' : '目標時間和 PIN'}</h1><p class="lead">還沒有定位時，會用目標配速推算你的位置。</p>
      <div class="field"><span class="lbl">目標完賽時間</span><div class="opts" id="o-tgt">${list.map(t => `<button type="button" class="opt" data-t="${t}" aria-pressed="${J.pick === t}"><span class="num">${t}</span></button>`).join('')}
</div><div class="opts" style="grid-template-columns:1fr 1fr;margin-top:8px"><button type="button" class="opt" data-t="none" aria-pressed="${J.pick === 'none'}">還不確定</button><button type="button" class="opt" data-t="custom" aria-pressed="${J.pick === 'custom'}">自己填</button></div>
        <input id="o-tgt-c" type="text" inputmode="numeric" placeholder="0:00" ${J.pick === 'custom' ? '' : 'hidden'}><span class="hint" ${J.pick === 'custom' ? '' : 'hidden'} id="o-tgt-h">直接打數字，例如 4 小時 15 分打 415</span></div>
      ${J.line ? '' : pinField('o-pin', '設一組 4 位數 PIN', '換手機時，點你的名字再輸入 PIN 就能登入。')}
      <button type="button" class="btn primary block lg" id="o-done">完成加入</button>`;
  } else if (step === 'done') {
    h = `<div class="ob-top"></div><div class="done-hero"><div class="big">🎉</div><h1 style="margin-top:12px">${esc(S.me?.nick)}，加入完成！</h1></div>
      <ol class="steps-list"><li>比賽當天打開這個網頁</li><li>按底部的「出發」，開始分享位置</li><li>跑完填正式成績，做一張完賽圖卡</li></ol>
      <p class="note">建議現在先試一次定位，手機會問你要不要允許使用位置，請按「允許」。</p>
      <button type="button" class="btn primary block lg" id="o-test">試一下定位</button>
      <button type="button" class="btn ghost block" style="margin-top:10px" data-go="app">先看地圖</button>`;
  } else if (step === 'follow') {
    h = `${top()}<h1>你想關注誰？</h1><p class="lead">只看你在乎的人。之後在「我」也能改，只存在這支手機。</p>
      ${followGridHtml()}
      <button type="button" class="btn primary block lg" id="o-fav-done" style="margin-top:18px">完成</button>
      <button type="button" class="btn ghost block" style="margin-top:10px" data-go="app">先看全部的人</button>`;
  } else if (step === 'login') {
    const rs = [...S.runners].sort((a, b) => a.nick.localeCompare(b.nick, 'zh-Hant'));
    h = `${top('role')}<h1>點你的名字</h1><p class="lead">接著輸入你加入時設的 PIN。</p>
      ${lineOn() ? `${lineBtn('login', '綁過 LINE？用 LINE 登入')}<p class="or"><span>或點名字</span></p>` : ''}
      <input id="o-q" type="search" placeholder="搜尋暱稱或號碼" aria-label="搜尋">
      <div class="namegrid" id="o-names">${rs.map(r => `<button type="button" data-rid="${r.id}" data-q="${esc((r.nick + ' ' + (r.bib || '')).toLowerCase())}">${esc(r.nick)}<small>${catName(r.cat)}${r.bib ? '・' + esc(r.bib) : ''}</small></button>`).join('') || '<p class="note">還沒有人加入</p>'}</div>`;
  } else if (step.startsWith('pin:')) {
    const r = S.runners.find(x => x.id === step.slice(4));
    h = `${top('login')}<h1>嗨，${esc(r?.nick)}</h1><p class="lead">輸入你的 PIN。登入後，舊手機會自動登出。</p>
      ${pinField('o-lpin', 'PIN', '忘記 PIN 的話，請跑團管理者幫你重設。', 'current-password')}
      <button type="button" class="btn primary block lg" id="o-login" data-rid="${esc(r?.id)}">登入</button>`;
  }
  el.innerHTML = `<div class="ob">${h}</div>`;
  bindOnboard(step);
}
function bindOnboard(step) {
  const el = $('#onboard');
  el.onclick = async ev => {
    const ln = ev.target.closest('[data-line]');
    if (ln) return lineGo(ln.dataset.line);
    const go = ev.target.closest('[data-go]');
    if (go) {
      const g = go.dataset.go;
      if (g === 'watch') { S.watcher = true; store.set('watcher', true); return S.runners.length ? showOnboard('follow') : showApp(); }
      if (g === 'picker') { location.href = './'; return; }
      if (g === 'app' || (g === 'role' && S.watcher)) return showApp();
      if (step === 'join1') saveJ1();
      return showOnboard(g);
    }
    const c = ev.target.closest('[data-cat]');
    if (c) { J.cat = c.dataset.cat; J.pick = null; el.querySelectorAll('[data-cat]').forEach(b => b.setAttribute('aria-pressed', b === c)); }
    const t = ev.target.closest('[data-t]');
    if (t) { J.pick = t.dataset.t; el.querySelectorAll('[data-t]').forEach(b => b.setAttribute('aria-pressed', b === t)); $('#o-tgt-c').hidden = $('#o-tgt-h').hidden = J.pick !== 'custom'; if (J.pick === 'custom') $('#o-tgt-c').focus(); }
    const n = ev.target.closest('#o-names [data-rid]');
    if (n) showOnboard('pin:' + n.dataset.rid);
  };
  const saveJ1 = () => { J.nick = $('#o-nick')?.value.trim() ?? J.nick; J.bib = $('#o-bib')?.value.trim() ?? J.bib; };
  if (step === 'join1') {
    $('#o-next').onclick = () => {
      saveJ1();
      if (!J.cat) return toast('先選組別');
      if (!J.nick) { $('#o-nick').focus(); return toast('填一個暱稱'); }
      if (S.runners.some(r => r.nick.toLowerCase() === J.nick.toLowerCase())) return toast(ERR.nick_taken + '。如果是你本人，請回上一步按「換手機登入」');
      if (J.bib && !/^[A-Za-z0-9-]{1,8}$/.test(J.bib)) return toast(ERR.bad_bib);
      showOnboard('join2');
    };
  }
  if (step === 'join2') {
    bindTimeInput($('#o-tgt-c'), false);
    $('#o-done').onclick = async () => {
      let target = null;
      if (J.pick === 'custom') { target = parseHMS($('#o-tgt-c').value); if (!target) return toast('先填目標時間，分鐘不能超過 59'); }
      else if (J.pick && J.pick !== 'none') target = parseHMS(J.pick);
      // 用 LINE 加入：PIN 自動產生（備援用，LINE 綁定失敗才會告訴本人）
      const pin = J.line ? String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0') : $('#o-pin').value.trim();
      if (!/^\d{4}$/.test(pin)) { $('#o-pin').focus(); return toast(ERR.bad_pin); }
      $('#o-done').disabled = true;
      try {
        const res = await rpc('runlive_join', { p_team: TEAM, p_code: S.code, p_bib: J.bib || null, p_nick: J.nick, p_cat: J.cat, p_target_sec: target, p_pin: pin });
        setLogin(res);
        let linePinMsg = '';
        if (J.line) {
          try { if (!tokenFresh(J.line)) throw new Error('expired'); await lineCall('bind', { id_token: J.line, token: res.token }); S.me = { ...S.me, line: true }; store.set('me', S.me); }
          catch { linePinMsg = pin; }
          J.line = null;
        }
        await poll(true).catch(() => { }); showOnboard('done');
        if (linePinMsg) openSheet('LINE 綁定沒成功', `<p>你已經加入了，但 LINE 沒綁上。換手機時請點你的名字，輸入這組 PIN：</p><p class="num" style="font-size:40px;text-align:center;letter-spacing:.2em;margin:12px 0">${linePinMsg}</p><p class="note">也可以到「我」重新綁定 LINE。</p>`);
      } catch (e) { toast(e.message); $('#o-done').disabled = false; }
    };
  }
  if (step === 'done') $('#o-test').onclick = () => { showApp(); startShare(); };
  if (step === 'follow') {
    const upd = () => { const n = favCount(); $('#o-fav-done').textContent = n ? `完成，只看這 ${n} 人` : '完成'; };
    bindFollowGrid(el, upd); upd();
    $('#o-fav-done').onclick = () => { if (favCount()) { S.filter = 'fav'; store.set('filter', 'fav'); } showApp(); };
  }
  if (step === 'login') {
    $('#o-q').oninput = ev => { const q = ev.target.value.trim().toLowerCase(); $('#o-names').querySelectorAll('[data-q]').forEach(b => b.hidden = q && !b.dataset.q.includes(q)); };
  }
  if (step.startsWith('pin:')) {
    setTimeout(() => $('#o-lpin').focus(), 50);
    $('#o-login').onclick = async () => {
      try {
        const res = await rpc('runlive_login_id', { p_team: TEAM, p_code: S.code, p_id: $('#o-login').dataset.rid, p_pin: $('#o-lpin').value.trim() });
        if (res.error) return toast(res.left > 0 ? `PIN 不對，還可以試 ${res.left} 次` : ERR.locked);
        setLogin(res); toast(`歡迎回來，${res.nick}`); await poll(true).catch(() => { }); showApp();
      } catch (e) { toast(e.message); }
    };
  }
}

function setLogin(res) {
  S.token = res.token; store.set('token', res.token);
  const { token, ...me } = res; S.me = me; store.set('me', me); S.watcher = false; store.del('watcher');
}
function logoutLocal() {
  stopShare(); S.token = null; S.me = null; store.del('token'); store.del('me'); store.del('arrived'); Q.list = []; store.set('queue', []);
}

// ---------- 主畫面 ----------
let mapReady = false;
function showApp() {
  $('#boot').hidden = true;
  $('#gate').hidden = true; $('#onboard').hidden = true; $('#app').hidden = false;
  if (!mapReady) { initMap(); mapReady = true; }
  setTab(S.tab); renderAll(); setTimeout(fitAll, 200);
}
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#btn-event').onclick = () => { location.href = './'; };
$('#tab-card').href = 'card.html?t=' + encodeURIComponent(TEAM);
const offered = () => { const c = S.team?.config?.cats; return Object.entries(CAT).filter(([k]) => !c || c.includes(k)); };
function setTab(tab) {
  S.tab = tab;
  $('#view-live').hidden = tab !== 'live'; $('#view-me').hidden = tab !== 'me';
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (tab === 'live' && map) setTimeout(() => map.invalidateSize(), 30);
  renderAll();
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
  $('#ev-name').textContent = S.team?.config?.short || S.team?.name || '賽事';
  document.title = `跑團 LIVE｜${S.team?.config?.short || S.team?.name || ''}`;
  if (S.me) {
    const m = S.runners.find(r => r.id === S.me.id);
    if (m) { S.me = { ...S.me, ...m }; store.set('me', S.me); }
  }
}
async function poll(full = false) {
  const st = await rpc('runlive_state', { p_team: TEAM, p_code: S.code, p_since: full ? null : S.since });
  applyState(st, full); renderAll();
}
setInterval(() => {
  if (document.visibilityState !== 'visible' || !S.code || $('#app').hidden) return;
  poll(Date.now() - S.lastPoll > 10 * 60e3).catch(() => { S.online = false; renderTop(); });
}, 20000);
setInterval(() => { if (!$('#app').hidden) renderAll(); }, 30000);
setInterval(() => { if (!$('#app').hidden) renderTop(); }, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (store.get('wake')) setWake(true);
  flush(); if (S.code && !$('#app').hidden) poll(Date.now() - S.lastPoll > 10 * 60e3).catch(() => { });
});
addEventListener('online', () => { flush(); poll().catch(() => { }); });

// ---------- 分析 ----------
let AN = new Map();
function analyzeAll() {
  const now = Date.now(); AN = new Map();
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
  if ($('#app').hidden) return;
  analyzeAll(); renderTop(); renderCTA();
  if (S.tab === 'live') { renderFilter(); renderMap(); renderList(); renderSel(); }
  if (S.tab === 'me') renderMe();
}
function renderTop() {
  const cfg = S.team?.config; if (!cfg) return;
  // 倒數看這場最早鳴槍的組別（台中都會半馬、台南古都沒有全馬）
  const cats = offered().map(([k]) => k).sort((a, b) => gunTime(cfg, a) - gunTime(cfg, b));
  const c0 = cats[0] || 'full', now = Date.now(), el = $('#race-clock');
  const gun = gunTime(cfg, c0);
  const endT = Math.max(...(cats.length ? cats : ['full']).map(c => gunTime(cfg, c) + limitOf(cfg, c) * 1000));
  let h;
  if (now < gun) {
    const s = (gun - now) / 1000, d = Math.floor(s / 86400);
    h = d >= 1 ? `<small>距離起跑</small><b>${d} 天 ${Math.floor(s % 86400 / 3600)} 小時</b>` : `<small>距離起跑</small><b>${fmtHMS(s)}</b>`;
  } else if (now < endT + 30 * 60e3) h = `<small>${esc(catName(c0))}鳴槍後</small><b>${fmtHMS((now - gun) / 1000)}</b>`;
  else h = `<small>${esc(cfg.date)}</small><b>比賽結束</b>`;
  if (el.innerHTML !== h) el.innerHTML = h;
  const n = $('#net'), on = navigator.onLine && S.online;
  n.className = 'net ' + (on ? 'on' : 'off');
  $('#net-text').textContent = on ? fmtClock(S.lastPoll) : '離線';
}

// ---------- 底部行動列 ----------
function renderCTA() {
  const el = $('#cta');
  if (!S.me) { el.hidden = true; return; }
  const a = AN.get(S.me.id), ph = phase(S.me.cat), sharing = GEO.watchId != null;
  let h = '';
  if (a?.status === 'finished') {
    h = `<span style="font-size:24px">🏁</span><div class="grow"><b>完賽 ${fmtHMS(a.finishSec)}${a.official ? '' : '（GPS）'}</b>${a.official ? '做一張完賽圖卡吧' : '記得改成大會正式成績'}</div>
      ${a.official ? `<a class="btn primary" href="${$('#tab-card').getAttribute('href')}">做圖卡</a>` : '<button type="button" class="btn primary" data-act="finish">填成績</button>'}`;
  } else if (store.get('arrived') && ph !== 'pre') {
    h = `<span style="font-size:24px">🏁</span><div class="grow"><b>辛苦了！</b>大會成績公告後回來填</div><button type="button" class="btn primary" data-act="finish">填成績</button>`;
  } else if (sharing) {
    h = `<span class="live-ind"></span><div class="grow"><b>正在分享位置</b>${Q.lastSent ? `${fmtClock(Q.lastSent)} 已上傳` : '等待 GPS…'}${Q.list.length ? `・待傳 ${Q.list.length}` : ''}</div>
      ${ph === 'race' ? '<button type="button" class="btn dark" data-act="arrive">到終點了</button>' : '<button type="button" class="btn ghost" data-act="stop">停止</button>'}`;
  } else if (ph === 'race') {
    h = `<div class="grow"><b>比賽中請保持分享位置</b>鎖螢幕會暫停，打開這頁就會補上</div><button type="button" class="btn primary lg" data-act="go">出發</button>`;
  }
  el.hidden = !h; if (h && el.innerHTML !== h) el.innerHTML = h;
}
$('#cta').addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'go') goStart();
  if (act === 'stop') stopShare();
  if (act === 'arrive') arrive();
  if (act === 'finish') openFinish();
});
async function arrive() {
  const a = AN.get(S.me.id), left = a ? (a.len - (a.dNow || 0)) / 1000 : 0;
  if (left > 2 && !await confirmBox(`你目前大約在 ${((a.dNow || 0) / 1000).toFixed(1)}K，確定到終點了嗎？按下去會停止分享位置。`, '到終點了')) return;
  stopShare(); store.set('arrived', Date.now()); openFinish(true); renderAll();
}
async function goStart() {
  store.del('arrived');
  startShare();
  const gun = gunTime(S.team?.config, S.me.cat), now = Date.now();
  if (now >= gun && now - gun < 75 * 60e3 && !S.me.start_at) {
    await update({ start_at: new Date().toISOString() }, `出發！已記錄你過起跑線的時間 ${fmtClock(now)}`);
  } else toast('出發！開始分享位置');
}

// ---------- 篩選 ----------
// ---------- 關注 ----------
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const favCount = () => S.runners.filter(r => S.follow.has(r.id)).length;
function toggleFollow(id) {
  const r = S.runners.find(x => x.id === id);
  if (S.follow.has(id)) { S.follow.delete(id); toast(`已取消關注 ${r?.nick || ''}`); }
  else { S.follow.add(id); toast(`已關注 ${r?.nick || ''}`); }
  store.set('follow', [...S.follow]);
  if (S.filter === 'fav' && !favCount()) { S.filter = 'all'; store.set('filter', 'all'); }
  renderAll();
}
const followGridHtml = () => {
  const rs = [...S.runners].sort((a, b) => a.nick.localeCompare(b.nick, 'zh-Hant'));
  return `<input type="search" class="f-q" placeholder="搜尋暱稱或號碼" aria-label="搜尋">
    <div class="namegrid">${rs.map(r => `<button type="button" data-fid="${r.id}" aria-pressed="${S.follow.has(r.id)}" data-q="${esc((r.nick + ' ' + (r.bib || '')).toLowerCase())}">${esc(r.nick)}<small>${catName(r.cat)}${r.bib ? '・' + esc(r.bib) : ''}</small></button>`).join('') || '<p class="note">還沒有人加入</p>'}</div>`;
};
function bindFollowGrid(box, onChange) {
  box.querySelector('.f-q').oninput = ev => { const q = ev.target.value.trim().toLowerCase(); box.querySelectorAll('[data-fid]').forEach(b => b.hidden = q && !b.dataset.q.includes(q)); };
  box.addEventListener('click', ev => {
    const b = ev.target.closest('[data-fid]'); if (!b) return;
    const id = b.dataset.fid; S.follow.has(id) ? S.follow.delete(id) : S.follow.add(id);
    b.setAttribute('aria-pressed', S.follow.has(id)); store.set('follow', [...S.follow]); onChange?.();
  });
}
function openFollow() {
  openSheet('我關注的人', `<p class="note" style="padding:0">點名字加入或取消。只存在這支手機，別人看不到你關注誰。</p>${followGridHtml()}
    <button type="button" class="btn primary block lg" id="f-done" style="margin-top:14px">完成</button>`, body => {
    const upd = () => { $('#f-done').textContent = favCount() ? `完成，只看這 ${favCount()} 人` : '完成'; };
    bindFollowGrid(body, upd); upd();
    $('#f-done').onclick = () => { closeSheet(); if (favCount()) { S.filter = 'fav'; store.set('filter', 'fav'); } else if (S.filter === 'fav') S.filter = 'all'; if (S.tab !== 'live') setTab('live'); renderAll(); fitAll(); };
  });
}

function renderFilter() {
  const nFav = favCount();
  const cats = ['all', ...(nFav ? ['fav'] : []), ...Object.keys(CAT).filter(c => S.runners.some(r => r.cat === c))];
  if (!cats.includes(S.filter)) S.filter = 'all';
  const h = (cats.length > 2 || nFav) ? cats.map(c => `<button type="button" data-f="${c}" aria-pressed="${S.filter === c}">${c === 'all' ? '全部' : c === 'fav' ? `★ 關注 ${nFav}` : catName(c)}</button>`).join('') : '';
  const el = $('#filter'); el.hidden = !h; if (el.innerHTML !== h) el.innerHTML = h;
}
$('#filter').addEventListener('click', ev => {
  const b = ev.target.closest('[data-f]'); if (!b) return;
  S.filter = b.dataset.f; store.set('filter', S.filter); renderAll(); fitAll();
});
const shown = r => S.filter === 'all' || (S.filter === 'fav' ? (S.follow.has(r.id) || (S.me && r.id === S.me.id)) : r.cat === S.filter);

// ---------- 地圖 ----------
let map, routeLayers = {}, markers = new Map(), startMarker, cheerMarker;
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView(S.team?.config?.center || [24.205, 120.665], 12);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  for (const [cat, r] of Object.entries(ROUTES)) {
    const g = L.layerGroup(), col = getComputedStyle(document.documentElement).getPropertyValue(catVar(cat)).trim();
    L.polyline(r.pts, { color: '#fff', weight: 8, opacity: .9, interactive: false }).addTo(g);
    L.polyline(r.pts, { color: col, weight: 4, opacity: .85, interactive: false }).addTo(g);
    const rt = routeOf(cat);
    for (let km = 5; km * 1000 < r.len; km += 5) {
      const i = rt.cum.findIndex(d => d >= km * 1000);
      L.marker(r.pts[i], { icon: L.divIcon({ className: '', html: `<span class="kmk${km % 10 ? ' odd' : ''}" style="--c:${col};background:${col}">${km}K</span>`, iconSize: null }), interactive: false, keyboard: false }).addTo(g);
    }
    routeLayers[cat] = g;
  }
  const first = Object.values(ROUTES)[0];
  if (first) startMarker = L.marker(first.pts[0], { icon: L.divIcon({ className: '', html: '<span class="sf">起終點</span>', iconSize: null }), interactive: false, keyboard: false, zIndexOffset: -50 }).addTo(map);
  const zoomCls = () => { $('#map').classList.toggle('zoom-hi', map.getZoom() >= 15); $('#map').classList.toggle('zoom-mid', map.getZoom() >= 13); };
  map.on('zoomend', zoomCls); zoomCls();
  map.on('click', onMapClick);
  $('#btn-fit').onclick = fitAll;
  $('#btn-locate').onclick = () => {
    const a = S.me && AN.get(S.me.id);
    const ll = GEO.last ? [GEO.last.la, GEO.last.lo] : a?.pos;
    if (ll) map.setView(ll, 15);
    else if (S.cheer.type === 'point') map.setView([S.cheer.la, S.cheer.lo], 15);
    else toast(S.me ? '還沒有你的位置，按底部「出發」或到「我」打開分享' : '加油團可以在「看誰幾點到」設定自己的位置');
  };
  $('#btn-expand').onclick = () => {
    S.expanded = !S.expanded; $('#view-live').classList.toggle('expanded', S.expanded);
    $('#btn-expand').setAttribute('aria-pressed', S.expanded); $('#btn-expand').setAttribute('aria-label', S.expanded ? '縮小地圖' : '放大地圖');
    setTimeout(() => map.invalidateSize(), 280);
  };
}
function fitAll() {
  if (!map) return;
  const ll = [];
  for (const r of S.runners) { if (!shown(r)) continue; const a = AN.get(r.id); if (a?.pos && a.status !== 'waiting') ll.push(a.pos); }
  if (S.cheer.type === 'point') ll.push([S.cheer.la, S.cheer.lo]);
  const opt = { paddingTopLeft: [24, 64], paddingBottomRight: [64, 30], maxZoom: 15 };
  if (ll.length >= 2) map.fitBounds(L.latLngBounds(ll), opt);
  else if (ll.length === 1) map.setView(ll[0], 14);
  else {
    const r = ROUTES[S.filter] || ROUTES.full || Object.values(ROUTES)[0];
    if (r) map.fitBounds(L.latLngBounds(r.pts), opt);
    else if (GEO.last) map.setView([GEO.last.la, GEO.last.lo], 14);
    else if (S.team?.config?.center) map.setView(S.team.config.center, 14);
    else map.setView([23.75, 120.95], 8);
  }
}
function renderMap() {
  const useRoute = S.team?.config?.useRoute !== false;
  for (const [cat, g] of Object.entries(routeLayers)) {
    const on = useRoute && (S.filter === 'all' ? (S.runners.some(r => r.cat === cat) || cat === 'full') : S.filter === cat);
    if (on && !map.hasLayer(g)) g.addTo(map); else if (!on && map.hasLayer(g)) g.remove();
  }
  const waiting = S.runners.filter(r => shown(r) && AN.get(r.id)?.status === 'waiting').length;
  const sfh = `<span class="sf">${ICON.flag.replace('<svg', '<svg width="14" height="14"')}起終點${waiting ? `・${waiting} 人待起跑` : ''}</span>`;
  if (startMarker && startMarker._h !== sfh) { startMarker.setIcon(L.divIcon({ className: '', html: sfh, iconSize: null })); startMarker._h = sfh; }
  const keep = new Set();
  for (const r of S.runners) {
    const a = AN.get(r.id);
    if (!a?.pos || !shown(r) || a.status === 'waiting') continue;
    keep.add(r.id);
    const isMe = S.me && r.id === S.me.id;
    const cls = ['pin', a.estimated && a.status !== 'finished' ? 'est' : '', isMe ? 'me' : '', a.status === 'finished' ? 'done' : '', S.sel === r.id ? 'sel' : '', S.follow.has(r.id) ? 'fav' : ''].join(' ');
    const html = `<div class="${cls}" style="--c:${cvar(r.cat)}"><span class="dot">${a.status === 'finished' ? '🏁' : esc(initial(r.nick))}</span><span class="nm">${esc(r.nick)}</span></div>`;
    let m = markers.get(r.id);
    if (!m) {
      m = L.marker(a.pos, { icon: L.divIcon({ className: '', html, iconSize: null }), zIndexOffset: isMe ? 1000 : 0, title: r.nick }).addTo(map);
      m.on('click', () => selectRunner(r.id, false));
      markers.set(r.id, m);
    } else { m.setLatLng(a.pos); if (m._h !== html) m.setIcon(L.divIcon({ className: '', html, iconSize: null })); }
    m._h = html; m.setZIndexOffset(S.sel === r.id ? 2000 : isMe ? 1000 : 0);
  }
  for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id); }
  // 加油點
  if (S.cheer.type === 'point') {
    const ll = [S.cheer.la, S.cheer.lo];
    if (!cheerMarker) cheerMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: `<span class="cheer-pin">${ICON.pin}</span>`, iconSize: null }), interactive: false, zIndexOffset: 500 }).addTo(map);
    else cheerMarker.setLatLng(ll);
  } else if (cheerMarker) { cheerMarker.remove(); cheerMarker = null; }
}
function selectRunner(id, fromList) {
  S.sel = S.sel === id && !fromList ? null : id;
  const a = AN.get(id);
  if (S.sel && fromList) {
    if (a?.pos && a.status !== 'waiting') map.setView(a.pos, Math.max(map.getZoom(), 14));
    else toast(a?.status === 'waiting' ? '還沒起跑' : '這位跑者還沒有位置');
  }
  renderMap(); renderSel(); renderList();
  if (S.sel && !fromList) document.querySelector(`.rc[data-rid="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function renderSel() {
  const el = $('#sel-card'), r = S.runners.find(x => x.id === S.sel), a = r && AN.get(r.id);
  if (!r || !a) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<button type="button" class="x" aria-label="關閉" id="sel-x">✕</button><button type="button" class="fav sel-fav" aria-pressed="${S.follow.has(r.id)}" aria-label="${S.follow.has(r.id) ? '取消關注' : '關注'}">${STAR}</button>
    <div style="display:flex;gap:12px;align-items:center">${avatar(r, a)}<div style="min-width:0"><b style="font-size:17px">${esc(r.nick)}</b> <span class="tag">${catName(r.cat)}</span>${r.bib ? ` <span class="tag">#${esc(r.bib)}</span>` : ''}
    <div style="font-size:13px;color:var(--mute)">${statusText(a)}</div></div></div>
    <div class="grid2" style="margin-top:10px;grid-template-columns:repeat(3,1fr);text-align:center">
      <div><div class="num" style="font-size:24px;font-weight:700">${a.status === 'finished' ? fmtHMS(a.finishSec) : (a.dNow / 1000).toFixed(1)}</div><small style="color:var(--mute)">${a.status === 'finished' ? '完賽' : 'km'}</small></div>
      <div><div class="num" style="font-size:24px;font-weight:700">${fmtPace(a.pace)}</div><small style="color:var(--mute)">配速 /km</small></div>
      <div><div class="num" style="font-size:24px;font-weight:700">${a.status === 'finished' ? fmtClock(a.finishAt) : fmtClock(a.etaFinish)}</div><small style="color:var(--mute)">${a.status === 'finished' ? '抵達' : '預估完賽'}</small></div>
    </div>`;
  $('#sel-x').onclick = () => { S.sel = null; renderMap(); renderSel(); renderList(); };
  el.querySelector('.sel-fav').onclick = () => toggleFollow(r.id);
}
function avatar(r, a) {
  const cls = a?.status === 'waiting' ? 'wait' : a?.estimated && a.status !== 'finished' ? 'est' : '';
  const live = a && a.status === 'running' && !a.estimated;
  return `<span class="av ${cls}" style="--c:${cvar(r.cat)}">${a?.status === 'finished' ? '🏁' : esc(initial(r.nick))}${live ? '<i class="live" aria-label="即時定位中"></i>' : ''}</span>`;
}
function statusText(a) {
  switch (a.status) {
    case 'waiting': return `還沒起跑・${fmtClock(a.start)} 出發`;
    case 'nofix': return '沒開定位・用目標配速推算';
    case 'stale': return `${fmtAgo(a.age).replace('前', '')}沒更新・推算中`;
    case 'finished': return a.official ? '大會正式成績' : 'GPS 判定抵達，等本人填正式成績';
    default: return a.estimated ? `${fmtAgo(a.age)}定位・推算中` : `即時・${fmtAgo(a.age)}`;
  }
}

// ---------- 加油點 ----------
function cheerTarget(r, a) {
  // 回傳 {t, label, passed} 或 null
  const c = S.cheer;
  if (a.status === 'finished') return null;
  if (c.type === 'km') {
    if (c.km * 1000 > a.len) return null;
    const e = etaAt(a, c.km); return { ...e, label: `到 ${c.km}K` };
  }
  if (c.type === 'point') {
    const ds = c.passes?.[r.cat];
    if (!ds?.length) return null;
    const idx = ds.findIndex(d => d > (a.dNow ?? 0));
    if (idx < 0) return { passed: true, label: '經過加油點' };
    const e = etaAt(a, ds[idx] / 1000);
    return { ...e, label: ds.length > 1 ? `第 ${idx + 1} 次經過` : '經過加油點', more: ds.slice(idx + 1).map(d => fmtClock(etaAt(a, d / 1000).t)) };
  }
  return null;
}
function cheerLabel() {
  const c = S.cheer;
  if (c.type === 'km') return `${c.km} K`;
  if (c.type === 'point') return c.short || '我設定的位置';
  return '終點';
}
$('#btn-cheer').onclick = openCheer;
function openCheer() {
  const kms = [5, 10, 15, 20, 21.1, 25, 30, 35, 40, 41];
  openSheet('看誰幾點到', `
    ${Object.keys(ROUTES).length ? '' : '<p class="note" style="padding:0">這場沒有大會路線，只能用公里數或終點。</p>'}
    <button type="button" class="choice" data-c="me" ${Object.keys(ROUTES).length ? '' : 'hidden'}>${ICON.me}<span><b>用我現在的位置</b><span>站在路邊加油時最好用</span></span></button>
    <button type="button" class="choice" data-c="tap" ${Object.keys(ROUTES).length ? '' : 'hidden'}>${ICON.tap}<span><b>在地圖上點一下</b><span>先選好要去哪裡加油</span></span></button>
    <button type="button" class="choice" data-c="finish" aria-pressed="${S.cheer.type === 'finish'}">${ICON.flag}<span><b>終點</b><span>看每個人預估幾點完賽</span></span></button>
    <div class="field" style="margin-bottom:4px"><span class="lbl">或選公里數</span></div>
    <div class="kms">${kms.map(k => `<button type="button" data-km="${k}" aria-pressed="${S.cheer.type === 'km' && S.cheer.km === k}">${k}</button>`).join('')}</div>`, body => {
    body.onclick = ev => {
      const b = ev.target.closest('[data-c],[data-km]'); if (!b) return;
      if (b.dataset.km) { setCheer({ type: 'km', km: +b.dataset.km }); closeSheet(); return; }
      const c = b.dataset.c;
      if (c === 'finish') { setCheer({ type: 'finish' }); closeSheet(); }
      if (c === 'tap') {
        closeSheet(); S.picking = true; $('#map-tip').hidden = false;
        if (S.expanded) $('#btn-expand').click();
        fitAll();
      }
      if (c === 'me') {
        if (!('geolocation' in navigator)) return toast('這支手機不支援定位');
        b.disabled = true; toast('取得位置中…');
        navigator.geolocation.getCurrentPosition(p => { closeSheet(); cheerAt(p.coords.latitude, p.coords.longitude, '我的位置'); },
          () => { b.disabled = false; toast('拿不到位置，請允許瀏覽器使用定位，或改用「在地圖上點一下」'); },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
      }
    };
  });
}
function onMapClick(ev) {
  if (!S.picking) { if (S.sel) { S.sel = null; renderMap(); renderSel(); renderList(); } return; }
  cheerAt(ev.latlng.lat, ev.latlng.lng, '地圖上選的點');
}
function cheerAt(la, lo, label) {
  const passes = {};
  for (const cat of Object.keys(ROUTES)) passes[cat] = passesAt(routeOf(cat), la, lo, 150);
  if (!Object.values(passes).some(p => p.length)) {
    toast(S.picking ? '請點在路線上（離路線 150 公尺內）' : '你現在離路線超過 150 公尺，可以改用「在地圖上點一下」');
    return;
  }
  S.picking = false; $('#map-tip').hidden = true;
  const f = passes.full?.length ? passes.full : passes.half;
  const kmTxt = f.map(d => (d / 1000).toFixed(1)).join(' / ');
  setCheer({ type: 'point', la, lo, passes, label: `${label}・${kmTxt}K`, short: f.map(d => (d / 1000).toFixed(1) + 'K').join('、') });
  fitAll(); toast(f.length > 1 ? `這裡會經過 ${f.length} 次：${f.map(d => (d / 1000).toFixed(1) + 'K').join('、')}` : `加油點設在 ${kmTxt}K`);
}
function setCheer(c) { S.cheer = c; store.set('cheer', c); renderAll(); }

// ---------- 名單 ----------
function renderList() {
  $('#cheer-label').textContent = cheerLabel();
  $('#btn-cheer small').textContent = S.cheer.type === 'point' ? (S.cheer.label?.startsWith('我') ? '加油點：我的位置' : '加油點：地圖選點') : S.cheer.type === 'km' ? '加油點' : '看誰幾點到';
  const el = $('#list');
  const counts = Object.keys(CAT).map(c => [c, S.runners.filter(r => r.cat === c).length]).filter(x => x[1]);
  $('#counts').textContent = S.runners.length ? `共 ${S.runners.length} 人` : '';
  if (!S.runners.length) { el.innerHTML = '<div class="empty"><b>還沒有人加入</b>把連結分享到跑團群組吧</div>'; return; }
  let h = '';
  for (const cat of Object.keys(CAT)) {
    const rs = S.runners.filter(r => r.cat === cat && shown(r));
    if (!rs.length) continue;
    rs.sort((x, y) => {
      const a = AN.get(x.id), b = AN.get(y.id), fa = a?.status === 'finished', fb = b?.status === 'finished';
      if (fa !== fb) return fa ? 1 : -1;
      if (fa && fb) return (a.finishSec || 0) - (b.finishSec || 0);
      return (b?.dNow || 0) - (a?.dNow || 0) || x.nick.localeCompare(y.nick, 'zh-Hant');
    });
    h += `<div class="grp" style="--c:${cvar(cat)}"><i></i>${catName(cat)}・${rs.length} 人</div>`;
    for (const r of rs) {
      const a = AN.get(r.id); if (!a) continue;
      const ct = cheerTarget(r, a), isMe = S.me && r.id === S.me.id;
      let big, lbl;
      if (a.status === 'finished') { big = fmtHMS(a.finishSec); lbl = a.official ? '完賽' : '完賽（GPS）'; }
      else if (ct) { big = ct.passed ? '已過' : fmtClock(ct.t); lbl = ct.label; }
      else if (S.cheer.type !== 'finish' && a.status !== 'waiting') { big = fmtClock(a.etaFinish); lbl = S.cheer.type === 'point' ? '不經過・預估完賽' : '預估完賽'; }
      else { big = fmtClock(a.etaFinish); lbl = '預估完賽'; }
      const pct = Math.min(100, (a.dNow || 0) / a.len * 100);
      const fav = S.follow.has(r.id);
      h += `<div class="rc ${S.sel === r.id ? 'sel' : ''} ${isMe ? 'me' : ''} ${fav ? 'is-fav' : ''}" data-rid="${r.id}" style="--c:${cvar(r.cat)}">
        <button type="button" class="rc-hit" data-pick="${r.id}" aria-label="在地圖上看 ${esc(r.nick)}"></button>
        ${avatar(r, a)}
        <span class="nm"><b>${esc(r.nick)}</b>${isMe ? '<span class="tag">我</span>' : ''}${r.bib ? `<span class="tag">#${esc(r.bib)}</span>` : ''}</span>
        <span class="eta ${a.status === 'finished' ? 'done' : ''}"><b>${big}</b><small>${lbl}</small></span>
        <button type="button" class="fav" data-fav="${r.id}" aria-pressed="${fav}" aria-label="${fav ? '取消關注' : '關注'} ${esc(r.nick)}">${STAR}</button>
        <span class="sub">${statusText(a)}</span>
        <span class="bar"><span class="num">${a.status === 'finished' ? (a.len / 1000).toFixed(1) : ((a.dNow || 0) / 1000).toFixed(1)}</span><span>km</span><span class="track"><i style="width:${pct.toFixed(1)}%"></i></span><span>${a.status === 'waiting' ? (r.target_sec ? `目標 ${hm(r.target_sec)}` : '') : `${fmtPace(a.pace)}/km`}</span></span>
        ${ct?.more?.length ? `<span class="passes">之後再經過：約 ${ct.more.join('、')}</span>` : ''}
      </div>`;
    }
  }
  if (!h && S.filter === 'fav') h = '<div class="empty"><b>還沒有關注任何人</b><button type="button" class="btn dark" data-act-follow style="margin-top:10px">選要關注的人</button></div>';
  el.innerHTML = h || '<div class="empty">這個組別還沒有人</div>';
}
$('#list').addEventListener('click', ev => {
  const f = ev.target.closest('[data-fav]'); if (f) { toggleFollow(f.dataset.fav); return; }
  if (ev.target.closest('[data-act-follow]')) { openFollow(); return; }
  const b = ev.target.closest('[data-pick]'); if (b) selectRunner(b.dataset.pick, true);
});

// ---------- 定位分享 ----------
function startShare(silent) {
  if (!S.token) return;
  if (!('geolocation' in navigator)) { toast('這支手機的瀏覽器不支援定位'); return; }
  if (GEO.watchId != null) return;
  GEO.err = null;
  GEO.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
  store.set('sharing', true);
  if (!silent) toast('開始分享位置，第一次會問你要不要允許');
  renderAll();
}
function stopShare() {
  if (GEO.watchId != null) navigator.geolocation.clearWatch(GEO.watchId);
  GEO.watchId = null; store.set('sharing', false); flush(); renderAll();
}
function onPos(p) {
  const { latitude: la, longitude: lo, accuracy: a } = p.coords;
  const t = Math.round(p.timestamp || Date.now());
  const first = GEO.acc == null; GEO.acc = a; GEO.err = null;
  if (first) toast('定位成功！');
  if (a > 100) { renderAll(); return; }
  const moved = GEO.last ? hav(GEO.last.la, GEO.last.lo, la, lo) : Infinity;
  if (t - GEO.lastT < 10000 && moved < 30) return;
  GEO.lastT = t;
  GEO.last = { t, la: +la.toFixed(6), lo: +lo.toFixed(6), a: Math.round(a) };
  Q.list.push(GEO.last); if (Q.list.length > 3000) Q.list.splice(0, Q.list.length - 3000);
  store.set('queue', Q.list);
  if (Q.list.length >= 3 || !Q.lastSent || Date.now() - Q.lastSent > 15000) flush(); else renderAll();
}
function onPosErr(e) {
  GEO.err = e.code === 1 ? '位置權限被拒絕了。請到手機設定，允許這個瀏覽器使用位置，再回來打開分享。' : e.code === 3 ? '定位逾時，繼續嘗試中…' : '暫時抓不到定位，到空曠的地方比較快。';
  if (e.code === 1) { navigator.geolocation.clearWatch(GEO.watchId); GEO.watchId = null; store.set('sharing', false); toast('沒有拿到位置權限'); }
  renderAll();
}
async function flush() {
  if (Q.sending || !Q.list.length || !S.token || !navigator.onLine) return;
  Q.sending = true;
  try {
    while (Q.list.length) {
      const batch = Q.list.slice(0, 300);
      await rpc('runlive_push', { p_token: S.token, p_points: batch });
      Q.list.splice(0, batch.length); Q.lastSent = Date.now(); store.set('lastSent', Q.lastSent); store.set('queue', Q.list);
    }
  } catch (e) { if (e.code === 'bad_token') { logoutLocal(); toast('登入失效，請重新登入'); } }
  finally { Q.sending = false; renderAll(); }
}
setInterval(flush, 15000);
async function setWake(on) {
  store.set('wake', on);
  if (on) {
    if (!('wakeLock' in navigator)) { toast('這支手機不支援，請到手機設定把「自動鎖定」調長'); store.set('wake', false); renderAll(); return; }
    try { if (!GEO.wake) { GEO.wake = await navigator.wakeLock.request('screen'); GEO.wake.addEventListener('release', () => { GEO.wake = null; }); } } catch { }
  } else if (GEO.wake) { await GEO.wake.release().catch(() => { }); GEO.wake = null; }
  renderAll();
}

// ---------- 我 ----------
async function update(patch, okMsg) {
  try {
    const me = await rpc('runlive_update', { p_token: S.token, p_patch: patch });
    S.me = { ...S.me, ...me }; store.set('me', S.me); if (okMsg) toast(okMsg);
    await poll().catch(() => { }); renderAll(); return true;
  } catch (e) { toast(e.message); if (e.code === 'bad_token') { logoutLocal(); renderAll(); } return false; }
}
function shareStatus() {
  if (GEO.watchId == null) return GEO.err ? '沒有權限' : '關閉中';
  const p = [GEO.acc != null ? `精度約 ${Math.round(GEO.acc)} 公尺` : '等待 GPS…'];
  if (Q.lastSent) p.push(`${fmtClock(Q.lastSent)} 已上傳`);
  if (Q.list.length) p.push(`待傳 ${Q.list.length} 點`);
  return p.join('・');
}
function renderMe() {
  const el = $('#me');
  if (!S.me) {
    el.innerHTML = `<div class="me-head"><span class="av" style="--c:#555">${ICON.cheer.replace('<svg', '<svg width="28" height="28"')}</span><div><h2>加油團</h2><p>你正在看大家的位置</p></div></div>
      <div class="sec"><button type="button" class="item" data-follow><div class="grow"><b>我關注的人</b><span>${favCount() ? `${favCount()} 人` : '還沒選'}</span></div>${ICON.chev}</button></div>
      <div class="sec"><button type="button" class="item" data-go="join1"><div class="grow"><b>我也要跑</b><span>加入地圖，比賽時分享位置</span></div>${ICON.chev}</button>
      <button type="button" class="item" data-go="login"><div class="grow"><b>我已經加入過</b><span>換手機登入</span></div>${ICON.chev}</button></div>
      ${adminBlock()}`;
    bindMeCommon(); return;
  }
  const m = S.me, a = AN.get(m.id), cfg = S.team?.config, gun = gunTime(cfg, m.cat), sharing = GEO.watchId != null;
  el.innerHTML = `
    <div class="me-head"><span class="av" style="--c:${cvar(m.cat)}">${esc(initial(m.nick))}</span><div style="min-width:0"><h2>${esc(m.nick)}</h2><p>${catName(m.cat)}${m.bib ? `・#${esc(m.bib)}` : '・號碼布未填'}${m.target_sec ? `・目標 ${hm(m.target_sec)}` : ''}</p></div></div>
    <div class="sec"><h3>比賽當天</h3>
      <label class="item"><div class="grow"><b>分享我的位置</b><span id="share-st">${shareStatus()}</span></div><input type="checkbox" class="switch" id="sw-share" ${sharing ? 'checked' : ''} aria-label="分享我的位置"></label>
      ${GEO.err ? `<div class="warn">${esc(GEO.err)}</div>` : ''}
      <label class="item"><div class="grow"><b>螢幕常亮</b><span>手機放臂套全程定位用，很耗電</span></div><input type="checkbox" class="switch" id="sw-wake" ${store.get('wake') ? 'checked' : ''} aria-label="螢幕常亮"></label>
      <button type="button" class="item" id="it-start"><div class="grow"><b>起跑時間</b><span>${m.start_at ? '自己記錄的過線時間' : '大會鳴槍時間'}</span></div><span class="val">${fmtClock(m.start_at ? Date.parse(m.start_at) : gun)}</span>${ICON.chev}</button>
    </div>
    <p class="note">分享只在這個網頁開著時有效，鎖螢幕或切到別的 App 會暫停，回來就會補上。位置只有團內看得到，賽後一週刪除。</p>
    <div class="sec"><h3>成績</h3>
      <button type="button" class="item" id="it-finish"><div class="grow"><b>大會正式成績</b><span>${m.finish_sec ? '名單和圖卡都用這個時間' : '跑完再填，之後也能改'}</span></div><span class="val">${m.finish_sec ? fmtHMS(m.finish_sec) : '—'}</span>${ICON.chev}</button>
      <a class="item" href="${$('#tab-card').getAttribute('href')}" style="text-decoration:none;color:inherit"><div class="grow"><b>做完賽圖卡</b><span>IG 限動尺寸</span></div>${ICON.chev}</a>
    </div>
    <div class="sec"><h3>看別人</h3>
      <button type="button" class="item" data-follow><div class="grow"><b>我關注的人</b><span>${favCount() ? `${favCount()} 人` : '還沒選，選了可以只看他們'}</span></div>${ICON.chev}</button>
    </div>
    <div class="sec"><h3>我的資料</h3>
      <button type="button" class="item" id="it-edit"><div class="grow"><b>暱稱、組別、號碼布、目標</b><span>${esc(m.nick)}・${catName(m.cat)}${m.bib ? `・#${esc(m.bib)}` : ''}</span></div>${ICON.chev}</button>
      ${m.line ? '<div class="item"><div class="grow"><b>LINE 已綁定</b><span>換手機時用 LINE 登入就好</span></div><span class="val" style="color:#06c755">✓</span></div>'
        : lineOn() ? `<button type="button" class="item" id="it-line"><div class="grow"><b>綁定 LINE</b><span>換手機直接用 LINE 登入，不用記 PIN</span></div>${ICON.chev}</button>` : ''}
      <button type="button" class="item" id="it-pin"><div class="grow"><b>改 PIN</b><span>換手機登入用</span></div>${ICON.chev}</button>
    </div>
    <div class="sec">
      <button type="button" class="item" id="it-logout"><div class="grow"><b>登出這支手機</b></div></button>
      <button type="button" class="item" id="it-del"><div class="grow"><b style="color:#9b1c1c">刪除我的資料</b><span>暱稱和所有定位紀錄都會刪掉</span></div></button>
    </div>
    ${adminBlock()}`;
  $('#sw-share').onchange = ev => ev.target.checked ? startShare() : stopShare();
  $('#sw-wake').onchange = ev => setWake(ev.target.checked);
  $('#it-start').onclick = openStart;
  $('#it-finish').onclick = () => openFinish();
  $('#it-edit').onclick = openEdit;
  $('#it-pin').onclick = () => openSheet('改 PIN', `${pinField('s-pin', '新的 4 位數 PIN', '')}<button type="button" class="btn primary block lg" id="s-ok">更新</button>`, b => {
    $('#s-ok').onclick = async () => { const p = $('#s-pin').value.trim(); if (!/^\d{4}$/.test(p)) return toast(ERR.bad_pin); if (await update({ pin: p }, 'PIN 已更新')) closeSheet(); };
  });
  if ($('#it-line')) $('#it-line').onclick = () => lineGo('bind');
  $('#it-logout').onclick = async () => { if (await confirmBox(m.line ? '登出後，用 LINE 登入就能回來。' : '登出後，要點你的名字、輸入 PIN 才能登入回來。', '登出')) { logoutLocal(); S.watcher = true; store.set('watcher', true); renderAll(); } };
  $('#it-del').onclick = async () => {
    if (!await confirmBox('會刪除你的暱稱和所有定位紀錄，無法復原。', '刪除')) return;
    try { await rpc('runlive_delete_me', { p_token: S.token }); logoutLocal(); await poll(true); toast('已刪除你的資料'); showOnboard('role'); } catch (e) { toast(e.message); }
  };
  bindMeCommon();
}
function bindMeCommon() {
  $('#me').querySelectorAll('[data-follow]').forEach(b => b.onclick = openFollow);
  $('#me').querySelectorAll('[data-go]').forEach(b => b.onclick = () => showOnboard(b.dataset.go));
  const al = $('#admin-open'); if (al) al.onclick = openAdminLogin;
}
function openStart() {
  const gun = gunTime(S.team?.config, S.me.cat);
  openSheet('起跑時間', `<p class="note" style="padding:0">排在後面的分區，過起跑線可能比鳴槍晚 10 分鐘以上。記錄自己的過線時間，預估會更準。</p>
    <button type="button" class="choice" data-s="gun" aria-pressed="${!S.me.start_at}">${ICON.flag}<span><b>用大會鳴槍時間</b><span>${fmtClock(gun)}</span></span></button>
    <button type="button" class="choice" data-s="now">${ICON.run}<span><b>我現在過起跑線</b><span>記錄成 ${fmtClock(Date.now())}</span></span></button>
    <div class="field"><label for="s-time">或自己輸入</label><div class="row"><input class="grow" id="s-time" type="time" value="${S.me.start_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' }).format(Date.parse(S.me.start_at)) : ''}"><button type="button" class="btn dark" id="s-ok">儲存</button></div></div>`, () => {
    $('#sheet-body').onclick = async ev => {
      const b = ev.target.closest('[data-s]'); if (!b) return;
      if (await update({ start_at: b.dataset.s === 'gun' ? null : new Date().toISOString() }, b.dataset.s === 'gun' ? '改用鳴槍時間' : '已記錄過線時間')) closeSheet();
    };
    $('#s-ok').onclick = async () => {
      const v = $('#s-time').value; if (!v) return toast('先選時間');
      const iso = `${S.team?.config?.date}T${v}:00+08:00`;
      if (await update({ start_at: new Date(iso).toISOString() }, `起跑時間改成 ${v}`)) closeSheet();
    };
  });
}
function openFinish(justArrived) {
  const a = AN.get(S.me.id), gps = a?.status === 'finished' && !a.official ? a.finishSec : null;
  openSheet(justArrived ? '🎉 恭喜完賽！' : '大會正式成績', `
    <p class="note" style="padding:0">${justArrived ? '先休息喝水！晶片成績公告後再回來填也可以。' : '填大會公告的晶片時間，名單和完賽圖卡都會用這個時間。'}</p>
    <div class="field"><label for="s-fin">完賽時間（時:分:秒）</label><input id="s-fin" type="text" inputmode="numeric" placeholder="0:00:00" value="${S.me.finish_sec ? fmtHMS(S.me.finish_sec) : ''}" style="font-family:var(--num);font-size:28px;font-weight:700;min-block-size:56px;text-align:center"><span class="hint">直接打數字，冒號會自動加上。例如 4 小時 12 分 33 秒，打 41233</span>
    ${gps ? `<span class="hint">GPS 估計約 ${fmtHMS(gps)}，請以大會成績為準。</span>` : ''}</div>
    <button type="button" class="btn primary block lg" id="s-ok">儲存成績</button>
    ${S.me.finish_sec ? '<button type="button" class="btn ghost block" id="s-clear" style="margin-top:8px">清除成績</button>' : ''}
    <a class="btn dark block" style="margin:10px 0" href="${$('#tab-card').getAttribute('href')}">做完賽圖卡</a>`, () => {
    bindTimeInput($('#s-fin'), true);
    $('#s-ok').onclick = async () => {
      const s = parseHMS($('#s-fin').value); if (!s) return toast('先填完賽時間，分和秒不能超過 59');
      if (await update({ finish_sec: s }, `已儲存 ${fmtHMS(s)}`)) closeSheet();
    };
    const c = $('#s-clear'); if (c) c.onclick = async () => { if (await update({ finish_sec: null }, '已清除成績')) closeSheet(); };
  });
}
function openEdit() {
  const m = S.me;
  openSheet('我的資料', `
    <div class="field"><label for="e-nick">暱稱</label><input id="e-nick" type="text" maxlength="12" value="${esc(m.nick)}"></div>
    <div class="field"><span class="lbl">組別</span><div class="opts" id="e-cat">${offered().map(([k, c]) => `<button type="button" class="opt" data-cat="${k}" aria-pressed="${k === m.cat}">${c.name}</button>`).join('')}</div></div>
    <div class="grid2"><div class="field"><label for="e-bib">號碼布</label><input id="e-bib" type="text" inputmode="numeric" maxlength="8" value="${esc(m.bib || '')}"></div>
    <div class="field"><label for="e-tgt">目標時間</label><input id="e-tgt" type="text" inputmode="numeric" placeholder="0:00" value="${hm(m.target_sec)}"><span class="hint">打 430 就是 4:30</span></div></div>
    <button type="button" class="btn primary block lg" id="e-ok">儲存</button>`, () => {
    let cat = m.cat;
    bindTimeInput($('#e-tgt'), false);
    $('#e-cat').onclick = ev => { const b = ev.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; $('#e-cat').querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', x === b)); };
    $('#e-ok').onclick = async () => {
      const t = $('#e-tgt').value.trim(), s = t ? parseHMS(t) : null;
      if (t && !s) return toast('分鐘不能超過 59');
      if (await update({ nick: $('#e-nick').value.trim(), cat, bib: $('#e-bib').value.trim() || null, target_sec: s }, '已更新')) closeSheet();
    };
  });
}

// ---------- 管理者 ----------
function adminBlock() { return S.adminCode ? '' : '<button type="button" class="admin-link" id="admin-open">管理者</button>'; }
function openAdminLogin() {
  openSheet('管理者', `<div class="field"><label for="a-code">管理碼</label><input id="a-code" type="password" autocomplete="off"></div><button type="button" class="btn dark block lg" id="a-ok">進入</button>`, () => {
    $('#a-ok').onclick = async () => {
      S.adminCode = $('#a-code').value.trim();
      try { await admin('list'); closeSheet(); setTab('me'); loadAdmin(); } catch (e) { S.adminCode = null; toast(e.message); }
    };
  });
}
const admin = (action, args = {}) => rpc('runlive_admin', { p_team: TEAM, p_admin_code: S.adminCode, p_action: action, p_args: args });
async function loadAdmin() {
  const box = $('#adm'); if (!box) return;
  let d; try { d = await admin('list'); } catch (e) { S.adminCode = null; toast(e.message); return; }
  const cfg = d.team.config || {};
  const mk = t => { const u = new URL(location.origin + location.pathname); if (t) u.searchParams.set('t', t); u.searchParams.set('openExternalBrowser', '1'); u.hash = 'k=' + encodeURIComponent(S.code || ''); return u.toString(); };
  const link = mk(TEAM), pickLink = mk('');
  box.innerHTML = `
    <div class="sec"><h3>分享給群組</h3><div class="inner"><p class="note" style="padding:0">連結都帶好團體代碼，在 LINE 裡點開會自動用手機瀏覽器開。</p>
      <div class="field" style="margin-top:6px"><span class="lbl">賽事選單（大家自己選哪一場）</span><div class="row"><input class="grow" type="text" readonly value="${esc(pickLink)}" id="a-link0"><button type="button" class="btn dark" data-copy="a-link0">複製</button></div></div>
      <div class="field"><span class="lbl">直接進這一場</span><div class="row"><input class="grow" type="text" readonly value="${esc(link)}" id="a-link"><button type="button" class="btn dark" data-copy="a-link">複製</button></div></div></div></div>
    <div class="sec"><h3>場次設定</h3><div class="inner">
      <div class="field"><label for="a-name">名稱</label><input id="a-name" type="text" value="${esc(d.team.name)}"></div>
      <div class="field"><label for="a-date">比賽日期</label><input id="a-date" type="date" value="${esc(cfg.date || '')}"></div>
      <div class="grid2">${offered().map(([k, c]) => `<div class="field" style="margin:6px 0"><label for="a-s-${k}">${c.name}鳴槍</label><input id="a-s-${k}" type="time" value="${esc(cfg.starts?.[k] || '')}"></div>`).join('')}</div>
      <label class="item" style="padding:12px 0;border:0"><div class="grow"><b>用大會路線對位</b><span>練跑不在賽道上時關掉</span></div><input type="checkbox" class="switch" id="a-route" ${cfg.useRoute !== false ? 'checked' : ''}></label>
      <button type="button" class="btn dark block" id="a-save">儲存設定</button>
      <div class="field" style="margin-top:18px"><label for="a-code2">更換團體代碼</label><div class="row"><input class="grow" id="a-code2" type="text" autocomplete="off" placeholder="至少 4 碼"><button type="button" class="btn ghost" id="a-code-go">更換</button></div><span class="hint">換了之後，舊連結會失效。</span></div>
    </div></div>
    <div class="sec"><h3>跑者 ${d.runners.length} 人</h3>
      ${d.runners.map(r => `<div class="adm-r"><div class="grow"><b>${esc(r.nick)}</b> <span class="tag">${catName(r.cat)}</span>${r.bib ? ` <span class="tag">#${esc(r.bib)}</span>` : ''}<small>${r.pings} 個定位點${r.last ? `・最後 ${fmtClock(Date.parse(r.last))}` : ''}${r.failed ? `・PIN 錯 ${r.failed} 次` : ''}</small></div>
        <button type="button" class="btn sm ghost" data-pin="${r.id}" data-n="${esc(r.nick)}">重設 PIN</button><button type="button" class="btn sm danger" data-rm="${r.id}" data-n="${esc(r.nick)}">移除</button></div>`).join('') || '<div class="inner">還沒有人</div>'}
      <div class="inner" style="padding-top:10px"><button type="button" class="btn danger block" id="a-clear">清除全部定位紀錄</button></div></div>
    <button type="button" class="admin-link" id="a-exit">離開管理者模式</button>`;
  box.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { const i = document.getElementById(b.dataset.copy); try { await navigator.clipboard.writeText(i.value); toast('已複製連結'); } catch { i.select(); toast('請長按連結複製'); } });
  $('#a-save').onclick = async () => {
    const starts = { ...(cfg.starts || {}) }; for (const [k] of offered()) { const v = $(`#a-s-${k}`).value; if (v) starts[k] = v.slice(0, 5); }
    try { await admin('set_config', { config: { ...cfg, date: $('#a-date').value, starts, useRoute: $('#a-route').checked }, name: $('#a-name').value.trim() }); toast('設定已儲存'); await poll(true); }
    catch (e) { toast(e.message); }
  };
  $('#a-code-go').onclick = async () => {
    const c = $('#a-code2').value.trim().toLowerCase(); if (c.length < 4) return toast(ERR.bad_code_len);
    if (!await confirmBox(`團體代碼改成「${c}」？舊連結會失效，要重新發連結。`, '更換')) return;
    try { await admin('set_view_code', { code: c }); S.code = c; store.set('code', c); toast('代碼已更換'); loadAdmin(); } catch (e) { toast(e.message); }
  };
  $('#a-clear').onclick = async () => {
    if (!await confirmBox('清除所有人的定位紀錄（名單保留），無法復原。', '清除')) return;
    try { const r = await admin('clear_points'); toast(`已清除 ${r.cleared} 點`); await poll(true); loadAdmin(); } catch (e) { toast(e.message); }
  };
  $('#a-exit').onclick = () => { S.adminCode = null; box.innerHTML = ''; renderMe(); };
  box.onclick = async ev => {
    const rm = ev.target.closest('[data-rm]'), pin = ev.target.closest('[data-pin]');
    if (rm) {
      if (!await confirmBox(`移除「${rm.dataset.n}」和他的定位紀錄？`, '移除')) return;
      try { await admin('remove', { id: rm.dataset.rm }); toast('已移除'); await poll(true); loadAdmin(); } catch (e) { toast(e.message); }
    }
    if (pin) {
      const p = String(Math.floor(1000 + Math.random() * 9000));
      if (!await confirmBox(`把「${pin.dataset.n}」的 PIN 重設為 ${p}？請把新 PIN 告訴本人。`, '重設')) return;
      try { await admin('reset_pin', { id: pin.dataset.pin, pin: p }); toast(`已重設，新 PIN：${p}`); loadAdmin(); } catch (e) { toast(e.message); }
    }
  };
}

boot();
