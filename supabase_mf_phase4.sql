-- MF証憑インボックス Phase4: 台帳スキーマ拡張
-- box_meta_done = MF Box画面で電帳法3項目（取引日・取引先・金額）を手入力済みかの管理フラグ。認証済みユーザーが更新可

alter table mf_evidence add column if not exists box_meta_done boolean not null default false;

drop policy if exists mf_evidence_update_auth on mf_evidence;
create policy mf_evidence_update_auth on mf_evidence
for update to authenticated using (true) with check (true);
