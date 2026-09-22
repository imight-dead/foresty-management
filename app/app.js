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
    '<h1 style="color:#E4181A">Konfigurasi belum diisi</h1>' +
    '<p>Salin <code>config.example.js</code> menjadi <code>config.js</code>, ' +
    'lalu isi SUPABASE_URL dan SUPABASE_ANON_KEY dari Supabase → Project Settings → API.</p></div>';
  throw new Error("config.js belum diisi");
}

const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------------------------------------------------------------- utilitas */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ini = n => String(n).split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const MO = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const DW = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const fDate  = d => `${d.getDate()} ${MO[d.getMonth()]} ${d.getFullYear()}`;
const fShort = d => `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
const fTime  = d => `${String(d.getHours()).padStart(2,"0")}.${String(d.getMinutes()).padStart(2,"0")}`;
const key    = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const STATUS_LABEL = { ongoing:"Ongoing", completed:"Completed", soon:"Coming Soon" };
const ST_LABEL = { todo:"Belum", doing:"Proses", done:"Selesai" };
const LEVEL_LABEL = { inti:"Akses Penuh", staff:"Akses Terbatas" };

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

async function loadAll() {
  const [mem, div, dmem, tsk, prg, pic, chk, log, nrd, mtg] = await Promise.all([
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
  ]);
  for (const r of [mem, div, dmem, tsk, prg, pic, chk, log, nrd])
    if (r.error) throw r.error;

  MEMBERS = mem.data;

  DIVISIONS = div.data.map(d => ({
    id: d.id, name: d.name, tagline: d.tagline,
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
}

/* menulis jejak perubahan; gagal pun tidak membatalkan aksi utama */
const writeLog = (pid, text) =>
  sb.from("activity_log").insert({ program_id: pid, actor: ME.user.id, text }).then(() => {}, () => {});

/* ---------------------------------------------------------------- aksi */
async function toggleCheck(pid, cid) {
  const p = prog(pid), c = p.checklist.find(x => x.id === cid);
  if (!canCheck(c)) return toast("Hanya PIC item ini atau pengurus inti yang dapat mengubahnya.", true);
  const next = !c.done;
  c.done = next;                                    // tampilkan dulu, sinkronkan sesudahnya
  rerender();
  const { error } = await sb.from("checklist").update({
    done: next, done_by: next ? ME.user.id : null, done_at: next ? new Date().toISOString() : null,
  }).eq("id", cid);
  if (error) { c.done = !next; rerender(); return fail(error, "Gagal menyimpan centang"); }
  writeLog(pid, `${ME.member?.name || "Akun lab"} menandai "${c.text}" ${next ? "selesai" : "belum selesai"}`);
}

async function cycleTask(did, mid, tid) {
  if (!canTask(mid)) return toast("Kamu hanya dapat mengubah tugas atas namamu sendiri.", true);
  const d = DIVISIONS.find(x => x.id === did);
  const t = d.people.find(x => x.m === mid).tasks.find(x => x.id === tid);
  const order = ["todo", "doing", "done"];
  const prev = t.status;
  t.status = order[(order.indexOf(prev) + 1) % 3];
  rerender();
  const { error } = await sb.from("tasks").update({ status: t.status }).eq("id", tid);
  if (error) { t.status = prev; rerender(); fail(error, "Gagal menyimpan status tugas"); }
}

async function addCheck(pid, text, who) {
  const { data, error } = await sb.from("checklist")
    .insert({ program_id: pid, text, member_id: who, created_by: ME.user.id })
    .select().single();
  if (error) return fail(error, "Gagal menambah item");
  prog(pid).checklist.push({ id: data.id, text: data.text, who: data.member_id, done: false, due: null });
  writeLog(pid, `${ME.member?.name || "Akun lab"} menambahkan item "${text}"`);
  rerender();
  toast("Item checklist ditambahkan.");
}

async function addTask(did, mid, text) {
  if (!canTask(mid)) return toast("Kamu hanya dapat menambah tugas atas namamu sendiri.", true);
  const { data, error } = await sb.from("tasks")
    .insert({ division_id: did, member_id: mid, text, created_by: ME.user.id })
    .select().single();
  if (error) return fail(error, "Gagal menambah tugas");
  DIVISIONS.find(x => x.id === did).people.find(x => x.m === mid).tasks.push(data);
  rerender();
  toast("Tugas ditambahkan.");
}

async function markRead(keys) {
  const baru = keys.filter(k => !NREAD.has(k));
  if (!baru.length) return;
  baru.forEach(k => NREAD.add(k));
  rerender();
  const { error } = await sb.from("notif_read")
    .upsert(baru.map(k => ({ user_id: ME.user.id, notif_key: k })), { onConflict: "user_id,notif_key" });
  if (error) fail(error, "Gagal menyimpan status baca");
}

/* ---------------------------------------------------------------- notulen */
let meetingsReady = true;

const ROOMS = [
  { id: "koorinti", label: "Rapat Koorinti",                short: "Koorinti" },
  { id: "hr",       label: "Rapat Divisi HR",               short: "HR",              div: "Human Resource" },
  { id: "medpart",  label: "Rapat Divisi Media & Partner",  short: "Media & Partner", div: "Media & Partner" },
  { id: "sg",       label: "Rapat Divisi Study Group",      short: "Study Group",     div: "Study Group" },
  { id: "rnd",      label: "Rapat Divisi RnD",              short: "RnD",             div: "Research & Development" },
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
      const kata = r.d === 0 ? "hari ini" : r.d === 1 ? "besok" : `${r.d} hari lagi`;
      out.push({
        id: `${p.id}:${r.l}`, trig: r.l, fire, pid: p.id, kind: "event",
        text: `Reminder: <b>${esc(p.title)}</b> akan berlangsung ${kata}, ${fDate(p.date)} pukul ${fTime(p.date)} di ${esc(p.place)}.`,
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
          ? `Terlambat: checklist <b>${esc(c.text)}</b> pada ${esc(p.title)} melewati tenggat ${fDate(c.due)} pukul ${fTime(c.due)}. PIC: ${esc(pic?.name || "-")}.`
          : `Tenggat besok: checklist <b>${esc(c.text)}</b> pada ${esc(p.title)} jatuh tempo ${fDate(c.due)} pukul ${fTime(c.due)}. PIC: ${esc(pic?.name || "-")}.`,
      });
    }
  }
  for (const mt of MEETINGS) {
    for (const r of RULES) {
      const fire = new Date(mt.held); fire.setDate(fire.getDate() - r.d); fire.setHours(7, 0, 0, 0);
      if (fire > now || mt.held < now) continue;
      const kata = r.d === 0 ? "hari ini" : r.d === 1 ? "besok" : `${r.d} hari lagi`;
      out.push({
        id: `mtg:${mt.id}:${r.l}`, trig: r.l, fire, mid: mt.id, kind: "meeting",
        text: `Reminder: <b>${esc(mt.title)}</b> akan berlangsung ${kata}, ${fDate(mt.held)} pukul ${fTime(mt.held)}${mt.place ? " di " + esc(mt.place) : ""}.`,
      });
    }
  }
  return out.sort((a, b) => b.fire - a.fire);
}
const unreadCount = () => buildNotifs().filter(n => !NREAD.has(n.id)).length;

function allEvents() {
  const now = new Date();
  const ev = PROGRAMS.map(p => ({ when: p.date, title: p.title, pid: p.id, type: p.status, sub: p.place }));
  MEETINGS.forEach(m => ev.push({
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
  return ev.sort((a, b) => a.when - b.when);
}

/* ---------------------------------------------------------------- fragmen */
const tag = s => `<span class="tag t-${s === "soon" ? "soon" : s}">${s === "ongoing" ? '<i class="dot pulse"></i>' : ""}${STATUS_LABEL[s]}</span>`;
const avatars = ids => `<div class="avs">${ids.map(i => `<span class="av-s" title="${esc(byId(i)?.name || "")}">${ini(byId(i)?.name || "?")}</span>`).join("")}</div>`;

function countdown(d) {
  return `<div class="cd num" data-ts="${d.getTime()}">
    <span data-u="d">--<b>Hari</b></span><span data-u="h">--<b>Jam</b></span><span data-u="m">--<b>Min</b></span><span data-u="s">--<b>Det</b></span></div>`;
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
  if (ms < 0) return "Lewat " + Math.ceil(-ms / 864e5) + " hari";
  const days = Math.ceil(ms / 864e5);
  return days <= 1 ? "Kurang dari 24 jam" : "T-" + String(days).padStart(2, "0") + " hari";
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
function go(r) { route = r; location.hash = r; render(); window.scrollTo({ top: 0 }); $("#sidebar").classList.remove("open"); }
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
        <div class="kick">Foresty Laboratory · Periode 2026 / 2027</div>
        <h1>${esc(title)}<span class="cursor"></span></h1>
        <p class="lead">${lead}</p>
      </div>
      <div class="hero-clock">
        <div class="label">Waktu Sistem</div>
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
    <button class="dl-row" ${e.mid ? `data-minute="${e.mid}"` : `data-open-prog="${e.pid}"`}>
      <span class="idx num">${String(i + 1).padStart(2, "0")}</span>
      <span class="nm"><b>${esc(e.title)}</b><span class="meta">${esc(e.sub)} · ${fShort(e.when)} · ${fTime(e.when)}</span></span>
      ${countdown(e.when)}
    </button>`).join("") || `<div class="empty">Tidak ada agenda terdekat.</div>`;

  const sapaan = ME.isLab ? "Akun Lab" : ME.member.name.split(" ")[0];

  return heroBlock("Operations Console",
    `Halo, ${esc(sapaan)}. Pusat kendali program kerja, penugasan divisi, dan agenda Foresty Laboratory.`) + `
    <div class="grid g-sum" style="margin-bottom:22px">
      ${stat("Program Ongoing", ongoing, "red", "dari " + PROGRAMS.length + " total program")}
      ${stat("Checklist Belum Selesai", openTasks, "", "tersebar di program aktif")}
      ${stat("Notifikasi Belum Dibaca", unread, unread ? "red" : "ok", "pemicu H-3 / H-1 / H-0")}
      ${stat("Anggota Terdaftar", MEMBERS.length, "", DIVISIONS.length + " divisi kepengurusan")}
    </div>
    <div class="dash">
      <section class="card">
        <div class="sec-head"><div><div class="kick">Timeline</div><h2>Upcoming Deadlines &amp; Events</h2></div></div>
        <div class="rule" style="margin:12px 0 6px"></div>
        <div class="dl">${rows}</div>
      </section>
      <section class="card">
        <div class="sec-head"><div><div class="kick">Kalender</div><h2>Agenda Bulanan</h2></div></div>
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
      ${sel.length ? sel.map(e => `<button class="ev" ${e.mid ? `data-minute="${e.mid}"` : `data-open-prog="${e.pid}"`}>
          <i class="dot" style="margin-top:7px;background:${e.type === "completed" ? "var(--ok)" : e.type === "soon" ? "var(--dim)" : "var(--red)"}"></i>
          <span><span class="evn" style="font-size:12.5px">${esc(e.title)}</span>
          <span class="meta">${fTime(e.when)} · ${esc(e.sub)}</span></span></button>`).join("")
        : `<div class="meta">Tidak ada agenda pada tanggal ini.</div>`}
    </div>` : `<div class="day-detail"><div class="meta">Pilih tanggal untuk melihat detail agenda.</div></div>`;

  return `<div class="cal-head">
      <span class="mo">${MO[m]} ${y}</span>
      <button class="cal-nav" data-cal="-1" aria-label="Bulan sebelumnya">&lt;</button>
      <button class="cal-nav" data-cal="0" aria-label="Bulan ini">•</button>
      <button class="cal-nav" data-cal="1" aria-label="Bulan berikutnya">&gt;</button>
    </div>
    <div class="cal">${["Sen","Sel","Rab","Kam","Jum","Sab","Min"].map(d => `<span class="dow">${d}</span>`).join("")}${cells}</div>
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
        ${p.status === "completed" ? '<span class="meta">Selesai</span>' : `<span class="meta num">${cdShort(p.date)}</span>`}
      </div>
    </button>`;
  }).join("") || `<div class="empty">Belum ada program pada kategori ini.</div>`;

  return `<div class="sec-head" style="justify-content:space-between">
      <div><div class="kick">Program Kerja</div><h1>Programs</h1>
      <p class="sec-sub">Seluruh program kerja laboratorium periode 26/27. Klik kartu untuk membuka detail, PIC, dan checklist persiapan.</p></div>
      ${canAll() ? `<button class="btn" data-newprog>+ Program Baru</button>` : ""}
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
      <span class="who">PIC ${esc(pic?.name || "-")}${c.due ? ` · tenggat ${fShort(c.due)} ${fTime(c.due)}` : ""}
      ${late ? '<span class="tag t-over" style="margin-left:6px">Overdue</span>' : ""}</span></span>
    </button>`;
  }).join("");

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        ${tag(p.status)}
        <h2 style="margin:10px 0 6px">${esc(p.title)}</h2>
        <div class="meta">${DW[p.date.getDay()]}, ${fDate(p.date)} · ${fTime(p.date)} WIB · ${esc(p.place)}</div>
        ${p.status !== "completed" ? `<div style="margin-top:14px">${countdown(p.date)}</div>` : ""}
        ${canAll() ? `<div style="margin-top:14px"><button class="btn ghost sm" data-editprog="${p.id}">Ubah Program</button></div>` : ""}
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
          <div class="label" style="margin-bottom:9px">Progres Persiapan</div>
          <div style="display:flex;align-items:baseline;gap:8px">
            <span class="num" style="font-family:var(--disp);font-size:30px;font-weight:700;color:${pr.pct === 100 ? "var(--ok)" : "var(--red)"}">${pr.pct}%</span>
            <span class="meta">${pr.done} dari ${pr.total} item selesai</span>
          </div>
          <div class="bar${pr.pct === 100 ? " done" : ""}" style="margin-top:9px"><i style="width:${pr.pct}%"></i></div>
          ${p.log.length ? `<div class="label" style="margin:16px 0 8px">Riwayat Aktivitas</div>
            <div class="log">${p.log.map(l => `<span><b>${fShort(l.t)} ${fTime(l.t)}</b> — ${esc(l.s)}</span>`).join("")}</div>` : ""}
        </div>
      </div>
      <div>
        <div class="label" style="margin-bottom:9px">Checklist Keperluan &amp; Persiapan</div>
        <div class="stack">${items || `<div class="empty">Belum ada item checklist.</div>`}</div>
        ${canAll() ? `<form class="addrow" data-addcheck="${p.id}">
            <input class="ainput" name="text" placeholder="Tambah item checklist baru..." required>
            <select class="ainput" name="who" style="max-width:190px">${MEMBERS.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>
            <button class="btn sm" type="submit">Tambah</button>
          </form>`
          : `<div class="meta" style="margin-top:10px">Kamu hanya dapat mencentang item yang tercatat atas namamu.</div>`}
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
        <div class="kick">${p ? "Ubah Program" : "Program Baru"}</div>
        <h2 style="margin:8px 0 4px">${p ? esc(p.title) : "Tambah Program Kerja"}</h2>
        <div class="meta">Tersimpan ke database lab, langsung terlihat oleh semua pengurus.</div>
      </div></div>
    <div class="modal-body">
      <form class="aform" data-progform="${p ? p.id : ""}">
        <label class="afield"><span class="label">Nama program</span>
          <input class="ainput" name="title" value="${p ? esc(p.title) : ""}" placeholder="Labshow PKKMB Prodi ..." required></label>

        <div class="cols" style="gap:13px">
          <label class="afield"><span class="label">Tanggal</span>
            <input class="ainput" type="date" name="tgl" value="${dInput(d)}" required></label>
          <label class="afield"><span class="label">Jam (WIB)</span>
            <input class="ainput" type="time" name="jam" value="${tInput(d)}" required></label>
          <label class="afield"><span class="label">Status</span>
            <select class="ainput" name="status">
              ${["ongoing", "soon", "completed"].map(x =>
                `<option value="${x}"${p && p.status === x ? " selected" : ""}>${STATUS_LABEL[x]}</option>`).join("")}
            </select></label>
        </div>

        <label class="afield"><span class="label">Tempat</span>
          <input class="ainput" name="place" value="${p ? esc(p.place) : ""}" placeholder="Aula Fakultas / Daring"></label>

        <label class="afield"><span class="label">Deskripsi</span>
          <textarea class="ainput" name="descr" rows="3" placeholder="Gambaran singkat program">${p ? esc(p.desc) : ""}</textarea></label>

        <div class="afield">
          <span class="label">Person in Charge</span>
          <div class="picgrid">${MEMBERS.map(m => `
            <label class="picopt">
              <input type="checkbox" name="pic" value="${m.id}"${pics.includes(m.id) ? " checked" : ""}>
              <span><b>${esc(m.name)}</b><i>${esc(m.role)}</i></span>
            </label>`).join("")}</div>
          <span class="meta" style="margin-top:6px">PIC yang dipilih otomatis muncul di menu Division dan Foresty 26/27.</span>
        </div>

        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:6px">
          <button class="btn" type="submit">${p ? "Simpan Perubahan" : "Buat Program"}</button>
          ${p ? `<button class="btn ghost" type="button" data-progdel="${p.id}">Hapus Program</button>` : ""}
        </div>
      </form>
    </div>`;
}

async function saveProgram(pid, f) {
  const pics = [...f.querySelectorAll("input[name=pic]:checked")].map(x => x.value);
  const title = f.title.value.trim();
  if (!title) return toast("Nama program belum diisi.", true);

  const starts = new Date(`${f.tgl.value}T${f.jam.value || "08:00"}`);
  if (isNaN(starts)) return toast("Tanggal atau jam belum benar.", true);

  const body = {
    title, status: f.status.value, starts_at: starts.toISOString(),
    place: f.place.value.trim(), descr: f.descr.value.trim(),
  };

  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;

  let id = pid;
  if (pid) {
    const { error } = await sb.from("programs").update(body).eq("id", pid);
    if (error) { btn.disabled = false; return fail(error, "Gagal menyimpan program"); }
  } else {
    id = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "program")
       + "-" + Math.random().toString(36).slice(2, 6);
    const { error } = await sb.from("programs").insert({ id, ...body, sort: PROGRAMS.length + 1 });
    if (error) { btn.disabled = false; return fail(error, "Gagal membuat program"); }
  }

  /* PIC ditulis ulang: hapus yang lama, pasang pilihan sekarang */
  await sb.from("program_pics").delete().eq("program_id", id);
  if (pics.length) {
    const { error } = await sb.from("program_pics")
      .insert(pics.map((m, i) => ({ program_id: id, member_id: m, sort: i + 1 })));
    if (error) fail(error, "Program tersimpan, tapi PIC gagal dipasang");
  }

  await loadAll();
  progTab = body.status;
  showModal("prog", id);
  render();
  toast(pid ? "Program diperbarui." : "Program dibuat.");
}

async function deleteProgram(pid) {
  const p = prog(pid);
  if (!confirm(`Hapus "${p.title}" beserta seluruh checklist dan PIC-nya? Tindakan ini tidak bisa dibatalkan.`)) return;
  const { error } = await sb.from("programs").delete().eq("id", pid);
  if (error) return fail(error, "Gagal menghapus program");
  closeModal();
  await loadAll();
  render();
  toast("Program dihapus.");
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
      <div class="label">Divisi</div>
      <h3 style="margin:6px 0 7px">${esc(d.name)}</h3>
      <p class="meta" style="min-height:34px">${esc(d.tagline)}</p>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px">
        <span class="label">Tugas &amp; Checklist</span>
        ${st.total
          ? `<span class="num" style="font-size:11px;color:${st.pct === 100 ? "var(--ok)" : "var(--red)"}">${st.done}/${st.total} · ${st.pct}%</span>`
          : `<span class="meta">belum ada</span>`}
      </div>
      <div class="bar${st.pct === 100 && st.total ? " done" : ""}"><i style="width:${st.pct}%"></i></div>
      <div class="meta" style="margin-top:9px"><span class="num">${String(st.progs).padStart(2, "0")}</span> program</div>
      <div style="margin-top:13px">${avatars(d.people.map(p => p.m))}</div>
    </button>`;
  }).join("");

  return `<div class="sec-head"><div><div class="kick">Struktur Kepengurusan</div><h1>Division</h1>
      <p class="sec-sub">Pembagian tugas tiap divisi, dikelompokkan per penanggung jawab. Klik status tugas untuk memutar: Belum → Proses → Selesai.</p></div></div>
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
    <div class="label" style="margin-bottom:8px">Tanggung Jawab Program</div>
    ${asPic.length ? `<div class="chips">${asPic.map(p =>
      `<button class="chip" data-open-prog="${p.id}">PIC · ${esc(p.title)}</button>`).join("")}</div>` : ""}
    ${items.length ? `<div class="kan" style="margin-top:9px">${items.map(({ p, c }) => {
      const late = c.due && !c.done && c.due < new Date();
      return `<button class="task${c.done ? " done" : ""}${canCheck(c) ? "" : " locked"}" data-check="${p.id}|${c.id}">
        <span class="st ${c.done ? "done" : late ? "doing" : "todo"}"></span>
        <span class="tx">${esc(c.text)}<span class="who" style="display:block">${esc(p.title)}${c.due ? ` · tenggat ${fShort(c.due)}` : ""}</span></span>
        <span class="stl">${c.done ? "Selesai" : late ? "Telat" : "Belum"}</span></button>`;
    }).join("")}</div>` : ""}
  </div>`;
}

const taskRow = (did, mid, t) => `<button class="task${t.status === "done" ? " done" : ""}${canTask(mid) ? "" : " locked"}" data-task="${did}|${mid}|${t.id}">
  <span class="st ${t.status}"></span><span class="tx">${esc(t.text)}</span><span class="stl">${ST_LABEL[t.status]}</span></button>`;

const addTaskForm = (did, mid) => canTask(mid)
  ? `<form class="addrow" data-addtask="${did}|${mid}">
       <input class="ainput" name="text" placeholder="Tambah tugas..." required>
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
      <div class="label" style="margin-bottom:7px">Tugas Divisi</div>
      <div class="kan">${p.tasks.map(t => taskRow(d.id, p.m, t)).join("") || `<div class="meta">Belum ada tugas divisi.</div>`}</div>
      ${addTaskForm(d.id, p.m)}
      ${dutyBlock(p.m)}
    </div>`;
  }).join("");

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        <div class="kick">Divisi Kepengurusan 26/27</div>
        <h2 style="margin:8px 0 6px">${esc(d.name)}</h2>
        <div class="meta">${esc(d.tagline)}</div>
      </div></div>
    <div class="modal-body">
      <div class="label">Tugas per Penanggung Jawab</div>
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
      <div class="meta" style="justify-content:center">${esc(m.div)} · ${n} program</div>
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
  if (rest.length) groups.push({ name: "Anggota Lain", people: rest });

  const sections = groups.filter(g => g.people.length).map(g => `
    <section class="mgroup">
      <div class="mgroup-h">
        <h3>${esc(g.name)}</h3>
        <span class="meta num">${String(g.people.length).padStart(2, "0")} orang</span>
      </div>
      <div class="grid g4">${g.people.map(memberCard).join("")}</div>
    </section>`).join("");

  return `<div class="sec-head"><div><div class="kick">Direktori Anggota</div><h1>Foresty 26/27</h1>
      <p class="sec-sub">Seluruh pengurus, asisten laboratorium, dan tim riset periode 2026/2027, dikelompokkan per jabatan. Klik anggota untuk melihat profil dan program yang menjadi tanggung jawabnya.</p></div></div>
    <div class="rule"></div>
    <div class="advisor">
      <svg class="fp" aria-hidden="true"><use href="#ic-fp"/></svg>
      <span class="av-s adv">${ADVISOR.init}</span>
      <div style="position:relative">
        <div class="kick">Dosen Pembimbing</div>
        <div class="advname">${esc(ADVISOR.name)}</div>
        <div class="meta">${esc(ADVISOR.role)}</div>
      </div>
    </div>
    <div class="label" style="margin:26px 0 18px">Pengurus, Aslab &amp; Tim Riset · ${MEMBERS.length} orang</div>
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
          <div class="kick">Aslab · Foresty 26/27</div>
          <h2 style="margin:6px 0 4px">${esc(m.name)}</h2>
          <div class="meta">${esc(m.role)} · ${esc(m.div)}</div>
        </div>
      </div></div>
    <div class="modal-body">
      <div class="cols">
        <div class="pane">
          <div class="label" style="margin-bottom:8px">Profil</div>
          <div class="kv"><span class="k">Nama</span><span>${esc(m.name)}</span></div>
          <div class="kv"><span class="k">Jabatan</span><span>${esc(m.role)}</span></div>
          <div class="kv"><span class="k">Divisi</span><span>${esc(m.div)}</span></div>
          <div class="kv"><span class="k">Akses</span><span>${LEVEL_LABEL[m.level]}</span></div>
          <div class="kv"><span class="k">Periode</span><span class="num">2026 / 2027</span></div>
        </div>
        <div class="pane">
          <div class="label" style="margin-bottom:8px">Tugas Divisi</div>
          ${myTasks.length ? `<div class="kan">${myTasks.map(t => taskRow(div.id, mid, t)).join("")}</div>`
            : `<div class="meta">Belum ada tugas divisi tercatat.</div>`}
          ${div ? addTaskForm(div.id, mid) : ""}
        </div>
      </div>
      <div>
        <div class="label" style="margin-bottom:9px">Program yang Menjadi Tanggung Jawab (PIC)</div>
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
        }).join("")}</div>` : `<div class="empty">Belum terdaftar sebagai PIC program mana pun.</div>`}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- NOTIFICATION */
function viewNotification() {
  const ns = buildNotifs();
  const rows = ns.map(n => {
    const un = !NREAD.has(n.id);
    return `<button class="nrow${un ? " unread" : ""}" data-notif="${n.id}" ${n.mid ? `data-mid="${n.mid}"` : `data-pid="${n.pid}"`}>
      <span class="ni"><svg viewBox="0 0 24 24">${n.kind === "task"
        ? '<path d="M4 6h16M4 12h16M4 18h10"/>'
        : n.kind === "meeting"
        ? '<path d="M5 3h11l3 3v15H5z"/><path d="M9 9h7M9 13h7M9 17h4"/>'
        : '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'}</svg></span>
      <span style="flex:1">
        <span class="nt"><span class="trig${n.trig === "H-0" ? " h0" : ""}">${n.trig}</span>${n.text}</span>
        <span class="nd">${fShort(n.fire)} · ${fTime(n.fire)} · ${un ? "belum dibaca" : "dibaca"}</span>
      </span>
    </button>`;
  }).join("") || `<div class="empty">Belum ada notifikasi.</div>`;

  return `<div class="sec-head" style="justify-content:space-between">
      <div><div class="kick">Pengingat Otomatis</div><h1>Notification</h1>
      <p class="sec-sub">Notifikasi dibangkitkan otomatis dari tanggal program dan tenggat checklist. Pemicu aktif: H-3, H-1, dan hari-H pukul 07.00.</p></div>
      <button class="btn ghost" data-readall>Tandai semua dibaca</button>
    </div>
    <div class="rule"></div>
    <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:20px">
      <div class="pane"><div class="label">Aturan H-3</div><div class="meta" style="margin-top:5px">Pengingat awal persiapan program.</div></div>
      <div class="pane" style="box-shadow:inset 0 0 0 1px var(--edge)"><div class="label" style="color:var(--red)">Aturan H-1 · wajib</div><div class="meta" style="margin-top:5px">“Rapat [nama] akan berlangsung besok, [tanggal] pukul [jam].”</div></div>
      <div class="pane"><div class="label">Aturan H-0</div><div class="meta" style="margin-top:5px">Pengingat pagi di hari pelaksanaan.</div></div>
      <div class="pane"><div class="label">Tenggat Checklist</div><div class="meta" style="margin-top:5px">H-1 sebelum tenggat, lalu status Overdue.</div></div>
    </div>
    ${mailSection()}
    <div class="label" style="margin-bottom:12px">Agenda &amp; Tenggat</div>
    <div class="stack">${rows}</div>`;
}

function mailSection() {
  const unread = MAIL.messages.filter(m => m.unread);
  if (!unread.length) return "";
  return `<div class="label" style="margin-bottom:12px">Email Masuk Belum Dibaca · ${unread.length}</div>
    <div class="stack" style="margin-bottom:26px">${unread.map(m => {
      const d = new Date(m.date);
      return `<a class="nrow unread" href="${gmailLink("#inbox/" + m.id)}" target="_blank" rel="noopener">
        <span class="ni"><svg viewBox="0 0 24 24"><path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/></svg></span>
        <span style="flex:1">
          <span class="nt"><span class="trig h0">EMAIL</span>Email baru dari <b>${esc(m.from)}</b> — ${esc(m.subject)}</span>
          <span class="nd">${fShort(d)} · ${fTime(d)} · klik untuk membuka di Gmail</span>
        </span>
      </a>`;
    }).join("")}</div>`;
}

/* ---------------------------------------------------------------- NOTULEN */
let roomTab = null;

function viewMinutes() {
  const rooms = myRooms();
  if (!rooms.length) return `<div class="empty">Belum ada ruang rapat untuk akunmu.</div>`;
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
        ${akan ? `<span class="tag t-ongoing"><i class="dot pulse"></i>Akan Datang</span>`
               : `<span class="tag ${ada ? "t-completed" : "t-soon"}">${ada ? "Sudah Dinotulenkan" : "Belum Dinotulenkan"}</span>`}
        <span class="meta num">${fShort(m.held)}</span>
      </div>
      <h3 style="margin:11px 0 6px">${esc(m.title)}</h3>
      <div class="meta" style="margin-bottom:12px">${DW[m.held.getDay()]}, ${fTime(m.held)} WIB${m.place ? " · " + esc(m.place) : ""}</div>
      ${countdown(m.held)}
    </button>`;
  }).join("") || `<div class="empty">${meetingsReady
      ? "Belum ada rapat di ruang ini."
      : "Tabel rapat belum dibuat. Jalankan db/06_notulen.sql di Supabase."}</div>`;

  return `<div class="sec-head" style="justify-content:space-between">
      <div><div class="kick">Jadwal &amp; Notulen</div><h1>Meeting</h1>
      <p class="sec-sub">Jadwal rapat tiap ruang beserta hitung mundurnya. Klik satu kartu untuk membaca atau menulis notulennya.</p></div>
      ${meetingsReady ? `<button class="btn" data-newminute>+ Jadwalkan Rapat</button>` : ""}
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
  if (!m) return `<div class="modal-body"><div class="empty">Rapat tidak ditemukan.</div></div>`;
  const akan = m.held >= new Date();
  const bisa = canWriteMinute(m);

  const isi = bisa
    ? `<form data-noteform="${m.id}">
         <textarea class="ainput notulen-edit" name="notes" rows="14"
           placeholder="1. Pembahasan...&#10;2. Keputusan...&#10;3. Tindak lanjut...">${esc(m.notes)}</textarea>
         <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:11px;align-items:center">
           <button class="btn" type="submit">Simpan Notulen</button>
           <span class="meta">${m.notes.trim()
             ? `Terakhir diperbarui ${fShort(new Date(m.updated_at))} ${fTime(new Date(m.updated_at))}`
             : akan ? "Boleh diisi setelah rapat berlangsung." : "Belum pernah diisi."}</span>
         </div>
       </form>`
    : `<div class="notulen">${esc(m.notes) || '<span class="meta">Notulen belum diisi.</span>'}</div>`;

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        <div class="kick">${esc(room(m.room).label)}</div>
        <h2 style="margin:8px 0 6px">${esc(m.title)}</h2>
        <div class="meta">${DW[m.held.getDay()]}, ${fDate(m.held)} · ${fTime(m.held)} WIB${m.place ? " · " + esc(m.place) : ""}</div>
        <div style="margin-top:14px">${countdown(m.held)}</div>
        ${bisa ? `<div style="margin-top:14px;display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn ghost sm" data-editminute="${m.id}">Ubah Jadwal</button>
          <button class="btn ghost sm" data-minutedel="${m.id}">Hapus</button>
        </div>` : ""}
      </div></div>
    <div class="modal-body">
      <div>
        <div class="label" style="margin-bottom:9px">Notulen</div>
        ${isi}
      </div>
    </div>`;
}

async function saveNotes(id, f) {
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;
  const { error } = await sb.from("meetings").update({ notes: f.notes.value }).eq("id", id);
  btn.disabled = false;
  if (error) return fail(error, "Gagal menyimpan notulen");
  await loadAll();
  showModal("minute", id);
  render();
  toast("Notulen tersimpan.");
}

function modalMinuteForm(id) {
  const m = id ? MEETINGS.find(x => x.id === id) : null;
  const d = m ? m.held : new Date();
  const rooms = myRooms();

  return `<div class="modal-head"><div class="dots"></div>
      <div style="position:relative">
        <div class="kick">${m ? "Ubah Rapat" : "Rapat Baru"}</div>
        <h2 style="margin:8px 0 4px">${m ? esc(m.title) : "Jadwalkan Rapat"}</h2>
        <div class="meta">Notulennya ditulis nanti lewat kartu rapat ini. Hanya terbaca oleh anggota ruang yang dipilih.</div>
      </div></div>
    <div class="modal-body">
      <form class="aform" data-minuteform="${m ? m.id : ""}">
        <div class="cols" style="gap:13px">
          <label class="afield"><span class="label">Ruang rapat</span>
            <select class="ainput" name="room">
              ${rooms.map(r => `<option value="${r}"${(m ? m.room : roomTab) === r ? " selected" : ""}>${esc(room(r).label)}</option>`).join("")}
            </select></label>
          <label class="afield"><span class="label">Tanggal</span>
            <input class="ainput" type="date" name="tgl" value="${dInput(d)}" required></label>
          <label class="afield"><span class="label">Jam</span>
            <input class="ainput" type="time" name="jam" value="${tInput(d)}" required></label>
        </div>

        <label class="afield"><span class="label">Judul rapat</span>
          <input class="ainput" name="title" value="${m ? esc(m.title) : ""}" placeholder="Rapat koordinasi persiapan Labshow" required></label>

        <label class="afield"><span class="label">Tempat</span>
          <input class="ainput" name="place" value="${m ? esc(m.place) : ""}" placeholder="Ruang Lab / Daring"></label>

        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:6px">
          <button class="btn" type="submit">${m ? "Simpan Perubahan" : "Jadwalkan"}</button>
        </div>
      </form>
    </div>`;
}

async function saveMinute(id, f) {
  const held = new Date(`${f.tgl.value}T${f.jam.value || "19:00"}`);
  if (isNaN(held)) return toast("Tanggal atau jam belum benar.", true);
  const title = f.title.value.trim();
  if (!title) return toast("Judul rapat belum diisi.", true);

  const body = {
    room: f.room.value, title, held_at: held.toISOString(),
    place: f.place.value.trim(),
  };

  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;

  const res = id
    ? await sb.from("meetings").update(body).eq("id", id).select().single()
    : await sb.from("meetings").insert({ ...body, created_by: ME.user.id }).select().single();

  if (res.error) { btn.disabled = false; return fail(res.error, "Gagal menyimpan notulen"); }

  await loadAll();
  roomTab = body.room;
  showModal("minute", res.data.id);
  render();
  toast(id ? "Rapat diperbarui." : "Rapat tersimpan.");
}

async function deleteMinute(id) {
  const m = MEETINGS.find(x => x.id === id);
  if (!confirm(`Hapus rapat "${m.title}" beserta notulennya? Tindakan ini tidak bisa dibatalkan.`)) return;
  const { error } = await sb.from("meetings").delete().eq("id", id);
  if (error) return fail(error, "Gagal menghapus notulen");
  closeModal();
  await loadAll();
  render();
  toast("Rapat dihapus.");
}

/* ---------------------------------------------------------------- INBOX */
function gmailLink(after) {
  // AccountChooser memastikan Gmail dibuka pada akun lab, bukan akun pribadi
  // yang kebetulan sedang aktif di browser.
  return "https://accounts.google.com/AccountChooser?Email=" + encodeURIComponent(LAB_EMAIL) +
         "&continue=" + encodeURIComponent("https://mail.google.com/mail/u/0/" + (after || "#inbox"));
}

function viewInbox() {
  if (!isLab()) return `<div class="empty">Halaman ini hanya untuk akun lab.</div>`;
  const unread = unreadMail();
  let body;

  if (MAIL.loading && !MAIL.loaded) {
    body = `<div class="empty">Memuat kotak masuk…</div>`;
  } else if (!MAIL.configured) {
    body = `<div class="note">
      <b style="color:#fff">Integrasi Gmail belum aktif.</b><br>
      ${esc(MAIL.error || "Edge function gmail-inbox belum dipasang.")}
      Sementara ini pakai tombol <b>Buka Kotak Masuk</b> di atas. Langkah pemasangannya ada di README, bagian “Integrasi Gmail”.
    </div>`;
  } else if (MAIL.error) {
    body = `<div class="note" style="border-left-color:var(--red)">
      <b style="color:#fff">Gagal mengambil email.</b><br>${esc(MAIL.error)}
    </div>`;
  } else if (!MAIL.messages.length) {
    body = `<div class="empty">Kotak masuk kosong.</div>`;
  } else {
    body = `<div class="stack">${MAIL.messages.map(m => {
      const d = new Date(m.date), now = new Date();
      const hariIni = key(d) === key(now);
      const waktu = hariIni ? fTime(d) : fShort(d);
      return `<a class="mailrow${m.unread ? " unread" : ""}" href="${gmailLink("#inbox/" + m.id)}"
              target="_blank" rel="noopener" title="Buka di Gmail">
        <span class="av-s" style="margin:0">${ini(m.from)}</span>
        <span style="min-width:0">
          <span class="sub">${m.unread ? '<i class="dot pulse"></i>' : ""}${esc(m.subject)}</span>
          <span class="snip">${esc(m.from)} — ${esc(m.snippet)}</span>
        </span>
        <span class="meta num" style="white-space:nowrap">${waktu}</span>
      </a>`;
    }).join("")}</div>`;
  }

  return `<div class="sec-head"><div><div class="kick">Surel Resmi Laboratorium</div><h1>Inbox</h1></div></div>
    <div class="rule"></div>

    <div class="mailbox">
      <svg class="fp" aria-hidden="true"><use href="#ic-fp"/></svg>
      <div class="dots"></div>
      <div style="position:relative;flex:1;min-width:230px">
        <div class="label">Akun Laboratorium</div>
        <div class="mailaddr">${esc(LAB_EMAIL)}</div>
        <button class="linkish" data-copy="${esc(LAB_EMAIL)}">Salin alamat</button>
      </div>
      <div style="position:relative;display:flex;gap:9px;flex-wrap:wrap">
        <a class="btn" href="${gmailLink("#inbox")}" target="_blank" rel="noopener">Buka Kotak Masuk &nearr;</a>
        <a class="btn ghost" href="${gmailLink("#inbox?compose=new")}" target="_blank" rel="noopener">Tulis Email &nearr;</a>
      </div>
    </div>

    <div class="sec-head" style="justify-content:space-between;margin-top:26px">
      <div class="label">Email Terbaru${unread ? ` · <span style="color:var(--red)">${unread} belum dibaca</span>` : ""}</div>
      <button class="btn ghost sm" data-mailrefresh${MAIL.loading ? " disabled" : ""}>${MAIL.loading ? "Memuat…" : "Muat ulang"}</button>
    </div>
    <div class="rule" style="margin:10px 0 14px"></div>
    ${body}`;
}

/* ---------------------------------------------------------------- GMAIL */
let MAIL = { messages: [], loaded: false, loading: false, configured: true, error: null };

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
      ? "Edge function gmail-inbox belum di-deploy."
      : (error.message || "Gagal menghubungi server email.");
    MAIL.configured = false;
    MAIL.messages = [];
  } else {
    MAIL.messages = data.messages || [];
    MAIL.configured = data.configured !== false;
    MAIL.error = data.error || null;
  }
  render();
}

/* ---------------------------------------------------------------- APPROVAL */
let PENDING = [], ACTIVE = [], REJECTED = [];
async function loadProfiles() {
  if (!isLab()) return;
  const { data, error } = await sb.from("profiles").select("*").order("created_at");
  if (error) return fail(error, "Gagal memuat daftar akun");
  PENDING  = data.filter(p => p.status === "pending");
  ACTIVE   = data.filter(p => p.status === "approved");
  REJECTED = data.filter(p => p.status === "rejected");
}

function viewApproval() {
  if (!isLab()) return `<div class="empty">Halaman ini hanya untuk akun lab.</div>`;
  const dupes = {};
  PENDING.forEach(a => dupes[a.member_id] = (dupes[a.member_id] || 0) + 1);

  const queue = PENDING.map(a => {
    const m = byId(a.member_id), bentrok = dupes[a.member_id] > 1;
    const at = new Date(a.created_at);
    return `<div class="card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:210px">
        ${bentrok ? `<span class="tag t-over" style="margin-bottom:8px">${dupes[a.member_id]} orang mengklaim nama ini</span>` : ""}
        <div class="kv"><span class="k">Email</span><span>${esc(a.email)}</span></div>
        <div class="kv"><span class="k">Mengaku</span><span style="color:#fff">${esc(m?.name || a.member_id)}</span></div>
        <div class="kv"><span class="k">Jabatan</span><span>${esc(m?.role || "-")} · ${esc(m?.div || "-")}</span></div>
        <div class="kv"><span class="k">Dikirim</span><span class="num">${fShort(at)} ${fTime(at)}</span></div>
      </div>
      <div style="flex:0 0 240px;display:flex;flex-direction:column;gap:8px">
        <input class="ainput" id="rsn-${a.user_id}" placeholder="Alasan penolakan (opsional)">
        <div style="display:flex;gap:8px">
          <button class="btn sm" data-appr="ok|${a.user_id}" style="flex:1;justify-content:center">Setujui</button>
          <button class="btn ghost sm" data-appr="no|${a.user_id}" style="flex:1;justify-content:center">Tolak</button>
        </div>
      </div>
    </div>`;
  }).join("") || `<div class="empty">Tidak ada pendaftaran yang menunggu.</div>`;

  const active = ACTIVE.map(a => {
    const m = byId(a.member_id);
    return `<div class="mailrow" style="grid-template-columns:30px minmax(0,1fr) auto auto;gap:12px;align-items:center">
      <span class="av-s" style="margin:0">${ini(m?.name || "?")}</span>
      <span style="min-width:0"><span class="sub">${esc(m?.name || a.member_id)}</span><span class="snip">${esc(a.email)}</span></span>
      <span class="tag ${m?.level === "inti" ? "t-ongoing" : "t-soon"}">${LEVEL_LABEL[m?.level || "staff"]}</span>
      <button class="btn ghost sm" data-appr="cabut|${a.user_id}">Cabut</button>
    </div>`;
  }).join("") || `<div class="empty">Belum ada akun aktif.</div>`;

  const claimed = new Set(ACTIVE.map(a => a.member_id));
  const belum = MEMBERS.filter(m => !claimed.has(m.id));

  return `<div class="sec-head"><div><div class="kick">Khusus ${esc(LAB_EMAIL)}</div><h1>Approval</h1>
      <p class="sec-sub">Setujui atau tolak pendaftaran akun. Email baru resmi menempel ke nama pengurus setelah disetujui di sini.</p></div></div>
    <div class="rule"></div>
    <div class="grid g-sum" style="margin-bottom:24px">
      ${stat("Menunggu Persetujuan", PENDING.length, PENDING.length ? "red" : "", "pendaftaran masuk")}
      ${stat("Akun Aktif", ACTIVE.length, "ok", "sudah bisa login")}
      ${stat("Nama Belum Diklaim", belum.length, "", "dari " + MEMBERS.length + " pengurus")}
    </div>
    <div class="label" style="margin-bottom:12px">Antrean Pendaftaran</div>
    <div class="stack" style="gap:12px;margin-bottom:30px">${queue}</div>
    <div class="label" style="margin-bottom:12px">Akun Aktif</div>
    <div class="stack" style="margin-bottom:30px">${active}</div>
    ${rejectedSection()}`;
}

function rejectedSection() {
  if (!REJECTED.length) return "";
  return `<div class="label" style="margin-bottom:12px">Pendaftaran Ditolak · ${REJECTED.length}</div>
    <div class="stack">${REJECTED.map(a => {
      const m = byId(a.member_id);
      return `<div class="mailrow" style="grid-template-columns:30px minmax(0,1fr) auto auto;gap:12px;align-items:center">
        <span class="av-s" style="margin:0;opacity:.6">${ini(m?.name || "?")}</span>
        <span style="min-width:0">
          <span class="sub" style="color:var(--dim)">${esc(m?.name || a.member_id)}</span>
          <span class="snip">${esc(a.email)}${a.reason ? " — " + esc(a.reason) : ""}</span>
        </span>
        <button class="btn sm" data-appr="ok|${a.user_id}">Setujui</button>
        <button class="btn ghost sm" data-appr="reset|${a.user_id}">Buka lagi</button>
      </div>`;
    }).join("")}</div>
    <div class="meta" style="margin-top:10px">“Buka lagi” menghapus catatan penolakan, sehingga orangnya dapat memilih nama lagi saat masuk berikutnya.</div>`;
}

async function decide(act, uid) {
  const row = PENDING.concat(ACTIVE, REJECTED).find(p => p.user_id === uid);
  if (!row) return;
  if (act === "cabut" || act === "reset") {
    const pesan = act === "cabut"
      ? `Cabut akses ${row.email}? Namanya bisa diklaim ulang setelah ini.`
      : `Buka kembali pendaftaran ${row.email}? Dia akan diminta memilih nama lagi saat masuk.`;
    if (!confirm(pesan)) return;
    const { error } = await sb.from("profiles").delete().eq("user_id", uid);
    if (error) return fail(error, "Gagal menghapus catatan akun");
    toast(act === "cabut" ? `Akses ${row.email} dicabut.` : `Pendaftaran ${row.email} dibuka lagi.`);
    await loadProfiles(); render(); return;
  }
  if (act === "ok") {
    const { error } = await sb.from("profiles").update({
      status: "approved", reason: null, decided_at: new Date().toISOString(), decided_by: ME.user.id,
    }).eq("user_id", uid);
    if (error) {
      const bentrok = error.code === "23505" || /duplicate key/i.test(error.message || "");
      return toast(bentrok
        ? `${byId(row.member_id)?.name || "Nama itu"} sudah dipegang akun lain. Cabut akses yang lama dulu di daftar Akun Aktif.`
        : (error.message || "Gagal menyetujui"), true);
    }
    toast(`${byId(row.member_id)?.name || row.email} disetujui.`);
  } else {
    const r = document.getElementById("rsn-" + uid);
    const { error } = await sb.from("profiles").update({
      status: "rejected", reason: r?.value.trim() || null,
      decided_at: new Date().toISOString(), decided_by: ME.user.id,
    }).eq("user_id", uid);
    if (error) return fail(error, "Gagal menolak");
    toast(`Pendaftaran ${row.email} ditolak.`);
  }
  await loadProfiles();
  render();
}

/* ---------------------------------------------------------------- render */
function paintUser() {
  const el = $("#me");
  if (!el || !ME) return;
  const nama = ME.isLab ? "Akun Lab" : ME.member.name;
  const sub  = ME.isLab ? "Administrator" : ME.member.role;
  const inis = ME.isLab ? "FL" : ini(ME.member.name);
  const pend = isLab() ? PENDING.length : 0;
  el.innerHTML = `<div class="av">${inis}</div>
    <div>
      <div class="mn">${esc(nama)}</div>
      <div class="mr">${esc(sub)}</div>
    </div>
    ${pend ? `<span class="tag t-over" style="margin-left:4px">${pend} menunggu</span>` : ""}
    <button class="logout" id="logout" title="Keluar" aria-label="Keluar">
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
  const t = e.target.closest("[data-go],[data-tab],[data-open-prog],[data-open-div],[data-open-member],[data-check],[data-task],[data-cal],[data-day],[data-notif],[data-readall],[data-appr],[data-auth],[data-copy],[data-mailrefresh],[data-newprog],[data-editprog],[data-progdel],[data-room],[data-minute],[data-newminute],[data-editminute],[data-minutedel]");
  if (!t) return;
  const d = t.dataset;

  if (d.auth) { const [act, arg] = d.auth.split("|"); return authAction(act, arg); }
  if (d.appr) { const [act, uid] = d.appr.split("|"); return decide(act, uid); }
  if (d.room) { roomTab = d.room; return render(); }
  if (d.minute) return showModal("minute", d.minute);
  if (d.newminute !== undefined) return showModal("mform", "");
  if (d.editminute) return showModal("mform", d.editminute);
  if (d.minutedel) return deleteMinute(d.minutedel);
  if (d.newprog !== undefined) return showModal("form", "");
  if (d.editprog) return showModal("form", d.editprog);
  if (d.progdel) return deleteProgram(d.progdel);
  if (d.mailrefresh !== undefined) return loadMail(true);
  if (d.copy !== undefined) {
    navigator.clipboard?.writeText(d.copy)
      .then(() => toast("Alamat email disalin."), () => toast("Browser menolak menyalin.", true));
    return;
  }
  if (d.go) return go(d.go);
  if (d.tab) { progTab = d.tab; return render(); }
  if (d.openProg) return showModal("prog", d.openProg);
  if (d.openDiv) return showModal("div", d.openDiv);
  if (d.openMember) return showModal("member", d.openMember);
  if (d.check) { const [pid, cid] = d.check.split("|"); return toggleCheck(pid, cid); }
  if (d.task) { const [did, mid, tid] = d.task.split("|"); return cycleTask(did, mid, tid); }
  if (d.cal !== undefined) {
    if (d.cal === "0") { const n = new Date(); calCursor = new Date(n.getFullYear(), n.getMonth(), 1); }
    else calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + Number(d.cal), 1);
    return render();
  }
  if (d.day) { calSel = calSel === d.day ? null : d.day; return render(); }
  if (d.notif) { markRead([d.notif]); return d.mid ? showModal("minute", d.mid) : showModal("prog", d.pid); }
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
    addTask(did, mid, txt);
  }
});

/* pencarian */
let chromeWired = false;
function wireChrome() {
  if (chromeWired) return;
  chromeWired = true;
  const qEl = $("#q"), resEl = $("#results");
  qEl.addEventListener("input", () => {
    const v = qEl.value.trim().toLowerCase();
    if (v.length < 2) { resEl.hidden = true; return; }
    const hits = [
      ...PROGRAMS.filter(p => p.title.toLowerCase().includes(v) || p.desc.toLowerCase().includes(v))
        .map(p => ({ k: "Program", n: p.title, a: `data-open-prog="${p.id}"` })),
      ...MEMBERS.filter(m => m.name.toLowerCase().includes(v) || m.role.toLowerCase().includes(v))
        .map(m => ({ k: "Anggota", n: `${m.name} — ${m.role}`, a: `data-open-member="${m.id}"` })),
      ...DIVISIONS.filter(x => x.name.toLowerCase().includes(v))
        .map(x => ({ k: "Divisi", n: x.name, a: `data-open-div="${x.id}"` })),
    ].slice(0, 12);
    resEl.innerHTML = hits.length
      ? hits.map(h => `<button ${h.a}><span class="k">${h.k}</span><br>${esc(h.n)}</button>`).join("")
      : `<div style="padding:12px;color:var(--dim);font-size:12px">Tidak ada hasil untuk “${esc(qEl.value)}”.</div>`;
    resEl.hidden = false;
  });
  document.addEventListener("click", ev => { if (!ev.target.closest(".search")) resEl.hidden = true; });

  $("#bell").addEventListener("click", () => go("notification"));
  $("#hamb").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

  const RKEY = "foresty.rail", railBtn = $("#rail"), shellEl = $("#shell");
  function setRail(on) {
    shellEl.classList.toggle("rail", on);
    railBtn.setAttribute("aria-expanded", String(!on));
    railBtn.title = on ? "Tampilkan menu" : "Sembunyikan menu";
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
      if (el) el.textContent = st === "SUBSCRIBED" ? "SINKRON · REALTIME" : "SINKRON · BERKALA";
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
      <span class="labshow" style="margin:0 0 18px">FORESTY MANAGEMENT</span>
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
    <h2 style="margin-bottom:4px">Masuk</h2>
    <p class="meta" style="margin-bottom:18px">Gunakan email yang sudah disetujui akun lab.</p>
    <form class="aform" id="loginForm">
      <label class="afield"><span class="label">Email</span>
        <input id="li-email" type="email" autocomplete="username" placeholder="nama@email.com" required></label>
      <label class="afield"><span class="label">Password akun web</span>
        <input id="li-pass" type="password" autocomplete="current-password" placeholder="••••••••" required></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:4px">Masuk</button>
    </form>
    <div class="aalt">Belum punya akun? <button data-auth="register">Daftar di sini</button></div>`);
}

async function viewRegister() {
  const mem = await claimableMembers();
  const opts = mem.map(m => `<option value="${m.id}">${esc(m.name)} — ${esc(m.role)}</option>`).join("");
  return authShell(`
    <h2 style="margin-bottom:4px">Daftar Akun</h2>
    <p class="meta" style="margin-bottom:18px">Daftarkan email, lalu pilih namamu dari daftar pengurus supaya akun ini menempel ke datamu.</p>
    <form class="aform" id="regForm">
      <label class="afield"><span class="label">Email</span>
        <input id="rg-email" type="email" autocomplete="username" placeholder="nama@email.com" required></label>
      <label class="afield"><span class="label">Password akun web</span>
        <input id="rg-pass" type="password" autocomplete="new-password" placeholder="minimal 8 karakter" required></label>
      <label class="afield"><span class="label">Ulangi password</span>
        <input id="rg-pass2" type="password" autocomplete="new-password" placeholder="••••••••" required></label>
      <label class="afield"><span class="label">Nama kamu</span>
        <select id="rg-member" required><option value="">— pilih nama —</option>${opts}</select></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:4px">Kirim Pendaftaran</button>
    </form>
    <div class="ahint"><b>Password ini password akun web Foresty Management</b>, bukan password Gmail kamu. Jangan pernah memasukkan password Gmail di halaman mana pun.</div>
    <div class="aalt">Sudah punya akun? <button data-auth="login">Masuk</button></div>`);
}

/* akun sudah ada di Auth tapi belum memilih nama */
async function viewClaim() {
  const mem = await claimableMembers();
  const opts = mem.map(m => `<option value="${m.id}">${esc(m.name)} — ${esc(m.role)}</option>`).join("");
  return authShell(`
    <h2 style="margin-bottom:4px">Lengkapi Pendaftaran</h2>
    <p class="meta" style="margin-bottom:18px">Email <b style="color:#fff">${esc(authCtx?.email || "")}</b> sudah terdaftar, tinggal pilih namamu.</p>
    <form class="aform" id="claimForm">
      <label class="afield"><span class="label">Nama kamu</span>
        <select id="cl-member" required><option value="">— pilih nama —</option>${opts}</select></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center">Kirim Pendaftaran</button>
    </form>
    <button class="btn ghost" data-auth="logout" style="width:100%;justify-content:center;margin-top:10px">Keluar</button>`);
}

async function viewPending() {
  const p = authCtx, m = byId(p.member_id) || (await claimableMembers()).find(x => x.id === p.member_id);
  const at = new Date(p.created_at);
  return authShell(`
    <div class="await-ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
    <h2 style="margin-bottom:4px">Menunggu Persetujuan</h2>
    <p class="meta" style="margin-bottom:18px">Pendaftaran sudah terkirim. Akun lab perlu menyetujui dulu sebelum kamu bisa masuk.</p>
    <div class="pane" style="margin-bottom:16px">
      <div class="kv"><span class="k">Email</span><span>${esc(p.email)}</span></div>
      <div class="kv"><span class="k">Nama</span><span>${esc(m?.name || p.member_id)}</span></div>
      <div class="kv"><span class="k">Jabatan</span><span>${esc(m?.role || "-")}</span></div>
      <div class="kv"><span class="k">Dikirim</span><span class="num">${fShort(at)} ${fTime(at)}</span></div>
      <div class="kv"><span class="k">Status</span><span style="color:var(--warn)">Menunggu ACC ${esc(LAB_EMAIL)}</span></div>
    </div>
    <button class="btn ghost" data-auth="refresh" style="width:100%;justify-content:center">Cek status lagi</button>
    <button class="btn ghost" data-auth="logout" style="width:100%;justify-content:center;margin-top:8px">Keluar</button>`);
}

async function viewRejected() {
  const p = authCtx, m = byId(p.member_id) || (await claimableMembers()).find(x => x.id === p.member_id);
  return authShell(`
    <div class="await-ic rej"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg></div>
    <h2 style="margin-bottom:4px">Pendaftaran Ditolak</h2>
    <p class="meta" style="margin-bottom:16px">Akun lab menolak pendaftaran <b style="color:#fff">${esc(p.email)}</b> atas nama ${esc(m?.name || p.member_id)}.</p>
    ${p.reason ? `<div class="anotice" style="border-left-color:var(--red)"><b>Alasan:</b> ${esc(p.reason)}</div>` : ""}
    <div class="ahint">Hubungi akun lab kalau ini keliru. Pendaftaran ulang perlu dibuka oleh akun lab lewat menu Approval.</div>
    <button class="btn ghost" data-auth="logout" style="width:100%;justify-content:center;margin-top:10px">Keluar</button>`);
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
    : await viewLogin();
  root.innerHTML = v;
  authErr = ""; authInfo = "";
  wireAuthForms();
}

/* nama sudah dipegang akun lain, atau email ini sudah pernah mendaftar */
function claimError(e) {
  if (e.code === "23505" || /duplicate key/i.test(e.message || "")) {
    return /profiles_pkey/.test(e.message || "")
      ? "Email ini sudah pernah mendaftar. Silakan masuk memakai email tersebut."
      : "Nama itu sudah dipegang akun lain. Pilih nama lain atau hubungi akun lab.";
  }
  return e.message;
}

function wireAuthForms() {
  const lf = $("#loginForm");
  if (lf) lf.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = lf.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Memeriksa…";
    const { error } = await sb.auth.signInWithPassword({
      email: $("#li-email").value.trim(), password: $("#li-pass").value,
    });
    btn.disabled = false; btn.textContent = "Masuk";
    if (error) { authErr = "Email atau password tidak cocok."; authScreen = "login"; return paintAuth(); }
    gate();
  });

  const rf = $("#regForm");
  if (rf) rf.addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#rg-email").value.trim(), p1 = $("#rg-pass").value, p2 = $("#rg-pass2").value;
    const mid = $("#rg-member").value;
    authScreen = "register";
    if (email.toLowerCase() === LAB_EMAIL) { authErr = "Email ini dipakai akun lab dan tidak bisa didaftarkan di sini."; return paintAuth(); }
    if (p1.length < 8) { authErr = "Password minimal 8 karakter."; return paintAuth(); }
    if (p1 !== p2) { authErr = "Ulangi password belum sama."; return paintAuth(); }
    if (!mid) { authErr = "Pilih dulu namamu dari daftar."; return paintAuth(); }

    const btn = rf.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Mengirim…";
    const { data, error } = await sb.auth.signUp({ email, password: p1 });
    btn.disabled = false; btn.textContent = "Kirim Pendaftaran";
    if (error) { authErr = error.message; return paintAuth(); }
    if (!data.session) {
      authErr = "Akun dibuat, tapi sesi belum aktif. Minta pengelola mematikan “Confirm email” di Supabase → Authentication → Providers → Email, lalu coba masuk.";
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
    if (!mid) { authErr = "Pilih dulu namamu."; authScreen = "claim"; return paintAuth(); }
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
  if (!session) { showApp(false); authScreen = "login"; return paintAuth(); }

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
    authErr = "Gagal memuat data: " + (e.message || e);
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
  if (!window.__mailTimer) window.__mailTimer = setInterval(() => loadMail(), 180000);
}

gate();
