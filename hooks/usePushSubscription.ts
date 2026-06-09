// Browser push subscription helper. Subscribes the current device to Web Push
// and syncs the subscription to the DB so the cron job can reach it.
import { useState } from "react";

export interface SubscribeResult {
  success: boolean;
  error?: string;
}

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

/**
 * POST the subscription to the DB. Throws on a missing-key or non-OK response
 * so the caller's try/catch can surface the real reason a row never appeared.
 */
async function syncSubscription(sub: PushSubscription): Promise<void> {
  const key = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!key || !auth) {
    throw new Error("Subscription is missing encryption keys");
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: arrayBufferToBase64(key),
      auth: arrayBufferToBase64(auth),
      userAgent: navigator.userAgent,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Non-JSON response — keep the status code.
    }
    throw new Error(`Saving subscription failed (${detail})`);
  }
}

export function usePushSubscription() {
  const [error, setError] = useState<string | null>(null);

  const subscribe = async (): Promise<SubscribeResult> => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return {
          success: false,
          error: "Push not supported on this browser",
        };
      }

      // iOS can be slow to activate the service worker — race a 10s timeout so
      // a stuck SW surfaces as an error instead of hanging forever.
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Service worker timed out after 10s")),
            10000
          )
        ),
      ]);

      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await syncSubscription(existing);
        return { success: true };
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });

      await syncSubscription(subscription);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Push subscribe failed:", err);
      setError(message);
      return { success: false, error: message };
    }
  };

  return { subscribe, subscribeError: error };
}
