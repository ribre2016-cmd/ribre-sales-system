-- 売上テーブルにCSVの行番号(csv_order)を追加する
--
-- 背景: 売上の並び順は「アカウント順（ヤフオク1〜8→メルカリShops）が外側、
-- その中はCSVの行順」だが、CSVの行番号はlocalStorageの `order` にしか無く、
-- クラウドへ保存していなかった。services/data-store.js の hydrate() は
-- クラウドの内容でlocalStorageを丸ごと置き換えるため、ページを開くたびに
-- order が失われ、並びが日付順（フォールバック）に崩れていた。
--
-- 実行方法: SupabaseダッシュボードのSQL Editorで全文貼り付けて実行。
-- 何度実行しても安全（冪等）。既存データは一切削除しない。
-- 既存行の csv_order は NULL のままだが、次回そのCSVを取り込み直した時点で
-- 正しい行番号が入る（取込は商品IDで重複判定し、既存行を補完更新するため）。

alter table sales add column if not exists csv_order integer;

-- 並び替えに使うため索引を張る（アカウント内の行番号順）
create index if not exists idx_sales_order
  on sales (user_email, account, csv_order);
