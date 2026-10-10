// 予定：音声入力 → 読み取り → Googleカレンダー登録

import { $, escapeHtml, toast, uid, ymd, hm, formatDateJa } from './util.js';
import { appointments, settings } from './store.js';
import { parseSchedule, extractCompany } from './parse.js';
import { createEvent, listUpcoming, templateLink } from './google.js';

let recognition = null;
let listening = false;
let googleEvents = [];

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#btn-mic');
  const status = $('#mic-status');
  if (!SR) {
    status.textContent = 'このブラウザは音声認識に未対応です。キーボードのマイク入力か手入力をご利用ください（Chrome / Safari 推奨）';
    mic.disabled = true;
    return;
  }
  recognition = new SR();
  recognition.lang = 'ja-JP';
  recognition.interimResults = true;
  recognition.continuous = false;

  let finalText = '';
  recognition.onstart = () => {
    listening = true;
    finalText = '';
    mic.classList.add('listening');
    status.textContent = '聞き取り中…話し終わると自動で止まります';
  };
  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    $('#voice-text').value = finalText + interim;
  };
  recognition.onerror = (e) => {
    const msg = {
      'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定を確認してください',
      'no-speech': '音声が聞き取れませんでした',
      network: '音声認識にはネット接続が必要です',
    }[e.error] || `音声認識エラー: ${e.error}`;
    status.textContent = msg;
  };
  recognition.onend = () => {
    listening = false;
    mic.classList.remove('listening');
    if ($('#voice-text').value.trim()) {
      status.textContent = '読み取りました。内容を確認してください';
      parseAndShow();
    } else if (status.textContent.startsWith('聞き取り中')) {
      status.textContent = 'マイクをタップして話してください';
    }
  };

  mic.addEventListener('click', () => {
    if (listening) recognition.stop();
    else {
      try { recognition.start(); } catch { /* 二重起動は無視 */ }
    }
  });
}

function parseAndShow() {
  const text = $('#voice-text').value.trim();
  if (!text) { toast('予定の内容を話すか入力してください'); return; }
  const r = parseSchedule(text, new Date(), Number(settings.get().duration) || 60);
  const date = r.date || new Date();
  $('#ev-title').value = r.title;
  $('#ev-company').value = r.company;
  $('#ev-date').value = ymd(date);
  $('#ev-allday').checked = r.allDay;
  $('#ev-start').value = r.start ? hm(r.start) : '10:00';
  $('#ev-end').value = r.end ? hm(r.end) : '11:00';
  $('#ev-location').value = r.location;
  $('#ev-memo').value = '';
  toggleTimeRow();
  $('#event-form').classList.remove('hidden');
  if (!r.date) toast('日付が読み取れなかったので今日にしています。確認してください', 4000);
  $('#event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleTimeRow() {
  $('#ev-time-row').classList.toggle('hidden', $('#ev-allday').checked);
}

function readForm() {
  const date = $('#ev-date').value;
  const allDay = $('#ev-allday').checked;
  const [y, mo, d] = date.split('-').map(Number);
  const mk = (t) => { const [h, mi] = t.split(':').map(Number); return new Date(y, mo - 1, d, h, mi); };
  const start = allDay ? new Date(y, mo - 1, d) : mk($('#ev-start').value || '10:00');
  let end = allDay ? new Date(y, mo - 1, d + 1) : mk($('#ev-end').value || '11:00');
  if (end <= start) end = new Date(start.getTime() + (Number(settings.get().duration) || 60) * 60000);
  return {
    title: $('#ev-title').value.trim() || '予定',
    company: $('#ev-company').value.trim(),
    allDay,
    start: start.toISOString(),
    end: end.toISOString(),
    location: $('#ev-location').value.trim(),
    memo: $('#ev-memo').value.trim(),
  };
}

function resetForm() {
  $('#event-form').classList.add('hidden');
  $('#voice-text').value = '';
  $('#mic-status').textContent = 'マイクをタップして話してください';
}

export function renderAppointments() {
  const now = Date.now();
  const local = appointments.all();
  const knownIds = new Set(local.map((a) => a.gcalId).filter(Boolean));
  const merged = [
    ...local,
    ...googleEvents.filter((g) => !knownIds.has(g.gcalId)).map((g) => ({ ...g, id: 'g_' + g.gcalId, company: extractCompany(g.title), fromGoogle: true })),
  ]
    .filter((a) => new Date(a.end).getTime() >= now)
    .sort((a, b) => a.start.localeCompare(b.start));

  const list = $('#appointment-list');
  if (!merged.length) {
    list.innerHTML = '<li class="empty">予定はまだありません</li>';
    return;
  }
  list.innerHTML = merged.map((a) => {
    const s = new Date(a.start);
    const when = a.allDay ? `${formatDateJa(s, false)} 終日` : `${formatDateJa(s)}〜${hm(new Date(a.end))}`;
    return `
      <li>
        <div class="main">
          <div class="title">${escapeHtml(a.title)}</div>
          <div class="meta">${escapeHtml(when)}${a.location ? ' ・ ' + escapeHtml(a.location) : ''}</div>
          <div>
            ${a.gcalId ? '<span class="badge gcal">Googleカレンダー</span>' : '<span class="badge">この端末のみ</span>'}
            ${a.company ? `<span class="badge">${escapeHtml(a.company)}</span>` : ''}
          </div>
        </div>
        <div class="side">
          <button class="btn btn-small" data-research="${escapeHtml(a.id)}">調べる</button>
          ${a.fromGoogle ? '' : `<button class="btn btn-small btn-ghost" data-del="${escapeHtml(a.id)}">削除</button>`}
        </div>
      </li>`;
  }).join('');
  list._items = merged;
}

export function initSchedule({ onResearch }) {
  initVoice();
  $('#btn-parse').addEventListener('click', parseAndShow);
  $('#ev-allday').addEventListener('change', toggleTimeRow);
  $('#btn-ev-cancel').addEventListener('click', resetForm);

  $('#event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ev = readForm();
    const btn = e.submitter || $('#event-form button[type=submit]');
    btn.disabled = true;
    try {
      const created = await createEvent(ev);
      appointments.add({ id: uid(), ...ev, gcalId: created.id, htmlLink: created.htmlLink });
      toast('Googleカレンダーに登録しました');
      resetForm();
      renderAppointments();
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-ev-link').addEventListener('click', () => {
    const ev = readForm();
    appointments.add({ id: uid(), ...ev });
    window.open(templateLink(ev), '_blank', 'noopener');
    toast('Googleカレンダーの画面で「保存」を押してください', 4000);
    resetForm();
    renderAppointments();
  });

  $('#btn-load-gcal').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      googleEvents = await listUpcoming();
      renderAppointments();
      toast(`${googleEvents.length}件の予定を読み込みました`);
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      e.target.disabled = false;
    }
  });

  $('#appointment-list').addEventListener('click', (e) => {
    const items = $('#appointment-list')._items || [];
    const r = e.target.closest('[data-research]');
    const d = e.target.closest('[data-del]');
    if (r) {
      const a = items.find((x) => x.id === r.dataset.research);
      const s = new Date(a.start);
      onResearch(a.company || a.title, `${formatDateJa(s, !a.allDay)} ${a.title}`);
    }
    if (d && confirm('この端末の一覧から削除しますか？（Googleカレンダー側の予定は消えません）')) {
      appointments.remove(d.dataset.del);
      renderAppointments();
    }
  });

  renderAppointments();
}
