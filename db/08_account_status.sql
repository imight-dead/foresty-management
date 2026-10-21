-- =====================================================================
-- FORESTY MANAGEMENT — STATUS AKUN UNTUK PESAN GAGAL MASUK
-- Jalankan setelah 01–07. Aman dijalankan ulang.
--
-- Supabase sengaja memberi error yang sama untuk "email belum terdaftar"
-- dan "password salah". Fungsi ini dipanggil HANYA setelah masuk gagal,
-- supaya halaman Sign In bisa bilang mana yang terjadi:
--
--   'none'       email belum punya akun            -> silakan daftar
--   'incomplete' akun ada, belum memilih nama       -> password salah
--   'pending'    menunggu persetujuan akun lab      -> password salah + hubungi admin
--   'approved'   sudah disetujui (termasuk akun lab) -> password salah
--   'rejected'   pendaftaran ditolak                -> password salah + hubungi admin
--
-- Konsekuensinya: siapa pun bisa mengecek apakah sebuah email terdaftar
-- di aplikasi ini. Yang dikembalikan hanya satu kata status — tidak ada
-- nama, id, atau data lain.
-- =====================================================================

create or replace function public.account_status(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when u.id is null                                   then 'none'
    when lower(u.email) = lower(public.lab_email())     then 'approved'
    when p.user_id is null                              then 'incomplete'
    else p.status
  end
  from (select 1) as one
  left join auth.users u      on lower(u.email) = lower(trim(p_email))
  left join public.profiles p on p.user_id = u.id
  limit 1
$$;

grant execute on function public.account_status(text) to anon, authenticated;
