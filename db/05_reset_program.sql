-- =====================================================================
-- BERSIHKAN DATA CONTOH, ISI PROGRAM ASLI
--
-- Menghapus: seluruh program contoh (beserta PIC, checklist, dan
-- riwayatnya) dan seluruh tugas divisi contoh.
-- Mengisi: tiga program Labshow PKKMB beserta PIC-nya.
--
-- Data pengurus, divisi, dan akun TIDAK tersentuh.
--
-- Jalankan di Supabase -> SQL Editor -> New query -> tempel -> Run.
-- =====================================================================

-- >>> GANTI TANGGAL DI SINI SEBELUM DIJALANKAN <<<
-- Format: 'YYYY-MM-DD HH:MM+07'  (WIB). Sekarang masih tanggal sementara.
--   IT : 2026-10-05 08:00+07
--   IF : 2026-10-06 08:00+07
--   SE : 2026-10-07 08:00+07

begin;

-- ---------------------------------------------------------------------
-- 1. Hapus data contoh
-- ---------------------------------------------------------------------
-- checklist, program_pics, dan activity_log ikut terhapus otomatis
-- karena terikat ke programs lewat "on delete cascade".
delete from public.programs;

-- Tugas divisi contoh.
delete from public.tasks;

-- ---------------------------------------------------------------------
-- 2. Program kerja asli
-- ---------------------------------------------------------------------
insert into public.programs (id, title, status, starts_at, place, descr, sort) values
  ('labshow-it', 'Labshow PKKMB Prodi IT', 'ongoing',
   timestamptz '2026-10-05 08:00+07', '', '', 1),

  ('labshow-if', 'Labshow PKKMB Prodi IF', 'ongoing',
   timestamptz '2026-10-06 08:00+07', '', '', 2),

  ('labshow-se', 'Labshow PKKMB Prodi SE', 'ongoing',
   timestamptz '2026-10-07 08:00+07', '', '', 3);

-- ---------------------------------------------------------------------
-- 3. PIC tiap program
-- ---------------------------------------------------------------------
insert into public.program_pics (program_id, member_id, sort) values
  -- Labshow PKKMB Prodi IT
  ('labshow-it', 'm01', 1),   -- Ramadhan Tangguh Defender
  ('labshow-it', 'm13', 2),   -- Muhammad Ghassan Firdian
  ('labshow-it', 'm05', 3),   -- Fathimah Radhiyya

  -- Labshow PKKMB Prodi IF
  ('labshow-if', 'm01', 1),   -- Ramadhan Tangguh Defender
  ('labshow-if', 'm05', 2),   -- Fathimah Radhiyya
  ('labshow-if', 'm08', 3),   -- Nelson Arbet
  ('labshow-if', 'm06', 4),   -- Paul Deniel Jagasa Ginting
  ('labshow-if', 'm12', 5),   -- Alya Khairunnisa

  -- Labshow PKKMB Prodi SE
  ('labshow-se', 'm10', 1),   -- Fauzan Zulfa Muhammad
  ('labshow-se', 'm15', 2);   -- Muhammad Meizar Salman

commit;

-- ---------------------------------------------------------------------
-- Cek hasilnya
-- ---------------------------------------------------------------------
select p.title,
       p.starts_at,
       string_agg(m.name, ', ' order by pic.sort) as pic
from public.programs p
join public.program_pics pic on pic.program_id = p.id
join public.members m        on m.id = pic.member_id
group by p.id, p.title, p.starts_at, p.sort
order by p.sort;
