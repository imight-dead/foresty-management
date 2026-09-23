/**
 * Buat sepasang kunci VAPID untuk Web Push — dijalankan SEKALI saja.
 *
 *   node push/gen-vapid.mjs
 *
 * Kunci publik dipasang di app/config.js (aman terlihat publik).
 * Kunci privat disimpan sebagai secret Supabase, jangan masuk git,
 * jangan ditempel di chat.
 *
 * Tidak perlu install paket apa pun; hanya Node 18+.
 */

import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const pubJwk = publicKey.export({ format: "jwk" });
const privJwk = privateKey.export({ format: "jwk" });

const b64u = (s) => s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const raw = (part) => Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/* kunci publik VAPID = titik tak-terkompresi: 0x04 || x || y */
const pub = b64u(Buffer.concat([Buffer.from([4]), raw(pubJwk.x), raw(pubJwk.y)]).toString("base64"));
const priv = b64u(privJwk.d);

console.log("\n==================== VAPID PUBLIC KEY ====================\n");
console.log(pub);
console.log("\n==================== VAPID PRIVATE KEY ===================\n");
console.log(priv);
console.log("\n==========================================================\n");
console.log("1. Tempel kunci PUBLIK ke app/config.js:\n");
console.log(`     VAPID_PUBLIC_KEY: "${pub}",\n`);
console.log("2. Simpan keduanya sebagai secret Supabase:\n");
console.log(`     npx supabase@latest secrets set --project-ref <REF> \\`);
console.log(`       VAPID_PUBLIC_KEY=${pub} \\`);
console.log(`       VAPID_PRIVATE_KEY=${priv} \\`);
console.log(`       VAPID_SUBJECT=mailto:forestylab@gmail.com \\`);
console.log(`       PUSH_CRON_SECRET=<karangan-bebas-yang-panjang>\n`);
console.log("Kunci privat setara kunci pengirim notifikasi lab. Jangan dibagikan.\n");
