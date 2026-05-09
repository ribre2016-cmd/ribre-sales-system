-- 売上管理ツール Ver15.0 RLS設定
-- 目的: ログインユーザーが自分の user_email のデータだけ見えるようにする

-- 念のため列を追加
alter table sales add column if not exists user_email text;
alter table sales add column if not exists user_role text;

alter table purchases add column if not exists user_email text;
alter table purchases add column if not exists user_role text;

alter table evidences add column if not exists user_email text;
alter table evidences add column if not exists user_role text;

-- インデックス
create index if not exists idx_sales_user_email on sales(user_email);
create index if not exists idx_purchases_user_email on purchases(user_email);
create index if not exists idx_evidences_user_email on evidences(user_email);

-- RLSを有効化
alter table sales enable row level security;
alter table purchases enable row level security;
alter table evidences enable row level security;

-- 既存ポリシーを削除して作り直し
drop policy if exists sales_select_own on sales;
drop policy if exists sales_insert_own on sales;
drop policy if exists sales_update_own on sales;
drop policy if exists sales_delete_own on sales;

drop policy if exists purchases_select_own on purchases;
drop policy if exists purchases_insert_own on purchases;
drop policy if exists purchases_update_own on purchases;
drop policy if exists purchases_delete_own on purchases;

drop policy if exists evidences_select_own on evidences;
drop policy if exists evidences_insert_own on evidences;
drop policy if exists evidences_update_own on evidences;
drop policy if exists evidences_delete_own on evidences;

-- sales: 自分のデータだけ
create policy sales_select_own on sales
for select
using (user_email = auth.jwt() ->> 'email');

create policy sales_insert_own on sales
for insert
with check (user_email = auth.jwt() ->> 'email');

create policy sales_update_own on sales
for update
using (user_email = auth.jwt() ->> 'email')
with check (user_email = auth.jwt() ->> 'email');

create policy sales_delete_own on sales
for delete
using (user_email = auth.jwt() ->> 'email');

-- purchases: 自分のデータだけ
create policy purchases_select_own on purchases
for select
using (user_email = auth.jwt() ->> 'email');

create policy purchases_insert_own on purchases
for insert
with check (user_email = auth.jwt() ->> 'email');

create policy purchases_update_own on purchases
for update
using (user_email = auth.jwt() ->> 'email')
with check (user_email = auth.jwt() ->> 'email');

create policy purchases_delete_own on purchases
for delete
using (user_email = auth.jwt() ->> 'email');

-- evidences: 自分のデータだけ
create policy evidences_select_own on evidences
for select
using (user_email = auth.jwt() ->> 'email');

create policy evidences_insert_own on evidences
for insert
with check (user_email = auth.jwt() ->> 'email');

create policy evidences_update_own on evidences
for update
using (user_email = auth.jwt() ->> 'email')
with check (user_email = auth.jwt() ->> 'email');

create policy evidences_delete_own on evidences
for delete
using (user_email = auth.jwt() ->> 'email');
