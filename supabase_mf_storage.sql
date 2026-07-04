-- MF証憑インボックス Phase2: Supabase Storageバケット作成
-- 用途: api/mf/vouchers.js がMF送信成功後に同じファイルbytesを控え保存し、
--       api/mf/match.js がマッチング添付時にファイルを読み出す（自動マッチング添付の原資）

insert into storage.buckets (id, name, public)
values ('mf-evidence', 'mf-evidence', false)
on conflict (id) do nothing;

-- =====================
-- RLS ポリシー
-- =====================
-- ※ ポリシーを一切作成しない。Vercel Serverless Functions (api/mf/vouchers.js, api/mf/match.js) は
--   SUPABASE_SERVICE_ROLE_KEY（RLSを素通りするservice role）でのみ Storage REST API
--   (/storage/v1/object/mf-evidence/...) にアクセスするため、authenticated/anon 向けの
--   ストレージポリシーは意図的に用意していない（非公開バケット・service role専用）。
