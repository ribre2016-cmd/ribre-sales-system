-- =====================================================================
-- 勤怠管理システム セキュリティ修正（コードレビュー対応）
-- ---------------------------------------------------------------------
-- このスクリプトは「supabase_attendance.sql を既に適用済みか未適用か
-- 分からない」状態でも安全に流せるよう、すべて冪等（何度流しても同じ）
-- に書いています。Supabase の SQL Editor でそのまま実行してください。
--
-- 対応する指摘:
--   P0  LINEチャネルトークンが誰でも読める（settings_select_all=using(true)）
--       → 管理者専用テーブル company_secrets に分離し、company_settings
--         からトークン列を削除。Bot はサービスロールで読むので影響なし。
--   P1  staff の管理者ポリシーが staff 自身を参照して無限再帰
--       → SECURITY DEFINER の is_admin() 関数で再帰を回避。
--   P2  staff_select_all が匿名にも email / line_user_id を公開
--       → ログイン済み（authenticated）のみに制限。
-- =====================================================================

-- 対象テーブルが未作成でも安全に進めるためのガード ---------------------
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  line_user_id text,
  role text not null default 'staff',
  is_active boolean default true,
  created_at timestamptz default now()
);
create table if not exists company_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default '株式会社RIBRE',
  latitude double precision,
  longitude double precision,
  radius_meters integer default 50,
  alert_clock_in time default '09:00',
  alert_clock_out time default '20:00',
  updated_at timestamptz default now()
);

-- =====================================================================
-- 1. 管理者判定関数（SECURITY DEFINER で staff の RLS を回避 → 再帰しない）
-- =====================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = auth.jwt() ->> 'email'
      and role = 'admin'
      and coalesce(is_active, true) = true
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- =====================================================================
-- 2. P0: LINEトークンを管理者専用テーブルへ分離
-- =====================================================================
create table if not exists company_secrets (
  id uuid primary key default gen_random_uuid(),
  line_channel_access_token text,
  line_admin_user_id text,
  updated_at timestamptz default now()
);
alter table company_secrets enable row level security;

-- company_settings に旧トークン列が残っていれば、値を退避してから列を削除
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_settings'
      and column_name = 'line_channel_access_token'
  ) then
    if not exists (select 1 from public.company_secrets) then
      insert into public.company_secrets (line_channel_access_token, line_admin_user_id)
      select line_channel_access_token, line_admin_user_id
      from public.company_settings
      order by updated_at desc nulls last
      limit 1;
    end if;
  end if;
  alter table public.company_settings drop column if exists line_channel_access_token;
  alter table public.company_settings drop column if exists line_admin_user_id;
end $$;

-- company_secrets は管理者のみ（Bot はサービスロールキーで RLS を素通り）
drop policy if exists secrets_admin_all on company_secrets;
create policy secrets_admin_all on company_secrets
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- =====================================================================
-- 3. P1/P2: staff の RLS を is_admin() ベースに（再帰解消 + 匿名締め出し）
-- =====================================================================
alter table staff enable row level security;

drop policy if exists staff_select_all on staff;
drop policy if exists staff_select_auth on staff;
drop policy if exists staff_insert_admin on staff;
drop policy if exists staff_update_admin on staff;
drop policy if exists staff_delete_admin on staff;

-- ログイン済みユーザーのみ閲覧可（匿名には email / line_user_id を出さない）
create policy staff_select_auth on staff
for select to authenticated using (true);

create policy staff_insert_admin on staff
for insert to authenticated with check (public.is_admin());

create policy staff_update_admin on staff
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy staff_delete_admin on staff
for delete to authenticated using (public.is_admin());

-- =====================================================================
-- 4. attendance の管理者ポリシーも is_admin() に統一（再帰の芽を摘む）
-- =====================================================================
alter table attendance enable row level security;

drop policy if exists attendance_select_own on attendance;
drop policy if exists attendance_select_admin on attendance;
drop policy if exists attendance_insert_own on attendance;
drop policy if exists attendance_update_own on attendance;
drop policy if exists attendance_update_admin on attendance;
drop policy if exists attendance_delete_admin on attendance;

create policy attendance_select_own on attendance
for select to authenticated using (
  staff_id = (select id from staff where email = auth.jwt() ->> 'email')
);
create policy attendance_select_admin on attendance
for select to authenticated using (public.is_admin());

create policy attendance_insert_own on attendance
for insert to authenticated with check (
  staff_id = (select id from staff where email = auth.jwt() ->> 'email')
);
create policy attendance_update_own on attendance
for update to authenticated using (
  staff_id = (select id from staff where email = auth.jwt() ->> 'email')
);
create policy attendance_update_admin on attendance
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy attendance_delete_admin on attendance
for delete to authenticated using (public.is_admin());

-- =====================================================================
-- 5. company_settings（GPS 等）: 匿名締め出し + 更新は管理者のみ
-- =====================================================================
alter table company_settings enable row level security;

drop policy if exists settings_select_all on company_settings;
drop policy if exists settings_select_auth on company_settings;
drop policy if exists settings_update_admin on company_settings;

-- GPS 座標などはログイン済みスタッフが閲覧（打刻画面はログイン後に開く前提）
create policy settings_select_auth on company_settings
for select to authenticated using (true);

create policy settings_update_admin on company_settings
for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- 完了。company_secrets にトークンが入っているか確認する場合:
--   select id, (line_channel_access_token is not null) as has_token,
--          line_admin_user_id, updated_at from company_secrets;
-- =====================================================================
