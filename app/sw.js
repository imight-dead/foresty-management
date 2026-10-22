/* Service worker — menerima push dari server dan menampilkannya sebagai
   notifikasi perangkat, bahkan saat aplikasi tidak sedang dibuka. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data && event.data.text() }; }

  const title = d.title || "Foresty Management";
  const options = {
    body: d.body || "",
    /* icon: logo berwarna tanpa latar, di samping teks notifikasi.
       badge: ikon kecil di bilah status. Android hanya membaca bagian
       transparannya, jadi harus siluet; gambar berlatar jadi kotak putih. */
    icon: "assets/notif-icon.png",
    badge: "assets/badge-96.png",
    tag: d.tag || "foresty",          /* pengingat yang sama tidak menumpuk */
    renotify: false,
    data: { url: d.url || "./" },
    timestamp: Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  /* hanya alamat di dalam aplikasi ini; tautan ke situs lain diabaikan */
  let url = (event.notification.data && event.notification.data.url) || "./";
  try { if (new URL(url, self.registration.scope).origin !== self.location.origin) url = "./"; } catch (_) { url = "./"; }

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      /* tab aplikasi sudah terbuka -> fokuskan, jangan buka tab baru */
      if ("focus" in c) {
        await c.focus();
        if ("navigate" in c) { try { await c.navigate(url); } catch (_) {} }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
