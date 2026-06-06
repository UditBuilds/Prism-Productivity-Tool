// Browser push subscription helper. Subscribes the current device to Web Push
// and syncs the subscription to the DB so the cron job can reach it.

/**
 * base64url → Uint8Array (loop form; avoids ES5 iterable-spread issues).
 * Built on an explicit ArrayBuffer so the result is a `Uint8Array<ArrayBuffer>`
 * that satisfies `applicationServerKey`'s BufferSource type.
 */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64Url);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

/** ArrayBuffer → standard base64 (loop form). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function syncSubscription(sub: PushSubscription): Promise<void> {
  const key = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!key || !auth) return;

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: arrayBufferToBase64(key),
      auth: arrayBufferToBase64(auth),
      userAgent: navigator.userAgent,
    }),
  });
}

export function usePushSubscription() {
  const subscribe = async (): Promise<PushSubscription | null> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return null; // Not supported (e.g. iOS < 16.4, or non-PWA context)
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      // Already subscribed — make sure the DB has it.
      await syncSubscription(existing);
      return existing;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
      ),
    });

    await syncSubscription(subscription);
    return subscription;
  };

  return { subscribe };
}
