// Central mapper: turns raw Postgres / PostgREST / Supabase errors into
// plain-language messages a coach or athlete can act on. The real error is
// always logged to the console and forwarded to Lovable error reporting.

import { reportLovableError } from "./lovable-error-reporting";

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
};

const CODE_MAP: Record<string, string> = {
  "23502": "Something required is missing on this record. Try again — if it keeps happening, contact support.",
  "23503": "This is linked to another record that doesn't exist or was removed.",
  "23505": "This already exists — check for a duplicate.",
  "23514": "One of the values isn't allowed. Double-check the form and try again.",
  "22P02": "One of the values is in the wrong format.",
  "42501": "You don't have permission to do that.",
  "42P01": "That data isn't available right now.",
  "PGRST301": "Please sign in again and retry.",
  "PGRST116": "That record couldn't be found.",
};

function looksLikeRawPostgres(msg: string): boolean {
  return (
    /violates|constraint|null value in column|duplicate key|row-level security|permission denied|jwt/i.test(msg) ||
    msg.startsWith("PGRST") ||
    msg.length > 160
  );
}

export function toUserMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;

  // Always report the raw error so devs / Lovable capture the real cause.
  try {
    // eslint-disable-next-line no-console
    console.error("[db-error]", err);
    reportLovableError(err, { source: "db_mutation" });
  } catch { /* swallow reporter failures */ }

  if (typeof err === "string") return looksLikeRawPostgres(err) ? fallback : err;

  const e = err as SupabaseLikeError & { name?: string };
  const code = e.code ?? "";
  const rawMsg = (e.message ?? "") + " " + (e.details ?? "");
  if (code === "23505" && /workout_assignments_uniq_(athlete|team)_date/i.test(rawMsg)) {
    return "Already assigned for that date. Pick a different date or remove the existing assignment first.";
  }
  if (code && CODE_MAP[code]) return CODE_MAP[code];

  // 401 / 403 from PostgREST
  if (e.status === 401) return "Please sign in again and retry.";
  if (e.status === 403) return "You don't have permission to do that.";

  const msg = (e.message ?? "").trim();
  if (!msg) return fallback;

  // Well-known substrings
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/not authenticated|no authorization/i.test(msg)) return "Please sign in again and retry.";
  if (/duplicate key|already exists/i.test(msg)) return "This already exists — check for a duplicate.";
  if (/null value in column/i.test(msg)) return "Something required is missing. Please refresh and try again — if it keeps happening, contact support.";
  if (/violates check constraint|violates.*constraint/i.test(msg)) return "One of the values isn't allowed. Double-check the form and try again.";
  if (/network|fetch failed|failed to fetch/i.test(msg)) return "Network hiccup. Check your connection and try again.";

  // Short, non-raw messages we wrote ourselves (e.g. "Select an athlete") pass through.
  if (!looksLikeRawPostgres(msg)) return msg;
  return fallback;
}
