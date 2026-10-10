// Google カレンダー / Gmail 連携（Google Identity Services のトークンモデル）
// アクセストークンはメモリ上にのみ保持し、保存しません。

import { settings } from './store.js';
import { pad } from './util.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

let token = null;
let tokenExpiry = 0;
let tokenClient = null;
let tokenClientId = '';
const listeners = new Set();

export const onAuthChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn(isSignedIn()));

export const isSignedIn = () => !!token && Date.now() < tokenExpiry;

function waitForGis() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - start > 10000) return reject(new Error('Googleのログイン部品を読み込めませんでした'));
      setTimeout(check, 100);
    })();
  });
}

export async function signIn() {
  const clientId = settings.get().googleClientId.trim();
  if (!clientId) throw new Error('設定タブで Google OAuth クライアントID を入力してください');
  await waitForGis();
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId;
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      token = resp.access_token;
      tokenExpiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
      notify();
      resolve();
    };
    tokenClient.error_callback = (err) => reject(new Error(err?.message || 'ログインがキャンセルされました'));
    tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenExpiry = 0;
  notify();
}

async function api(url, options = {}) {
  if (!isSignedIn()) await signIn();
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) {
    token = null;
    notify();
    throw new Error('Googleのログイン期限が切れました。もう一度接続してください');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Google API エラー (${res.status})`);
  }
  return res.json();
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function eventBody(ev) {
  const body = { summary: ev.title, location: ev.location || undefined, description: ev.memo || undefined };
  if (ev.allDay) {
    const s = new Date(ev.start);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    body.start = { date: localDateStr(s) };
    body.end = { date: localDateStr(e) };
  } else {
    body.start = { dateTime: new Date(ev.start).toISOString(), timeZone: TZ };
    body.end = { dateTime: new Date(ev.end).toISOString(), timeZone: TZ };
  }
  return body;
}

export function createEvent(ev) {
  return api('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify(eventBody(ev)),
  });
}

export async function listUpcoming(max = 30) {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(max),
  });
  const data = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  return (data.items || []).map((it) => ({
    gcalId: it.id,
    title: it.summary || '(無題)',
    start: it.start.dateTime || `${it.start.date}T00:00:00`,
    end: it.end.dateTime || `${it.end.date}T00:00:00`,
    allDay: !it.start.dateTime,
    location: it.location || '',
    memo: it.description || '',
    htmlLink: it.htmlLink,
  }));
}

// ログイン不要の「Googleカレンダーに追加」リンク
export function templateLink(ev) {
  const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const fmtT = (d) => `${fmt(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const s = new Date(ev.start);
  let dates;
  if (ev.allDay) {
    const e = new Date(s); e.setDate(e.getDate() + 1);
    dates = `${fmt(s)}/${fmt(e)}`;
  } else {
    dates = `${fmtT(s)}/${fmtT(new Date(ev.end))}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates, ctz: TZ });
  if (ev.location) p.set('location', ev.location);
  if (ev.memo) p.set('details', ev.memo);
  return `https://calendar.google.com/calendar/render?${p}`;
}

// ---- Gmail 送信 ----
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64url = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function sendMail({ to, subject, html, text }) {
  const boundary = 'hisho_' + Math.random().toString(36).slice(2);
  const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');
  const mime = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64utf8(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64utf8(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64utf8(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: b64url(b64utf8(mime)) }),
  });
}
