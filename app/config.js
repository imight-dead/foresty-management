/* Salin file ini jadi config.js, lalu isi dengan data proyek Supabase kamu.
   Buka Supabase -> Project Settings -> API.

   ANON KEY memang aman ditaruh di sini dan terlihat publik — yang menjaga
   data bukan kunci ini, melainkan Row Level Security di 02_rls.sql.
   JANGAN PERNAH menaruh service_role key di file ini. */

window.FORESTY_CONFIG = {
  SUPABASE_URL: "https://mpdpdmcpvapykcqkeixs.supabase.co/",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wZHBkbWNwdmFweWtjcWtlaXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzOTM2MDQsImV4cCI6MjEwNDk2OTYwNH0.Kdtx-slyd09o-K-tXKO7w3OoMj55ZB3L12Iu21lANOM",

  // Alamat akun lab. Harus sama persis dengan yang ada di lab_email() pada 02_rls.sql.
  LAB_EMAIL: "forestylab@gmail.com",

  // Kunci publik Web Push, hasil `node push/gen-vapid.mjs`.
  // Aman terlihat publik. Kunci privatnya disimpan sebagai secret Supabase.
  VAPID_PUBLIC_KEY: "BNlXRV09JrtJ2Cyb011p0TuTGddR4V1oO2oU85zf-Ldh0MkUVkwLjICk57Thf1qbNrU57tTMaU3s8ZIJhaXvbBk",
};
