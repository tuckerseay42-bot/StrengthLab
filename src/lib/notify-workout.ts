// Client-side trigger for emailing a session's content to a batch of
// athletes. Unlike notifyParent this isn't fire-and-forget — it's an
// explicit "Send to athletes" button a coach clicks and waits on, so the
// caller gets a real sent/skipped count back to toast.
import { supabase } from "@/integrations/supabase/client";
import type { AthleteWorkoutEmailRow } from "@/lib/email-templates/athlete-workout";

export type NotifyWorkoutResult = {
  sent: number;
  skipped: { athlete_id: string; reason: string }[];
};

export async function notifyWorkout(input: {
  athletes: { athlete_id: string; rows: AthleteWorkoutEmailRow[] }[];
  session: {
    teamName: string;
    sessionName: string;
    scheduledDate: string | null;
    coachNotes?: string | null;
  };
  loginUrl: string;
}): Promise<NotifyWorkoutResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/notify-workout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as NotifyWorkoutResult & { error?: string };
  if (!res.ok) throw new Error(json.error || "Failed to send");
  return json;
}
