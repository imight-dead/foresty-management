-- =====================================================================
-- NOTULEN RAPAT
--
-- Lima ruang rapat:
--   koorinti  -> Rapat Koorinti
--   hr        -> Rapat Divisi HR
--   medpart   -> Rapat Divisi Media & Partner
--   sg        -> Rapat Divisi Study Group
--   rnd       -> Rapat Divisi RnD
--
-- Siapa melihat apa:
--   Staff divisi        -> hanya ruang divisinya sendiri
--   Koordinator divisi  -> Koorinti + ruang divisinya
--   Ketua, Wakil,
--   Sekretaris, Bendahara -> Koorinti
--   Akun lab            -> semua ruang
--
-- Aturannya ditegakkan di server, bukan sekadar disembunyikan di layar:
-- notulen divisi lain benar-benar tidak terbaca.
--
-- Jalankan di Supabase -> SQL Editor.
-- =====================================================================

create table if not exists public.meetings (
  id          uuid primary key default gen_random_uuid(),
  room        text not null check (room in ('koorinti','hr','medpart','sg','rnd')),
  title       text not null,
  held_at     timestamptz not null,
  place       text not null default '',
  attendees   text not null default '',
  notes       text not null default '',
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists meetings_room_idx on public.meetings(room, held_at desc);

drop trigger if exists meetings_touch on public.meetings;
create trigger meetings_touch before update on public.meetings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Divisi -> ruang rapat. Pengurus Inti dan Sekretariat tidak punya ruang
-- divisi sendiri; mereka hanya ikut Koorinti.
-- ---------------------------------------------------------------------
create or replace function public.room_of_div(d text)
returns text language sql immutable as $$
  select case d
    when 'Human Resource'          then 'hr'
    when 'Media & Partner'         then 'medpart'
    when 'Study Group'             then 'sg'
    when 'Research & Development'  then 'rnd'
    else null
  end
$$;

-- Daftar ruang yang boleh dilihat akun yang sedang login.
create or replace function public.my_rooms()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.is_lab() then array['koorinti','hr','medpart','sg','rnd']
    else coalesce((
      select case
        when m.level = 'inti'
          then array_remove(array['koorinti', public.room_of_div(m.div)], null)
        else array_remove(array[public.room_of_div(m.div)], null)
      end
      from public.profiles p
      join public.members  m on m.id = p.member_id
      where p.user_id = auth.uid() and p.status = 'approved'
    ), array[]::text[])
  end
$$;

grant execute on function public.room_of_div, public.my_rooms to anon, authenticated;

-- ---------------------------------------------------------------------
alter table public.meetings enable row level security;

-- Baca: hanya ruang yang jadi haknya.
drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings
  for select to authenticated
  using (room = any (public.my_rooms()));

-- Tulis notulen baru: siapa pun yang berhak masuk ruang itu.
drop policy if exists meetings_insert on public.meetings;
create policy meetings_insert on public.meetings
  for insert to authenticated
  with check (room = any (public.my_rooms()) and created_by = auth.uid());

-- Ubah: penulisnya sendiri, atau pengurus inti / koordinator.
drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update to authenticated
  using      (room = any (public.my_rooms()) and (created_by = auth.uid() or public.is_inti()))
  with check (room = any (public.my_rooms()) and (created_by = auth.uid() or public.is_inti()));

-- Hapus: aturan yang sama.
drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings
  for delete to authenticated
  using (room = any (public.my_rooms()) and (created_by = auth.uid() or public.is_inti()));

alter publication supabase_realtime add table public.meetings;
