-- 売上管理ツール Ver14.5 用
-- ユーザー別データ管理のための列追加

alter table sales add column if not exists user_email text;
alter table sales add column if not exists user_role text;

alter table purchases add column if not exists user_email text;
alter table purchases add column if not exists user_role text;

alter table evidences add column if not exists user_email text;
alter table evidences add column if not exists user_role text;

create index if not exists idx_sales_user_email on sales(user_email);
create index if not exists idx_purchases_user_email on purchases(user_email);
create index if not exists idx_evidences_user_email on evidences(user_email);
