---
name: ribre
description: RIBRE売上管理(ribre-sales-system)の作業用スキル。別PCセットアップ、ローカル起動、Git運用、本番(Vercel)反映、ログイン/同時ログインのルール、EC売上・粗利明細・仮入力・登録先の保存と端末間同期、データ不一致(件数が減る等)の原因と復旧(バックアップ復元/クラウドから最新を取得)を扱う。「RIBREのセットアップ」「いつもの手順」「売上がおかしい/同期されない/数字を一致させたい」等で使う。
---

# RIBRE 売上管理 — 作業スキル

静的HTML/JS SPA(ビルド不要)。entry=index.html、services/・pages/ にJS。`?v=` でキャッシュ無効化。
本番=mainへpushでVercel自動デプロイ。**mainへのpushは毎回ユーザーの明示確認を取る**(過去にデータ事故あり)。

- GitHub: `https://github.com/ribre2016-cmd/ribre-sales-system.git`
- ローカル: `$HOME\projects\ribre-sales-system`(このPCは `C:\Users\ksado\projects\ribre-sales-system`)
- Supabase: `https://wjsfunuzosyuknlzglyl.supabase.co` / アカウント `ribre2016@gmail.com`

## 1. セットアップ / 起動 / Git
- 取得: `git clone <repo>` を `$HOME\projects` 配下へ。
- ローカル確認: プロジェクト直下で `python -m http.server 8765`(または `start_local.bat`)→ `http://localhost:8765/index.html`(file://直開き不可)。**URLは毎回統一**(localhostと127.0.0.1は別オリジン=別localStorage)。Node代替: `npx --yes http-server -p 8765`。
- 作業前 `git pull` / 作業後 `git add . && git commit && git push`。**PC移動前に必ずpush・別PCで始める前に必ずpull・同時に2台で編集しない**。
- コード編集時は該当JSの **`?v=` を必ず更新**(index.html)。コミット末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 検証はプレビュー(Claude_Preview)で実データ風にlocalStorageを入れて確認→**テスト用キーは消す**→console errorを確認してからコミット。

## 2. ログイン運用(厳守)
- **全端末で必ず Google `ribre2016@gmail.com` を選んでログイン**(別Googleアカウント=別データ。RLSで user_email 毎に分離)。
- 「再ログインして」が出たら**ログアウトせず**もう一度 `ribre2016@gmail.com` を選び直す(トークン期限切れ。データは消えない)。
- **同時ログイン防止(後勝ち)**: app_settings `skey='active_session'` に有効端末IDを記録。新規ログイン端末が自分を登録し、他端末は約12秒ごとの確認で別IDを検知→自動ログアウト+「別の端末でログインされました」表示。→ **同時に2台が書き込むことはない**。
- 未ログイン/ログアウト/締め出し時は必ずログイン画面(auth-gate)が全面表示。静的サイトゆえ画面ガードは完全防御ではない(本当の防御はSupabase RLS)。

## 3. データの保存先と同期(超重要)
| データ | localStorage | クラウド | 同期方式 |
|---|---|---|---|
| EC売上/仕入 | `ribre_full_sales221`/`ribre_yahoo_sales240`/`ribre_full_purchases221` | Supabase `sales`/`purchases`(RLS) | ログインで hydrate(読込)＋write-through(検証つきupsert/削除) |
| 粗利の明細(売上/仕入) | `ribre_smp_profit_meisai_v1` | app_settings `skey='profit_meisai'` | ts後勝ちLWW |
| 仮入力(当月チャネル/送料) | `ribre_smp_profit_prov_v1`(+`_ts`) | app_settings `skey='profit_prov'` | ts後勝ちLWW |
| 登録先プルダウン | `ribre_smp_partners_v1` | (なし。候補は同期済み明細名から生成) | 明細経由で共有 |
- 明細/仮入力の手動同期=粗利タブ「🔄 他の端末と同期」(`smpProfitSyncNow`)。**入力した端末で🔄→別端末で🔄**の順。push成否を表示(404=app_settings未作成/401=再ログイン/403=RLS)。
- ホーム=全体ダッシュボード(全合算)、**集計タブも全体**(明細・仮入力含む。simpleRenderSummaryがsmpProfitMonthTotalsベース／内訳表はEC分)、売上一覧ページ=EC集計ダッシュボード+EC一覧、粗利タブ=年間表+明細入力。月ロック(`ribre_smp_locked_months`／app_settings `locked_months`)はCSV取込からロック月を保護。全データバックアップ=`smpFullBackup`/`smpFullRestore`(明細・仮入力・登録先・ロックも含む)。詳細は別メモ参照。

## 4. データ不一致(EC売上の件数が減る)— 原因と恒久対策
- **原因**: write-through `reconcile` の **削除ロジック**。ローカルに無くクラウドにある行を削除する。**1台でもローカルが減る(部分読込/容量超過/古いキャッシュ)とクラウドの行を削除→全端末が減る**。
- **対策(実装済 2026-06-08, data-store.js)**: **大量削除ガード** = 1回の削除が「5件超 かつ 既存の20%超」なら異常としてスキップ(upsertは実施)。少数の意図的削除は通る。→ **クラウドが勝手に縮小しない**。
- それでも各端末を一致させたい時: **取り込みタブ「☁ クラウドから最新を取得」(`smpReloadFromCloud`→`ribreStore.hydrate`)** でその端末をクラウドの最新に揃える。
- **恒久ルール(ユーザー向け)**: ①全端末 ribre2016 でログイン ②EC売上の更新は取り込み(CSV)で行う ③不一致を感じたら各端末で「☁ クラウドから最新を取得」 ④入力端末で「🔄 同期」してから別端末を使う。

## 5. 復旧手順(EC売上が壊れた/古い内容に戻った)
1. **上書き系(seed/クラウド保存)を慌てて実行しない**(古い状態で上書きしないため)。
2. 正しいデータの所在を確認: ログアウトしていない別端末に正データが残っていれば、そこで売上CSVダウンロード等でバックアップ。
3. **取り込みタブ「🛟 バックアップから復元」(`smpRestoreBackupFile`)** でバックアップJSON(例 `ribre_sales_backup_Ver29_0_YYYY-MM-DD.json`, 正常時 売上1580/仕入0)を読込。**ログイン中に復元すればwrite-throughでSupabaseにも保存され再発しない**(大量削除ガードで縮小もしない)。
4. 仕入0件はEC側仕様(仕入は粗利明細で管理)。
- 過去の根本対処SQLや経緯: ユーザーは2つのGoogleアカウント(k.sado@ribre.co.jp と ribre2016@gmail.com)を持ち混在が事故元。ribre2016に統一。Supabaseは `supabase_store_setup.sql`(client_id列・app_settings・unique index)適用済み。PostgRESTは1リクエスト最大1000行→必ずページング(fetchAllRows)。

## 6. 主要ファイル
- `pages/app-simple.js`: かんたんモード全般(simpleTab/smpRenderHome/粗利=simpleRenderProfitTable・smpProfitData・smpProfitMonthTotals・meiGridRows/明細・仮入力同期smpProfitMei*・smpProfitProv*/同時ログインsmpDeviceId・smpActiveSessionTick/復旧smpReloadFromCloud・smpRestoreBackupFile)。
- `services/data-store.js`: Supabase=正のwrite-through(hydrate/reconcile+大量削除ガード/seedFromThisPC/clearCache)。`window.ribreStore`。
- `services/auth-gate.js`: 未ログイン全面ガード+ログアウトでEC系キャッシュ消去。
- `index.html`: 各JSの `?v=` とUI(data-screen=home/inbox/manual/summary/profit/list)。
- 詳細メモ: ユーザーメモリ `ribre-setup.md` / `ribre-sales-data-model.md`。
