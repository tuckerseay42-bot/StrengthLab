import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  athletesQO,
  testsQO,
  repMaxesQO,
  testTypesQO,
  teamsQO,
  athleteDisplayName,
  type Athlete,
} from "@/lib/queries";
import { useMyPermissions } from "@/hooks/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, User, UsersRound } from "lucide-react";
import { AthleteAnalyticsPanel } from "@/components/athlete-analytics-panel";
import { GroupTrendChart } from "@/components/group-trend-chart";

export const Route = createFileRoute("/performance")({
  head: () => ({ meta: [{ title: "Performance Dashboard — Strength Lab" }] }),
  validateSearch: (s: Record<string, unknown>): { athlete?: string } => ({
    athlete: typeof s.athlete === "string" ? s.athlete : undefined,
  }),
  component: PerformanceDashboard,
});

type Mode = "athlete" | "group";

function PerformanceDashboard() {
  const { athlete: athleteFromSearch } = Route.useSearch();
  const { data: perms, isLoading: permsLoading } = useMyPermissions();
  const canView =
    perms?.roles.some(
      (r) =>
        r === "owner" ||
        r === "administrator" ||
        r === "admin" ||
        r === "coach" ||
        r === "sport_coach",
    ) ?? false;

  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: teams = [] } = useQuery(teamsQO);

  const [mode, setMode] = useState<Mode>("athlete");
  const [athleteId, setAthleteId] = useState<string | null>(athleteFromSearch ?? null);

  const athlete = athletes.find((a) => a.id === athleteId) ?? null;
  const peers = useMemo(() => {
    if (!athlete) return [];
    const sameTeam = athletes.filter((a) => a.team_id === athlete.team_id);
    return sameTeam.length >= 4 ? sameTeam : athletes;
  }, [athletes, athlete]);

  if (permsLoading) return <div className="py-16 text-center text-muted-foreground">Loading…</div>;

  if (!canView) {
    return (
      <div className="max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Performance Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only owners, administrators, and coaches can view this.
        </p>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Performance Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Deep-dive one athlete, or watch how a team, position, grade, or sport group is trending.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-border p-0.5 text-sm">
          <button
            onClick={() => setMode("athlete")}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors",
              mode === "athlete"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <User className="h-3.5 w-3.5" /> Athlete
          </button>
          <button
            onClick={() => setMode("group")}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors",
              mode === "group"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <UsersRound className="h-3.5 w-3.5" /> Team / Group
          </button>
        </div>
      </div>

      {mode === "athlete" ? (
        <div className="space-y-4">
          <AthletePicker athletes={athletes} value={athleteId} onChange={setAthleteId} />
          {athlete ? (
            <AthleteAnalyticsPanel
              athlete={athlete}
              peers={peers}
              tests={tests}
              repMaxes={repMaxes}
              customTypes={customTypes}
            />
          ) : (
            <Card className="border-dashed border-border/60">
              <CardContent className="py-16 text-center text-muted-foreground">
                Search for an athlete above to see their trends, percentiles, and PRs.
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <GroupTrendChart
          athletes={athletes}
          tests={tests}
          repMaxes={repMaxes}
          customTypes={customTypes}
          teams={teams}
        />
      )}
    </div>
  );
}

function AthletePicker({
  athletes,
  value,
  onChange,
}: {
  athletes: Athlete[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = athletes.find((a) => a.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full max-w-sm justify-between sm:w-[320px]"
        >
          <span className="truncate">
            {selected ? athleteDisplayName(selected) : "Search athletes…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name…" />
          <CommandList>
            <CommandEmpty>No athletes found.</CommandEmpty>
            <CommandGroup>
              {athletes.map((a) => (
                <CommandItem
                  key={a.id}
                  value={athleteDisplayName(a)}
                  onSelect={() => {
                    onChange(a.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === a.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{athleteDisplayName(a)}</span>
                  {a.position && (
                    <span className="ml-auto text-xs text-muted-foreground">{a.position}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
