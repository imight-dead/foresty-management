/* =====================================================================
   FORESTY MANAGEMENT — aplikasi internal Foresty Laboratory 26/27
   Data & autentikasi: Supabase. Aturan siapa boleh apa ditegakkan di
   server lewat Row Level Security (lihat db/02_rls.sql), bukan di sini.
   ===================================================================== */

const CFG = window.FORESTY_CONFIG || {};
const LAB_EMAIL = (CFG.LAB_EMAIL || "forestylab@gmail.com").toLowerCase();

const $ = (s, r = document) => r.querySelector(s);

if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("xxxxxxxx")) {
  document.body.innerHTML =
    '<div style="padding:40px;font-family:monospace;color:#fff;background:#050505;min-height:100vh">' +
    '<h1 style="color:#E4181A">Configuration not set</h1>' +
    '<p>Copy <code>config.example.js</code> to <code>config.js</code>, ' +
    'then fill in SUPABASE_URL and SUPABASE_ANON_KEY from Supabase → Project Settings → API.</p></div>';
  throw new Error("config.js has not been filled in");
}

/* Link reset password dari email kembali ke sini dengan type=recovery di
   URL (atau error_description kalau linknya kedaluwarsa). Dicatat sebelum
   Supabase membersihkan URL-nya. */
const AUTH_URL = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
let recovering = AUTH_URL.get("type") === "recovery";
let linkErr = AUTH_URL.get("error_description") ? "That reset link has expired or was already used. Request a new one below." : "";
if (linkErr) history.replaceState(null, "", location.pathname);

const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") recovering = true; });

/* ---------------------------------------------------------------- utilitas */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ini = n => String(n).split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const MO = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const fDate  = d => `${d.getDate()} ${MO[d.getMonth()]} ${d.getFullYear()}`;
const fShort = d => `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
const fTime  = d => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
const key    = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const STATUS_LABEL = { ongoing:"Ongoing", completed:"Completed", soon:"Coming Soon" };
const ST_LABEL = { todo:"To Do", doing:"In Progress", done:"Done" };
const LEVEL_LABEL = { inti:"Full Access", staff:"Limited Access" };

let toastT;
function toast(msg, bad) {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle("bad", !!bad);
  el.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("on"), 3000);
}
const fail = (e, what) => { console.error(what, e); toast((e?.message || what) + "", true); };

/* ---------------------------------------------------------------- data */
let MEMBERS = [], DIVISIONS = [], PROGRAMS = [], MEETINGS = [], NREAD = new Set();
let ME = null;   // {user, profile, member, level, isLab}

const byId = id => MEMBERS.find(m => m.id === id);
const prog = id => PROGRAMS.find(p => p.id === id);
const myId = () => ME?.member?.id || null;
const isLab = () => !!ME?.isLab;
const canAll = () => isLab() || ME?.level === "inti";
const canCheck = c => canAll() || c.who === myId();
const canTask = mid => canAll() || mid === myId();

/* Teks tampilan divisi ditetapkan di sini, bukan dibaca dari database,
   supaya data lama yang masih berbahasa Indonesia tetap tampil Inggris.
   Divisi baru yang tidak ada di daftar ini memakai tagline dari database. */
const DIV_LABEL = { "Pengurus Inti": "Core Committee", "Sekretariat": "Secretariat" };
const TAGLINE = {
  d1: "Lab leadership, cross-division coordination, and accountability for the term.",
  d2: "Administration, records, and every rupiah that moves through the lab.",
  d3: "Recruitment, development, and the wellbeing of lab members.",
  d4: "Visual identity, publications, documentation, and partner relations.",
  d5: "Routine technical training: internal classes, CTF practice, and the assistant curriculum.",
  d6: "Digital forensics research, network security, and in-house tooling.",
};

async function loadAll() {
  const [mem, div, dmem, tsk, prg, pic, chk, log, nrd, mtg, due] = await Promise.all([
    sb.from("members").select("*").order("sort"),
    sb.from("divisions").select("*").order("sort"),
    sb.from("division_members").select("*").order("sort"),
    sb.from("tasks").select("*").order("sort").order("created_at"),
    sb.from("programs").select("*").order("starts_at"),
    sb.from("program_pics").select("*").order("sort"),
    sb.from("checklist").select("*").order("sort").order("created_at"),
    sb.from("activity_log").select("*").order("created_at", { ascending: false }),
    sb.from("notif_read").select("notif_key"),
    sb.from("meetings").select("*").order("held_at", { ascending: false }),
    sb.from("tasks").select("due_at").limit(1),
  ]);
  for (const r of [mem, div, dmem, tsk, prg, pic, chk, log, nrd])
    if (r.error) throw r.error;

  MEMBERS = mem.data.map(m => ({ ...m, div: DIV_LABEL[m.div] || m.div }));

  DIVISIONS = div.data.map(d => ({
    id: d.id, name: d.name, tagline: TAGLINE[d.id] || d.tagline,
    people: dmem.data.filter(x => x.division_id === d.id).map(x => ({
      m: x.member_id,
      tasks: tsk.data.filter(t => t.division_id === d.id && t.member_id === x.member_id),
    })),
  }));

  PROGRAMS = prg.data.map(p => ({
    id: p.id, title: p.title, status: p.status, place: p.place, desc: p.descr,
    date: new Date(p.starts_at),
    pics: pic.data.filter(x => x.program_id === p.id).map(x => x.member_id),
    checklist: chk.data.filter(c => c.program_id === p.id).map(c => ({
      id: c.id, text: c.text, who: c.member_id, done: c.done,
      due: c.due_at ? new Date(c.due_at) : null,
    })),
    log: log.data.filter(l => l.program_id === p.id).slice(0, 8)
      .map(l => ({ t: new Date(l.created_at), s: l.text })),
  }));

  NREAD = new Set(nrd.data.map(r => r.notif_key));

  /* Tabel meetings baru ada setelah db/06_notulen.sql dijalankan.
     Selama belum, menu Notulen tampil kosong, sisanya tetap jalan. */
  MEETINGS = mtg.error ? [] : mtg.data.map(m => ({ ...m, held: new Date(m.held_at) }));
  meetingsReady = !mtg.error;

  /* Kolom tasks.due_at baru ada setelah db/10_task_deadline.sql dijalankan.
     Selama belum, isian tenggat disembunyikan, sisanya tetap jalan. */
  taskDueReady = !due.error;
}

/* menulis jejak perubahan; gagal pun tidak membatalkan aksi utama */
const writeLog = (pid, text) =>
  sb.from("activity_log").insert({ program_id: pid, actor: ME.user.id, text }).then(() => {}, () => {});

/* ---------------------------------------------------------------- aksi */
async function toggleCheck(pid, cid) {
  const p = prog(pid), c = p.checklist.find(x => x.id === cid);
  if (!canCheck(c)) return toast("Only this item's PIC or a core officer can change it.", true);
  const next = !c.done;
  c.done = next;                                    // tampilkan dulu, sinkronkan sesudahnya
  rerender();
  const { error } = await sb.from("checklist").update({
    done: next, done_by: next ? ME.user.id : null, done_at: next ? new Date().toISOString() : null,
  }).eq("id", cid);
  if (error) { c.done = !next; rerender(); return fail(error, "Could not save that tick"); }
  writeLog(pid, `${ME.member?.name || "Lab account"} marked "${c.text}" as ${next ? "done" : "not done"}`);
}

async function cycleTask(did, mid, tid) {
  if (!canTask(mid)) return toast("You can only change tasks assigned to you.", true);
  const d = DIVISIONS.find(x => x.id === did);
  const t = d.people.find(x => x.m === mid).tasks.find(x => x.id === tid);
  const order = ["todo", "doing", "done"];
  const prev = t.status;
  t.status = order[(order.indexOf(prev) + 1) % 3];
  rerender();
  const { error } = await sb.from("tasks").update({ status: t.status }).eq("id", tid);
  if (error) { t.status = prev; rerender(); fail(error, "Could not save the task status"); }
}

async function addCheck(pid, text, who) {
  const { data, error } = await sb.from("checklist")
    .insert({ program_id: pid, text, member_id: who, created_by: ME.user.id })
    .select().single();
  if (error) return fail(error, "Could not add the item");
  prog(pid).checklist.push({ id: data.id, text: data.text, who: data.member_id, done: false, due: null });
  writeLog(pid, `${ME.member?.name || "Lab account"} added the item "${text}"`);
  rerender();
  toast("Checklist item added.");
}

async function addTask(did, mid, text, due) {
  if (!canTask(mid)) return toast("You can only add tasks under your own name.", true);
  const row = { division_id: did, member_id: mid, text, created_by: ME.user.id };
  if (due) row.due_at = due.toISOString();
  const { data, error } = await sb.from("tasks").insert(row).select().single();
  if (error) return fail(error, "Could not add the task");
  DIVISIONS.find(x => x.id === did).people.find(x => x.m === mid).tasks.push(data);
  rerender();
  toast(due ? `Task added, due ${fDate(due)} at ${fTime(due)}.` : "Task added.");
}

/* due = null menghapus tenggat */
async function setTaskDue(did, mid, tid, due) {
  if (!canTask(mid)) return toast("You can only change tasks assigned to you.", true);
  const t = DIVISIONS.find(x => x.id === did).people.find(x => x.m === mid).tasks.find(x => x.id === tid);
  const prev = t.due_at;
  t.due_at = due ? due.toISOString() : null;
  dueEdit = null;
  rerender();
  const { error } = await sb.from("tasks").update({ due_at: t.due_at }).eq("id", tid);
  if (error) { t.due_at = prev; rerender(); return fail(error, "Could not save the deadline"); }
  toast(due ? `Deadline set to ${fDate(due)} at ${fTime(due)}.` : "Deadline removed.");
}

/* Tanggal wajib, jam boleh kosong — tanpa jam, tenggatnya akhir hari itu. */
function readDue(f) {
  if (!f.tgl || !f.tgl.value) return null;
  return new Date(`${f.tgl.value}T${f.jam.value || "23:59"}`);
}

async function markRead(keys) {
  const baru = keys.filter(k => !NREAD.has(k));
  if (!baru.length) return;
  baru.forEach(k => NREAD.add(k));
  rerender();
  const { error } = await sb.from("notif_read")
    .upsert(baru.map(k => ({ user_id: ME.user.id, notif_key: k })), { onConflict: "user_id,notif_key" });
  if (error) fail(error, "Could not save the read status");
}

/* ---------------------------------------------------------------- push */
/* Notifikasi perangkat: izin diminta sekali, langganan disimpan di
   Supabase, lalu server yang mengirim pengingat lewat Web Push — bekerja
   walaupun aplikasinya sedang tidak dibuka. */

let PUSH = { supported: false, permission: "default", on: false, busy: false, reg: null, err: null };

const pushCapable = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlB64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function initPush() {
  PUSH.supported = pushCapable();
  if (!PUSH.supported) return;
  PUSH.permission = Notification.permission;
  try {
    PUSH.reg = await navigator.serviceWorker.register("sw.js");
    const sub = await PUSH.reg.pushManager.getSubscription();
    PUSH.on = !!sub && PUSH.permission === "granted";
    if (sub && PUSH.on) await storeSub(sub);    /* pastikan baris server masih ada */
  } catch (e) {
    PUSH.err = e.message;
    console.error("service worker", e);
  }
  render();
}

async function storeSub(sub) {
  const j = sub.toJSON();
  const { error } = await sb.from("push_subs").upsert({
    endpoint: sub.endpoint,
    user_id: ME.user.id,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

async function enablePush() {
  if (!CFG.VAPID_PUBLIC_KEY || CFG.VAPID_PUBLIC_KEY.startsWith("PASTE")) {
    return toast("VAPID_PUBLIC_KEY has not been set in config.js.", true);
  }
  PUSH.busy = true; render();
  try {
    const perm = await Notification.requestPermission();
    PUSH.permission = perm;
    if (perm !== "granted") {
      PUSH.busy = false; render();
      return toast(perm === "denied"
        ? "Notifications are blocked. Allow them in your browser settings for this site."
        : "Notification permission was not granted.", true);
    }
    if (!PUSH.reg) PUSH.reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;

    const sub = await PUSH.reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(CFG.VAPID_PUBLIC_KEY),
    });
    await storeSub(sub);
    PUSH.on = true;
    toast("Device notifications are on.");
  } catch (e) {
    PUSH.err = e.message;
    fail(e, "Could not turn on notifications");
  }
  PUSH.busy = false; render();
}

async function disablePush() {
  PUSH.busy = true; render();
  try {
    const sub = PUSH.reg && await PUSH.reg.pushManager.getSubscription();
    if (sub) {
      await sb.from("push_subs").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    PUSH.on = false;
    toast("Device notifications are off on this device.");
  } catch (e) {
    fail(e, "Could not turn off notifications");
  }
  PUSH.busy = false; render();
}

function pushPanel() {
  if (!PUSH.supported) {
    return `<div class="pushbar off">
      <div><div class="label">Device Notifications</div>
      <div class="meta" style="margin-top:4px">This browser cannot receive push notifications. On iPhone, add this app to the Home Screen first, then open it from there.</div></div>
    </div>`;
  }
  if (PUSH.permission === "denied") {
    return `<div class="pushbar off">
      <div><div class="label">Device Notifications</div>
      <div class="meta" style="margin-top:4px">Blocked for this site. Allow notifications in your browser settings, then reload.</div></div>
    </div>`;
  }
  return `<div class="pushbar${PUSH.on ? " on" : ""}">
      <div style="flex:1;min-width:200px">
        <div class="label">Device Notifications ${PUSH.on ? '<span class="tag t-completed" style="margin-left:6px">On</span>' : '<span class="tag t-soon" style="margin-left:6px">Off</span>'}</div>
        <div class="meta" style="margin-top:4px">${PUSH.on
          ? "This device receives H-3, H-1, and same-day reminders for programs and meetings, plus your division's task deadlines, even when the app is closed."
          : "Turn this on to get program and meeting reminders on this phone or laptop."}</div>
      </div>
      <button class="btn${PUSH.on ? " ghost" : ""}" data-push="${PUSH.on ? "off" : "on"}"${PUSH.busy ? " disabled" : ""}>
        ${PUSH.busy ? "Working…" : PUSH.on ? "Turn Off" : "Turn On Notifications"}
      </button>
    </div>`;
}

/* ---------------------------------------------------------------- notulen */
let meetingsReady = true;
let taskDueReady = true;
let dueEdit = null;   // id tugas yang isian tenggatnya sedang terbuka
const taskDue = t => t.due_at ? new Date(t.due_at) : null;

/* Divisi yang tenggat tugasnya masuk kalender saya: divisi tempat saya
   terdaftar. Akun lab tidak punya divisi, jadi melihat semuanya. */
const myDivisions = () => isLab() ? DIVISIONS : DIVISIONS.filter(d => d.people.some(p => p.m === myId()));

const ROOMS = [
  { id: "koorinti", label: "Core Committee Meeting",        short: "Core" },
  { id: "hr",       label: "HR Division Meeting",           short: "HR",              div: "Human Resource" },
  { id: "medpart",  label: "Media & Partner Meeting",       short: "Media & Partner", div: "Media & Partner" },
  { id: "sg",       label: "Study Group Meeting",           short: "Study Group",     div: "Study Group" },
  { id: "rnd",      label: "RnD Division Meeting",          short: "RnD",             div: "Research & Development" },
];
const room = id => ROOMS.find(r => r.id === id);

/* Koordinator divisi ikut Koorinti dan ruang divisinya. Ketua, wakil,
   sekretaris, dan bendahara hanya Koorinti. Staff hanya ruang divisinya. */
function myRooms() {
  if (isLab()) return ROOMS.map(r => r.id);
  const m = ME?.member;
  if (!m) return [];
  const sendiri = ROOMS.find(r => r.div === m.div)?.id;
  const out = [];
  if (m.level === "inti") out.push("koorinti");
  if (sendiri) out.push(sendiri);
  return out;
}
const canWriteMinute = mt => canAll() || mt.created_by === ME?.user?.id;

/* ---------------------------------------------------------------- turunan */
const progress = p => {
  const done = p.checklist.filter(c => c.done).length;
  const total = p.checklist.length;
  return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
};

const RULES = [{ d: 3, l: "H-3" }, { d: 1, l: "H-1" }, { d: 0, l: "H-0" }];
function buildNotifs() {
  const now = new Date(), out = [];
  for (const p of PROGRAMS) {
    if (p.status === "completed") continue;
    for (const r of RULES) {
      const fire = new Date(p.date); fire.setDate(fire.getDate() - r.d); fire.setHours(7, 0, 0, 0);
      if (fire > now) continue;
      const kata = r.d === 0 ? "today" : r.d === 1 ? "tomorrow" : `in ${r.d} days`;
      out.push({
        id: `${p.id}:${r.l}`, trig: r.l, fire, pid: p.id, kind: "event",
        text: `Reminder: <b>${esc(p.title)}</b> takes place ${kata}, ${fDate(p.date)} at ${fTime(p.date)}, ${esc(p.place)}.`,
      });
    }
    for (const c of p.checklist) {
      if (!c.due || c.done) continue;
      const fire = new Date(c.due); fire.setDate(fire.getDate() - 1); fire.setHours(7, 0, 0, 0);
      if (fire > now) continue;
      const late = c.due < now, pic = byId(c.who);
      out.push({
        id: `${p.id}:${c.id}:due`, trig: late ? "OVERDUE" : "H-1", fire, pid: p.id, kind: "task",
        text: late
          ? `Overdue: checklist item <b>${esc(c.text)}</b> on ${esc(p.title)} passed its due date ${fDate(c.due)} at ${fTime(c.due)}. PIC: ${esc(pic?.name || "-")}.`
          : `Due tomorrow: checklist item <b>${esc(c.text)}</b> on ${esc(p.title)} is due ${fDate(c.due)} at ${fTime(c.due)}. PIC: ${esc(pic?.name || "-")}.`,
      });
    }
  }
  /* Tenggat tugas divisi: hanya divisi saya (akun lab: semua), sama dengan
     kalender. H-1 dan hari-H pukul 07.00, lalu "Overdue" setelah lewat.
     Kuncinya sama dengan yang dipakai push-send. */
  for (const d of myDivisions())
    for (const p of d.people)
      for (const t of p.tasks) {
        const due = taskDue(t);
        if (!due || t.status === "done") continue;
        const late = due < now, who = esc(byId(p.m)?.name || "-");
        for (const r of late ? [] : [{ d: 1, l: "H-1" }, { d: 0, l: "H-0" }]) {
          const fire = new Date(due); fire.setDate(fire.getDate() - r.d); fire.setHours(7, 0, 0, 0);
          if (fire > now || (r.d === 0 && fire >= due)) continue;
          out.push({
            id: `task:${t.id}:${t.due_at}:${r.l}`, trig: r.l, fire, did: d.id, kind: "task",
            text: `Due ${r.d ? "tomorrow" : "today"}: division task <b>${esc(t.text)}</b>, ${fDate(due)} at ${fTime(due)}. ${esc(d.name)} · ${who}.`,
          });
        }
        if (late) out.push({
          id: `task:${t.id}:${t.due_at}:late`, trig: "OVERDUE", fire: due, did: d.id, kind: "task",
          text: `Overdue: division task <b>${esc(t.text)}</b> passed its deadline ${fDate(due)} at ${fTime(due)}. ${esc(d.name)} · ${who}.`,
        });
      }
  for (const mt of MEETINGS) {
    for (const r of RULES) {
      const fire = new Date(mt.held); fire.setDate(fire.getDate() - r.d); fire.setHours(7, 0, 0, 0);
      if (fire > now || mt.held < now) continue;
      const kata = r.d === 0 ? "today" : r.d === 1 ? "tomorrow" : `in ${r.d} days`;
      out.push({
        id: `mtg:${mt.id}:${r.l}`, trig: r.l, fire, mid: mt.id, kind: "meeting",
        text: `Reminder: <b>${esc(mt.title)}</b> takes place ${kata}, ${fDate(mt.held)} at ${fTime(mt.held)}${mt.place ? ", " + esc(mt.place) : ""}.`,
      });
    }
  }
  return out.sort((a, b) => b.fire - a.fire);
}
const unreadCount = () => buildNotifs().filter(n => !NREAD.has(n.id)).length;

function allEvents() {
  const now = new Date();
  const ev = PROGRAMS.map(p => ({ when: p.date, title: p.title, pid: p.id, type: p.status, sub: p.place }));
  /* Rapat hanya dari ruang yang jadi hak saya (lihat myRooms). RLS di
     06_notulen.sql sudah menyaringnya; ini menegaskannya di kalender. */
  const rooms = myRooms();
  MEETINGS.filter(m => rooms.includes(m.room)).forEach(m => ev.push({
    when: m.held, title: m.title, mid: m.id,
    type: m.held < now ? "completed" : "ongoing",
    sub: `${room(m.room).label}${m.place ? " · " + m.place : ""}`,
  }));
  for (const p of PROGRAMS)
    for (const c of p.checklist)
      if (c.due) ev.push({
        when: c.due, title: `Deadline: ${c.text}`, pid: p.id,
        type: c.done ? "completed" : "ongoing",
        sub: `${p.title} · PIC ${byId(c.who)?.name || "-"}`,
      });
  for (const d of myDivisions())
    for (const p of d.people)
      for (const t of p.tasks) {
        const due = taskDue(t);
        if (due) ev.push({
          when: due, title: `Task: ${t.text}`, did: d.id,
          type: t.status === "done" ? "completed" : "ongoing",
          sub: `${d.name} · ${byId(p.m)?.name || "-"}`,
        });
      }
  return ev.sort((a, b) => a.when - b.when);
}

/* ke mana sebuah agenda dibuka saat diklik */
const evAttr = e => e.mid ? `data-minute="${e.mid}"` : e.did ? `data-open-div="${e.did}"` : `data-open-prog="${e.pid}"`;

/* ---------------------------------------------------------------- fragmen */
const tag = s => `<span class="tag t-${s === "soon" ? "soon" : s}">${s === "ongoing" ? '<i class="dot pulse"></i>' : ""}${STATUS_LABEL[s]}</span>`;
const avatars = ids => `<div class="avs">${ids.map(i => `<span class="av-s" title="${esc(byId(i)?.name || "")}">${ini(byId(i)?.name || "?")}</span>`).join("")}</div>`;

function countdown(d) {
  return `<div class="cd num" data-ts="${d.getTime()}">
    <span data-u="d">--<b>Days</b></span><span data-u="h">--<b>Hrs</b></span><span data-u="m">--<b>Min</b></span><span data-u="s">--<b>Sec</b></span></div>`;
}
function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll(".cd[data-ts]").forEach(el => {
    let ms = +el.dataset.ts - now;
    const past = ms < 0; ms = Math.abs(ms);
    const v = { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60 };
    el.querySelectorAll("span[data-u]").forEach(x => { x.firstChild.nodeValue = String(v[x.dataset.u]).padStart(2, "0"); });
    el.classList.toggle("past", past);
    el.classList.toggle("urgent", !past && v.d < 2);
  });
}
setInterval(tickCountdowns, 1000);

function cdShort(d) {
  const ms = d - new Date();
  if (ms < 0) return Math.ceil(-ms / 864e5) + " days ago";
  const days = Math.ceil(ms / 864e5);
  return days <= 1 ? "Less than 24 hours" : "T-" + String(days).padStart(2, "0") + " days";
}

function stat(label, value, mod, sub) {
  return `<div class="stat ${mod}">
    <svg class="fp2" aria-hidden="true"><use href="#ic-fp"/></svg>
    <div class="label">${label}</div>
    <div class="v num">${String(value).padStart(2, "0")}</div>
    <div class="meta" style="margin-top:6px">${sub}</div>
  </div>`;
}

/* ---------------------------------------------------------------- modal */
let CURRENT = null;
function openModal(html) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="scrim" role="dialog" aria-modal="true">
    <div class="modal">
      <button class="close" data-close aria-label="Tutup">
        <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none"><path d="M5 5l14 14M19 5L5 19"/></svg>
      </button>${html}
    </div></div>`;
  root.querySelector(".scrim").addEventListener("click", e => { if (e.target.classList.contains("scrim")) closeModal(); });
  root.querySelector("[data-close]").addEventListener("click", closeModal);
  document.body.style.overflow = "hidden";
  tickCountdowns();
}
function closeModal() { $("#modalRoot").innerHTML = ""; document.body.style.overflow = ""; CURRENT = null; }
const modalHTML = (kind, id) =>
  kind === "prog" ? modalProgram(id)
  : kind === "div" ? modalDivision(id)
  : kind === "form" ? modalProgramForm(id)
  : kind === "minute" ? modalMinute(id)
  : kind === "mform" ? modalMinuteForm(id)
  : modalMember(id);
function showModal(kind, id) {
  CURRENT = { kind, id };
  openModal(modalHTML(kind, id));
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* render ulang halaman DAN isi modal yang sedang terbuka, dari data terbaru */
function rerender() {
  const open = CURRENT;
  render();
  /* form tidak digambar ulang, supaya isian yang sedang diketik tidak hilang */
  const jangan = ["form", "mform", "minute"];   /* ada isian yang sedang diketik */
  if (open) { CURRENT = open; if (!jangan.includes(open.kind)) openModal(modalHTML(open.kind, open.id)); }
  tickCountdowns();
}

/* ---------------------------------------------------------------- menu */
const MENU = [
  { id:"dashboard",    label:"Dashboard",    icon:'<path d="M3 12h6v9H3zM15 3h6v18h-6zM9 8h6v13H9z"/>' },
  { id:"programs",     label:"Programs",     icon:'<path d="M4 4h16v16H4z"/><path d="M8 10h8M8 14h5"/>' },
  { id:"division",     label:"Division",     icon:'<circle cx="12" cy="7" r="3"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><path d="M12 10v4M7 15l4-2M17 15l-4-2"/>' },
  { id:"minutes",      label:"Meeting",      icon:'<path d="M5 3h11l3 3v15H5z"/><path d="M9 9h7M9 13h7M9 17h4"/>' },
  { id:"foresty",      label:"Foresty 26/27",icon:'<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 7h5M16 11h5M16 15h3"/>' },
  { id:"notification", label:"Notification", icon:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>' },
];

/* Inbox dan Approval hanya untuk akun lab. Keduanya tidak muncul di sidebar
   akun lain, dan rute-nya ditolak kalau alamatnya diketik manual. */
const LAB_MENU = [
  { id:"inbox",    label:"Inbox",    icon:'<path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/>' },
  { id:"approval", label:"Approval", icon:'<path d="M4 12l5 5L20 6"/><path d="M4 5h9"/>' },
];
const visibleMenu = () => isLab() ? MENU.concat(LAB_MENU) : MENU;

let route = "dashboard";
function go(r) {
  route = r; location.hash = r; render(); window.scrollTo({ top: 0 });
  $("#sidebar").classList.remove("open");
  const sc = $("#sideScrim"); if (sc) sc.hidden = true;
}
window.addEventListener("hashchange", () => {
  const r = location.hash.replace("#", "");
  if (r && r !== route && visibleMenu().some(m => m.id === r)) { route = r; render(); }
});

/* ---------------------------------------------------------------- DASHBOARD */
const _t0 = new Date();
let calCursor = new Date(_t0.getFullYear(), _t0.getMonth(), 1);
let calSel = null;

function heroBlock(title, lead) {
  const now = new Date();
  return `<section class="hero">
    <div class="dots"></div><div class="scan"></div><div class="sweep"></div>
    <svg class="fp" aria-hidden="true"><use href="#ic-fp"/></svg>
    <div class="hero-in">
      <div>
        <div class="kick">Foresty Laboratory · Term 2026 / 2027</div>
        <h1>${esc(title)}<span class="cursor"></span></h1>
        <p class="lead">${lead}</p>
      </div>
      <div class="hero-clock">
        <div class="label">System Time</div>
        <div class="t num" id="clock">${fTime(now)}</div>
        <div class="meta" style="justify-content:flex-end">${DW[now.getDay()]}, ${fDate(now)}</div>
      </div>
    </div>
  </section>`;
}

function viewDashboard() {
  const now = new Date();
  const upcoming = allEvents().filter(e => e.when >= new Date(now.getFullYear(), now.getMonth(), now.getDate())).slice(0, 6);
  const ongoing = PROGRAMS.filter(p => p.status === "ongoing").length;
  const openTasks = PROGRAMS.filter(p => p.status !== "completed")
    .reduce((n, p) => n + p.checklist.filter(c => !c.done).length, 0);
  const unread = unreadCount();

  const rows = upcoming.map((e, i) => `
    <button class="dl-row" ${evAttr(e)}>
      <span class="idx num">${String(i + 1).padStart(2, "0")}</span>
      <span class="nm"><b>${esc(e.title)}</b><span class="meta">${esc(e.sub)} · ${fShort(e.when)} · ${fTime(e.when)}</span></span>
      ${countdown(e.when)}
    </button>`).join("") || `<div class="empty">No upcoming agenda.</div>`;

  const sapaan = ME.isLab ? "Lab Account" : ME.member.name.split(" ")[0];

  return heroBlock("Operations Console",
    `Hello, ${esc(sapaan)}. Control centre for work programs, division assignments, and the Foresty Laboratory agenda.`) + `
    <div class="grid g-sum" style="margin-bottom:22px">
      ${stat("Ongoing Programs", ongoing, "red", "of " + PROGRAMS.length + " programs in total")}
      ${stat("Open Checklist Items", openTasks, "", "across active programs")}
      ${stat("Unread Notifications", unread, unread ? "red" : "ok", "H-3 / H-1 / H-0 triggers")}
      ${stat("Registered Members", MEMBERS.length, "", DIVISIONS.length + " committee divisions")}
    </div>
    <div class="dash">
      <section class="card">
        <div class="sec-head"><div><div class="kick">Timeline</div><h2>Upcoming Deadlines &amp; Events</h2></div></div>
        <div class="rule" style="margin:12px 0 6px"></div>
        <div class="dl">${rows}</div>
      </section>
      <section class="card">
        <div class="sec-head"><div><div class="kick">Calendar</div><h2>Monthly Agenda</h2></div></div>
        <div class="rule" style="margin:12px 0 14px"></div>
        ${calendar()}
      </section>
    </div>`;
}

function calendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  const first = new Date(y, m, 1), start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const today = key(new Date()), map = {};
  allEvents().forEach(e => { (map[key(e.when)] = map[key(e.when)] || []).push(e); });

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = key(d), evs = map[k] || [];
    cells += `<button class="day${d.getMonth() !== m ? " out" : ""}${k === today ? " today" : ""}${k === calSel ? " sel" : ""}" data-day="${k}">
      <span class="num">${String(d.getDate()).padStart(2, "0")}</span>
      ${evs.length ? `<span class="marks">${evs.slice(0, 4).map(e => `<i class="${e.type === "completed" ? "ok" : e.type === "soon" ? "soon" : ""}"></i>`).join("")}</span>` : ""}
    </button>`;
  }
  const sel = calSel ? (map[calSel] || []) : [];
  const selDate = calSel ? new Date(calSel + "T00:00") : null;
  const detail = calSel ? `<div class="day-detail">
      <div class="label" style="margin-bottom:6px">${DW[selDate.getDay()]}, ${fDate(selDate)}</div>
      ${sel.length ? sel.map(e => `<button class="ev" ${evAttr(e)}>
          <i class="dot" style="margin-top:7px;background:${e.type === "completed" ? "var(--ok)" : e.type === "soon" ? "var(--dim)" : "var(--red)"}"></i>
          <span><span class="evn" style="font-size:12.5px">${esc(e.title)}</span>
          <span class="meta">${fTime(e.when)} · ${esc(e.sub)}</span></span></button>`).join("")
        : `<div class="meta">No agenda on this date.</div>`}
    </div>` : `<div class="day-detail"><div class="meta">Select a date to see its agenda.</div></div>`;

  return `<div class="cal-head">
      <span class="mo">${MO[m]} ${y}</span>
      <button class="cal-nav" data-cal="-1" aria-label="Previous month">&lt;</button>
      <button class="cal-nav" data-cal="0" aria-label="This month">•</button>
      <button class="cal-nav" data-cal="1" aria-label="Next month">&gt;</button>
    </div>
    <div class="cal">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<span class="dow">${d}</span>`).join("")}${cells}</div>
    ${detail}`;
}

/* ---------------------------------------------------------------- PROGRAMS */
let progTab = "ongoing";
function viewPrograms() {
  const count = s => PROGRAMS.filter(p => p.status === s).length;
  const cards = PROGRAMS.filter(p => p.status === progTab).map(p => {
    const pr = progress(p);
    return `<button class="card click" data-open-prog="${p.id}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        ${tag(p.status)}<span class="meta num">${fShort(p.date)}</span>
      </div>
      <h3 style="margin:11px 0 6px">${esc(p.title)}</h3>
      <div class="meta" style="margin-bottom:12px">${esc(p.place)} · ${fTime(p.date)} WIB</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span class="label">Checklist</span>
        <span class="num" style="font-size:11px;color:${pr.pct === 100 ? "var(--ok)" : "var(--red)"}">${pr.done}/${pr.total} · ${pr.pct}%</span>
      </div>
      <div class="bar${pr.pct === 100 ? " done" : ""}"><i style="width:${pr.pct}%"></i></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:13px">
        ${avatars(p.pics)}
        ${p.status === "completed" ? '<span class="meta">Completed</span>' : `<span class="meta num">${cdShort(p.date)}</span>`}
      </div>
    </button>`;
  }).join("") || `<div class="empty">No programs in this category.</div>`;

  return `<div class="sec-head" style="justify-content:space-between">
      <div><div class="kick">Work Programs</div><h1>Programs</h1>
      <p class="sec-sub">Every laboratory work program for the 26/27 term.</p></div>
      ${canAll() ? `<button class="btn" data-newprog>+ New Program</button>` : ""}
    </div>
    <div class="rule"></div>
    <div class="tabs">
      ${["ongoing","completed","soon"].map(s => `<button class="tab${progTab === s ? " on" : ""}" data-tab="${s}">${STATUS_LABEL[s]} <span class="n">${String(count(s)).padStart(2, "0")}</span></button>`).join("")}
    </div>
    <div class="grid g3">${cards}</div>`;
}

function modalProgram(pid) {
  const p = prog(pid), pr = progress(p);
  const items = p.checklist.map(c => {
    const late = c.due && !c.done && c.due < new Date();
    const pic = byId(c.who);
    return `<button class="chk${c.done ? " on" : ""}${canCheck(c) ? "" : " locked"}" data-check="${p.id}|${c.id}">
      <span class="box"><svg viewBox="0 0 24 24"><path d="M4 12l6 6L20 5"/></svg></span>
      <span><span class="t">${esc(c.text)}</span>
      <span class="who">PIC ${esc(pic?.name || "-")}${c.due ? ` · due ${fShort(c.due)} ${fTime(c.due)}` : ""}
      ${late ? '<span class="tag t-over" style="margin-left:6px">Overdue</span>' : ""}</span></span>
    </button>`;
  }).join("");

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        ${tag(p.status)}
        <h2 style="margin:10px 0 6px">${esc(p.title)}</h2>
        <div class="meta">${DW[p.date.getDay()]}, ${fDate(p.date)} · ${fTime(p.date)} WIB · ${esc(p.place)}</div>
        ${p.status !== "completed" ? `<div style="margin-top:14px">${countdown(p.date)}</div>` : ""}
        ${canAll() ? `<div style="margin-top:14px"><button class="btn ghost sm" data-editprog="${p.id}">Edit Program</button></div>` : ""}
      </div>
    </div>
    <div class="modal-body">
      <p style="margin:0;font-size:12.5px;color:var(--muted);max-width:70ch">${esc(p.desc)}</p>
      <div class="cols">
        <div class="pane">
          <div class="label" style="margin-bottom:9px">Person in Charge</div>
          <div class="stack">${p.pics.map(id => {
            const m = byId(id); if (!m) return "";
            return `<button class="person" data-open-member="${id}" style="width:100%;text-align:left">
              <span class="av">${ini(m.name)}</span>
              <span><span class="pn">${esc(m.name)}</span><span class="pr2">${esc(m.role)}</span></span></button>`;
          }).join("")}</div>
        </div>
        <div class="pane">
          <div class="label" style="margin-bottom:9px">Preparation Progress</div>
          <div style="display:flex;align-items:baseline;gap:8px">
            <span class="num" style="font-family:var(--disp);font-size:30px;font-weight:700;color:${pr.pct === 100 ? "var(--ok)" : "var(--red)"}">${pr.pct}%</span>
            <span class="meta">${pr.done} of ${pr.total} items done</span>
          </div>
          <div class="bar${pr.pct === 100 ? " done" : ""}" style="margin-top:9px"><i style="width:${pr.pct}%"></i></div>
          ${p.log.length ? `<div class="label" style="margin:16px 0 8px">Activity Log</div>
            <div class="log">${p.log.map(l => `<span><b>${fShort(l.t)} ${fTime(l.t)}</b> — ${esc(l.s)}</span>`).join("")}</div>` : ""}
        </div>
      </div>
      <div>
        <div class="label" style="margin-bottom:9px">Preparation Checklist</div>
        <div class="stack">${items || `<div class="empty">No checklist items yet.</div>`}</div>
        ${canAll() ? `<form class="addrow" data-addcheck="${p.id}">
            <input class="ainput" name="text" placeholder="Add a new checklist item..." required>
            <select class="ainput" name="who" style="max-width:190px">${MEMBERS.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>
            <button class="btn sm" type="submit">Add</button>
          </form>`
          : `<div class="meta" style="margin-top:10px">You can only tick items assigned to you.</div>`}
      </div>
    </div>`;
}

/* ---- form tambah / ubah program ---- */
const dInput = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tInput = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function modalProgramForm(pid) {
  const p = pid ? prog(pid) : null;
  const d = p ? p.date : new Date();
  const pics = p ? p.pics : [];

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        <div class="kick">${p ? "Edit Program" : "New Program"}</div>
        <h2 style="margin:8px 0 4px">${p ? esc(p.title) : "Add Work Program"}</h2>
        <div class="meta">Saved to the lab database and visible to everyone straight away.</div>
      </div></div>
    <div class="modal-body">
      <form class="aform" data-progform="${p ? p.id : ""}">
        <label class="afield"><span class="label">Program name</span>
          <input class="ainput" name="title" value="${p ? esc(p.title) : ""}" placeholder="Labshow PKKMB Prodi ..." required></label>

        <div class="cols" style="gap:13px">
          <label class="afield"><span class="label">Date</span>
            <input class="ainput" type="date" name="tgl" value="${dInput(d)}" required></label>
          <label class="afield"><span class="label">Time (WIB)</span>
            <input class="ainput" type="time" name="jam" value="${tInput(d)}" required></label>
          <label class="afield"><span class="label">Status</span>
            <select class="ainput" name="status">
              ${["ongoing", "soon", "completed"].map(x =>
                `<option value="${x}"${p && p.status === x ? " selected" : ""}>${STATUS_LABEL[x]}</option>`).join("")}
            </select></label>
        </div>

        <label class="afield"><span class="label">Venue</span>
          <input class="ainput" name="place" value="${p ? esc(p.place) : ""}" placeholder="Faculty Hall / Online"></label>

        <label class="afield"><span class="label">Description</span>
          <textarea class="ainput" name="descr" rows="3" placeholder="Short summary of the program">${p ? esc(p.desc) : ""}</textarea></label>

        <div class="afield">
          <span class="label">Person in Charge</span>
          <div class="picgrid">${MEMBERS.map(m => `
            <label class="picopt">
              <input type="checkbox" name="pic" value="${m.id}"${pics.includes(m.id) ? " checked" : ""}>
              <span><b>${esc(m.name)}</b><i>${esc(m.role)}</i></span>
            </label>`).join("")}</div>
          <span class="meta" style="margin-top:6px">Selected PICs appear automatically under Division and Foresty 26/27.</span>
        </div>

        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:6px">
          <button class="btn" type="submit">${p ? "Save Changes" : "Create Program"}</button>
          ${p ? `<button class="btn ghost" type="button" data-progdel="${p.id}">Delete Program</button>` : ""}
        </div>
      </form>
    </div>`;
}

async function saveProgram(pid, f) {
  const pics = [...f.querySelectorAll("input[name=pic]:checked")].map(x => x.value);
  const title = f.title.value.trim();
  if (!title) return toast("Program name is empty.", true);

  const starts = new Date(`${f.tgl.value}T${f.jam.value || "08:00"}`);
  if (isNaN(starts)) return toast("Date or time is not valid.", true);

  const body = {
    title, status: f.status.value, starts_at: starts.toISOString(),
    place: f.place.value.trim(), descr: f.descr.value.trim(),
  };

  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;

  let id = pid;
  if (pid) {
    const { error } = await sb.from("programs").update(body).eq("id", pid);
    if (error) { btn.disabled = false; return fail(error, "Could not save the program"); }
  } else {
    id = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "program")
       + "-" + Math.random().toString(36).slice(2, 6);
    const { error } = await sb.from("programs").insert({ id, ...body, sort: PROGRAMS.length + 1 });
    if (error) { btn.disabled = false; return fail(error, "Could not create the program"); }
  }

  /* PIC ditulis ulang: hapus yang lama, pasang pilihan sekarang */
  await sb.from("program_pics").delete().eq("program_id", id);
  if (pics.length) {
    const { error } = await sb.from("program_pics")
      .insert(pics.map((m, i) => ({ program_id: id, member_id: m, sort: i + 1 })));
    if (error) fail(error, "Program saved, but the PICs could not be set");
  }

  await loadAll();
  progTab = body.status;
  showModal("prog", id);
  render();
  toast(pid ? "Program updated." : "Program created.");
}

async function deleteProgram(pid) {
  const p = prog(pid);
  if (!confirm(`Delete "${p.title}" along with all its checklist items and PICs? This cannot be undone.`)) return;
  const { error } = await sb.from("programs").delete().eq("id", pid);
  if (error) return fail(error, "Could not delete the program");
  closeModal();
  await loadAll();
  render();
  toast("Program deleted.");
}

/* ---------------------------------------------------------------- DIVISION */
/* Beban satu divisi = tugas divisinya + item checklist program yang
   dipegang anggotanya. Keduanya dihitung bersama supaya angka di kartu
   cocok dengan apa yang terlihat saat kartunya dibuka. */
function divStats(d) {
  const ids = d.people.map(p => p.m);
  const tasks = d.people.flatMap(p => p.tasks);
  const items = [];
  PROGRAMS.forEach(p => p.checklist.forEach(c => { if (ids.includes(c.who)) items.push(c); }));
  const total = tasks.length + items.length;
  const done = tasks.filter(t => t.status === "done").length + items.filter(c => c.done).length;
  /* program yang dipegang divisi ini: ada anggotanya yang jadi PIC,
     atau ada item checklist atas namanya */
  const progs = PROGRAMS.filter(p =>
    p.pics.some(m => ids.includes(m)) || p.checklist.some(c => ids.includes(c.who))).length;
  return { done, total, progs, pct: total ? Math.round(done / total * 100) : 0 };
}

function viewDivision() {
  const cards = DIVISIONS.map(d => {
    const st = divStats(d);
    return `<button class="card click" data-open-div="${d.id}">
      <div class="label">Division</div>
      <h3 style="margin:6px 0 7px">${esc(d.name)}</h3>
      <p class="meta" style="min-height:34px">${esc(d.tagline)}</p>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px">
        <span class="label">Tasks &amp; Checklist</span>
        ${st.total
          ? `<span class="num" style="font-size:11px;color:${st.pct === 100 ? "var(--ok)" : "var(--red)"}">${st.done}/${st.total} · ${st.pct}%</span>`
          : `<span class="meta">none yet</span>`}
      </div>
      <div class="bar${st.pct === 100 && st.total ? " done" : ""}"><i style="width:${st.pct}%"></i></div>
      <div class="meta" style="margin-top:9px"><span class="num">${String(st.progs).padStart(2, "0")}</span> programs</div>
      <div style="margin-top:13px">${avatars(d.people.map(p => p.m))}</div>
    </button>`;
  }).join("");

  return `<div class="sec-head"><div><div class="kick">Committee Structure</div><h1>Division</h1>
      <p class="sec-sub">How work is split across each division.</p></div></div>
    <div class="rule"></div>
    <div class="grid g3">${cards}</div>`;
}

/* Menyambungkan Division dengan Programs: tiap anggota memperlihatkan
   program yang dia pegang sebagai PIC, plus item checklist atas namanya. */
function dutyBlock(mid) {
  const asPic = PROGRAMS.filter(p => p.pics.includes(mid));
  const items = [];
  PROGRAMS.forEach(p => p.checklist.forEach(c => { if (c.who === mid) items.push({ p, c }); }));
  if (!asPic.length && !items.length) return "";

  return `<div class="duty">
    <div class="label" style="margin-bottom:8px">Program Responsibilities</div>
    ${asPic.length ? `<div class="chips">${asPic.map(p =>
      `<button class="chip" data-open-prog="${p.id}">PIC · ${esc(p.title)}</button>`).join("")}</div>` : ""}
    ${items.length ? `<div class="kan" style="margin-top:9px">${items.map(({ p, c }) => {
      const late = c.due && !c.done && c.due < new Date();
      return `<button class="task${c.done ? " done" : ""}${canCheck(c) ? "" : " locked"}" data-check="${p.id}|${c.id}">
        <span class="st ${c.done ? "done" : late ? "doing" : "todo"}"></span>
        <span class="tx">${esc(c.text)}<span class="who" style="display:block">${esc(p.title)}${c.due ? ` · due ${fShort(c.due)}` : ""}</span></span>
        <span class="stl">${c.done ? "Done" : late ? "Late" : "To Do"}</span></button>`;
    }).join("")}</div>` : ""}
  </div>`;
}

/* Keterangan tenggat di bawah teks tugas. Yang lewat tenggat dan belum
   selesai ditandai merah. */
function dueNote(t) {
  const due = taskDue(t);
  if (!due) return "";
  const late = t.status !== "done" && due < new Date();
  return `<span class="tdue${late ? " late" : ""}">Due ${fShort(due)} · ${fTime(due)}${
    t.status === "done" ? "" : ` · ${late ? "overdue" : cdShort(due)}`}</span>`;
}

function taskRow(did, mid, t) {
  const can = canTask(mid);
  const row = `<button class="task${t.status === "done" ? " done" : ""}${can ? "" : " locked"}" data-task="${did}|${mid}|${t.id}">
    <span class="st ${t.status}"></span><span class="tx">${esc(t.text)}${dueNote(t)}</span><span class="stl">${ST_LABEL[t.status]}</span></button>`;
  if (!can || !taskDueReady) return row;

  const due = taskDue(t);
  const btn = `<button class="tdue-btn${dueEdit === t.id ? " on" : ""}" data-taskdue="${t.id}" title="${due ? "Change deadline" : "Set deadline"}" aria-label="${due ? "Change deadline" : "Set deadline"}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></button>`;
  const form = dueEdit !== t.id ? "" : `<form class="addrow duerow" data-taskdueform="${did}|${mid}|${t.id}">
      <input class="ainput" type="date" name="tgl" value="${due ? dInput(due) : ""}" required aria-label="Deadline date">
      <input class="ainput" type="time" name="jam" value="${due ? tInput(due) : ""}" aria-label="Deadline time">
      <button class="btn sm" type="submit">Save</button>
      ${due ? `<button class="btn sm ghost" type="button" data-taskdueclear="${did}|${mid}|${t.id}">Remove</button>` : ""}
    </form>`;
  return `<div class="trow">${row}${btn}</div>${form}`;
}

const addTaskForm = (did, mid) => canTask(mid)
  ? `<form class="addrow" data-addtask="${did}|${mid}">
       <input class="ainput" name="text" placeholder="Add a task..." required>
       ${taskDueReady ? `<input class="ainput due" type="date" name="tgl" title="Deadline (optional)" aria-label="Deadline date (optional)">
       <input class="ainput due" type="time" name="jam" title="Deadline time (optional, default 23:59)" aria-label="Deadline time (optional)">` : ""}
       <button class="btn sm" type="submit">+</button></form>` : "";

function modalDivision(did) {
  const d = DIVISIONS.find(x => x.id === did);
  const blocks = d.people.map(p => {
    const m = byId(p.m); if (!m) return "";
    return `<div class="pane">
      <div class="person" style="box-shadow:none;background:transparent;padding:0 0 10px">
        <span class="av">${ini(m.name)}</span>
        <span><span class="pn">${esc(m.name)}</span><span class="pr2">${esc(m.role)}</span></span>
      </div>
      <div class="label" style="margin-bottom:7px">Division Tasks</div>
      <div class="kan">${p.tasks.map(t => taskRow(d.id, p.m, t)).join("") || `<div class="meta">No division tasks yet.</div>`}</div>
      ${addTaskForm(d.id, p.m)}
      ${dutyBlock(p.m)}
    </div>`;
  }).join("");

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        <div class="kick">26/27 Committee Division</div>
        <h2 style="margin:8px 0 6px">${esc(d.name)}</h2>
        <div class="meta">${esc(d.tagline)}</div>
      </div></div>
    <div class="modal-body">
      <div class="label">Tasks by Person</div>
      <div class="cols">${blocks}</div>
    </div>`;
}

/* ---------------------------------------------------------------- FORESTY 26/27 */
const ADVISOR = {
  name: "Assoc. Prof. Dr. Vera Suryani, S.T., M.T.",
  role: "Advisor of Forensic & Security Laboratory",
  init: "VS",
};

function memberCard(m) {
  const n = PROGRAMS.filter(p => p.pics.includes(m.id)).length;
  return `<button class="card click" data-open-member="${m.id}" style="text-align:center">
      <span class="av-s" style="width:56px;height:56px;font-size:19px;margin:2px auto 12px;display:grid">${ini(m.name)}</span>
      <div style="font-family:var(--disp);font-weight:700;letter-spacing:.06em;font-size:13px;text-transform:uppercase">${esc(m.name)}</div>
      <div class="meta" style="justify-content:center;margin-top:4px">${esc(m.role)}</div>
      <div class="rule" style="margin:12px 0 9px"></div>
      <div class="meta" style="justify-content:center">${esc(m.div)} · ${n} programs</div>
    </button>`;
}

function viewForesty() {
  const seen = new Set();
  const groups = DIVISIONS.map(d => {
    const people = d.people.map(x => byId(x.m)).filter(Boolean);
    people.forEach(m => seen.add(m.id));
    return { name: d.name, people };
  });
  const rest = MEMBERS.filter(m => !seen.has(m.id));
  if (rest.length) groups.push({ name: "Other Members", people: rest });

  const sections = groups.filter(g => g.people.length).map(g => `
    <section class="mgroup">
      <div class="mgroup-h">
        <h3>${esc(g.name)}</h3>
        <span class="meta num">${String(g.people.length).padStart(2, "0")} people</span>
      </div>
      <div class="grid g4">${g.people.map(memberCard).join("")}</div>
    </section>`).join("");

  return `<div class="sec-head"><div><div class="kick">Member Directory</div><h1>Foresty 26/27</h1>
      <p class="sec-sub">Every committee member, lab assistant, and researcher of the 2026/2027 term.</p></div></div>
    <div class="rule"></div>
    <div class="advisor">
      <svg class="fp" aria-hidden="true"><use href="#ic-fp"/></svg>
      <span class="av-s adv">${ADVISOR.init}</span>
      <div style="position:relative">
        <div class="kick">Advisor</div>
        <div class="advname">${esc(ADVISOR.name)}</div>
        <div class="meta">${esc(ADVISOR.role)}</div>
      </div>
    </div>
    <div class="label" style="margin:26px 0 18px">Committee, Lab Assistants &amp; Research Team · ${MEMBERS.length} people</div>
    ${sections}`;
}

function modalMember(mid) {
  const m = byId(mid);
  const mine = PROGRAMS.filter(p => p.pics.includes(mid));
  const div = DIVISIONS.find(d => d.people.some(p => p.m === mid));
  const myTasks = div ? div.people.find(p => p.m === mid).tasks : [];

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <span class="av-s" style="width:62px;height:62px;font-size:22px;display:grid;margin:0">${ini(m.name)}</span>
        <div>
          <div class="kick">Lab Assistant · Foresty 26/27</div>
          <h2 style="margin:6px 0 4px">${esc(m.name)}</h2>
          <div class="meta">${esc(m.role)} · ${esc(m.div)}</div>
        </div>
      </div></div>
    <div class="modal-body">
      <div class="cols">
        <div class="pane">
          <div class="label" style="margin-bottom:8px">Profile</div>
          <div class="kv"><span class="k">Name</span><span>${esc(m.name)}</span></div>
          <div class="kv"><span class="k">Role</span><span>${esc(m.role)}</span></div>
          <div class="kv"><span class="k">Division</span><span>${esc(m.div)}</span></div>
          <div class="kv"><span class="k">Access</span><span>${LEVEL_LABEL[m.level]}</span></div>
          <div class="kv"><span class="k">Term</span><span class="num">2026 / 2027</span></div>
        </div>
        <div class="pane">
          <div class="label" style="margin-bottom:8px">Division Tasks</div>
          ${myTasks.length ? `<div class="kan">${myTasks.map(t => taskRow(div.id, mid, t)).join("")}</div>`
            : `<div class="meta">No division tasks recorded.</div>`}
          ${div ? addTaskForm(div.id, mid) : ""}
        </div>
      </div>
      <div>
        <div class="label" style="margin-bottom:9px">Programs They Lead (PIC)</div>
        ${mine.length ? `<div class="stack">${mine.map(p => {
          const pr = progress(p);
          return `<button class="chk" data-open-prog="${p.id}" style="align-items:center">
            <span style="flex:1">
              <span class="t" style="font-family:var(--disp);text-transform:uppercase;letter-spacing:.06em;font-weight:600">${esc(p.title)}</span>
              <span class="who">${fShort(p.date)} · ${esc(p.place)} · checklist ${pr.done}/${pr.total}</span>
            </span>
            ${tag(p.status)}
            <span style="color:var(--red);font-weight:700">&rsaquo;</span>
          </button>`;
        }).join("")}</div>` : `<div class="empty">Not assigned as PIC on any program yet.</div>`}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- NOTIFICATION */
function viewNotification() {
  const ns = buildNotifs();
  const rows = ns.map(n => {
    const un = !NREAD.has(n.id);
    return `<button class="nrow${un ? " unread" : ""}" data-notif="${n.id}" ${n.mid ? `data-mid="${n.mid}"` : n.did ? `data-did="${n.did}"` : `data-pid="${n.pid}"`}>
      <span class="ni"><svg viewBox="0 0 24 24">${n.kind === "task"
        ? '<path d="M4 6h16M4 12h16M4 18h10"/>'
        : n.kind === "meeting"
        ? '<path d="M5 3h11l3 3v15H5z"/><path d="M9 9h7M9 13h7M9 17h4"/>'
        : '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'}</svg></span>
      <span style="flex:1">
        <span class="nt"><span class="trig${n.trig === "H-0" ? " h0" : ""}">${n.trig}</span>${n.text}</span>
        <span class="nd">${fShort(n.fire)} · ${fTime(n.fire)} · ${un ? "unread" : "read"}</span>
      </span>
    </button>`;
  }).join("") || `<div class="empty">No notifications yet.</div>`;

  return `<div class="sec-head" style="justify-content:space-between">
      <div><div class="kick">Automatic Reminders</div><h1>Notification</h1></div>
      <button class="btn ghost" data-readall>Mark all as read</button>
    </div>
    <div class="rule"></div>
    ${pushPanel()}
    ${mailSection()}
    <div class="label" style="margin-bottom:12px">Agenda &amp; Deadlines</div>
    <div class="stack">${rows}</div>`;
}

function mailSection() {
  const unread = MAIL.messages.filter(m => m.unread);
  if (!unread.length) return "";
  return `<div class="label" style="margin-bottom:12px">Unread Email · ${unread.length}</div>
    <div class="stack" style="margin-bottom:26px">${unread.map(m => {
      const d = new Date(m.date);
      return `<a class="nrow unread" href="${gmailLink("#inbox/" + m.id)}" target="_blank" rel="noopener">
        <span class="ni"><svg viewBox="0 0 24 24"><path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/></svg></span>
        <span style="flex:1">
          <span class="nt"><span class="trig h0">EMAIL</span>New email from <b>${esc(m.from)}</b> — ${esc(m.subject)}</span>
          <span class="nd">${fShort(d)} · ${fTime(d)} · click to open in Gmail</span>
        </span>
      </a>`;
    }).join("")}</div>`;
}

/* ---------------------------------------------------------------- NOTULEN */
let roomTab = null;

function viewMinutes() {
  const rooms = myRooms();
  if (!rooms.length) return `<div class="empty">No meeting rooms available for your account.</div>`;
  if (!rooms.includes(roomTab)) roomTab = rooms[0];

  const now = new Date();
  const list = MEETINGS.filter(m => m.room === roomTab).slice().sort((a, b) => {
    const au = a.held >= now, bu = b.held >= now;
    if (au !== bu) return au ? -1 : 1;          /* yang akan datang di depan */
    return au ? a.held - b.held : b.held - a.held;
  });

  const cards = list.map(m => {
    const akan = m.held >= now;
    const ada = m.notes.trim().length > 0;
    return `<button class="card click" data-minute="${m.id}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        ${akan ? `<span class="tag t-ongoing"><i class="dot pulse"></i>Upcoming</span>`
               : `<span class="tag ${ada ? "t-completed" : "t-soon"}">${ada ? "Minutes Recorded" : "No Minutes Yet"}</span>`}
        <span class="meta num">${fShort(m.held)}</span>
      </div>
      <h3 style="margin:11px 0 6px">${esc(m.title)}</h3>
      <div class="meta" style="margin-bottom:12px">${DW[m.held.getDay()]}, ${fTime(m.held)} WIB${m.place ? " · " + esc(m.place) : ""}</div>
      ${countdown(m.held)}
    </button>`;
  }).join("") || `<div class="empty">${meetingsReady
      ? "No meetings in this room yet."
      : "The meetings table has not been created. Run db/06_notulen.sql in Supabase."}</div>`;

  return `<div class="sec-head" style="justify-content:space-between">
      <div><div class="kick">Schedule &amp; Minutes</div><h1>Meeting</h1>
      <p class="sec-sub">Meeting schedules per room, each with its own countdown.</p></div>
      ${meetingsReady ? `<button class="btn" data-newminute>+ Schedule Meeting</button>` : ""}
    </div>
    <div class="rule"></div>
    <div class="tabs">
      ${rooms.map(r => {
        const n = MEETINGS.filter(m => m.room === r).length;
        return `<button class="tab${roomTab === r ? " on" : ""}" data-room="${r}">${esc(room(r).short)} <span class="n">${String(n).padStart(2, "0")}</span></button>`;
      }).join("")}
    </div>
    <div class="grid g3">${cards}</div>`;
}

function modalMinute(id) {
  const m = MEETINGS.find(x => x.id === id);
  if (!m) return `<div class="modal-body"><div class="empty">Meeting not found.</div></div>`;
  const akan = m.held >= new Date();
  const bisa = canWriteMinute(m);

  const isi = bisa
    ? `<form data-noteform="${m.id}">
         <textarea class="ainput notulen-edit" name="notes" rows="14"
           placeholder="1. Discussion...&#10;2. Decisions...&#10;3. Follow-up...">${esc(m.notes)}</textarea>
         <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:11px;align-items:center">
           <button class="btn" type="submit">Save Minutes</button>
           <span class="meta">${m.notes.trim()
             ? `Last updated ${fShort(new Date(m.updated_at))} ${fTime(new Date(m.updated_at))}`
             : akan ? "Can be filled in once the meeting has taken place." : "Never filled in."}</span>
         </div>
       </form>`
    : `<div class="notulen">${esc(m.notes) || '<span class="meta">No minutes yet.</span>'}</div>`;

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        <div class="kick">${esc(room(m.room).label)}</div>
        <h2 style="margin:8px 0 6px">${esc(m.title)}</h2>
        <div class="meta">${DW[m.held.getDay()]}, ${fDate(m.held)} · ${fTime(m.held)} WIB${m.place ? " · " + esc(m.place) : ""}</div>
        <div style="margin-top:14px">${countdown(m.held)}</div>
        ${bisa ? `<div style="margin-top:14px;display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn ghost sm" data-editminute="${m.id}">Edit Schedule</button>
          <button class="btn ghost sm" data-minutedel="${m.id}">Delete</button>
        </div>` : ""}
      </div></div>
    <div class="modal-body">
      <div>
        <div class="label" style="margin-bottom:9px">Minutes</div>
        ${isi}
      </div>
    </div>`;
}

async function saveNotes(id, f) {
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;
  const { error } = await sb.from("meetings").update({ notes: f.notes.value }).eq("id", id);
  btn.disabled = false;
  if (error) return fail(error, "Could not save the minutes");
  await loadAll();
  showModal("minute", id);
  render();
  toast("Minutes saved.");
}

function modalMinuteForm(id) {
  const m = id ? MEETINGS.find(x => x.id === id) : null;
  const d = m ? m.held : new Date();
  const rooms = myRooms();

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        <div class="kick">${m ? "Edit Meeting" : "New Meeting"}</div>
        <h2 style="margin:8px 0 4px">${m ? esc(m.title) : "Schedule a Meeting"}</h2>
        <div class="meta">Minutes are written later from this meeting card. Only members of the chosen room can read it.</div>
      </div></div>
    <div class="modal-body">
      <form class="aform" data-minuteform="${m ? m.id : ""}">
        <div class="cols" style="gap:13px">
          <label class="afield"><span class="label">Meeting room</span>
            <select class="ainput" name="room">
              ${rooms.map(r => `<option value="${r}"${(m ? m.room : roomTab) === r ? " selected" : ""}>${esc(room(r).label)}</option>`).join("")}
            </select></label>
          <label class="afield"><span class="label">Date</span>
            <input class="ainput" type="date" name="tgl" value="${dInput(d)}" required></label>
          <label class="afield"><span class="label">Time</span>
            <input class="ainput" type="time" name="jam" value="${tInput(d)}" required></label>
        </div>

        <label class="afield"><span class="label">Meeting title</span>
          <input class="ainput" name="title" value="${m ? esc(m.title) : ""}" placeholder="Labshow preparation coordination meeting" required></label>

        <label class="afield"><span class="label">Venue</span>
          <input class="ainput" name="place" value="${m ? esc(m.place) : ""}" placeholder="Lab Room / Online"></label>

        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:6px">
          <button class="btn" type="submit">${m ? "Save Changes" : "Schedule"}</button>
        </div>
      </form>
    </div>`;
}

async function saveMinute(id, f) {
  const held = new Date(`${f.tgl.value}T${f.jam.value || "19:00"}`);
  if (isNaN(held)) return toast("Date or time is not valid.", true);
  const title = f.title.value.trim();
  if (!title) return toast("Meeting title is empty.", true);

  const body = {
    room: f.room.value, title, held_at: held.toISOString(),
    place: f.place.value.trim(),
  };

  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;

  const res = id
    ? await sb.from("meetings").update(body).eq("id", id).select().single()
    : await sb.from("meetings").insert({ ...body, created_by: ME.user.id }).select().single();

  if (res.error) { btn.disabled = false; return fail(res.error, "Could not save the meeting"); }

  await loadAll();
  roomTab = body.room;
  showModal("minute", res.data.id);
  render();
  toast(id ? "Meeting updated." : "Meeting saved.");
}

async function deleteMinute(id) {
  const m = MEETINGS.find(x => x.id === id);
  if (!confirm(`Delete the meeting "${m.title}" and its minutes? This cannot be undone.`)) return;
  const { error } = await sb.from("meetings").delete().eq("id", id);
  if (error) return fail(error, "Could not delete the meeting");
  closeModal();
  await loadAll();
  render();
  toast("Meeting deleted.");
}

/* ---------------------------------------------------------------- INBOX */
function gmailLink(after) {
  // AccountChooser memastikan Gmail dibuka pada akun lab, bukan akun pribadi
  // yang kebetulan sedang aktif di browser.
  return "https://accounts.google.com/AccountChooser?Email=" + encodeURIComponent(LAB_EMAIL) +
         "&continue=" + encodeURIComponent("https://mail.google.com/mail/u/0/" + (after || "#inbox"));
}

function viewInbox() {
  if (!isLab()) return `<div class="empty">This page is for the lab account only.</div>`;
  const unread = unreadMail();
  let body;

  if (MAIL.loading && !MAIL.loaded) {
    body = `<div class="empty">Loading inbox…</div>`;
  } else if (!MAIL.configured) {
    body = `<div class="note">
      <b style="color:#fff">Gmail integration is not active.</b><br>
      ${esc(MAIL.error || "The gmail-inbox edge function is not installed.")}
      Use the <b>Open Inbox</b> button above in the meantime. Setup steps are in the README, under “Gmail integration”.
    </div>`;
  } else if (MAIL.error) {
    body = `<div class="note" style="border-left-color:var(--red)">
      <b style="color:#fff">Could not fetch email.</b><br>${esc(MAIL.error)}
    </div>`;
  } else if (!MAIL.messages.length) {
    body = `<div class="empty">The inbox is empty.</div>`;
  } else {
    body = `<div class="stack">${MAIL.messages.map(m => {
      const d = new Date(m.date), now = new Date();
      const hariIni = key(d) === key(now);
      const waktu = hariIni ? fTime(d) : fShort(d);
      return `<a class="mailrow${m.unread ? " unread" : ""}" href="${gmailLink("#inbox/" + m.id)}"
              target="_blank" rel="noopener" title="Open in Gmail">
        <span class="av-s" style="margin:0">${ini(m.from)}</span>
        <span style="min-width:0">
          <span class="sub">${m.unread ? '<i class="dot pulse"></i>' : ""}${esc(m.subject)}</span>
          <span class="snip">${esc(m.from)} — ${esc(m.snippet)}</span>
        </span>
        <span class="meta num" style="white-space:nowrap">${waktu}</span>
      </a>`;
    }).join("")}</div>
    ${MAIL.next ? `<button class="btn ghost" data-mailmore style="width:100%;justify-content:center;margin-top:12px"${MAIL.more ? " disabled" : ""}>${MAIL.more ? "Loading…" : "Load older email"}</button>` : ""}`;
  }

  return `<div class="sec-head"><div><div class="kick">Official Lab Mailbox</div><h1>Inbox</h1></div></div>
    <div class="rule"></div>

    <div class="mailbox">
      <svg class="fp" aria-hidden="true"><use href="#ic-fp"/></svg>
      <div class="dots"></div>
      <div style="position:relative;flex:1;min-width:230px">
        <div class="label">Laboratory Account</div>
        <div class="mailaddr">${esc(LAB_EMAIL)}</div>
        <button class="linkish" data-copy="${esc(LAB_EMAIL)}">Copy address</button>
      </div>
      <div style="position:relative;display:flex;gap:9px;flex-wrap:wrap">
        <a class="btn" href="${gmailLink("#inbox")}" target="_blank" rel="noopener">Open Inbox &nearr;</a>
        <a class="btn ghost" href="${gmailLink("#inbox?compose=new")}" target="_blank" rel="noopener">Compose &nearr;</a>
      </div>
    </div>

    <div class="sec-head" style="justify-content:space-between;margin-top:26px">
      <div class="label">Recent Email${unread ? ` · <span style="color:var(--red)">${unread} unread</span>` : ""}</div>
      <button class="btn ghost sm" data-mailrefresh${MAIL.loading ? " disabled" : ""}>${MAIL.loading ? "Loading…" : "Refresh"}</button>
    </div>
    <div class="rule" style="margin:10px 0 14px"></div>
    ${body}`;
}

/* ---------------------------------------------------------------- GMAIL */
let MAIL = { messages: [], loaded: false, loading: false, configured: true, error: null, next: null, more: false, paged: false };

const unreadMail = () => MAIL.messages.filter(m => m.unread).length;

async function loadMail(force) {
  if (!isLab() || MAIL.loading) return;
  MAIL.loading = true;
  if (route === "inbox") render();
  const { data, error } = await sb.functions.invoke("gmail-inbox" + (force ? "?refresh=1" : ""));
  MAIL.loading = false;
  MAIL.loaded = true;
  if (error) {
    MAIL.error = /not found|404/i.test(error.message || "")
      ? "The gmail-inbox edge function has not been deployed."
      : (error.message || "Could not reach the mail server.");
    MAIL.configured = false;
    MAIL.messages = [];
  } else {
    /* email lama yang sudah dimuat lewat "Load older" tetap di bawah,
       supaya tarikan ulang tiap 3 menit tidak memotong daftarnya */
    const fresh = data.messages || [];
    const ids = new Set(fresh.map(m => m.id));
    const older = MAIL.paged ? MAIL.messages.filter(m => !ids.has(m.id)) : [];
    MAIL.messages = fresh.concat(older);
    if (!MAIL.paged) MAIL.next = data.next || null;
    MAIL.configured = data.configured !== false;
    MAIL.error = data.error || null;
  }
  render();
}

/* email yang lebih lama, ditambahkan di bawah daftar */
async function loadMoreMail() {
  if (!isLab() || !MAIL.next || MAIL.more) return;
  MAIL.more = true;
  render();
  const { data, error } = await sb.functions.invoke("gmail-inbox?page=" + encodeURIComponent(MAIL.next));
  MAIL.more = false;
  if (error || data.error) { render(); return toast("Could not load older email: " + (data?.error || error.message), true); }
  const ada = new Set(MAIL.messages.map(m => m.id));
  MAIL.messages.push(...(data.messages || []).filter(m => !ada.has(m.id)));
  MAIL.next = data.next || null;
  MAIL.paged = true;
  render();
}

/* ---------------------------------------------------------------- APPROVAL */
let PENDING = [], ACTIVE = [], REJECTED = [];
async function loadProfiles() {
  if (!isLab()) return;
  const { data, error } = await sb.from("profiles").select("*").order("created_at");
  if (error) return fail(error, "Could not load the account list");
  PENDING  = data.filter(p => p.status === "pending");
  ACTIVE   = data.filter(p => p.status === "approved");
  REJECTED = data.filter(p => p.status === "rejected");
}

function viewApproval() {
  if (!isLab()) return `<div class="empty">This page is for the lab account only.</div>`;
  const dupes = {};
  PENDING.forEach(a => dupes[a.member_id] = (dupes[a.member_id] || 0) + 1);

  const queue = PENDING.map(a => {
    const m = byId(a.member_id), bentrok = dupes[a.member_id] > 1;
    const at = new Date(a.created_at);
    return `<div class="card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:210px">
        ${bentrok ? `<span class="tag t-over" style="margin-bottom:8px">${dupes[a.member_id]} people claim this name</span>` : ""}
        <div class="kv"><span class="k">Email</span><span>${esc(a.email)}</span></div>
        <div class="kv"><span class="k">Claims to be</span><span style="color:#fff">${esc(m?.name || a.member_id)}</span></div>
        <div class="kv"><span class="k">Role</span><span>${esc(m?.role || "-")} · ${esc(m?.div || "-")}</span></div>
        <div class="kv"><span class="k">Sent</span><span class="num">${fShort(at)} ${fTime(at)}</span></div>
      </div>
      <div style="flex:0 0 240px;display:flex;flex-direction:column;gap:8px">
        <input class="ainput" id="rsn-${a.user_id}" placeholder="Reason for rejection (optional)">
        <div style="display:flex;gap:8px">
          <button class="btn sm" data-appr="ok|${a.user_id}" style="flex:1;justify-content:center">Approve</button>
          <button class="btn ghost sm" data-appr="no|${a.user_id}" style="flex:1;justify-content:center">Reject</button>
        </div>
      </div>
    </div>`;
  }).join("") || `<div class="empty">No registrations waiting.</div>`;

  const active = ACTIVE.map(a => {
    const m = byId(a.member_id);
    return `<div class="mailrow" style="grid-template-columns:30px minmax(0,1fr) auto auto;gap:12px;align-items:center">
      <span class="av-s" style="margin:0">${ini(m?.name || "?")}</span>
      <span style="min-width:0"><span class="sub">${esc(m?.name || a.member_id)}</span><span class="snip">${esc(a.email)}</span></span>
      <span class="tag ${m?.level === "inti" ? "t-ongoing" : "t-soon"}">${LEVEL_LABEL[m?.level || "staff"]}</span>
      <button class="btn ghost sm" data-appr="cabut|${a.user_id}">Revoke</button>
    </div>`;
  }).join("") || `<div class="empty">No active accounts yet.</div>`;

  const claimed = new Set(ACTIVE.map(a => a.member_id));
  const belum = MEMBERS.filter(m => !claimed.has(m.id));

  return `<div class="sec-head"><div><div class="kick">Restricted to ${esc(LAB_EMAIL)}</div><h1>Approval</h1>
      <p class="sec-sub">Approve or reject account registrations. An email only binds to a member's name once approved here.</p></div></div>
    <div class="rule"></div>
    <div class="grid g-sum" style="margin-bottom:24px">
      ${stat("Awaiting Approval", PENDING.length, PENDING.length ? "red" : "", "registrations received")}
      ${stat("Active Accounts", ACTIVE.length, "ok", "able to sign in")}
      ${stat("Unclaimed Names", belum.length, "", "of " + MEMBERS.length + " members")}
    </div>
    <div class="label" style="margin-bottom:12px">Registration Queue</div>
    <div class="stack" style="gap:12px;margin-bottom:30px">${queue}</div>
    <div class="label" style="margin-bottom:12px">Active Accounts</div>
    <div class="stack" style="margin-bottom:30px">${active}</div>
    ${rejectedSection()}`;
}

function rejectedSection() {
  if (!REJECTED.length) return "";
  return `<div class="label" style="margin-bottom:12px">Rejected Registrations · ${REJECTED.length}</div>
    <div class="stack">${REJECTED.map(a => {
      const m = byId(a.member_id);
      return `<div class="mailrow" style="grid-template-columns:30px minmax(0,1fr) auto auto;gap:12px;align-items:center">
        <span class="av-s" style="margin:0;opacity:.6">${ini(m?.name || "?")}</span>
        <span style="min-width:0">
          <span class="sub" style="color:var(--dim)">${esc(m?.name || a.member_id)}</span>
          <span class="snip">${esc(a.email)}${a.reason ? " — " + esc(a.reason) : ""}</span>
        </span>
        <button class="btn sm" data-appr="ok|${a.user_id}">Approve</button>
        <button class="btn ghost sm" data-appr="reset|${a.user_id}">Reopen</button>
      </div>`;
    }).join("")}</div>
    <div class="meta" style="margin-top:10px">“Reopen” clears the rejection so the person can pick a name again on their next sign-in.</div>`;
}

async function decide(act, uid) {
  const row = PENDING.concat(ACTIVE, REJECTED).find(p => p.user_id === uid);
  if (!row) return;
  if (act === "cabut" || act === "reset") {
    const pesan = act === "cabut"
      ? `Revoke access for ${row.email}? Their name becomes claimable again.`
      : `Reopen the registration for ${row.email}? They will be asked to pick a name again on sign-in.`;
    if (!confirm(pesan)) return;
    const { error } = await sb.from("profiles").delete().eq("user_id", uid);
    if (error) return fail(error, "Could not remove the account record");
    toast(act === "cabut" ? `Access revoked for ${row.email}.` : `Registration reopened for ${row.email}.`);
    await loadProfiles(); render(); return;
  }
  if (act === "ok") {
    const { error } = await sb.from("profiles").update({
      status: "approved", reason: null, decided_at: new Date().toISOString(), decided_by: ME.user.id,
    }).eq("user_id", uid);
    if (error) {
      const bentrok = error.code === "23505" || /duplicate key/i.test(error.message || "");
      return toast(bentrok
        ? `${byId(row.member_id)?.name || "That name"} is already held by another account. Revoke the old one under Active Accounts first.`
        : (error.message || "Could not approve"), true);
    }
    toast(`${byId(row.member_id)?.name || row.email} approved.`);
  } else {
    const r = document.getElementById("rsn-" + uid);
    const { error } = await sb.from("profiles").update({
      status: "rejected", reason: r?.value.trim() || null,
      decided_at: new Date().toISOString(), decided_by: ME.user.id,
    }).eq("user_id", uid);
    if (error) return fail(error, "Could not reject");
    toast(`Registration for ${row.email} rejected.`);
  }
  await loadProfiles();
  render();
}

/* ---------------------------------------------------------------- render */
function paintUser() {
  const el = $("#me");
  if (!el || !ME) return;
  const nama = ME.isLab ? "Lab Account" : ME.member.name;
  const sub  = ME.isLab ? "Administrator" : ME.member.role;
  const inis = ME.isLab ? "FL" : ini(ME.member.name);
  const pend = isLab() ? PENDING.length : 0;
  el.innerHTML = `<div class="av">${inis}</div>
    <div class="mtxt">
      <div class="mn">${esc(nama)}</div>
      <div class="mr">${esc(sub)}</div>
    </div>
    ${pend ? `<span class="tag t-over" style="margin-left:4px">${pend} waiting</span>` : ""}
    <button class="logout" id="logout" title="Sign out" aria-label="Sign out">
      <svg viewBox="0 0 24 24"><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg>
    </button>`;
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
}

function render() {
  $("#nav").innerHTML = visibleMenu().map(m => {
    const c = m.id === "notification" ? unreadCount()
            : m.id === "approval" ? PENDING.length
            : m.id === "inbox" ? unreadMail() : 0;
    return `<button class="nav-item${route === m.id ? " active" : ""}" data-go="${m.id}" title="${m.label}">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg><span class="ntxt">${m.label}</span>
      ${c ? `<span class="cnt num">${c}</span>` : ""}</button>`;
  }).join("");
  const u = unreadCount() + unreadMail();
  $("#bellCount").textContent = u;
  $("#bellCount").hidden = !u;
  const views = { dashboard: viewDashboard, programs: viewPrograms, division: viewDivision,
                  foresty: viewForesty, notification: viewNotification, inbox: viewInbox,
                  minutes: viewMinutes,
                  approval: viewApproval };
  $("#view").innerHTML = (views[route] || viewDashboard)();
  paintUser();
  tickCountdowns();
}

/* ---------------------------------------------------------------- interaksi */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-go],[data-tab],[data-open-prog],[data-open-div],[data-open-member],[data-check],[data-task],[data-taskdue],[data-taskdueclear],[data-cal],[data-day],[data-notif],[data-readall],[data-appr],[data-auth],[data-copy],[data-mailrefresh],[data-mailmore],[data-newprog],[data-editprog],[data-progdel],[data-room],[data-minute],[data-newminute],[data-editminute],[data-minutedel],[data-push]");
  if (!t) return;
  const d = t.dataset;

  if (d.auth) { const [act, arg] = d.auth.split("|"); return authAction(act, arg); }
  if (d.appr) { const [act, uid] = d.appr.split("|"); return decide(act, uid); }
  if (d.push) return d.push === "on" ? enablePush() : disablePush();
  if (d.room) { roomTab = d.room; return render(); }
  if (d.minute) return showModal("minute", d.minute);
  if (d.newminute !== undefined) return showModal("mform", "");
  if (d.editminute) return showModal("mform", d.editminute);
  if (d.minutedel) return deleteMinute(d.minutedel);
  if (d.newprog !== undefined) return showModal("form", "");
  if (d.editprog) return showModal("form", d.editprog);
  if (d.progdel) return deleteProgram(d.progdel);
  if (d.mailrefresh !== undefined) return loadMail(true);
  if (d.mailmore !== undefined) return loadMoreMail();
  if (d.copy !== undefined) {
    navigator.clipboard?.writeText(d.copy)
      .then(() => toast("Email address copied."), () => toast("The browser refused to copy.", true));
    return;
  }
  if (d.go) return go(d.go);
  if (d.tab) { progTab = d.tab; return render(); }
  if (d.openProg) return showModal("prog", d.openProg);
  if (d.openDiv) return showModal("div", d.openDiv);
  if (d.openMember) return showModal("member", d.openMember);
  if (d.check) { const [pid, cid] = d.check.split("|"); return toggleCheck(pid, cid); }
  if (d.task) { const [did, mid, tid] = d.task.split("|"); return cycleTask(did, mid, tid); }
  if (d.taskdue) { dueEdit = dueEdit === d.taskdue ? null : d.taskdue; return rerender(); }
  if (d.taskdueclear) { const [did, mid, tid] = d.taskdueclear.split("|"); return setTaskDue(did, mid, tid, null); }
  if (d.cal !== undefined) {
    if (d.cal === "0") { const n = new Date(); calCursor = new Date(n.getFullYear(), n.getMonth(), 1); }
    else calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + Number(d.cal), 1);
    return render();
  }
  if (d.day) { calSel = calSel === d.day ? null : d.day; return render(); }
  if (d.notif) { markRead([d.notif]); return d.mid ? showModal("minute", d.mid) : d.did ? showModal("div", d.did) : showModal("prog", d.pid); }
  if (d.readall !== undefined) return markRead(buildNotifs().map(n => n.id));
});

document.addEventListener("submit", e => {
  const f = e.target;
  if (f.dataset.progform !== undefined) { e.preventDefault(); return saveProgram(f.dataset.progform || null, f); }
  if (f.dataset.minuteform !== undefined) { e.preventDefault(); return saveMinute(f.dataset.minuteform || null, f); }
  if (f.dataset.noteform) { e.preventDefault(); return saveNotes(f.dataset.noteform, f); }
  if (f.dataset.addcheck) {
    e.preventDefault();
    const txt = f.text.value.trim(); if (!txt) return;
    addCheck(f.dataset.addcheck, txt, f.who.value);
  }
  if (f.dataset.addtask) {
    e.preventDefault();
    const [did, mid] = f.dataset.addtask.split("|");
    const txt = f.text.value.trim(); if (!txt) return;
    addTask(did, mid, txt, readDue(f));
  }
  if (f.dataset.taskdueform) {
    e.preventDefault();
    const [did, mid, tid] = f.dataset.taskdueform.split("|");
    const due = readDue(f); if (!due) return;
    setTaskDue(did, mid, tid, due);
  }
});

/* pencarian */
let chromeWired = false;
function wireChrome() {
  if (chromeWired) return;
  chromeWired = true;
  const qEl = $("#q"), resEl = $("#results");
  /* placeholder panjang membuat kotak pencarian menolak menyusut di HP */
  const fitPlaceholder = () => {
    qEl.placeholder = innerWidth < 620 ? "search..." : "search program / division / member...";
  };
  fitPlaceholder();
  addEventListener("resize", fitPlaceholder);
  qEl.addEventListener("input", () => {
    const v = qEl.value.trim().toLowerCase();
    if (v.length < 2) { resEl.hidden = true; return; }
    const hits = [
      ...PROGRAMS.filter(p => p.title.toLowerCase().includes(v) || p.desc.toLowerCase().includes(v))
        .map(p => ({ k: "Program", n: p.title, a: `data-open-prog="${p.id}"` })),
      ...MEMBERS.filter(m => m.name.toLowerCase().includes(v) || m.role.toLowerCase().includes(v))
        .map(m => ({ k: "Member", n: `${m.name} — ${m.role}`, a: `data-open-member="${m.id}"` })),
      ...DIVISIONS.filter(x => x.name.toLowerCase().includes(v))
        .map(x => ({ k: "Division", n: x.name, a: `data-open-div="${x.id}"` })),
    ].slice(0, 12);
    resEl.innerHTML = hits.length
      ? hits.map(h => `<button ${h.a}><span class="k">${h.k}</span><br>${esc(h.n)}</button>`).join("")
      : `<div style="padding:12px;color:var(--dim);font-size:12px">No results for “${esc(qEl.value)}”.</div>`;
    resEl.hidden = false;
  });
  document.addEventListener("click", ev => { if (!ev.target.closest(".search")) resEl.hidden = true; });

  $("#bell").addEventListener("click", () => go("notification"));

  const side = $("#sidebar"), scrim = $("#sideScrim");
  function openSide(on) {
    side.classList.toggle("open", on);
    if (scrim) scrim.hidden = !on;
  }
  $("#hamb").addEventListener("click", (e) => {
    e.stopPropagation();
    openSide(!side.classList.contains("open"));
  });
  if (scrim) scrim.addEventListener("click", () => openSide(false));
  /* menyentuh di mana pun di luar sidebar menutupnya kembali */
  document.addEventListener("click", (e) => {
    if (!side.classList.contains("open")) return;
    if (e.target.closest("#sidebar") || e.target.closest("#hamb")) return;
    openSide(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") openSide(false); });

  const RKEY = "foresty.rail", railBtn = $("#rail"), shellEl = $("#shell");
  function setRail(on) {
    shellEl.classList.toggle("rail", on);
    railBtn.setAttribute("aria-expanded", String(!on));
    railBtn.title = on ? "Expand menu" : "Collapse menu";
    try { localStorage.setItem(RKEY, on ? "1" : "0"); } catch (e) {}
  }
  railBtn.addEventListener("click", () => setRail(!shellEl.classList.contains("rail")));
  try { if (localStorage.getItem(RKEY) === "1") setRail(true); } catch (e) {}

  setInterval(() => { const c = $("#clock"); if (c) c.textContent = fTime(new Date()); }, 1000);
}

/* ---------------------------------------------------------------- realtime */
let reloadT, rtWired = false;
function subscribeRealtime() {
  if (rtWired) return;
  rtWired = true;
  const bump = () => {
    clearTimeout(reloadT);
    reloadT = setTimeout(async () => {
      try { await loadAll(); if (isLab()) await loadProfiles(); rerender(); } catch (e) { console.error(e); }
    }, 400);
  };
  sb.channel("foresty")
    .on("postgres_changes", { event: "*", schema: "public", table: "checklist" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "programs" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, bump)
    .subscribe(st => {
      const el = $("#sync");
      if (el) el.textContent = st === "SUBSCRIBED" ? "SYNCED · REALTIME" : "SYNCED · POLLING";
    });
}

/* ---------------------------------------------------------------- AUTH UI */
let authScreen = "login", authErr = "", authInfo = "", authCtx = null;

function authShell(inner) {
  return `<div class="authwrap">
    <div class="authbox">
      <div class="dots"></div><div class="scan"></div>
      <div class="authhead">
        <img src="logo.png" alt="Logo Foresty Laboratory" width="46" height="65">
        <div>
          <div class="bt" style="font-family:var(--disp);font-weight:700;letter-spacing:.13em;font-size:15px;line-height:1.15">FORESTY<br>LABORATORY</div>
          <div class="bs" style="font-size:9.5px;color:var(--dim);letter-spacing:.22em;text-transform:uppercase">Forensics &amp; Security</div>
        </div>
      </div>
      <div class="rule live authrule"></div>
      <div class="kick authkick">Foresty Management System · 26/27</div>
      ${authErr ? `<div class="aerr">${esc(authErr)}</div>` : ""}
      ${authInfo ? `<div class="anotice">${esc(authInfo)}</div>` : ""}
      ${inner}
    </div>
  </div>`;
}

async function claimableMembers() {
  const { data } = await sb.from("members").select("*").order("sort");
  return data || [];
}

async function viewLogin() {
  return authShell(`
    <h2 style="margin-bottom:4px">Sign In</h2>
    <p class="meta" style="margin-bottom:18px">Use an email address the lab account has approved.</p>
    <form class="aform" id="loginForm">
      <label class="afield"><span class="label">Email</span>
        <input id="li-email" type="email" autocomplete="username" placeholder="name@email.com" required></label>
      <label class="afield"><span class="label">Web account password</span>
        <input id="li-pass" type="password" autocomplete="current-password" placeholder="••••••••" required></label>
      <button type="button" class="aforgot" data-auth="forgot">Forgot password?</button>
      <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:4px">Sign In</button>
    </form>
    <div class="aalt">No account yet? <button data-auth="register">Register here</button></div>`);
}

async function viewRegister() {
  const mem = await claimableMembers();
  const opts = mem.map(m => `<option value="${m.id}">${esc(m.name)} — ${esc(m.role)}</option>`).join("");
  return authShell(`
    <h2 style="margin-bottom:4px">Register</h2>
    <p class="meta" style="margin-bottom:18px">Register your email, then pick your name from the committee list so the account binds to your record.</p>
    <form class="aform" id="regForm">
      <label class="afield"><span class="label">Email</span>
        <input id="rg-email" type="email" autocomplete="username" placeholder="name@email.com" required></label>
      <label class="afield"><span class="label">Web account password</span>
        <input id="rg-pass" type="password" autocomplete="new-password" placeholder="at least 8 characters" required></label>
      <label class="afield"><span class="label">Repeat password</span>
        <input id="rg-pass2" type="password" autocomplete="new-password" placeholder="••••••••" required></label>
      <label class="afield"><span class="label">Your name</span>
        <select id="rg-member" required><option value="">— choose your name —</option>${opts}</select></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:4px">Submit Registration</button>
    </form>
    <div class="ahint"><b>This is your Foresty Management password</b>, not your Gmail password. Never enter a Gmail password on any page here.</div>
    <div class="aalt">Already registered? <button data-auth="login">Sign in</button></div>`);
}

/* akun sudah ada di Auth tapi belum memilih nama */
async function viewClaim() {
  const mem = await claimableMembers();
  const opts = mem.map(m => `<option value="${m.id}">${esc(m.name)} — ${esc(m.role)}</option>`).join("");
  return authShell(`
    <h2 style="margin-bottom:4px">Complete Registration</h2>
    <p class="meta" style="margin-bottom:18px">The address <b style="color:#fff">${esc(authCtx?.email || "")}</b> is registered — just pick your name.</p>
    <form class="aform" id="claimForm">
      <label class="afield"><span class="label">Your name</span>
        <select id="cl-member" required><option value="">— choose your name —</option>${opts}</select></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center">Submit Registration</button>
    </form>
    <button class="btn ghost" data-auth="logout" style="width:100%;justify-content:center;margin-top:10px">Sign out</button>`);
}

async function viewPending() {
  const p = authCtx, m = byId(p.member_id) || (await claimableMembers()).find(x => x.id === p.member_id);
  const at = new Date(p.created_at);
  return authShell(`
    <div class="await-ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
    <h2 style="margin-bottom:4px">Awaiting Approval</h2>
    <p class="meta" style="margin-bottom:18px">Your registration has been sent. The lab account must approve it before you can sign in.</p>
    <div class="pane" style="margin-bottom:16px">
      <div class="kv"><span class="k">Email</span><span>${esc(p.email)}</span></div>
      <div class="kv"><span class="k">Name</span><span>${esc(m?.name || p.member_id)}</span></div>
      <div class="kv"><span class="k">Role</span><span>${esc(m?.role || "-")}</span></div>
      <div class="kv"><span class="k">Sent</span><span class="num">${fShort(at)} ${fTime(at)}</span></div>
      <div class="kv"><span class="k">Status</span><span style="color:var(--warn)">Waiting on ${esc(LAB_EMAIL)}</span></div>
    </div>
    <button class="btn ghost" data-auth="refresh" style="width:100%;justify-content:center">Check again</button>
    <button class="btn ghost" data-auth="logout" style="width:100%;justify-content:center;margin-top:8px">Sign out</button>`);
}

async function viewRejected() {
  const p = authCtx, m = byId(p.member_id) || (await claimableMembers()).find(x => x.id === p.member_id);
  return authShell(`
    <div class="await-ic rej"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg></div>
    <h2 style="margin-bottom:4px">Registration Rejected</h2>
    <p class="meta" style="margin-bottom:16px">The lab account rejected the registration for <b style="color:#fff">${esc(p.email)}</b> under the name ${esc(m?.name || p.member_id)}.</p>
    ${p.reason ? `<div class="anotice" style="border-left-color:var(--red)"><b>Reason:</b> ${esc(p.reason)}</div>` : ""}
    <div class="ahint">Contact the lab account if this is a mistake. Re-registration has to be reopened from the Approval page.</div>
    <button class="btn ghost" data-auth="logout" style="width:100%;justify-content:center;margin-top:10px">Sign out</button>`);
}

/* Lupa password: Supabase mengirim link reset ke email itu. Balasannya
   sengaja sama untuk email terdaftar maupun tidak, supaya halaman ini
   tidak bisa dipakai menebak siapa yang punya akun. */
async function viewForgot() {
  return authShell(`
    <h2 style="margin-bottom:4px">Reset Password</h2>
    <p class="meta" style="margin-bottom:18px">Enter the email you sign in with. We'll send a link to set a new password.</p>
    <form class="aform" id="forgotForm">
      <label class="afield"><span class="label">Email</span>
        <input id="fg-email" type="email" autocomplete="username" placeholder="name@email.com" required></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:4px">Send Reset Link</button>
    </form>
    <div class="aalt">Remembered it? <button data-auth="login">Back to sign in</button></div>`);
}

/* Dibuka dari link di email: sesi sementara sudah ada, tinggal isi password baru. */
async function viewReset() {
  const { data: { user } } = await sb.auth.getUser();
  return authShell(`
    <h2 style="margin-bottom:4px">Set New Password</h2>
    <p class="meta" style="margin-bottom:18px">For <b style="color:#fff">${esc(user?.email || "")}</b>. At least 8 characters.</p>
    <form class="aform" id="resetForm">
      <input type="email" autocomplete="username" value="${esc(user?.email || "")}" hidden>
      <label class="afield"><span class="label">New password</span>
        <input id="rs-pass" type="password" autocomplete="new-password" placeholder="••••••••" minlength="8" required></label>
      <label class="afield"><span class="label">Repeat new password</span>
        <input id="rs-pass2" type="password" autocomplete="new-password" placeholder="••••••••" minlength="8" required></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:4px">Save Password</button>
    </form>
    <div class="aalt">Not you? <button data-auth="logout">Cancel and sign out</button></div>`);
}

async function authAction(act, arg) {
  if (act === "logout") { await sb.auth.signOut(); location.reload(); return; }
  if (act === "refresh") { return gate(); }
  authErr = ""; authInfo = "";
  authScreen = act;
  paintAuth();
}

async function paintAuth() {
  const root = $("#authRoot");
  const v = authScreen === "register" ? await viewRegister()
    : authScreen === "claim"    ? await viewClaim()
    : authScreen === "pending"  ? await viewPending()
    : authScreen === "rejected" ? await viewRejected()
    : authScreen === "forgot"   ? await viewForgot()
    : authScreen === "reset"    ? await viewReset()
    : await viewLogin();
  root.innerHTML = v;
  authErr = ""; authInfo = "";
  wireAuthForms();
}

/* Pesan gagal masuk. Supabase memberi error yang sama untuk email yang
   belum terdaftar dan password yang salah, jadi statusnya ditanyakan ke
   account_status() (db/11_account_status.sql). Kalau fungsi itu belum
   dipasang, pesannya kembali ke "tidak cocok" yang umum. */
async function loginError(e, email) {
  if (e.code === "email_not_confirmed" || /not confirmed/i.test(e.message || ""))
    return "This account's email has not been confirmed yet. Ask the lab account to confirm it in Supabase → Authentication → Users.";
  if (e.status === 429 || /rate limit|too many/i.test(e.message || ""))
    return "Too many sign-in attempts. Wait a few minutes, then try again.";
  if (!(e.code === "invalid_credentials" || /invalid login credentials/i.test(e.message || "")))
    return "Could not sign in: " + (e.message || e);

  const lupa = "Use Forgot password? if you don't remember it.";
  const { data: st, error } = await sb.rpc("account_status", { p_email: email });
  if (error) return "Email or password does not match. " + lupa;
  if (st === "none")
    return `${email} is not registered yet. Register first, then ask the lab account (${LAB_EMAIL}) to approve it.`;
  if (st === "pending")
    return `Wrong password. This account is also still waiting for approval — contact the lab account (${LAB_EMAIL}). ${lupa}`;
  if (st === "rejected")
    return `Wrong password. This account's registration was rejected — contact the lab account (${LAB_EMAIL}). ${lupa}`;
  return "Wrong password. " + lupa;
}

/* nama sudah dipegang akun lain, atau email ini sudah pernah mendaftar */
function claimError(e) {
  if (e.code === "23505" || /duplicate key/i.test(e.message || "")) {
    return /profiles_pkey/.test(e.message || "")
      ? "This email has already registered. Sign in with it instead."
      : "That name is already held by another account. Pick another or contact the lab account.";
  }
  return e.message;
}

function wireAuthForms() {
  const lf = $("#loginForm");
  if (lf) lf.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = lf.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Checking…";
    const { error } = await sb.auth.signInWithPassword({
      email: $("#li-email").value.trim(), password: $("#li-pass").value,
    });
    if (error) {
      authErr = await loginError(error, $("#li-email").value.trim());
      btn.disabled = false; btn.textContent = "Sign In";
      authScreen = "login"; return paintAuth();
    }
    btn.disabled = false; btn.textContent = "Sign In";
    gate();
  });

  const ff = $("#forgotForm");
  if (ff) ff.addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#fg-email").value.trim();
    const btn = ff.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Sending…";
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    btn.disabled = false; btn.textContent = "Send Reset Link";
    if (error) {
      authErr = error.status === 429 || /rate limit/i.test(error.message || "")
        ? "Too many reset emails were sent recently. Wait a while, then try again."
        : "Could not send the reset email: " + error.message;
      authScreen = "forgot"; return paintAuth();
    }
    authInfo = `If ${email} has an account, a reset link is on its way. Check the inbox and the spam folder — the link works once and expires after an hour.`;
    authScreen = "login"; paintAuth();
  });

  const sf = $("#resetForm");
  if (sf) sf.addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = $("#rs-pass").value, p2 = $("#rs-pass2").value;
    authScreen = "reset";
    if (p1.length < 8) { authErr = "Password must be at least 8 characters."; return paintAuth(); }
    if (p1 !== p2) { authErr = "The two passwords do not match."; return paintAuth(); }
    const btn = sf.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";
    const { error } = await sb.auth.updateUser({ password: p1 });
    btn.disabled = false; btn.textContent = "Save Password";
    if (error) {
      authErr = error.code === "same_password" ? "The new password must be different from the old one."
        : error.code === "weak_password" ? "That password is too weak. Pick a longer one."
        : "Could not save the password: " + error.message;
      return paintAuth();
    }
    recovering = false;
    history.replaceState(null, "", location.pathname);
    await gate();
    toast("Password updated. Use the new one next time you sign in.");
  });

  const rf = $("#regForm");
  if (rf) rf.addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#rg-email").value.trim(), p1 = $("#rg-pass").value, p2 = $("#rg-pass2").value;
    const mid = $("#rg-member").value;
    authScreen = "register";
    if (email.toLowerCase() === LAB_EMAIL) { authErr = "That address belongs to the lab account and cannot be registered here."; return paintAuth(); }
    if (p1.length < 8) { authErr = "Password must be at least 8 characters."; return paintAuth(); }
    if (p1 !== p2) { authErr = "The two passwords do not match."; return paintAuth(); }
    if (!mid) { authErr = "Pick your name from the list first."; return paintAuth(); }

    const btn = rf.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Sending…";
    const { data, error } = await sb.auth.signUp({ email, password: p1 });
    btn.disabled = false; btn.textContent = "Submit Registration";

    const sudahAda =
      /already (registered|been registered|exists)/i.test(error?.message || "") ||
      error?.code === "user_already_exists" ||
      /* Supabase kadang menyamarkan email yang sudah terpakai demi mencegah
         penelusuran akun: balasannya sukses tapi tanpa identitas. */
      (!error && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);

    if (sudahAda) {
      authErr = "This email already has an account, so no new one was created and your new password was not saved. " +
        "Sign in with the password you used the first time, or use Forgot password? to set a new one. " +
        "After signing in you will be asked to pick your name if your registration was never finished.";
      authScreen = "login";
      return paintAuth();
    }
    if (error) { authErr = error.message; return paintAuth(); }
    if (!data.session) {
      authErr = "Account created, but no session was returned. Ask the administrator to turn off “Confirm email” in Supabase → Authentication → Providers → Email, then sign in.";
      authScreen = "login"; return paintAuth();
    }
    const ins = await sb.from("profiles").insert({ user_id: data.user.id, email, member_id: mid, status: "pending" });
    if (ins.error) { authErr = claimError(ins.error); return paintAuth(); }
    gate();
  });

  const cf = $("#claimForm");
  if (cf) cf.addEventListener("submit", async e => {
    e.preventDefault();
    const mid = $("#cl-member").value;
    if (!mid) { authErr = "Pick your name first."; authScreen = "claim"; return paintAuth(); }
    const { data: { user } } = await sb.auth.getUser();
    const ins = await sb.from("profiles").insert({ user_id: user.id, email: user.email, member_id: mid, status: "pending" });
    if (ins.error) { authErr = claimError(ins.error); authScreen = "claim"; return paintAuth(); }
    gate();
  });
}

/* ---------------------------------------------------------------- gate */
function showApp(on) {
  $("#shell").hidden = !on;
  $("#authRoot").hidden = on;
  if (on) $("#authRoot").innerHTML = "";
}

async function gate() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    showApp(false);
    authScreen = linkErr ? "forgot" : "login";
    authErr = linkErr; linkErr = "";
    return paintAuth();
  }
  if (recovering) { showApp(false); authScreen = "reset"; return paintAuth(); }

  const user = session.user;
  const lab = (user.email || "").toLowerCase() === LAB_EMAIL;

  let profile = null;
  if (!lab) {
    const { data, error } = await sb.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (error) { console.error(error); }
    profile = data;
    if (!profile) { showApp(false); authCtx = { email: user.email }; authScreen = "claim"; return paintAuth(); }
    if (profile.status !== "approved") {
      showApp(false); authCtx = profile;
      authScreen = profile.status === "rejected" ? "rejected" : "pending";
      return paintAuth();
    }
  }

  try {
    await loadAll();
  } catch (e) {
    showApp(false);
    authErr = "Could not load data: " + (e.message || e);
    authScreen = "login"; return paintAuth();
  }

  const member = lab ? null : byId(profile.member_id);
  ME = { user, profile, member, level: member?.level || "inti", isLab: lab };

  if (lab) await loadProfiles();

  showApp(true);
  route = location.hash.replace("#", "") || (lab ? "approval" : "dashboard");
  if (!visibleMenu().some(m => m.id === route)) route = "dashboard";
  render();
  wireChrome();
  subscribeRealtime();
  loadMail();
  initPush();
  if (!window.__mailTimer) window.__mailTimer = setInterval(() => loadMail(), 180000);
}

gate();
