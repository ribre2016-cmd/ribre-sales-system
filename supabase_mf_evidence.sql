-- マネーフォワード証憑インボックス テーブル設計
-- 既存の ribre-sales-system Supabase プロジェクトに追加
-- 対象: api/mf/* (Vercel Serverless Functions) が読み書きする mf_tokens / mf_evidence

-- =====================
-- 1. MFトークンテーブル（id=1固定の1行運用・service roleのみアクセス）
-- =====================
create table if not exists mf_tokens (
  id integer primary key default 1,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz default now()
);

-- =====================
-- 2. 証憑台帳テーブル
-- =====================
create table if not exists mf_evidence (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  ocr_date date,
  ocr_amount numeric,
  ocr_vendor text,
  storage_path text,
  mf_file_id text,
  journal_id text,
  status text not null default 'pending' check (status in ('pending', 'box_saved', 'attached', 'failed')),
  error_message text,
  created_at timestamptz default now()
);

-- =====================
-- インデックス
-- =====================
create index if not exists idx_mf_evidence_created_at on mf_evidence(created_at);
create index if not exists idx_mf_evidence_status on mf_evidence(status);

-- =====================
-- RLS 有効化
-- =====================
alter table mf_tokens enable row level security;
alter table mf_evidence enable row level security;

-- =====================
-- RLS ポリシー（mf_tokens）
-- ※ ポリシーを一切作成しない。Vercel Serverless Functions は
--   SUPABASE_SERVICE_ROLE_KEY（RLSを素通りするservice role）でのみアクセスするため、
--   authenticated/anon 向けのポリシーは意図的に用意していない。
-- =====================

-- =====================
-- RLS ポリシー（mf_evidence テーブル）
-- =====================
drop policy if exists mf_evidence_select_auth on mf_evidence;
drop policy if exists mf_evidence_insert_auth on mf_evidence;

-- ログイン済みユーザーは閲覧可能
create policy mf_evidence_select_auth on mf_evidence
for select to authenticated using (true);

-- ログイン済みユーザーは登録可能（実際の送信はservice role経由のAPIで行うが、
-- 将来のクライアント直接insertにも備えて許可しておく）
create policy mf_evidence_insert_auth on mf_evidence
for insert to authenticated with check (true);
