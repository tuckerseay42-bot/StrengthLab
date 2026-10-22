// Dependency-light SVG spider/radar chart for the printable report's
// per-quality profile shape — ported from a purchased bundle's
// LtadSpiderChart.tsx. Standard polar-projection radar geometry: a
// polarPoint helper places each axis vertex, a points-string builder draws
// the filled polygon, and concentric N-gon rings plus spokes form the grid.
// One filled athlete polygon, per-quality colored axis labels.
import { useId } from "react";
import styles from "./athleticism-print-report.module.css";

export type SpiderAxis = {
  label: string;
  value: number; // 0-100, clamped on render
  color: string; // per-quality color for this axis's label + vertex
};

const TAU = Math.PI * 2;

function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  axisIndex: number,
  totalAxes: number,
  value: number,
): { x: number; y: number } {
  const angle = -Math.PI / 2 + (axisIndex * TAU) / totalAxes;
  const clamped = Math.max(0, Math.min(100, value));
  const r = (clamped / 100) * radius;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function polygonVertices(
  cx: number,
  cy: number,
  radius: number,
  values: number[],
): { x: number; y: number }[] {
  return values.map((value, i) => polarPoint(cx, cy, radius, i, values.length, value));
}

function pointsString(verts: { x: number; y: number }[]): string {
  return verts.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(" ");
}

export function AthleticismSpiderChart({
  axes,
  size = 340,
  rings = 5,
}: {
  axes: SpiderAxis[];
  size?: number;
  rings?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fillId = `spider-fill-${uid}`;
  const glowId = `spider-glow-${uid}`;

  if (axes.length < 3) {
    return (
      <div
        className={styles.spiderWrap}
        role="img"
        aria-label="Spider chart, not enough qualities selected"
      >
        Select at least 3 qualities to render the spider chart.
      </div>
    );
  }

  const padding = Math.round(size * 0.18);
  const cx = size / 2;
  const cy = size / 2;
  const radius = Math.max(0, size / 2 - padding);

  const spokeEnds = axes.map((_, i) => polarPoint(cx, cy, radius, i, axes.length, 100));
  const ringLevels = Array.from({ length: rings }, (_, i) => ((i + 1) / rings) * 100);

  const primaryValues = axes.map((a) => a.value);
  const primaryVerts = polygonVertices(cx, cy, radius, primaryValues);
  const primaryPoints = pointsString(primaryVerts);

  const labelRadius = radius + Math.max(24, padding * 0.55);
  const labelPositions = axes.map((_, i) => polarPoint(cx, cy, labelRadius, i, axes.length, 100));

  const ariaLabel = `Spider chart, profile shape across ${axes.length} qualities: ${axes
    .map((a) => `${a.label} ${Math.round(a.value)}`)
    .join(", ")}. This is a shape-of-profile illustration, not a percentile.`;

  return (
    <div className={styles.spiderWrap}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <defs>
          <radialGradient id={fillId} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={radius}>
            <stop offset="0%" stopColor="#f5b301" stopOpacity={0.4} />
            <stop offset="70%" stopColor="#f5b301" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#f5b301" stopOpacity={0.1} />
          </radialGradient>
          <filter id={glowId} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation={size * 0.01} />
          </filter>
        </defs>

        <polygon
          points={pointsString(
            polygonVertices(
              cx,
              cy,
              radius,
              axes.map(() => 100),
            ),
          )}
          fill="rgba(255,255,255,0.04)"
        />

        {ringLevels.map((level, i) => {
          const isOuter = i === ringLevels.length - 1;
          const opacity = isOuter ? 0.5 : 0.28;
          return (
            <polygon
              key={`ring-${level}`}
              points={pointsString(
                polygonVertices(
                  cx,
                  cy,
                  radius,
                  axes.map(() => level),
                ),
              )}
              fill="none"
              stroke={`rgba(255,255,255,${opacity})`}
              strokeWidth={isOuter ? 1.4 : 1}
            />
          );
        })}

        {spokeEnds.map((end, i) => (
          <line
            key={`spoke-${i}`}
            x1={cx}
            y1={cy}
            x2={end.x}
            y2={end.y}
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1}
          />
        ))}

        <polygon
          points={primaryPoints}
          fill="none"
          stroke="#f5b301"
          strokeWidth={3}
          strokeOpacity={0.4}
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        />
        <polygon
          points={primaryPoints}
          fill={`url(#${fillId})`}
          stroke="#f5b301"
          strokeWidth={2.25}
          strokeLinejoin="round"
        />

        {primaryVerts.map((v, i) => {
          if ((primaryValues[i] ?? 0) <= 0) return null;
          return (
            <circle
              key={`vtx-${i}`}
              cx={v.x}
              cy={v.y}
              r={3.5}
              fill="#f5b301"
              stroke="#0e0a16"
              strokeWidth={1.5}
            />
          );
        })}

        {labelPositions.map((pos, i) => {
          const axis = axes[i];
          if (!axis) return null;
          let anchor: "start" | "middle" | "end" = "middle";
          if (pos.x > cx + 1) anchor = "end";
          else if (pos.x < cx - 1) anchor = "start";

          const lines = axis.label.split(/\s+/).filter(Boolean);
          const lineHeight = 12;
          const firstDy = -((lines.length - 1) / 2) * lineHeight;

          return (
            <text
              key={`label-${i}-${axis.label}`}
              x={pos.x}
              y={pos.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fill={axis.color}
              fontSize={10.5}
              fontWeight={700}
              letterSpacing="0.08em"
              style={{ textTransform: "uppercase" }}
            >
              {lines.map((word, li) => (
                <tspan key={li} x={pos.x} dy={li === 0 ? firstDy : lineHeight}>
                  {word}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
