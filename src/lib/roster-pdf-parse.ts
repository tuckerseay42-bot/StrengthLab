// Parses a school SIS "Section Roster" export — PDF or CSV — (one row per
// student: name, student #, gender, grade) into rows usable for the
// class-period bulk import. PDF parsing is entirely client-side via
// pdfjs-dist, always dynamically imported so pdfjs (a DOM-dependent
// library) never loads during SSR.
import { titleCaseName } from "@/lib/queries";
import { toRecords } from "@/lib/csv-parse";

export type RosterPdfRow = {
  firstName: string;
  lastName: string;
  studentId: string;
  grade: number | null;
  gender: "male" | "female" | null;
};
export type RosterPdfResult = { periodGuess: string | null; rows: RosterPdfRow[] };

// Format A — one line per student, ID inline:
// "LAST[ LAST2], FIRST[ MIDDLE...] 12345 M 11 [08/10/2026 -]"
const ROW_RE = /^([A-Z][A-Z'.\- ]*?),\s+([A-Z][A-Z'.\- ]+?)\s+(\d{3,8})\s+([MF])\s+(\d{1,2})\b/;

// Format B — grade leads, ID on its own line right after (a different
// Infinite Campus "Section Roster" export layout than Format A):
// "11 LAST[ Jr./III], FIRST[ MIDDLE...] M [08/10/2026]" then "#12345"
const NAME_ROW_RE =
  /^(\d{2})\s+([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)?),\s+([A-Za-z][A-Za-z'.\- ]+?)\s+([MF])(?:\s+\d{2}\/\d{2}\/\d{4})?\s*$/;
const ID_LINE_RE = /^#\s*(\d{3,8})\s*$/;

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

      // A standalone "#12345" line is Format B's student ID, attached to
      // whichever row was just pushed (it has no ID of its own yet).
      const idMatch = line.match(ID_LINE_RE);
      const lastRow = rows[rows.length - 1];
      if (idMatch && lastRow && !lastRow.studentId) {
        lastRow.studentId = idMatch[1];
        continue;
      }

      const m = line.match(ROW_RE);
      if (m) {
        const lastName = m[1].trim();
        const firstName = m[2].trim().split(/\s+/)[0];
        const studentId = m[3];
        const gender = m[4] === "M" ? "male" : m[4] === "F" ? "female" : null;
        const grade = Number(m[5]);
        rows.push({
          firstName,
          lastName,
          studentId,
          grade: Number.isFinite(grade) ? grade : null,
          gender,
        });
        continue;
      }

      const nm = line.match(NAME_ROW_RE);
      if (nm) {
        const grade = Number(nm[1]);
        const lastName = nm[2].trim();
        const firstName = nm[3].trim().split(/\s+/)[0];
        const gender = nm[4] === "M" ? "male" : nm[4] === "F" ? "female" : null;
        rows.push({
          firstName,
          lastName,
          studentId: "",
          grade: Number.isFinite(grade) ? grade : null,
          gender,
        });
      }
    }
  }

  return { periodGuess, rows };
}

/**
 * Parses an Infinite Campus "Section Roster" CSV export — the same report
 * as parseRosterPdf, just downloaded as CSV instead of printed to PDF.
 * Columns: Staff Number, Course, Room, Term(s), Period, Last Name,
 * First Name, Middle Name, Suffix, Alias, Gender, Grade, Start Date,
 * End Date, Student Number, IEP.
 */
export async function parseRosterCsv(file: File): Promise<RosterPdfResult> {
  const text = await file.text();
  const { records } = toRecords(text);

  const rows: RosterPdfRow[] = [];
  let periodGuess: string | null = null;

  for (const r of records) {
    const lastName = r["last name"] || "";
    const firstName = (r["first name"] || "").trim().split(/\s+/)[0] || "";
    if (!lastName || !firstName) continue;

    const suffix = (r["suffix"] || "").trim();
    const genderRaw = (r["gender"] || "").trim().toUpperCase();
    const grade = Number(r["grade"]);

    rows.push({
      firstName,
      lastName: suffix ? `${lastName} ${suffix}` : lastName,
      studentId: r["student number"] || "",
      grade: Number.isFinite(grade) ? grade : null,
      gender: genderRaw === "M" ? "male" : genderRaw === "F" ? "female" : null,
    });

    if (!periodGuess) {
      const pm = (r["period"] || "").match(/^0*(\d{1,2})\b/);
      if (pm) periodGuess = `Period ${Number(pm[1])}`;
    }
  }

  return { periodGuess, rows };
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Turns parsed roster rows into the same CSV shape the class-period importer already expects. */
export function buildClassPeriodCsv(rows: RosterPdfRow[], classPeriod: string): string {
  const lines = ["athlete_name,student_id,class_period"];
  for (const r of rows) {
    const name = titleCaseName(`${r.firstName} ${r.lastName}`);
    lines.push([csvCell(name), r.studentId, csvCell(classPeriod)].join(","));
  }
  return lines.join("\n");
}

/** Turns parsed roster rows into the same CSV shape the "Athletes (roster)" importer expects, for creating brand-new athletes straight from a roster PDF. */
export function buildAthleteRosterCsv(
  rows: RosterPdfRow[],
  opts: { sport: string; classPeriod: string },
): string {
  const lines = [
    "first_name,last_name,grade,sport,position,graduation_year,bodyweight,height_in,athlete_email,parent_email,student_id,class_period",
  ];
  for (const r of rows) {
    const first = titleCaseName(r.firstName);
    const last = titleCaseName(r.lastName);
    lines.push(
      [
        csvCell(first),
        csvCell(last),
        r.grade ?? "",
        csvCell(opts.sport),
        "",
        "",
        "",
        "",
        "",
        "",
        r.studentId,
        csvCell(opts.classPeriod),
      ].join(","),
    );
  }
  return lines.join("\n");
}
