// Full roster grid for the Athleticism Report's Team mode — one row per
// athlete, one column per quality, sortable by name/team/composite. Ported
// from a purchased bundle's RosterTable.tsx, adapted to this app's real,
// already-computed AthleticismReport per athlete instead of the bundle's
// derived-on-the-fly roster config.
import { useMemo, useState } from "react";
import type { Athlete } from "@/lib/queries";
import { athleteDisplayName } from "@/lib/queries";
import { QUALITIES, QUALITY_COLORS, type AthleticismReport } from "@/lib/athleticism-report";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

type SortKey = "name" | "team" | "composite";

function levelColor(level: number | null): string {
  if (level == null) return "oklch(0.6 0.02 260)";
  if (level >= 4) return "oklch(0.78 0.19 145)";
  if (level >= 3) return "oklch(0.82 0.17 95)";
  if (level >= 2) return "oklch(0.78 0.16 65)";
  return "oklch(0.68 0.18 30)";
}

export function AthleticismRosterTable({
  rows,
  onSelectAthlete,
}: {
  rows: { athlete: Athlete; report: AthleticismReport }[];
  onSelectAthlete: (athleteId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const withKey = rows.map((r) => ({
      row: r,
      key:
        sortKey === "name"
          ? athleteDisplayName(r.athlete).toLowerCase()
          : sortKey === "team"
            ? (r.athlete.sport ?? "").toLowerCase()
            : (r.report.overallLevel ?? -1),
    }));
    withKey.sort((a, b) => {
      if (a.key < b.key) return sortDir === "asc" ? -1 : 1;
      if (a.key > b.key) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return withKey.map((e) => e.row);
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortButton = ({ label, forKey }: { label: string; forKey: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(forKey)}
      className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
    >
      {label}
      {sortKey === forKey &&
        (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );

  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No athletes.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th className="px-3 py-2 text-left">
              <SortButton label="Name" forKey="name" />
            </th>
            <th className="px-3 py-2 text-left">
              <SortButton label="Sport" forKey="team" />
            </th>
            <th className="px-3 py-2 text-left">
              <SortButton label="Composite" forKey="composite" />
            </th>
            {QUALITIES.map((q) => (
              <th
                key={q.key}
                className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {q.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {sorted.map(({ athlete, report }) => (
            <tr
              key={athlete.id}
              onClick={() => onSelectAthlete(athlete.id)}
              className="cursor-pointer transition hover:bg-muted/40"
            >
              <td className="px-3 py-2">
                <div className="font-medium">{athleteDisplayName(athlete)}</div>
                <div className="text-xs text-muted-foreground">{athlete.position || "—"}</div>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{athlete.sport || "—"}</td>
              <td className="px-3 py-2">
                <Badge
                  variant="outline"
                  style={{
                    borderColor: levelColor(report.overallLevel),
                    color: levelColor(report.overallLevel),
                  }}
                >
                  {report.overallLevelLabel}
                </Badge>
              </td>
              {QUALITIES.map((q) => {
                const result = report.qualities.find((x) => x.key === q.key);
                return (
                  <td key={q.key} className="px-3 py-2">
                    {result?.avgNormalized != null ? (
                      <span
                        className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium")}
                        style={{ borderColor: QUALITY_COLORS[q.key], color: QUALITY_COLORS[q.key] }}
                      >
                        {result.levelLabel}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
