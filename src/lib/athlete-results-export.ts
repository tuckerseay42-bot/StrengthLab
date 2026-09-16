// One-page "my results" PDF for the athlete portal — a composite score plus
// a Test / Result / Score / Rank table. Builds and returns the jsPDF doc
// (rather than auto-saving, like buildReportPdf does) so the caller can
// either .save() it for download or turn it into a File for the Web Share
// API when emailing from a phone.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type AthleteResultRow = {
  test: string;
  result: string;
  score: string;
  rank: string;
};

export function buildAthleteResultsPdf(opts: {
  athleteName: string;
  team: string | null;
  composite: number | null;
  testsUsed: number;
  rows: AthleteResultRow[];
}): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 74, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(opts.athleteName, margin, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text(
    [opts.team, `Testing Results · ${new Date().toLocaleDateString()}`]
      .filter(Boolean)
      .join("  ·  "),
    margin,
    50,
  );
  doc.setTextColor(0);

  let y = 100;
  if (opts.composite != null) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(30);
    doc.text(`${opts.composite.toFixed(1)}/10`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`COMPOSITE  ·  ${opts.testsUsed} of ${opts.rows.length} tests`, margin, y + 15);
    doc.setTextColor(0);
    y += 36;
  }

  autoTable(doc, {
    startY: y,
    head: [["Test", "Result", "Score", "Team Rank"]],
    body: opts.rows.map((r) => [r.test, r.result, r.score, r.rank]),
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  });

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated ${new Date().toLocaleString()} · Strength Lab`, margin, pageH - 20);

  return doc;
}
