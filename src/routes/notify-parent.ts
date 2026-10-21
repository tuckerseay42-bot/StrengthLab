// Fires a parent notification for one of three events (injury, missed
// session, PR) — but only if the calling coach can actually see this
// athlete (enforced via RLS using their own session, not a blanket
// service-role lookup) and the org has that notification kind turned on.
// Off by default: nothing sends until a coach flips a switch in Settings.
import * as React from "react";
import { render } from "@react-email/render";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { ParentInjuryEmail } from "@/lib/email-templates/parent-injury";
import { ParentMissedSessionEmail } from "@/lib/email-templates/parent-missed-session";
import { ParentPrEmail } from "@/lib/email-templates/parent-pr";

const SITE_NAME = "StrengthLab";
const SENDER_DOMAIN = "notify.strengthlabhub.com";
const FROM_DOMAIN = "strengthlabhub.com";

type NotifyBody = {
  athlete_id: string;
  event_type: "injury" | "missed_session" | "pr";
  details: Record<string, unknown>;
};

export const Route = createFileRoute("/notify-parent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !anonKey || !serviceKey) {
          console.error("notify-parent: missing Supabase environment variables");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const accessToken = authHeader.slice("Bearer ".length).trim();

        let body: NotifyBody;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        if (!body.athlete_id || !body.event_type) {
          return Response.json(
            { error: "athlete_id and event_type are required" },
            { status: 400 },
          );
        }

        // Scoped to the CALLER's own session — RLS decides whether they can
        // even see this athlete. No service-role lookup happens until that
        // passes, so this can't be used to probe athletes outside the
        // caller's own org.
        const asCaller = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
        });
        const { data: athlete } = await asCaller
          .from("athletes")
          .select("id, name, first_name, parent_email, organization_id")
          .eq("id", body.athlete_id)
          .maybeSingle();

        if (!athlete) {
          return Response.json({ skipped: true, reason: "not_found_or_unauthorized" });
        }
        if (!athlete.parent_email) {
          return Response.json({ skipped: true, reason: "no_parent_email" });
        }

        const service = createClient(supabaseUrl, serviceKey);
        const toggleColumn =
          body.event_type === "injury"
            ? "notify_parent_injury"
            : body.event_type === "missed_session"
              ? "notify_parent_missed_session"
              : "notify_parent_pr";
        const { data: org } = await service
          .from("organizations")
          .select(toggleColumn)
          .eq("id", athlete.organization_id)
          .maybeSingle();
        const enabled = (org as Record<string, boolean> | null)?.[toggleColumn] === true;
        if (!enabled) {
          return Response.json({ skipped: true, reason: "disabled" });
        }

        const athleteName = athlete.first_name || athlete.name;
        let subject: string;
        let element: React.ReactElement;

        if (body.event_type === "injury") {
          subject = `${athleteName} — injury/excused note`;
          element = React.createElement(ParentInjuryEmail, {
            siteName: SITE_NAME,
            athleteName,
            description: String(body.details.description ?? "Marked injured/excused"),
            bodyPart: (body.details.body_part as string | undefined) ?? null,
            severity: String(body.details.severity ?? "moderate"),
          });
        } else if (body.event_type === "missed_session") {
          subject = `${athleteName} — missed session`;
          element = React.createElement(ParentMissedSessionEmail, {
            siteName: SITE_NAME,
            athleteName,
            date: String(body.details.date ?? new Date().toISOString().slice(0, 10)),
            reason: String(body.details.reason ?? "No session logged today."),
          });
        } else {
          subject = `${athleteName} — new PR!`;
          element = React.createElement(ParentPrEmail, {
            siteName: SITE_NAME,
            athleteName,
            exerciseName: String(body.details.exercise_name ?? "an exercise"),
            load: Number(body.details.load ?? 0),
            reps: Number(body.details.reps ?? 0),
          });
        }

        const html = await render(element);
        const text = await render(element, { plainText: true });
        const messageId = crypto.randomUUID();

        await service.from("email_send_log").insert({
          message_id: messageId,
          template_name: `parent_${body.event_type}`,
          recipient_email: athlete.parent_email,
          status: "pending",
        });

        const { error: enqueueError } = await service.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            message_id: messageId,
            to: athlete.parent_email,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject,
            html,
            text,
            purpose: "transactional",
            label: `parent_${body.event_type}`,
            queued_at: new Date().toISOString(),
          },
        });

        if (enqueueError) {
          console.error("notify-parent: failed to enqueue", { error: enqueueError });
          await service
            .from("email_send_log")
            .update({ status: "failed", error_message: "Failed to enqueue email" })
            .eq("message_id", messageId);
          return Response.json({ error: "Failed to enqueue email" }, { status: 500 });
        }

        return Response.json({ success: true, queued: true });
      },
    },
  },
});
