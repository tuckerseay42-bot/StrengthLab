// Emails today's session (with each athlete's own prescribed weights) to a
// batch of athletes from Program Delivery. Athlete lookup is scoped to the
// calling coach's own session (RLS) — only athletes they can already see get
// emailed, and only the ones with an email on file. Explicit, coach-triggered
// action, so unlike notify-parent this isn't gated behind an org setting.
import * as React from "react";
import { render } from "@react-email/render";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import {
  AthleteWorkoutEmail,
  type AthleteWorkoutEmailRow,
} from "@/lib/email-templates/athlete-workout";

const SITE_NAME = "StrengthLab";
const SENDER_DOMAIN = "notify.strengthlabhub.com";
const FROM_DOMAIN = "strengthlabhub.com";
const MAX_ATHLETES = 300;

type NotifyBody = {
  athletes: { athlete_id: string; rows: AthleteWorkoutEmailRow[] }[];
  session: {
    teamName: string;
    sessionName: string;
    scheduledDate: string | null;
    coachNotes?: string | null;
  };
  loginUrl: string;
};

export const Route = createFileRoute("/notify-workout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !anonKey || !serviceKey) {
          console.error("notify-workout: missing Supabase environment variables");
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
        if (!Array.isArray(body.athletes) || body.athletes.length === 0) {
          return Response.json({ error: "athletes is required" }, { status: 400 });
        }
        if (!body.session?.teamName || !body.session?.sessionName || !body.loginUrl) {
          return Response.json({ error: "session and loginUrl are required" }, { status: 400 });
        }
        if (body.athletes.length > MAX_ATHLETES) {
          return Response.json(
            { error: `Too many athletes (max ${MAX_ATHLETES})` },
            { status: 400 },
          );
        }

        const asCaller = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
        });
        const athleteIds = body.athletes.map((a) => a.athlete_id);
        const { data: visibleAthletes, error: lookupError } = await asCaller
          .from("athletes")
          .select("id, name, first_name, athlete_email")
          .in("id", athleteIds);
        if (lookupError) {
          return Response.json({ error: "Failed to look up athletes" }, { status: 500 });
        }
        const athleteById = new Map(
          (visibleAthletes ?? []).map((a) => [
            a.id as string,
            a as {
              id: string;
              name: string;
              first_name: string | null;
              athlete_email: string | null;
            },
          ]),
        );

        const service = createClient(supabaseUrl, serviceKey);
        const skipped: { athlete_id: string; reason: string }[] = [];
        let sent = 0;

        for (const entry of body.athletes) {
          const athlete = athleteById.get(entry.athlete_id);
          if (!athlete) {
            skipped.push({ athlete_id: entry.athlete_id, reason: "not_found_or_unauthorized" });
            continue;
          }
          if (!athlete.athlete_email) {
            skipped.push({ athlete_id: entry.athlete_id, reason: "no_email" });
            continue;
          }

          const athleteName = athlete.first_name || athlete.name;
          const element = React.createElement(AthleteWorkoutEmail, {
            siteName: SITE_NAME,
            athleteName,
            teamName: body.session.teamName,
            sessionName: body.session.sessionName,
            scheduledDate: body.session.scheduledDate,
            coachNotes: body.session.coachNotes ?? null,
            rows: entry.rows,
            loginUrl: body.loginUrl,
          });
          const html = await render(element);
          const text = await render(element, { plainText: true });
          const subject = `${body.session.teamName} — ${body.session.sessionName}`;
          const messageId = crypto.randomUUID();

          await service.from("email_send_log").insert({
            message_id: messageId,
            template_name: "athlete_workout",
            recipient_email: athlete.athlete_email,
            status: "pending",
          });

          const { error: enqueueError } = await service.rpc("enqueue_email", {
            queue_name: "transactional_emails",
            payload: {
              message_id: messageId,
              to: athlete.athlete_email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject,
              html,
              text,
              purpose: "transactional",
              label: "athlete_workout",
              queued_at: new Date().toISOString(),
            },
          });

          if (enqueueError) {
            console.error("notify-workout: failed to enqueue", {
              athleteId: entry.athlete_id,
              error: enqueueError,
            });
            await service
              .from("email_send_log")
              .update({ status: "failed", error_message: "Failed to enqueue email" })
              .eq("message_id", messageId);
            skipped.push({ athlete_id: entry.athlete_id, reason: "enqueue_failed" });
            continue;
          }
          sent++;
        }

        return Response.json({ success: true, sent, skipped });
      },
    },
  },
});
