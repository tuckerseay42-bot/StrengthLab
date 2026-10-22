// Client-side calls into the /tests-import-extract server route, which asks
// Lovable AI to read a photo of a handwritten test sheet or a spoken
// transcript and pull out {name, value} pairs. Never writes to the
// database itself — the caller matches names to athletes and reviews every
// row before anything gets logged.
import { supabase } from "@/integrations/supabase/client";

export type ExtractedTestEntry = { name: string; value: number };

async function callExtract(body: Record<string, unknown>): Promise<ExtractedTestEntry[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You're signed out — refresh and try again.");
  const res = await fetch("/tests-import-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Import failed");
  return Array.isArray(json.entries) ? json.entries : [];
}

export function extractEntriesFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<ExtractedTestEntry[]> {
  return callExtract({ mode: "image", imageBase64, mimeType });
}

export function extractEntriesFromTranscript(text: string): Promise<ExtractedTestEntry[]> {
  return callExtract({ mode: "transcript", text });
}

/** Reads a File into a base64 string (no "data:...;base64," prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read that file"));
    reader.readAsDataURL(file);
  });
}
