-- =====================================================================
-- FORESTY MANAGEMENT — NOTIFIKASI SEKETIKA UNTUK TUGAS BERTENGGAT
-- Jalankan setelah 01–13. Aman dijalankan ulang.
--
-- Begitu tugas divisi dengan tenggat dibuat, atau tenggat / orangnya /
-- teksnya diubah, orang yang ditugaskan langsung mendapat notifikasi di
-- HP. Pengingat H-1 dan hari-H pukul 07.00 WIB tetap jalan lewat cron.
--
-- Memakai fungsi notify_push dari 06_push_instant.sql (secret cron sudah
-- ada di sana), jadi tidak ada yang perlu diganti di file ini.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.notify_push()') is null then
    raise exception 'Fungsi notify_push belum ada. Jalankan db/06_push_instant.sql dulu.';
  end if;
end $$;

drop trigger if exists tasks_push_ins on public.tasks;
create trigger tasks_push_ins
  after insert on public.tasks
  for each row
  when (new.due_at is not null and new.status <> 'done')
  execute function public.notify_push('task');

drop trigger if exists tasks_push_upd on public.tasks;
create trigger tasks_push_upd
  after update on public.tasks
  for each row
  when (new.due_at is not null and new.status <> 'done'
        and (old.due_at    is distinct from new.due_at
          or old.member_id is distinct from new.member_id
          or old.text      is distinct from new.text))
  execute function public.notify_push('task');
