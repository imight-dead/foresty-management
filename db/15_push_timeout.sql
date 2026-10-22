-- =====================================================================
-- FORESTY MANAGEMENT — BATAS TUNGGU PANGGILAN push-send
-- Jalankan setelah 01–14. Aman dijalankan ulang.
--
-- net.http_post bawaannya hanya menunggu 5 detik. Saat push-send baru
-- "bangun" (cold start) jawabannya bisa lebih lama, dan panggilannya
-- tercatat gagal (status_code null di net._http_response). File ini
-- menaikkan batasnya jadi 30 detik untuk:
--   - jadwal cron foresty-push (05_push.sql)
--   - fungsi notify_push untuk notifikasi seketika (06_push_instant.sql)
--
-- Yang diubah hanya perintah yang SUDAH terpasang, jadi secret cron yang
-- dulu kamu isi tetap dipakai — tidak perlu diketik ulang.
-- =====================================================================

do $$
declare
  j   record;
  c   text;
  src text;
begin
  -- jadwal cron
  select jobid, command into j from cron.job where jobname = 'foresty-push';
  if not found then
    raise exception 'Jadwal foresty-push tidak ditemukan. Jalankan db/05_push.sql dulu.';
  end if;
  if j.command !~ 'timeout_milliseconds' then
    c := regexp_replace(j.command, '(body\s*:=\s*''\{\}''::jsonb)', E'\\1,\n    timeout_milliseconds := 30000');
    if c = j.command then
      raise exception 'Perintah cron tidak dikenali. Jalankan ulang db/05_push.sql (versi baru sudah memakai batas 30 detik).';
    end if;
    perform cron.alter_job(j.jobid, command := c);
  end if;

  -- notifikasi seketika
  if to_regprocedure('public.notify_push()') is not null then
    src := pg_get_functiondef('public.notify_push()'::regprocedure);
    if src !~ 'timeout_milliseconds' then
      src := regexp_replace(src, '(''op'',\s*TG_OP\))', E'\\1,\n    timeout_milliseconds := 30000');
      if src !~ 'timeout_milliseconds' then
        raise exception 'Isi notify_push tidak dikenali. Jalankan ulang db/06_push_instant.sql (versi baru sudah memakai batas 30 detik).';
      end if;
      execute src;
    end if;
  end if;
end $$;

-- Cek hasilnya:
--   select command from cron.job where jobname = 'foresty-push';
