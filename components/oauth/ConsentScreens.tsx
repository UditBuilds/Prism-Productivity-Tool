import Link from "next/link";
import { Check, CircleAlert, Clock, ShieldX, Unplug } from "lucide-react";

import type { ConsentErrorKind } from "@/lib/oauth/consent";
import { AuthCard, AuthHeader } from "@/components/auth/AuthCard";
import { ConsentActions } from "@/components/oauth/ConsentActions";

/**
 * The screens of the OAuth approval page. Rendering only — every decision
 * about WHICH screen to show is made in app/(auth)/oauth/consent/page.tsx.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AuthCard>
      <AuthHeader subtitle="Connect an app" />
      {children}
    </AuthCard>
  );
}

/** The Allow / Deny screen for one authorization request. */
export function ConsentScreen({
  authorizationId,
  clientName,
  email,
  returnHost,
}: {
  authorizationId: string;
  /** The client's name as registered in Supabase ("Claude"). */
  clientName: string;
  /** The signed-in account the app would act as. */
  email: string;
  /** Hostname of the app's redirect URI, shown before the choice. */
  returnHost: string | null;
}) {
  return (
    <Shell>
      <h2 className="text-balance text-center text-base font-semibold text-foreground">
        {clientName} wants to connect to your Prism
      </h2>
      <p className="mt-2 break-words text-center text-sm text-muted-foreground">
        Signed in as <span className="text-foreground">{email}</span>
      </p>

      <div className="mt-6 rounded-lg border border-border bg-surface-raised p-4">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          If you allow it, {clientName} can
        </p>
        <ul className="mt-3 space-y-2 text-sm text-foreground">
          <li className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              Read your Prism data — tasks, reminders, notes, workouts and
              plans
            </span>
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>Add new items to it</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          It acts as you, so it sees only what your own account can see.
        </p>
      </div>

      {returnHost && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Either way, you&apos;ll go back to{" "}
          <span className="font-medium text-foreground">{returnHost}</span>.
        </p>
      )}

      <div className="mt-6">
        <ConsentActions authorizationId={authorizationId} allowApprove />
      </div>
    </Shell>
  );
}

export type NoticeKind = "missing" | "invalid" | ConsentErrorKind;

const NOTICE: Record<
  NoticeKind,
  { icon: typeof Clock; title: string; body: string }
> = {
  missing: {
    icon: CircleAlert,
    title: "This link is missing its request",
    body: "Start the connection again from the app you were using, such as Claude.",
  },
  invalid: {
    icon: CircleAlert,
    title: "This link isn't valid",
    body: "Start the connection again from the app you were using, such as Claude.",
  },
  expired: {
    icon: Clock,
    title: "This request has expired or was already used",
    body: "Start the connection again from the app you were using, such as Claude.",
  },
  disabled: {
    icon: Unplug,
    title: "App connections aren't switched on yet",
    body: "Prism isn't accepting app connections right now. Try again later.",
  },
  unknown: {
    icon: CircleAlert,
    title: "Couldn't load this request",
    body: "Start the connection again from the app you were using. If it keeps happening, note the code below.",
  },
};

/** A dead end: nothing to approve, with the reason in plain words. */
export function ConsentNotice({
  kind,
  code,
}: {
  kind: NoticeKind;
  code?: string;
}) {
  const { icon: Icon, title, body } = NOTICE[kind];
  return (
    <Shell>
      <div className="text-center">
        <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 text-balance text-base font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {code && (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Code: {code}
          </p>
        )}
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Go to Prism
        </Link>
      </div>
    </Shell>
  );
}

/**
 * The demo account's answer. It can cancel the request (so the app hears
 * `access_denied` instead of waiting), but there is no Allow.
 */
export function DemoRefusal({ authorizationId }: { authorizationId: string }) {
  return (
    <Shell>
      <div className="text-center">
        <ShieldX className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 text-balance text-base font-semibold text-foreground">
          The demo account can&apos;t connect apps
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          It&apos;s shared and its password is public, so anything connected to
          it would be open to everyone. Sign in with your own account, then
          start the connection again.
        </p>
      </div>
      <div className="mt-6">
        <ConsentActions authorizationId={authorizationId} allowApprove={false} />
      </div>
    </Shell>
  );
}
