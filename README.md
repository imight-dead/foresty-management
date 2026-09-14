# Foresty Management

Sistem internal Foresty Laboratory (Forensics & Security Laboratory) periode 2026/2027 —
program kerja, tugas divisi, agenda, direktori pengurus, notifikasi H-3/H-1/H-0, dan inbox lab.

Ada dua versi di repo ini:

| Folder | Isi | Data |
|---|---|---|
| `foresty-console.html` | **Prototipe** satu file. Buka langsung di browser. | Contoh, tersimpan di browser masing-masing |
| `app/` | **Versi asli.** Login, approval, data bersama. | Supabase (Postgres) |
| `db/` | Skema, aturan keamanan, dan data awal | SQL, dijalankan di Supabase |

---

## Kenapa butuh Supabase

Prototipe menyimpan semuanya di `localStorage`, jadi centang checklist di laptopmu tidak
terlihat di HP temanmu. Versi asli butuh satu tempat penyimpanan bersama, autentikasi, dan
yang terpenting: **aturan siapa boleh apa yang ditegakkan di server**. Menyembunyikan menu di
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
4. `db/04_contoh_program.sql` — **opsional**, 9 program kerja contoh supaya aplikasi tidak
   kosong saat pertama dibuka. Lewati kalau mau langsung isi proker asli.

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
| Checklist program | Centang semua, tambah item baru, tunjuk PIC | Hanya centang item atas namanya |
| Tugas divisi | Ubah dan tambah untuk siapa saja | Hanya ubah dan tambah atas namanya |
| Menyetujui akun | Hanya akun lab | Tidak |

Kolom `members.level` (`inti` / `staff`) yang menentukan. Kalau ada pergantian jabatan,
ubah kolom itu — tidak perlu menyentuh kode.

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
- **Gmail API di menu Inbox.** Masih tombol "Buka Gmail". Tahap berikutnya perlu OAuth2 dengan
  scope `gmail.readonly` dan refresh token disimpan di server.
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
