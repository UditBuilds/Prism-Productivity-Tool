"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/** The non-standard event Chrome/Android fires before showing the install UI. */
interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "prism-install-dismissed";

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua);
  // On iOS every browser is WebKit; only real Safari offers "Add to Home Screen".
  const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  return ios && safari;
}

/** iOS share glyph (square with an up arrow) shown inline in the iOS hint. */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3v13" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    if (isStandalone()) return; // already installed → nothing to prompt

    const onBeforeInstall = (e: Event) => {
      // Stop Chrome's mini-infobar so we can show our own banner.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShowAndroid(true);
    };
    const onInstalled = () => {
      setShowAndroid(false);
      setShowIos(false);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS has no beforeinstallprompt — show manual instructions instead.
    if (isIosSafari()) setShowIos(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setShowAndroid(false);
    setShowIos(false);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setShowAndroid(false);
  }

  if (!showAndroid && !showIos) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-surface px-4 py-3 md:hidden">
      <div className="mx-auto flex max-w-md items-center gap-3">
        {showAndroid ? (
          <>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Download className="h-5 w-5" />
            </div>
            <p className="min-w-0 flex-1 text-sm text-foreground">
              Install Prism for the best experience
            </p>
            <button
              type="button"
              onClick={install}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10"
            >
              Install
            </button>
          </>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-foreground">
            Install Prism: tap{" "}
            <ShareIcon className="inline h-4 w-4 -translate-y-0.5 text-accent" />{" "}
            then{" "}
            <span className="font-medium">&apos;Add to Home Screen&apos;</span>
          </p>
        )}

        <button
          type="button"
          aria-label="Dismiss install prompt"
          onClick={dismiss}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
