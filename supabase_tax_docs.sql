-- 税理士送付ファイル保管庫: Supabase Storage バケット作成 + RLSポリシー
-- 実行方法: Supabaseダッシュボード → SQL Editor で実行してください。
-- 何度実行しても安全（冪等）です。旧ポリシー（authenticated全開放）は本SQLで置き換えられます。
--
-- 用途: pages/app-v2.js（台帳・設定ページ「税理士送付ファイル」カード）が
--       ログインユーザーのaccess_tokenでフロントから直接Storage REST APIへアクセスする
--       （api/配下のサーバーレス関数は経由しない＝Vercel Hobbyの12関数上限を消費しない）。
--
-- セキュリティ設計（2026-07 修正）:
--   このSupabaseプロジェクトは他アプリ（SELKURA等）と共用のため、authenticated ロール
--   全体への開放は「別アプリのログインユーザーが税務書類を読める・消せる」ことを意味する。
--   そこで所有者照合に変更する:
--     - 既存ファイル（YYYY-MM/... パス）: storage.objects.owner 列（アップロード時に
--       自動記録された auth.uid()）と照合 → アップロードした本人（会社の共通アカウント）は
--       これまで通り閲覧・削除できる。データ移行は不要。
--     - 新規ファイル: パスを <auth.uid()>/YYYY-MM/... とし、パス先頭のフォルダ名でも照合する
--       （owner列はSupabase側仕様変更の可能性があるため、パス方式を正とする）。
--   会社内の共有は「全端末が同じアカウントでログインする」運用（既存の恒久ルール）で成立する。

insert into storage.buckets (id, name, public)
values ('tax-docs', 'tax-docs', false)
on conflict (id) do nothing;

-- =====================
-- RLS ポリシー（tax-docs バケット限定・所有者照合）
-- =====================

-- 旧ポリシー（全authenticated開放）を確実に廃止
drop policy if exists "tax-docs authenticated select" on storage.objects;
drop policy if exists "tax-docs authenticated insert" on storage.objects;
drop policy if exists "tax-docs authenticated delete" on storage.objects;
drop policy if exists "tax-docs owner select" on storage.objects;
drop policy if exists "tax-docs owner insert" on storage.objects;
drop policy if exists "tax-docs owner update" on storage.objects;
drop policy if exists "tax-docs owner delete" on storage.objects;

-- 閲覧: 自分がアップロードしたファイル（owner）または自分のuidフォルダ配下
create policy "tax-docs owner select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'tax-docs'
  and (owner = auth.uid() or (storage.foldername(name))[1] = auth.uid()::text)
);

-- 追加: 必ず自分のuidフォルダ配下へ（新規アップロードの規律。フロントも対応済み）
create policy "tax-docs owner insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'tax-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 更新（x-upsert等）: 所有者のみ
create policy "tax-docs owner update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'tax-docs'
  and (owner = auth.uid() or (storage.foldername(name))[1] = auth.uid()::text)
)
with check (
  bucket_id = 'tax-docs'
  and (owner = auth.uid() or (storage.foldername(name))[1] = auth.uid()::text)
);

-- 削除: 所有者のみ（既存のYYYY-MM/...ファイルはowner列で本人と照合される）
create policy "tax-docs owner delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'tax-docs'
  and (owner = auth.uid() or (storage.foldername(name))[1] = auth.uid()::text)
);
