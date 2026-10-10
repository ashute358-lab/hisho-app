// Claude API（任意）。ビルド不要の静的サイトなので fetch で直接呼び出します。
// APIキーは利用者がこの端末に保存したものだけを使い、リポジトリには含めません。

import { settings } from './store.js';

const MODEL = 'claude-opus-5-5';

export const hasClaude = () => !!settings.get().claudeKey.trim();

async function call(body) {
  const key = settings.get().claudeKey.trim();
  if (!key) throw new Error('設定タブで Claude APIキーを入力してください');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, fallbacks: 'default', ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Claude APIキーが正しくありません');
    if (res.status === 429) throw new Error('Claude APIの利用上限に達しました。少し待ってから再試行してください');
    throw new Error(`Claude API エラー: ${msg}`);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error('この内容はAIが対応できませんでした');
  }
  return data;
}

const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('');

function sourcesOf(content) {
  const urls = new Map();
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) urls.set(r.url, r.title || r.url);
    }
    for (const c of b.citations || []) if (c.url) urls.set(c.url, c.title || c.url);
  }
  return [...urls].map(([url, title]) => ({ url, title }));
}

/** Web検索で企業を調べ、日本語のMarkdownレポートを返す */
export async function researchCompany(company, context) {
  const prompt = [
    `次の会社とこれから商談・打ち合わせをします。Web検索で調べ、事前準備用の企業レポートを日本語で作ってください。`,
    `会社名: ${company}`,
    context ? `予定・目的: ${context}` : '',
    '',
    '構成（Markdown、見出しは ## を使用）:',
    '## 概要（正式名称・所在地・設立・代表者・従業員数・資本金/売上など分かる範囲）',
    '## 事業内容・主な製品/サービス',
    '## 最近のニュース・動向（日付つき、直近1年を優先）',
    '## 商談で使えそうな話題・質問案',
    '## 注意点（同名企業の可能性、情報の不確かな点など）',
    '',
    '同名の会社が複数ある場合はその旨を書き、最も可能性が高いものを中心にしてください。',
    '確認できなかった項目は「不明」と書き、推測で埋めないでください。前置きや結びの挨拶は不要です。',
  ].filter(Boolean).join('\n');

  const messages = [{ role: 'user', content: prompt }];
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', country: 'JP' } }];
  let data;
  const allContent = [];
  for (let i = 0; i < 5; i++) {
    data = await call({ messages, tools, output_config: { effort: 'medium' } });
    allContent.push(...data.content);
    if (data.stop_reason !== 'pause_turn') break;
    // サーバー側のツール実行が途中で一時停止したら、そのまま続きを依頼する
    messages.push({ role: 'assistant', content: data.content });
  }
  return { markdown: textOf(data.content), sources: sourcesOf(allContent) };
}

/** 領収書の画像から項目を読み取る */
export async function readReceipt(base64Jpeg) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['date', 'store', 'amount', 'invoice_number', 'category_hint'],
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD。不明なら空文字' },
      store: { type: 'string', description: '店名・発行者。不明なら空文字' },
      amount: { type: 'integer', description: '税込合計金額（円）。不明なら0' },
      invoice_number: { type: 'string', description: '適格請求書発行事業者の登録番号（T+13桁）。なければ空文字' },
      category_hint: { type: 'string', description: '内容から推測される支出カテゴリ（例：交通費、会議費、食費、日用品）' },
    },
  };
  const data = await call({
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg } },
        { type: 'text', text: 'この領収書/レシートから項目を読み取ってください。' },
      ],
    }],
  });
  return JSON.parse(textOf(data.content));
}
