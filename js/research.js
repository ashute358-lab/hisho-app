// 企業レポート：情報収集 → レポート作成 → メール送信

import { $, escapeHtml, toast, uid, markdownToHtml, htmlToText, formatDateJa } from './util.js';
import { reports, settings } from './store.js';
import { hasClaude, researchCompany } from './claude.js';
import { sendMail } from './google.js';

let current = null;

async function wikipedia(company) {
  const q = company.replace(/(株式会社|有限会社|合同会社)/g, '').trim() || company;
  const search = await fetch(`https://ja.wikipedia.org/w/api.php?${new URLSearchParams({
    action: 'query', list: 'search', srsearch: q, srlimit: '3', format: 'json', origin: '*',
  })}`).then((r) => r.json());
  const hit = search?.query?.search?.[0];
  if (!hit) return null;
  const sum = await fetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`).then((r) => r.json());
  return { title: sum.title, extract: sum.extract, url: sum.content_urls?.desktop?.page };
}

function searchLinks(company) {
  const q = encodeURIComponent(company);
  return [
    { title: 'Google検索', url: `https://www.google.com/search?q=${q}` },
    { title: 'Googleニュース', url: `https://news.google.com/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja` },
    { title: '公式サイトを探す', url: `https://www.google.com/search?q=${q}+公式サイト+会社概要` },
    { title: '国税庁 法人番号公表サイト', url: 'https://www.houjin-bangou.nta.go.jp/' },
    { title: 'gBizINFO（経産省の法人情報）', url: `https://www.google.com/search?q=site%3Ainfo.gbiz.go.jp+${q}` },
  ];
}

export async function runResearch(company, context) {
  company = company.trim();
  if (!company) { toast('会社名を入力してください'); return; }
  const btn = $('#btn-research');
  btn.disabled = true;
  btn.textContent = hasClaude() ? 'Webで調査中…（1〜2分）' : '調査中…';
  try {
    let md = `# ${company} 企業レポート\n\n`;
    if (context) md += `**予定:** ${context}\n\n`;
    let sources = [];

    if (hasClaude()) {
      const r = await researchCompany(company, context);
      md += r.markdown + '\n\n';
      sources = r.sources;
    } else {
      const wiki = await wikipedia(company).catch(() => null);
      md += '## 概要\n';
      md += wiki ? `${wiki.extract}\n\n（出典: Wikipedia「${wiki.title}」 ${wiki.url}）\n\n` : '自動で情報が見つかりませんでした。下のリンクから確認してください。\n\n';
      md += '## 確認しておきたいこと\n- 事業内容・主力サービス\n- 最近のニュース・プレスリリース\n- 担当者の部署・役職\n- 先方の課題と、こちらから提案できること\n\n';
      md += '※ 設定で Claude APIキーを入れると、Web検索による詳しいレポートを自動作成できます。\n\n';
    }

    md += '## 参考リンク\n';
    for (const l of [...sources.slice(0, 10), ...searchLinks(company)]) md += `- [${l.title}](${l.url})\n`;
    md += `\n作成日時: ${formatDateJa(new Date())}\n`;

    const report = { id: uid(), company, context, markdown: md, createdAt: new Date().toISOString() };
    reports.add(report);
    showReport(report);
    renderReportList();
  } catch (e) {
    console.error(e);
    toast(e.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '調べてレポートを作る';
  }
}

function showReport(report) {
  current = report;
  $('#report-title').textContent = `${report.company} レポート`;
  $('#report-body').innerHTML = markdownToHtml(report.markdown);
  $('#rs-to').value = $('#rs-to').value || settings.get().email;
  $('#report-view').classList.remove('hidden');
  $('#report-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function renderReportList() {
  const list = $('#report-list');
  const items = reports.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!items.length) {
    list.innerHTML = '<li class="empty">まだレポートはありません</li>';
    return;
  }
  list.innerHTML = items.map((r) => `
    <li>
      <div class="main">
        <div class="title">${escapeHtml(r.company)}</div>
        <div class="meta">${escapeHtml(formatDateJa(new Date(r.createdAt)))}${r.context ? ' ・ ' + escapeHtml(r.context) : ''}</div>
      </div>
      <div class="side">
        <button class="btn btn-small" data-open="${r.id}">開く</button>
        <button class="btn btn-small btn-ghost" data-del="${r.id}">削除</button>
      </div>
    </li>`).join('');
}

function mailParts() {
  const html = $('#report-body').innerHTML;
  return {
    subject: `【企業レポート】${current.company}`,
    html: `<div style="font-family:sans-serif;line-height:1.6">${html}</div>`,
    text: htmlToText(html),
  };
}

export function initResearch() {
  $('#btn-research').addEventListener('click', () => runResearch($('#rs-company').value, $('#rs-context').value.trim()));

  $('#report-list').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-del]');
    if (open) showReport(reports.all().find((r) => r.id === open.dataset.open));
    if (del && confirm('このレポートを削除しますか？')) {
      reports.remove(del.dataset.del);
      if (current?.id === del.dataset.del) $('#report-view').classList.add('hidden');
      renderReportList();
    }
  });

  $('#btn-send-gmail').addEventListener('click', async (e) => {
    const to = $('#rs-to').value.trim();
    if (!to) { toast('送信先メールアドレスを入力してください'); return; }
    e.target.disabled = true;
    try {
      await sendMail({ to, ...mailParts() });
      toast(`${to} に送信しました`);
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      e.target.disabled = false;
    }
  });

  $('#btn-send-mailto').addEventListener('click', () => {
    const { subject, text } = mailParts();
    const to = $('#rs-to').value.trim();
    // mailto は長すぎると開けないため、本文を一定の長さで切る
    const body = text.length > 1800 ? text.slice(0, 1800) + '\n\n（長いため省略。全文はアプリでコピーしてください）' : text;
    location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  $('#btn-copy-report').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(mailParts().text);
      toast('コピーしました');
    } catch {
      toast('コピーできませんでした');
    }
  });

  renderReportList();
}
