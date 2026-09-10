import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  BAD_INVITE_MESSAGE,
  MIN_PASSWORD_LENGTH,
  SHORT_PASSWORD_MESSAGE,
  normalizeInviteCode,
} from "@/lib/auth/signup";

export interface SignupData {
  /** The new user's id. Returned for logging/debugging, not used by the form. */
  userId: string;
}

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

/** Longest invite code we will even look up. Real codes are ~20 chars. */
const MAX_CODE_LENGTH = 100;
/** Guards against a multi-megabyte body being handed to Auth. */
const MAX_FIELD_LENGTH = 400;

/**
 * True when Supabase refused because the email is already registered.
 *
 * Checked three ways on purpose: `code` is the modern, stable discriminator,
 * but it is absent on older GoTrue responses, and the 422 status is shared
 * with other validation failures — so the message check is the last resort
 * rather than the first.
 */
function isEmailTakenError(error: {
  code?: string;
  status?: number;
  message: string;
}): boolean {
  if (error.code === "email_exists") return true;
  if (error.status === 422 && /already/i.test(error.message)) return true;
  return /already been registered|already registered/i.test(error.message);
}

/**
 * POST /api/signup — the ONLY way to create a Prism account.
 *
 * WHY THIS IS A SERVER ROUTE. The gate it replaces was a client-side constant
 * (`SIGNUPS_OPEN`, removed by this change) that only hid the form. It
 * decided nothing: a direct POST to Supabase Auth with the public anon key —
 * which ships in every browser bundle — created a real, usable account. A gate
 * that lives in the browser is not a gate. This route holds the service-role
 * key, so the check happens somewhere the caller cannot reach.
 *
 * THIS ROUTE IS NOT SUFFICIENT ON ITS OWN. It closes the app's door, not
 * Supabase's. While "allow new users to sign up" is ON in the Supabase Auth
 * settings, that anon-key POST still works and still bypasses every line
 * below. Verified 2026-09-10: it returned HTTP 200 and a live session. The
 * invite gate only means something once that setting is OFF.
 *
 * ORDER OF OPERATIONS, and why it is this way:
 *
 *   1. Claim the code with ONE update-if-unused statement. This is the whole
 *      race-condition story: PostgREST issues a single
 *      `UPDATE ... WHERE code = $1 AND used = false RETURNING id`, so two
 *      people submitting the same code at the same moment cannot both match —
 *      the loser re-evaluates `used = false` after the winner commits and gets
 *      zero rows. A read-then-write would let both through.
 *   2. Create the user.
 *   3. Attribute the code to them (`used_by`).
 *
 * If step 2 fails, step 1 is ROLLED BACK. A typo'd or already-registered email
 * must not silently burn someone's only invite — the code goes back to unused
 * and they can try again. The window in which a row reads
 * `used = true, used_by = null` is one Auth call wide and, because RLS has no
 * policies here, is visible to nothing but the service-role key.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid request body." }, 400);
  }

  const {
    email: rawEmail,
    password,
    inviteCode: rawCode,
    displayName: rawDisplayName,
  } = (body ?? {}) as Record<string, unknown>;

  const missingFieldsMessage =
    "Email, password and invite code are all required.";

  if (
    typeof rawEmail !== "string" ||
    typeof password !== "string" ||
    typeof rawCode !== "string"
  ) {
    return json({ data: null, error: missingFieldsMessage }, 400);
  }

  const email = rawEmail.trim();
  const displayName =
    typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";

  if (!email || !password || !rawCode.trim()) {
    return json({ data: null, error: missingFieldsMessage }, 400);
  }

  if (
    email.length > MAX_FIELD_LENGTH ||
    password.length > MAX_FIELD_LENGTH ||
    displayName.length > MAX_FIELD_LENGTH ||
    rawCode.length > MAX_CODE_LENGTH
  ) {
    return json({ data: null, error: "That is too long to submit." }, 400);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ data: null, error: SHORT_PASSWORD_MESSAGE }, 400);
  }

  const code = normalizeInviteCode(rawCode);
  const admin = createAdminClient();

  // Step 1 - the atomic claim. `.eq()` is an exact match; a `like`/`ilike`
  // here would let a submitted "%" claim an arbitrary unused code.
  const { data: claimed, error: claimError } = await admin
    .from("invite_codes")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("code", code)
    .eq("used", false)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[signup] invite claim failed:", claimError.message);
    return json(
      { data: null, error: "Could not check that invite code. Try again." },
      500
    );
  }

  // Zero rows: no such code, or someone else already redeemed it.
  if (!claimed) {
    return json({ data: null, error: BAD_INVITE_MESSAGE }, 403);
  }

  /** Undo the claim so a failed signup does not consume the invite. */
  async function releaseCode(codeId: string) {
    const { error: releaseError } = await admin
      .from("invite_codes")
      .update({ used: false, used_at: null })
      .eq("id", codeId);

    // Nothing the caller can do about this, and surfacing it would replace a
    // useful message with a confusing one. Logged so it can be fixed by hand.
    if (releaseError) {
      console.error(
        `[signup] FAILED TO RELEASE invite code ${codeId} - it is now marked used with no account behind it:`,
        releaseError.message
      );
    }
  }

  // Step 2 - create the user.
  //
  // `email_confirm: true` matches this project's setup (email confirmation is
  // OFF, so signup has always produced an immediately usable account). Without
  // it an admin-created user can land unconfirmed and be unable to sign in.
  //
  // `user_metadata.display_name` is what the on_auth_user_created trigger
  // reads: handle_new_user() inserts a profiles row using
  // `coalesce(raw_user_meta_data->>'display_name', 'User')`. That is why this
  // route needs no profile insert of its own, and why the trigger needed no
  // change to support admin-created users - it fires on ANY insert into
  // auth.users, not just self-serve ones.
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: displayName ? { display_name: displayName } : {},
    });

  if (createError || !created?.user) {
    await releaseCode(claimed.id);

    if (createError && isEmailTakenError(createError)) {
      return json(
        {
          data: null,
          error:
            "An account with that email already exists. Sign in instead - your invite code has not been used.",
        },
        409
      );
    }

    console.error("[signup] createUser failed:", createError?.message);
    return json(
      {
        data: null,
        error:
          createError?.message ??
          "Could not create that account. Check the email and try again.",
      },
      400
    );
  }

  // Step 3 - attribution. Deliberately NOT fatal: the account exists and works
  // at this point, so failing the request here would strand a real user in
  // front of an error over a bookkeeping problem. Logged instead.
  const { error: attributeError } = await admin
    .from("invite_codes")
    .update({ used_by: created.user.id })
    .eq("id", claimed.id);

  if (attributeError) {
    console.error(
      `[signup] invite ${claimed.id} redeemed by ${created.user.id} but used_by was not set:`,
      attributeError.message
    );
  }

  return json({ data: { userId: created.user.id }, error: null }, 201);
}
