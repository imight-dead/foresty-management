/**
 * Ambil refresh token Google untuk akun lab — dijalankan SEKALI saja.
 *
 *   node scripts/get-gmail-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 *
 * Script ini membuka browser, kamu login sebagai forestylab@gmail.com dan
 * menyetujui izin baca Gmail, lalu refresh token-nya dicetak di terminal.
 *
 * Refresh token itu setara kunci kotak masuk lab. Jangan ditempel di chat,
 * jangan masuk git — langsung simpan sebagai secret Supabase:
 *   supabase secrets set GOOGLE_REFRESH_TOKEN=<token>
 *
 * Tidak perlu install paket apa pun; hanya Node 18+.
 */

import http from "node:http";
import { exec } from "node:child_process";

const [CLIENT_ID, CLIENT_SECRET] = process.argv.slice(2);
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Pemakaian: node scripts/get-gmail-token.mjs <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",      // wajib, supaya dapat refresh token
    prompt: "consent",           // paksa consent agar refresh token selalu dikirim
  });

const page = (title, body, ok = true) => `<!doctype html><meta charset="utf-8">
<body style="background:#050505;color:#fff;font-family:ui-monospace,monospace;padding:48px;line-height:1.7">
<h1 style="color:${ok ? "#E4181A" : "#8A8A8A"};font-size:20px;letter-spacing:.1em">${title}</h1>
<p style="color:#B3B3B3">${body}</p></body>`;

/* Keluar rapi: tutup server dulu, beri jeda agar soket benar-benar lepas.
   Tanpa ini Windows memunculkan "Assertion failed: UV_HANDLE_CLOSING". */
function bye(code) {
  server.closeAllConnections?.();
  server.close(() => setTimeout(() => process.exit(code), 50));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404).end(); return; }

  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(200, { "Content-Type": "text/html" })
       .end(page("Dibatalkan", `Google membalas: ${err}. Tutup tab ini dan jalankan ulang script.`, false));
    console.error("\nGagal:", err);
    bye(1); return;
  }

  const code = url.searchParams.get("code");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: "authorization_code",
    }),
  });
  const j = await r.json();

  if (!j.refresh_token) {
    res.writeHead(200, { "Content-Type": "text/html" })
       .end(page("Tidak ada refresh token", "Cabut akses aplikasi di myaccount.google.com/permissions, lalu jalankan script ini lagi.", false));
    console.error("\nGoogle tidak mengirim refresh_token:", j);
    bye(1); return;
  }

  res.writeHead(200, { "Content-Type": "text/html" })
     .end(page("Berhasil", "Refresh token sudah tercetak di terminal. Tutup tab ini."));

  console.log("\n==================== REFRESH TOKEN ====================\n");
  console.log(j.refresh_token);
  console.log("\n=======================================================");
  console.log("\nSimpan dengan:\n");
  console.log(`  supabase secrets set GOOGLE_CLIENT_ID=${CLIENT_ID} \\`);
  console.log(`    GOOGLE_CLIENT_SECRET=${CLIENT_SECRET} \\`);
  console.log(`    GOOGLE_REFRESH_TOKEN=${j.refresh_token}\n`);
  console.log("Jangan tempel token ini di chat atau commit ke git.\n");

  bye(0);
});

server.listen(PORT, () => {
  console.log("\nMembuka browser. Login sebagai akun lab, lalu setujui izin baca Gmail.");
  console.log("Kalau browser tidak terbuka, salin alamat ini:\n\n" + authUrl + "\n");
  const cmd = process.platform === "win32" ? `start "" "${authUrl}"`
    : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(cmd);
});
