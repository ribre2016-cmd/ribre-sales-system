-- MF証憑インボックス: 「マッチ待ち」ステータスの追加
-- 対象: api/mf/evidence-action.js, api/mf/vouchers.js, api/mf/_lib/mf-match-core.js が
--       読み書きする mf_evidence への列追加・statusのCHECK制約更新
--
-- 背景: MFのvouchers APIは呼ぶたびに必ず新規ファイルを作成し、既存ファイルを後から
-- 仕訳に紐付け直すことも、未紐付けファイル単体を削除することもできない
-- （openapi.yaml PostVouchersRequest/DeleteVouchersRequestで確認済み）。
-- そのため「送信」を押した瞬間にMF側の仕訳がまだ無いと、後日のマッチングで
-- 必ずBoxに同一内容のファイルが2件残ってしまっていた。
-- 対策として、送信時点で仕訳が見つからない場合は即座に未紐付け送信せず、
-- 一旦 awaiting_match（マッチ待ち）として保留し、MFへは一切送信しない。
-- 日次のマッチング処理（processAwaitingMatch。auto-matchのcron・手動の
-- 「マッチング実行」の両方から呼ばれる）が見つかるまで再チェックし続ける
-- （自動フォールバックは無し＝ユーザーが手動でBox画面等から対応する運用）。
-- approved_atは「いつマッチ待ちになったか」の表示用に保持する。
--
-- 何度実行しても安全（冪等）。

alter table mf_evidence add column if not exists approved_at timestamptz;

-- statusのCHECK制約に 'awaiting_match' を追加する。
-- 制約名がCREATE TABLE時の自動命名(<table>_<column>_check)のはずだが、
-- 環境差異に備えて実際の定義から動的に探して置き換える。
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'mf_evidence'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%box_saved%'
    and pg_get_constraintdef(oid) ilike '%status%';
  if con_name is not null then
    execute format('alter table mf_evidence drop constraint %I', con_name);
  end if;

  execute 'alter table mf_evidence add constraint mf_evidence_status_check ' ||
    'check (status in (''pending'', ''awaiting_match'', ''box_saved'', ''attached'', ''failed''))';
end $$;
