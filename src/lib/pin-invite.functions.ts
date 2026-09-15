import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Sends a magic-link email to selected athletes. When they click it,
 * they land on /athlete-pin-setup, enter their email, and create a PIN.
 * Updates athletes.invite_status / invite_sent_at / invite_error per row.
 * Auth scaffolding delivers the email through our branded auth template.
 */
export const sendPinSetupEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    athleteIds: z.array(z.string().uuid()).min(1).max(200),
    redirectOrigin: z.string().url(),
    mode: z.enum(["invite", "reset"]).default("invite"),
  }).parse(input))
  .handler(async ({ data, context }) => {
    // Load athlete rows via the caller's RLS-scoped client (org-checked).
    const { data: athletes, error } = await context.supabase
      .from("athletes")
      .select("id, athlete_email, user_id")
      .in("id", data.athleteIds);
    if (error) throw new Error(error.message);

    const url = process.env.SUPABASE_URL!;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

    // Anon client -> triggers Supabase's regular auth email flow (which our
    // /lovable/email/auth/webhook enqueues via the branded template).
    const anonClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: anonKey.startsWith("sb_")
        ? {
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (h.get("Authorization") === `Bearer ${anonKey}`) h.delete("Authorization");
              h.set("apikey", anonKey);
              return fetch(input, { ...init, headers: h });
            },
          }
        : undefined,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureAuthUserForEmail } = await import("@/lib/athlete-access.server");
    const emailRedirectTo = `${data.redirectOrigin}/athlete-pin-setup`;
    const nowIso = new Date().toISOString();

    let sent = 0;
    let failed = 0;
    const failures: { id: string; error: string }[] = [];

    for (const a of athletes ?? []) {
      const email = (a.athlete_email ?? "").trim().toLowerCase();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        failed++;
        failures.push({ id: a.id, error: "No email on file" });
        await supabaseAdmin
          .from("athletes")
          .update({ invite_status: "failed", invite_error: "No email on file" })
          .eq("id", a.id);
        continue;
      }

      // Reset mode: clear existing PIN so old one no longer works.
      if (data.mode === "reset" && a.user_id) {
        await supabaseAdmin.from("athlete_pins").delete().eq("user_id", a.user_id);
      }


      // Public sign-ups are disabled (invite-only), so OTP for a brand-new
      // email fails. Provision the account first for rostered athletes.
      let otpErr: { message: string } | null = null;
      try {
        const user = await ensureAuthUserForEmail(email);
        if (!a.user_id) {
          await supabaseAdmin.from("athletes").update({ user_id: user.id }).eq("id", a.id);
        }
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: user.id, role: "athlete" }, { onConflict: "user_id,role" });
        const res = await anonClient.auth.signInWithOtp({
          email,
          options: { emailRedirectTo, shouldCreateUser: false },
        });
        otpErr = res.error;
      } catch (err) {
        otpErr = { message: err instanceof Error ? err.message : "Could not create account" };
      }

      if (otpErr) {
        failed++;
        failures.push({ id: a.id, error: otpErr.message });
        await supabaseAdmin
          .from("athletes")
          .update({ invite_status: "failed", invite_error: otpErr.message })
          .eq("id", a.id);
      } else {
        sent++;
        await supabaseAdmin
          .from("athletes")
          .update({ invite_status: "sent", invite_sent_at: nowIso, invite_error: null })
          .eq("id", a.id);
      }
    }

    return { sent, failed, failures };
  });
