-- =====================================================================
-- FORESTY MANAGEMENT — PROGRAM KERJA CONTOH (OPSIONAL)
-- Ini data contoh supaya aplikasi tidak kosong saat pertama dibuka.
-- Lewati file ini kalau mau langsung isi proker asli dari dalam web.
-- Hapus kapan saja: delete from public.programs;
-- =====================================================================

insert into public.programs (id, title, status, starts_at, place, descr, sort) values
  ('p4', 'Rapat Koordinasi Divisi', 'ongoing', timestamptz '2026-09-15 09:00:00+07', 'Ruang Lab F-203', 'Rapat koordinasi lintas divisi bulanan. Membahas progres program kerja triwulan, kendala tiap divisi, dan penetapan timeline Lab Show 26/27.', 1),
  ('p3', 'Workshop Digital Forensics #1', 'ongoing', timestamptz '2026-09-19 13:00:00+07', 'Lab Komputer 2', 'Workshop internal angkatan baru: akuisisi image disk dengan FTK Imager, verifikasi hash SHA-256, dan analisis artefak Windows (prefetch, registry hive, $MFT).', 2),
  ('p2', 'Open Recruitment Aslab', 'ongoing', timestamptz '2026-09-22 09:00:00+07', 'Online + Lab F-203', 'Rekrutmen asisten laboratorium periode berikutnya. Tiga tahap: seleksi berkas, tes teknis (forensik & jaringan), dan wawancara.', 3),
  ('p1', 'Foresty Lab Show 26/27', 'ongoing', timestamptz '2026-10-11 08:00:00+07', 'Aula Fakultas', 'Acara puncak laboratorium: pameran hasil riset, talkshow praktisi keamanan siber, demo live forensics, dan peluncuran identitas Foresty 26/27.', 4),
  ('p7', 'CTF Internal — REDSHIFT', 'soon', timestamptz '2026-11-08 08:00:00+07', 'Lab Komputer 1 & 2', 'Kompetisi Capture The Flag internal lab. Kategori: forensics, web exploitation, cryptography, dan network analysis. Format jeopardy 8 jam.', 5),
  ('p8', 'Lab Tour & Open House', 'soon', timestamptz '2026-11-22 09:00:00+07', 'Gedung Lab Lt. 2', 'Membuka lab untuk mahasiswa baru: tur fasilitas forensik, demo alat akuisisi, dan sesi tanya jawab bersama aslab.', 6),
  ('p9', 'Publikasi Jurnal Riset', 'soon', timestamptz '2026-12-05 23:59:00+07', 'Daring', 'Submit dua naskah hasil riset lab: analisis artefak aplikasi pesan terenkripsi, dan deteksi anomali trafik berbasis machine learning.', 7),
  ('p5', 'Upgrading Internal Lab', 'completed', timestamptz '2026-08-30 08:00:00+07', 'Ruang Lab F-203', 'Pembekalan pengurus: standar operasional lab, etika penanganan barang bukti digital, dan chain of custody.', 8),
  ('p6', 'Serah Terima Jabatan', 'completed', timestamptz '2026-08-09 09:00:00+07', 'Aula Mini Fakultas', 'Pergantian kepengurusan ke periode 26/27, termasuk serah terima inventaris lab dan arsip kesekretariatan.', 9)
on conflict (id) do nothing;

insert into public.program_pics (program_id, member_id, sort) values
  ('p4', 'm01', 1),
  ('p4', 'm03', 2),
  ('p3', 'm20', 1),
  ('p3', 'm15', 2),
  ('p2', 'm05', 1),
  ('p2', 'm06', 2),
  ('p1', 'm02', 1),
  ('p1', 'm10', 2),
  ('p1', 'm12', 3),
  ('p7', 'm15', 1),
  ('p7', 'm20', 2),
  ('p8', 'm10', 1),
  ('p8', 'm07', 2),
  ('p9', 'm20', 1),
  ('p9', 'm21', 2),
  ('p5', 'm05', 1),
  ('p5', 'm02', 2),
  ('p6', 'm01', 1),
  ('p6', 'm02', 2)
on conflict (program_id, member_id) do nothing;

insert into public.checklist (program_id, text, member_id, due_at, done, sort)
select * from (values
  ('p4', 'Susun agenda rapat & undangan', 'm03', null::timestamptz, true, 1),
  ('p4', 'Booking Ruang Lab F-203', 'm03', null::timestamptz, true, 2),
  ('p4', 'Kumpulkan laporan progres tiap koordinator', 'm01', timestamptz '2026-09-14 17:00:00+07', false, 3),
  ('p4', 'Siapkan notulensi & daftar hadir', 'm03', null::timestamptz, false, 4),
  ('p3', 'Finalisasi modul & studi kasus', 'm20', null::timestamptz, true, 1),
  ('p3', 'Siapkan image sampel + write blocker', 'm21', null::timestamptz, true, 2),
  ('p3', 'Instalasi Autopsy di 20 workstation', 'm22', timestamptz '2026-09-17 16:00:00+07', false, 3),
  ('p3', 'Rekap pendaftaran peserta', 'm15', null::timestamptz, false, 4),
  ('p3', 'Cetak sertifikat peserta', 'm16', null::timestamptz, false, 5),
  ('p2', 'Buka form pendaftaran & publikasi poster', 'm12', null::timestamptz, true, 1),
  ('p2', 'Susun soal tes teknis', 'm05', null::timestamptz, true, 2),
  ('p2', 'Seleksi berkas pendaftar', 'm06', timestamptz '2026-09-20 23:59:00+07', false, 3),
  ('p2', 'Jadwalkan sesi wawancara', 'm07', null::timestamptz, false, 4),
  ('p2', 'Umumkan hasil & onboarding', 'm05', null::timestamptz, false, 5),
  ('p1', 'Rilis identitas visual & key visual', 'm10', null::timestamptz, true, 1),
  ('p1', 'Booking Aula Fakultas', 'm02', null::timestamptz, true, 2),
  ('p1', 'Surat izin kegiatan ke dekanat', 'm03', timestamptz '2026-09-25 15:00:00+07', false, 3),
  ('p1', 'Kontak pembicara talkshow', 'm11', null::timestamptz, false, 4),
  ('p1', 'Desain merchandise & banner', 'm13', null::timestamptz, false, 5),
  ('p1', 'Rundown acara & briefing panitia', 'm02', null::timestamptz, false, 6),
  ('p1', 'RAB & konsumsi', 'm04', null::timestamptz, false, 7),
  ('p7', 'Susun soal per kategori (min. 20 soal)', 'm15', null::timestamptz, false, 1),
  ('p7', 'Siapkan platform CTFd & server', 'm23', null::timestamptz, false, 2),
  ('p7', 'Uji coba soal (playtest)', 'm17', null::timestamptz, false, 3),
  ('p7', 'Siapkan hadiah & sertifikat', 'm18', null::timestamptz, false, 4),
  ('p8', 'Susun alur tur & titik demo', 'm07', null::timestamptz, false, 1),
  ('p8', 'Siapkan materi display & poster riset', 'm14', null::timestamptz, false, 2),
  ('p8', 'Jadwal piket aslab pemandu', 'm08', null::timestamptz, false, 3),
  ('p9', 'Finalisasi naskah 1 (artefak aplikasi pesan)', 'm24', null::timestamptz, false, 1),
  ('p9', 'Finalisasi naskah 2 (deteksi anomali trafik)', 'm25', null::timestamptz, false, 2),
  ('p9', 'Review internal & cek plagiarisme', 'm20', null::timestamptz, false, 3),
  ('p9', 'Submit ke jurnal target', 'm21', null::timestamptz, false, 4),
  ('p5', 'Susun materi SOP lab', 'm26', null::timestamptz, true, 1),
  ('p5', 'Undang pemateri eksternal', 'm05', null::timestamptz, true, 2),
  ('p5', 'Konsumsi & dokumentasi', 'm09', null::timestamptz, true, 3),
  ('p5', 'Laporan kegiatan', 'm03', null::timestamptz, true, 4),
  ('p6', 'Rekap inventaris lab', 'm04', null::timestamptz, true, 1),
  ('p6', 'Susunan acara & undangan', 'm03', null::timestamptz, true, 2),
  ('p6', 'Berita acara serah terima', 'm01', null::timestamptz, true, 3)
) as v(program_id, text, member_id, due_at, done, sort)
where not exists (select 1 from public.checklist);
