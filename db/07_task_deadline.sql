-- =====================================================================
-- FORESTY MANAGEMENT — TENGGAT TUGAS DIVISI
-- Jalankan setelah 01–06. Aman dijalankan ulang.
--
-- Tugas divisi boleh punya tenggat. Tenggatnya tampil di bawah teks
-- tugas dan masuk kalender — tiap orang hanya melihat tenggat tugas
-- divisinya sendiri (akun lab melihat semuanya). Aturan siapa boleh
-- mengubah tetap tasks_update di 02_rls.sql, tidak perlu policy baru.
-- =====================================================================

alter table public.tasks add column if not exists due_at timestamptz;

create index if not exists tasks_due_idx on public.tasks(due_at) where due_at is not null;
