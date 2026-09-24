import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Log today's attendance for the signed-in athlete and optionally update
 * their bodyweight. Used by the kiosk check-in flow (full + attendance-only).
 */
export const athleteCheckIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bodyweight?: number | null }) => {
    let bw: number | null = null;
    if (input.bodyweight != null && input.bodyweight !== undefined) {
      const n = Number(input.bodyweight);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Bodyweight must be a positive number");
      if (n < 40 || n > 700) throw new Error("Bodyweight looks out of range");
      bw = n;
    }
    return { bodyweight: bw };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: athlete, error: aErr } = await supabase
      .from("athletes")
      .select("id, organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!athlete) throw new Error("Athlete profile not found");

    const today = new Date().toISOString().slice(0, 10);
    const { error: attErr } = await supabase.from("attendance").upsert(
      {
        athlete_id: athlete.id,
        organization_id: athlete.organization_id,
        session_date: today,
        present: true,
        status: "present",
      },
      { onConflict: "athlete_id,session_date" },
    );
    if (attErr) throw new Error(attErr.message);

    if (data.bodyweight != null) {
      const { error: bwErr } = await supabase
        .from("athletes")
        .update({ bodyweight: data.bodyweight })
        .eq("id", athlete.id);
      if (bwErr) throw new Error(bwErr.message);

      const { error: logErr } = await supabase.from("bodyweight_logs").upsert(
        {
          athlete_id: athlete.id,
          organization_id: athlete.organization_id,
          log_date: today,
          value: data.bodyweight,
          source: "checkin",
        },
        { onConflict: "athlete_id,log_date" },
      );
      if (logErr) throw new Error(logErr.message);
    }

    return { ok: true, athleteId: athlete.id, date: today };
  });
