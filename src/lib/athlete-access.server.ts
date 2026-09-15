/**
 * Server-only helpers for athlete account provisioning.
 *
 * Public self-signup is disabled (invite-only), so an athlete emailing
 * themselves a magic link fails with "Signups not allowed" unless an auth user
 * already exists. These helpers create the auth user server-side ONLY when the
 * email is already on a coach-managed roster, then send the normal OTP email.
 */

export type RosterAthlete = { id: string; user_id: string | null; athlete_email: string | null };

/** Finds an auth user by email (case-insensitive). Returns null when absent. */
export async function findAuthUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const needle = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").trim().toLowerCase() === needle);
    if (hit?.email) return { id: hit.id, email: hit.email };
    if (users.length < 200) return null;
  }
  return null;
}

/**
 * Ensures an auth user exists for a rostered athlete email.
 * Confirms the email immediately: identity is already proven by the roster +
 * the magic link they must open next.
 */
export async function ensureAuthUserForEmail(email: string): Promise<{ id: string; created: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const normalized = email.trim().toLowerCase();

  const existing = await findAuthUserByEmail(normalized);
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
  });
  if (error) {
    // Race or case-mismatch: re-read before failing.
    const again = await findAuthUserByEmail(normalized);
    if (again) return { id: again.id, created: false };
    throw new Error(error.message);
  }
  if (!data.user) throw new Error("Could not create the athlete account");
  return { id: data.user.id, created: true };
}

/** Looks up a roster athlete by email; throws a plain-language error when ambiguous/absent. */
export async function findRosterAthleteByEmail(email: string): Promise<RosterAthlete> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabaseAdmin
    .from("athletes")
    .select("id, user_id, athlete_email")
    .ilike("athlete_email", normalized)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("That email isn't on a team roster yet. Ask your coach to add it to your athlete profile.");
  }
  if (data.length > 1) {
    throw new Error("This email is on more than one athlete profile. Ask your coach to fix the roster.");
  }
  return data[0] as RosterAthlete;
}

/** Sends a Supabase magic-link email for an existing auth user. */
export async function sendMagicLink(email: string, emailRedirectTo: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: anonKey.startsWith("sb_")
      ? {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            const h = new Headers(init?.headers);
            if (h.get("Authorization") === `Bearer ${anonKey}`) h.delete("Authorization");
            h.set("apikey", anonKey);
            return fetch(input, { ...init, headers: h });
          },
        }
      : undefined,
  });

  // shouldCreateUser:false — the caller already provisioned the account.
  const { error } = await anonClient.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo, shouldCreateUser: false },
  });
  if (error) throw new Error(error.message);
}
