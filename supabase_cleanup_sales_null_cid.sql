-- =====================================================================
-- sales テーブルの重複クリーンアップ（client_id IS NULL 行の削除）
--
-- ★ 2026-07-05 実行済み（ブラウザセッション経由のREST DELETEで3,210行削除、
--    事後検証でクラウド==ローカル完全一致を確認）。このファイルは参照用。
--    バックアップ: Downloads/sales_null_cid_backup_2026-07-05.json
--
-- 背景（2026-07-05 調査で確定）:
--   2026-07-01 に旧UIの smpUploadAllToCloud()（app-simple.js）が
--   client_id 無し・on_conflict=user_email,item_id で全売上をアップロード。
--   その後 data-store.js（pushSafe/reconcile, on_conflict=user_email,client_id）が
--   同じ内容を client_id='db_<id>' で別行として再アップロードし、
--   全 3,210 行がちょうど 2 倍の 6,420 行に倍化した。
--   検証済み: client_id IS NULL の 3,210 行は全て db_ 行の内容重複であり、
--   db_ 行は localStorage(ribre_full_sales221) と全フィールド一致。
--   null 行は data-store.js の削除経路(client_id指定)に乗らないため永久に残る。
--
-- ⚠️ 実行前に必ず:
--   1. 正しいPCで「バックアップJSON保存」を実施
--   2. STEP1 の件数が「null行数 = 全体の半分 = ローカル行数」であることを確認
--
-- Supabase ダッシュボード → SQL Editor で実行。
-- =====================================================================

-- ▼ STEP1: 件数確認（削除しません）。3列が 6420 / 3210 / 3210 のような
--          「全体 = null + 非null」「null = 非null」の関係になっていること。
select
  count(*)                                   as total_rows,
  count(*) filter (where client_id is null)  as null_cid_rows,
  count(*) filter (where client_id is not null) as with_cid_rows
from sales
where user_email = 'ribre2016@gmail.com';

-- ▼ STEP1b: 任意の追加確認。null行のうち、同一内容(日付+商品名+金額)の
--           非null行が存在しないもの（=消すと失われる行）が 0 件であること。
select count(*) as null_rows_without_twin
from sales n
where n.user_email = 'ribre2016@gmail.com' and n.client_id is null
  and not exists (
    select 1 from sales t
    where t.user_email = n.user_email and t.client_id is not null
      and t.sale_date is not distinct from n.sale_date
      and t.item_name = n.item_name and t.amount = n.amount
  );

-- ▼ STEP2: null行を削除（STEP1/1bの確認後に実行）
delete from sales
where user_email = 'ribre2016@gmail.com' and client_id is null;

-- ▼ STEP3: 事後確認。total_rows がローカル行数と一致すればクラウド==ローカル。
select count(*) as total_rows_after
from sales
where user_email = 'ribre2016@gmail.com';
