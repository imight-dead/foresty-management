-- =====================================================================
-- FORESTY MANAGEMENT — SKEMA DATABASE
-- Jalankan di Supabase: SQL Editor -> New query -> tempel -> Run.
-- Urutan: 01_schema.sql -> 02_rls.sql -> 03_seed.sql
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- ANGGOTA LAB
-- Baris di sini ADA DULUAN sebelum ada akunnya. Email menyusul lewat
-- tabel profiles setelah pendaftaran disetujui akun lab.
-- level: 'inti'  = coordinator, vice, secretary, treasurer, koordinator divisi
--        'staff' = staff divisi & tim riset
-- ---------------------------------------------------------------------
create table if not exists public.members (
  id          text primary key,
  name        text not null,
  role        text not null,
  div         text not null,
  level       text not null default 'staff' check (level in ('inti','staff')),
  sort        int  not null default 0
);

-- ---------------------------------------------------------------------
-- AKUN
-- Satu baris per user Supabase Auth. status menentukan boleh login atau
-- tidak. member_id mengikat akun ke nama pengurus.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  member_id   text not null references public.members(id),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason      text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id)
);
create index if not exists profiles_status_idx    on public.profiles(status);
create index if not exists profiles_member_id_idx on public.profiles(member_id);

-- Satu nama hanya boleh dipegang satu akun yang SUDAH disetujui.
-- Pendaftaran berstatus pending boleh menumpuk di nama yang sama —
-- akun lab yang memutuskan siapa yang benar.
create unique index if not exists profiles_one_approved_per_member
  on public.profiles(member_id) where status = 'approved';

-- ---------------------------------------------------------------------
-- DIVISI
-- ---------------------------------------------------------------------
create table if not exists public.divisions (
  id       text primary key,
  name     text not null,
  tagline  text not null default '',
  sort     int  not null default 0
);

create table if not exists public.division_members (
  division_id text not null references public.divisions(id) on delete cascade,
  member_id   text not null references public.members(id)   on delete cascade,
  sort        int  not null default 0,
  primary key (division_id, member_id)
);

-- ---------------------------------------------------------------------
-- TUGAS DIVISI
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  division_id text not null references public.divisions(id) on delete cascade,
  member_id   text not null references public.members(id)   on delete cascade,
  text        text not null,
  status      text not null default 'todo' check (status in ('todo','doing','done')),
  sort        int  not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_div_idx on public.tasks(division_id, member_id);

-- ---------------------------------------------------------------------
-- PROGRAM KERJA
-- ---------------------------------------------------------------------
create table if not exists public.programs (
  id          text primary key,
  title       text not null,
  status      text not null default 'soon' check (status in ('ongoing','completed','soon')),
  starts_at   timestamptz not null,
  place       text not null default '',
  descr       text not null default '',
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.program_pics (
  program_id text not null references public.programs(id) on delete cascade,
  member_id  text not null references public.members(id)  on delete cascade,
  sort       int  not null default 0,
  primary key (program_id, member_id)
);

create table if not exists public.checklist (
  id          uuid primary key default gen_random_uuid(),
  program_id  text not null references public.programs(id) on delete cascade,
  text        text not null,
  member_id   text not null references public.members(id),   -- PIC item ini
  due_at      timestamptz,
  done        boolean not null default false,
  done_by     uuid references auth.users(id),
  done_at     timestamptz,
  sort        int  not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists checklist_program_idx on public.checklist(program_id);

-- ---------------------------------------------------------------------
-- RIWAYAT AKTIVITAS (log perubahan program)
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  program_id text references public.programs(id) on delete cascade,
  actor      uuid references auth.users(id),
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists activity_program_idx on public.activity_log(program_id, created_at desc);

-- ---------------------------------------------------------------------
-- STATUS BACA NOTIFIKASI (per orang)
-- Notifikasi H-3 / H-1 / H-0 dihitung dari tanggal program dan tenggat
-- checklist, jadi tidak perlu disimpan. Yang disimpan hanya apa yang
-- sudah dibaca siapa.
-- ---------------------------------------------------------------------
create table if not exists public.notif_read (
  user_id    uuid not null references auth.users(id) on delete cascade,
  notif_key  text not null,
  read_at    timestamptz not null default now(),
  primary key (user_id, notif_key)
);

-- ---------------------------------------------------------------------
-- updated_at otomatis
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Realtime: semua klien ikut melihat perubahan tanpa refresh
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.checklist;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.programs;
alter publication supabase_realtime add table public.profiles;
