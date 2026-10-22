// Printable, portaled 2-page Athleticism Report — ported from a purchased
// "Athleticism Report Builder" bundle's LtadReport.tsx + GainBoard.tsx, with
// the bundle's own demo-data model swapped out for this app's real,
// already-computed AthleticismReport. The print pagination tuning lives in
// athleticism-print-report.module.css, not here.
import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { Athlete } from "@/lib/queries";
import {
  QUALITY_COLORS,
  type AthleticismReport,
  type ReportConfig,
  type GainRow,
} from "@/lib/athleticism-report";
import { AthleticismSpiderChart, type SpiderAxis } from "./athleticism-spider-chart";
import { athleteDisplayName } from "@/lib/queries";
import { cn } from "@/lib/utils";
import styles from "./athleticism-print-report.module.css";

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function gainBarPerformanceValue(row: GainRow, value: number): number {
  if (!row.lowerIsBetter) return value;
  const max = Math.max(row.before ?? 0, row.after ?? 0);
  const min = Math.min(row.before ?? 0, row.after ?? 0);
  return max + min - value;
}

function gainDeltaLabel(row: GainRow): string {
  if (row.delta == null) return "no change";
  const magnitude = Math.abs(row.delta);
  if (magnitude === 0) return "no change";
  const sign = row.improved ? "+" : "−";
  return `${sign}${formatValue(magnitude)} ${row.unit}`;
}

function AthleteSilhouette() {
  return (
    <div className={styles.silhouette} aria-hidden="true">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="11" r="6" fill="currentColor" opacity={0.6} />
        <path d="M4 28c0-6.6 5.4-11 12-11s12 4.4 12 11" fill="currentColor" opacity={0.6} />
      </svg>
    </div>
  );
}

export function AthleticismPrintReport({
  athlete,
  report,
  config,
  note,
  onClose,
}: {
  athlete: Athlete;
  report: AthleticismReport;
  config: ReportConfig;
  note: string;
  onClose: () => void;
}) {
  const today = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    [],
  );

  const spiderAxes: SpiderAxis[] = report.qualities
    .filter((q) => q.avgNormalized != null)
    .map((q) => ({ label: q.label, value: q.avgNormalized ?? 0, color: QUALITY_COLORS[q.key] }));

  const heightLabel = athlete.height_in
    ? `${Math.floor(athlete.height_in / 12)}'${athlete.height_in % 12}"`
    : null;

  return createPortal(
    <div className={styles.overlay} data-print-report-root>
      <div className={styles.toolbar}>
        <button className={styles.toolbarButton} type="button" onClick={onClose}>
          Close
        </button>
        <button
          className={cn(styles.toolbarButton, styles.toolbarButtonPrimary)}
          type="button"
          onClick={() => window.print()}
        >
          Print / Save PDF
        </button>
      </div>

      <div className={styles.page}>
        {/* Page 1 */}
        <div className={styles.reportPage}>
          <div className={styles.kickerRule} />
          <p className={cn(styles.label, "font-mono")}>Athleticism Report · {today}</p>

          <div className={styles.masthead}>
            {athlete.photo_url ? (
              <img
                className={styles.silhouette}
                src={athlete.photo_url}
                alt=""
                style={{ objectFit: "cover" }}
              />
            ) : (
              <AthleteSilhouette />
            )}
            <div className={styles.mastheadInfo}>
              <h1 className={cn(styles.mastheadName, "font-display")}>
                {athleteDisplayName(athlete)}
              </h1>
              <span className={cn(styles.mastheadDetail, "font-mono")}>
                {[
                  athlete.sport,
                  athlete.position,
                  athlete.grade != null ? `Grade ${athlete.grade}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No sport/position on file"}
              </span>
            </div>
          </div>

          <div className={styles.heroRow}>
            <div className={styles.heroStat}>
              <span className={cn(styles.heroStatLabel, "font-mono")}>Athleticism Level</span>
              <span className={cn(styles.heroStatValue, "font-display")}>
                {report.overallLevel != null ? `${report.overallLevel}/4` : "—"}
              </span>
              <span className={styles.heroStatUnit}>{report.overallLevelLabel}</span>
            </div>
          </div>

          {report.highlighted.length > 0 && (
            <>
              <h2 className={cn(styles.sectionTitle, "font-display")}>Highlighted Stats</h2>
              <div className={styles.statGrid}>
                {report.highlighted.map((h) => (
                  <div className={cn(styles.statCard, styles.statCardHighlighted)} key={h.key}>
                    <span className={cn(styles.statCardLabel, "font-mono")}>{h.label}</span>
                    <span className={cn(styles.statCardValue, "font-display")}>
                      {h.raw != null ? `${h.raw}${h.unit}` : "No data"}
                    </span>
                    <span className={styles.statCardTier}>{h.qualityLabel}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {config.sections.physicalProfile && (
            <>
              <h2 className={cn(styles.sectionTitle, "font-display")}>Physical Profile</h2>
              <div className={styles.statGrid}>
                {heightLabel && (
                  <div className={styles.statCard}>
                    <span className={cn(styles.statCardLabel, "font-mono")}>Height</span>
                    <span className={cn(styles.statCardValue, "font-display")}>{heightLabel}</span>
                    <span className={styles.statCardTier}>Descriptive, not scored</span>
                  </div>
                )}
                {athlete.bodyweight != null && (
                  <div className={styles.statCard}>
                    <span className={cn(styles.statCardLabel, "font-mono")}>Bodyweight</span>
                    <span className={cn(styles.statCardValue, "font-display")}>
                      {athlete.bodyweight} lb
                    </span>
                    <span className={styles.statCardTier}>Descriptive, not scored</span>
                  </div>
                )}
              </div>
            </>
          )}

          {config.sections.spider && spiderAxes.length >= 3 && (
            <>
              <h2 className={cn(styles.sectionTitle, "font-display")}>Profile Shape</h2>
              <AthleticismSpiderChart axes={spiderAxes} size={320} />
              <p className={styles.disclaimer}>
                Profile shape across the graded qualities with data. Each axis is this athlete's
                percentile within their comparison group, not a raw score.
              </p>
            </>
          )}

          <h2 className={cn(styles.sectionTitle, "font-display")}>Quality Summary</h2>
          {report.qualities.map((q) => (
            <div className={styles.qualityRow} key={q.key}>
              <span className={styles.qualityChip} style={{ background: QUALITY_COLORS[q.key] }} />
              <span className={cn(styles.qualityName, "font-mono")}>{q.label}</span>
              <span className={styles.qualityTests}>
                {q.metrics.length
                  ? q.metrics
                      .map((m) => (m.raw != null ? `${m.label}: ${m.raw}${m.unit}` : null))
                      .filter(Boolean)
                      .join(" · ")
                  : "Not configured"}
              </span>
              <span className={cn(styles.qualityTier, "font-display")}>{q.levelLabel}</span>
            </div>
          ))}
        </div>

        {/* Page 2 */}
        <div className={cn(styles.reportPage, styles.reportPageBreak)}>
          {config.sections.gainBoard && (
            <>
              <h2 className={cn(styles.sectionTitle, "font-display")}>Gain Board</h2>
              {report.gainBoard.length === 0 ? (
                <p className={styles.disclaimer}>
                  Needs at least two logged results for a test to show before/after.
                </p>
              ) : (
                <div className={styles.gainBoardList}>
                  {report.gainBoard.map((row) => {
                    const max = Math.max(row.before ?? 0, row.after ?? 0, 1);
                    const beforePct = Math.min(
                      100,
                      (gainBarPerformanceValue(row, row.before ?? 0) / max) * 100,
                    );
                    const afterPct = Math.min(
                      100,
                      (gainBarPerformanceValue(row, row.after ?? 0) / max) * 100,
                    );
                    return (
                      <div className={styles.gainRow} key={row.key}>
                        <span className={styles.gainLabel}>{row.label}</span>
                        <span className={styles.gainBarTrack}>
                          <span
                            className={styles.gainBarPrior}
                            style={{ width: `${beforePct}%` }}
                          />
                          <span
                            className={styles.gainBarCurrent}
                            style={{ width: `${afterPct}%` }}
                          />
                        </span>
                        <span className={cn(styles.gainNumbers, "font-mono")}>
                          {row.before != null ? formatValue(row.before) : "—"} →{" "}
                          {row.after != null ? formatValue(row.after) : "—"} {row.unit} ·{" "}
                          <strong>{gainDeltaLabel(row)}</strong>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <h2 className={cn(styles.sectionTitle, "font-display")}>Coach's Note</h2>
          <p className={styles.coachNote}>{note}</p>

          <p className={styles.disclaimer}>
            This report reflects test scores against this program's own percentile/threshold
            scoring, not a medical evaluation. It is a coaching discussion tool for training
            emphasis and program sequencing, not a clearance, diagnosis, or guarantee of future
            performance.
          </p>
          <p className={cn(styles.footer, "font-mono")}>Strength Lab · Athleticism Report</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
