"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // No fallback: reset links MUST point at the deployed app, never localhost.
    // Fail loudly if it isn't configured rather than silently break prod users.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      setError("Configuration error: NEXT_PUBLIC_APP_URL is not set.");
      throw new Error(
        "NEXT_PUBLIC_APP_URL is not set — cannot build the reset redirect URL."
      );
    }
    const redirectTo = `${appUrl}/reset-password`;

    setLoading(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo }
    );

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-8 shadow-xl">
      <h1 className="mb-1 text-center text-3xl font-bold tracking-tight text-accent">
        PRISM
      </h1>
      <p className="mb-8 text-center text-sm text-muted-foreground">
        Reset your password
      </p>

      {sent ? (
        <div className="flex flex-col items-center text-center">
          <MailCheck className="h-10 w-10 text-success" />
          <p className="mt-4 text-sm font-medium text-foreground">
            Check your email for a reset link
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            We sent a password reset link to{" "}
            <span className="text-foreground">{email}</span>. It may take a
            minute to arrive.
          </p>
        </div>
      ) : (
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

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full rounded-lg">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
