/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// Handle incoming push messages
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data: {
    title: string;
    body?: string;
    url?: string;
  };

  try {
    data = event.data.json();
  } catch {
    data = { title: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "Prism reminder",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-72.png",
      vibrate: [200, 100, 200],
      data: { url: data.url || "/dashboard/reminders" },
      requireInteraction: false,
    })
  );
});

// Handle notification click — open the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (
      self as unknown as ServiceWorkerGlobalScope & {
        clients: Clients;
      }
    ).clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const url = event.notification.data?.url || "/dashboard";
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return (
          self as unknown as ServiceWorkerGlobalScope & {
            clients: Clients;
          }
        ).clients.openWindow(url);
      })
  );
});
