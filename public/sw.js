/* KAWAI CAMP — Web Push Service Worker */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// プッシュ受信 → デスクトップ／スマホ通知を表示
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "KAWAI CAMP", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "KAWAI CAMP";
  const options = {
    body: data.body || "",
    icon: data.icon || "/logo-icon.png?v=2",
    badge: data.badge || "/logo-icon.png?v=2",
    tag: data.tag || "kawaicamp",
    renotify: true,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック → アプリを開く／フォーカス
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
