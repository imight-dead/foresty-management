-- =====================================================================
-- FORESTY MANAGEMENT — DESKRIPSI TUGAS DIVISI
-- Jalankan setelah 01–09. Aman dijalankan ulang.
--
-- Tugas divisi boleh punya deskripsi selain judulnya. Aturan siapa boleh
-- mengubah dan menghapus tetap tasks_update / tasks_delete di 02_rls.sql.
-- =====================================================================

alter table public.tasks add column if not exists descr text not null default '';
