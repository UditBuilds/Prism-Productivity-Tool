"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { AuthCard, AuthHeader } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  // Supabase returns recovery-link errors in the URL hash (and sometimes the
  // query) — e.g. #error=access_denied&error_code=otp_expired. Detect it so we
  // can show a clean "expired" card instead of a broken form.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    if (hash.get("error") === "access_denied" || query.get("error") === "access_denied") {
      setLinkExpired(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    // The recovery session was established from the email link's code by the
    // browser client (detectSessionInUrl), so updateUser can set the password.
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (linkExpired) {
    return (
      <AuthCard>
        <AuthHeader />
        <div className="mt-6 flex flex-col items-center text-center">
          <AlertTriangle className="h-10 w-10 text-warning" />
          <p className="mt-4 text-base font-semibold text-foreground">
            Reset link expired
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This password reset link has expired. Reset links are valid for 1
            hour.
          </p>
          <Button asChild className="mt-6 w-full rounded-lg">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard shake={!!error}>
      <AuthHeader subtitle="Choose a new password" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
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

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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

        <Button type="submit" disabled={loading} className="w-full rounded-lg">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update password
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
