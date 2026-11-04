import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { easternToday } from "@/lib/weigh-ins";

type WeighInResult =
  | { status: "ok"; logs: { logged_at: string; log_date: string; value: number }[] }
  | { status: "confirm"; recent_avg: number };

function isMissingFunction(err: { code?: string; message?: string } | null) {
  if (!err) return false;
  return (
    err.code === "PGRST202" ||
    err.code === "42883" ||
    /could not find the function|schema cache|does not exist/i.test(err.message ?? "")
  );
}

/**
 * Log today's attendance for the signed-in athlete and optionally log a
 * weigh-in. Used by the kiosk check-in flow (full + attendance-only).
 *
 * A weight goes through the log_weigh_in database function (range check, typo
 * guard, every weigh-in kept with its time). If the weight looks like a typo
 * nothing is saved and `needsConfirm` comes back so the kiosk can ask; send it
 * again with `confirmed: true` to save it. On success the athlete's own recent
 * weigh-ins come back for the on-screen feedback.
 */
export const athleteCheckIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bodyweight?: number | null; confirmed?: boolean }) => {
    let bw: number | null = null;
    if (input.bodyweight != null && input.bodyweight !== undefined) {
      const n = Number(input.bodyweight);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Bodyweight must be a positive number");
      if (n < 40 || n > 700) throw new Error("Bodyweight looks out of range");
      bw = n;
    }
    return { bodyweight: bw, confirmed: input.confirmed === true };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: athlete, error: aErr } = await supabase
      .from("athletes")
      .select("id, organization_id, first_name, name")
      .eq("user_id", userId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!athlete) throw new Error("Athlete profile not found");

    const today = easternToday();
    let logs: { logged_at: string; log_date: string; value: number }[] | null = null;

    if (data.bodyweight != null) {
      const { data: res, error: wErr } = await supabase.rpc(
        "log_weigh_in" as never,
        { _athlete_id: athlete.id, _value: data.bodyweight, _confirmed: data.confirmed } as never,
      );
      if (wErr && isMissingFunction(wErr)) {
        // The weigh-in database update hasn't reached this database yet. Keep
        // check-ins working the old way rather than failing the kiosk.
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
        logs = [];
      } else if (wErr) {
        throw new Error(wErr.message);
      } else {
        const r = res as unknown as WeighInResult;
        if (r.status === "confirm") {
          return { ok: false as const, needsConfirm: true as const, recentAvg: r.recent_avg };
        }
        logs = r.logs;
      }
    }

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

    return {
      ok: true as const,
      athleteId: athlete.id,
      name: athlete.first_name || athlete.name,
      date: today,
      weighIn: logs == null ? null : { value: data.bodyweight as number, logs },
    };
  });
