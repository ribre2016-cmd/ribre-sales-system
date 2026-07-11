-- MF証憑インボックス: 通貨列の追加
-- 対象: api/mf/ingest-mail.js, api/mf/vouchers.js が読み書きする mf_evidence への列追加
--
-- 背景: 外貨建て請求書（Anthropic/OpenAI等のドル建てAPI利用料）をOCRすると、
-- 印字された数値（例: 5.5）がそのまま ocr_amount に入り、円と誤認された状態で
-- 台帳に「5.5円」のように表示されていた。OCRが通貨（JPY/USD等）を併せて
-- 読み取るようにし、円以外の場合はここに記録して金額ベースのマッチングを
-- スキップする（取引先名+日付のみでの照合に切り替える）。
-- 何度実行しても安全（冪等）。

alter table mf_evidence add column if not exists ocr_currency text not null default 'JPY';
