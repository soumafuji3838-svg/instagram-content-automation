# Instagram Content Quality MVP v0.9.6

テーマを入力すると、最新情報を調査した日本語のInstagramカルーセル原稿と5枚のPNG画像を生成し、承認後にInstagram Graph APIへ投稿するMVPです。

## 実装済み

- 「就活研究所（@career_research_center）」のブランド設定
- OpenAI Responses APIのStructured Outputsによる原稿生成
- APIキー未設定時のデモ生成
- 1080×1350pxのカルーセルPNG生成
- ブラウザ上でのプレビューと承認
- 原稿編集後の画像再生成
- AI再生成、承認取り消し、投稿削除
- Instagramログイン方式（`graph.instagram.com`）によるカルーセル投稿
- Vercel Functionsでの実行とVercel Blobへの投稿・画像保存
- Vercel公開時のHTTP Basic認証による管理画面保護
- 安全なドライランモード
- JSONファイルによる簡易投稿管理
- OpenAI拒否・不正なスライド数・不正なハッシュタグの検証
- AIが返したハッシュタグの`#`・全角記号・空白を自動補正
- 5枚のPNG・キャプション・投稿情報をまとめた素材ZIP出力
- キャプションのワンクリックコピー
- 5種類の「2分で分かる」調査レポート
- OpenAI Web Searchを必須化した最新情報の調査
- 検索で確認した参照URL・発行日・対応する主張の保存
- 7項目の品質評価と100点スコア
- 参照元と品質評価をZIPへ同梱
- Pexelsのフリー素材を使う写真付き表紙と、ネイビー基調の共通カルーセルデザイン
- 表紙・本文の位置、色、文字サイズを`config/designs.json`で管理
- 投稿タイプ別CTAと基本ハッシュタグの自動適用
- 文章量・品質スコア・出典IDを満たさない投稿の承認ブロック
- 公開基準は総合75点以上、最新性・参照元4点以上、その他の編集評価3点以上、企業ロゴ全件取得
- 品質ゲートの不合格理由に基づく原稿の自動補正と再評価（標準1回・最大2回）
- 参照URLの`www`・末尾スラッシュ・追跡パラメータ差を吸収した検索確認
- 比較表の固定見出しと値の整合性を補正し、根拠がないセルは`確認できず`と表示
- IRの確認済み事実と「就活への示唆」を分離し、働き方・挑戦機会・社員還元・将来のキャリアへ接続
- 数字・ニュース・制度は参照元に限定し、推論は就活生が確認すべき観点の提示に限定
- 企業公式ドメインからロゴを取得し、企業別グラフ・企業比較見出し・単独企業レポート表紙へ表示
- ロゴ取得失敗時は別企業の画像を使わず、汎用企業アイコンへフォールバック
- 公式サイトの候補が多い場合も、公式ドメインのfaviconプロキシを最終手段として必ず試行

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

## 表紙写真を有効化

[Pexels API](https://www.pexels.com/api/)でAPIキーを取得し、`.env`に設定します。

```env
PEXELS_API_KEY=...
```

未設定でも動作しますが、表紙は仮画像になります。写真の提供元・撮影者・元URLは投稿データと素材ZIPへ保存されます。

## OpenAI生成を有効化

`.env` に設定します。

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6
OPENAI_RESEARCH_MODEL=gpt-5.6
OPENAI_REASONING_EFFORT=low
OPENAI_MAX_OUTPUT_TOKENS=25000
OPENAI_MAX_WEB_SEARCH_CALLS=8
OPENAI_MAX_REPAIR_ATTEMPTS=1
```

生成結果はJSON Schemaに従うため、そのまま画像テンプレートへ渡せます。調査生成ではWeb検索、原稿生成、品質評価、不合格箇所の自動補正、再評価の順に処理します。`OPENAI_MAX_WEB_SEARCH_CALLS`で1投稿あたりの検索回数上限、`OPENAI_MAX_REPAIR_ATTEMPTS`で自動補正回数を設定できます。Vercel Functionsの実行時間を考慮し、補正回数は標準1回、最大2回です。

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

このバージョンは「InstagramログインによるAPI設定」を使用します。必要な主な権限は `instagram_business_basic` と `instagram_business_content_publish` です。

実投稿へ切り替える前に、トークンとUser IDの組み合わせを確認できます。トークンそのものは表示しません。

```bash
npm run verify:instagram
```

`Instagram接続成功: @...` と表示されたら接続情報は一致しています。この確認中も `INSTAGRAM_DRY_RUN=true` のままで構いません。

## Vercelへデプロイ

GitHubリポジトリをVercelへImportし、アクセス範囲の異なる2つのVercel Blobストアを接続します。

1. **公開画像用ストア**: Accessを`Public`、環境変数Prefixを`BLOB`にして作成します。
2. **投稿データ用ストア**: Accessを`Private`、環境変数Prefixを`POSTS_BLOB`にして作成します。

どちらもProductionとPreviewへ接続してください。静的なread-write tokenを使用する場合は、作成画面の「Add a read-write token env var」を有効にします。Vercel OIDCを使用する場合は、各ストアの`*_STORE_ID`と自動提供される`VERCEL_OIDC_TOKEN`で認証されます。

Vercelでは以下の環境変数も設定してください。

```env
STORAGE_MODE=blob
ADMIN_USERNAME=admin
ADMIN_PASSWORD=十分に長い専用パスワード
OPENAI_API_KEY=...
PEXELS_API_KEY=...
INSTAGRAM_DRY_RUN=true
INSTAGRAM_USER_ID=...
INSTAGRAM_ACCESS_TOKEN=...
META_GRAPH_API_VERSION=v26.0
```

接続後、公開側の`BLOB_STORE_ID`と非公開側の`POSTS_BLOB_STORE_ID`が設定されていることを確認してください。read-write token方式では、`BLOB_READ_WRITE_TOKEN`と`POSTS_BLOB_READ_WRITE_TOKEN`も必要です。管理画面とAPIはBasic認証で保護されます。Instagramへ渡す5枚の画像だけは、Metaが取得できる公開URLとして保存され、投稿JSONは別の非公開ストアに保存されます。

初回デプロイ後、発行されたURLを次の環境変数へ登録して再デプロイします。

```env
PUBLIC_BASE_URL=https://your-project.vercel.app
```

公開環境でドライランが完了するまで、`INSTAGRAM_DRY_RUN=false`に変更しないでください。

## アカウント設定

ブランド情報は`config/accounts.json`、画像テンプレートは`config/designs.json`で管理します。

- `id`: システム内の一意ID
- `name`: 表示名
- `instagram`: Instagramユーザー名
- `target`: 対象卒年
- `persona`: 想定読者
- `tone`: 文章トーン
- `designId`: 使用するデザインJSONのID
- `ctaByContentType`: 投稿タイプ別の行動喚起
- `hashtags`: 必ず含める基本ハッシュタグ

`config/designs.json`では1080×1350pxのキャンバス、配色、文字、5枚のページ構成を管理します。生成される構成は次のとおりです。

1. 写真・H1・H2を配置した表紙
2. IR定量要約（3本のグラフと約100文字の要約）
3. IR定性要約（強み／弱み、またはメリット／リスクと将来見通し）
4. 3社または3業界の4軸比較表
5. 保存を促すアクションページ

各数値と比較行には出典IDを持たせ、キャプションの参照元へ追跡できるようにしています。

## 動作確認

```bash
npm test
npm run demo
```

`npm run demo` は `output/demo-*/` に5枚のPNGを生成します。

## 本番化前に追加するもの

- JSON管理からPostgreSQLへの移行
- ログインと権限管理
- ジョブキューと自動リトライ
- 必要に応じた画像保管期限・削除ポリシー
- 投稿予約のスケジューラー
- 企業名・締切・数値を含む投稿の事実確認フロー
- アクセストークンのSecret Manager保管と更新監視

このMVPは、まず「生成→確認→投稿」が一貫して動くことを検証するための構成です。
