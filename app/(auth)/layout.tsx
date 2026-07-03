export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_center,#0A0A0A_0%,#050505_100%)] px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
