# Ver60 以降：index.html 分割アーキテクチャ計画

## 目的

- **`index.html`（約6,500行超）** を `services` / `pages` / `styles` / `components` に分割し、保守性を上げる。
- **既存の動作・データ（localStorage キー、Supabase スキーマ、画面遷移）を変えない**ことを最優先する。

## 現状の整理（事実ベース）

| 項目 | 内容 |
|------|------|
| エントリ | ルート `index.html` のみ（Vercel / Netlify とも一致） |
| スタイル | **`styles/base.css` + `styles/mobile.css`**（Phase1 で `<link>` 読み込み。旧インライン2ブロックと同等） |
| マークアップ | `<section id="...">` が **43** 個。`id` は `dash`, `settings`, … `product60` および `staffcloud48` など |
| スクリプト | **`core.js`** → **`supabase-rest.js`** → **`supabase-auth.js`** → **`openai-ocr.js`** → **`app-main.js`** → **`ver230`～`ver390`** → **`storage.js`** → **`ver420`～`ver600`** |
| 依存 | ES modules 未使用。`onclick="showSec(...)"` 等 **グローバル関数** に依存 |

### 注意（ナビとセクション）

- `staffcloud48` セクションは存在するが、**上部ナビに直接対応するボタンがない**可能性がある（到達経路は別 UI や将来用）。分割時に **HTML の丸ごと移動**で挙動を維持し、必要なら別タスクでナビ追加を検討。

## 目標ディレクトリ（Ver56 計画との対応）

[REFACTOR_PLAN_Ver56_0.md](REFACTOR_PLAN_Ver56_0.md) の `/pages`, `/components`, `/services`, `/styles` と整合させる。

```
ribre-sales-system-main/
├── index.html          # 当面はエントリのまま（段階的に薄くする）
├── styles/             # 抽出した CSS（後から link またはビルドで結合）
├── services/           # supabase, openai, storage, csv, sync 等のロジック
├── pages/              # 画面（セクション）単位の HTML 断片
├── components/         # ヘッダ・ナビ・繰り返しパネル等
└── docs/
```

`supabase/` や `ai/` 等の **さらに細いフォルダ**は、最初の分割が安定してから `services/` 下に再配置するか、ファイル名プレフィックス（`supabase-*.js`）で足りるかを判断する。

## 分割時の原則（動作を壊さないためのルール）

1. **1 フェーズ＝1 種類の変更**（例: 今回は CSS だけ外部化、など）。コミットも細かくする。
2. **グローバル API を急に ES module にしない**。最初は `<script src="...">` の読み込み順で、従来どおり `function foo()` を window に載せる。
3. **DOM の `id` / `class` / `onclick` の文字列は変えない**（分割は主に「ファイルの移動」と「読み込み方法の変更」に留める）。
4. **localStorage キー（`LS` オブジェクト等）は変更しない**。
5. 各ステップ後に **ローカル `python -m http.server` で全ナビタブを1周**し、コンソールエラーがないことを確認する。
6. 退避用に **`index.html` のコピー**（例: `index.backup.Ver60_pre_split.html`）または Git タグを必ず残す。

## 推奨フェーズ（安全な順序）

既存の「CSS → 設定/認証 → …」の順序を尊重し、Ver60 のボリュームに合わせて具体化する。

### フェーズ 0（完了想定）：ドキュメントと空フォルダ

- `README.md`、本計画、`styles/` `services/` `pages/` `components/` の **予約のみ**。
- **`index.html` は未変更でも可**（フォルダと README のみでも可）。

### フェーズ 1：スタイルの外部化（`styles/`）— **実施済み**

- `index.html` 内の2つの `<style>` を `styles/base.css`, `styles/mobile.css` に移し、`<link rel="stylesheet">` で読み込む。
- 元のルール・値と同一（整形のための改行・空白のみの差分）。`<style id="ver310-mobile-style">` は削除済み（スクリプトから参照されていなかった）。

### フェーズ 2：共通コア JS の抽出（`services/`）— **一部実施済み（最小スコープ）**

- **`services/core.js`**: `LS`, `yen`, `num`, `today`, `get`, `setLS`, `sales`/`purchases`/`evidences`/`candidates`/`sb`/`sess`/`email`/`role`, `renderList`, `showSec`, `csvDownload`（元コードと同等のロジック）。
- **`app-main.js`**: `refreshTop` / `refreshAll` / `monthlySummary` / 設定（`saveSupabase`・`checkSupabase`・`saveOpenAI`）/ `renderSales`・`renderPurchases` / `addSale`・`addPurchase` / CSV エクスポート2種 / `cloudMonthly` / 初回 `load`。読み込み順は **`openai-ocr.js` の直後**（従来インライン位置）。
- **`sess` / `email` / `role`**: 引き続き **`core.js`**（読み取り・`LS` キー定義）。`signIn` / `signOut` は **`supabase-auth.js`** で `LS.sess` と補助キーを更新。
- **`checkSupabase` / `cloudMonthly`**: **`app-main.js`**（`cloudMonthly` は REST なし）。
- **`storage.js`**: 証憑クラウド・Storage 汎用保存を集約。`ver410LinkEvidenceToLatest` は **`refreshAll`**（`app-main.js`）を実行時参照。`csvDownload` は `core.js`。
- **残タスク（将来）**: インライン残りの整理、その他 `ver*` の `.js` 化など。

### フェーズ 3：バージョン別スクリプトのファイル化（`services/`）

- `ver230-shipping` ～ `ver600-productization` を **`script id` と同名の `.js` ファイル**（例: `services/ver230-shipping.js`）に1対1で切り出す。
- `index.html` には `<script src="services/ver230-shipping.js"></script>` の列挙のみ残す（順序は現状と同一にする）。

### フェーズ 4：HTML セクションの断片化（`pages/` + `components/`）

**難易度が最も高い**ため、フェーズ 1〜3 が安定してから着手。

- **方式 A（推奨・段階的）**: まず **ヘッダ・ナビだけ** `components/header.html` 等にし、ビルドなしでは `fetch` + `innerHTML` で合成するか、サーバ側 include が無い場合は **最初は手動で index にコピペ用の断片ファイルを置くだけ**（実行時結合は後回し）。
- **方式 B**: 軽いビルド（例: 単純な concat スクリプト）で `index.html` を生成。**リポジトリの「正」**を断片にするか `index.html` にするかをチームで決める。

各 `<section id="...">` の対応表（移行チェックリスト用）:

| section `id` | 画面名（nav ラベル） | 備考 |
|--------------|----------------------|------|
| dash | ダッシュボード | |
| settings | 設定・ログイン | |
| sales | 売上管理 | |
| purchases | 仕入管理 | |
| ocr | OCR・証憑 | |
| cloud | クラウド保存 | |
| shipping | 配送照合 | ver230 |
| yahoo | ヤフオクCSV | |
| analytics | 集計・出力 | |
| backup | バックアップ | |
| permissions | 権限・ロック | |
| autosync | 自動同期（旧ブロック名と重複注意） | 後段 `sync54` とも要整理 |
| search | 検索・絞込 | |
| templates | テンプレート | |
| aiclassify | AI分類 | |
| datacheck | データ確認 | |
| fixtasks | 修正タスク | |
| monthclose | 月締め | |
| accounting | 会計出力 | |
| evidencecloud | 証憑クラウド | |
| dashboard42 | 経営分析 | |
| schema43 | 本番設計 | |
| migration44 | 本番移行 | |
| dedupe45 | 重複防止 | |
| realtime46 | リアルタイム | |
| staff47 | スタッフ運用 | |
| staffcloud48 | （ナビに無い可能性） | 到達経路の確認 |
| storage49 | Storage保存 | |
| aiauto50 | AI自動登録 | |
| analytics51 | 分析強化 | |
| report52 | 日次レポート | |
| backup53 | 本番バックアップ | |
| sync54 | 自動同期 | `autosync` との機能重複に注意 |
| audit55 | 操作ログ | |
| organize56 | 整理・引継ぎ | |
| beginner57 | 初心者モード | |
| mobile58 | スマホ最適化 | |
| stable59 | 安定化 | |
| product60 | 商品化準備 | |

### フェーズ 5（任意）：`components/` の充実

- `.panel`, `.grid`, `.controls` の繰り返しを **HTML スニペット or 小さな `renderX()`** に寄せる。テンプレートリテラル化は **表示が変わらないことを確認してから**。

## 検証チェックリスト（各フェーズ共通）

- [ ] ログイン / ログアウト、Supabase 接続テスト
- [ ] 売上・仕入の追加とテーブル表示
- [ ] OCR フロー（キー未設定時のアラート含む）
- [ ] ナビの **全ボタン**で `showSec` がエラーなく動く
- [ ] モバイル用 CSS（狭い幅）でレイアウトが崩れない
- [ ] ブラウザコンソールに **未定義関数・読み込み順エラーがない**

## 今回スコープ外（別イシュー推奨）

- SaaS 化、Stripe、店舗別管理（README_Ver60 の「ここからは」ロードマップ）
- ビルドツール（Vite 等）の導入は、上記フェーズが完了してからの方が安全

---

*本ドキュメントは Ver60 時点の `index.html` 構造に基づく。分割作業中にセクションが増えた場合は表とフェーズ 4 を更新すること。*
