// Pure leaderboard computation shared between the Leaderboards page (card
// view + the dialog that edits a board) and the live wall-display view.
// Lives here rather than in src/routes/leaderboards.tsx so the live view
// component can import it without creating a route↔component circular
// import.
import type {
  Leaderboard,
  CustomMetric,
  LiftRow,
  AttendanceRow,
  CustomTestType,
  Athlete,
  TestRow,
} from "@/lib/queries";
import { computeMetric, type MetricRow } from "@/lib/metrics";

export function boardToWindow(b: Leaderboard): { from: string | null; to: string | null } {
  if (b.since_days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - b.since_days);
    return { from: cutoff.toISOString().slice(0, 10), to: null };
  }
  return { from: b.date_from, to: b.date_to };
}

export function boardRangeLabel(b: Leaderboard): string {
  if (b.since_days === 1) return "Today";
  if (b.since_days === 7) return "Last 7d";
  if (b.since_days === 30) return "Last 30d";
  if (b.since_days === 90) return "Last 90d";
  if (b.since_days) return `Last ${b.since_days}d`;
  if (b.date_from || b.date_to) return `${b.date_from ?? "…"} → ${b.date_to ?? "…"}`;
  return "All time";
}

export function formatLeaderValue(v: number, unit: string | null | undefined): string {
  if (unit === "reps") return String(Math.round(v));
  if (unit === "lb") return String(Math.round(v / 5) * 5);
  return v.toFixed(2);
}

// Shared by the card view and the live wall-display view so "Go live"
// always shows exactly the same ranking the card does — one filter+compute
// path, not two that could quietly drift apart.
export function computeBoardRows(
  board: Leaderboard,
  metric: CustomMetric | undefined,
  athletes: Athlete[],
  tests: TestRow[],
  lifts: LiftRow[],
  attendance: AttendanceRow[],
  customTypes: CustomTestType[],
  teamsByAthlete: Map<string, Set<string>>,
): { allRows: MetricRow[]; rows: MetricRow[]; teamAverage: number | null } {
  if (!metric) return { allRows: [], rows: [], teamAverage: null };
  const filtered = athletes.filter((a) => {
    if (board.team_id) {
      const extras = teamsByAthlete.get(a.id);
      const belongs = a.team_id === board.team_id || (extras?.has(board.team_id) ?? false);
      if (!belongs) return false;
    }
    if (board.sport) {
      const sports = [a.sport, a.sport_fall, a.sport_winter, a.sport_spring].filter(Boolean);
      if (!sports.includes(board.sport)) return false;
    }
    if (board.grade != null && a.grade !== board.grade) return false;
    if (board.position && (a.position ?? "").toLowerCase() !== board.position.toLowerCase())
      return false;
    if (board.gender && a.gender !== board.gender) return false;
    return true;
  });
  const w = boardToWindow(board);
  const allRows = computeMetric(metric, filtered, tests, lifts, attendance, w, customTypes);
  const rows = allRows.slice(0, board.row_limit);
  const teamAverage = allRows.length
    ? allRows.reduce((s, r) => s + r.value, 0) / allRows.length
    : null;
  return { allRows, rows, teamAverage };
}
