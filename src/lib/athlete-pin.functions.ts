import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hashPin, linkAthleteByEmailAndSavePin, savePinForUser } from "@/lib/athlete-pin.server";

/** Athlete sets or replaces their own PIN. Requires an authenticated session. */
export const setAthletePin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pin: string }) => {
    const pin = String(input.pin ?? "").replace(/\D/g, "");
    if (pin.length !== 6) throw new Error("PIN must be exactly 6 digits");
    return { pin };
  })
  .handler(async ({ data, context }) => {
    await savePinForUser(context.userId, data.pin);
    return { ok: true };
  });

/** Athlete opens a PIN setup email, confirms their email, and creates/replaces their PIN. */
export const setAthletePinFromEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; pin: string }) => {
    const email = String(input.email ?? "").trim().toLowerCase();
    const pin = String(input.pin ?? "").replace(/\D/g, "");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter the email that received the setup link");
    if (pin.length !== 6) throw new Error("PIN must be exactly 6 digits");
    return { email, pin };
  })
  .handler(async ({ data, context }) => {
    const sessionEmail = typeof context.claims.email === "string" ? context.claims.email : null;
    return linkAthleteByEmailAndSavePin({
      userId: context.userId,
      sessionEmail,
      enteredEmail: data.email,
      pin: data.pin,
    });
  });

/**
 * Verify an athlete's identifier + 6-digit PIN and return a magic-link token
 * the browser consumes with `verifyOtp({ type: "email", token_hash })`.
 * `identifier` may be an email OR the athlete's student_id.
 */
export const verifyAthletePin = createServerFn({ method: "POST" })
  .inputValidator((input: { identifier: string; pin: string }) => {
    const identifier = String(input.identifier ?? "").trim();
    const pin = String(input.pin ?? "").replace(/\D/g, "");
    if (!identifier) throw new Error("Enter your email or athlete ID");
    if (pin.length !== 6) throw new Error("PIN must be 6 digits");
    return { identifier, pin };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const isEmail = /^\S+@\S+\.\S+$/.test(data.identifier);

    // Resolve to an athlete row. Prefer a linked row, but recover rows whose
    // account link was never written so a PIN account can't silently vanish.
    let athleteRow: { id: string; user_id: string | null; athlete_email: string | null } | null = null;
    const select = "id, user_id, athlete_email";
    if (isEmail) {
      const email = data.identifier.toLowerCase();
      const { data: rows } = await supabaseAdmin
        .from("athletes").select(select).ilike("athlete_email", email).limit(5);
      athleteRow = (rows ?? []).find((r) => r.user_id) ?? rows?.[0] ?? null;
    } else {
      const { data: rows } = await supabaseAdmin
        .from("athletes").select(select).eq("student_id", data.identifier).limit(5);
      athleteRow = (rows ?? []).find((r) => r.user_id) ?? rows?.[0] ?? null;
    }
    if (!athleteRow) throw new Error("Invalid credentials");

    if (!athleteRow.user_id && athleteRow.athlete_email) {
      const { findAuthUserByEmail } = await import("@/lib/athlete-access.server");
      const user = await findAuthUserByEmail(athleteRow.athlete_email);
      if (user) {
        await supabaseAdmin.from("athletes").update({ user_id: user.id }).eq("id", athleteRow.id);
        athleteRow = { ...athleteRow, user_id: user.id };
      }
    }
    if (!athleteRow.user_id) throw new Error("Invalid credentials");

    // Look up the auth user to get canonical email.
    const { data: userRes, error: userErr } =
      await supabaseAdmin.auth.admin.getUserById(athleteRow.user_id);
    if (userErr || !userRes?.user?.email) throw new Error("Invalid credentials");
    const email = userRes.user.email;

    // Enforce athlete role only. A linked roster row with no roles at all is a
    // provisioning gap, not a staff account — grant the athlete role.
    const { data: roles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", athleteRow.user_id);
    const isAthlete = (roles ?? []).some((r) => r.role === "athlete");
    if (!isAthlete) {
      if ((roles ?? []).length > 0) throw new Error("PIN sign-in is only available to athletes");
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: athleteRow.user_id, role: "athlete" }, { onConflict: "user_id,role" });
    }

    const { data: row } = await supabaseAdmin
      .from("athlete_pins").select("*").eq("user_id", athleteRow.user_id).maybeSingle();
    if (!row) throw new Error("No PIN set. Sign in once with your email link and set a PIN in your dashboard.");

    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      throw new Error("Too many attempts. Try again in a few minutes.");
    }

    const attempt = await hashPin(data.pin, row.pin_salt);
    if (attempt !== row.pin_hash) {
      const fails = (row.failed_attempts ?? 0) + 1;
      const locked = fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await supabaseAdmin.from("athlete_pins")
        .update({ failed_attempts: locked ? 0 : fails, locked_until: locked })
        .eq("user_id", athleteRow.user_id);
      throw new Error(locked ? "Too many attempts. Locked for 15 minutes." : "Invalid credentials");
    }

    // Success — reset counter, mint a magic link token the client can verify.
    await supabaseAdmin.from("athlete_pins")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("user_id", athleteRow.user_id);

    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) throw new Error("Could not start session");

    return { token_hash: link.properties.hashed_token, email };
  });

/** Returns whether the current user has a PIN set. */
export const getMyPinStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("athlete_pins").select("user_id").eq("user_id", context.userId).maybeSingle();
    return { hasPin: !!data };
  });
