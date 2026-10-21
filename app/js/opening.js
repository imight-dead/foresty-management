/* =====================================================================
   OPENING — layar pembuka matriks merah sebelum halaman masuk.
   Port tanpa React dari CyberIntro.jsx: kotak-kotak meluruh dari tengah
   tepat saat beat drop di opening.mp3 (~2,48 detik).

   Browser biasanya menolak memutar suara sebelum ada interaksi, jadi
   kalau ditolak muncul "Click anywhere to enter" dan timeline baru
   berjalan setelah klik / sentuh / tombol apa pun. Selama layar ini
   tampil, halaman masuk di belakangnya dibuat inert supaya tidak bisa
   difokus lewat Tab. Perangkat yang meminta pengurangan gerak
   melewatinya.
   ===================================================================== */

(function () {
  const TITLE = "FORESTY";
  const SUBTITLE = "Forensics & Security Laboratory";
  const PROMPT = "Click anywhere to enter";
  const LOGO = "assets/logo.png";
  const AUDIO = "assets/opening.mp3";

  /* Titik di opening.mp3 tepat sebelum beat drop, dan lama luruhan
     setelahnya sampai kotak terakhir dan gema suaranya habis. */
  const DROP_TIME_MS = 2480;
  const DISSOLVE_DURATION_MS = 2150;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /* hash [0..1] yang selalu sama untuk sel yang sama, supaya polanya organik tapi stabil */
  const hashCell = (col, row, seed) => {
    const x = Math.sin(col * 12.9898 + row * 78.233 + seed * 43.12) * 43758.5453;
    return x - Math.floor(x);
  };

  const mobile = window.innerWidth <= 768;
  const cols = mobile ? 6 : 12;
  const rows = mobile ? 10 : 7;
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const maxDist = Math.hypot(cx, cy);

  let cells = "";
  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const dist = Math.hypot(col - cx, row - cy) / maxDist;
    const r1 = hashCell(col, row, 1), r2 = hashCell(col, row, 2);
    /* bagian tengah dibiarkan gelap supaya logo dan judul kontras */
    const center = mobile
      ? col >= 1 && col <= 4 && row >= 3 && row <= 6
      : col >= 4 && col <= 7 && row >= 2 && row <= 4;
    const tone = center ? "is-obsidian"
      : r2 > 0.84 ? "is-crimson-bright"
      : r2 > 0.62 ? "is-crimson-mid"
      : r2 > 0.38 ? "is-crimson-deep"
      : "is-obsidian";
    cells += `<div class="cyber-square-box ${tone}" style="--dissolve-delay:${(dist * 0.52 + r1 * 0.32).toFixed(3)}s;--pulse-delay:${(r1 * 0.9).toFixed(2)}s"><span class="cyber-square-glow"></span></div>`;
  }

  const root = document.createElement("div");
  root.className = "cyber-matrix-intro";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="cyber-matrix-grid" style="--matrix-cols:${cols};--matrix-rows:${rows}">${cells}</div>
    <div class="cyber-centerpiece">
      <div class="cyber-centerpiece-inner">
        <div class="cyber-centerpiece-halo"></div>
        <img src="${LOGO}" alt="" class="cyber-centerpiece-logo">
        <div class="cyber-centerpiece-text">
          <span class="cyber-centerpiece-title">${TITLE}</span>
          <span class="cyber-centerpiece-sub">${SUBTITLE.replace("&", "&amp;")}</span>
        </div>
        <div class="cyber-centerpiece-status">
          <div class="cyber-centerpiece-track"><div class="cyber-centerpiece-fill" style="transform:scaleX(0)"></div></div>
          <span class="cyber-centerpiece-prompt">${PROMPT}</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const halo = root.querySelector(".cyber-centerpiece-halo");
  const track = root.querySelector(".cyber-centerpiece-track");
  const fill = root.querySelector(".cyber-centerpiece-fill");
  const prompt = root.querySelector(".cyber-centerpiece-prompt");

  const behind = ["#authRoot", "#shell"].map(s => document.querySelector(s)).filter(Boolean);
  behind.forEach(el => { el.inert = true; });
  document.body.style.overflow = "hidden";

  const setProgress = pct => {
    fill.style.transform = `scaleX(${pct / 100})`;
    halo.style.transform = `translate(-50%, -50%) scale(${1 + (pct / 100) * 0.35})`;
    halo.style.opacity = 0.65 + (pct / 100) * 0.35;
  };
  setProgress(0);

  const audio = new Audio(AUDIO);
  audio.preload = "auto";
  audio.volume = 0.9;

  let rafId = 0, fallback = 0, started = false, dropped = false;

  function drop() {
    if (dropped) return;
    dropped = true;
    cancelAnimationFrame(rafId);
    clearTimeout(fallback);
    setProgress(100);
    root.classList.add("is-dissolving");
    root.classList.remove("cursor-pointer");
    behind.forEach(el => { el.inert = false; });
    setTimeout(() => {
      root.remove();
      document.body.style.overflow = "";
      window.dispatchEvent(new Event("cyberIntroDone"));
    }, DISSOLVE_DURATION_MS);
  }

  function start() {
    if (started) return;
    started = true;
    prompt.classList.remove("is-visible");
    track.classList.add("is-active");
    const t0 = performance.now();

    const tick = now => {
      const wall = now - t0;
      /* ikuti posisi audio kalau sedang berbunyi, supaya luruhan pas di beat drop */
      const fromAudio = !audio.paused && audio.currentTime > 0 ? audio.currentTime * 1000 : null;
      const elapsed = fromAudio !== null ? Math.max(fromAudio, wall * 0.85) : wall;
      const p = Math.min(elapsed / DROP_TIME_MS, 1);
      const eased = p < 0.82 ? (p / 0.82) * 0.72 : 0.72 + Math.pow((p - 0.82) / 0.18, 0.85) * 0.28;
      setProgress(Math.min(100, Math.floor(eased * 100)));
      if (elapsed < DROP_TIME_MS) rafId = requestAnimationFrame(tick);
      else drop();
    };
    rafId = requestAnimationFrame(tick);
    fallback = setTimeout(drop, DROP_TIME_MS + 60);
  }

  function waitForInteraction() {
    root.classList.add("cursor-pointer");
    prompt.classList.add("is-visible");
    const events = ["pointerdown", "keydown", "touchstart"];
    const unlock = () => {
      events.forEach(e => window.removeEventListener(e, unlock));
      audio.currentTime = 0;
      audio.play().catch(() => {});
      start();
    };
    events.forEach(e => window.addEventListener(e, unlock, { passive: true }));
  }

  let playing;
  try { playing = audio.play(); } catch (_) { playing = Promise.reject(); }
  if (playing && playing.then) playing.then(start, waitForInteraction);
  else start();
})();
