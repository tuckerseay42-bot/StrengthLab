import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

/** Design tokens the report cards reference via var() inside SVG (gradients, strokes).
 *  html-to-image clones the node outside the document, so those vars resolve to nothing
 *  unless we re-declare them on the clone root. */
const TOKEN_VARS = [
  "--paper",
  "--paper-foreground",
  "--paper-muted",
  "--paper-border",
  "--paper-subtle",
  "--paper-accent",
  "--paper-warm",
  "--paper-danger",
  "--paper-good",
];

function tokenStyle(node: HTMLElement): Record<string, string> {
  const root = getComputedStyle(document.documentElement);
  const local = getComputedStyle(node);
  const out: Record<string, string> = {};
  for (const v of TOKEN_VARS) {
    const value = (local.getPropertyValue(v) || root.getPropertyValue(v)).trim();
    if (value) out[v] = value;
  }
  return out;
}

/** Capture a node at high fidelity. The first rasterization of an SVG-heavy node is
 *  often incomplete in Chromium, so we render twice and keep the second result. */
async function capture(node: HTMLElement, pixelRatio: number) {
  const options = {
    pixelRatio,
    backgroundColor: "#ffffff",
    skipFonts: true,
    cacheBust: true,
    style: tokenStyle(node) as unknown as Partial<CSSStyleDeclaration>,
  };
  await toPng(node, options);
  return toPng(node, options);
}

function withHiddenExportControls<T>(node: HTMLElement, fn: () => Promise<T>): Promise<T> {
  const toHide = Array.from(node.querySelectorAll<HTMLElement>("[data-export-hide]"));
  toHide.forEach((el) => el.setAttribute("hidden", ""));
  return fn().finally(() => toHide.forEach((el) => el.removeAttribute("hidden")));
}

/** Rasterize a card node and report its CSS size so callers can lay it out in a PDF. */
export async function captureNodePng(
  node: HTMLElement,
  pixelRatio = 2,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dataUrl = await withHiddenExportControls(node, () => capture(node, pixelRatio));
  return { dataUrl, w: rect.width, h: rect.height };
}


export async function exportCardsPdf(
  nodes: HTMLElement[],
  opts: { title: string; subtitle?: string; filename: string },
) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  const stamp = new Date().toLocaleString();

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

  let y = 88;

  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const dataUrl = await withHiddenExportControls(
      node,
      () => capture(node, 2),
    );
    const scale = contentW / rect.width;
    const h = rect.height * scale;

    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
    doc.addImage(dataUrl, "PNG", margin, y, contentW, h);
    y += h + 24;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated ${stamp} · Strength Lab`, margin, pageH - 20);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 20, { align: "right" });
  }

  doc.save(opts.filename);
}

export async function downloadCardPng(node: HTMLElement, filename: string) {
  const dataUrl = await withHiddenExportControls(
    node,
    () => capture(node, 2.5),
  );
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
