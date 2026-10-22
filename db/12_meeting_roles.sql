-- =====================================================================
-- FORESTY MANAGEMENT — SIAPA BOLEH APA DI MENU MEETING
-- Jalankan setelah 01–11. Aman dijalankan ulang.
--
--   Mengisi notulen     : semua anggota divisi rapat itu
--   Jadwalkan / ubah    : koordinator (pengurus inti) dan akun lab
--   jadwal / hapus rapat
--
-- RLS hanya bisa mengatur per baris, bukan per kolom. Jadi semua anggota
-- divisi boleh UPDATE barisnya, lalu trigger di bawah menolak kalau yang
-- berubah selain notulen dan pelakunya bukan koordinator.
-- =====================================================================

-- Jadwalkan rapat baru: koordinator saja.
drop policy if exists meetings_insert on public.meetings;
create policy meetings_insert on public.meetings
  for insert to authenticated
  with check (room = any (public.my_rooms()) and created_by = auth.uid() and public.is_inti());

-- Ubah baris: semua anggota divisi (notulen); kolom lain dijaga trigger.
drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update to authenticated
  using      (room = any (public.my_rooms()))
  with check (room = any (public.my_rooms()));

-- Hapus rapat: koordinator saja.
drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings
  for delete to authenticated
  using (room = any (public.my_rooms()) and public.is_inti());

create or replace function public.meetings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() kosong = SQL Editor / Table Editor Supabase: dibiarkan
  if auth.uid() is null or public.is_inti() then
    return new;
  end if;
  if new.room       is distinct from old.room
  or new.title      is distinct from old.title
  or new.held_at    is distinct from old.held_at
  or new.place      is distinct from old.place
  or new.attendees  is distinct from old.attendees
  or new.created_by is distinct from old.created_by then
    raise exception 'Only coordinators can change the meeting schedule. You can only write the notulen.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists meetings_guard on public.meetings;
create trigger meetings_guard before update on public.meetings
  for each row execute function public.meetings_guard();
