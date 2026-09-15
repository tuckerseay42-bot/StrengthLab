import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type PdfSection =
  | { kind: "heading"; text: string; level?: 1 | 2 | 3 }
  | { kind: "kv"; rows: [string, string][] }
  | { kind: "table"; head: string[]; body: (string | number)[][] }
  | { kind: "spacer"; h?: number }
  | { kind: "pagebreak" }
  | { kind: "image"; dataUrl: string; w: number; h: number };

export function buildReportPdf(opts: {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  filename: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - margin) { doc.addPage(); y = margin; }
  };

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 64, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.title, margin, 30);
  if (opts.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(203, 213, 225);
    doc.text(opts.subtitle, margin, 48);
  }
  doc.setTextColor(0);
  y = 88;

  for (const s of opts.sections) {
    if (s.kind === "spacer") { y += s.h ?? 12; continue; }
    if (s.kind === "pagebreak") { doc.addPage(); y = margin; continue; }
    if (s.kind === "heading") {
      const size = s.level === 1 ? 14 : s.level === 3 ? 10 : 12;
      ensureSpace(size + 10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.text(s.text, margin, y);
      y += size + 6;
      continue;
    }
    if (s.kind === "kv") {
      autoTable(doc, {
        startY: y,
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { fontStyle: "bold", textColor: [71, 85, 105], cellWidth: 130 } },
        body: s.rows,
        margin: { left: margin, right: margin },
      });
      // @ts-expect-error autoTable adds lastAutoTable
      y = (doc.lastAutoTable?.finalY ?? y) + 10;
      continue;
    }
    if (s.kind === "table") {
      autoTable(doc, {
        startY: y,
        head: [s.head],
        body: s.body,
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: margin, right: margin },
      });
      // @ts-expect-error autoTable adds lastAutoTable
      y = (doc.lastAutoTable?.finalY ?? y) + 10;
      continue;
    }
    if (s.kind === "image") {
      ensureSpace(s.h + 10);
      doc.addImage(s.dataUrl, "PNG", margin, y, s.w, s.h);
      y += s.h + 10;
    }
  }

  // Footer with generation date on each page
  const pages = doc.getNumberOfPages();
  const stamp = new Date().toLocaleString();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated ${stamp} · Strength Lab`, margin, pageH - 20);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 20, { align: "right" });
  }

  doc.save(opts.filename);
}

export async function captureSvgAsPng(svg: SVGSVGElement, scale = 2): Promise<{ dataUrl: string; w: number; h: number } | null> {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));
  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("svg load failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), w: rect.width, h: rect.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
