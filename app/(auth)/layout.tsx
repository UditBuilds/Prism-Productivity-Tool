import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_center,rgb(var(--auth-glow))_0%,rgb(var(--auth-edge))_100%)] px-4 py-10">
      <div className="w-full max-w-sm">
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </div>
  );
}
