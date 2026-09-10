"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, SHORT_PASSWORD_MESSAGE } from "@/lib/auth/signup";
import { AuthCard, AuthHeader } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Account creation goes through POST /api/signup, never
   * `supabase.auth.signUp` from here.
   *
   * The invite code is checked with the service-role key on the server, so the
   * browser cannot talk its way past it. What this page used to do instead was
   * hide the form behind a `SIGNUPS_OPEN` constant (now gone) — which stopped
   * nobody, since anyone could POST to Supabase Auth directly with the anon
   * key out of the bundle.
   *
   * Signing in afterwards is a normal client-side `signInWithPassword` with the
   * password the user just typed. Nothing is minted server-side: that is the
   * same line this project holds for the demo button (see lib/demo.ts), and it
   * keeps session handling in one place instead of two.
   */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Mirrors the reset flow's rule so the two never drift apart. The route
    // checks it again — this only saves a round-trip.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(SHORT_PASSWORD_MESSAGE);
      return;
    }

    setLoading(true);

    let payload: { error: string | null };
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, inviteCode, displayName }),
      });
      payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Could not create that account.");
        setLoading(false);
        return;
      }
    } catch {
      // Offline, or the server never answered. Say that, rather than blaming
      // the invite code the user just typed.
      setError("Could not reach the server. Check your connection and retry.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // The account DID get created and the code IS spent, so telling them to
      // retry signup would send them into a dead end ("code already used").
      // Sign-in is the correct next step.
      setError(
        `Your account was created, but signing in failed: ${signInError.message} Try signing in.`
      );
      setLoading(false);
      return;
    }

    // Left spinning on success: the redirect is what ends this state, so
    // clearing it early just flashes an enabled button over a leaving page.
    router.push("/dashboard");
    router.refresh();
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
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            className="rounded-lg"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="inviteCode">Invite code</Label>
          <Input
            id="inviteCode"
            type="text"
            /* Codes are pasted or typed off a message, not remembered by the
               browser, and autocorrect mangling one is a pure loss. */
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="PRISM-XXXXXXXX"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
            className="rounded-lg font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Prism is invite-only. Codes are single-use.
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={loading} className="w-full rounded-lg">
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
