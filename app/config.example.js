/* Salin file ini jadi config.js, lalu isi dengan data proyek Supabase kamu.
   Buka Supabase -> Project Settings -> API.

   ANON KEY memang aman ditaruh di sini dan terlihat publik — yang menjaga
   data bukan kunci ini, melainkan Row Level Security di 02_rls.sql.
   JANGAN PERNAH menaruh service_role key di file ini. */

window.FORESTY_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxxxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",

  // Alamat akun lab. Harus sama persis dengan yang ada di lab_email() pada 02_rls.sql.
  LAB_EMAIL: "forestylab@gmail.com",

  // Kunci publik Web Push, hasil `node push/gen-vapid.mjs`.
  // Aman terlihat publik. Kunci privatnya disimpan sebagai secret Supabase.
  VAPID_PUBLIC_KEY: "PASTE_VAPID_PUBLIC_KEY",
};
