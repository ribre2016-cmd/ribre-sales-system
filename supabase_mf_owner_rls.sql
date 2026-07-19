-- MF証憑台帳(mf_evidence)のRLSオーナースコープ化
-- 背景: このSupabaseプロジェクトはSELKURA等の別アプリと共用しており、
-- 旧ポリシー（authenticated全開放 using(true)）では同居アプリのログインユーザーが
-- 経理証憑台帳を閲覧・改ざんできてしまう。tax-docs/tax-shareで実施済みの
-- オーナースコープ化と同じ方針で、RIBREのログインアカウントのみに制限する。
--
-- 実行方法: SupabaseダッシュボードのSQL Editorで全文貼り付けて実行。
-- 何度実行しても安全（冪等）。既存データは一切削除しない。
--
-- クライアント(mf-evidence.html)からの直接アクセスは SELECT（台帳表示・重複チェック）と
-- UPDATE（Box入力チェックbox_meta_doneのみ）の2種。INSERT/DELETEは全てサービスロール
-- 経由のAPI（RLS対象外）なので、authenticated向けinsertポリシーは廃止する。

-- 1) オーナー列を追加（サービスロールAPIのinsertはdefaultで自動的に埋まる）
alter table mf_evidence add column if not exists user_email text not null default 'ribre2016@gmail.com';

-- 2) 既存行のバックフィル（defaultはalter時に全行へ適用されるが念のため明示）
update mf_evidence set user_email = 'ribre2016@gmail.com' where user_email is null or user_email = '';

-- 3) 旧・全開放ポリシーを廃止し、オーナースコープ版へ置き換え
drop policy if exists mf_evidence_select_auth on mf_evidence;
drop policy if exists mf_evidence_insert_auth on mf_evidence;
drop policy if exists mf_evidence_update_auth on mf_evidence;

-- 証憑台帳は会社共有のため、per-rowオーナー一致ではなくRIBREメンバーの
-- メール許可リスト方式にする（当初のuser_email一致方式は、実運用のログイン
-- k.sado@ribre.co.jp で台帳が空表示になったため本方式へ変更。2026-07-19）。
-- メンバー追加時はこのリストにメールを足して再実行する。
drop policy if exists mf_evidence_select_own on mf_evidence;
drop policy if exists mf_evidence_update_own on mf_evidence;
drop policy if exists mf_evidence_select_member on mf_evidence;
drop policy if exists mf_evidence_update_member on mf_evidence;

create policy mf_evidence_select_member on mf_evidence
for select to authenticated
using ((auth.jwt() ->> 'email') in ('ribre2016@gmail.com', 'k.sado@ribre.co.jp'));

create policy mf_evidence_update_member on mf_evidence
for update to authenticated
using ((auth.jwt() ->> 'email') in ('ribre2016@gmail.com', 'k.sado@ribre.co.jp'))
with check ((auth.jwt() ->> 'email') in ('ribre2016@gmail.com', 'k.sado@ribre.co.jp'));

-- insertポリシーは意図的に作らない（クライアント直接insertは存在しない。
-- 旧ポリシーのコメントにあった「将来のクライアント直接insertに備え」は
-- 攻撃面を広げるだけなので廃止。必要になったらオーナースコープ付きで追加する）

-- deleteポリシーも従来どおり作らない（削除はサービスロールAPIのみ）

-- 4) メール取込の重複防止をDB制約でも保証（同時実行TOCTOU対策）
-- 注意: 既に重複したcontent_hashが存在するとindex作成が失敗する。
-- まず以下のSELECTで重複を確認し、0件であることを確かめてから作成される
-- （重複があった場合はこのSQL全体が失敗するので、重複行を報告してください。
--  勝手に削除はしない）。
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count from (
    select content_hash from mf_evidence
    where content_hash is not null
    group by content_hash having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception 'content_hashに重複が%件あります。先に重複行を確認してください: select content_hash, count(*) from mf_evidence where content_hash is not null group by content_hash having count(*) > 1;', dup_count;
  end if;
  execute 'create unique index if not exists uq_mf_evidence_content_hash on mf_evidence(content_hash) where content_hash is not null';
end $$;
