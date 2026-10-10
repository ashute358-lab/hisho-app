import { $, $$, toast, download, ymd } from './util.js';
import { settings, exportAll, importAll, wipeAll } from './store.js';
import { signIn, signOut, onAuthChange } from './google.js';
import { initSchedule, renderAppointments } from './schedule.js';
import { initResearch, renderReportList } from './research.js';
import { initReceipts, renderReceipts } from './receipts.js';

function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  try { sessionStorage.setItem('hisho:tab', name); } catch { /* 無視 */ }
  window.scrollTo({ top: 0 });
}

function initTabs() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  let saved = null;
  try { saved = sessionStorage.getItem('hisho:tab'); } catch { /* 無視 */ }
  if (saved && $(`#tab-${saved}`)) showTab(saved);
}

function renderGoogleStatus(signedIn) {
  const box = $('#google-status');
  box.innerHTML = signedIn
    ? '<span>✅ Google接続中</span><button class="btn btn-small btn-ghost" id="btn-google-signout">切断</button>'
    : '<button id="btn-google-signin" class="btn btn-small">Googleに接続</button>';
}

function initGoogle() {
  renderGoogleStatus(false);
  onAuthChange(renderGoogleStatus);
  $('#google-status').addEventListener('click', async (e) => {
    if (e.target.id === 'btn-google-signin') {
      try {
        await signIn();
        toast('Googleに接続しました');
      } catch (err) {
        toast(err.message, 5000);
        if (!settings.get().googleClientId) showTab('settings');
      }
    }
    if (e.target.id === 'btn-google-signout') signOut();
  });
}

function initSettings() {
  const s = settings.get();
  $('#st-client-id').value = s.googleClientId;
  $('#st-claude-key').value = s.claudeKey;
  $('#st-email').value = s.email;
  $('#st-duration').value = s.duration;

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    settings.save({
      googleClientId: $('#st-client-id').value.trim(),
      claudeKey: $('#st-claude-key').value.trim(),
      email: $('#st-email').value.trim(),
      duration: Number($('#st-duration').value) || 60,
    });
    toast('設定を保存しました');
  });

  $('#btn-backup').addEventListener('click', async () => {
    const data = await exportAll();
    download(`hisho-backup_${ymd(new Date())}.json`, JSON.stringify(data), 'application/json');
  });

  $('#backup-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importAll(JSON.parse(await file.text()));
      toast('バックアップを読み込みました');
      renderAll();
    } catch (err) {
      toast(err.message || '読み込みに失敗しました', 5000);
    }
    e.target.value = '';
  });

  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('この端末に保存した予定・レポート・領収書・設定をすべて削除します。元に戻せません。よろしいですか？')) return;
    await wipeAll();
    signOut();
    toast('すべてのデータを削除しました');
    setTimeout(() => location.reload(), 800);
  });
}

function renderAll() {
  renderAppointments();
  renderReportList();
  renderReceipts();
}

initTabs();
initGoogle();
initSettings();
initSchedule({
  onResearch(company, context) {
    $('#rs-company').value = company;
    $('#rs-context').value = context;
    showTab('research');
    $('#btn-research').focus();
    toast('「調べてレポートを作る」を押すと調査を始めます');
  },
});
initResearch();
initReceipts();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
