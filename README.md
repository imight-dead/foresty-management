# Foresty Management

Sistem internal Foresty Laboratory (Forensics & Security Laboratory) periode 2026/2027 —
program kerja, tugas divisi, agenda, direktori pengurus, notifikasi H-3/H-1/H-0, dan inbox lab.

```
foresty-lab/
├── index.html              mengarahkan ke app/
├── app/                    website-nya (yang di-deploy ke Vercel)
│   ├── index.html  manifest.webmanifest  sw.js  vercel.json  config.js
│   ├── css/                styles.css, opening.css
│   ├── js/                 app.js, opening.js
│   └── assets/             logo, ikon aplikasi & notifikasi, audio opening
├── db/                     SQL Supabase, dijalankan berurutan 01 → 14
├── scripts/                script sekali pakai: token Gmail, kunci VAPID (Node 18+)
└── supabase/functions/     Edge Function gmail-inbox dan push-send (Deno)
```

`sw.js` dan `manifest.webmanifest` sengaja di akar `app/`: service worker hanya bisa
mengurus halaman di foldernya sendiri dan di bawahnya.

`assets/logo.png` (tanpa tulisan) dipakai di dalam aplikasi. `assets/logo-text.png` (dengan
tulisan) hanya untuk ikon aplikasi di HP (`icon-*.png`) dan ikon notifikasi (`notif-icon.png`).

---

## Kenapa butuh Supabase

Aplikasi ini butuh satu tempat penyimpanan bersama supaya centang checklist di laptopmu
juga terlihat di HP temanmu, ditambah autentikasi, dan yang terpenting: **aturan siapa boleh apa yang ditegakkan di server**. Menyembunyikan menu di
tampilan tidak menghentikan orang yang membuka developer tools; aturan di `db/02_rls.sql` yang
menghentikannya.

Supabase gratis untuk skala lab, dan sudah membawa Postgres, Auth, dan realtime sekaligus.

---

## Pemasangan

### 1. Buat proyek Supabase

Daftar di [supabase.com](https://supabase.com) → **New project**. Pilih region Singapore
(paling dekat). Simpan password database yang dibuatkan.

### 2. Jalankan SQL

Buka **SQL Editor → New query**, tempel isi tiap file, lalu **Run**, berurutan:

1. `db/01_schema.sql` — tabel
2. `db/02_rls.sql` — aturan keamanan
3. `db/03_seed.sql` — 26 pengurus, 6 divisi, dan tugas divisi
4. `db/04_notulen.sql` — ruang rapat dan notulen (menu Meeting)
5. `db/05_push.sql` — notifikasi HP; lihat bagian **Notifikasi perangkat** di bawah
6. `db/06_push_instant.sql` — notifikasi seketika saat rapat/program disimpan
7. `db/07_task_deadline.sql` — tenggat tugas divisi. Tanpa ini, isian tenggat tidak muncul
   dan tugas divisi tidak masuk kalender.
8. `db/08_account_status.sql` — pesan gagal masuk yang membedakan email belum terdaftar,
   password salah, dan akun yang masih menunggu persetujuan.
9. `db/09_audit_log.sql` — menu **Log** akun lab: semua tambah, ubah, dan hapus data
   beserta siapa pelakunya. Pencatatan dimulai sejak file ini dijalankan.
10. `db/10_task_description.sql` — deskripsi pada tugas divisi.
11. `db/11_reject_account.sql` — menolak pendaftaran menghapus akunnya, jadi email itu harus
    mendaftar ulang.
12. `db/12_meeting_roles.sql` — notulen bisa diisi semua anggota divisi rapat; menjadwalkan,
    mengubah jadwal, dan menghapus rapat hanya koordinator.
13. `db/13_security.sql` — pengerasan keamanan (lihat **Catatan keamanan**). Akun lab harus
    sudah ada sebelum file ini dijalankan.
14. `db/14_task_push.sql` — notifikasi HP seketika ke orang yang ditugaskan saat tugas
    bertenggat dibuat atau tenggatnya diubah.

Nomor file berubah sejak versi sebelumnya (dulu 06, 08, 09, 10, 11). Yang sudah pernah
dijalankan tidak perlu dijalankan lagi.

Kalau alamat akun lab bukan `forestylab@gmail.com`, ubah dulu di fungsi `lab_email()`
pada `02_rls.sql` sebelum dijalankan.

### 3. Matikan konfirmasi email

**Authentication → Sign In / Providers → Email → Confirm email: OFF.**

Persetujuan akun lab yang jadi pagarnya, bukan email konfirmasi. Kalau konfirmasi dibiarkan
menyala, pendaftar tidak mendapat sesi dan barisnya tidak pernah masuk antrean approval.

### 4. Buat akun lab

**Authentication → Users → Add user**:

- Email: `forestylab@gmail.com`
- Password: buat yang kuat, simpan di pengelola kata sandi
- Centang **Auto Confirm User**

Akun ini tidak perlu mendaftar lewat halaman Daftar dan tidak punya baris di `profiles`.
Dia dikenali dari alamat emailnya saja. Kredensialnya dipegang petinggi lab.

### 5. Isi konfigurasi

```bash
cp app/config.example.js app/config.js
```

Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dari **Project Settings → API**.

Anon key memang terlihat publik dan itu wajar — yang menjaga data adalah RLS.
**Jangan pernah menaruh `service_role` key di file ini.**

### 6. Jalankan

Harus lewat HTTP, bukan `file://`:

```bash
cd app
python -m http.server 5173
```

Buka `http://localhost:5173`.

### 7. Deploy

Seret folder `app/` ke [app.netlify.com/drop](https://app.netlify.com/drop), atau `vercel deploy`,
atau GitHub Pages. Tidak ada proses build — semuanya file statis.

Setelah dapat alamatnya, tambahkan ke **Supabase → Authentication → URL Configuration → Site URL**.

### 8. Lupa password

Di halaman Sign In ada **Forgot password?**: isi email, Supabase mengirim link reset, link itu
membuka layar **Set New Password** di web ini. Supaya linknya kembali ke alamat yang benar,
daftarkan semua alamat web di **Authentication → URL Configuration → Redirect URLs**, misalnya:

- `http://localhost:5173/**` dan `http://127.0.0.1:5173/**` untuk uji coba
- `https://<alamat-vercel>/**` untuk pemakaian sehari-hari

Pengirim email bawaan Supabase hanya untuk uji coba: kuotanya kecil (beberapa email per jam)
dan hanya mengirim ke alamat anggota tim proyek Supabase. Untuk semua pengurus, pasang SMTP
sendiri di **Authentication → Emails → SMTP Settings** — misalnya Gmail lab dengan App Password,
atau Resend.

---

## Integrasi Gmail

**Menu Inbox hanya muncul untuk akun lab.** Pengurus lain tidak melihatnya di sidebar, dan
Edge Function menolak panggilan dari akun selain akun lab — jadi isi kotak masuk tidak bocor
walau seseorang memanggil endpoint-nya langsung.

Untuk akun lab, menu Inbox menampilkan 25 email terbaru — pengirim, subjek, cuplikan, waktu,
dan tanda belum dibaca. Tombol **Load older email** di bawah daftar mengambil 25 berikutnya,
jadi seluruh isi kotak masuk bisa ditelusuri. Klik salah satu untuk membuka dan membalasnya di Gmail. Email belum
dibaca juga muncul sebagai badge di menu Inbox, di lonceng notifikasi, dan sebagai baris
tersendiri di halaman Notification.

**Token Gmail disimpan di server, tidak pernah sampai ke browser.** Akun lab mengotorisasi
sekali, lalu refresh token-nya jadi secret di Supabase. Izinnya hanya baca (`gmail.readonly`) —
membalas, menghapus, dan mengarsipkan tetap di Gmail.

Tanpa langkah di bawah, menu Inbox tetap jalan dengan tombol "Buka Kotak Masuk" dan menampilkan
catatan bahwa integrasi belum aktif.

### 1. Google Cloud Console

1. [console.cloud.google.com](https://console.cloud.google.com) → **New Project**, misal `foresty-lab`
2. **APIs & Services → Library** → cari **Gmail API** → **Enable**
3. **OAuth consent screen** → User type **External** → isi nama aplikasi dan email dukungan
   → tambahkan `forestylab@gmail.com` sebagai **Test user**
   → **Audience → Publish app** sampai statusnya **In production**
4. **Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:53682/callback`
   - Simpan **Client ID** dan **Client Secret**

**Statusnya harus In production.** Selama masih Testing, Google membuat refresh token kedaluwarsa
setelah 7 hari dan Inbox berhenti dengan pesan "The Gmail refresh token is no longer valid".
In production tidak perlu proses verifikasi Google karena yang mengotorisasi cuma satu akun;
layar persetujuannya hanya menampilkan peringatan aplikasi belum diverifikasi.

### 2. Ambil refresh token

```bash
node scripts/get-gmail-token.mjs <CLIENT_ID> <CLIENT_SECRET>
```

Browser terbuka, login sebagai `forestylab@gmail.com`, setujui izin baca. Refresh token
tercetak di terminal.

Google akan memperingatkan aplikasinya belum diverifikasi — wajar untuk aplikasi internal.
Klik **Advanced → Go to ... (unsafe)** untuk lanjut.

**Refresh token itu setara kunci kotak masuk lab.** Jangan ditempel di chat, jangan masuk git.

### 3. Deploy Edge Function

Jalankan dari folder `foresty-lab` (bukan dari dalam `app/`). Tidak perlu install apa pun —
`npx` mengunduh CLI-nya sekali jalan. Install global lewat npm sudah tidak didukung Supabase.

```bash
npx supabase@latest login
npx supabase@latest secrets set --project-ref <REF> GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
npx supabase@latest functions deploy gmail-inbox --project-ref <REF>
```

`<REF>` ada di Project Settings → General → **Reference ID**. Memakai `--project-ref` berarti
tidak perlu `supabase link`, jadi tidak ditanya password database.

Refresh halaman Inbox — email langsung muncul.

### Kalau bermasalah

| Pesan | Artinya |
|---|---|
| "The gmail-inbox edge function has not been deployed" | Langkah 3 belum jalan |
| "Gmail integration is not set up on the server" | Function sudah ada, `GOOGLE_REFRESH_TOKEN` belum di-set |
| "The Gmail refresh token is no longer valid" | Token kedaluwarsa (aplikasi masih Testing), dicabut, atau password Google diganti. Pastikan In production, ulangi langkah 2, lalu set ulang `GOOGLE_REFRESH_TOKEN` dan deploy ulang |
| "Google rejected the refresh token" | Client ID/secret tidak cocok dengan token. Ulangi langkah 2 dengan client yang sama |
| "The inbox is only available to the lab account" | Yang memanggil bukan akun lab — memang begitu perilakunya |

Isi kotak masuk di-cache 45 detik di server dan ditarik ulang otomatis tiap 3 menit, jadi kuota
Gmail API aman. Tombol **Muat ulang** memaksa ambil data baru.


---

## Notifikasi perangkat (Web Push)

Pengingat H-3, H-1, dan hari-H untuk program dan rapat dikirim ke HP atau laptop
pengurus **walau aplikasinya sedang tidak dibuka**. Tiap orang menyalakannya sendiri
lewat tombol di halaman Notification; izinnya diminta browser, bukan dipaksakan.

Pengingat rapat hanya dikirim ke orang yang berhak masuk ruang rapat itu — aturan
yang sama dengan yang dipakai menu Meeting.

### 1. Buat kunci VAPID

```bash
node scripts/gen-vapid.mjs
```

Tempel kunci **publik** ke `app/config.js` pada `VAPID_PUBLIC_KEY`. Kunci **privat**
jangan masuk git dan jangan ditempel di chat.

### 2. Tabel dan penjadwalan

Jalankan `db/05_push.sql` lalu `db/06_push_instant.sql` di SQL Editor. Sebelum Run, ganti `<REF>` dengan Reference ID
proyek dan `<PUSH_CRON_SECRET>` dengan kata sandi karangan yang panjang.

### 3. Deploy pengirimnya

```bash
npx supabase@latest secrets set --project-ref <REF>   VAPID_PUBLIC_KEY=<publik> VAPID_PRIVATE_KEY=<privat>   VAPID_SUBJECT=mailto:forestylab@gmail.com PUSH_CRON_SECRET=<secret yang sama>

npx supabase@latest functions deploy push-send --no-verify-jwt
```

`--no-verify-jwt` diperlukan karena yang memanggil adalah cron, bukan pengguna.
Sebagai gantinya function memeriksa header `x-cron-secret`.

### Catatan

- **Wajib HTTPS.** Berjalan di `localhost` untuk uji coba, dan di alamat Vercel untuk
  pemakaian sehari-hari. Tidak jalan di `file://` atau HTTP biasa.
- **iPhone dan iPad** hanya menerima push kalau aplikasinya dipasang ke Home Screen
  dulu lewat Safari → Share → Add to Home Screen, lalu dibuka dari ikon itu.
- Cron berjalan tiap 15 menit; `push_log` mencegah satu pengingat terkirim dua kali.
- Tenggat tugas divisi: notifikasi seketika saat tugas dibuat / tenggatnya diubah, lalu
  pengingat H-1 dan hari-H pukul 07.00 WIB — dikirim ke orang yang ditugaskan dan akun lab.
- Tombol **Send Test Notification** di halaman Notification mengirim satu notifikasi ke semua
  perangkat milik akun itu — cara cepat memastikan HP seseorang sudah terdaftar.
- Kalau pengingat terjadwal tidak pernah sampai, cek cron-nya di SQL Editor:
  `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`
  dan jawaban `push-send`:
  `select status_code, left(content::text, 200), created from net._http_response order by created desc limit 10;`
  `403 forbidden` berarti secret di `05_push.sql` / `06_push_instant.sql` tidak sama dengan
  `PUSH_CRON_SECRET`.
- Perangkat yang mencabut izin otomatis dihapus dari `push_subs` saat pengiriman gagal.


---

## Alur akun

```
Nama pengurus sudah ada di database, email masih kosong
        │
        ├─ Aslab buka /  →  Daftar  →  email + password + pilih nama
        │                              status: pending
        │
        ├─ Dia coba masuk  →  layar "Menunggu Persetujuan"
        │
        ├─ Akun lab masuk  →  menu Approval  →  Setujui / Tolak
        │
        └─ Disetujui  →  email menempel ke nama  →  bisa masuk
```

Beberapa orang boleh mengklaim nama yang sama selama masih `pending` — halaman Approval
menandainya dengan **"2 orang mengklaim nama ini"** supaya akun lab bisa memilih. Setelah satu
disetujui, nama itu terkunci di tingkat database (unique index), bukan hanya di tampilan.

Kalau seseorang sudah membuat akun tapi keluar sebelum memilih nama, saat masuk lagi dia
diarahkan ke layar **Lengkapi Pendaftaran**.

---

## Hak akses

| | Akses penuh | Akses terbatas |
|---|---|---|
| Siapa | Akun lab, Coordinator, Vice Coordinator, Secretary, Treasurer, dan 4 koordinator divisi | Staff HR, Media & Partner, Study Group, dan tim riset |
| Checklist program | Centang semua, tambah dan hapus item, tunjuk PIC | Hanya centang item atas namanya |
| Tugas divisi | Tambah, ubah, hapus untuk siapa saja di divisinya | Hanya atas namanya, di divisinya sendiri |
| Meeting | Jadwalkan, ubah jadwal, hapus, isi notulen | Hanya isi notulen rapat divisinya |
| Menyetujui akun, mengubah jabatan & divisi | Hanya akun lab | Tidak |
| Menu Inbox & Log | Hanya akun lab | Tidak muncul |

Kolom `members.level` (`inti` / `staff`) yang menentukan. Kalau ada pergantian jabatan,
ubah kolom itu di Table Editor Supabase — tidak perlu menyentuh kode. Hanya akun lab (dan
dashboard Supabase) yang bisa mengubah `members`, `divisions`, dan `division_members`.

Semua batasan ini ada di RLS, jadi tetap berlaku walaupun seseorang memanggil API Supabase
langsung tanpa lewat tampilan.

---

## Mengubah data

**Lewat aplikasi:** tambah item checklist dan tugas divisi bisa langsung dari dalam web.

**Lewat Supabase (Table Editor):** untuk hal yang belum ada formnya —
menambah program kerja baru, mengganti PIC, mengubah tanggal, mengganti jabatan seseorang.
Tabelnya: `programs`, `program_pics`, `checklist`, `members`, `divisions`, `division_members`.

Perubahan langsung terlihat di semua browser yang sedang membuka aplikasi, tanpa refresh —
realtime sudah dinyalakan untuk `checklist`, `tasks`, `programs`, dan `profiles`.

---

## Yang belum ada

- **Form tambah/edit program dari dalam web.** Sekarang lewat Table Editor Supabase.
- **Notifikasi keluar aplikasi.** Pengingat H-3/H-1/H-0 dihitung saat halaman dibuka, jadi baru
  terlihat kalau seseorang membuka web. Untuk kirim email atau push sungguhan: pasang
  Supabase Edge Function + `pg_cron` yang jalan tiap pagi pukul 07.00 WIB, baca program dan
  tenggat checklist, lalu kirim lewat Resend atau SMTP lab.
- **Membalas email dari dalam aplikasi.** Menu Inbox hanya membaca; membalas membuka Gmail.
  Untuk mengirim dari dalam web perlu scope `gmail.send` dan form tulis pesan sendiri.
- **Foto anggota.** Sekarang inisial. Kalau mau foto, tambah kolom `photo_url` di `members`
  dan simpan berkasnya di Supabase Storage.

---

## Catatan keamanan

- Aplikasi ini **tidak pernah meminta password Gmail siapa pun.** Password yang dibuat saat
  mendaftar adalah password akun Foresty Management, terpisah dari akun Google.
- Daftar nama pengurus sengaja bisa dibaca tanpa login, karena halaman Daftar perlu
  menampilkannya sebelum orangnya punya akun. Yang terbaca hanya nama, jabatan, dan divisi.
  Cara menutupnya ada di komentar `db/02_rls.sql`.
- Kredensial akun lab dipegang petinggi lab. Siapa pun yang memegangnya bisa menyetujui akun,
  jadi perlakukan seperti kunci ruang lab.
- **Password tidak pernah disimpan di tabel aplikasi.** Supabase Auth hanya menyimpan hash-nya;
  tidak ada yang bisa membacanya, termasuk akun lab dan pemilik proyek Supabase.
- **Akun lab dikenali dari email + penanda `foresty_lab` di `app_metadata`** (dipasang
  `db/13_security.sql`). `app_metadata` hanya bisa diubah dari server, jadi mendaftar dengan
  email lab tidak memberi akses admin. Kalau akun lab dibuat ulang, jalankan lagi file itu.
- **Header keamanan** di `app/vercel.json`: Content-Security-Policy (hanya skrip dari situs ini
  dan jsDelivr), anti-clickjacking, HSTS, nosniff. Pustaka Supabase dari CDN dikunci dengan
  `integrity` (SRI); kalau versinya diganti, hash di `app/index.html` harus ikut diganti.
- Kalau alamat proyek Supabase berubah, ganti juga alamatnya di `connect-src` pada CSP.
- `push-send` menolak semua panggilan kalau `PUSH_CRON_SECRET` belum di-set.
