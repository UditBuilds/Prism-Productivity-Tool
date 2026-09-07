"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo";
import { AuthCard, AuthHeader } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  /**
   * The one place either button reaches Supabase.
   *
   * Try Demo is deliberately NOT a separate auth path — same client, same
   * signInWithPassword call, same redirect. Nothing is minted server-side and
   * no token is forged; the demo just arrives with its credentials already
   * filled in.
   */
  async function signIn(withEmail: string, withPassword: string) {
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: withEmail,
      password: withPassword,
    });

    if (signInError) {
      setError(signInError.message);
      return false;
    }

    router.push("/dashboard");
    router.refresh();
    return true;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Left spinning on success: the redirect is what ends this state, so
    // clearing it early just flashes an enabled button over a leaving page.
    if (!(await signIn(email, password))) setLoading(false);
  }

  async function handleDemo() {
    setError(null);
    setDemoLoading(true);

    if (!(await signIn(DEMO_EMAIL, DEMO_PASSWORD))) setDemoLoading(false);
  }

  const busy = loading || demoLoading;

  return (
    <AuthCard shake={!!error}>
      <AuthHeader subtitle="Sign in to your workspace" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-lg"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="rounded-lg"
          />
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>

        <p className="text-center text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </Link>
        </p>
      </form>

      {/* Signups are closed, so this is the only door for anyone without an
          invite. It sits outside the <form> on purpose — inside, a click would
          submit the empty email/password fields before it ever ran. */}
      <div className="mt-6">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            or
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleDemo}
          disabled={busy}
          className="mt-4 w-full rounded-lg"
        >
          {demoLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Try the demo
        </Button>

        <p className="mt-2 text-center text-xs text-muted-foreground">
          A sample account with data already in it. Explore freely — it resets
          every night.
        </p>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Sign up
        </Link>
      </p>
    </AuthCard>
  );
}
