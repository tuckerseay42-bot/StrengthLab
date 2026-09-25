// Parses a school SIS "Section Roster"-style PDF (one row per student: name,
// student #, gender, grade) into rows usable for the class-period bulk
// import — entirely client-side via pdfjs-dist. Always dynamically imported
// so pdfjs (a DOM-dependent library) never loads during SSR.
import { titleCaseName } from "@/lib/queries";

export type RosterPdfRow = { firstName: string; lastName: string; studentId: string };
export type RosterPdfResult = { periodGuess: string | null; rows: RosterPdfRow[] };

// "LAST[ LAST2], FIRST[ MIDDLE...] 12345 M 11 [08/10/2026 -]"
const ROW_RE = /^([A-Z][A-Z'.\- ]*?),\s+([A-Z][A-Z'.\- ]+?)\s+(\d{3,8})\s+[MF]\s+\d{1,2}\b/;
const PERIOD_RE = /Period:\s*0*(\d{1,2})\b/i;

export async function parseRosterPdf(file: File): Promise<RosterPdfResult> {
  const pdfjsLib = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;

  const rows: RosterPdfRow[] = [];
  let periodGuess: string | null = null;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    // pdf.js returns each text fragment separately, not grouped into lines —
    // reconstruct lines by clustering fragments that share a y-position.
    const lines = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const arr = lines.get(y) ?? [];
      arr.push({ x: item.transform[4], str: item.str });
      lines.set(y, arr);
    }
    const sortedLines = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0]) // PDF y increases upward — top of page first
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );

    for (const line of sortedLines) {
      if (!periodGuess) {
        const pm = line.match(PERIOD_RE);
        if (pm) periodGuess = `Period ${Number(pm[1])}`;
      }
      const m = line.match(ROW_RE);
      if (m) {
        const lastName = m[1].trim();
        const firstName = m[2].trim().split(/\s+/)[0];
        const studentId = m[3];
        rows.push({ firstName, lastName, studentId });
      }
    }
  }

  return { periodGuess, rows };
}

/** Turns parsed roster rows into the same CSV shape the class-period importer already expects. */
export function buildClassPeriodCsv(rows: RosterPdfRow[], classPeriod: string): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["athlete_name,student_id,class_period"];
  for (const r of rows) {
    const name = titleCaseName(`${r.firstName} ${r.lastName}`);
    lines.push([esc(name), r.studentId, esc(classPeriod)].join(","));
  }
  return lines.join("\n");
}
