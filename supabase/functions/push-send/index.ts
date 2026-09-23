/**
 * push-send — Supabase Edge Function
 *
 * Dipanggil pg_cron tiap 15 menit. Menghitung pengingat yang sudah jatuh
 * tempo (H-3 / H-1 / hari-H pukul 07.00 WIB, serta tenggat checklist),
 * lalu mengirimkannya sebagai Web Push ke perangkat yang sudah
 * mengizinkan notifikasi.
 *
 * Pengingat rapat hanya dikirim ke orang yang berhak masuk ruang rapat
 * itu — sama persis dengan aturan yang dipakai aplikasi.
 *
 * Setiap pengingat dicatat di push_log, jadi tidak pernah terkirim dua
 * kali walaupun cron berjalan berulang.
 *
 * Deploy:
 *   supabase functions deploy push-send --no-verify-jwt
 *   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
 *                        VAPID_SUBJECT=mailto:forestylab@gmail.com \
 *                        PUSH_CRON_SECRET=...
 */

import webpush from "npm:web-push@3.6.7";

const SUPA = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WIB = 7 * 60 * 60 * 1000;          /* offset WIB terhadap UTC */
const MAX_AGE = 24 * 60 * 60 * 1000;     /* pengingat lebih tua dari ini dilewati */

const hdr = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...init, headers: { ...hdr, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

/* Pukul 07.00 WIB, `minus` hari sebelum tanggal acara. */
function fireAt(when: Date, minus: number): Date {
  const wib = new Date(when.getTime() + WIB);          /* jam dinding WIB */
  const y = wib.getUTCFullYear(), m = wib.getUTCMonth(), d = wib.getUTCDate();
  return new Date(Date.UTC(y, m, d - minus, 7, 0, 0) - WIB);
}

const fDate = (d: Date) => {
  const w = new Date(d.getTime() + WIB);
  const MO = ["January","February","March","April","May","June","July",
              "August","September","October","November","December"];
  return `${w.getUTCDate()} ${MO[w.getUTCMonth()]} ${w.getUTCFullYear()}`;
};
const fTime = (d: Date) => {
  const w = new Date(d.getTime() + WIB);
  return `${String(w.getUTCHours()).padStart(2,"0")}:${String(w.getUTCMinutes()).padStart(2,"0")}`;
};

const ROOM_OF_DIV: Record<string, string> = {
  "Human Resource": "hr",
  "Media & Partner": "medpart",
  "Study Group": "sg",
  "Research & Development": "rnd",
};

type Job = { key: string; title: string; body: string; url: string; room?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  const secret = Deno.env.get("PUSH_CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) {
    return new Response(JSON.stringify({ error: "VAPID keys belum di-set" }), { status: 500 });
  }
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:forestylab@gmail.com", pub, priv);

  const now = Date.now();

  try {
    /* ---------------- data ---------------- */
    const [programs, checklist, meetings, members, profiles, subs, log] = await Promise.all([
      api("programs?select=id,title,status,starts_at,place"),
      api("checklist?select=id,program_id,text,member_id,due_at,done"),
      api("meetings?select=id,room,title,held_at,place").catch(() => []),
      api("members?select=id,name,div,level"),
      api("profiles?select=user_id,member_id,status&status=eq.approved"),
      api("push_subs?select=endpoint,user_id,p256dh,auth"),
      api("push_log?select=notif_key"),
    ]);

    if (!subs.length) return new Response(JSON.stringify({ sent: 0, note: "tidak ada perangkat terdaftar" }));

    const sentKeys = new Set<string>(log.map((r: any) => r.notif_key));
    const memberById = new Map(members.map((m: any) => [m.id, m]));

    /* ---------------- pengingat yang jatuh tempo ---------------- */
    const jobs: Job[] = [];
    const RULES = [{ d: 3, l: "H-3" }, { d: 1, l: "H-1" }, { d: 0, l: "H-0" }];

    for (const p of programs) {
      if (p.status === "completed") continue;
      const when = new Date(p.starts_at);
      for (const r of RULES) {
        const key = `${p.id}:${r.l}`;
        if (sentKeys.has(key)) continue;
        const fire = fireAt(when, r.d).getTime();
        if (fire > now || now - fire > MAX_AGE) continue;
        const kata = r.d === 0 ? "today" : r.d === 1 ? "tomorrow" : `in ${r.d} days`;
        jobs.push({
          key, title: `${r.l} · ${p.title}`,
          body: `Takes place ${kata}, ${fDate(when)} at ${fTime(when)}${p.place ? `, ${p.place}` : ""}.`,
          url: "./#programs",
        });
      }
    }

    for (const c of checklist) {
      if (c.done || !c.due_at) continue;
      const key = `${c.program_id}:${c.id}:due`;
      if (sentKeys.has(key)) continue;
      const due = new Date(c.due_at);
      const fire = fireAt(due, 1).getTime();
      if (fire > now || now - fire > MAX_AGE) continue;
      const prog = programs.find((p: any) => p.id === c.program_id);
      const pic: any = memberById.get(c.member_id);
      jobs.push({
        key, title: `Deadline tomorrow · ${prog ? prog.title : "Program"}`,
        body: `"${c.text}" is due ${fDate(due)} at ${fTime(due)}. PIC: ${pic ? pic.name : "-"}.`,
        url: "./#programs",
      });
    }

    for (const mt of meetings) {
      const when = new Date(mt.held_at);
      if (when.getTime() < now) continue;
      for (const r of RULES) {
        const key = `mtg:${mt.id}:${r.l}`;
        if (sentKeys.has(key)) continue;
        const fire = fireAt(when, r.d).getTime();
        if (fire > now || now - fire > MAX_AGE) continue;
        const kata = r.d === 0 ? "today" : r.d === 1 ? "tomorrow" : `in ${r.d} days`;
        jobs.push({
          key, title: `${r.l} · ${mt.title}`,
          body: `Meeting ${kata}, ${fDate(when)} at ${fTime(when)}${mt.place ? `, ${mt.place}` : ""}.`,
          url: "./#minutes", room: mt.room,
        });
      }
    }

    if (!jobs.length) return new Response(JSON.stringify({ sent: 0, jobs: 0 }));

    /* ---------------- siapa menerima apa ---------------- */
    let labUser: string | null = null;
    try {
      const r = await fetch(`${SUPA}/rest/v1/rpc/lab_user_id`, { method: "POST", headers: hdr, body: "{}" });
      if (r.ok) labUser = await r.json();
    } catch (_) { /* fungsi belum ada: akun lab dilewati untuk pengingat rapat */ }

    const roomsOf = (userId: string): string[] => {
      if (labUser && userId === labUser) return ["koorinti", "hr", "medpart", "sg", "rnd"];
      const prof = profiles.find((p: any) => p.user_id === userId);
      if (!prof) return [];
      const m: any = memberById.get(prof.member_id);
      if (!m) return [];
      const own = ROOM_OF_DIV[m.div];
      const out: string[] = [];
      if (m.level === "inti") out.push("koorinti");
      if (own) out.push(own);
      return out;
    };
    const approved = (userId: string) =>
      (labUser && userId === labUser) || profiles.some((p: any) => p.user_id === userId);

    /* ---------------- kirim ---------------- */
    let sent = 0, gone = 0;
    const done: string[] = [];

    for (const job of jobs) {
      let any = false;
      for (const s of subs) {
        if (!approved(s.user_id)) continue;
        if (job.room && !roomsOf(s.user_id).includes(job.room)) continue;

        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: job.title, body: job.body, url: job.url, tag: job.key }),
            { TTL: 6 * 60 * 60 },
          );
          sent++; any = true;
        } catch (e: any) {
          const code = e?.statusCode;
          if (code === 404 || code === 410) {
            /* perangkat sudah mencabut izin atau menghapus aplikasi */
            gone++;
            await api(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }).catch(() => {});
          } else {
            console.error("push gagal", code, e?.body || e?.message);
          }
        }
      }
      if (any) done.push(job.key);
    }

    if (done.length) {
      await api("push_log", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(done.map((k) => ({ notif_key: k }))),
      }).catch((e) => console.error("push_log", e.message));
    }

    return new Response(JSON.stringify({ jobs: jobs.length, sent, gone, logged: done.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
  }
});
