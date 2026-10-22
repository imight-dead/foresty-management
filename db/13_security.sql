-- =====================================================================
-- FORESTY MANAGEMENT — PENGERASAN KEAMANAN
-- Jalankan setelah 01–12. Aman dijalankan ulang.
--
-- SQL Editor menjalankan seluruh file ini dalam SATU transaksi: kalau satu
-- langkah gagal (misalnya akun lab tidak ditemukan), tidak ada yang berubah.
--
--  1. Akun lab dikenali dari penanda di app_metadata, bukan cuma email.
--     app_metadata hanya bisa diubah dari server, bukan oleh pengguna,
--     jadi mendaftar ulang dengan email lab tidak memberi akses admin.
--  2. Divisi dan keanggotaan divisi hanya bisa diubah akun lab
--     (tadinya koordinator juga bisa, lewat API langsung).
--  3. Email di pendaftaran harus email akunnya sendiri (tidak bisa dipalsukan).
--  4. PIC checklist yang bukan koordinator hanya bisa mencentang, tidak
--     bisa mengubah teks, tenggat, atau PIC item.
--  5. Tugas divisi hanya boleh atas nama orang yang memang anggota divisi itu.
--  6. Format id dan panjang teks dibatasi (mencegah HTML/skrip disisipkan
--     lewat id, dan isian raksasa).
--  7. Pengunjung yang belum login (anon) hanya bisa membaca daftar nama.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AKUN LAB = email lab + penanda foresty_lab di app_metadata
-- ---------------------------------------------------------------------
do $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"foresty_lab": true}'::jsonb
   where lower(email) = lower(public.lab_email());
  if not found then
    raise exception 'Akun lab % tidak ditemukan di Authentication -> Users. Tidak ada yang diubah.', public.lab_email();
  end if;
end $$;

create or replace function public.is_lab()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select lower(u.email) = lower(public.lab_email())
            and coalesce((u.raw_app_meta_data->>'foresty_lab')::boolean, false)
       from auth.users u where u.id = auth.uid()),
    false)
$$;

-- dipakai push-send untuk mengenali perangkat akun lab
create or replace function public.lab_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.id from auth.users u
  where lower(u.email) = lower(public.lab_email())
    and coalesce((u.raw_app_meta_data->>'foresty_lab')::boolean, false)
  limit 1
$$;
revoke execute on function public.lab_user_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. DIVISI & KEANGGOTAAN: akun lab saja
-- ---------------------------------------------------------------------
drop policy if exists divisions_write on public.divisions;
create policy divisions_write on public.divisions
  for all to authenticated using (public.is_lab()) with check (public.is_lab());

drop policy if exists divmem_write on public.division_members;
create policy divmem_write on public.division_members
  for all to authenticated using (public.is_lab()) with check (public.is_lab());

-- ---------------------------------------------------------------------
-- 3. PENDAFTARAN: email harus email akun yang sedang login
-- ---------------------------------------------------------------------
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid()
              and status = 'pending'
              and lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
              and reason is null and decided_at is null and decided_by is null);

-- ---------------------------------------------------------------------
-- 4. CHECKLIST: selain koordinator hanya boleh mencentang
-- ---------------------------------------------------------------------
create or replace function public.checklist_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_inti() then
    return new;
  end if;
  if new.program_id is distinct from old.program_id
  or new.text       is distinct from old.text
  or new.member_id  is distinct from old.member_id
  or new.due_at     is distinct from old.due_at
  or new.sort       is distinct from old.sort
  or new.created_by is distinct from old.created_by then
    raise exception 'You can only tick this checklist item.' using errcode = '42501';
  end if;
  -- yang tercatat mencentang harus dirinya sendiri
  if new.done and new.done_by is distinct from auth.uid() then
    raise exception 'done_by must be your own account.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists checklist_guard on public.checklist;
create trigger checklist_guard before update on public.checklist
  for each row execute function public.checklist_guard();

-- ---------------------------------------------------------------------
-- 5. TUGAS DIVISI: orangnya harus anggota divisi itu
-- ---------------------------------------------------------------------
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ((public.is_inti() or member_id = public.my_member_id())
              and exists (select 1 from public.division_members dm
                          where dm.division_id = tasks.division_id and dm.member_id = tasks.member_id));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using      (public.is_inti() or member_id = public.my_member_id())
  with check ((public.is_inti() or member_id = public.my_member_id())
              and exists (select 1 from public.division_members dm
                          where dm.division_id = tasks.division_id and dm.member_id = tasks.member_id));

-- ---------------------------------------------------------------------
-- 6. FORMAT ID & PANJANG TEKS
-- NOT VALID: hanya memeriksa data baru/diubah, data lama tidak diganggu.
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select * from (values
      ('programs',     'programs_id_fmt',      $c$id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'$c$),
      ('members',      'members_id_fmt',       $c$id ~ '^[a-z0-9][a-z0-9_-]{0,39}$'$c$),
      ('divisions',    'divisions_id_fmt',     $c$id ~ '^[a-z0-9][a-z0-9_-]{0,39}$'$c$),
      ('programs',     'programs_len',         $c$length(title) <= 200 and length(place) <= 200 and length(descr) <= 5000$c$),
      ('checklist',    'checklist_len',        $c$length(text) <= 500$c$),
      ('tasks',        'tasks_len',            $c$length(text) <= 500$c$),
      ('activity_log', 'activity_log_len',     $c$length(text) <= 1000$c$),
      ('profiles',     'profiles_len',         $c$length(email) <= 320 and coalesce(length(reason), 0) <= 1000$c$),
      ('meetings',     'meetings_len',         $c$length(title) <= 200 and length(place) <= 200 and length(attendees) <= 2000 and length(notes) <= 100000$c$)
    ) as v(tbl, name, expr)
  loop
    if to_regclass('public.' || c.tbl) is not null then
      execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.name);
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;
  end loop;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tasks' and column_name = 'descr') then
    alter table public.tasks drop constraint if exists tasks_descr_len;
    alter table public.tasks add constraint tasks_descr_len check (length(descr) <= 5000) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. PENGUNJUNG BELUM LOGIN: hanya daftar nama (untuk halaman Daftar)
-- RLS sudah menolaknya; ini lapisan kedua.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.members to anon;
