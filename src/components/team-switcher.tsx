import { useQuery } from "@tanstack/react-query";
import { teamsQO } from "@/lib/queries";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { useActiveOrgId } from "@/hooks/use-active-org";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useMemo } from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export function TeamSwitcher() {
  const { data: teams = [] } = useQuery(teamsQO);
  const [activeId, setActive] = useActiveTeamId();
  const [activeOrgId] = useActiveOrgId();

  // Scope visible teams to the active organization when the super-admin has one selected.
  const visible = useMemo(() => {
    if (!activeOrgId) return teams;
    return teams.filter((t) => (t as unknown as { organization_id?: string }).organization_id === activeOrgId);
  }, [teams, activeOrgId]);

  // Clear the active team when it falls outside the current org scope.
  useEffect(() => {
    if (activeId && !visible.find((t) => t.id === activeId)) setActive(null);
  }, [activeId, visible, setActive]);

  if (!visible.length) return null;
  const filtered = !!activeId;
  return (
    <Select value={activeId ?? "all"} onValueChange={(v) => setActive(v === "all" ? null : v)}>
      <SelectTrigger
        className={cn(
          "h-9 w-[180px]",
          // This filter is global and sticky (localStorage) across every page —
          // roster, tests, attendance, imports, program delivery all narrow to
          // it silently. Make the filtered state impossible to miss so a coach
          // never wonders why athletes "disappeared" when they're just on a
          // different team than the one filtered here.
          filtered && "border-primary bg-primary/10 font-medium text-primary",
        )}
        title={filtered ? "Only this team is shown across the app — switch to \"All teams\" to see everyone" : undefined}
      >
        {filtered && <Filter className="h-3.5 w-3.5 shrink-0" />}
        <SelectValue placeholder="Team" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All teams</SelectItem>
        {visible.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}{t.season ? ` · ${t.season}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
