// 用 LINE 登入／綁定（LIFF）v1（2026-11-27）
// LIFF_ID 空字串＝功能關閉，畫面上不會出現任何 LINE 按鈕。
// ⚠️ 改了這支要把 app.js 裡 import 的 line.js?v= 加 1（JS 會被快取一年）。
export const LIFF_ID = '2012840008-iCP400Eg'; // 采能 Provider「跑團 LIVE」LINE Login 頻道 2012840008（11/28 建、已 Published）
export const lineOn = () => !!LIFF_ID;

const SS = 'rl_line';
const LERR = {
  id_token: 'LINE 登入驗證失敗，請再試一次', line_off: 'LINE 登入還沒開放', line_taken: '這個 LINE 已經綁在這場的另一位跑者',
  bad_token: '登入已失效，請重新登入', bad_code: '團體代碼不對',
};
let sdk = null, ready = null;
function loadSdk() {
  if (window.liff) return Promise.resolve(window.liff);
  return sdk ||= new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    s.onload = () => ok(window.liff); s.onerror = () => { sdk = null; no(new Error('LINE 載入失敗，請稍後再試')); };
    document.head.append(s);
  });
}
const init = () => ready ||= loadSdk().then(async liff => { await liff.init({ liffId: LIFF_ID }); return liff; }).catch(e => { ready = null; throw e; });
const expOf = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { return 0; } };
export const tokenFresh = t => !!t && expOf(t) - Date.now() > 120000;
const selfUrl = team => location.origin + location.pathname + (team ? '?t=' + encodeURIComponent(team) : '');

// 拿有效的 id_token；這個瀏覽器還沒登過 LINE（或票快過期）就跳去 LINE，回來由 resumeLine 接手
export async function lineToken(intent, team, extra) {
  const liff = await init();
  const t = liff.isLoggedIn() ? liff.getIDToken() : null;
  if (tokenFresh(t)) return t;
  if (liff.isLoggedIn()) liff.logout(); // id_token 只有 1 小時，過期後 isLoggedIn 仍是 true，要登出再登入才會換新票
  try { sessionStorage.setItem(SS, JSON.stringify({ intent, team, extra, at: Date.now() })); } catch { }
  liff.login({ redirectUri: selfUrl(team) });
  return new Promise(() => { }); // 正在跳到 LINE
}

// 開頁時呼叫：剛從 LINE 登入回來就回傳 { intent, extra, idToken | error }，不是就回 null
export async function resumeLine(team) {
  let p = null; try { p = JSON.parse(sessionStorage.getItem(SS)); sessionStorage.removeItem(SS); } catch { }
  const back = /[?&](code|liffClientId|liffRedirectUri)=/.test(location.search);
  if (!LIFF_ID || (!p && !back)) return null;
  try {
    const liff = await init();
    if (back) history.replaceState(null, '', selfUrl(team).slice(location.origin.length));
    if (!p || p.team !== team || Date.now() - p.at > 15 * 60000) return null;
    const t = liff.isLoggedIn() ? liff.getIDToken() : null;
    if (!tokenFresh(t)) return { ...p, error: 'LINE 登入沒有完成，請再試一次' };
    return { ...p, idToken: t };
  } catch (e) {
    if (back) history.replaceState(null, '', selfUrl(team).slice(location.origin.length));
    return p ? { ...p, error: e.message } : null;
  }
}

export async function lineCall(action, body) {
  let r = null, j = null;
  try { r = await fetch('line.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) }); j = await r.json(); } catch { }
  if (!r || !r.ok || !j) { const e = new Error(LERR[j?.error] || (r ? '伺服器忙碌，請稍後再試' : '網路不穩，請稍後再試')); e.code = j?.error; throw e; }
  return j;
}
