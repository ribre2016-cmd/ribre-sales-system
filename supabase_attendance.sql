-- 勤怠管理システム テーブル設計
-- 既存の ribre-sales-system Supabase プロジェクトに追加

-- =====================
-- 1. スタッフテーブル
-- =====================
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  line_user_id text,           -- LINE Bot連携用
  role text not null default 'staff', -- 'admin' or 'staff'
  is_active boolean default true,
  created_at timestamptz default now()
);

-- =====================
-- 2. 会社設定テーブル
-- =====================
create table if not exists company_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default '株式会社RIBRE',
  latitude double precision not null,   -- 会社の緯度
  longitude double precision not null,  -- 会社の経度
  radius_meters integer default 50,     -- 打刻可能範囲（デフォルト50m）
  alert_clock_in time default '09:00',  -- 出勤打刻忘れアラート時刻
  alert_clock_out time default '20:00', -- 退勤打刻忘れアラート時刻
  line_channel_access_token text,       -- LINE Bot トークン
  line_admin_user_id text,              -- 管理者のLINE User ID
  updated_at timestamptz default now()
);

-- =====================
-- 3. 打刻記録テーブル
-- =====================
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id) on delete cascade,
  date date not null,                   -- 打刻日
  clock_in timestamptz,                 -- 出勤時刻
  clock_out timestamptz,                -- 退勤時刻
  clock_in_method text,                 -- 'web' or 'line'
  clock_out_method text,                -- 'web' or 'line'
  clock_in_lat double precision,        -- 出勤時の緯度
  clock_in_lng double precision,        -- 出勤時の経度
  clock_out_lat double precision,       -- 退勤時の緯度
  clock_out_lng double precision,       -- 退勤時の経度
  note text,                            -- 備考（管理者修正メモなど）
  created_at timestamptz default now(),
  unique(staff_id, date)                -- 1日1レコード
);

-- =====================
-- インデックス
-- =====================
create index if not exists idx_attendance_staff_id on attendance(staff_id);
create index if not exists idx_attendance_date on attendance(date);
create index if not exists idx_staff_email on staff(email);
create index if not exists idx_staff_line_user_id on staff(line_user_id);

-- =====================
-- RLS 有効化
-- =====================
alter table staff enable row level security;
alter table attendance enable row level security;
alter table company_settings enable row level security;

-- =====================
-- RLS ポリシー（staff テーブル）
-- =====================
drop policy if exists staff_select_all on staff;
drop policy if exists staff_insert_admin on staff;
drop policy if exists staff_update_admin on staff;
drop policy if exists staff_delete_admin on staff;

-- 全スタッフが他スタッフ情報を閲覧可能（名前表示のため）
create policy staff_select_all on staff
for select using (true);

-- 管理者のみ登録・更新・削除可能
create policy staff_insert_admin on staff
for insert with check (
  exists (
    select 1 from staff s
    where s.email = auth.jwt() ->> 'email'
    and s.role = 'admin'
  )
);

create policy staff_update_admin on staff
for update using (
  exists (
    select 1 from staff s
    where s.email = auth.jwt() ->> 'email'
    and s.role = 'admin'
  )
);

create policy staff_delete_admin on staff
for delete using (
  exists (
    select 1 from staff s
    where s.email = auth.jwt() ->> 'email'
    and s.role = 'admin'
  )
);

-- =====================
-- RLS ポリシー（attendance テーブル）
-- =====================
drop policy if exists attendance_select_own on attendance;
drop policy if exists attendance_select_admin on attendance;
drop policy if exists attendance_insert_own on attendance;
drop policy if exists attendance_update_own on attendance;
drop policy if exists attendance_update_admin on attendance;
drop policy if exists attendance_delete_admin on attendance;

-- 自分の打刻は自分が見られる
create policy attendance_select_own on attendance
for select using (
  staff_id = (
    select id from staff where email = auth.jwt() ->> 'email'
  )
);

-- 管理者は全員分見られる
create policy attendance_select_admin on attendance
for select using (
  exists (
    select 1 from staff s
    where s.email = auth.jwt() ->> 'email'
    and s.role = 'admin'
  )
);

-- 自分の打刻は自分が登録できる
create policy attendance_insert_own on attendance
for insert with check (
  staff_id = (
    select id from staff where email = auth.jwt() ->> 'email'
  )
);

-- 自分の打刻は自分が更新できる（退勤打刻用）
create policy attendance_update_own on attendance
for update using (
  staff_id = (
    select id from staff where email = auth.jwt() ->> 'email'
  )
);

-- 管理者は全員分修正できる
create policy attendance_update_admin on attendance
for update using (
  exists (
    select 1 from staff s
    where s.email = auth.jwt() ->> 'email'
    and s.role = 'admin'
  )
);

-- 管理者のみ削除可能
create policy attendance_delete_admin on attendance
for delete using (
  exists (
    select 1 from staff s
    where s.email = auth.jwt() ->> 'email'
    and s.role = 'admin'
  )
);

-- =====================
-- RLS ポリシー（company_settings テーブル）
-- =====================
drop policy if exists settings_select_all on company_settings;
drop policy if exists settings_update_admin on company_settings;

-- 全員が設定を閲覧可能（GPS座標取得のため）
create policy settings_select_all on company_settings
for select using (true);

-- 管理者のみ更新可能
create policy settings_update_admin on company_settings
for update using (
  exists (
    select 1 from staff s
    where s.email = auth.jwt() ->> 'email'
    and s.role = 'admin'
  )
);

-- =====================
-- サンプルデータ（初期設定用）
-- ※ 緯度経度は実際の会社所在地に変更してください
-- =====================
insert into company_settings (company_name, latitude, longitude, radius_meters, alert_clock_in, alert_clock_out)
values ('株式会社RIBRE', 35.93017021717233, 139.56629315777244, 50, '09:00', '20:00')
on conflict do nothing;
