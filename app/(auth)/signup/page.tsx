"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { AuthCard, AuthHeader } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Mirrors the "allow new users to sign up" setting in the Supabase dashboard,
 * which is OFF for the private beta. Supabase rejects the signUp call, so the
 * form below can only ever fail — this flag says so up front instead. Flip to
 * true (and re-enable the dashboard setting) when signups reopen; the form is
 * kept intact underneath so that is the only change needed.
 */
const SIGNUPS_OPEN: boolean = false;

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Email confirmation is disabled, so a session exists immediately.
    router.push("/dashboard");
    router.refresh();
  }

  if (!SIGNUPS_OPEN) {
    return (
      <AuthCard>
        <AuthHeader subtitle="Invite-only private beta" />

        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          Prism is invite-only while it&apos;s in private beta. New accounts are
          closed right now, so there&apos;s nothing to create here yet.
        </p>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?
        </p>

        <Button asChild className="mt-4 w-full rounded-lg">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard shake={!!error}>
      <AuthHeader subtitle="Create your workspace" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            type="text"
            autoComplete="name"
            placeholder="Udit"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="rounded-lg"
          />
        </div>

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
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
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
          disabled={loading}
          className="w-full rounded-lg"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
