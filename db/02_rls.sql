-- =====================================================================
-- FORESTY MANAGEMENT — ROW LEVEL SECURITY
-- Inilah pengaman yang sebenarnya. Menu yang disembunyikan di tampilan
-- hanya kenyamanan; aturan di bawah ini yang menolak permintaan di
-- server, sekalipun seseorang memanggil API-nya langsung.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GANTI DI SINI kalau alamat akun lab berubah.
-- ---------------------------------------------------------------------
create or replace function public.lab_email()
returns text language sql immutable as $$
  select 'forestylab@gmail.com'::text
$$;

-- Akun lab = satu-satunya yang boleh menyetujui pendaftaran.
create or replace function public.is_lab()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select lower(u.email) = lower(public.lab_email()) from auth.users u where u.id = auth.uid()),
    false)
$$;

-- Sudah disetujui = boleh melihat isi aplikasi.
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_lab() or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.status = 'approved')
$$;

-- Nama pengurus yang menempel pada akun yang sedang login.
create or replace function public.my_member_id()
returns text language sql stable security definer set search_path = public as $$
  select p.member_id from public.profiles p
  where p.user_id = auth.uid() and p.status = 'approved'
$$;

-- Akses penuh: akun lab, pengurus inti, dan koordinator divisi.
create or replace function public.is_inti()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_lab() or exists (
    select 1 from public.profiles p
    join public.members m on m.id = p.member_id
    where p.user_id = auth.uid() and p.status = 'approved' and m.level = 'inti')
$$;

grant execute on function public.is_lab, public.is_approved, public.my_member_id, public.is_inti
  to anon, authenticated;

-- =====================================================================
alter table public.members          enable row level security;
alter table public.profiles         enable row level security;
alter table public.divisions        enable row level security;
alter table public.division_members enable row level security;
alter table public.tasks            enable row level security;
alter table public.programs         enable row level security;
alter table public.program_pics     enable row level security;
alter table public.checklist        enable row level security;
alter table public.activity_log     enable row level security;
alter table public.notif_read       enable row level security;

-- ---------------------------------------------------------------------
-- MEMBERS
-- Daftar nama sengaja bisa dibaca tanpa login: halaman Daftar perlu
-- menampilkan pilihan nama sebelum orangnya punya akun. Yang terbaca
-- hanya nama, jabatan, dan divisi — tidak ada email atau kontak.
-- Kalau tidak mau terbuka, ganti `to anon, authenticated` jadi
-- `to authenticated` lalu pindahkan pilih-nama ke setelah sign up.
-- ---------------------------------------------------------------------
drop policy if exists members_read on public.members;
create policy members_read on public.members
  for select to anon, authenticated using (true);

drop policy if exists members_write on public.members;
create policy members_write on public.members
  for all to authenticated using (public.is_lab()) with check (public.is_lab());

-- ---------------------------------------------------------------------
-- PROFILES (akun + status persetujuan)
-- ---------------------------------------------------------------------
-- Lihat: barisnya sendiri, atau semuanya kalau akun lab.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_lab());

-- Daftar: hanya untuk dirinya sendiri, dan WAJIB berstatus pending.
-- Tidak ada cara mendaftarkan diri langsung sebagai 'approved'.
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- Setujui / tolak: HANYA akun lab.
drop policy if exists profiles_update_lab on public.profiles;
create policy profiles_update_lab on public.profiles
  for update to authenticated
  using (public.is_lab()) with check (public.is_lab());

-- Cabut akses: hanya akun lab.
drop policy if exists profiles_delete_lab on public.profiles;
create policy profiles_delete_lab on public.profiles
  for delete to authenticated using (public.is_lab());

-- ---------------------------------------------------------------------
-- DIVISI & KEANGGOTAAN — dibaca semua yang sudah disetujui,
-- diubah hanya oleh inti/koordinator.
-- ---------------------------------------------------------------------
drop policy if exists divisions_read on public.divisions;
create policy divisions_read on public.divisions
  for select to authenticated using (public.is_approved());
drop policy if exists divisions_write on public.divisions;
create policy divisions_write on public.divisions
  for all to authenticated using (public.is_inti()) with check (public.is_inti());

drop policy if exists divmem_read on public.division_members;
create policy divmem_read on public.division_members
  for select to authenticated using (public.is_approved());
drop policy if exists divmem_write on public.division_members;
create policy divmem_write on public.division_members
  for all to authenticated using (public.is_inti()) with check (public.is_inti());

-- ---------------------------------------------------------------------
-- TUGAS DIVISI
-- Inti: bebas. Staff & tim riset: hanya tugas atas namanya sendiri.
-- ---------------------------------------------------------------------
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks
  for select to authenticated using (public.is_approved());

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.is_inti() or member_id = public.my_member_id());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using      (public.is_inti() or member_id = public.my_member_id())
  with check (public.is_inti() or member_id = public.my_member_id());

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_inti() or member_id = public.my_member_id());

-- ---------------------------------------------------------------------
-- PROGRAM KERJA — hanya inti/koordinator yang boleh membuat & mengubah.
-- ---------------------------------------------------------------------
drop policy if exists programs_read on public.programs;
create policy programs_read on public.programs
  for select to authenticated using (public.is_approved());
drop policy if exists programs_write on public.programs;
create policy programs_write on public.programs
  for all to authenticated using (public.is_inti()) with check (public.is_inti());

drop policy if exists pics_read on public.program_pics;
create policy pics_read on public.program_pics
  for select to authenticated using (public.is_approved());
drop policy if exists pics_write on public.program_pics;
create policy pics_write on public.program_pics
  for all to authenticated using (public.is_inti()) with check (public.is_inti());

-- ---------------------------------------------------------------------
-- CHECKLIST PROGRAM
-- Menambah/menghapus item: inti saja.
-- Mencentang: inti, atau PIC item itu sendiri.
-- ---------------------------------------------------------------------
drop policy if exists checklist_read on public.checklist;
create policy checklist_read on public.checklist
  for select to authenticated using (public.is_approved());

drop policy if exists checklist_insert on public.checklist;
create policy checklist_insert on public.checklist
  for insert to authenticated with check (public.is_inti());

drop policy if exists checklist_update on public.checklist;
create policy checklist_update on public.checklist
  for update to authenticated
  using      (public.is_inti() or member_id = public.my_member_id())
  with check (public.is_inti() or member_id = public.my_member_id());

drop policy if exists checklist_delete on public.checklist;
create policy checklist_delete on public.checklist
  for delete to authenticated using (public.is_inti());

-- ---------------------------------------------------------------------
-- RIWAYAT AKTIVITAS — semua yang disetujui boleh menulis jejaknya.
-- ---------------------------------------------------------------------
drop policy if exists log_read on public.activity_log;
create policy log_read on public.activity_log
  for select to authenticated using (public.is_approved());
drop policy if exists log_insert on public.activity_log;
create policy log_insert on public.activity_log
  for insert to authenticated with check (public.is_approved() and actor = auth.uid());

-- ---------------------------------------------------------------------
-- STATUS BACA NOTIFIKASI — murni milik masing-masing orang.
-- ---------------------------------------------------------------------
drop policy if exists notif_own on public.notif_read;
create policy notif_own on public.notif_read
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
