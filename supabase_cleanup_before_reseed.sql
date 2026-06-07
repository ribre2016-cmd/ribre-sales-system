-- =====================================================================
-- RIBRE  再投入前クリーンアップSQL
-- 目的: 前回の失敗で Supabase に上がってしまった不正/重複データを一掃し、
--       「正しいPCのデータ」で入れ直せるようにする。
--
-- ⚠️ 実行すると、このユーザーの Supabase 上の sales/purchases が消えます。
--    正しいデータは「正しいPC(画像1・2)の localStorage とバックアップJSON」に
--    残っているので、消してから再投入すれば失われません。
--    必ず先に「正しいPCのバックアップJSON保存」を済ませてから実行してください。
--
-- Supabase ダッシュボード → SQL Editor で実行。
-- まず STEP1 で件数を確認 → STEP2 で削除、の順がおすすめです。
-- =====================================================================

-- ▼ STEP1: 今 Supabase に入っている自分のデータ件数を確認（削除しません）
select 'sales'     as table, count(*) from sales     where user_email = 'ribre2016@gmail.com'
union all
select 'purchases' as table, count(*) from purchases where user_email = 'ribre2016@gmail.com';

-- 異常値（桁外れ）の確認（任意）
-- select * from purchases where user_email = 'ribre2016@gmail.com' and abs(total) > 1000000000;

-- ▼ STEP2: 自分のデータを全削除（再投入前のリセット）
--    STEP1の件数を確認し、問題なければ次の2行を実行してください。
delete from purchases where user_email = 'ribre2016@gmail.com';
delete from sales     where user_email = 'ribre2016@gmail.com';

-- 完了後、正しいPCのアプリで「設定 → クラウド保存 → ⬆ クラウドへ初期投入」を1回実行します。
