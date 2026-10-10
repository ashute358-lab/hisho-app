# 秘書アプリ（hisho-app）

スマホのブラウザで使える、個人用の秘書アプリです。GitHub Pages でそのまま公開できます（ビルド不要）。

| 機能 | できること |
| --- | --- |
| 🗓️ 声で予定登録 | マイクに「明日の午後3時から1時間、株式会社サンプルと打ち合わせ」と話すと、日時・タイトル・会社名を読み取って Google カレンダーに登録 |
| 🏢 企業レポート | アポ先の会社を調べてレポートにまとめ、Gmail（またはメールアプリ）で送信 |
| 🧾 領収書管理 | 写真を撮って OCR / AI で読み取り、仕事（経費）・家計に分けて保存。月別集計と CSV 書き出し |

## 🔒 公開しても家計簿・領収書は公開されません

- GitHub に公開されるのは **アプリのプログラムだけ** です。
- 予定・レポート・領収書の写真や金額は、**使っている端末のブラウザ内（localStorage / IndexedDB）にだけ** 保存されます。サーバーには送られません。
- Google のクライアントID や Claude の APIキーも、アプリの「設定」画面で入力し、その端末にだけ保存します。**リポジトリには絶対に書かないでください。**
- 「設定 → バックアップ」で書き出した JSON や CSV には個人データが入ります。**このリポジトリにコミットしないでください**（`.gitignore` で除外済み）。
- 端末やブラウザを変えるとデータは引き継がれません。バックアップ → 読み込みで移行してください。
- 外部に送られるのは、使ったときの次の通信だけです：Google カレンダー / Gmail（予定・レポート）、Wikipedia（会社名の検索）、Claude API（キーを設定してレポート作成や AI 読み取りを使ったとき：会社名、または領収書画像）、OCR 用プログラムのダウンロード（jsDelivr）。

## GitHub Pages で公開する

1. このリポジトリの GitHub ページで **Settings → Pages** を開く
2. **Source** を「GitHub Actions」にする
3. `main` ブランチにこのコードを入れる（push / マージ）と自動で公開されます
   （`.github/workflows/pages.yml`）
4. 公開URL：`https://ashute358-lab.github.io/hisho-app/`

> 「Deploy from a branch」で `main` / `/(root)` を選ぶ方法でも動きます。

スマホでは、ブラウザの「ホーム画面に追加」でアプリのように使えます。

## Google カレンダー / Gmail と連携する（任意）

ログインしなくても「リンクで登録」ボタンで Google カレンダーの登録画面を開けます。
カレンダーへの直接登録・予定の読み込み・Gmail 送信をするには、Google の OAuth クライアントID が必要です（無料）。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **API とサービス → ライブラリ** で「Google Calendar API」と「Gmail API」を有効化
3. **OAuth 同意画面** を作成
   - User Type：外部
   - スコープ：`.../auth/calendar.events` と `.../auth/gmail.send`
   - **テストユーザー** に自分の Gmail アドレスを追加（公開申請は不要。自分だけで使うならテストモードのままでOK）
4. **認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - 種類：ウェブ アプリケーション
   - 承認済みの JavaScript 生成元：`https://ashute358-lab.github.io`
     （手元で試すなら `http://localhost:8000` も追加）
5. 表示された `xxxx.apps.googleusercontent.com` をアプリの **設定 → Google OAuth クライアントID** に貼り付けて保存
6. 右上の「Googleに接続」を押してログイン

※ ログインは約1時間で切れます。切れたらもう一度「Googleに接続」を押してください（ログイン情報は保存しません）。

## Claude API で詳しいレポート・AI 読み取り（任意）

APIキーがなくても、Wikipedia の概要と各種検索リンクで簡易レポートを作れます。
[Claude Console](https://platform.claude.com/) で APIキーを作り **設定 → Claude APIキー** に入れると、

- **企業レポート**：Web 検索で会社概要・事業内容・最近のニュース・商談で使える話題をまとめます（1件 1〜2分）
- **領収書**：写真から日付・店名・金額・登録番号を読み取ります

キーはその端末のブラウザに保存されるので、共用 PC では使わないでください。利用料金は Anthropic のアカウントに請求されます。
心配な場合は Console で利用上限（Spend limit）を設定しておくと安心です。

## 声で話すときのコツ

認識できる言い方の例：

- 「明日の10時から11時半まで ABC商事さんと商談」
- 「来週の金曜日 夜7時 田中さんと食事」
- 「10月20日 14:00 歯医者」
- 「明後日 終日 出張」
- 「15日の朝9時に山田工業株式会社訪問 場所は大阪本社」

時刻だけ「3時」と言った場合は 15時 として扱います（午前なら「午前3時」「朝9時」と言ってください）。
読み取り結果は登録前に確認・修正できます。

音声認識は Chrome（Android / PC）と Safari（iPhone）で使えます。使えないブラウザでは、キーボードの音声入力か手入力でどうぞ。

## 手元で動かす

```sh
python3 -m http.server 8000
# http://localhost:8000 を開く
```

## ファイル構成

```
index.html          画面
css/style.css       デザイン（ライト / ダーク対応）
js/main.js          タブ・設定・バックアップ
js/schedule.js      音声入力と予定登録
js/parse.js         日本語の日時・会社名の読み取り
js/google.js        Google カレンダー / Gmail
js/research.js      企業レポート
js/claude.js        Claude API（任意）
js/receipts.js      領収書管理
js/store.js         端末内へのデータ保存
sw.js               オフライン用キャッシュ
```
