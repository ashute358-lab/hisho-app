// データ保存：設定・予定・レポートは localStorage、領収書（画像付き）は IndexedDB。
// すべてこの端末のブラウザ内にだけ保存され、外部には送信されません。

const PREFIX = 'hisho:';

export const settings = {
  get() {
    return {
      googleClientId: '',
      claudeKey: '',
      email: '',
      duration: 60,
      ...readJson('settings', {}),
    };
  },
  save(v) { writeJson('settings', v); },
};

function readJson(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error(e);
    alert('保存できませんでした（ブラウザの保存領域が使えない可能性があります）');
  }
}

function listStore(key) {
  return {
    all: () => readJson(key, []),
    saveAll: (items) => writeJson(key, items),
    add(item) { const a = this.all(); a.push(item); this.saveAll(a); return item; },
    update(id, patch) { this.saveAll(this.all().map((x) => (x.id === id ? { ...x, ...patch } : x))); },
    remove(id) { this.saveAll(this.all().filter((x) => x.id !== id)); },
  };
}

export const appointments = listStore('appointments');
export const reports = listStore('reports');

// ---- IndexedDB（領収書）----
const DB_NAME = 'hisho';
const DB_VER = 1;
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('receipts')) {
          const s = d.createObjectStore('receipts', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('receipts', mode);
    const result = fn(t.objectStore('receipts'));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const receipts = {
  all: () => tx('readonly', (s) => s.getAll()),
  put: (r) => tx('readwrite', (s) => s.put(r)),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
  clear: () => tx('readwrite', (s) => s.clear()),
};

// ---- バックアップ ----
const blobToDataUrl = (b) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(b);
});

export async function exportAll() {
  const rs = await receipts.all();
  const rsOut = await Promise.all(rs.map(async (r) => ({
    ...r,
    image: r.image ? await blobToDataUrl(r.image) : null,
  })));
  const s = settings.get();
  return {
    app: 'hisho-app',
    version: 1,
    exportedAt: new Date().toISOString(),
    // APIキーはバックアップに含めない
    settings: { email: s.email, duration: s.duration, googleClientId: s.googleClientId },
    appointments: appointments.all(),
    reports: reports.all(),
    receipts: rsOut,
  };
}

export async function importAll(data) {
  if (data?.app !== 'hisho-app') throw new Error('このアプリのバックアップファイルではありません');
  if (data.settings) settings.save({ ...settings.get(), ...data.settings });
  if (Array.isArray(data.appointments)) appointments.saveAll(data.appointments);
  if (Array.isArray(data.reports)) reports.saveAll(data.reports);
  if (Array.isArray(data.receipts)) {
    for (const r of data.receipts) {
      const image = r.image ? await (await fetch(r.image)).blob() : null;
      await receipts.put({ ...r, image });
    }
  }
}

export async function wipeAll() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k));
  await receipts.clear();
}
