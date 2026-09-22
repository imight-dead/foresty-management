/**
 * gmail-inbox — Supabase Edge Function
 *
 * Mengambil kotak masuk forestylab@gmail.com lalu mengembalikannya sebagai
 * JSON ke aplikasi. Refresh token Google disimpan sebagai secret di server;
 * browser tidak pernah menyentuhnya, dan pengurus tidak perlu tahu password
 * akun Google lab.
 *
 * Yang boleh memanggil: HANYA akun lab. Pengurus lain tidak melihat menu Inbox
 * sama sekali, dan panggilan langsung ke endpoint ini ditolak di server.
 *
 * Deploy:
 *   supabase functions deploy gmail-inbox
 *   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/* ---- cache kecil supaya Gmail tidak dipanggil tiap kali halaman dibuka ---- */
let cache: { at: number; data: unknown } | null = null;
const CACHE_MS = 45_000;

/* ---- access token dari refresh token (berlaku 1 jam, di-cache) ---- */
let tokenCache: { at: number; token: string } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 50 * 60_000) return tokenCache.token;

  const body = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
    refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "",
    grant_type: "refresh_token",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google menolak refresh token: " + (j.error_description || j.error || r.status));

  tokenCache = { at: Date.now(), token: j.access_token };
  return j.access_token;
}

const header = (headers: Array<{ name: string; value: string }>, name: string) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/* "Nama Pengirim <alamat@email.com>" -> { name, email } */
function parseFrom(raw: string) {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2], email: m[2] };
  return { name: raw.trim(), email: raw.trim() };
}

async function fetchInbox(max: number) {
  const token = await accessToken();
  const auth = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&labelIds=INBOX`,
    { headers: auth },
  );
  const list = await listRes.json();
  if (!listRes.ok) throw new Error("Gmail API: " + (list.error?.message || listRes.status));

  const ids: Array<{ id: string }> = list.messages ?? [];

  const messages = await Promise.all(ids.map(async ({ id }) => {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
        "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date",
      { headers: auth },
    );
    if (!r.ok) return null;
    const m = await r.json();
    const hs = m.payload?.headers ?? [];
    const from = parseFrom(header(hs, "From"));
    return {
      id: m.id,
      threadId: m.threadId,
      from: from.name,
      fromEmail: from.email,
      subject: header(hs, "Subject") || "(tanpa subjek)",
      snippet: (m.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
      date: new Date(Number(m.internalDate)).toISOString(),
      unread: (m.labelIds ?? []).includes("UNREAD"),
    };
  }));

  return messages.filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    /* ---- 1. siapa yang memanggil ---- */
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Tidak ada sesi." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
    });
    if (!userRes.ok) return json({ error: "Sesi tidak sah." }, 401);
    const user = await userRes.json();

    const labEmail = (Deno.env.get("LAB_EMAIL") ?? "forestylab@gmail.com").toLowerCase();
    const isLab = (user.email ?? "").toLowerCase() === labEmail;

    /* Kotak masuk lab hanya untuk akun lab. Pengurus lain tidak melihat menu
       Inbox sama sekali, dan kalau memanggil endpoint ini langsung, ditolak
       di sini — bukan sekadar disembunyikan di tampilan. */
    if (!isLab) return json({ error: "Kotak masuk hanya dapat diakses akun lab." }, 403);

    /* ---- 2. belum dikonfigurasi? katakan apa adanya ---- */
    if (!Deno.env.get("GOOGLE_REFRESH_TOKEN")) {
      return json({ messages: [], configured: false, error: "Integrasi Gmail belum dipasang di server." });
    }

    /* ---- 3. ambil kotak masuk ---- */
    const url = new URL(req.url);
    const force = url.searchParams.get("refresh") === "1";
    if (!force && cache && Date.now() - cache.at < CACHE_MS) {
      return json({ messages: cache.data, configured: true, cached: true });
    }

    const messages = await fetchInbox(15);
    cache = { at: Date.now(), data: messages };
    return json({ messages, configured: true, cached: false });
  } catch (e) {
    return json({ messages: [], configured: true, error: String(e?.message ?? e) }, 200);
  }
});
