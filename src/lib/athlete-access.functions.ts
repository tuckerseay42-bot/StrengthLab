import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public: an athlete on a coach-managed roster requests a sign-in link.
 * Self-signup stays disabled — the account is only provisioned when the email
 * (or join token) already matches a roster row.
 */
export const requestAthleteAccessLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email("Enter a valid email"),
        redirectTo: z.string().url(),
        joinToken: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const {
      ensureAuthUserForEmail,
      findRosterAthleteByEmail,
      sendMagicLink,
    } = await import("@/lib/athlete-access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = data.email.trim().toLowerCase();

    // A join token proves the coach handed out this specific athlete link, so
    // we can attach a brand-new email to that athlete row.
    let athleteId: string | null = null;
    if (data.joinToken) {
      const { data: row, error } = await supabaseAdmin
        .from("athletes")
        .select("id, athlete_email")
        .eq("join_token", data.joinToken)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("This link is no longer valid. Ask your coach for a new one.");
      athleteId = row.id;
      if ((row.athlete_email ?? "").trim().toLowerCase() !== email) {
        await supabaseAdmin.from("athletes").update({ athlete_email: email }).eq("id", row.id);
      }
    } else {
      const athlete = await findRosterAthleteByEmail(email);
      athleteId = athlete.id;
    }

    const user = await ensureAuthUserForEmail(email);

    // Link the roster row + athlete role immediately so the account can never
    // "disappear" if the magic-link session is opened on another device.
    if (athleteId) {
      const { data: current } = await supabaseAdmin
        .from("athletes")
        .select("user_id")
        .eq("id", athleteId)
        .maybeSingle();
      if (!current?.user_id) {
        await supabaseAdmin.from("athletes").update({ user_id: user.id }).eq("id", athleteId);
      }
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: user.id, role: "athlete" }, { onConflict: "user_id,role" });
    }

    await sendMagicLink(email, data.redirectTo);
    return { ok: true, email };
  });
