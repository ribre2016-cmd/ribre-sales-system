-- 税理士向け共有ページ: Supabase Storage 公開バケット作成 + RLSポリシー
-- 実行方法: Supabaseダッシュボード → SQL Editor で実行してください。
-- 何度実行しても安全（冪等）です。旧ポリシー（authenticated全開放）は本SQLで置き換えられます。
--
-- 用途（2026-07 再設計後）:
--   税理士向け共有は原則 API 方式（/api/mf/evidence-action の action='tax_share_list'）で、
--   共有トークンを検証して短期（24時間）署名URLをその場で発行する。
--   このバケットは「既存の共有リンク（旧マニフェスト方式）」の互換用:
--     - 既存リンクのマニフェスト share/<token>.json は、次回更新時に
--       {v:2}（APIモードへ誘導するポインタ）で上書きされる。
--     - 新規共有はマニフェストを作らない（リンクは #t=<token> のみ）。
--
-- セキュリティ設計:
--   このSupabaseプロジェクトは他アプリ（SELKURA等）と共用のため、update/delete を
--   authenticated 全体に開放すると他アプリのユーザーが共有マニフェストを差し替え・削除できる。
--   所有者照合（owner列 = アップロードした本人）に変更する。既存マニフェストは
--   owner が記録済みのため互換維持・移行不要。
--   新規に authenticated がオブジェクトを作る場合は share/<auth.uid()>/... 配下のみ許可。

insert into storage.buckets (id, name, public)
values ('tax-share', 'tax-share', true)
on conflict (id) do nothing;

-- =====================
-- RLS ポリシー（tax-share バケット限定・所有者照合）
-- =====================

-- 旧ポリシー（全authenticated開放）を確実に廃止
drop policy if exists "tax-share authenticated select" on storage.objects;
drop policy if exists "tax-share authenticated insert" on storage.objects;
drop policy if exists "tax-share authenticated update" on storage.objects;
drop policy if exists "tax-share authenticated delete" on storage.objects;
drop policy if exists "tax-share owner select" on storage.objects;
drop policy if exists "tax-share owner insert" on storage.objects;
drop policy if exists "tax-share owner update" on storage.objects;
drop policy if exists "tax-share owner delete" on storage.objects;

-- 閲覧（authenticatedロールでの一覧・取得）: 所有者のみ。
-- ※公開ページ(tax-share.html)の読み取りは public=true バケットの匿名読み取りで行われ、
--   この select ポリシーの影響を受けない（トークン名が推測困難であることが認可）。
create policy "tax-share owner select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'tax-share'
  and (owner = auth.uid()
       or ((storage.foldername(name))[1] = 'share' and (storage.foldername(name))[2] = auth.uid()::text))
);

-- 追加: share/<uid>/... 配下のみ（他人のマニフェスト名での新規作成を防ぐ）
create policy "tax-share owner insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'tax-share'
  and (storage.foldername(name))[1] = 'share'
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- 更新（x-upsertによる既存マニフェストの上書き）: 所有者のみ
-- （既存の share/<token>.json は owner 照合で本人だけが更新できる）
create policy "tax-share owner update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'tax-share'
  and (owner = auth.uid()
       or ((storage.foldername(name))[1] = 'share' and (storage.foldername(name))[2] = auth.uid()::text))
)
with check (
  bucket_id = 'tax-share'
  and (owner = auth.uid()
       or ((storage.foldername(name))[1] = 'share' and (storage.foldername(name))[2] = auth.uid()::text))
);

-- 削除（共有解除）: 所有者のみ
create policy "tax-share owner delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'tax-share'
  and (owner = auth.uid()
       or ((storage.foldername(name))[1] = 'share' and (storage.foldername(name))[2] = auth.uid()::text))
);
