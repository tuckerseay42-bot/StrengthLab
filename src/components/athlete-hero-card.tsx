import { useMemo } from "react";
import { User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { athleteDisplayName, type Athlete, type Team, type Program, type TestRow, type LiftRow, type AttendanceRow } from "@/lib/queries";
import { gradeToGradYear } from "@/lib/domain";

// -----------------------------------------------------------------------------
// Clean, minimal athlete hero. Identity only — no decorative graphics, no
// gradients, no status colors. Photo · name · team · sport · position · grade ·
// grad year · training group · last updated.
// -----------------------------------------------------------------------------

type Props = {
  athlete: Athlete;
  team?: Team | null;
  program?: Program | null;
  tests?: TestRow[];
  lifts?: LiftRow[];
  attendance?: AttendanceRow[];
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AthleteHeroCard({ athlete, team, program, tests, lifts, attendance }: Props) {
  const displayName = athleteDisplayName(athlete);

  const lastUpdated = useMemo(() => {
    const candidates: string[] = [];
    for (const t of tests ?? []) if (t.athlete_id === athlete.id && t.test_date) candidates.push(t.test_date);
    for (const l of lifts ?? []) if (l.athlete_id === athlete.id && l.lift_date) candidates.push(l.lift_date);
    for (const a of attendance ?? []) if (a.athlete_id === athlete.id && a.session_date) candidates.push(a.session_date);
    if (!candidates.length) return null;
    return candidates.sort().slice(-1)[0];
  }, [athlete.id, tests, lifts, attendance]);

  const gradYear = athlete.graduation_year ?? gradeToGradYear(athlete.grade);

  const facts: { label: string; value: string }[] = [
    team?.name ? { label: "Team", value: team.name } : null,
    athlete.sport ? { label: "Sport", value: athlete.sport } : null,
    athlete.position ? { label: "Position", value: athlete.position } : null,
    athlete.grade != null ? { label: "Grade", value: String(athlete.grade) } : null,
    gradYear ? { label: "Class of", value: String(gradYear) } : null,
    program?.name ? { label: "Training group", value: program.name } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 sm:gap-5">
          {/* Photo */}
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted sm:h-20 sm:w-20">
            {athlete.photo_url ? (
              <img src={athlete.photo_url} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              <User className="h-8 w-8 text-muted-foreground sm:h-10 sm:w-10" />
            )}
          </div>

          {/* Name + status */}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{displayName}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {athlete.status && (
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{
                      background:
                        athlete.status === "injured"
                          ? "var(--status-below)"
                          : athlete.status === "inactive"
                          ? "var(--status-neutral)"
                          : "var(--status-pr)",
                    }}
                  />
                  <span className="capitalize">{athlete.status}</span>
                </span>
              )}
              {lastUpdated && (
                <span className="before:mx-1 before:content-['·']">
                  Updated {fmtDate(lastUpdated)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Facts row */}
        {facts.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
            {facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {f.label}
                </dt>
                <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
