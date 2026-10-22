-- =====================================================================
-- NOTIFIKASI PERANGKAT (WEB PUSH)
--
-- push_subs : satu baris per perangkat yang mengizinkan notifikasi.
-- push_log  : catatan pengingat yang sudah dikirim, supaya satu rapat
--             tidak dikirim dua kali kalau cron jalan berulang.
--
-- Jalankan di Supabase -> SQL Editor.
-- =====================================================================

create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  agent      text not null default '',
  created_at timestamptz not null default now(),
  last_ok    timestamptz
);
create index if not exists push_subs_user_idx on public.push_subs(user_id);

create table if not exists public.push_log (
  notif_key text primary key,
  sent_at   timestamptz not null default now()
);

alter table public.push_subs enable row level security;
alter table public.push_log  enable row level security;

-- Tiap orang hanya melihat dan mengurus perangkatnya sendiri.
drop policy if exists push_own on public.push_subs;
create policy push_own on public.push_subs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- push_log murni urusan server; tidak ada policy, jadi tidak ada klien
-- yang bisa membaca atau menulisnya. Edge Function memakai service role.


-- ---------------------------------------------------------------------
-- id akun lab, dipakai push-send untuk menentukan ruang rapat mana yang
-- boleh dia terima pengingatnya.
-- ---------------------------------------------------------------------
create or replace function public.lab_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.id from auth.users u
  where lower(u.email) = lower(public.lab_email())
  limit 1
$$;
revoke execute on function public.lab_user_id() from anon, authenticated;

-- =====================================================================
-- PENJADWALAN
-- Edge Function push-send dipanggil tiap 15 menit. Function-nya sendiri
-- yang memutuskan apakah ada pengingat yang jatuh tempo, jadi aman
-- dipanggil sesering ini.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- GANTI <REF> dan <PUSH_CRON_SECRET> sebelum dijalankan.
-- <PUSH_CRON_SECRET> harus sama dengan secret yang di-set di Edge Function.
select cron.unschedule('foresty-push') where exists (
  select 1 from cron.job where jobname = 'foresty-push');

select cron.schedule(
  'foresty-push',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<REF>.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', '<PUSH_CRON_SECRET>'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Cek jadwalnya:  select jobname, schedule, active from cron.job;
-- Lihat hasilnya: select * from cron.job_run_details order by start_time desc limit 10;
