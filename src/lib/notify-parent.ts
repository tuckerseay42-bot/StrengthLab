// Client-side trigger for the three parent-notification events. Always
// fire-and-forget: a notification failing must never block or visibly
// disrupt the coach's actual action (marking injured, logging a set,
// marking absent). The server route is the one that actually decides
// whether anything gets sent — it's off per-event until a coach enables it.
import { supabase } from "@/integrations/supabase/client";

export type ParentNotificationEvent = "injury" | "missed_session" | "pr";

export async function notifyParent(
  athleteId: string,
  eventType: ParentNotificationEvent,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/notify-parent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ athlete_id: athleteId, event_type: eventType, details }),
    });
  } catch (e) {
    console.error("notifyParent failed", { athleteId, eventType, error: e });
  }
}
