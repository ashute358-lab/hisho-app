// 話し言葉（日本語）から予定の日時・タイトル・会社名を読み取る

const KANJI_DIGIT = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

function kanjiToNumber(s) {
  if (!/[十百]/.test(s)) {
    return Number([...s].map((c) => KANJI_DIGIT[c]).join(''));
  }
  let total = 0;
  let cur = 0;
  for (const c of s) {
    if (c === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (c === '十') { total += (cur || 1) * 10; cur = 0; }
    else cur = KANJI_DIGIT[c];
  }
  return total + cur;
}

export function normalize(text) {
  return String(text)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/／/g, '/')
    .replace(/[　]/g, ' ')
    // 「十五時」「三十分」「二日」など、単位の直前の漢数字だけを数字に直す
    .replace(/([〇零一二三四五六七八九十百]+)(?=時|分|日|月|年|週|ヶ月|か月|カ月)/g, (m) => String(kanjiToNumber(m)));
}

const WEEKDAYS = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// 文字列から正規表現にマッチした部分を取り除く（タイトル抽出用）
function take(state, re) {
  const m = state.text.match(re);
  if (m) state.text = state.text.slice(0, m.index) + ' ' + state.text.slice(m.index + m[0].length);
  return m;
}

function parseDate(state, now) {
  const today = startOfDay(now);
  let m;

  if ((m = take(state, /(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})\s*日?/))) {
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  if ((m = take(state, /(\d{1,2})\s*月\s*(\d{1,2})\s*日/)) || (m = take(state, /(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/))) {
    let d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
    if (d < today) d = new Date(today.getFullYear() + 1, +m[1] - 1, +m[2]);
    return d;
  }
  if (take(state, /しあさって|明明後日/)) return addDays(today, 3);
  if (take(state, /明後日|あさって/)) return addDays(today, 2);
  if (take(state, /明日|あした|あす/)) return addDays(today, 1);
  if (take(state, /今日|本日|きょう/)) return today;
  if ((m = take(state, /(\d+)\s*日後/))) return addDays(today, +m[1]);
  if ((m = take(state, /(\d+)\s*週間後/))) return addDays(today, +m[1] * 7);

  if ((m = take(state, /(今週|来週|再来週)?\s*の?\s*([日月火水木金土])曜日?/))) {
    const target = WEEKDAYS[m[2]];
    if (m[1]) {
      // 週の始まりを月曜日とする
      const mondayOffset = (today.getDay() + 6) % 7;
      const monday = addDays(today, -mondayOffset);
      const weeks = { '今週': 0, '来週': 1, '再来週': 2 }[m[1]];
      return addDays(monday, weeks * 7 + ((target + 6) % 7));
    }
    let diff = (target - today.getDay() + 7) % 7;
    return addDays(today, diff);
  }
  if ((m = take(state, /(?<![\d月])(\d{1,2})\s*日(?!間|後)/))) {
    let d = new Date(today.getFullYear(), today.getMonth(), +m[1]);
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, +m[1]);
    return d;
  }
  if (take(state, /再来週/)) return addDays(today, 14);
  if (take(state, /来週/)) return addDays(today, 7);
  return null;
}

const PM_WORDS = /午後|夕方|夜|晩|pm/i;

function parseOneTime(state) {
  let m;
  if ((m = take(state, /(午前|午後|朝|昼|夕方|夜|晩|am|pm)?\s*(\d{1,2})\s*時(?!間)\s*(?:(半)|(\d{1,2})\s*分)?/i))) {
    return toTime(m[1], +m[2], m[3] ? 30 : +(m[4] || 0));
  }
  if ((m = take(state, /(午前|午後|朝|昼|夕方|夜|晩|am|pm)?\s*(\d{1,2}):(\d{2})/i))) {
    return toTime(m[1], +m[2], +m[3]);
  }
  if (take(state, /正午|お昼/)) return { h: 12, m: 0 };
  return null;
}

function toTime(prefix, h, min) {
  if (prefix && PM_WORDS.test(prefix) && h < 12) h += 12;
  else if (prefix === '昼' && h < 6) h += 12;
  else if (!prefix && h >= 1 && h <= 7) h += 12; // 「3時」は通常15時の意味
  return { h: h % 24, m: min };
}

function parseDurationHours(state) {
  const m = take(state, /(\d+(?:\.\d+)?)\s*時間\s*(半)?/);
  return m ? Math.round((+m[1] + (m[2] ? 0.5 : 0)) * 60) : null;
}

function parseDurationMinutes(state) {
  const m = take(state, /(\d+)\s*分(間)?/);
  return m ? +m[1] : null;
}

const COMPANY_RE = [
  /([^\s、。,]+?(?:株式会社|有限会社|合同会社|ホールディングス|Inc\.?|Corp\.?|Co\.,? ?Ltd\.?))/,
  /((?:株式会社|有限会社|合同会社|一般社団法人|一般財団法人)\s*[^\s、。,]+?)(?=さん|様|と|で|に|へ|の|を|$|\s|、)/,
  /([^\s、。,]{2,}?)(?:さん|様|社)(?=と|で|に|へ|の|を|訪問|打ち合わせ|ミーティング|商談|面談|$|\s)/,
];

// 日時などを取り除いた後のテキストを渡すと精度が上がる
export function extractCompany(text) {
  const t = normalize(text);
  for (const re of COMPANY_RE) {
    const m = t.match(re);
    if (!m) continue;
    const name = m[1].replace(/^(?:から|まで|より|の|に|は|で|と|、)+/, '').trim();
    if (name.length >= 2 && !/^(?:株式会社|有限会社|合同会社)$/.test(name)) return name;
  }
  return '';
}

function cleanupTitle(s) {
  let t = s
    .replace(/(?:の)?(?:予定|スケジュール|アポ)?\s*(?:を|で|に)?\s*(?:カレンダーに)?\s*(?:入れて|いれて|登録して|追加して|作って|設定して|おいて|お願い)(?:ください|下さい|おいて|くれる|もらえる|します)?[。.!！?？]*$/, '')
    .replace(/(?:の)?(?:予定|スケジュール)(?:です)?[。.]*$/, '')
    .replace(/(?:から|まで|より)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 先頭・末尾に残った助詞や句読点を取る
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^(?:[、。,.\s]|の|に|は|で|、)+/, '').replace(/(?:[、。,.\s]|の|に|を|で|は)+$/, '').trim();
  }
  return t;
}

/**
 * @returns {{title:string, company:string, date:Date|null, allDay:boolean, start:Date|null, end:Date|null, location:string}}
 */
export function parseSchedule(input, now = new Date(), defaultDuration = 60) {
  const raw = normalize(input).trim();
  const state = { text: raw };

  let location = '';
  const loc = take(state, /場所は\s*([^\s、。,]+?)(?:で|にて|です)?(?=[\s、。,]|$)/) || take(state, /([^\s、。,]+?)にて/);
  if (loc) location = loc[1];

  const forceAllDay = !!take(state, /終日|一日中/);
  let date = parseDate(state, now);
  const durH = parseDurationHours(state);
  const t1 = forceAllDay ? null : parseOneTime(state);
  const t2 = t1 ? parseOneTime(state) : null;
  const dur = durH ?? parseDurationMinutes(state);
  const company = extractCompany(state.text);

  if (!date && t1) {
    // 日付なし：今日、その時刻を過ぎていれば明日
    date = startOfDay(now);
    if (t1.h * 60 + t1.m <= now.getHours() * 60 + now.getMinutes()) date = addDays(date, 1);
  }

  let start = null;
  let end = null;
  const allDay = !!date && !t1;
  if (date && t1) {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), t1.h, t1.m);
    if (t2) {
      // 「10時から11時」の2つ目は、開始より前なら午後とみなす
      let h = t2.h;
      if (h * 60 + t2.m <= t1.h * 60 + t1.m && h < 12) h += 12;
      end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, t2.m);
    } else {
      end = new Date(start.getTime() + (dur || defaultDuration) * 60000);
    }
  }

  const title = cleanupTitle(state.text) || (company ? `${company} 打ち合わせ` : '予定');
  return { title, company, date, allDay, start, end, location };
}
