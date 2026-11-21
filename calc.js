// 路線對位、配速、預估抵達
import { ROUTES } from './routes.js';

export const CAT = {
  full: { name: '全馬', len: 42195, pace: 0.39, color: '#d62839', limit: 6.5 * 3600 },
  half: { name: '半馬', len: 21097.5, pace: 0.36, color: '#1d6fd6', limit: 4 * 3600 },
  '10k': { name: '10K', len: 10000, pace: 0.36, color: '#16a34a', limit: 2 * 3600 },
  '5k': { name: '5K', len: 5000, pace: 0.36, color: '#a855f7', limit: 1.5 * 3600 },
};
// pace 單位：秒/公尺（0.39 = 6:30/km）

const R = 6371000;
export function hav(a1, o1, a2, o2) {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// 預先算好每條路線的平面座標與累積距離（已縮放到官方距離）
const BUILT = {};
for (const [k, r] of Object.entries(ROUTES)) {
  const [la0, lo0] = r.pts[0];
  const kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110540;
  const xy = r.pts.map(([la, lo]) => [(lo - lo0) * kx, (la - la0) * ky]);
  const raw = [0];
  for (let i = 1; i < r.pts.length; i++) raw.push(raw[i - 1] + hav(...r.pts[i - 1], ...r.pts[i]));
  const sc = r.len / raw[raw.length - 1];
  BUILT[k] = { pts: r.pts, xy, cum: raw.map(v => v * sc), sc, la0, lo0, kx, ky, len: r.len };
}
export const routeOf = cat => BUILT[cat] || null;

// 把 GPS 點對到路線上；折返路段用「預期距離」挑正確方向
export function project(rt, la, lo, dExp, acc = 20) {
  const px = (lo - rt.lo0) * rt.kx, py = (la - rt.la0) * rt.ky;
  const lim = Math.min(250, Math.max(80, acc * 1.5));
  let best = null, nearest = Infinity;
  for (let i = 0; i < rt.xy.length - 1; i++) {
    const [ax, ay] = rt.xy[i], [bx, by] = rt.xy[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const e = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (e < nearest) nearest = e;
    if (e > lim) continue;
    const d = rt.cum[i] + t * (rt.cum[i + 1] - rt.cum[i]);
    const cost = e + (dExp == null ? d * 0.001 : Math.abs(d - dExp) * 0.3);
    if (!best || cost < best.cost) best = { d, e, cost };
  }
  return best ? { d: best.d, e: best.e } : { d: null, e: nearest };
}

export function pointAt(rt, d) {
  d = Math.max(0, Math.min(rt.len, d));
  let lo = 0, hi = rt.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rt.cum[m] <= d) lo = m; else hi = m; }
  const seg = rt.cum[hi] - rt.cum[lo] || 1, t = (d - rt.cum[lo]) / seg;
  const [a1, o1] = rt.pts[lo], [a2, o2] = rt.pts[hi];
  return [a1 + (a2 - a1) * t, o1 + (o2 - o1) * t];
}

// 起跑時間（台灣時間）
export function gunTime(config, cat) {
  const hm = config?.starts?.[cat] || '06:00';
  return Date.parse(`${config?.date || '2026-12-06'}T${hm}:00+08:00`);
}

const clampPace = p => Math.max(0.15, Math.min(1.2, p));

// 剩餘距離要花的秒數（全馬 30K 後加 4% 掉速）
function secsBetween(cat, pace, d1, d2) {
  if (d2 <= d1) return 0;
  let s = (d2 - d1) * pace;
  if (cat === 'full') {
    const tail = Math.max(0, d2 - Math.max(30000, d1));
    s += tail * pace * 0.04;
  }
  return s;
}

/**
 * 分析一位跑者
 * pts: [{t, la, lo, a}] 依時間排序；回傳現在推算位置、配速、預估時間
 */
export function analyze(runner, pts, config, now) {
  const cat = runner.cat, C = CAT[cat];
  const gun = gunTime(config, cat);
  const start = runner.start_at ? Date.parse(runner.start_at) : gun;
  const targetPace = runner.target_sec ? runner.target_sec / C.len : C.pace;
  const useRoute = config?.useRoute !== false;
  const rt = useRoute ? routeOf(cat) : null;
  const last = pts[pts.length - 1] || null;
  const out = { cat, len: C.len, start, gun, targetPace, last, mode: rt ? 'route' : 'free' };

  // 已登記正式成績
  if (runner.finish_sec) {
    Object.assign(out, { status: 'finished', dNow: C.len, finishSec: runner.finish_sec,
      finishAt: start + runner.finish_sec * 1000, official: true, pace: runner.finish_sec / C.len });
    out.pos = rt ? pointAt(rt, C.len) : last ? [last.la, last.lo] : null;
    return out;
  }

  const fixes = []; // {t, d, la, lo}
  let lastD = 0, lastT = start;
  if (rt) {
    for (const p of pts) {
      if (p.t < start - 10 * 60e3) continue;
      if (p.a != null && p.a > 120) continue;
      if (p.t <= start) continue;
      const paceGuess = fixes.length >= 2 ? estPace(fixes, start, targetPace) : targetPace;
      const dExp = lastD + (p.t - lastT) / 1000 / paceGuess;
      const pr = project(rt, p.la, p.lo, dExp, p.a ?? 20);
      if (pr.d == null) continue;
      if (pr.d < lastD - 300) continue;
      fixes.push({ t: p.t, d: Math.max(pr.d, lastD - 50), la: p.la, lo: p.lo });
      lastD = Math.max(lastD, pr.d); lastT = p.t;
    }
    // 最後一點偏離路線太遠（例如練跑不在賽道上）→ 改用自由模式
    if (last && last.t > start && fixes.length && fixes[fixes.length - 1].t < last.t - 15 * 60e3) {
      return analyzeFree(runner, pts, config, now, out);
    }
  } else {
    return analyzeFree(runner, pts, config, now, out);
  }
  return finish(out, fixes, cat, now, rt, targetPace);
}

function estPace(fixes, start, targetPace) {
  const lf = fixes[fixes.length - 1];
  let overall = lf.d > 300 ? (lf.t - start) / 1000 / lf.d : null;
  let recent = null;
  for (let i = fixes.length - 2; i >= 0; i--) {
    const f = fixes[i];
    if (lf.t - f.t >= 8 * 60e3 && lf.d - f.d >= 600) { recent = (lf.t - f.t) / 1000 / (lf.d - f.d); break; }
  }
  let obs = recent && overall ? recent * 0.6 + overall * 0.4 : (recent || overall);
  if (!obs) return targetPace;
  const k = Math.min(1, lf.d / 5000);
  return clampPace(obs * k + targetPace * (1 - k));
}

function analyzeFree(runner, pts, config, now, out) {
  // 沒有路線：用自己的 GPS 軌跡累積距離
  const fixes = [];
  let d = 0, prev = null;
  for (const p of pts) {
    if (p.t <= out.start) continue;
    if (p.a != null && p.a > 60) continue;
    if (prev) {
      const step = hav(prev.la, prev.lo, p.la, p.lo), dt = (p.t - prev.t) / 1000;
      if (dt > 0 && step / dt > 7) continue; // 超過 7 m/s 視為飄點
      d += step;
    }
    fixes.push({ t: p.t, d, la: p.la, lo: p.lo });
    prev = p;
  }
  out.mode = 'free';
  return finish(out, fixes, out.cat, now, null, out.targetPace);
}

function finish(out, fixes, cat, now, rt, targetPace) {
  const C = CAT[cat];
  out.fixes = fixes;
  if (now < out.start) {
    Object.assign(out, { status: 'waiting', dNow: 0, pace: targetPace,
      etaFinish: out.start + secsBetween(cat, targetPace, 0, C.len) * 1000 });
    out.pos = rt ? pointAt(rt, 0) : out.last ? [out.last.la, out.last.lo] : null;
    return out;
  }
  const lf = fixes[fixes.length - 1];
  const pace = fixes.length >= 2 ? estPace(fixes, out.start, targetPace) : targetPace;
  out.pace = pace;
  let baseT = out.start, baseD = 0;
  if (lf) { baseT = lf.t; baseD = lf.d; }
  out.lastFixD = baseD; out.lastFixT = lf ? lf.t : null;
  out.age = lf ? now - lf.t : null;

  if (baseD >= C.len - 150) {
    const fs = Math.round((lf.t - out.start) / 1000);
    Object.assign(out, { status: 'finished', dNow: C.len, finishSec: fs, finishAt: lf.t, official: false });
    out.pos = rt ? pointAt(rt, C.len) : [lf.la, lf.lo];
    return out;
  }
  // 從最後一個定位點用配速往前推（最多推 90 分鐘）
  const extraSec = lf ? Math.min((now - baseT) / 1000, 90 * 60) : (now - baseT) / 1000;
  let dNow = baseD + extraSec / pace;
  dNow = Math.min(dNow, C.len - 1);
  out.dNow = dNow;
  out.estimated = !lf || out.age > 3 * 60e3;
  out.status = lf ? (out.age > 30 * 60e3 ? 'stale' : 'running') : 'nofix';
  out.etaFinish = baseT + secsBetween(cat, pace, baseD, C.len) * 1000;
  out.pos = rt ? pointAt(rt, dNow) : lf ? [lf.la, lf.lo] : null;
  out.fixPos = lf ? [lf.la, lf.lo] : null;
  return out;
}

// 預估抵達某個公里數的時間；已經過就回 passed
export function etaAt(a, km) {
  const d = Math.min(km * 1000, a.len);
  if (a.status === 'finished') {
    if (a.official || !a.fixes?.length) return { passed: true, t: a.start + (a.finishSec * d / a.len) * 1000 };
  }
  if (a.status === 'waiting') return { passed: false, t: a.start + secsBetween(a.cat, a.pace, 0, d) * 1000 };
  if (d <= (a.dNow ?? 0)) {
    const f = a.fixes?.find(x => x.d >= d);
    return { passed: true, t: f ? f.t : null };
  }
  const baseT = a.lastFixT ?? a.start, baseD = a.lastFixD ?? 0;
  return { passed: false, t: baseT + secsBetween(a.cat, a.pace, baseD, d) * 1000 };
}

export const fmtPace = p => { if (!p || !isFinite(p)) return '–'; const s = Math.round(p * 1000); return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`; };
export const fmtHMS = s => { if (s == null) return '–'; s = Math.round(s); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const fmtClock = t => t == null ? '–' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
export const fmtAgo = ms => { if (ms == null) return '尚無定位'; const m = Math.round(ms / 60e3); return m < 1 ? '剛剛' : m < 60 ? `${m} 分鐘前` : `${Math.floor(m / 60)} 小時前`; };
export function parseHMS(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})[:：](\d{1,2})(?:[:：](\d{1,2}))?$/);
  if (!m) return null;
  const [h, mi, s] = m[3] != null ? [+m[1], +m[2], +m[3]] : [+m[1], +m[2], 0];
  if (mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}
