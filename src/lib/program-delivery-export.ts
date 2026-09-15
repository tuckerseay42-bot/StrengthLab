// PDF generation for Program Delivery — mirrors the header-band/footer style
// of report-export.ts, but returns the built document instead of saving it
// so the caller can preview it (blob URL) before downloading.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Athlete, RepMax, WorkoutExercise, WorkoutSet } from "@/lib/queries";
import { athleteDisplayName } from "@/lib/queries";
import { suggestLoad } from "@/lib/prescription";
import {
  groupExercisesBySuperset,
  blockLabel,
  setsForExercise,
  formatPrescription,
  type RackGroup,
} from "@/lib/program-delivery";

export type SessionInfo = {
  teamName: string;
  programName: string;
  phaseName: string;
  weekLabel: string;
  sessionName: string;
  scheduledDate: string | null;
};

function sessionSubtitle(s: SessionInfo) {
  return [s.teamName, s.programName, s.phaseName, s.weekLabel].filter(Boolean).join("  ·  ");
}

function pageHeader(doc: jsPDF, title: string, subtitle: string) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 60, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, 40, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(subtitle, 40, 45);
  doc.setTextColor(0);
}

function stampFooter(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  const stamp = new Date().toLocaleString();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated ${stamp} · Strength Lab`, 40, pageH - 16);
    doc.text(`Page ${i} of ${pages}`, pageW - 40, pageH - 16, { align: "right" });
  }
}

function lastTableY(doc: jsPDF, fallback: number) {
  // @ts-expect-error autoTable adds lastAutoTable
  return (doc.lastAutoTable?.finalY as number | undefined) ?? fallback;
}

// ---------------------------------------------------------------- Print cards

export function buildPrintCardsPdf(opts: {
  session: SessionInfo;
  exercises: WorkoutExercise[];
  sets: WorkoutSet[];
  coachNotes?: string | null;
}): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  pageHeader(doc, opts.session.sessionName, sessionSubtitle(opts.session));
  let y = 84;

  if (opts.coachNotes) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(
      opts.coachNotes,
      doc.internal.pageSize.getWidth() - margin * 2,
    );
    doc.text(lines, margin, y);
    y += lines.length * 12 + 10;
  }

  const blocks = groupExercisesBySuperset(opts.exercises);
  if (blocks.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("No exercises in this session yet.", margin, y);
  }
  for (const [blockIdx, block] of blocks.entries()) {
    const label = blockLabel(block, blockIdx);
    const rest = block.items.find((it) => it.rest_seconds != null)?.rest_seconds;
    const heading = block.group
      ? `${label} · Superset (${block.items.length} exercises)${rest ? ` · Rest ${rest}s` : ""}`
      : `${label}${rest ? ` · Rest ${rest}s` : ""}`;
    if (y > doc.internal.pageSize.getHeight() - 100) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(heading, margin, y);
    y += 6;

    const body: (string | number)[][] = [];
    for (const ex of block.items) {
      const sets = setsForExercise(opts.sets, ex.id);
      if (sets.length === 0) {
        body.push([ex.exercise_name, "—", "—", ex.notes ?? ""]);
        continue;
      }
      sets.forEach((s, i) => {
        body.push([
          i === 0 ? ex.exercise_name : "",
          String(i + 1),
          formatPrescription(ex, s),
          s.notes ?? ex.notes ?? "",
        ]);
      });
    }
    autoTable(doc, {
      startY: y + 4,
      head: [["Exercise", "Set", "Prescription", "Notes"]],
      body,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin },
    });
    y = lastTableY(doc, y) + 16;
  }

  stampFooter(doc);
  return doc;
}

// -------------------------------------------------------------- Athlete cards

export function buildAthleteCardsPdf(opts: {
  session: SessionInfo;
  roster: Athlete[];
  exercises: WorkoutExercise[];
  sets: WorkoutSet[];
  repMaxes: RepMax[];
}): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  const blocks = groupExercisesBySuperset(opts.exercises);

  opts.roster.forEach((athlete, idx) => {
    if (idx > 0) doc.addPage();
    pageHeader(doc, athleteDisplayName(athlete), sessionSubtitle(opts.session));
    let y = 84;

    const body: (string | number)[][] = [];
    for (const [blockIdx, block] of blocks.entries()) {
      const label = blockLabel(block, blockIdx);
      for (const ex of block.items) {
        const sets = setsForExercise(opts.sets, ex.id);
        sets.forEach((s, i) => {
          const suggestion = suggestLoad({
            athleteId: athlete.id,
            exercise: ex,
            setRow: s,
            repMaxes: opts.repMaxes,
          });
          const weight = suggestion ? `${suggestion.load} lb` : formatPrescription(ex, s);
          body.push([
            i === 0 ? label : "",
            i === 0 ? ex.exercise_name : "",
            String(i + 1),
            s.reps ?? ex.reps ?? "—",
            weight,
          ]);
        });
        if (sets.length === 0) body.push([label, ex.exercise_name, "—", ex.reps ?? "—", "—"]);
      }
    }

    autoTable(doc, {
      startY: y,
      head: [["Block", "Exercise", "Set", "Reps", "Weight"]],
      body,
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 4: { fontStyle: "bold" } },
      margin: { left: margin, right: margin },
    });
    y = lastTableY(doc, y);
    if (body.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("No exercises in this session yet.", margin, y + 20);
    }
  });

  if (opts.roster.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("No athletes on this team's roster.", margin, 100);
  }

  stampFooter(doc);
  return doc;
}

// --------------------------------------------------------------- Rack sheets

export function buildRackSheetsPdf(opts: {
  session: SessionInfo;
  rackGroups: RackGroup[];
  isAutoGrouped: boolean;
  exercises: WorkoutExercise[];
  sets: WorkoutSet[];
  repMaxes: RepMax[];
}): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const margin = 40;
  const blocks = groupExercisesBySuperset(opts.exercises);

  opts.rackGroups.forEach((rack, idx) => {
    if (idx > 0) doc.addPage();
    const title = `Rack ${rack.rackNumber}`;
    const subtitle =
      sessionSubtitle(opts.session) +
      (opts.isAutoGrouped ? "  ·  auto-grouped (no rack assignment on file)" : "");
    pageHeader(doc, title, subtitle);
    const y = 84;

    const head = ["Exercise", ...rack.athletes.map((a) => athleteDisplayName(a))];
    const body: (string | number)[][] = [];
    for (const [blockIdx, block] of blocks.entries()) {
      const label = blockLabel(block, blockIdx);
      for (const ex of block.items) {
        const sets = setsForExercise(opts.sets, ex.id);
        const rows = sets.length > 0 ? sets : [null];
        rows.forEach((s, i) => {
          const exerciseCol = `${i === 0 ? `${label} · ${ex.exercise_name}` : ""}${s ? `` : ""}`;
          const setCol = s
            ? `Set ${i + 1} · ${s.reps ?? ex.reps ?? "—"} reps`
            : "No sets prescribed";
          const row: (string | number)[] = [`${exerciseCol}\n${setCol}`.trim()];
          for (const athlete of rack.athletes) {
            if (!s) {
              row.push("—");
              continue;
            }
            const suggestion = suggestLoad({
              athleteId: athlete.id,
              exercise: ex,
              setRow: s,
              repMaxes: opts.repMaxes,
            });
            row.push(suggestion ? `${suggestion.load}` : s.percent != null ? `${s.percent}%` : "—");
          }
          body.push(row);
        });
      }
    }

    if (rack.athletes.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("No athletes assigned to this rack.", margin, y);
    } else if (body.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("No exercises in this session yet.", margin, y);
    } else {
      autoTable(doc, {
        startY: y,
        head: [head],
        body,
        styles: { fontSize: 9, cellPadding: 5, valign: "middle" },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 220 } },
        margin: { left: margin, right: margin },
      });
    }
  });

  if (opts.rackGroups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("No athletes on this team's roster.", margin, 100);
  }

  stampFooter(doc);
  return doc;
}

// ------------------------------------------------------------------- Output

export function pdfPreviewUrl(doc: jsPDF): string {
  return URL.createObjectURL(doc.output("blob"));
}

export function downloadPdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}
