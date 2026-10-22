-- =====================================================================
-- FORESTY MANAGEMENT — TOLAK PENDAFTARAN = HAPUS AKUN
-- Jalankan setelah 01–10. Aman dijalankan ulang.
--
-- Menolak pendaftaran menghapus akunnya sepenuhnya (login + pendaftaran),
-- jadi orang itu dianggap belum terdaftar: halaman Sign In menyuruhnya
-- mendaftar lagi. Menghapus akun Supabase Auth hanya bisa di server,
-- karena itu lewat fungsi ini.
--
-- Pengaman:
--   - hanya akun lab yang boleh memanggil;
--   - akun yang sudah disetujui ditolak di sini (pakai Revoke dulu);
--   - akun lab sendiri tidak bisa dihapus.
-- =====================================================================

create or replace function public.reject_account(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_lab() then
    raise exception 'Only the lab account can reject registrations.';
  end if;
  if exists (select 1 from auth.users u where u.id = p_user and lower(u.email) = lower(public.lab_email())) then
    raise exception 'The lab account cannot be deleted.';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = p_user and p.status = 'approved') then
    raise exception 'This account is approved. Revoke its access first.';
  end if;

  -- jejak lama orang ini (kalau pernah aktif) dilepas, datanya tetap ada
  update public.tasks        set created_by = null where created_by = p_user;
  update public.checklist    set created_by = null where created_by = p_user;
  update public.checklist    set done_by    = null where done_by    = p_user;
  update public.activity_log set actor      = null where actor      = p_user;
  update public.profiles     set decided_by = null where decided_by = p_user;
  if to_regclass('public.meetings') is not null then
    execute 'update public.meetings set created_by = null where created_by = $1' using p_user;
  end if;

  -- profiles, notif_read, dan push_subs ikut terhapus (on delete cascade)
  delete from auth.users where id = p_user;
end
$$;

revoke execute on function public.reject_account(uuid) from public, anon;
grant  execute on function public.reject_account(uuid) to authenticated;
