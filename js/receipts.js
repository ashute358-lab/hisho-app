// 領収書管理：写真・OCR/AI読み取り・保存・月別集計・CSV書き出し

import { $, $$, escapeHtml, toast, uid, ymd, yen, download } from './util.js';
import { receipts } from './store.js';
import { hasClaude, readReceipt } from './claude.js';

export const CATEGORIES = {
  business: ['交通費', '旅費', '会議費', '接待交際費', '消耗品費', '通信費', '新聞図書費', '研修費', '支払手数料', '雑費'],
  household: ['食費', '外食', '日用品', '交通', '医療', '衣服・美容', '教育', '趣味・娯楽', '光熱費', '通信', '住居', 'その他'],
};

let currentImage = null; // 圧縮済み JPEG Blob
let kindFilter = 'all';
const objectUrls = [];

function fillCategories(kind, selected) {
  $('#rc-category').innerHTML = CATEGORIES[kind]
    .map((c) => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
}

async function compressImage(file, maxSize = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

const blobToBase64 = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.readAsDataURL(blob);
});

// ---- OCR（Tesseract.js を必要なときだけ読み込む）----
let tesseractLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  tesseractLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('OCRの読み込みに失敗しました'));
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

export function parseReceiptText(raw) {
  const text = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[，]/g, ',');
  const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const result = {};

  // 日付
  let m = text.match(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/);
  if (m) result.date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  else if ((m = text.match(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/))) {
    const y = 2018 + (m[1] === '元' ? 1 : +m[1]);
    result.date = `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  // 金額：「合計」行を優先、なければ最大の金額
  const toNum = (s) => Number(s.replace(/[,\s]/g, ''));
  const totalLine = lines.find((l) => /(合\s*計|お?買上|総\s*額|ご請求|領収金額|税込)/.test(l) && /\d/.test(l));
  if (totalLine) {
    const nums = totalLine.match(/\d[\d,]*/g);
    if (nums) result.amount = Math.max(...nums.map(toNum));
  }
  if (!result.amount) {
    const all = [...text.matchAll(/[¥￥]\s*(\d[\d,]*)|(\d[\d,]*)\s*円/g)].map((x) => toNum(x[1] || x[2]));
    if (all.length) result.amount = Math.max(...all);
  }

  // 登録番号
  m = text.replace(/\s/g, '').match(/T\d{13}/);
  if (m) result.invoice = m[0];

  // 店名：最初の意味のありそうな行
  const store = lines.find((l) => l.length >= 2 && !/^(領収|レシート|receipt|\d|[¥￥]|TEL|電話)/i.test(l));
  if (store) result.store = store.slice(0, 40);
  return result;
}

function applyFields(f) {
  if (f.date) $('#rc-date').value = f.date;
  if (f.amount) $('#rc-amount').value = f.amount;
  if (f.store) $('#rc-store').value = f.store;
  if (f.invoice) $('#rc-invoice').value = f.invoice;
  if (f.category && CATEGORIES[$('#rc-kind').value].includes(f.category)) $('#rc-category').value = f.category;
}

async function runOcr() {
  if (!currentImage) return;
  const status = $('#ocr-status');
  const btn = $('#btn-ocr');
  btn.disabled = true;
  try {
    status.textContent = 'OCRを準備中…（初回は辞書のダウンロードに時間がかかります）';
    await loadTesseract();
    const { data } = await window.Tesseract.recognize(currentImage, 'jpn+eng', {
      logger: (l) => { if (l.status === 'recognizing text') status.textContent = `読み取り中… ${Math.round(l.progress * 100)}%`; },
    });
    const fields = parseReceiptText(data.text);
    applyFields(fields);
    status.textContent = Object.keys(fields).length ? '読み取りました。内容を確認・修正してください' : '項目を読み取れませんでした。手入力してください';
  } catch (e) {
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function runAiRead() {
  if (!currentImage) return;
  const status = $('#ocr-status');
  const btn = $('#btn-ai-read');
  btn.disabled = true;
  status.textContent = 'AIで読み取り中…';
  try {
    const r = await readReceipt(await blobToBase64(currentImage));
    const allCats = [...CATEGORIES.business, ...CATEGORIES.household];
    applyFields({
      date: r.date,
      amount: r.amount,
      store: r.store,
      invoice: r.invoice_number,
      category: allCats.find((c) => r.category_hint && (c.includes(r.category_hint) || r.category_hint.includes(c))),
    });
    status.textContent = '読み取りました。内容を確認・修正してください';
  } catch (e) {
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

function resetForm() {
  currentImage = null;
  $('#rc-preview').classList.add('hidden');
  $('#rc-preview').removeAttribute('src');
  $('#rc-photo-label').classList.remove('hidden');
  $('#btn-ocr').disabled = true;
  $('#btn-ai-read').disabled = true;
  $('#ocr-status').textContent = '';
  setTimeout(() => {
    $('#rc-date').value = ymd(new Date());
    fillCategories($('#rc-kind').value);
  });
}

export async function renderReceipts() {
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const month = $('#rc-month').value; // YYYY-MM
  const all = await receipts.all();
  const items = all
    .filter((r) => r.date.startsWith(month))
    .filter((r) => kindFilter === 'all' || r.kind === kindFilter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  // 集計
  const total = items.reduce((s, r) => s + r.amount, 0);
  const byCat = {};
  for (const r of items) byCat[r.category] = (byCat[r.category] || 0) + r.amount;
  $('#rc-summary').innerHTML = `
    <div class="stat total"><div class="label">${escapeHtml(month.replace('-', '年'))}月の合計（${items.length}件）</div><div class="value">${yen(total)}</div></div>
    ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `
      <div class="stat"><div class="label">${escapeHtml(c)}</div><div class="value">${yen(v)}</div></div>`).join('')}`;

  const list = $('#receipt-list');
  if (!items.length) {
    list.innerHTML = '<li class="empty">この月の領収書はありません</li>';
    return;
  }
  list.innerHTML = items.map((r) => {
    let thumb = '';
    if (r.image) {
      const url = URL.createObjectURL(r.image);
      objectUrls.push(url);
      thumb = `<img class="thumb" src="${url}" alt="領収書" data-img="${url}">`;
    }
    return `
      <li>
        ${thumb}
        <div class="main">
          <div class="title">${escapeHtml(r.store)}</div>
          <div class="meta">${escapeHtml(r.date)} ・ ${escapeHtml(r.payment)}${r.memo ? ' ・ ' + escapeHtml(r.memo) : ''}</div>
          <div><span class="badge">${r.kind === 'business' ? '仕事' : '家計'}</span><span class="badge">${escapeHtml(r.category)}</span>${r.invoice ? `<span class="badge">${escapeHtml(r.invoice)}</span>` : ''}</div>
        </div>
        <div class="side">
          <span class="amount">${yen(r.amount)}</span>
          <button class="btn btn-small btn-ghost" data-del="${r.id}">削除</button>
        </div>
      </li>`;
  }).join('');
}

async function exportCsv() {
  const month = $('#rc-month').value;
  const items = (await receipts.all())
    .filter((r) => r.date.startsWith(month))
    .filter((r) => kindFilter === 'all' || r.kind === kindFilter)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) { toast('書き出す領収書がありません'); return; }
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['日付', '店名・支払先', '金額', '区分', 'カテゴリ', '支払方法', '登録番号', 'メモ']];
  for (const r of items) rows.push([r.date, r.store, r.amount, r.kind === 'business' ? '仕事' : '家計', r.category, r.payment, r.invoice, r.memo]);
  // Excelで文字化けしないよう BOM を付ける
  download(`receipts_${month}.csv`, '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n'), 'text/csv');
}

export function initReceipts() {
  const now = new Date();
  $('#rc-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#rc-date').value = ymd(now);
  fillCategories('business');

  $('#rc-kind').addEventListener('change', (e) => fillCategories(e.target.value));

  $('#rc-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      currentImage = await compressImage(file);
      $('#rc-preview').src = URL.createObjectURL(currentImage);
      $('#rc-preview').classList.remove('hidden');
      $('#rc-photo-label').classList.add('hidden');
      $('#btn-ocr').disabled = false;
      $('#btn-ai-read').disabled = !hasClaude();
      $('#btn-ai-read').title = hasClaude() ? '' : '設定でClaude APIキーを入れると使えます';
    } catch {
      toast('画像を読み込めませんでした');
    }
  });

  $('#btn-ocr').addEventListener('click', runOcr);
  $('#btn-ai-read').addEventListener('click', runAiRead);

  $('#receipt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = {
      id: uid(),
      date: $('#rc-date').value,
      amount: Math.round(Number($('#rc-amount').value) || 0),
      store: $('#rc-store').value.trim(),
      kind: $('#rc-kind').value,
      category: $('#rc-category').value,
      payment: $('#rc-payment').value,
      invoice: $('#rc-invoice').value.trim(),
      memo: $('#rc-memo').value.trim(),
      image: currentImage,
      createdAt: new Date().toISOString(),
    };
    await receipts.put(r);
    toast(`${r.store} ${yen(r.amount)} を保存しました`);
    $('#rc-month').value = r.date.slice(0, 7);
    e.target.reset();
    renderReceipts();
  });
  $('#receipt-form').addEventListener('reset', resetForm);

  $('#rc-month').addEventListener('change', renderReceipts);
  $$('.seg').forEach((b) => b.addEventListener('click', () => {
    $$('.seg').forEach((x) => x.classList.toggle('active', x === b));
    kindFilter = b.dataset.kind;
    renderReceipts();
  }));

  $('#receipt-list').addEventListener('click', async (e) => {
    const img = e.target.closest('[data-img]');
    const del = e.target.closest('[data-del]');
    if (img) {
      $('#image-dialog-img').src = img.dataset.img;
      $('#image-dialog').showModal();
    }
    if (del && confirm('この領収書を削除しますか？')) {
      await receipts.remove(del.dataset.del);
      renderReceipts();
    }
  });

  $('#btn-csv').addEventListener('click', exportCsv);
  renderReceipts();
}
