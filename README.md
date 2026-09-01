# Instagram Content Quality MVP v0.4

テーマを入力すると、日本語のInstagramカルーセル原稿と7枚のPNG画像を生成し、承認後にInstagram Graph APIへ投稿するMVPです。

## 実装済み

- 複数アカウント設定
- OpenAI Responses APIのStructured Outputsによる原稿生成
- APIキー未設定時のデモ生成
- 1080×1350pxのカルーセルPNG生成
- ブラウザ上でのプレビューと承認
- 原稿編集後の画像再生成
- AI再生成、承認取り消し、投稿削除
- Instagram Graph APIのカルーセル投稿
- 安全なドライランモード
- JSONファイルによる簡易投稿管理
- OpenAI拒否・不正なスライド数・不正なハッシュタグの検証
- AIが返したハッシュタグの`#`・全角記号・空白を自動補正
- 7枚のPNG・キャプション・投稿情報をまとめた素材ZIP出力
- キャプションのワンクリックコピー
- 5種類の「2分で分かる」調査レポート
- OpenAI Web Searchを必須化した最新情報の調査
- 検索で確認した参照URL・発行日・対応する主張の保存
- 7項目の品質評価と100点スコア
- 参照元と品質評価をZIPへ同梱

## 必要環境

- Node.js 22以上
- Instagram BusinessまたはCreatorアカウント
- 実投稿時のみ、公開HTTPS URLとInstagram Graph APIのアクセストークン

## セットアップ

```bash
npm install
cp .env.example .env
npm start
```

ブラウザで `http://localhost:3000` を開きます。

初期状態ではOpenAI APIキーなし・Instagram投稿ドライランで動作します。テーマを入力するとデモ原稿と画像が生成されます。

## OpenAI生成を有効化

`.env` に設定します。

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6
OPENAI_RESEARCH_MODEL=gpt-5.6
OPENAI_REASONING_EFFORT=low
OPENAI_MAX_OUTPUT_TOKENS=25000
OPENAI_MAX_WEB_SEARCH_CALLS=8
```

生成結果はJSON Schemaに従うため、そのまま画像テンプレートへ渡せます。調査生成ではWeb検索、原稿生成、品質評価の順に処理するため、v0.3より生成時間とAPI利用料が増えます。`OPENAI_MAX_WEB_SEARCH_CALLS`で1投稿あたりの検索回数上限を設定できます。

## Instagram実投稿を有効化

アプリを公開HTTPS環境へデプロイし、`.env` を設定します。

```env
PUBLIC_BASE_URL=https://your-public-app.example.com
INSTAGRAM_DRY_RUN=false
INSTAGRAM_USER_ID=...
INSTAGRAM_ACCESS_TOKEN=...
META_GRAPH_API_VERSION=v26.0
```

Metaが画像を取得するため、`PUBLIC_BASE_URL/output/...` が外部からアクセスできる必要があります。ローカルURLのまま実投稿はできません。

必要な主な権限は、利用するログイン方式に応じて `instagram_content_publish` または `instagram_business_content_publish` です。権限名や審査要否はMetaの現行ドキュメントで確認してください。

## アカウント設定

`config/accounts.json` にブランド設定を追加します。

- `id`: システム内の一意ID
- `name`: 表示名
- `target`: 対象卒年
- `persona`: 想定読者
- `tone`: 文章トーン
- `primaryColor` / `secondaryColor`: デザイン色
- `cta`: 最終ページの行動喚起

## 動作確認

```bash
npm test
npm run demo
```

`npm run demo` は `output/demo-*/` に7枚のPNGを生成します。

## 本番化前に追加するもの

- JSON管理からPostgreSQLへの移行
- ログインと権限管理
- ジョブキューと自動リトライ
- S3などへの画像保存
- 投稿予約のスケジューラー
- 企業名・締切・数値を含む投稿の事実確認フロー
- アクセストークンのSecret Manager保管と更新監視

このMVPは、まず「生成→確認→投稿」が一貫して動くことを検証するための構成です。
