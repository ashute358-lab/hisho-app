// 共通ユーティリティ

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer;
export function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const pad = (n) => String(n).padStart(2, '0');

// ローカル時刻の YYYY-MM-DD
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const yen = (n) => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');

const WEEK = '日月火水木金土';
export function formatDateJa(d, withTime = true) {
  const s = `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
  return withTime ? `${s} ${hm(d)}` : s;
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 安全な最小限の Markdown → HTML（先にエスケープしてから整形）
export function markdownToHtml(md) {
  const lines = escapeHtml(md).split(/\r?\n/);
  const out = [];
  let inList = false;
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*・]|\d+\.)\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lv = Math.min(h[1].length, 3);
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
    } else if (line.trim()) {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

export function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html
    .replace(/<\/(p|h\d|li|ul)>/g, '</$1>\n')
    .replace(/<li>/g, '<li>・');
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
