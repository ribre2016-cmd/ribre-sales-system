-- 税理士向け共有ページ: Supabase Storage 公開バケット作成 + RLSポリシー
-- 実行方法: Supabaseダッシュボード → SQL Editor で実行してください。
--
-- 用途: pages/app-v2.js（台帳・設定ページ「税理士送付ファイル」カードの共有セクション）が
--       tax-docs バケットの各ファイルへの署名付きURLをまとめたマニフェストJSONを
--       tax-share バケット（公開）へ share/<token>.json として置く。
--       税理士はログイン不要・URL1本（tax-share.html）でマニフェストをfetchして一覧を見る。
--       マニフェストのアップロード/更新/削除はログイン中ユーザー(access_token)がフロントから
--       直接Storage REST APIへ行うため、authenticated ロール向けの
--       insert / update（x-upsertに必要） / delete / select ポリシーが必要。
--       公開バケットのため、tax-share.html側（未ログイン）からの読み取りはポリシー不要
--       （storage.objects の public select は Supabase Storage が public=true バケットに対して自動許可する）。

insert into storage.buckets (id, name, public)
values ('tax-share', 'tax-share', true)
on conflict (id) do nothing;

-- =====================
-- RLS ポリシー（authenticated ロール、tax-share バケット限定）
-- =====================
-- マニフェストの生成・更新・解除はログイン中ユーザーのみが行う。
-- 内容（token）自体がURLの認可情報のため、バケット内オブジェクトの絞り込みは行わない。

drop policy if exists "tax-share authenticated select" on storage.objects;
create policy "tax-share authenticated select"
on storage.objects for select
to authenticated
using (bucket_id = 'tax-share');

drop policy if exists "tax-share authenticated insert" on storage.objects;
create policy "tax-share authenticated insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'tax-share');

drop policy if exists "tax-share authenticated update" on storage.objects;
create policy "tax-share authenticated update"
on storage.objects for update
to authenticated
using (bucket_id = 'tax-share')
with check (bucket_id = 'tax-share');

drop policy if exists "tax-share authenticated delete" on storage.objects;
create policy "tax-share authenticated delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'tax-share');
