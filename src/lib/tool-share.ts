// Share-card rendering for public Strength Lab tools.
// Draws a branded PNG entirely on canvas (no extra deps), reusable by future tools.

import type { TierKey } from "./speed-potential";

const TIER_HEX: Record<TierKey, string> = {
  diamond: "#8fd8ee",
  platinum: "#dfe4ea",
  gold: "#e6b53f",
  silver: "#b6bcc6",
  bronze: "#c07a3e",
};

export type ShareCardData = {
  tierKey: TierKey;
  tierLabel: string;
  tierMeaning: string;
  athleteName?: string;
  peakMph: number;
  ppi: number;
  forty: string;
  fortyLabel: string;
  /** Optional athlete photo (data URL or same-origin URL). */
  photoUrl?: string | null;
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderShareCard(d: ShareCardData): Promise<HTMLCanvasElement> {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#131722");
  bg.addColorStop(1, "#0b0e16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Glow
  const glow = ctx.createRadialGradient(200, 60, 0, 200, 60, 620);
  glow.addColorStop(0, "rgba(70,130,255,0.30)");
  glow.addColorStop(1, "rgba(70,130,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const glow2 = ctx.createRadialGradient(1050, 120, 0, 1050, 120, 520);
  glow2.addColorStop(0, "rgba(160,90,255,0.24)");
  glow2.addColorStop(1, "rgba(160,90,255,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = "rgba(220,230,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 56) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 56) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  // Athlete photo (top-right circle)
  const photo = d.photoUrl ? await loadImage(d.photoUrl) : null;
  if (photo) {
    const size = 200;
    const cx = W - 64 - size / 2;
    const cy = 64 + size / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const scale = Math.max(size / photo.width, size / photo.height);
    const dw = photo.width * scale;
    const dh = photo.height * scale;
    ctx.drawImage(photo, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Brand
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 26px Inter, system-ui, sans-serif";
  ctx.fillText("Strength Lab Hub", 64, 84);
  ctx.fillStyle = "rgba(230,236,255,0.55)";
  ctx.font = "500 16px Inter, system-ui, sans-serif";
  ctx.fillText("SPRINT SPEED PROFILE", 64, 114);
  if (d.athleteName) {
    ctx.fillStyle = "rgba(230,236,255,0.85)";
    ctx.font = "600 24px Inter, system-ui, sans-serif";
    ctx.fillText(d.athleteName, 64, 152);
  }

  // Tier
  const tierColor = TIER_HEX[d.tierKey];
  ctx.fillStyle = tierColor;
  ctx.font = "800 132px Inter, system-ui, sans-serif";
  ctx.fillText(d.tierLabel.toUpperCase(), 60, 288);

  ctx.fillStyle = "rgba(230,236,255,0.7)";
  ctx.font = "600 28px Inter, system-ui, sans-serif";
  ctx.fillText(d.tierMeaning, 64, 332);

  // Stat cards
  const stats: Array<[string, string]> = [
    ["PEAK MPH", d.peakMph.toFixed(2)],
    ["POUNDS PER INCH", d.ppi.toFixed(2)],
    [d.fortyLabel.toUpperCase(), d.forty],
  ];
  const cardW = 336;
  const cardH = 150;
  const gap = 24;
  let x = 64;
  const y = 380;
  for (const [label, value] of stats) {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    roundRect(ctx, x, y, cardW, cardH, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.stroke();

    ctx.fillStyle = "rgba(230,236,255,0.55)";
    ctx.font = "600 16px Inter, system-ui, sans-serif";
    ctx.fillText(label, x + 26, y + 44);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 56px Inter, system-ui, sans-serif";
    ctx.fillText(value, x + 26, y + 110);

    x += cardW + gap;
  }

  ctx.fillStyle = "rgba(230,236,255,0.45)";
  ctx.font = "500 18px Inter, system-ui, sans-serif";
  ctx.fillText("strengthlabhub.com  ·  Free sprint speed profile tool", 64, 586);

  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export async function downloadCanvasPdf(canvas: HTMLCanvasElement, filename: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [1200, 630] });
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 1200, 630);
  doc.save(filename);
}
