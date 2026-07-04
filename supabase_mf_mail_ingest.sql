-- MF証憑インボックス: メール自動取込(機能C)対応の台帳スキーマ拡張
-- 対象: api/mf/ingest-mail.js が読み書きする mf_evidence への列追加
-- content_hash = 添付ファイルbytesのSHA-256。Apps Scriptの二重実行やメール再取込による重複送信を防ぐための一意キー用途。

alter table mf_evidence add column if not exists content_hash text;
alter table mf_evidence add column if not exists source text;
alter table mf_evidence add column if not exists mail_from text;
alter table mf_evidence add column if not exists mail_subject text;

create index if not exists idx_mf_evidence_content_hash on mf_evidence(content_hash);
