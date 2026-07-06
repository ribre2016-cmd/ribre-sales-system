-- 税理士送付ファイル保管庫: Supabase Storage バケット作成 + RLSポリシー
-- 実行方法: Supabaseダッシュボード → SQL Editor で実行してください。
--
-- 用途: pages/app-v2.js（台帳・設定ページ「税理士送付ファイル」カード）が
--       ログインユーザーのaccess_tokenでフロントから直接Storage REST APIへアクセスする
--       （api/配下のサーバーレス関数は経由しない＝Vercel Hobbyの12関数上限を消費しない）。
--       そのため、mf-evidenceバケット（service role専用）と異なり、
--       authenticated ロール向けの select/insert/delete ポリシーが必要。

insert into storage.buckets (id, name, public)
values ('tax-docs', 'tax-docs', false)
on conflict (id) do nothing;

-- =====================
-- RLS ポリシー（authenticated ロール、tax-docs バケット限定）
-- =====================
-- 全ログインユーザーで共有する保管庫のため、ユーザー単位の絞り込みは行わない
-- （オブジェクトキーの表示名・削除状態はアプリ側のインデックス(app_settings skey='tax_docs_index')で管理）。

drop policy if exists "tax-docs authenticated select" on storage.objects;
create policy "tax-docs authenticated select"
on storage.objects for select
to authenticated
using (bucket_id = 'tax-docs');

drop policy if exists "tax-docs authenticated insert" on storage.objects;
create policy "tax-docs authenticated insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'tax-docs');

drop policy if exists "tax-docs authenticated delete" on storage.objects;
create policy "tax-docs authenticated delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'tax-docs');
