// Reads a photo of a handwritten test sheet (name + number per line) or a
// spoken transcript, and asks Lovable AI Gateway to pull out {name, value}
// pairs as structured JSON. Returns raw extracted pairs only — matching
// them to actual athletes and writing to `tests` happens client-side after
// a coach reviews/corrects each row, so a misread name or number never
// silently lands in the database.
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

const EXTRACT_PROMPT = `You read handwritten or spoken strength-testing results and extract
a list of {name, value} pairs — one per athlete.

Rules:
- "name" is the athlete's name as written/said, as close to verbatim as you can read it.
- "value" is the numeric test result only — strip units, strip words like "seconds" or "inches".
- Spoken numbers like "four point five two" become 4.52. "thirty two and a half" becomes 32.5.
- Skip lines/phrases that aren't clearly a name followed by a number.
- If you truly cannot read anything, return an empty array.

Respond with ONLY a JSON array, no markdown fences, no commentary. Example:
[{"name":"Tristan Dunn","value":4.52},{"name":"Malachi Long","value":4.61}]`;

type ExtractBody =
  { mode: "image"; imageBase64: string; mimeType: string } | { mode: "transcript"; text: string };

type ExtractedEntry = { name: string; value: number };

function parseEntries(raw: string): ExtractedEntry[] {
  // Models sometimes wrap JSON in ```json fences despite instructions —
  // strip those before parsing rather than failing the whole import.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (e): e is { name: unknown; value: unknown } =>
        !!e && typeof e === "object" && "name" in e && "value" in e,
    )
    .map((e) => ({ name: String(e.name).trim(), value: Number(e.value) }))
    .filter((e) => e.name && Number.isFinite(e.value));
}

export const Route = createFileRoute("/tests-import-extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const aiKey = process.env.LOVABLE_API_KEY;

        if (!supabaseUrl || !anonKey) {
          console.error("tests-import-extract: missing Supabase environment variables");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }
        if (!aiKey) {
          return Response.json(
            {
              error:
                "AI import isn't set up yet — enable Lovable AI for this project (Project Settings → AI) so LOVABLE_API_KEY is available.",
            },
            { status: 500 },
          );
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const accessToken = authHeader.slice("Bearer ".length).trim();

        // Scoped to the CALLER's own session — just confirms a real signed-in
        // user is making this (paid) call, not an anonymous caller running up
        // the bill.
        const asCaller = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
        });
        const { data: userData, error: userError } = await asCaller.auth.getUser();
        if (userError || !userData.user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: ExtractBody;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const content: Array<
          { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
        > = [{ type: "text", text: EXTRACT_PROMPT }];
        if (body.mode === "image") {
          if (!body.imageBase64 || !body.mimeType) {
            return Response.json(
              { error: "imageBase64 and mimeType are required" },
              { status: 400 },
            );
          }
          content.push({
            type: "image_url",
            image_url: { url: `data:${body.mimeType};base64,${body.imageBase64}` },
          });
        } else if (body.mode === "transcript") {
          if (!body.text?.trim()) {
            return Response.json({ error: "text is required" }, { status: 400 });
          }
          content.push({ type: "text", text: `Transcript:\n${body.text}` });
        } else {
          return Response.json({ error: "mode must be 'image' or 'transcript'" }, { status: 400 });
        }

        let aiRes: Response;
        try {
          aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${aiKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [{ role: "user", content }],
            }),
          });
        } catch (e) {
          console.error("tests-import-extract: AI gateway request failed", e);
          return Response.json({ error: "Couldn't reach the AI service" }, { status: 502 });
        }

        if (!aiRes.ok) {
          const errText = await aiRes.text().catch(() => "");
          console.error("tests-import-extract: AI gateway error", aiRes.status, errText);
          const message =
            aiRes.status === 429
              ? "AI usage limit reached — try again in a bit."
              : "The AI service couldn't process that.";
          return Response.json({ error: message }, { status: 502 });
        }

        const json = await aiRes.json();
        const raw = json?.choices?.[0]?.message?.content;
        if (typeof raw !== "string") {
          return Response.json(
            { error: "Unexpected response from the AI service" },
            { status: 502 },
          );
        }

        let entries: ExtractedEntry[];
        try {
          entries = parseEntries(raw);
        } catch (e) {
          console.error("tests-import-extract: failed to parse AI response", raw, e);
          return Response.json(
            { error: "Couldn't parse what the AI service returned" },
            { status: 502 },
          );
        }

        return Response.json({ entries });
      },
    },
  },
});
