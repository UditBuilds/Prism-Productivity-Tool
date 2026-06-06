import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline | Prism" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-xl">
        <div className="flex justify-center">
          <WifiOff className="h-12 w-12 text-accent" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-foreground">
          You&apos;re offline
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prism needs a connection to sync your data. Your installed app will
          resume when you&apos;re back online.
        </p>
      </div>
    </div>
  );
}
