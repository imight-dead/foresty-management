-- =====================================================================
-- NOTIFIKASI SEKETIKA
--
-- Begitu rapat atau program disimpan, database langsung memanggil
-- push-send — tidak menunggu cron 15 menit. Pengingat H-3 / H-1 / H-0
-- tetap berjalan seperti biasa lewat cron.
--
-- Rapat hanya dikirim ke anggota ruang rapatnya; program dikirim ke
-- semua pengurus yang sudah disetujui.
--
-- GANTI <PUSH_CRON_SECRET> dengan secret yang sama seperti di Supabase.
-- Jalankan di SQL Editor.
-- =====================================================================

create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://mpdpdmcpvapykcqkeixs.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', '<PUSH_CRON_SECRET>'),
    body    := jsonb_build_object(
                 'event', TG_ARGV[0],
                 'id',    new.id::text,
                 'op',    TG_OP),
    timeout_milliseconds := 30000
  );
  return new;
exception when others then
  -- pemberitahuan gagal tidak boleh membatalkan penyimpanan datanya
  raise warning 'notify_push: %', sqlerrm;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- RAPAT
-- Dikirim saat rapat baru dibuat, dan saat judul, waktu, atau ruangnya
-- berubah. Menyimpan notulen TIDAK memicu notifikasi.
-- ---------------------------------------------------------------------
drop trigger if exists meetings_push_ins on public.meetings;
create trigger meetings_push_ins
  after insert on public.meetings
  for each row execute function public.notify_push('meeting');

drop trigger if exists meetings_push_upd on public.meetings;
create trigger meetings_push_upd
  after update on public.meetings
  for each row
  when (old.held_at is distinct from new.held_at
     or old.title   is distinct from new.title
     or old.room    is distinct from new.room)
  execute function public.notify_push('meeting');

-- ---------------------------------------------------------------------
-- PROGRAM
-- Dikirim saat program baru dibuat, dan saat judul, tanggal, atau
-- statusnya berubah. Mencentang checklist TIDAK memicu notifikasi.
-- ---------------------------------------------------------------------
drop trigger if exists programs_push_ins on public.programs;
create trigger programs_push_ins
  after insert on public.programs
  for each row execute function public.notify_push('program');

drop trigger if exists programs_push_upd on public.programs;
create trigger programs_push_upd
  after update on public.programs
  for each row
  when (old.starts_at is distinct from new.starts_at
     or old.title     is distinct from new.title
     or old.status    is distinct from new.status)
  execute function public.notify_push('program');

-- Lihat hasil panggilannya:
--   select id, status_code, content, created
--   from net._http_response order by created desc limit 5;
